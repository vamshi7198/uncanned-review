import uuid

from conftest import Api, make_user, upload_video, video_bytes


def test_admin_creates_project_with_members(project, editor_user, reviewer_user):
    roles = {m["user"]["email"]: m["role"] for m in project["members"]}
    assert roles == {editor_user.email: "editor", reviewer_user.email: "reviewer"}
    assert project["status"] == "draft"
    assert project["versions"] == []


def test_non_admin_cannot_create_project(editor):
    assert editor.post("/api/projects", json={"name": "Nope"}).status_code == 403


def test_duplicate_membership_rejected(admin, editor_user):
    r = admin.post("/api/projects", json={"name": "Dup", "members": [
        {"user_id": str(editor_user.id), "role": "editor"},
        {"user_id": str(editor_user.id), "role": "reviewer"},
    ]})
    assert r.status_code == 400


def test_members_see_only_their_projects(admin, project, editor, reviewer):
    admin.post("/api/projects", json={"name": "Secret other project"})
    names = [p["name"] for p in editor.get("/api/projects").json()["items"]]
    assert names == ["Uncanned Instagram Reel"]
    assert len(admin.get("/api/projects").json()["items"]) == 2


def test_outsider_gets_404_for_project_and_everything_in_it(admin, project, editor):
    data = video_bytes()
    v = upload_video(editor, project["id"], data)
    make_user("outsider@example.com", "reviewer")
    out = Api().login("outsider@example.com")
    pid, vid = project["id"], v["id"]
    for url in (
        f"/api/projects/{pid}",
        f"/api/projects/{pid}/members",
        f"/api/projects/{pid}/versions",
        f"/api/projects/{pid}/activity",
        f"/api/versions/{vid}",
        f"/api/versions/{vid}/media",
        f"/api/versions/{vid}/download",
        f"/api/versions/{vid}/comments",
    ):
        assert out.get(url).status_code == 404, url
    assert out.post(f"/api/versions/{vid}/comments", json={"text": "hi"}).status_code == 404
    assert out.post(f"/api/versions/{vid}/approve").status_code == 404
    assert out.post(f"/api/projects/{pid}/uploads",
                    json={"filename": "a.mp4", "size": 10}).status_code == 404


def test_unknown_ids_are_404(admin):
    rid = uuid.uuid4()
    assert admin.get(f"/api/projects/{rid}").status_code == 404
    assert admin.get(f"/api/versions/{rid}/media").status_code == 404


def test_search_and_filters(admin, project, editor, reviewer):
    admin.post("/api/projects", json={"name": "Ginger Lemon Product Film"})
    names = [p["name"] for p in admin.get("/api/projects?q=ginger").json()["items"]]
    assert names == ["Ginger Lemon Product Film"]
    # LIKE wildcards are treated literally.
    assert admin.get("/api/projects?q=%25").json()["items"] == []

    upload_video(editor, project["id"], video_bytes())
    needs = reviewer.get("/api/projects?filter=needs_review").json()["items"]
    assert [p["id"] for p in needs] == [project["id"]]
    # The editor is not the one who reviews.
    assert editor.get("/api/projects?filter=needs_review").json()["items"] == []
    assert admin.get("/api/projects?filter=bogus").status_code == 400


def test_member_update_requires_admin(project, editor, admin, reviewer_user):
    r = editor.put(f"/api/projects/{project['id']}/members", json={"members": []})
    assert r.status_code == 403
    r = admin.put(f"/api/projects/{project['id']}/members", json={"members": [
        {"user_id": str(reviewer_user.id), "role": "reviewer", "can_approve": False}]})
    assert r.status_code == 200
    assert r.json()[0]["can_approve"] is False


def test_archive_hides_from_default_list(admin, project):
    admin.patch(f"/api/projects/{project['id']}", json={"is_archived": True})
    assert admin.get("/api/projects").json()["items"] == []
    assert len(admin.get("/api/projects?filter=archived").json()["items"]) == 1


def test_activity_history_records_events(project, editor, admin):
    upload_video(editor, project["id"], video_bytes())
    events = [a["event_type"] for a in admin.get(f"/api/projects/{project['id']}/activity").json()["items"]]
    assert events[:2] == ["version_uploaded", "project_created"]
