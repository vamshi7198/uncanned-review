import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Role = Literal["admin", "reviewer", "editor"]
ProjectRole = Literal["reviewer", "editor"]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------- users


class UserOut(Out):
    id: uuid.UUID
    email: str
    display_name: str
    role: Role
    is_active: bool
    must_change_password: bool
    created_at: datetime


class UserBrief(Out):
    id: uuid.UUID
    display_name: str
    email: str
    role: Role


class UserCreate(BaseModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    role: Role
    password: str = Field(min_length=1, max_length=256)

    @field_validator("display_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name is required")
        return v


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, max_length=256)


# ---------------------------------------------------------------------- auth


class LoginIn(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class SetupIn(BaseModel):
    token: str = Field(min_length=1, max_length=512)
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


class SessionOut(BaseModel):
    user: UserOut
    csrf_token: str


# ------------------------------------------------------------------ projects


class MemberIn(BaseModel):
    user_id: uuid.UUID
    role: ProjectRole
    can_approve: bool = True


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    members: list[MemberIn] = Field(default_factory=list, max_length=100)

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Project name is required")
        return v


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    is_archived: bool | None = None


class MembersIn(BaseModel):
    members: list[MemberIn] = Field(max_length=100)


class MemberOut(BaseModel):
    user: UserBrief
    role: ProjectRole
    can_approve: bool


class VersionOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    version_number: int
    original_filename: str
    content_type: str
    size_bytes: int
    checksum_sha256: str
    duration_ms: int | None
    frame_rate: float | None
    variable_frame_rate: bool
    width: int | None
    height: int | None
    video_codec: str | None
    playback_warning: str | None
    has_thumbnail: bool
    uploaded_by: UserBrief | None
    notes: str
    status: str
    approval_status: str
    is_latest: bool
    open_comments: int
    created_at: datetime


class ProjectSummary(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    is_archived: bool
    status: str
    latest_version: VersionOut | None
    version_count: int
    open_comments: int
    last_activity_at: datetime
    updated_at: datetime
    my_role: str | None


class ProjectDetail(ProjectSummary):
    members: list[MemberOut]
    versions: list[VersionOut]
    permissions: dict[str, bool]
    created_at: datetime


# ------------------------------------------------------------------ uploads


class UploadCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(gt=0)
    notes: str = Field(default="", max_length=5000)


class UploadOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    original_filename: str
    expected_size: int
    received_bytes: int
    status: str
    chunk_size: int
    version_id: uuid.UUID | None
    expires_at: datetime


# ----------------------------------------------------------------- comments


class Point(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)


class Shape(BaseModel):
    kind: Literal["arrow", "rect", "freehand"]
    points: list[Point] = Field(min_length=2, max_length=2000)


class Annotation(BaseModel):
    """Shapes drawn over the frame, in 0–1 coordinates of the video picture."""

    shapes: list[Shape] = Field(min_length=1, max_length=50)


class CommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    timestamp_ms: int | None = Field(default=None, ge=0, le=24 * 3600 * 1000)
    annotation: Annotation | None = None

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Comment cannot be empty")
        return v


class ReplyCreate(BaseModel):
    text: str = Field(min_length=1, max_length=5000)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Reply cannot be empty")
        return v


class CommentUpdate(BaseModel):
    text: str = Field(min_length=1, max_length=5000)

    @field_validator("text")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Comment cannot be empty")
        return v


class CommentOut(BaseModel):
    id: uuid.UUID
    version_id: uuid.UUID
    parent_id: uuid.UUID | None
    author: UserBrief | None
    timestamp_ms: int | None
    text: str
    annotation: dict[str, Any] | None
    is_resolved: bool
    resolved_by: UserBrief | None
    resolved_at: datetime | None
    is_deleted: bool
    is_edited: bool
    created_at: datetime
    updated_at: datetime
    replies: list["CommentOut"] = Field(default_factory=list)
    can_edit: bool = False
    can_delete: bool = False


# ------------------------------------------------------------------- review


class DecisionIn(BaseModel):
    note: str = Field(default="", max_length=5000)
    # Approving with open feedback needs an explicit confirmation.
    acknowledge_unresolved: bool = False


class ApprovalOut(BaseModel):
    id: uuid.UUID
    version_id: uuid.UUID
    version_number: int
    reviewer: UserBrief | None
    decision: str
    note: str
    created_at: datetime


class ActivityOut(BaseModel):
    id: uuid.UUID
    actor: UserBrief | None
    event_type: str
    entity_type: str
    entity_id: uuid.UUID | None
    data: dict[str, Any]
    created_at: datetime


class Page(BaseModel):
    items: list[Any]
    next_cursor: str | None = None
