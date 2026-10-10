import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

# Configure before the app is imported.
_MEDIA = Path(tempfile.mkdtemp(prefix="ur-media-"))
os.environ.setdefault(
    "DATABASE_URL", "postgresql+psycopg://review:review_test@127.0.0.1:5544/review_test"
)
os.environ["MEDIA_ROOT"] = str(_MEDIA)
os.environ["BOOTSTRAP_TOKEN"] = "test-bootstrap-token"
os.environ["UPLOAD_CHUNK_BYTES"] = str(64 * 1024)
os.environ["MAX_UPLOAD_BYTES"] = str(50 * 1024 * 1024)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.security import hash_password, login_limiter  # noqa: E402

BACKEND = Path(__file__).resolve().parent.parent
PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    command.upgrade(cfg, "head")
    yield
    shutil.rmtree(_MEDIA, ignore_errors=True)


@pytest.fixture(autouse=True)
def _clean():
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE activities, approvals, comments, upload_sessions, video_versions, "
                "project_memberships, projects, auth_sessions, users CASCADE"
            )
        )
    login_limiter.clear()
    for sub in ("tmp", "videos", "thumbnails"):
        shutil.rmtree(_MEDIA / sub, ignore_errors=True)
        (_MEDIA / sub).mkdir(parents=True, exist_ok=True)
    yield


class Api:
    """A browser-like client: its own cookie jar, CSRF header added automatically."""

    def __init__(self) -> None:
        self.c = TestClient(app, raise_server_exceptions=False)

    def _headers(self, extra=None):
        h = dict(extra or {})
        token = self.c.cookies.get("ur_csrf")
        if token:
            h["X-CSRF-Token"] = token
        return h

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def post(self, url, json=None, headers=None, **kw):
        return self.c.post(url, json=json if json is not None else {}, headers=self._headers(headers), **kw)

    def put(self, url, headers=None, **kw):
        return self.c.put(url, headers=self._headers(headers), **kw)

    def patch(self, url, json=None, headers=None, **kw):
        return self.c.patch(url, json=json, headers=self._headers(headers), **kw)

    def delete(self, url, headers=None, **kw):
        return self.c.delete(url, headers=self._headers(headers), **kw)

    def login(self, email, password=PASSWORD):
        r = self.post("/api/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200, r.text
        return self


def make_user(email: str, role: str, *, active=True, name=None) -> User:
    with SessionLocal() as db:
        u = User(
            email=email, display_name=name or email.split("@")[0].title(), role=role,
            password_hash=hash_password(PASSWORD), is_active=active,
        )
        db.add(u)
        db.commit()
        return u


@pytest.fixture
def admin() -> Api:
    make_user("admin@example.com", "admin")
    return Api().login("admin@example.com")


@pytest.fixture
def editor_user() -> User:
    return make_user("editor@example.com", "editor")


@pytest.fixture
def reviewer_user() -> User:
    return make_user("reviewer@example.com", "reviewer")


@pytest.fixture
def editor(editor_user) -> Api:
    return Api().login(editor_user.email)


@pytest.fixture
def reviewer(reviewer_user) -> Api:
    return Api().login(reviewer_user.email)


@pytest.fixture
def project(admin, editor_user, reviewer_user) -> dict:
    r = admin.post(
        "/api/projects",
        json={
            "name": "Uncanned Instagram Reel",
            "description": "Mango Blaze launch reel",
            "members": [
                {"user_id": str(editor_user.id), "role": "editor"},
                {"user_id": str(reviewer_user.id), "role": "reviewer"},
            ],
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


_VIDEO_CACHE: dict[str, bytes] = {}


def video_bytes(seconds: int = 20) -> bytes:
    """A small real H.264 MP4 when FFmpeg is installed; otherwise a minimal
    ISO-BMFF header that passes container sniffing (metadata will be empty)."""
    key = str(seconds)
    if key in _VIDEO_CACHE:
        return _VIDEO_CACHE[key]
    ff = _ffmpeg()
    if ff:
        out = Path(tempfile.mkdtemp()) / "v.mp4"
        subprocess.run(
            [ff, "-v", "error", "-f", "lavfi", "-i",
             # A moving test pattern compresses poorly, so the file spans
             # several upload chunks like a real video would.
             f"testsrc2=s=320x180:r=25:d={seconds}", "-c:v", "libx264",
             "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)],
            check=True,
        )
        data = out.read_bytes()
    else:
        ftyp = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2"
        data = ftyp + os.urandom(200 * 1024)
    _VIDEO_CACHE[key] = data
    return data


def upload_video(api: Api, project_id: str, data: bytes, filename="reel-v1.mp4", notes="") -> dict:
    r = api.post(f"/api/projects/{project_id}/uploads",
                 json={"filename": filename, "size": len(data), "notes": notes})
    assert r.status_code == 201, r.text
    up = r.json()
    chunk = up["chunk_size"]
    offset = 0
    while offset < len(data):
        part = data[offset:offset + chunk]
        r = api.put(f"/api/uploads/{up['id']}/chunk?offset={offset}", content=part,
                    headers={"Content-Type": "application/octet-stream"})
        assert r.status_code == 200, r.text
        offset = r.json()["received_bytes"]
    r = api.post(f"/api/uploads/{up['id']}/finalize")
    assert r.status_code == 200, r.text
    return r.json()


HAS_FFMPEG = _ffmpeg() is not None
