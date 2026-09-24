# Syncattend (SDAS) — Dual-Auth Smart Attendance & Academic Management System

Monorepo for parallel development by **3 developers in 3 terminals (CLIs)**.
See `docs/` for the full V3 proposal and design docs.

## Layered defense (V3)
Dynamic QR (time/identity) + ultrasonic audio token (space/proximity) + identity defense
(1-min window + server uniqueness + app-generated UUID device binding + `@wku.ac.kr`
re-registration) + professor-in-the-loop confirmation.

## Repository layout & CLI ownership

| Folder | Purpose | Owner (CLI) | Others |
|--------|---------|-------------|--------|
| `backend/`   | FastAPI (Python, async) + JWT/auth/nonce/attendance | **A** | read-only |
| `backend/migrations/` | PostgreSQL schema (DB) | **A** | read-only |
| `contracts/` | `openapi.yaml` — shared API contract | **A** (edits) | B, C **read-only** |
| `mobile/`    | Flutter student app | **B** | read-only |
| `web/`       | React + shadcn/ui + Zustand professor dashboard | **C** | read-only |
| `infra/`     | docker-compose, deploy config | **C** | read-only |
| `.github/`   | CI workflows (root shared) | **C** | read-only |
| `docs/`      | Proposal & design docs | shared | — |

### Modification boundaries (rules for parallel work)
- **The DB schema (`backend/migrations/`) and `contracts/openapi.yaml` are edited ONLY by A.**
  B and C read them and generate clients; request changes from A instead of hand-editing.
- **`infra/` and root shared config are edited ONLY by C.**
- **Do not create files that cross folder boundaries.** Each owner works only in their folder(s).

## Start here (per CLI)

### CLI A — backend (`backend/`)
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env
uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health          # {"status":"ok",...}
pytest                                       # health smoke test
```

### CLI B — mobile (`mobile/`)
```bash
cd mobile
flutter create .        # first time only: generates android/ios (keeps lib/)
flutter pub get
flutter test            # widget smoke test
flutter run             # emulator/device (--dart-define=BACKEND_URL=...)
```

### CLI C — web (`web/`) + infra (`infra/`)
```bash
cd web
npm install
npm run dev             # http://localhost:5173 (proxies /api -> :8000)
npm run build

# full local stack (Postgres + Redis + backend):
docker compose -f infra/docker-compose.yml up --build
```

## Full stack in one command
```bash
docker compose -f infra/docker-compose.yml up --build
# backend :8000  |  postgres :5432 (auto-applies migrations)  |  redis :6379
```

## Contract
`contracts/openapi.yaml` fixes the HTTP API so all three can start in parallel:
auth (JWT + `@wku.ac.kr` device re-registration), QR/audio nonce issue+verify (15s TTL,
single-use), cross-verification, 1-min auth window (open/extend/close), server uniqueness
(one attendance per account & per device UUID per session), attendance aggregation +
Delta batch close, and SSE risk-warning streams.

---

Created: 2026-09-17 · Scaffold: 2026-09-24 (V3)
