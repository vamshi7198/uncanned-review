from conftest import Api, upload_video, video_bytes


def test_media_streams_full_file_with_correct_headers(project, editor, reviewer):
    data = video_bytes()
    v = upload_video(editor, project["id"], data)
    r = reviewer.get(f"/api/versions/{v['id']}/media")
    assert r.status_code == 200
    assert r.content == data
    assert r.headers["content-type"] == "video/mp4"
    assert r.headers["accept-ranges"] == "bytes"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("inline")


def test_range_request_returns_partial_content(project, editor, reviewer):
    data = video_bytes()
    v = upload_video(editor, project["id"], data)
    r = reviewer.get(f"/api/versions/{v['id']}/media", headers={"Range": "bytes=100-1099"})
    assert r.status_code == 206
    assert r.content == data[100:1100]
    assert r.headers["content-range"] == f"bytes 100-1099/{len(data)}"
    assert r.headers["content-length"] == "1000"

    tail = reviewer.get(f"/api/versions/{v['id']}/media", headers={"Range": "bytes=-500"})
    assert tail.status_code == 206 and tail.content == data[-500:]

    bad = reviewer.get(f"/api/versions/{v['id']}/media", headers={"Range": f"bytes={len(data) + 10}-"})
    assert bad.status_code == 416


def test_download_uses_original_filename(project, editor, reviewer):
    v = upload_video(editor, project["id"], video_bytes(), filename="Mango Blaze – final.mp4")
    r = reviewer.get(f"/api/versions/{v['id']}/download")
    assert r.status_code == 200
    assert r.headers["content-disposition"].startswith("attachment")
    assert "filename*=UTF-8''Mango%20Blaze%20%E2%80%93%20final.mp4" in r.headers["content-disposition"]


def test_media_requires_authentication(project, editor):
    v = upload_video(editor, project["id"], video_bytes())
    assert Api().get(f"/api/versions/{v['id']}/media").status_code == 401


def test_files_survive_a_fresh_app_instance(project, editor):
    """Persistence: data lives in Postgres and the media directory, not process memory."""
    data = video_bytes()
    v = upload_video(editor, project["id"], data)
    fresh = Api().login("editor@example.com")
    assert fresh.get(f"/api/versions/{v['id']}/media").content == data
