"""Queries and serializers shared across routers."""

import uuid
from typing import Any

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from . import probe
from .deps import Access
from .models import Activity, Comment, Project, ProjectMembership, User, VideoVersion
from .schemas import (
    MemberOut,
    ProjectDetail,
    ProjectSummary,
    UserBrief,
    VersionOut,
)
from .security import now


def brief(user: User | None) -> UserBrief | None:
    return UserBrief.model_validate(user) if user else None


def log_activity(
    db: Session,
    project: Project,
    actor: User | None,
    event_type: str,
    entity_type: str,
    entity_id: uuid.UUID | None = None,
    data: dict[str, Any] | None = None,
) -> None:
    db.add(
        Activity(
            project_id=project.id,
            actor_id=actor.id if actor else None,
            event_type=event_type,
            entity_type=entity_type,
            entity_id=entity_id,
            data=data or {},
        )
    )
    project.last_activity_at = now()


def open_comment_counts(db: Session, version_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Unresolved, undeleted top-level comments per version."""
    if not version_ids:
        return {}
    rows = db.execute(
        select(Comment.version_id, func.count())
        .where(
            Comment.version_id.in_(version_ids),
            Comment.parent_id.is_(None),
            Comment.is_resolved.is_(False),
            Comment.deleted_at.is_(None),
        )
        .group_by(Comment.version_id)
    ).all()
    return {vid: n for vid, n in rows}


def version_out(v: VideoVersion, *, is_latest: bool, open_comments: int) -> VersionOut:
    return VersionOut(
        id=v.id,
        project_id=v.project_id,
        version_number=v.version_number,
        original_filename=v.original_filename,
        content_type=v.content_type,
        size_bytes=v.size_bytes,
        checksum_sha256=v.checksum_sha256,
        duration_ms=v.duration_ms,
        frame_rate=v.frame_rate,
        variable_frame_rate=v.variable_frame_rate,
        width=v.width,
        height=v.height,
        video_codec=v.video_codec,
        playback_warning=probe.playback_warning(v.video_codec),
        has_thumbnail=bool(v.thumbnail_key),
        uploaded_by=brief(v.uploader),
        notes=v.notes,
        status=v.status,
        approval_status=v.approval_status,
        is_latest=is_latest,
        open_comments=open_comments,
        created_at=v.created_at,
    )


def latest_version(db: Session, project_id: uuid.UUID) -> VideoVersion | None:
    return db.scalar(
        select(VideoVersion)
        .where(VideoVersion.project_id == project_id)
        .order_by(VideoVersion.version_number.desc())
        .limit(1)
    )


def project_status(latest: VideoVersion | None) -> str:
    return latest.approval_status if latest else "draft"


FILTERS = ("all", "needs_review", "changes_requested", "approved", "archived")


def list_projects(
    db: Session, user: User, *, search: str = "", filter_: str = "all", limit: int = 50, offset: int = 0
) -> tuple[list[ProjectSummary], int]:
    latest_sq = (
        select(
            VideoVersion.project_id,
            func.max(VideoVersion.version_number).label("max_n"),
            func.count().label("n"),
        )
        .group_by(VideoVersion.project_id)
        .subquery()
    )
    stmt = (
        select(Project, VideoVersion, latest_sq.c.n, ProjectMembership)
        .outerjoin(latest_sq, latest_sq.c.project_id == Project.id)
        .outerjoin(
            VideoVersion,
            and_(
                VideoVersion.project_id == Project.id,
                VideoVersion.version_number == latest_sq.c.max_n,
            ),
        )
        .outerjoin(
            ProjectMembership,
            and_(ProjectMembership.project_id == Project.id, ProjectMembership.user_id == user.id),
        )
    )
    if user.role != "admin":
        stmt = stmt.where(ProjectMembership.id.is_not(None))

    stmt = stmt.where(Project.is_archived.is_(filter_ == "archived"))
    if search.strip():
        stmt = stmt.where(Project.name.ilike(f"%{_escape_like(search.strip())}%", escape="\\"))
    if filter_ == "needs_review":
        stmt = stmt.where(VideoVersion.approval_status == "in_review")
        if user.role != "admin":
            stmt = stmt.where(ProjectMembership.role == "reviewer")
    elif filter_ in ("changes_requested", "approved"):
        stmt = stmt.where(VideoVersion.approval_status == filter_)

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.execute(
        stmt.order_by(Project.last_activity_at.desc()).limit(limit).offset(offset)
    ).all()

    counts = open_comment_counts(db, [v.id for _, v, _, _ in rows if v is not None])
    items = []
    for project, latest, n, membership in rows:
        open_n = counts.get(latest.id, 0) if latest else 0
        items.append(
            ProjectSummary(
                id=project.id,
                name=project.name,
                description=project.description,
                is_archived=project.is_archived,
                status=project_status(latest),
                latest_version=version_out(latest, is_latest=True, open_comments=open_n)
                if latest
                else None,
                version_count=n or 0,
                open_comments=open_n,
                last_activity_at=project.last_activity_at,
                updated_at=project.updated_at,
                my_role=membership.role if membership else ("admin" if user.role == "admin" else None),
            )
        )
    return items, total


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def members_of(db: Session, project_id: uuid.UUID) -> list[MemberOut]:
    rows = db.scalars(
        select(ProjectMembership)
        .where(ProjectMembership.project_id == project_id)
        .order_by(ProjectMembership.role, ProjectMembership.created_at)
    ).all()
    return [
        MemberOut(user=brief(m.user), role=m.role, can_approve=m.can_approve)  # type: ignore[arg-type]
        for m in rows
    ]


def versions_of(db: Session, project_id: uuid.UUID) -> list[VersionOut]:
    versions = db.scalars(
        select(VideoVersion)
        .where(VideoVersion.project_id == project_id)
        .order_by(VideoVersion.version_number.desc())
    ).all()
    counts = open_comment_counts(db, [v.id for v in versions])
    latest_id = versions[0].id if versions else None
    return [
        version_out(v, is_latest=v.id == latest_id, open_comments=counts.get(v.id, 0))
        for v in versions
    ]


def project_detail(db: Session, access: Access) -> ProjectDetail:
    p = access.project
    versions = versions_of(db, p.id)
    latest = versions[0] if versions else None
    return ProjectDetail(
        id=p.id,
        name=p.name,
        description=p.description,
        is_archived=p.is_archived,
        status=latest.approval_status if latest else "draft",
        latest_version=latest,
        version_count=len(versions),
        open_comments=latest.open_comments if latest else 0,
        last_activity_at=p.last_activity_at,
        updated_at=p.updated_at,
        created_at=p.created_at,
        my_role=access.project_role or ("admin" if access.is_admin else None),
        members=members_of(db, p.id),
        versions=versions,
        permissions=access.permissions(),
    )
