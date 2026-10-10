"""Media files on the local filesystem.

Paths are always built from server-generated identifiers. User-supplied
filenames are kept only as metadata and never touch the filesystem.
"""

import hashlib
import os
import uuid
from pathlib import Path

from .config import get_settings

TMP_DIR = "tmp"
VIDEO_DIR = "videos"
THUMB_DIR = "thumbnails"

_EBML_MAGIC = b"\x1a\x45\xdf\xa3"
_ISO_BOX_TYPES = {b"ftyp", b"moov", b"mdat", b"wide", b"free", b"skip", b"pnot"}


def root() -> Path:
    return get_settings().media_root


def ensure_dirs() -> None:
    for sub in (TMP_DIR, VIDEO_DIR, THUMB_DIR):
        (root() / sub).mkdir(parents=True, exist_ok=True)


def resolve(key: str) -> Path:
    """Absolute path for a storage key, refusing anything outside the root."""
    base = root().resolve()
    path = (base / key).resolve()
    if base not in path.parents:
        raise ValueError("Storage key escapes the media root")
    return path


def temp_key(upload_id: uuid.UUID) -> str:
    return f"{TMP_DIR}/{upload_id}.part"


def video_key(project_id: uuid.UUID, ext: str) -> str:
    return f"{VIDEO_DIR}/{project_id}/{uuid.uuid4()}.{ext}"


def thumbnail_key(project_id: uuid.UUID) -> str:
    return f"{THUMB_DIR}/{project_id}/{uuid.uuid4()}.jpg"


def extension_of(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def sniff_container(path: Path) -> tuple[str, str] | None:
    """Identify the container from its leading bytes.

    Returns (extension, MIME type), or None if the file is not a container we
    accept. The extension the user gave is not trusted.
    """
    with path.open("rb") as f:
        head = f.read(64)
    if head.startswith(_EBML_MAGIC):
        return "webm", "video/webm"
    if len(head) >= 12 and head[4:8] in _ISO_BOX_TYPES:
        if head[4:8] == b"ftyp":
            brand = head[8:12]
            if brand == b"qt  ":
                return "mov", "video/quicktime"
            return "mp4", "video/mp4"
        # Older QuickTime files can start with a box other than ftyp.
        return "mov", "video/quicktime"
    return None


def sha256_of(path: Path, block: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(block):
            digest.update(chunk)
    return digest.hexdigest()


def remove_quietly(path: Path) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
