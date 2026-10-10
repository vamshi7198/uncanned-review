import uuid

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import DB, Access, CurrentUser, load_comment, load_version
from ..errors import bad_request, forbidden
from ..models import Comment, User
from ..schemas import CommentCreate, CommentOut, CommentUpdate, ReplyCreate
from ..security import now
from ..services import brief, log_activity

router = APIRouter(prefix="/api", tags=["comments"])


def _out(c: Comment, user: User, resolvers: dict[uuid.UUID, User], replies=None) -> CommentOut:
    deleted = c.deleted_at is not None
    return CommentOut(
        id=c.id,
        version_id=c.version_id,
        parent_id=c.parent_id,
        author=brief(c.author),
        timestamp_ms=c.timestamp_ms,
        text="" if deleted else c.text,
        annotation=None if deleted else c.annotation,
        is_resolved=c.is_resolved,
        resolved_by=brief(resolvers.get(c.resolved_by)) if c.resolved_by else None,
        resolved_at=c.resolved_at,
        is_deleted=deleted,
        is_edited=(c.updated_at - c.created_at).total_seconds() > 1 and not deleted,
        created_at=c.created_at,
        updated_at=c.updated_at,
        replies=replies or [],
        can_edit=not deleted and c.author_id == user.id,
        can_delete=not deleted and (c.author_id == user.id or user.role == "admin"),
    )


def _thread(db: Session, user: User, comments: list[Comment]) -> list[CommentOut]:
    resolver_ids = {c.resolved_by for c in comments if c.resolved_by}
    resolvers = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(resolver_ids)))}
        if resolver_ids else {}
    )
    replies: dict[uuid.UUID, list[CommentOut]] = {}
    for c in comments:
        if c.parent_id:
            replies.setdefault(c.parent_id, []).append(_out(c, user, resolvers))
    top = [c for c in comments if c.parent_id is None]
    # Hide deleted comments that have nothing under them.
    top = [c for c in top if c.deleted_at is None or replies.get(c.id)]
    return [_out(c, user, resolvers, replies.get(c.id)) for c in top]


def _one(db: Session, user: User, comment: Comment) -> CommentOut:
    rows = db.scalars(
        select(Comment)
        .where((Comment.id == comment.id) | (Comment.parent_id == comment.id))
        .order_by(Comment.created_at)
    ).all()
    resolver_ids = {c.resolved_by for c in rows if c.resolved_by}
    resolvers = (
        {u.id: u for u in db.scalars(select(User).where(User.id.in_(resolver_ids)))}
        if resolver_ids else {}
    )
    replies = [_out(c, user, resolvers) for c in rows if c.parent_id == comment.id]
    return _out(comment, user, resolvers, replies)


@router.get("/versions/{version_id}/comments", response_model=list[CommentOut])
def list_comments(version_id: uuid.UUID, user: CurrentUser, db: DB) -> list[CommentOut]:
    _, version = load_version(db, user, version_id)
    rows = db.scalars(
        select(Comment)
        .where(Comment.version_id == version.id)
        # Timestamped feedback in playback order, general comments last.
        .order_by(Comment.timestamp_ms.asc().nulls_last(), Comment.created_at)
    ).all()
    return _thread(db, user, list(rows))


@router.post("/versions/{version_id}/comments", response_model=CommentOut, status_code=201)
def create_comment(
    version_id: uuid.UUID, body: CommentCreate, user: CurrentUser, db: DB
) -> CommentOut:
    access, version = load_version(db, user, version_id)
    if body.annotation is not None and body.timestamp_ms is None:
        raise bad_request("A drawing must be attached to a point in the video.")
    if (
        body.timestamp_ms is not None
        and version.duration_ms is not None
        and body.timestamp_ms > version.duration_ms + 1000
    ):
        raise bad_request("That time is beyond the end of the video.")

    comment = Comment(
        project_id=version.project_id,
        version_id=version.id,
        author_id=user.id,
        timestamp_ms=body.timestamp_ms,
        text=body.text,
        annotation=body.annotation.model_dump() if body.annotation else None,
    )
    db.add(comment)
    db.flush()
    log_activity(
        db, access.project, user, "comment_added", "comment", comment.id,
        {"version_number": version.version_number, "timestamp_ms": body.timestamp_ms,
         "excerpt": body.text[:140]},
    )
    db.commit()
    return _one(db, user, comment)


