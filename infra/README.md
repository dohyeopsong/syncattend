# infra/ — Dev/Deploy Infrastructure (Owner C)

Owner **C**.

## Local stack
```bash
# from repo root
docker compose -f infra/docker-compose.yml up --build
```
Brings up:
- `postgres` (:5432) — auto-applies `backend/migrations/*.sql` on first start
- `redis` (:6379)
- `backend` (:8000) — FastAPI, waits for healthy postgres+redis

Health: `curl http://localhost:8000/health`

## Integration E2E status (2026-09-25, owner C)
Stack orchestration **verified**:
- `postgres` + `redis` become **healthy**; `backend` starts; `/health` returns
  `{"status":"ok","db":"ok","redis":"ok"}`.
- Migration `backend/migrations/0001_initial_schema.sql` is applied correctly
  (`users.id` is Postgres type `uuid`, `gen_random_uuid()` default).
- Web ↔ backend wiring **verified**: `npm run dev` on :5173 proxies
  `GET /api/health` → backend `/health` = ok (see `web/vite.config.ts`).

Professor happy-path E2E (login → course → enroll → session → token → verify →
SSE → correct → batch close) is currently **BLOCKED before the first write** by a
**backend ORM ↔ Postgres schema type mismatch (owner A)** — not an infra/web issue:
- `POST /auth/register` → **500**; backend log:
  `asyncpg ... DatatypeMismatchError: column "id" is of type uuid but expression
  is of type character varying` on `INSERT INTO users`.
- Cause: `backend/app/models.py` declares `id: Mapped[str] = mapped_column(String(36))`
  ("UUIDs stored as strings for cross-DB portability"), but the Postgres migration
  declares `id UUID`. Tests use SQLite (String(36) works) so they don't catch it;
  it only surfaces against the real Postgres stack.
- **Fix is A's**: use a UUID-typed column on Postgres (e.g. SQLAlchemy
  `Uuid`/`UUID(as_uuid=...)`, or a portable type that maps to `uuid` on PG), or
  change the migration to `id TEXT`. C/B cannot edit `backend/`.

Once A lands the type fix, re-run this stack and the full professor flow completes
against the live backend (web client + emitter already verified in isolation).


## CI
`.github/workflows/ci.yml` builds/tests backend, web, and mobile independently.

## Deploy (target)
- web → Vercel · backend → Render · Postgres/Redis → managed instances.

## Boundaries
- Only C edits `infra/` and root shared config. DB schema files live in `backend/migrations/`
  and are owned by A; infra only mounts them.
