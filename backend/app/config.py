from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration, read from environment variables.

    Nothing here has a production-safe default for a secret: the database URL
    and bootstrap token must be supplied by the deployment.
    """

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_name: str = "Uncanned Review"
    environment: str = "development"

    database_url: str = "postgresql+psycopg://review:review@localhost:5432/review"

    # Video binaries live here, never in the database.
    media_root: Path = Path("/data/media")

    max_upload_bytes: int = 10 * 1024**3  # 10 GiB
    upload_chunk_bytes: int = 8 * 1024**2  # 8 MiB per request
    upload_session_ttl_hours: int = 48

    session_ttl_hours: int = 24 * 14
    cookie_secure: bool = False

    # Required for the web first-run setup. Empty disables the web flow; the
    # CLI (`python -m app.cli create-admin`) always works.
    bootstrap_token: str = ""

    login_max_failures: int = 10
    login_window_minutes: int = 15

    ffprobe_path: str = "ffprobe"
    ffmpeg_path: str = "ffmpeg"

    allowed_extensions: list[str] = Field(
        default_factory=lambda: ["mp4", "mov", "m4v", "webm"]
    )

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
