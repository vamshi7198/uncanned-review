import uuid
from urllib.parse import quote

from fastapi import APIRouter
from fastapi.responses import FileResponse
from sqlalchemy import select

from .. import storage
from ..deps import DB, CurrentUser, ProjectAccess, load_version
from ..errors import conflict, not_found
from ..models import Approval, Project, VideoVersion
from ..schemas import ApprovalOut, DecisionIn, VersionOut
from ..services import brief, latest_version, log_activity, open_comment_counts, version_out, versions_of

router = APIRouter(prefix="/api", tags=["versions"])


def _version_response(db, version: VideoVersion) -> VersionOut:
    latest = latest_version(db, version.project_id)
    counts = open_comment_counts(db, [version.id])
    return version_out(
        version,
        is_latest=bool(latest and latest.id == version.id),
        open_comments=counts.get(version.id, 0),
    )


@router.get("/projects/{project_id}/versions", response_model=list[VersionOut])
def list_versions(access: ProjectAccess, db: DB) -> list[VersionOut]:
    return versions_of(db, access.project.id)


@router.get("/versions/{version_id}", response_model=VersionOut)
def get_version(version_id: uuid.UUID, user: CurrentUser, db: DB) -> VersionOut:
    _, version = load_version(db, user, version_id)
    return _version_response(db, version)


def _file_response(version: VideoVersion, *, download: bool) -> FileResponse:
    path = storage.resolve(version.storage_key)
    if not path.is_file():
        raise not_found("The video file is missing from storage.")
    disposition = "attachment" if download else "inline"
    ascii_name = version.original_filename.encode("ascii", "replace").decode().replace('"', "")
    headers = {
        "Content-Disposition": (
            f'{disposition}; filename="{ascii_name}"; '
            f"filename*=UTF-8''{quote(version.original_filename)}"
        ),
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    }
    # FileResponse streams from disk and honours Range requests (206 Partial
    # Content), which the browser needs for seeking.
    return FileResponse(path, media_type=version.content_type, headers=headers)


@router.get("/versions/{version_id}/media")
def stream_media(version_id: uuid.UUID, user: CurrentUser, db: DB) -> FileResponse:
    _, version = load_version(db, user, version_id)
    return _file_response(version, download=False)


@router.get("/versions/{version_id}/download")
def download_media(version_id: uuid.UUID, user: CurrentUser, db: DB) -> FileResponse:
    _, version = load_version(db, user, version_id)
    return _file_response(version, download=True)


@router.get("/versions/{version_id}/thumbnail")
def thumbnail(version_id: uuid.UUID, user: CurrentUser, db: DB) -> FileResponse:
    _, version = load_version(db, user, version_id)
    if not version.thumbnail_key:
        raise not_found("No thumbnail.")
    path = storage.resolve(version.thumbnail_key)
    if not path.is_file():
        raise not_found("No thumbnail.")
    return FileResponse(
        path, media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"},
    )


def _decide(version_id: uuid.UUID, decision: str, body: DecisionIn, user, db) -> VersionOut:
    access, version = load_version(db, user, version_id)
    access.require(access.can_decide, "Only an approving reviewer can approve or request changes.")

    # Lock the project so a new upload cannot land between the "is latest"
    # check and the decision being recorded.
    db.scalar(select(Project).where(Project.id == version.project_id).with_for_update())
    latest = latest_version(db, version.project_id)
    if latest is None or latest.id != version.id:
        raise conflict(
            "A newer version exists. Only the latest version can be approved or sent back.",
            "not_latest",
        )

    target = "approved" if decision == "approved" else "changes_requested"
    if version.approval_status == target:
        raise conflict(
            "This version is already approved." if target == "approved"
            else "Changes have already been requested on this version.",
            "no_change",
        )

    if decision == "approved" and not body.acknowledge_unresolved:
        open_n = open_comment_counts(db, [version.id]).get(version.id, 0)
        if open_n:
            raise conflict(
                f"This version still has {open_n} unresolved comment"
                f"{'s' if open_n != 1 else ''}. Resolve them, or confirm you want to approve anyway.",
                "unresolved_feedback",
                {"unresolved": open_n},
            )

    version.approval_status = target
    approval = Approval(
        project_id=version.project_id, version_id=version.id, reviewer_id=user.id,
        decision=decision, note=body.note.strip(),
    )
    db.add(approval)
    db.flush()
    log_activity(
        db, access.project, user,
        "version_approved" if decision == "approved" else "changes_requested",
        "version", version.id,
        {"version_number": version.version_number, "note": body.note.strip()[:500]},
    )
    db.commit()
    return _version_response(db, version)


@router.post("/versions/{version_id}/approve", response_model=VersionOut)
def approve(version_id: uuid.UUID, body: DecisionIn, user: CurrentUser, db: DB) -> VersionOut:
    return _decide(version_id, "approved", body, user, db)


@router.post("/versions/{version_id}/request-changes", response_model=VersionOut)
def request_changes(version_id: uuid.UUID, body: DecisionIn, user: CurrentUser, db: DB) -> VersionOut:
    return _decide(version_id, "changes_requested", body, user, db)


@router.get("/versions/{version_id}/approvals", response_model=list[ApprovalOut])
def version_approvals(version_id: uuid.UUID, user: CurrentUser, db: DB) -> list[ApprovalOut]:
    _, version = load_version(db, user, version_id)
    rows = db.scalars(
        select(Approval).where(Approval.version_id == version.id).order_by(Approval.created_at.desc())
    ).all()
    return [
        ApprovalOut(
            id=a.id, version_id=a.version_id, version_number=version.version_number,
            reviewer=brief(a.reviewer), decision=a.decision, note=a.note, created_at=a.created_at,
        )
        for a in rows
    ]
