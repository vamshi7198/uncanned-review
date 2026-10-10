# Cutroom

_Video review and approval for Uncanned. Live at https://cutroom.uncanned.in._

A private, self-hosted video review tool. An editor uploads a cut, reviewers
pause on the exact frame and leave feedback, the editor uploads a new version,
and a reviewer approves it.

It is deliberately small: one workflow done well, not a Frame.io clone. It runs
on your own computer or server with open-source software only. **No paid
service, API key or subscription is needed for any feature.**

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Quick start (your computer)](#quick-start-your-computer)
- [Everyday use](#everyday-use)
- [Configuration](#configuration)
- [Where files are stored](#where-files-are-stored)
- [Backup and restore](#backup-and-restore)
- [Updating safely](#updating-safely)
- [Running on a server with HTTPS](#running-on-a-server-with-https)
- [Security](#security)
- [Video playback and frame accuracy: what to expect](#video-playback-and-frame-accuracy-what-to-expect)
- [Development and tests](#development-and-tests)
- [Troubleshooting](#troubleshooting)
- [Licences](#licences)

---

## What it does

| | |
|---|---|
| **Projects** | One project per creative (e.g. "Instagram Reel — Mango Blaze"). A project holds every version of that video. |
| **Upload** | Drag and drop MP4, MOV, M4V or WebM. Chunked and resumable, with a progress bar, cancel and automatic retry. Up to 10 GB by default. The original file is stored unchanged. |
| **Review** | A large player with frame stepping, speeds from 0.25× to 2×, volume, fullscreen and keyboard shortcuts. |
| **Frame comments** | Pause, press **C** (or the *Comment at 00:12.400* button), type, post. The comment is pinned to that millisecond on that version. Timeline markers and timestamps jump back to the exact frame. |
| **Drawings** | Optional arrows, boxes and freehand marks on the paused frame, attached to the comment. |
| **Threads** | Replies ("Fixed in V2"), resolve and reopen, edit your own comments, soft-delete. |
| **Versions** | V1, V2, V3… Older versions and their comments are never changed or moved. |
| **Approval** | *Request changes* or *Approve*, recorded per version with who and when. A new upload always starts *In review*. |
| **People** | Admin, reviewer and editor roles; per-project membership; reviewers can be made comment-only. |
| **Dashboard** | Search, filters (*Needs my review*, *Changes requested*, *Approved*, *Archived*), open-comment counts, thumbnails. |
| **Activity** | A short history per project: uploads, comments, decisions. |

Not included, on purpose: public share links, real-time co-editing, AI
features, transcoding, side-by-side compare, SSO, billing.

## Architecture

```
 Browser ──► Caddy :8090 ──┬─ /api/*  ──► FastAPI (Python)  ──► PostgreSQL
            (one origin,   │                 │
             HTTPS-ready)  │                 └─► media volume (videos, thumbnails)
                           └─ everything else ► Next.js (React UI)
```

| Container | Role |
|---|---|
| `caddy` | Reverse proxy and the only published port. Adds security headers. Can obtain free Let's Encrypt certificates. |
| `frontend` | Next.js 16 + React 19 + Tailwind 4 UI. No secrets in it. |
| `backend` | FastAPI + SQLAlchemy 2 + Alembic. Auth, permissions, uploads, authenticated streaming with HTTP Range support, and FFmpeg for duration, frame rate and thumbnails. |
| `db` | PostgreSQL 16. Not published outside Docker. |

Video files never pass through the database. They are stored under
server-generated names (the original filename is kept only as metadata) and
are streamed from disk, never loaded into memory.

**Key design choices**

- *Uploads* are sent in 8 MB chunks, each with the byte offset it starts at. The
  server accepts a chunk only at its current position, so a retry can never
  duplicate or corrupt data. After any failure the browser asks the server how
  much it has and resumes from there. A file becomes a version only after
  *finalize*, which checks the size, sniffs the real file type from its first
  bytes, reads metadata with FFmpeg, computes a SHA-256 checksum and assigns the
  next version number inside a database lock.
- *Timestamps* are stored as integer milliseconds (`timestamp_ms`), never as
  display strings.
- *Integrity* is enforced by the database. Composite foreign keys make it
  impossible for a comment to point at a version of a different project, or for
  a reply to sit on a different version from its parent. Version numbers are
  unique per project.
- *Permissions* are checked on the server for every request, including media
  bytes. A user who is not on a project gets **404**, never 403, so IDs cannot
  be probed.

## Quick start (your computer)

**You need:** Docker Desktop (Windows/macOS) or Docker Engine with Compose v2
(Linux). Nothing else; Node and Python are only for development.

```sh
cd C:\dev\uncanned-review         # or wherever you cloned it

# 1. Create .env with random secrets (pick one):
powershell -ExecutionPolicy Bypass -File scripts/init-env.ps1     # Windows
sh scripts/init-env.sh                                            # macOS / Linux / Git Bash

# 2. Start everything:
docker compose up --build -d
```

Open **http://localhost:8090**. The first visit goes to the setup page. Enter
the `BOOTSTRAP_TOKEN` from `.env` (the init script also prints it), then your
name, email and password. That creates the first administrator. The setup page
stops working as soon as any account exists.

Prefer the command line? Create or reset an administrator at any time with:

```sh
docker compose exec -it backend python -m app.cli create-admin --email you@company.com --name "Your Name"
```

It asks for the password interactively, so it never appears in shell history.

**Stop / start / status**

```sh
docker compose stop           # stop, keep everything
docker compose start          # start again
docker compose ps             # status and health
docker compose logs -f backend
docker compose down           # remove containers; data volumes are kept
```

`docker compose down -v` **deletes all data** (database and videos). Don't use
`-v` unless that is what you want.

## Everyday use

1. **Admin → People → Add person.** Create the editor and the reviewers. Each
   person gets a temporary password; share it privately. They are asked to
   choose their own after signing in.
2. **Projects → New project.** Name it, then set each person to *Editor*,
   *Reviewer* or *Not on project*. Untick *Can approve* to make a reviewer
   comment-only.
3. **Editor:** open the project and choose **Upload video**. Add optional notes
   ("Updated logo and color").
4. **Reviewer:** **Open review** and play. Pause where something needs to change
   and press **C** (or click *Comment at …*). The current frame time is
   captured. Type and press **Ctrl/⌘ + Enter**. Click **Draw on frame** first if
   pointing helps. Use **General** for notes about the whole video.
5. Reviewer: **Request changes**. The editor sees each comment with its
   timestamp; clicking a timestamp jumps to that exact frame and pauses. The
   editor can reply ("Fixed in V2").
6. Editor: **Upload new version**. V1 and its comments stay exactly as they
   were, and V2 starts *In review*.
7. Reviewer: open V2 and choose **Approve**. If comments on that version are
   still unresolved, the app says so and asks you to confirm.

The **Copy link** button copies the project URL. Only signed-in members of the
project can open it.

**Keyboard shortcuts** (press **?** on the review page):

| Key | Action |
|---|---|
| Space or K | Play / pause |
| ← / → | Back / forward 1 s (with Shift: 10 s) |
| , / . | Previous / next frame |
| ↑ / ↓ | Volume |
| M | Mute |
| F | Fullscreen |
| C | Comment at the current frame |
| Esc | Stop drawing, close, deselect |

Shortcuts are ignored while you are typing in a text box.

## Configuration

All settings live in `.env` (see `.env.example`). After changing it, run
`docker compose up -d`.

| Variable | Default | Meaning |
|---|---|---|
| `POSTGRES_PASSWORD` | — (required) | Database password. |
| `BOOTSTRAP_TOKEN` | — | Token for the one-time web setup. Empty disables web setup. |
| `HTTP_PORT` | `8090` | Port on the host. |
| `HTTP_BIND` | `127.0.0.1` | `127.0.0.1` = this computer only; `0.0.0.0` = your network. |
| `SITE_ADDRESS` | `:80` | A domain name turns on automatic HTTPS (see below). |
| `COOKIE_SECURE` | `false` | Must be `true` when served over HTTPS. |
| `APP_NAME` | `Cutroom` | Product name shown in the UI. |
| `MAX_UPLOAD_BYTES` | `10737418240` (10 GiB) | Largest accepted video. |
| `MEDIA_DIR` | Docker volume | Absolute path to store videos elsewhere (e.g. another drive). |

**Changing the upload limit:** set `MAX_UPLOAD_BYTES` (for example
`53687091200` for 50 GiB) and run `docker compose up -d`. Because uploads are
chunked, no proxy limit needs changing; Caddy only ever sees 8 MB requests.
Make sure the disk has room. An upload needs its own size free while in
progress.

## Where files are stored

| What | Where |
|---|---|
| Database | Docker volume `uncanned-review_pgdata` |
| Videos | Docker volume `uncanned-review_media`, at `videos/<project-id>/<random-id>.<ext>` |
| Thumbnails | Same volume, under `thumbnails/` |
| Partial uploads | Same volume, under `tmp/`. Abandoned ones are removed after 48 hours. |

To keep videos on another drive, set for example `MEDIA_DIR=D:/uncanned-review-media`
in `.env` before the first start (or copy the existing files across, below).
On Linux the folder must be writable by UID 10001:
`sudo chown -R 10001:10001 /srv/uncanned-media`.

Moving existing media to a new `MEDIA_DIR`: take a backup, set `MEDIA_DIR`,
`docker compose up -d`, then restore that backup.

## Backup and restore

Back up **both** the database and the media. One without the other is not a
usable backup. The scripts run from Git Bash on Windows, or any shell on
macOS and Linux.

```sh
sh scripts/backup.sh
# -> backups/20261010-153000/database.dump + media.tar.gz
```

The app can stay in use during a backup. Copy the `backups/` folder somewhere
else (an external drive or another machine); a backup on the same disk does not
protect against disk failure.

**Restore** (replaces everything currently in the app):

```sh
sh scripts/restore.sh backups/20261010-153000
```

It asks you to type `RESTORE`, stops the app, restores the database and media,
and starts the app again.

To schedule backups, use Windows Task Scheduler or cron, e.g.
`0 2 * * * cd /srv/uncanned-review && sh scripts/backup.sh`. Prune old backup
folders yourself.

## Updating safely

```sh
sh scripts/backup.sh                 # 1. always back up first
git pull                             # 2. get the new version
docker compose up --build -d         # 3. rebuild and restart
```

Database migrations run automatically when the backend starts, and they only
ever add to the schema. Data lives in volumes, so rebuilding or recreating
containers does not touch it. The automated acceptance test checks exactly this.

## Running on a server with HTTPS

Needed when the editor and reviewers are on different networks. Any small Linux
server or always-on computer works (2 CPU, 2–4 GB RAM; disk sized for your
videos).

**Option A: public HTTPS with a domain**

1. Point a DNS name (e.g. `review.example.com`) at the server, and open ports
   80 and 443 in the firewall. Keep every other port closed.
2. In `.env`: `SITE_ADDRESS=review.example.com` and `COOKIE_SECURE=true`.
3. Start with the production override:
   ```sh
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d
   ```
   Caddy obtains and renews a free Let's Encrypt certificate. Production mode
   also hides the API docs.
4. Optional: add `Strict-Transport-Security "max-age=31536000"` to the
   `header` block in `caddy/Caddyfile` once HTTPS works.

A domain name usually costs a small yearly fee. That is the only possible cost
on the software side, and it is optional (see B).

**Option B: private network, no domain**

Put the server and every user on a private VPN such as WireGuard (free and open
source). Set `HTTP_BIND=0.0.0.0` and open the app at
`http://<server-vpn-ip>:8090`. Traffic is encrypted by the VPN. Free tiers of
hosted VPN tools exist, but their terms can change; the app does not depend on
any of them.

**Option C: same office network.** Set `HTTP_BIND=0.0.0.0`, then open
`http://<this-computer's-LAN-IP>:8090` from other machines. Without HTTPS,
passwords cross the local network unencrypted, so use this only on a network
you trust.

Hosting, a domain, electricity and backup storage may cost money. The software
itself never does.

## Security

What is in place:

- Argon2id password hashing; a minimum of 10 characters; admin-set passwords
  must be changed at first sign-in.
- Server-side sessions in the database (only a SHA-256 of the token is stored),
  `HttpOnly` + `SameSite=Lax` cookies, `Secure` when `COOKIE_SECURE=true`.
  Sessions are revoked on sign-out, password change and when an account is
  disabled.
- CSRF protection on every state-changing request (double-submit token in a
  header).
- Rate limiting of failed sign-ins (10 per 15 minutes per address and per email).
- Authorisation on every endpoint, including media streaming, downloads,
  uploads and activity. Non-members get 404.
- Uploads: extension allow-list, the real container type sniffed from the
  file's bytes (an HTML file renamed `.mp4` is rejected), FFmpeg must find a
  video stream, size limits, server-generated storage paths, a path-traversal
  guard, and `nosniff` headers on media.
- No public registration and no public links. The first admin needs the setup
  token or server shell access.
- Security headers from Caddy: CSP, `X-Frame-Options: DENY`, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`.
- No database port published; Compose binds the app to `127.0.0.1` by default.
- Errors return a short message, never stack traces, SQL or file paths.
- Pinned dependency versions (`requirements.txt`, `package-lock.json`).

Known limitations, stated plainly:

- The sign-in rate limiter and the upload chunk lock are in process memory. The
  backend therefore runs one worker (plenty for a small team). Running several
  backend replicas would need a shared store.
- The CSP allows inline scripts and styles, which Next.js needs without a nonce
  setup.
- The local default is plain HTTP. Use HTTPS (option A) or a VPN (option B)
  before exposing the app beyond your own computer.
- Docker image tags are pinned to a major version (`postgres:16-alpine`,
  `caddy:2-alpine`, `python:3.12-slim`, `node:24-slim`), so rebuilding picks up
  security patches within that version.

## Video playback and frame accuracy: what to expect

- **The browser plays the original file.** Nothing is transcoded. H.264 MP4
  plays everywhere. VP9/AV1 WebM plays in Chrome, Edge and Firefox. HEVC (H.265)
  plays in Safari and some Chrome/Edge setups. ProRes and other editing codecs
  do not play in browsers. The app warns about these on upload and on the
  review page, and offers the original as a download. For review, ask the
  editor to export an H.264 MP4 proxy.
- **Timestamps are accurate to the millisecond.** A comment at `00:12.400` seeks
  to 12.400 s.
- **Frame stepping uses the real frame rate**, measured by FFmpeg (25, 24,
  29.97, 60…; never assumed to be 30). For constant-frame-rate video each step
  lands on the next frame. The player shows the rate it is using.
- **Variable frame rate** footage (common from phones and screen recorders):
  stepping is approximate, and the player says so.
- Browsers expose the playback position as a time, not a frame number, and
  decoders can differ by a frame at exact boundaries. The app does not claim
  frame-perfect precision on every browser and codec, but time-based seeking is
  always exact to the stored millisecond.

## Development and tests

```
backend/    FastAPI app (app/), Alembic migrations, pytest suite (tests/)
frontend/   Next.js app (src/), Vitest tests (*.test.ts[x]), Playwright e2e (e2e/)
caddy/      Caddyfile
scripts/    init-env, backup, restore
e2e/        run-acceptance.sh: full scenario against a throwaway stack
```

**Backend tests** (58: auth, CSRF, rate limiting, roles, uploads, Range
streaming, comments, version isolation, approvals, DB constraints, concurrency):

```sh
# Inside Docker, using real FFmpeg (recommended):
docker compose exec db createdb -U review review_test
docker compose run --rm --no-deps -e DATABASE_URL=postgresql+psycopg://review:<POSTGRES_PASSWORD>@db:5432/review_test \
  -e MEDIA_ROOT=/tmp/media --entrypoint sh backend -c "pip install -q --user -r requirements-dev.txt && python -m pytest"
```

Always point the tests at a separate database. They drop and recreate its
schema.

**Frontend checks** (37 tests: login, dashboard, upload, review page seeking,
timestamp capture, keyboard safety, filters, resolve, version switching,
approval, frame maths):

```sh
cd frontend && npm ci && npm run verify     # lint + typecheck + tests
```

**End-to-end acceptance test.** This runs the full scenario below in a real
browser (Microsoft Edge, which plays H.264; set `E2E_CHANNEL=chrome` to use
Chrome) against a disposable stack on port 8091. It restarts and recreates the
containers, checks that the data survived, and then removes the stack. Your
real data is never touched.

```sh
bash e2e/run-acceptance.sh
```

Scenario: an admin creates an editor and a reviewer, then the project; the
editor uploads `reel-v1.mp4`; the reviewer comments at 12.4 s and 18.2 s (with
a drawing) and requests changes; the editor clicks the timestamp (the player
seeks to 12.4 s), replies, and uploads `reel-v2.mp4` with notes; V1 and its
comments stay intact; the reviewer approves V2; the project shows *Approved*;
an outsider and an anonymous user get 404/401 on every ID; after a restart and
after recreating the containers, all data and both video files are intact. Test
videos are generated synthetically with FFmpeg; no real footage is used.

**Local development without Docker** (optional): run Postgres, then
`uvicorn app.main:app --reload` in `backend/` with `DATABASE_URL` and
`MEDIA_ROOT` set, and `BACKEND_URL=http://127.0.0.1:8000 npm run dev` in
`frontend/` (port 3100).

API docs (development mode only): http://localhost:8090/api/docs

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Set POSTGRES_PASSWORD in .env` | Run `scripts/init-env.*` first. |
| Page does not load | `docker compose ps`; every service should be `healthy`/`Up`. Check `docker compose logs backend`. |
| Port 8090 in use | Set `HTTP_PORT=8095` in `.env`, then `docker compose up -d`. |
| Video shows "cannot play" | The codec is not browser-playable (e.g. ProRes). Download the original, or export H.264 MP4. |
| No duration, thumbnail or frame rate | FFmpeg could not read the file. It is still stored and downloadable. `GET /api/health` shows whether FFmpeg is available. |
| Upload stalls then resumes | Normal on a flaky connection; it continues from the server's position. A failed upload can be retried from the dialog and resumes rather than restarting. |
| "Your session expired" on an action | Refresh the page (the CSRF cookie was cleared). |
| Locked out as the only admin | `docker compose exec -it backend python -m app.cli create-admin --email you@…` resets the password. |
| Disk filling up | Videos are large. Check `docker system df`, move media with `MEDIA_DIR`, and prune old backups. |
| Others on the network cannot connect | Set `HTTP_BIND=0.0.0.0` and allow the port in the firewall. |

## Licences

All runtime dependencies are free and open source:

| Component | Licence |
|---|---|
| FastAPI, Starlette, Pydantic, SQLAlchemy, Alembic, Uvicorn | MIT |
| psycopg | LGPL-3.0 |
| argon2-cffi | MIT |
| PostgreSQL | PostgreSQL Licence (permissive) |
| FFmpeg (Debian build in the backend image) | LGPL/GPL |
| Next.js, React, Tailwind CSS, lucide-react, clsx | MIT / ISC |
| Caddy | Apache-2.0 |
| Test-only: pytest, Vitest, Testing Library, Playwright | MIT / Apache-2.0 |

**No paid service is required** for any part of the application.
