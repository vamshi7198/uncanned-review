import hmac

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select

from ..config import get_settings
from ..deps import DB, CurrentUser
from ..errors import AppError, bad_request, conflict
from ..models import User
from ..schemas import ChangePasswordIn, LoginIn, SessionOut, SetupIn, UserOut
from ..security import (
    CSRF_COOKIE,
    SESSION_COOKIE,
    create_session,
    destroy_session,
    destroy_user_sessions,
    hash_password,
    login_limiter,
    new_csrf_token,
    password_problem,
    verify_password,
)

router = APIRouter(prefix="/api", tags=["auth"])


def _set_cookies(response: Response, token: str) -> str:
    s = get_settings()
    max_age = s.session_ttl_hours * 3600
    csrf = new_csrf_token()
    response.set_cookie(
        SESSION_COOKIE, token, max_age=max_age, httponly=True,
        secure=s.cookie_secure, samesite="lax", path="/",
    )
    # Readable by the page so it can echo the value in a header (double submit).
    response.set_cookie(
        CSRF_COOKIE, csrf, max_age=max_age, httponly=False,
        secure=s.cookie_secure, samesite="strict", path="/",
    )
    return csrf


def _clear_cookies(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.get("/config")
def public_config(db: DB) -> dict:
    """Branding and first-run state for the login page."""
    s = get_settings()
    has_users = (db.scalar(select(func.count()).select_from(User)) or 0) > 0
    return {
        "app_name": s.app_name,
        "needs_setup": not has_users,
        "setup_enabled": bool(s.bootstrap_token) and not has_users,
        "max_upload_bytes": s.max_upload_bytes,
        "allowed_extensions": s.allowed_extensions,
    }


@router.post("/auth/login", response_model=SessionOut)
def login(body: LoginIn, request: Request, response: Response, db: DB) -> SessionOut:
    email = body.email.strip().lower()
    keys = (f"ip:{_client_ip(request)}", f"email:{email}")
    if login_limiter.blocked(*keys):
        raise AppError(
            429, "rate_limited",
            "Too many failed sign-in attempts. Wait a few minutes and try again.",
        )

    user = db.scalar(select(User).where(func.lower(User.email) == email))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not user or not ok or not user.is_active:
        login_limiter.record_failure(*keys)
        raise AppError(401, "invalid_credentials", "Email or password is incorrect.")

    login_limiter.reset(f"email:{email}")
    token = create_session(db, user)
    db.commit()
    csrf = _set_cookies(response, token)
    return SessionOut(user=UserOut.model_validate(user), csrf_token=csrf)


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: DB) -> Response:
    destroy_session(db, request.cookies.get(SESSION_COOKIE))
    db.commit()
    response = Response(status_code=204)
    _clear_cookies(response)
    return response


@router.get("/auth/me", response_model=SessionOut)
def me(user: CurrentUser, request: Request, response: Response) -> SessionOut:
    csrf = request.cookies.get(CSRF_COOKIE)
    if not csrf:
        # Session survived but the CSRF cookie did not: issue a fresh one.
        csrf = new_csrf_token()
        s = get_settings()
        response.set_cookie(
            CSRF_COOKIE, csrf, max_age=s.session_ttl_hours * 3600, httponly=False,
            secure=s.cookie_secure, samesite="strict", path="/",
        )
    return SessionOut(user=UserOut.model_validate(user), csrf_token=csrf)


@router.post("/auth/change-password", response_model=UserOut)
def change_password(body: ChangePasswordIn, user: CurrentUser, request: Request, db: DB) -> UserOut:
    if not verify_password(user.password_hash, body.current_password):
        raise bad_request("Current password is incorrect.", "invalid_password")
    if problem := password_problem(body.new_password):
        raise bad_request(problem, "weak_password")
    if body.new_password == body.current_password:
        raise bad_request("Choose a password different from the current one.", "weak_password")
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    # Sign out every other device.
    destroy_user_sessions(db, user.id, keep_token=request.cookies.get(SESSION_COOKIE))
    db.commit()
    return UserOut.model_validate(user)


@router.post("/setup", response_model=SessionOut)
def first_run_setup(body: SetupIn, response: Response, db: DB) -> SessionOut:
    """Create the first administrator. Works only while no users exist."""
    s = get_settings()
    if not s.bootstrap_token:
        raise AppError(
            403, "setup_disabled",
            "Web setup is disabled. Set BOOTSTRAP_TOKEN or use the create-admin command.",
        )
    if not hmac.compare_digest(body.token.encode(), s.bootstrap_token.encode()):
        raise AppError(403, "invalid_token", "The setup token is incorrect.")
    if problem := password_problem(body.password):
        raise bad_request(problem, "weak_password")

    # Serialise concurrent setup attempts so only one admin can be created.
    db.execute(select(func.pg_advisory_xact_lock(7_311_001)))
    if (db.scalar(select(func.count()).select_from(User)) or 0) > 0:
        raise conflict("Setup has already been completed.", "already_setup")

    user = User(
        email=str(body.email).lower(),
        display_name=body.display_name.strip(),
        password_hash=hash_password(body.password),
        role="admin",
    )
    db.add(user)
    db.flush()
    token = create_session(db, user)
    db.commit()
    csrf = _set_cookies(response, token)
    return SessionOut(user=UserOut.model_validate(user), csrf_token=csrf)
