# CLAUDE.md — web/ (CLI C)

React + shadcn/ui + Zustand professor dashboard. You are **CLI C**:
you own `web/`, `infra/`, and `.github/`.

## Setup & run
```bash
npm install
npm run dev                   # http://localhost:5173, proxies /api -> http://localhost:8000
npm run build                 # tsc -b && vite build
npm test                      # vitest run
```
Baseline 2026-10-15: build OK, vitest **33 passed**.

## Infra (also yours)
```bash
docker compose -f ../infra/docker-compose.yml up --build
# backend :8000 | postgres :5432 | redis :6379
```
Note: the compose stack was **not verified** on 2026-10-15 (docker was unavailable
in that environment). Verify it before claiming it works.

## Rules
- `contracts/openapi.yaml` is **read-only** for you. Generate/align API calls from it;
  if it is missing an endpoint (e.g. the `/courses/{id}/schedules` family), request
  the change from CLI A instead of editing the contract or inventing the call shape.
- Do not edit `backend/` or `mobile/`.
- A change is done only when `npm run build` and `npm test` both pass — report counts.
