#!/usr/bin/env bash
# Render start script: create DB schema from ORM models, seed E2E accounts,
# launch uvicorn.
#
# Why create_all (not alembic): the Alembic initial revision predates the
# dual-auth columns (check_in/out timestamps, checkout_opened, semester_start)
# and those SQL migrations (0006–0008) were never translated to Alembic
# revisions. On a FRESH Render Postgres, Base.metadata.create_all builds the
# complete current schema directly from the models — the same path the test
# suite uses (177 passed). For an already-populated DB, create_all is a no-op
# on existing tables.
#
# Environment variables Render injects / you set in the dashboard:
#   DATABASE_URL      — Render Postgres external connection string
#   REDIS_URL         — Render Redis (or unset → in-memory fakeredis fallback)
#   JWT_SECRET        — a strong random secret (SET THIS)
#   CORS_ORIGINS      — comma-separated Vercel URL(s), e.g. https://yourapp.vercel.app
#   SCHOOL_EMAIL_DOMAIN — @wku.ac.kr (default)
#   RESEND_API_KEY    — Resend API key (recommended; HTTPS on port 443)
#   RESEND_FROM       — verified sender, e.g. noreply@your-domain.com
set -euo pipefail

cd "$(dirname "$0")"

# 1) Create all tables from the current ORM models (fresh-DB safe, idempotent).
echo "==> Creating DB schema from ORM models…"
python -c "
import asyncio
from app.db import get_engine
from app.models import Base
async def main():
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
asyncio.run(main())
"

# 2) Seed E2E test accounts (idempotent). Re-runs safely on every deploy.
echo "==> Seeding E2E accounts…"
python -m scripts.seed_e2e || echo "seed_e2e failed (non-fatal for restarts)"

# 3) Launch the API. Render sets PORT; bind to 0.0.0.0:\$PORT.
PORT="${PORT:-8000}"
echo "==> Starting uvicorn on 0.0.0.0:${PORT}…"
exec uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
