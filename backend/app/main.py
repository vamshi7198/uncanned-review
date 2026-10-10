import asyncio
import contextlib
import hmac
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from sqlalchemy import text

from . import probe, storage
from .config import get_settings
from .db import engine
from .errors import install_error_handlers
from .routers import auth, comments, projects, uploads, users, versions
from .security import CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Reachable without a session, so there is no CSRF token yet.
CSRF_EXEMPT = {"/api/auth/login", "/api/setup"}


async def _cleanup_loop() -> None:
    while True:
        try:
            await run_in_threadpool(uploads.cleanup_expired_uploads)
        except Exception:
            log.exception("Upload cleanup failed")
        await asyncio.sleep(3600)


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    storage.ensure_dirs()
    if not probe.available():
        log.warning("ffprobe not found: duration, frame rate and thumbnails will be unavailable")
    task = asyncio.create_task(_cleanup_loop())
    yield
    task.cancel()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title=f"{s.app_name} API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None if s.is_production else "/api/docs",
        redoc_url=None,
        openapi_url=None if s.is_production else "/api/openapi.json",
    )
    install_error_handlers(app)

    @app.middleware("http")
    async def csrf_and_headers(request: Request, call_next):
        if (
            request.method in UNSAFE_METHODS
            and request.url.path.startswith("/api/")
            and request.url.path not in CSRF_EXEMPT
            and request.cookies.get(SESSION_COOKIE)
        ):
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not header or not hmac.compare_digest(cookie, header):
                return JSONResponse(
                    {"error": {"code": "csrf_failed",
                               "message": "Your session expired. Refresh the page and try again."}},
                    status_code=403,
                )
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        if request.url.path.startswith("/api/") and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "no-store"
        return response

    for r in (auth, users, projects, uploads, versions, comments):
        app.include_router(r.router)

    @app.get("/api/health", tags=["health"])
    def health() -> JSONResponse:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            db_ok = False
        media_ok = storage.root().is_dir()
        ok = db_ok and media_ok
        return JSONResponse(
            {"status": "ok" if ok else "degraded", "database": db_ok, "media": media_ok,
             "ffmpeg": probe.available()},
            status_code=200 if ok else 503,
        )

    return app


app = create_app()
