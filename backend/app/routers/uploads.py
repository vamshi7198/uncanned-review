"""Chunked, resumable video uploads.

Protocol:
  1. POST /api/projects/{id}/uploads         -> session with chunk_size
  2. PUT  /api/uploads/{id}/chunk?offset=N    -> raw bytes; offset must equal
                                                 received_bytes, so a retry of
                                                 a half-written chunk is safe
  3. GET  /api/uploads/{id}                   -> received_bytes, to resume
  4. POST /api/uploads/{id}/finalize          -> validates the file and creates
                                                 the version; idempotent

Nothing becomes visible as a version until finalize succeeds.
"""

import asyncio
import logging
import os
import time
import uuid
from datetime import timedelta

from fastapi import APIRouter, Query, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.requests import ClientDisconnect

from .. import probe, storage
from ..config import get_settings
from ..db import SessionLocal
from ..deps import DB, CurrentUser, ProjectAccess, load_access
from ..errors import AppError, bad_request, conflict, not_found
from ..models import Project, UploadSession, User, VideoVersion
from ..schemas import UploadCreate, UploadOut, VersionOut
from ..security import now
from ..services import log_activity, version_out

log = logging.getLogger("app.uploads")

router = APIRouter(prefix="/api", tags=["uploads"])

_chunk_locks: dict[uuid.UUID, asyncio.Lock] = {}


def _out(u: UploadSession) -> UploadOut:
    return UploadOut(
        id=u.id, project_id=u.project_id, original_filename=u.original_filename,
        expected_size=u.expected_size, received_bytes=u.received_bytes, status=u.status,
        chunk_size=get_settings().upload_chunk_bytes, version_id=u.version_id,
        expires_at=u.expires_at,
    )


def _load(db: Session, user: User, upload_id: uuid.UUID, *, lock: bool = False) -> UploadSession:
    stmt = select(UploadSession).where(UploadSession.id == upload_id)
    if lock:
        stmt = stmt.with_for_update()
    upload = db.scalar(stmt)
    if upload is None:
        raise not_found("Upload not found.")
    try:
        access = load_access(db, user, upload.project_id)
    except AppError:
        raise not_found("Upload not found.") from None
    if not access.can_upload:
        raise not_found("Upload not found.")
    return upload


def _clean_filename(name: str) -> str:
    # Metadata only; strip any path the browser may have included.
    name = name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    return "".join(ch for ch in name if ch.isprintable())[:255] or "video"


@router.post("/projects/{project_id}/uploads", response_model=UploadOut, status_code=201)
def start_upload(body: UploadCreate, access: ProjectAccess, db: DB) -> UploadOut:
    access.require(access.can_upload, "Only the project's editor can upload versions.")
    s = get_settings()
    filename = _clean_filename(body.filename)
    ext = storage.extension_of(filename)
    if ext not in s.allowed_extensions:
        raise bad_request(
            f"“{filename}” is not a supported video type. "
            f"Upload one of: {', '.join(e.upper() for e in s.allowed_extensions)}.",
            "unsupported_type",
        )
    if body.size > s.max_upload_bytes:
        raise AppError(
            413, "too_large",
            f"This file is larger than the {s.max_upload_bytes / 1024**3:.1f} GB upload limit.",
        )

    upload = UploadSession(
        project_id=access.project.id,
        initiated_by=access.user.id,
        original_filename=filename,
        expected_size=body.size,
        notes=body.notes.strip(),
        expires_at=now() + timedelta(hours=s.upload_session_ttl_hours),
    )
    db.add(upload)
    db.flush()
    storage.ensure_dirs()
    storage.resolve(storage.temp_key(upload.id)).touch()
    db.commit()
    return _out(upload)


@router.get("/uploads/{upload_id}", response_model=UploadOut)
def get_upload(upload_id: uuid.UUID, user: CurrentUser, db: DB) -> UploadOut:
    return _out(_load(db, user, upload_id))


@router.put("/uploads/{upload_id}/chunk", response_model=UploadOut)
async def put_chunk(
    upload_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    db: DB,
    offset: int = Query(ge=0),
) -> UploadOut:
    s = get_settings()
    upload = await run_in_threadpool(_load, db, user, upload_id)
    if upload.status != "uploading":
        raise conflict("This upload is no longer accepting data.", "upload_closed")

    lock = _chunk_locks.setdefault(upload_id, asyncio.Lock())
    if lock.locked():
        raise conflict("Another part of this upload is still being written.", "chunk_in_progress")

    async with lock:
        await run_in_threadpool(db.refresh, upload)
        if offset != upload.received_bytes:
            raise conflict(
                "Upload position mismatch. Resume from the server's position.",
                "offset_mismatch", {"received_bytes": upload.received_bytes},
            )
        limit = min(s.upload_chunk_bytes, upload.expected_size - offset)
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            raise AppError(413, "chunk_too_large", "This part of the upload is too large.")

        path = storage.resolve(storage.temp_key(upload.id))
        written = 0
        try:
            with path.open("r+b") as f:
                # Discard anything left over from an interrupted earlier attempt.
                f.truncate(offset)
                f.seek(offset)
                async for part in request.stream():
                    written += len(part)
                    if written > limit:
                        raise AppError(413, "chunk_too_large", "This part of the upload is too large.")
                    f.write(part)
        except ClientDisconnect:
            raise AppError(400, "client_disconnected", "The connection dropped. Retry this part.") from None

        if written == 0 and upload.expected_size > offset:
            raise bad_request("No data received.", "empty_chunk")

        upload.received_bytes = offset + written
        upload.expires_at = now() + timedelta(hours=s.upload_session_ttl_hours)
        await run_in_threadpool(db.commit)
        return _out(upload)


