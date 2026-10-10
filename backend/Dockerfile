FROM python:3.12-slim-bookworm

# FFmpeg (LGPL/GPL, free) reads duration and frame rate and makes thumbnails.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY requirements.txt requirements-dev.txt ./
ARG INSTALL_DEV=false
RUN pip install -r requirements.txt \
 && if [ "$INSTALL_DEV" = "true" ]; then pip install -r requirements-dev.txt; fi

COPY . .

RUN useradd --system --uid 10001 --create-home app \
 && mkdir -p /data/media && chown -R app:app /data /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# Migrations run on every start; they are idempotent. A single worker keeps
# the in-memory login rate limiter and upload locks consistent.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*' --workers 1"]
