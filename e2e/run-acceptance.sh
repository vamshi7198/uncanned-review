#!/usr/bin/env bash
# Runs the full acceptance scenario against a disposable copy of the stack
# (project "uncanned-review-e2e", port 8091, its own volumes). Your real data
# and the main stack are not touched. Requires Docker and Microsoft Edge
# (or E2E_CHANNEL=chrome with Google Chrome).
set -euo pipefail
cd "$(dirname "$0")/.."

export COMPOSE_PROJECT_NAME=uncanned-review-e2e
export HTTP_PORT=8091 HTTP_BIND=127.0.0.1
export BOOTSTRAP_TOKEN=e2e-bootstrap-token
export POSTGRES_PASSWORD=e2e-only-password
export E2E_BASE_URL=http://127.0.0.1:8091
dc() { docker compose -p "$COMPOSE_PROJECT_NAME" "$@"; }

wait_healthy() {
  for _ in $(seq 1 60); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$E2E_BASE_URL/api/health")" = "200" ] &&
       [ "$(curl -s -o /dev/null -w '%{http_code}' "$E2E_BASE_URL/login")" = "200" ]; then return 0; fi
    sleep 2
  done
  echo "Stack did not become healthy" >&2; dc ps; return 1
}

echo "== Fresh e2e stack"
dc down -v --remove-orphans >/dev/null 2>&1 || true
dc up --build -d
wait_healthy
# Let the freshly built containers settle; the first requests after a build
# can be slow on a busy Docker Desktop VM.
for _ in 1 2 3 4 5; do curl -s -o /dev/null "$E2E_BASE_URL/login"; curl -s -o /dev/null "$E2E_BASE_URL/api/config"; done
sleep 5

echo "== Synthetic test videos"
mkdir -p frontend/e2e/.fixtures
if [ ! -f frontend/e2e/.fixtures/reel-v1.mp4 ]; then
  dc run --rm --no-deps -T --user root -v "$(pwd)/frontend/e2e/.fixtures:/out" --entrypoint sh backend -c '
    ffmpeg -v error -y -f lavfi -i testsrc2=s=640x360:r=25:d=25 -f lavfi -i sine=frequency=440:duration=25 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart /out/reel-v1.mp4 &&
    ffmpeg -v error -y -f lavfi -i smptebars=s=640x360:r=25:d=25 -f lavfi -i sine=frequency=660:duration=25 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -movflags +faststart /out/reel-v2.mp4 &&
    chmod 644 /out/*.mp4'
fi

cd frontend
echo "== Steps 1-18, 21-22"
npx playwright test acceptance.spec.ts

echo "== Step 19: restart containers"
cd .. && dc restart && wait_healthy && cd frontend
echo "== Step 20: data intact after restart"
npx playwright test persistence.spec.ts

echo "== Recreate containers (simulates an update / rebuild)"
cd .. && dc up -d --force-recreate && wait_healthy && cd frontend
npx playwright test persistence.spec.ts

cd ..
if [ "${KEEP_E2E_STACK:-0}" != "1" ]; then
  echo "== Removing e2e stack"
  dc down -v --remove-orphans >/dev/null
fi
echo "Acceptance scenario passed."
