"""Request dependencies: the signed-in user and per-project access checks.

Every route that touches project data goes through `project_access` (or
`version_access` / `comment_access`, which resolve to it). A user who is not a
member gets a 404, never a 403, so IDs cannot be probed.
"""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .errors import AppError, forbidden, not_found
from .models import Comment, Project, ProjectMembership, User, VideoVersion
from .security import SESSION_COOKIE, resolve_session

DB = Annotated[Session, Depends(get_db)]


def current_user(request: Request, db: DB) -> User:
    session = resolve_session(db, request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise AppError(401, "unauthenticated", "Please sign in.")
    request.state.session_token = request.cookies.get(SESSION_COOKIE)
    return session.user


CurrentUser = Annotated[User, Depends(current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise forbidden("Only an administrator can do that.")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


@dataclass
class Access:
    user: User
    project: Project
    membership: ProjectMembership | None

    @property
    def is_admin(self) -> bool:
        return self.user.role == "admin"

    @property
    def project_role(self) -> str | None:
        return self.membership.role if self.membership else None

    @property
    def can_upload(self) -> bool:
        return self.is_admin or self.project_role == "editor"

    @property
    def can_review(self) -> bool:
        """Resolve and reopen feedback."""
        return self.is_admin or self.project_role == "reviewer"

    @property
    def can_decide(self) -> bool:
        """Approve or request changes."""
        return self.is_admin or (
            self.project_role == "reviewer" and bool(self.membership and self.membership.can_approve)
        )

    def require(self, allowed: bool, message: str) -> None:
        if not allowed:
            raise forbidden(message)

    def permissions(self) -> dict[str, bool]:
        return {
            "can_upload": self.can_upload,
            "can_review": self.can_review,
            "can_decide": self.can_decide,
            "can_manage": self.is_admin,
        }


def load_access(db: Session, user: User, project_id: uuid.UUID) -> Access:
    project = db.get(Project, project_id)
    if project is None:
        raise not_found("Project not found.")
    membership = db.scalar(
        select(ProjectMembership).where(
            ProjectMembership.project_id == project_id,
            ProjectMembership.user_id == user.id,
        )
    )
    if membership is None and user.role != "admin":
        raise not_found("Project not found.")
    return Access(user=user, project=project, membership=membership)


def project_access(project_id: uuid.UUID, user: CurrentUser, db: DB) -> Access:
    return load_access(db, user, project_id)


ProjectAccess = Annotated[Access, Depends(project_access)]


def load_version(db: Session, user: User, version_id: uuid.UUID) -> tuple[Access, VideoVersion]:
    version = db.get(VideoVersion, version_id)
    if version is None:
        raise not_found("Version not found.")
    try:
        access = load_access(db, user, version.project_id)
    except AppError:
        raise not_found("Version not found.") from None
    return access, version


def load_comment(db: Session, user: User, comment_id: uuid.UUID) -> tuple[Access, Comment]:
    comment = db.get(Comment, comment_id)
    if comment is None:
        raise not_found("Comment not found.")
    try:
        access = load_access(db, user, comment.project_id)
    except AppError:
        raise not_found("Comment not found.") from None
    return access, comment
