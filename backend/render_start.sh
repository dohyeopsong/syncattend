#!/usr/bin/env bash
# Render start script: apply DB migrations, seed E2E accounts, launch uvicorn.
#
# Environment variables Render injects / you set in the dashboard:
#   DATABASE_URL      — Render Postgres external connection string (asyncpg-compatible)
#   REDIS_URL         — Render Redis or fallback (see below)
#   JWT_SECRET        — a strong random secret (SET THIS)
#   CORS_ORIGINS      — comma-separated Vercel URL(s), e.g. https://yourapp.vercel.app
#   SCHOOL_EMAIL_DOMAIN — @wku.ac.kr (default)
#
# Render's free Redis is limited; if REDIS_URL is unset we fall back to an
# in-memory fakeredis (nonces/risk-warnings work but do not survive restarts).
set -euo pipefail

cd "$(dirname "$0")"

# 1) Apply Alembic migrations to the live Postgres.
echo "==> Applying Alembic migrations…"
alembic upgrade head

# 2) Seed E2E test accounts (idempotent). Re-runs safely on every deploy.
echo "==> Seeding E2E accounts…"
python -m scripts.seed_e2e || echo "seed_e2e failed (non-fatal for restarts)"

# 3) Launch the API. Render sets PORT; bind to 0.0.0.0:$PORT.
PORT="${PORT:-8000}"
echo "==> Starting uvicorn on 0.0.0.0:${PORT}…"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
