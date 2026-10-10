"""Passwords, sessions, CSRF and login rate limiting."""

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete
from sqlalchemy.orm import Session

from .config import get_settings
from .models import AuthSession, User

SESSION_COOKIE = "ur_session"
CSRF_COOKIE = "ur_csrf"
CSRF_HEADER = "x-csrf-token"

MIN_PASSWORD_LENGTH = 10

_hasher = PasswordHasher()  # Argon2id with the library's current defaults

# A real hash to compare against when the email is unknown, so a failed login
# takes the same time whether or not the account exists.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and bool(password_hash)
    except (VerificationError, InvalidHashError):
        return False


def password_problem(password: str) -> str | None:
    if len(password) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
    if len(password) > 256:
        return "Password is too long."
    return None


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def now() -> datetime:
    return datetime.now(UTC)


def create_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            token_hash=_token_hash(token),
            user_id=user.id,
            expires_at=now() + timedelta(hours=get_settings().session_ttl_hours),
        )
    )
    return token


def resolve_session(db: Session, token: str | None) -> AuthSession | None:
    if not token or len(token) > 200:
        return None
    session = db.get(AuthSession, _token_hash(token))
    if session is None:
        return None
    if session.expires_at <= now() or not session.user.is_active:
        db.delete(session)
        db.commit()
        return None
    # Touch at most once a minute to avoid a write per request.
    if (now() - session.last_seen_at).total_seconds() > 60:
        session.last_seen_at = now()
        db.commit()
    return session


def destroy_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == _token_hash(token)))


def destroy_user_sessions(db: Session, user_id, keep_token: str | None = None) -> None:
    stmt = delete(AuthSession).where(AuthSession.user_id == user_id)
    if keep_token:
        stmt = stmt.where(AuthSession.token_hash != _token_hash(keep_token))
    db.execute(stmt)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


class LoginRateLimiter:
    """Sliding-window count of failed logins per client address and per email.

    In-process memory is sufficient because the backend runs a single worker;
    see README "Security considerations".
    """

    def __init__(self) -> None:
        self._failures: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key: str, window: float) -> deque[float]:
        q = self._failures[key]
        cutoff = time.monotonic() - window
        while q and q[0] < cutoff:
            q.popleft()
        return q

    def blocked(self, *keys: str) -> bool:
        s = get_settings()
        window = s.login_window_minutes * 60
        with self._lock:
            return any(len(self._prune(k, window)) >= s.login_max_failures for k in keys)

    def record_failure(self, *keys: str) -> None:
        with self._lock:
            for k in keys:
                self._failures[k].append(time.monotonic())

    def reset(self, *keys: str) -> None:
        with self._lock:
            for k in keys:
                self._failures.pop(k, None)

    def clear(self) -> None:
        with self._lock:
            self._failures.clear()


login_limiter = LoginRateLimiter()
