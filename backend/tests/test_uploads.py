import threading
from pathlib import Path

import pytest

from app.config import get_settings
from conftest import HAS_FFMPEG, upload_video, video_bytes


def _start(api, pid, data, filename="reel.mp4", notes=""):
    r = api.post(f"/api/projects/{pid}/uploads", json={"filename": filename, "size": len(data), "notes": notes})
    assert r.status_code == 201, r.text
    return r.json()


def _put(api, up, offset, part):
    return api.put(f"/api/uploads/{up['id']}/chunk?offset={offset}", content=part,
                   headers={"Content-Type": "application/octet-stream"})


def test_editor_uploads_and_version_is_created(project, editor):
    data = video_bytes()
    v = upload_video(editor, project["id"], data, notes="First cut")
    assert v["version_number"] == 1
    assert v["is_latest"] is True
    assert v["approval_status"] == "in_review"
    assert v["size_bytes"] == len(data)
    assert v["original_filename"] == "reel-v1.mp4"
    assert v["notes"] == "First cut"
    assert v["content_type"] == "video/mp4"
    assert len(v["checksum_sha256"]) == 64
    if HAS_FFMPEG:
        assert v["frame_rate"] == pytest.approx(25)
        assert v["duration_ms"] == pytest.approx(20000, abs=100)
        assert v["video_codec"] == "h264"
        assert v["has_thumbnail"] is True


def test_reviewer_cannot_upload(project, reviewer):
    r = reviewer.post(f"/api/projects/{project['id']}/uploads", json={"filename": "a.mp4", "size": 100})
    assert r.status_code == 403


def test_rejects_unsupported_extension_and_oversize(project, editor):
    r = editor.post(f"/api/projects/{project['id']}/uploads", json={"filename": "evil.html", "size": 10})
    assert r.status_code == 400 and r.json()["error"]["code"] == "unsupported_type"
    r = editor.post(f"/api/projects/{project['id']}/uploads",
                    json={"filename": "big.mp4", "size": get_settings().max_upload_bytes + 1})
    assert r.status_code == 413


def test_rejects_file_that_is_not_really_a_video(project, editor):
    data = b"<html><script>alert(1)</script></html>" * 10
    up = _start(editor, project["id"], data, filename="sneaky.mp4")
    assert _put(editor, up, 0, data).status_code == 200
    r = editor.post(f"/api/uploads/{up['id']}/finalize")
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_video"
    assert editor.get(f"/api/projects/{project['id']}/versions").json() == []
    # Temporary file removed.
    assert list((get_settings().media_root / "tmp").iterdir()) == []


def test_incomplete_upload_cannot_be_finalized(project, editor):
    data = video_bytes()
    up = _start(editor, project["id"], data)
    _put(editor, up, 0, data[: up["chunk_size"]])
    r = editor.post(f"/api/uploads/{up['id']}/finalize")
    assert r.status_code == 409 and r.json()["error"]["code"] == "upload_incomplete"
    assert editor.get(f"/api/projects/{project['id']}/versions").json() == []


def test_wrong_offset_is_refused_and_resume_works(project, editor):
    data = video_bytes()
    up = _start(editor, project["id"], data)
    chunk = up["chunk_size"]
    assert _put(editor, up, 0, data[:chunk]).status_code == 200
    # Skipping ahead is refused, and the server says where to resume.
    r = _put(editor, up, chunk * 2, data[chunk * 2: chunk * 3])
    assert r.status_code == 409
    assert r.json()["error"]["received_bytes"] == chunk
    # Resending an already-stored chunk is also refused.
    assert _put(editor, up, 0, data[:chunk]).status_code == 409
    # Resume from the reported position.
    status = editor.get(f"/api/uploads/{up['id']}").json()
    offset = status["received_bytes"]
    while offset < len(data):
        offset = _put(editor, up, offset, data[offset: offset + chunk]).json()["received_bytes"]
    r = editor.post(f"/api/uploads/{up['id']}/finalize")
    assert r.status_code == 200
    stored = get_settings().media_root
    path = next((stored / "videos" / project["id"]).iterdir())
    assert path.read_bytes() == data


def test_oversized_chunk_rejected(project, editor):
    data = video_bytes()
    up = _start(editor, project["id"], data)
    r = _put(editor, up, 0, data[: up["chunk_size"] + 1])
    assert r.status_code == 413


def test_finalize_is_idempotent(project, editor):
    data = video_bytes()
    up = _start(editor, project["id"], data)
    offset = 0
    while offset < len(data):
        offset = _put(editor, up, offset, data[offset: offset + up["chunk_size"]]).json()["received_bytes"]
    first = editor.post(f"/api/uploads/{up['id']}/finalize").json()
    second = editor.post(f"/api/uploads/{up['id']}/finalize").json()
    assert first["id"] == second["id"]
    assert len(editor.get(f"/api/projects/{project['id']}/versions").json()) == 1


def test_cancel_removes_temp_file(project, editor):
    data = video_bytes()
    up = _start(editor, project["id"], data)
    _put(editor, up, 0, data[: up["chunk_size"]])
    assert editor.delete(f"/api/uploads/{up['id']}").status_code == 204
    assert not (get_settings().media_root / "tmp" / f"{up['id']}.part").exists()
    assert _put(editor, up, up["chunk_size"], b"x").status_code == 409


def test_stored_path_uses_generated_name_not_user_filename(project, editor):
    v = upload_video(editor, project["id"], video_bytes(), filename="../../etc/passwd.mp4")
    assert v["original_filename"] == "passwd.mp4"
    files = list((get_settings().media_root / "videos" / project["id"]).iterdir())
    assert len(files) == 1 and "passwd" not in files[0].name
    assert "storage_key" not in str(v) and "/data/" not in str(v)


def test_concurrent_uploads_get_distinct_version_numbers(project, editor_user):
    from conftest import Api

    data = video_bytes()
    results: list[int] = []
    errors: list[Exception] = []

    def run():
        try:
            api = Api().login(editor_user.email)
            results.append(upload_video(api, project["id"], data)["version_number"])
        except Exception as e:  # pragma: no cover - surfaced below
            errors.append(e)

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert sorted(results) == [1, 2, 3, 4]


def test_expired_upload_cleanup(project, editor):
    from datetime import timedelta

    from app.db import SessionLocal
    from app.models import UploadSession
    from app.routers.uploads import cleanup_expired_uploads
    from app.security import now

    data = video_bytes()
    up = _start(editor, project["id"], data)
    with SessionLocal() as db:
        db.get(UploadSession, up["id"]).expires_at = now() - timedelta(minutes=1)
        db.commit()
    assert cleanup_expired_uploads() >= 1
    assert editor.get(f"/api/uploads/{up['id']}").json()["status"] == "expired"
    assert not Path(get_settings().media_root / "tmp" / f"{up['id']}.part").exists()
