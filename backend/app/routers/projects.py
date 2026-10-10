import uuid
from datetime import datetime

from fastapi import APIRouter, Query
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..deps import DB, AdminUser, CurrentUser, ProjectAccess
from ..errors import bad_request
from ..models import Activity, Approval, Project, ProjectMembership, User, VideoVersion
from ..schemas import (
    ActivityOut,
    ApprovalOut,
    MemberIn,
    MemberOut,
    MembersIn,
    Page,
    ProjectCreate,
    ProjectDetail,
    ProjectUpdate,
)
from ..services import FILTERS, brief, list_projects, log_activity, members_of, project_detail
from ..deps import load_access

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
def get_projects(
    user: CurrentUser,
    db: DB,
    q: str = Query(default="", max_length=200),
    filter: str = Query(default="all"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    if filter not in FILTERS:
        raise bad_request(f"Unknown filter. Use one of: {', '.join(FILTERS)}.")
    items, total = list_projects(db, user, search=q, filter_=filter, limit=limit, offset=offset)
    return {"items": items, "total": total}


def _apply_members(db: Session, project: Project, members: list[MemberIn]) -> None:
    seen: set[uuid.UUID] = set()
    for m in members:
        if m.user_id in seen:
            raise bad_request("A person can only be added to a project once.")
        seen.add(m.user_id)

    if seen:
        users = {
            u.id: u
            for u in db.scalars(select(User).where(User.id.in_(seen), User.is_active))
        }
        missing = seen - users.keys()
        if missing:
            raise bad_request("One or more selected people do not exist or are disabled.")

    db.execute(delete(ProjectMembership).where(ProjectMembership.project_id == project.id))
    db.flush()
    for m in members:
        db.add(
            ProjectMembership(
                project_id=project.id,
                user_id=m.user_id,
                role=m.role,
                can_approve=m.can_approve if m.role == "reviewer" else False,
            )
        )


@router.post("", response_model=ProjectDetail, status_code=201)
def create_project(body: ProjectCreate, admin: AdminUser, db: DB) -> ProjectDetail:
    project = Project(name=body.name, description=body.description.strip(), created_by=admin.id)
    db.add(project)
    db.flush()
    _apply_members(db, project, body.members)
    log_activity(db, project, admin, "project_created", "project", project.id, {"name": project.name})
    db.commit()
    return project_detail(db, load_access(db, admin, project.id))


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project(access: ProjectAccess, db: DB) -> ProjectDetail:
    return project_detail(db, access)


@router.patch("/{project_id}", response_model=ProjectDetail)
def update_project(body: ProjectUpdate, access: ProjectAccess, db: DB) -> ProjectDetail:
    access.require(access.is_admin, "Only an administrator can edit project details.")
    p = access.project
    changes = {}
    if body.name is not None and body.name.strip() and body.name.strip() != p.name:
        changes["name"] = body.name.strip()
        p.name = body.name.strip()
    if body.description is not None:
        p.description = body.description.strip()
    if body.is_archived is not None and body.is_archived != p.is_archived:
        p.is_archived = body.is_archived
        changes["archived"] = body.is_archived
    if changes:
        log_activity(db, p, access.user, "project_updated", "project", p.id, changes)
    db.commit()
    return project_detail(db, access)


@router.get("/{project_id}/members", response_model=list[MemberOut])
def get_members(access: ProjectAccess, db: DB) -> list[MemberOut]:
    return members_of(db, access.project.id)


@router.put("/{project_id}/members", response_model=list[MemberOut])
def set_members(body: MembersIn, access: ProjectAccess, db: DB) -> list[MemberOut]:
    access.require(access.is_admin, "Only an administrator can change who is on a project.")
    _apply_members(db, access.project, body.members)
    log_activity(
        db, access.project, access.user, "members_updated", "project", access.project.id,
        {"count": len(body.members)},
    )
    db.commit()
    return members_of(db, access.project.id)


@router.get("/{project_id}/activity", response_model=Page)
def get_activity(
    access: ProjectAccess,
    db: DB,
    limit: int = Query(default=30, ge=1, le=100),
    before: datetime | None = None,
) -> Page:
    stmt = select(Activity).where(Activity.project_id == access.project.id)
    if before:
        stmt = stmt.where(Activity.created_at < before)
    rows = db.scalars(stmt.order_by(Activity.created_at.desc()).limit(limit + 1)).all()
    items = [
        ActivityOut(
            id=a.id, actor=brief(a.actor), event_type=a.event_type, entity_type=a.entity_type,
            entity_id=a.entity_id, data=a.data, created_at=a.created_at,
        )
        for a in rows[:limit]
    ]
    next_cursor = rows[limit - 1].created_at.isoformat() if len(rows) > limit else None
    return Page(items=items, next_cursor=next_cursor)


@router.get("/{project_id}/approvals", response_model=list[ApprovalOut])
def get_approvals(access: ProjectAccess, db: DB) -> list[ApprovalOut]:
    rows = db.execute(
        select(Approval, VideoVersion.version_number)
        .join(VideoVersion, VideoVersion.id == Approval.version_id)
        .where(Approval.project_id == access.project.id)
        .order_by(Approval.created_at.desc())
    ).all()
    return [
        ApprovalOut(
            id=a.id, version_id=a.version_id, version_number=n, reviewer=brief(a.reviewer),
            decision=a.decision, note=a.note, created_at=a.created_at,
        )
        for a, n in rows
    ]
