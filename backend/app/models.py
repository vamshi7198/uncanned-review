"""Database schema.

Integrity rules are enforced by the database, not only by the API:

* composite foreign keys tie a comment to a version *of the same project*, and
  a reply to a parent comment *on the same version*;
* version numbers are unique per project;
* a user can be a member of a project only once.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

ROLES = ("admin", "reviewer", "editor")
PROJECT_ROLES = ("reviewer", "editor")
APPROVAL_STATES = ("in_review", "changes_requested", "approved")
DECISIONS = ("approved", "changes_requested")
UPLOAD_STATES = ("uploading", "completed", "cancelled", "expired")


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _in(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({quoted})"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint(_in("role", ROLES), name="ck_users_role"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AuthSession(TimestampMixin, Base):
    """A revocable login session. Only a hash of the cookie token is stored."""

    __tablename__ = "auth_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(lazy="joined")


class Project(TimestampMixin, Base):
    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ProjectMembership(TimestampMixin, Base):
    __tablename__ = "project_memberships"
    __table_args__ = (
        UniqueConstraint("project_id", "user_id", name="uq_membership_project_user"),
        CheckConstraint(_in("role", PROJECT_ROLES), name="ck_membership_role"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    # Reviewers approve by default; an admin can make a reviewer comment-only.
    can_approve: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    user: Mapped[User] = relationship(lazy="joined")


class VideoVersion(TimestampMixin, Base):
    __tablename__ = "video_versions"
    __table_args__ = (
        UniqueConstraint("project_id", "version_number", name="uq_version_number"),
        # Target for composite foreign keys from comments and approvals.
        UniqueConstraint("id", "project_id", name="uq_version_id_project"),
        CheckConstraint("version_number > 0", name="ck_version_number_positive"),
        CheckConstraint("size_bytes >= 0", name="ck_version_size"),
        CheckConstraint(_in("approval_status", APPROVAL_STATES), name="ck_version_approval"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="RESTRICT"), nullable=False
    )
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    thumbnail_key: Mapped[str | None] = mapped_column(String(255))
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    frame_rate: Mapped[float | None] = mapped_column(Float)
    variable_frame_rate: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    video_codec: Mapped[str | None] = mapped_column(String(50))
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ready", nullable=False)
    approval_status: Mapped[str] = mapped_column(
        String(30), default="in_review", nullable=False
    )

    uploader: Mapped[User | None] = relationship(lazy="joined")


class Comment(TimestampMixin, Base):
    __tablename__ = "comments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["version_id", "project_id"],
            ["video_versions.id", "video_versions.project_id"],
            name="fk_comment_version_project",
            ondelete="CASCADE",
        ),
        # A reply must sit on the same version as its parent.
        ForeignKeyConstraint(
            ["parent_id", "version_id"],
            ["comments.id", "comments.version_id"],
            name="fk_comment_parent_same_version",
            ondelete="CASCADE",
        ),
        UniqueConstraint("id", "version_id", name="uq_comment_id_version"),
        CheckConstraint(
            "timestamp_ms IS NULL OR timestamp_ms >= 0", name="ck_comment_timestamp"
        ),
        Index("ix_comments_version_ts", "version_id", "timestamp_ms"),
        Index("ix_comments_parent", "parent_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    author_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    # Milliseconds from the start of the video. NULL means a general comment.
    timestamp_ms: Mapped[int | None] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    annotation: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Soft delete: the row stays so replies and history keep their context.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    author: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[author_id])


class Approval(TimestampMixin, Base):
    """One review decision. Rows are append-only history."""

    __tablename__ = "approvals"
    __table_args__ = (
        ForeignKeyConstraint(
            ["version_id", "project_id"],
            ["video_versions.id", "video_versions.project_id"],
            name="fk_approval_version_project",
            ondelete="CASCADE",
        ),
        CheckConstraint(_in("decision", DECISIONS), name="ck_approval_decision"),
        Index("ix_approvals_version", "version_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    reviewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    decision: Mapped[str] = mapped_column(String(30), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)

    reviewer: Mapped[User | None] = relationship(lazy="joined")


class Activity(TimestampMixin, Base):
    __tablename__ = "activities"
    __table_args__ = (Index("ix_activities_project_created", "project_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, nullable=False)

    actor: Mapped[User | None] = relationship(lazy="joined")


class UploadSession(TimestampMixin, Base):
    """A chunked upload in progress. Becomes a VideoVersion only on finalize."""

    __tablename__ = "upload_sessions"
    __table_args__ = (
        CheckConstraint(_in("status", UPLOAD_STATES), name="ck_upload_status"),
        CheckConstraint("received_bytes <= expected_size", name="ck_upload_received"),
        Index("ix_upload_sessions_status_expires", "status", "expires_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    initiated_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    expected_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    received_bytes: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="uploading", nullable=False)
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("video_versions.id", ondelete="SET NULL")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
