from conftest import PASSWORD, Api, make_user


def test_login_sets_httponly_session_and_csrf_cookie():
    make_user("a@example.com", "reviewer")
    api = Api()
    r = api.post("/api/auth/login", json={"email": "A@Example.com", "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "a@example.com"
    set_cookie = r.headers.get_list("set-cookie")
    session = next(c for c in set_cookie if c.startswith("ur_session="))
    assert "HttpOnly" in session and "SameSite=lax" in session
    csrf = next(c for c in set_cookie if c.startswith("ur_csrf="))
    assert "HttpOnly" not in csrf
    assert "password_hash" not in r.text


def test_wrong_password_and_unknown_email_look_identical():
    make_user("a@example.com", "reviewer")
    api = Api()
    r1 = api.post("/api/auth/login", json={"email": "a@example.com", "password": "nope-nope-nope"})
    r2 = api.post("/api/auth/login", json={"email": "ghost@example.com", "password": "nope-nope-nope"})
    assert r1.status_code == r2.status_code == 401
    assert r1.json() == r2.json()


def test_login_rate_limited_after_repeated_failures():
    make_user("a@example.com", "reviewer")
    api = Api()
    for _ in range(10):
        api.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"})
    r = api.post("/api/auth/login", json={"email": "a@example.com", "password": PASSWORD})
    assert r.status_code == 429


def test_me_requires_session():
    assert Api().get("/api/auth/me").status_code == 401


def test_csrf_required_for_state_changes(admin):
    r = admin.c.post("/api/projects", json={"name": "X"})  # no CSRF header
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "csrf_failed"
    r = admin.c.post("/api/projects", json={"name": "X"}, headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403
    assert admin.post("/api/projects", json={"name": "X"}).status_code == 201


def test_logout_revokes_session():
    make_user("a@example.com", "reviewer")
    api = Api().login("a@example.com")
    token = api.c.cookies.get("ur_session")
    assert api.post("/api/auth/logout").status_code == 204
    replay = Api()
    replay.c.cookies.set("ur_session", token)
    assert replay.get("/api/auth/me").status_code == 401


def test_disabled_user_loses_access_immediately(admin):
    u = make_user("b@example.com", "editor")
    api = Api().login("b@example.com")
    assert api.get("/api/auth/me").status_code == 200
    r = admin.post(f"/api/users/{u.id}/disable")
    assert r.status_code == 200 and r.json()["is_active"] is False
    assert api.get("/api/auth/me").status_code == 401
    r = Api().post("/api/auth/login", json={"email": "b@example.com", "password": PASSWORD})
    assert r.status_code == 401


def test_inactive_user_cannot_log_in():
    make_user("c@example.com", "editor", active=False)
    r = Api().post("/api/auth/login", json={"email": "c@example.com", "password": PASSWORD})
    assert r.status_code == 401


def test_change_password_signs_out_other_sessions():
    make_user("a@example.com", "reviewer")
    first = Api().login("a@example.com")
    second = Api().login("a@example.com")
    r = first.post("/api/auth/change-password",
                   json={"current_password": PASSWORD, "new_password": "a-brand-new-password"})
    assert r.status_code == 200
    assert first.get("/api/auth/me").status_code == 200
    assert second.get("/api/auth/me").status_code == 401
    Api().login("a@example.com", "a-brand-new-password")


def test_change_password_rejects_weak_password():
    make_user("a@example.com", "reviewer")
    api = Api().login("a@example.com")
    r = api.post("/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "short"})
    assert r.status_code == 400


def test_first_run_setup_requires_token_and_only_works_once():
    api = Api()
    cfg = api.get("/api/config").json()
    assert cfg["needs_setup"] is True and cfg["setup_enabled"] is True
    body = {"token": "wrong", "email": "boss@example.com", "display_name": "Boss",
            "password": "a-long-password-1"}
    assert api.post("/api/setup", json=body).status_code == 403
    body["token"] = "test-bootstrap-token"
    r = api.post("/api/setup", json=body)
    assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
    assert api.get("/api/auth/me").status_code == 200
    body["email"] = "intruder@example.com"
    assert Api().post("/api/setup", json=body).status_code == 409
    assert Api().get("/api/config").json()["needs_setup"] is False


def test_only_admin_manages_users(admin, editor):
    r = editor.post("/api/users", json={"email": "x@example.com", "display_name": "X",
                                         "role": "editor", "password": "a-long-password"})
    assert r.status_code == 403
    assert editor.get("/api/users").status_code == 403
    r = admin.post("/api/users", json={"email": "x@example.com", "display_name": "X",
                                        "role": "editor", "password": "a-long-password"})
    assert r.status_code == 201
    assert r.json()["must_change_password"] is True
    dup = admin.post("/api/users", json={"email": "X@example.com", "display_name": "X",
                                          "role": "editor", "password": "a-long-password"})
    assert dup.status_code == 409


def test_admin_cannot_demote_self(admin):
    me = admin.get("/api/auth/me").json()["user"]
    r = admin.patch(f"/api/users/{me['id']}", json={"role": "editor"})
    assert r.status_code == 400


def test_errors_do_not_leak_internals(admin):
    r = admin.get("/api/projects/not-a-uuid")
    assert r.status_code == 422
    body = r.json()
    assert set(body) == {"error"}
    assert "Traceback" not in r.text
