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

## CI
`.github/workflows/ci.yml` builds/tests backend, web, and mobile independently.

## Deploy (target)
- web → Vercel · backend → Render · Postgres/Redis → managed instances.

## Boundaries
- Only C edits `infra/` and root shared config. DB schema files live in `backend/migrations/`
  and are owned by A; infra only mounts them.
