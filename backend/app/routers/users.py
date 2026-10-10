import uuid

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from ..deps import DB, AdminUser, CurrentUser
from ..errors import bad_request, conflict, not_found
from ..models import User
from ..schemas import UserBrief, UserCreate, UserOut, UserUpdate
from ..security import destroy_user_sessions, hash_password, password_problem

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(_: AdminUser, db: DB) -> list[User]:
    return list(db.scalars(select(User).order_by(User.is_active.desc(), User.display_name)))


@router.get("/directory", response_model=list[UserBrief])
def directory(user: CurrentUser, db: DB) -> list[User]:
    """Active users, for choosing project members. Admin only."""
    if user.role != "admin":
        return []
    return list(db.scalars(select(User).where(User.is_active).order_by(User.display_name)))


@router.post("", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, _: AdminUser, db: DB) -> User:
    if problem := password_problem(body.password):
        raise bad_request(problem, "weak_password")
    email = str(body.email).lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise conflict("A user with this email already exists.", "email_taken")
    user = User(
        email=email,
        display_name=body.display_name,
        role=body.role,
        password_hash=hash_password(body.password),
        # The admin chose this password, so the user should replace it.
        must_change_password=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise conflict("A user with this email already exists.", "email_taken") from None
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: uuid.UUID, body: UserUpdate, admin: AdminUser, db: DB) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise not_found("User not found.")

    demoting_self = user.id == admin.id and (
        (body.role is not None and body.role != "admin") or body.is_active is False
    )
    if demoting_self:
        raise bad_request("You cannot remove your own administrator access.")

    if body.display_name is not None:
        user.display_name = body.display_name.strip()
    if body.role is not None:
        user.role = body.role
    if body.password:
        if problem := password_problem(body.password):
            raise bad_request(problem, "weak_password")
        user.password_hash = hash_password(body.password)
        user.must_change_password = True
        destroy_user_sessions(db, user.id)
    if body.is_active is not None:
        user.is_active = body.is_active
        if not body.is_active:
            destroy_user_sessions(db, user.id)
    db.commit()
    return user


@router.post("/{user_id}/disable", response_model=UserOut)
def disable_user(user_id: uuid.UUID, admin: AdminUser, db: DB) -> User:
    return update_user(user_id, UserUpdate(is_active=False), admin, db)
