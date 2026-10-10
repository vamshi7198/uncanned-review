#!/usr/bin/env sh
# Create .env from .env.example with freshly generated secrets.
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo ".env already exists; not overwriting." >&2
  exit 1
fi
rand() { od -An -tx1 -N24 /dev/urandom | tr -d ' \n'; }
sed -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(rand)/" \
    -e "s/^BOOTSTRAP_TOKEN=.*/BOOTSTRAP_TOKEN=$(rand)/" \
    .env.example > .env
echo "Created .env. Your setup token (needed once, at /setup):"
grep '^BOOTSTRAP_TOKEN=' .env | cut -d= -f2
