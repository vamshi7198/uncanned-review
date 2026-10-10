"""Comments, replies, resolution, version isolation and approvals."""

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal
from app.models import Comment, VideoVersion
from conftest import upload_video, video_bytes


@pytest.fixture
def v1(project, editor):
    return upload_video(editor, project["id"], video_bytes(), filename="reel-v1.mp4")


def _comment(api, vid, text, ts=None, **extra):
    r = api.post(f"/api/versions/{vid}/comments", json={"text": text, "timestamp_ms": ts, **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_timestamped_comment_keeps_exact_milliseconds(v1, reviewer):
    c = _comment(reviewer, v1["id"], "Move the logo slightly higher.", 12400)
    assert c["timestamp_ms"] == 12400
    listed = reviewer.get(f"/api/versions/{v1['id']}/comments").json()
    assert listed[0]["timestamp_ms"] == 12400
    assert listed[0]["author"]["email"] == "reviewer@example.com"


def test_comments_ordered_by_timestamp_with_general_last(v1, reviewer):
    _comment(reviewer, v1["id"], "general note")
    _comment(reviewer, v1["id"], "later", 18200)
    _comment(reviewer, v1["id"], "earlier", 12400)
    texts = [c["text"] for c in reviewer.get(f"/api/versions/{v1['id']}/comments").json()]
    assert texts == ["earlier", "later", "general note"]


def test_comment_validation(v1, reviewer):
    vid = v1["id"]
    assert reviewer.post(f"/api/versions/{vid}/comments", json={"text": "   "}).status_code == 422
    assert reviewer.post(f"/api/versions/{vid}/comments", json={"text": "x", "timestamp_ms": -5}).status_code == 422
    r = reviewer.post(f"/api/versions/{vid}/comments", json={
        "text": "x", "annotation": {"shapes": [{"kind": "rect", "points": [{"x": 0.1, "y": 0.1}, {"x": 0.5, "y": 0.5}]}]}})
    assert r.status_code == 400  # a drawing needs a timestamp
    r = reviewer.post(f"/api/versions/{vid}/comments", json={
        "text": "x", "timestamp_ms": 1000,
        "annotation": {"shapes": [{"kind": "rect", "points": [{"x": 1.5, "y": 0.1}, {"x": 0.5, "y": 0.5}]}]}})
    assert r.status_code == 422  # coordinates are normalised 0–1


def test_annotation_round_trips(v1, reviewer):
    shape = {"kind": "arrow", "points": [{"x": 0.25, "y": 0.75}, {"x": 0.5, "y": 0.5}]}
    c = _comment(reviewer, v1["id"], "This", 5000, annotation={"shapes": [shape]})
    assert c["annotation"] == {"shapes": [shape]}


def test_editor_replies_and_thread_stays_one_level(v1, reviewer, editor):
    c = _comment(reviewer, v1["id"], "Reduce the orange saturation.", 18200)
    r = editor.post(f"/api/comments/{c['id']}/replies", json={"text": "Fixed in V2."})
    assert r.status_code == 201
    reply = r.json()["replies"][0]
    assert reply["text"] == "Fixed in V2." and reply["parent_id"] == c["id"]
    # Replying to a reply joins the original thread.
    r2 = reviewer.post(f"/api/comments/{reply['id']}/replies", json={"text": "Thanks"})
    assert [x["text"] for x in r2.json()["replies"]] == ["Fixed in V2.", "Thanks"]


def test_resolve_and_reopen_permissions(v1, reviewer, editor):
    c = _comment(reviewer, v1["id"], "Fix", 1000)
    assert editor.post(f"/api/comments/{c['id']}/resolve").status_code == 403
    r = reviewer.post(f"/api/comments/{c['id']}/resolve")
    assert r.status_code == 200 and r.json()["is_resolved"] is True
    assert r.json()["resolved_by"]["email"] == "reviewer@example.com"
    # Persisted, still listed.
    listed = reviewer.get(f"/api/versions/{v1['id']}/comments").json()
    assert listed[0]["is_resolved"] is True
    r = reviewer.post(f"/api/comments/{c['id']}/reopen")
    assert r.json()["is_resolved"] is False and r.json()["resolved_by"] is None


def test_edit_and_delete_rules(v1, reviewer, editor, admin):
    c = _comment(reviewer, v1["id"], "Original", 1000)
    assert editor.patch(f"/api/comments/{c['id']}", json={"text": "hijack"}).status_code == 403
    r = reviewer.patch(f"/api/comments/{c['id']}", json={"text": "Edited"})
    assert r.status_code == 200 and r.json()["text"] == "Edited"
    assert editor.delete(f"/api/comments/{c['id']}").status_code == 403

    editor.post(f"/api/comments/{c['id']}/replies", json={"text": "On it"})
    r = admin.delete(f"/api/comments/{c['id']}")
    assert r.status_code == 200 and r.json()["is_deleted"] is True
    listed = reviewer.get(f"/api/versions/{v1['id']}/comments").json()
    # Kept because it has a reply; text hidden.
    assert listed[0]["is_deleted"] is True and listed[0]["text"] == ""
    assert listed[0]["replies"][0]["text"] == "On it"

    lonely = _comment(reviewer, v1["id"], "Delete me")
    reviewer.delete(f"/api/comments/{lonely['id']}")
    assert all(x["id"] != lonely["id"] for x in reviewer.get(f"/api/versions/{v1['id']}/comments").json())


def test_new_version_keeps_comments_isolated(project, v1, reviewer, editor):
    _comment(reviewer, v1["id"], "Move the logo slightly higher.", 12400)
    v2 = upload_video(editor, project["id"], video_bytes(), filename="reel-v2.mp4", notes="Updated logo and color.")
    assert v2["version_number"] == 2 and v2["is_latest"] is True
    assert reviewer.get(f"/api/versions/{v2['id']}/comments").json() == []
    assert len(reviewer.get(f"/api/versions/{v1['id']}/comments").json()) == 1
    v1_now = reviewer.get(f"/api/versions/{v1['id']}").json()
    assert v1_now["is_latest"] is False


def test_database_rejects_reply_on_other_version(project, v1, reviewer, editor):
    c = _comment(reviewer, v1["id"], "On v1", 1000)
    v2 = upload_video(editor, project["id"], video_bytes(), filename="reel-v2.mp4")
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(Comment(project_id=project["id"], version_id=v2["id"], parent_id=c["id"], text="cross"))
        db.commit()


def test_database_rejects_comment_with_mismatched_project(admin, project, v1):
    other = admin.post("/api/projects", json={"name": "Other"}).json()
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(Comment(project_id=other["id"], version_id=v1["id"], text="wrong project"))
        db.commit()


def test_database_rejects_duplicate_version_number(project, v1):
    with SessionLocal() as db, pytest.raises(IntegrityError):
        db.add(VideoVersion(project_id=project["id"], version_number=1, storage_key="x/y.mp4",
                            original_filename="a.mp4", content_type="video/mp4", size_bytes=1,
                            checksum_sha256="0" * 64))
        db.commit()


def test_request_changes_then_approve_new_version(project, v1, reviewer, editor, admin):
    _comment(reviewer, v1["id"], "Fix logo", 12400)
    r = reviewer.post(f"/api/versions/{v1['id']}/request-changes", json={"note": "See comments"})
    assert r.status_code == 200 and r.json()["approval_status"] == "changes_requested"
    assert admin.get(f"/api/projects/{project['id']}").json()["status"] == "changes_requested"

    v2 = upload_video(editor, project["id"], video_bytes(), filename="reel-v2.mp4")
    assert v2["approval_status"] == "in_review"  # never inherits a decision
    assert admin.get(f"/api/projects/{project['id']}").json()["status"] == "in_review"

    # Old versions cannot be decided any more.
    r = reviewer.post(f"/api/versions/{v1['id']}/approve", json={"acknowledge_unresolved": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_latest"

    r = reviewer.post(f"/api/versions/{v2['id']}/approve", json={})
    assert r.status_code == 200 and r.json()["approval_status"] == "approved"
    detail = admin.get(f"/api/projects/{project['id']}").json()
    assert detail["status"] == "approved"
    history = admin.get(f"/api/projects/{project['id']}/approvals").json()
    assert [(h["version_number"], h["decision"]) for h in history] == [
        (2, "approved"), (1, "changes_requested")]
    assert history[0]["reviewer"]["email"] == "reviewer@example.com"

    # A further upload resets review, but the approval history for V2 remains.
    v3 = upload_video(editor, project["id"], video_bytes(), filename="reel-v3.mp4")
    assert v3["approval_status"] == "in_review"
    assert admin.get(f"/api/versions/{v2['id']}").json()["approval_status"] == "approved"


def test_approval_blocked_by_unresolved_feedback_unless_confirmed(v1, reviewer):
    c = _comment(reviewer, v1["id"], "Still open", 1000)
    r = reviewer.post(f"/api/versions/{v1['id']}/approve", json={})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "unresolved_feedback"
    assert r.json()["error"]["unresolved"] == 1
    reviewer.post(f"/api/comments/{c['id']}/resolve")
    assert reviewer.post(f"/api/versions/{v1['id']}/approve", json={}).status_code == 200


def test_approve_anyway_with_acknowledgement(v1, reviewer):
    _comment(reviewer, v1["id"], "Minor", 1000)
    r = reviewer.post(f"/api/versions/{v1['id']}/approve", json={"acknowledge_unresolved": True})
    assert r.status_code == 200


def test_only_approving_reviewers_decide(project, v1, editor, admin, reviewer, reviewer_user):
    assert editor.post(f"/api/versions/{v1['id']}/approve", json={}).status_code == 403
    assert editor.post(f"/api/versions/{v1['id']}/request-changes", json={}).status_code == 403
    admin.put(f"/api/projects/{project['id']}/members", json={"members": [
        {"user_id": str(reviewer_user.id), "role": "reviewer", "can_approve": False}]})
    assert reviewer.post(f"/api/versions/{v1['id']}/approve", json={}).status_code == 403
    # Still able to comment.
    assert reviewer.post(f"/api/versions/{v1['id']}/comments", json={"text": "ok"}).status_code == 201


def test_repeated_decision_is_rejected(v1, reviewer):
    reviewer.post(f"/api/versions/{v1['id']}/request-changes", json={})
    r = reviewer.post(f"/api/versions/{v1['id']}/request-changes", json={})
    assert r.status_code == 409


def test_open_comment_counts(project, v1, reviewer, admin):
    a = _comment(reviewer, v1["id"], "a", 1000)
    _comment(reviewer, v1["id"], "b", 2000)
    reviewer.post(f"/api/comments/{a['id']}/replies", json={"text": "reply doesn't count"})
    reviewer.post(f"/api/comments/{a['id']}/resolve")
    detail = admin.get(f"/api/projects/{project['id']}").json()
    assert detail["open_comments"] == 1
    assert detail["versions"][0]["open_comments"] == 1
    assert admin.get("/api/projects").json()["items"][0]["open_comments"] == 1