@router.post("/comments/{comment_id}/replies", response_model=CommentOut, status_code=201)
def reply(comment_id: uuid.UUID, body: ReplyCreate, user: CurrentUser, db: DB) -> CommentOut:
    access, parent = load_comment(db, user, comment_id)
    # Threads are one level deep: replying to a reply joins the same thread.
    if parent.parent_id is not None:
        _, parent = load_comment(db, user, parent.parent_id)
    if parent.deleted_at is not None:
        raise bad_request("You cannot reply to a deleted comment.")
    r = Comment(
        project_id=parent.project_id,
        version_id=parent.version_id,
        parent_id=parent.id,
        author_id=user.id,
        text=body.text,
    )
    db.add(r)
    db.flush()
    log_activity(
        db, access.project, user, "reply_added", "comment", parent.id, {"excerpt": body.text[:140]}
    )
    db.commit()
    return _one(db, user, parent)


@router.patch("/comments/{comment_id}", response_model=CommentOut)
def edit_comment(comment_id: uuid.UUID, body: CommentUpdate, user: CurrentUser, db: DB) -> CommentOut:
    _, comment = load_comment(db, user, comment_id)
    if comment.author_id != user.id:
        raise forbidden("You can only edit your own comments.")
    if comment.deleted_at is not None:
        raise bad_request("This comment was deleted.")
    comment.text = body.text
    comment.updated_at = now()
    db.commit()
    return _one(db, user, _top(db, user, comment))


@router.delete("/comments/{comment_id}", response_model=CommentOut)
def delete_comment(comment_id: uuid.UUID, user: CurrentUser, db: DB) -> CommentOut:
    access, comment = load_comment(db, user, comment_id)
    access.require(
        comment.author_id == user.id or access.is_admin,
        "Only the author or an administrator can delete a comment.",
    )
    if comment.deleted_at is None:
        # Soft delete keeps replies attached and the activity history accurate.
        comment.deleted_at = now()
        comment.updated_at = now()
        log_activity(db, access.project, user, "comment_deleted", "comment", comment.id)
        db.commit()
    return _one(db, user, _top(db, user, comment))


def _top(db: Session, user: User, comment: Comment) -> Comment:
    if comment.parent_id is None:
        return comment
    return load_comment(db, user, comment.parent_id)[1]


def _set_resolved(comment_id: uuid.UUID, resolved: bool, user: User, db: Session) -> CommentOut:
    access: Access
    access, comment = load_comment(db, user, comment_id)
    access.require(access.can_review, "Only reviewers can resolve or reopen feedback.")
    if comment.parent_id is not None:
        raise bad_request("Replies cannot be resolved on their own; resolve the comment instead.")
    if comment.deleted_at is not None:
        raise bad_request("This comment was deleted.")
    if comment.is_resolved != resolved:
        comment.is_resolved = resolved
        comment.resolved_by = user.id if resolved else None
        comment.resolved_at = now() if resolved else None
        log_activity(
            db, access.project, user, "comment_resolved" if resolved else "comment_reopened",
            "comment", comment.id, {"excerpt": comment.text[:140]},
        )
        db.commit()
    return _one(db, user, comment)


@router.post("/comments/{comment_id}/resolve", response_model=CommentOut)
def resolve(comment_id: uuid.UUID, user: CurrentUser, db: DB) -> CommentOut:
    return _set_resolved(comment_id, True, user, db)


@router.post("/comments/{comment_id}/reopen", response_model=CommentOut)
def reopen(comment_id: uuid.UUID, user: CurrentUser, db: DB) -> CommentOut:
    return _set_resolved(comment_id, False, user, db)
