#!/usr/bin/env sh
# Restore a backup made by backup.sh. This REPLACES the current database and
# media. Usage: scripts/restore.sh backups/<timestamp>
set -eu
# Stop Git Bash on Windows rewriting container paths like /data/media.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
src="${1:?Usage: scripts/restore.sh backups/<timestamp>}"
[ -s "$src/database.dump" ] && [ -s "$src/media.tar.gz" ] || { echo "Missing files in $src" >&2; exit 1; }

# Check the backup BEFORE touching anything.
echo "Checking backup..."
docker compose up -d db backend >/dev/null
docker compose exec -T db pg_restore --list < "$src/database.dump" | grep -q "TABLE DATA public video_versions"   || { echo "Database dump is not readable; nothing was changed." >&2; exit 1; }
count=$(docker compose exec -T backend sh -c 'tar -tzf - | grep -c "^videos/.*[^/]$" || true' < "$src/media.tar.gz")
case "$count" in ''|*[!0-9]*) echo "Media archive is not readable; nothing was changed." >&2; exit 1;; esac
echo "Backup contains $count video file(s)."

if [ "${RESTORE_CONFIRM:-}" != "RESTORE" ]; then
  printf "This replaces ALL current projects, comments and videos with %s. Type RESTORE to continue: " "$src"
  read -r answer
  [ "$answer" = "RESTORE" ] || { echo "Cancelled."; exit 1; }
fi

echo "Stopping the app..."
docker compose stop caddy frontend backend
docker compose up -d db

echo "Restoring database..."
docker compose exec -T db pg_restore -U review -d review --clean --if-exists --no-owner --single-transaction < "$src/database.dump"

echo "Restoring media..."
docker compose run --rm --no-deps -T --entrypoint sh backend \
  -c "rm -rf /data/media/videos /data/media/thumbnails /data/media/tmp && tar -xzf - -C /data/media" < "$src/media.tar.gz"

docker compose up -d
echo "Restore complete."
