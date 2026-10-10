"""Video metadata and thumbnails via FFmpeg, when it is installed.

Both are best-effort: a video whose metadata cannot be read is still stored
and playable; it just lacks a duration, frame rate or thumbnail.
"""

import json
import logging
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path

from .config import get_settings

log = logging.getLogger("app.probe")

# Codecs that mainstream desktop browsers decode. HEVC plays in Safari and in
# some Chromium builds with hardware support, so it gets a softer warning.
BROWSER_CODECS = {"h264", "vp8", "vp9", "av1"}
SOMETIMES_CODECS = {"hevc"}


@dataclass
class VideoInfo:
    has_video: bool
    duration_ms: int | None = None
    frame_rate: float | None = None
    variable_frame_rate: bool = False
    width: int | None = None
    height: int | None = None
    codec: str | None = None


def available() -> bool:
    return shutil.which(get_settings().ffprobe_path) is not None


def _rate(value: str | None) -> float | None:
    try:
        r = Fraction(value) if value else None
    except (ValueError, ZeroDivisionError):
        return None
    if r is None or r <= 0 or r > 1000:
        return None
    return float(r)


def probe(path: Path) -> VideoInfo | None:
    """Returns None if ffprobe is unavailable or failed to run."""
    if not available():
        return None
    try:
        out = subprocess.run(
            [
                get_settings().ffprobe_path, "-v", "error", "-print_format", "json",
                "-show_streams", "-show_format", str(path),
            ],
            capture_output=True, timeout=120, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        log.warning("ffprobe failed to run", exc_info=True)
        return None
    if out.returncode != 0:
        return VideoInfo(has_video=False)
    try:
        data = json.loads(out.stdout or b"{}")
    except json.JSONDecodeError:
        return VideoInfo(has_video=False)

    video = next(
        (
            s for s in data.get("streams", [])
            if s.get("codec_type") == "video"
            and not s.get("disposition", {}).get("attached_pic")
        ),
        None,
    )
    if video is None:
        return VideoInfo(has_video=False)

    duration = video.get("duration") or data.get("format", {}).get("duration")
    try:
        duration_ms = round(float(duration) * 1000) if duration else None
    except ValueError:
        duration_ms = None

    real = _rate(video.get("r_frame_rate"))
    avg = _rate(video.get("avg_frame_rate"))
    fps = avg or real
    vfr = bool(real and avg and abs(real - avg) / real > 0.01)

    return VideoInfo(
        has_video=True,
        duration_ms=duration_ms,
        frame_rate=round(fps, 5) if fps else None,
        variable_frame_rate=vfr,
        width=video.get("width"),
        height=video.get("height"),
        codec=video.get("codec_name"),
    )


def make_thumbnail(src: Path, dest: Path, duration_ms: int | None) -> bool:
    s = get_settings()
    if shutil.which(s.ffmpeg_path) is None:
        return False
    at = 1.0 if not duration_ms else min(1.0, duration_ms / 2000)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        out = subprocess.run(
            [
                s.ffmpeg_path, "-v", "error", "-y", "-ss", f"{at:.3f}", "-i", str(src),
                "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(dest),
            ],
            capture_output=True, timeout=120, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        log.warning("Thumbnail generation failed", exc_info=True)
        return False
    return out.returncode == 0 and dest.exists() and dest.stat().st_size > 0


def playback_warning(codec: str | None) -> str | None:
    if not codec or codec in BROWSER_CODECS:
        return None
    if codec in SOMETIMES_CODECS:
        return (
            "This video is encoded as HEVC (H.265). It plays in Safari and some "
            "versions of Chrome and Edge, but not every browser. If it does not "
            "play, export as H.264 MP4."
        )
    return (
        f"This video is encoded as {codec.upper()}, which most browsers cannot "
        "play. Download it to review, or ask the editor to export H.264 MP4."
    )