@router.delete("/uploads/{upload_id}", status_code=204)
def cancel_upload(upload_id: uuid.UUID, user: CurrentUser, db: DB) -> None:
    upload = _load(db, user, upload_id, lock=True)
    if upload.status == "completed":
        raise conflict("This upload has already become a version.", "upload_completed")
    upload.status = "cancelled"
    db.commit()
    storage.remove_quietly(storage.resolve(storage.temp_key(upload.id)))
    _chunk_locks.pop(upload_id, None)


def _reject(db: Session, upload: UploadSession, message: str) -> AppError:
    upload.status = "cancelled"
    db.commit()
    storage.remove_quietly(storage.resolve(storage.temp_key(upload.id)))
    return bad_request(message, "invalid_video")


@router.post("/uploads/{upload_id}/finalize", response_model=VersionOut)
def finalize_upload(upload_id: uuid.UUID, user: CurrentUser, db: DB) -> VersionOut:
    # The row lock serialises duplicate finalize calls; the second one waits,
    # then sees "completed" and returns the same version.
    upload = _load(db, user, upload_id, lock=True)

    if upload.status == "completed" and upload.version_id:
        version = db.get(VideoVersion, upload.version_id)
        if version is None:
            raise not_found("Version not found.")
        db.commit()
        return _version_response(db, version)
    if upload.status != "uploading":
        raise conflict("This upload was cancelled or has expired. Start a new upload.", "upload_closed")
    if upload.received_bytes != upload.expected_size:
        raise conflict(
            "The upload is not complete yet.", "upload_incomplete",
            {"received_bytes": upload.received_bytes},
        )

    temp = storage.resolve(storage.temp_key(upload.id))
    if not temp.exists() or temp.stat().st_size != upload.expected_size:
        raise _reject(db, upload, "The uploaded file is missing or damaged. Please upload it again.")

    kind = storage.sniff_container(temp)
    if kind is None:
        raise _reject(db, upload, "This file is not a recognised MP4, MOV or WebM video.")
    ext, content_type = kind

    info = probe.probe(temp)
    if info is not None and not info.has_video:
        raise _reject(db, upload, "This file does not contain a playable video stream.")

    checksum = storage.sha256_of(temp)
    key = storage.video_key(upload.project_id, ext)
    dest = storage.resolve(key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temp, dest)

    thumb_key: str | None = storage.thumbnail_key(upload.project_id)
    if not probe.make_thumbnail(dest, storage.resolve(thumb_key), info.duration_ms if info else None):
        thumb_key = None

    try:
        project = db.scalar(select(Project).where(Project.id == upload.project_id).with_for_update())
        assert project is not None
        number = (
            db.scalar(
                select(func.max(VideoVersion.version_number)).where(
                    VideoVersion.project_id == project.id
                )
            )
            or 0
        ) + 1
        version = VideoVersion(
            project_id=project.id,
            version_number=number,
            storage_key=key,
            thumbnail_key=thumb_key,
            original_filename=upload.original_filename,
            content_type=content_type,
            size_bytes=upload.expected_size,
            checksum_sha256=checksum,
            duration_ms=info.duration_ms if info else None,
            frame_rate=info.frame_rate if info else None,
            variable_frame_rate=info.variable_frame_rate if info else False,
            width=info.width if info else None,
            height=info.height if info else None,
            video_codec=info.codec if info else None,
            uploaded_by=user.id,
            notes=upload.notes,
            status="ready",
            approval_status="in_review",
        )
        db.add(version)
        db.flush()
        upload.status = "completed"
        upload.version_id = version.id
        log_activity(
            db, project, user, "version_uploaded", "version", version.id,
            {"version_number": number, "filename": upload.original_filename},
        )
        db.commit()
    except Exception:
        db.rollback()
        # Put the file back so the upload can be finalized again.
        if dest.exists():
            os.replace(dest, temp)
        if thumb_key:
            storage.remove_quietly(storage.resolve(thumb_key))
        raise

    _chunk_locks.pop(upload_id, None)
    return _version_response(db, version)


def _version_response(db: Session, version: VideoVersion) -> VersionOut:
    latest_n = db.scalar(
        select(func.max(VideoVersion.version_number)).where(
            VideoVersion.project_id == version.project_id
        )
    )
    return version_out(version, is_latest=version.version_number == latest_n, open_comments=0)


def cleanup_expired_uploads() -> int:
    """Expire abandoned uploads and delete their temporary files."""
    removed = 0
    with SessionLocal() as db:
        stale = db.scalars(
            select(UploadSession)
            .where(UploadSession.status == "uploading", UploadSession.expires_at < now())
            .with_for_update(skip_locked=True)
        ).all()
        for u in stale:
            u.status = "expired"
            storage.remove_quietly(storage.resolve(storage.temp_key(u.id)))
            removed += 1
        db.commit()

        # Temp files with no live session (e.g. after a crash).
        tmp = storage.root() / storage.TMP_DIR
        if tmp.is_dir():
            live = {
                str(i)
                for i in db.scalars(
                    select(UploadSession.id).where(UploadSession.status == "uploading")
                )
            }
            cutoff = time.time() - 3600
            for f in tmp.glob("*.part"):
                if f.stem not in live and f.stat().st_mtime < cutoff:
                    storage.remove_quietly(f)
                    removed += 1
    if removed:
        log.info("Cleaned up %d abandoned upload file(s)", removed)
    return removed
