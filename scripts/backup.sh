#!/usr/bin/env sh
# Back up the database and all media into ./backups/<timestamp>/.
# Run from the project folder while the stack is up. pg_dump takes a
# consistent snapshot, so users can keep working during the backup.
set -eu
# Stop Git Bash on Windows rewriting container paths like /data/media.
export MSYS_NO_PATHCONV=1
cd "$(dirname "$0")/.."
ts=$(date +%Y%m%d-%H%M%S)
out="backups/$ts"
mkdir -p "$out"

echo "Dumping database..."
docker compose exec -T db pg_dump -U review -d review -Fc > "$out/database.dump"

echo "Archiving media..."
# Streamed through stdout, so no host path mapping is needed (works the same
# in Git Bash on Windows, macOS and Linux).
docker compose exec -T backend tar -czf - -C /data/media videos thumbnails > "$out/media.tar.gz"

echo "Verifying..."
# Both files must be readable archives with the expected contents.
docker compose exec -T db pg_restore --list < "$out/database.dump" | grep -q "TABLE DATA public video_versions"   || { echo "Backup FAILED: database dump is not readable." >&2; exit 1; }
videos_on_server=$(docker compose exec -T backend sh -c 'find /data/media/videos -type f | wc -l')
videos_in_backup=$(docker compose exec -T backend sh -c 'tar -tzf - | grep -c "^videos/.*[^/]$" || true' < "$out/media.tar.gz")
if [ "$videos_in_backup" != "$videos_on_server" ]; then
  echo "Backup FAILED: $videos_in_backup video files archived, $videos_on_server on the server." >&2
  exit 1
fi
echo "OK: database dump readable, $videos_in_backup video file(s) archived."
ls -lh "$out"
echo "Backup written to $out"
