"""Consistent error responses: {"error": {"code": ..., "message": ...}}.

Internal exception text never reaches the client.
"""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("app.errors")


class AppError(Exception):
    def __init__(
        self, status: int, code: str, message: str, extra: dict | None = None
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


def not_found(what: str = "Not found") -> AppError:
    # Used for both "does not exist" and "you may not see it", so IDs cannot be
    # probed to discover which projects exist.
    return AppError(404, "not_found", what)


def forbidden(message: str = "You do not have permission to do that.") -> AppError:
    return AppError(403, "forbidden", message)


def bad_request(message: str, code: str = "bad_request") -> AppError:
    return AppError(400, code, message)


def conflict(message: str, code: str = "conflict", extra: dict | None = None) -> AppError:
    return AppError(409, code, message, extra)


def _body(code: str, message: str, extra: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, **(extra or {})}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(_body(exc.code, exc.message, exc.extra), status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(
            _body("http_error", message), status_code=exc.status_code, headers=exc.headers
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        fields = []
        for err in exc.errors():
            loc = [str(p) for p in err.get("loc", []) if p not in ("body", "query", "path")]
            fields.append({"field": ".".join(loc), "message": err.get("msg", "Invalid value")})
        first = fields[0] if fields else None
        message = (
            f"{first['field']}: {first['message']}" if first and first["field"] else
            (first["message"] if first else "Invalid request.")
        )
        return JSONResponse(
            _body("validation_error", message, {"fields": fields}), status_code=422
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(
            _body("internal_error", "Something went wrong. Please try again."),
            status_code=500,
        )
