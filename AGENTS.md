# AGENTS.md — Syncattend (SDAS)

Dual-Auth Smart Attendance & Academic Management System.
Monorepo designed for **3 parallel CLIs**. Read `README.md` first; this file adds the rules an AI coding agent must follow.

## Layout and ownership (hard boundaries)

| Folder | Stack | Owner CLI | Rule |
|---|---|---|---|
| `backend/` | FastAPI (Python, async), JWT/auth/nonce/attendance | **A** | Only A edits |
| `backend/migrations/` | PostgreSQL schema | **A** | Only A edits |
| `contracts/` | `openapi.yaml` — shared API contract | **A** edits | B, C read-only |
| `mobile/` | Flutter student app | **B** | Only B edits |
| `web/` | React + shadcn/ui + Zustand professor dashboard | **C** | Only C edits |
| `infra/` | docker-compose, deploy config | **C** | Only C edits |
| `.github/` | CI workflows | **C** | Only C edits |
| `docs/` | Proposal & design docs | shared | — |

- Work only in your owner's folder. If you need a change in another owner's folder
  (especially `contracts/openapi.yaml` or the DB schema), **stop and request it from A**
  instead of hand-editing it.
- Do not create files that cross folder boundaries.

## Commands (verified from README / package.json / pytest.ini)

### Backend (CLI A)
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # required before running the server; .env is not in git
uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health   # {"status":"ok",...}
pytest                        # testpaths=tests, asyncio_mode=auto
```

### Mobile (CLI B)
```bash
cd mobile
flutter pub get
flutter test
flutter analyze
flutter run                   # add --dart-define=BACKEND_URL=... when needed
```

### Web (CLI C)
```bash
cd web
npm install
npm run dev                   # http://localhost:5173, proxies /api -> :8000
npm run build                 # tsc -b && vite build
npm test                      # vitest run
```

### Full stack
```bash
docker compose -f infra/docker-compose.yml up --build
# backend :8000 | postgres :5432 (auto-applies migrations) | redis :6379
```

## API contract rules

- `contracts/openapi.yaml` is the source of truth for the HTTP API:
  JWT auth + `@wku.ac.kr` device re-registration, QR/audio nonce issue+verify
  (15s TTL, single-use), cross-verification, 1-min auth window, server uniqueness
  (one attendance per account & per device UUID per session), attendance
  aggregation + Delta batch close, SSE risk-warning streams.
- Known drift (checked 2026-10-15): backend exposes **34 operation_ids**,
  the contract has **30**. Missing from the contract:
  `addCourseSchedule`, `deleteCourseSchedule`, `listCourseSchedules`
  (`/courses/{id}/schedules`). Run `python3 scripts/check_contract.py` to re-check.
- When you add or change an endpoint in `backend/`, update `contracts/openapi.yaml`
  in the same change (CLI A only) and re-run the contract check.

## Verification before you claim done

Run the checks for the folder you touched, and report **exact counts**:

- backend: `pytest` pass/fail counts
- web: `npm run build` result + `npm test` pass/fail counts
- mobile: `flutter test` pass/fail/skip counts + `flutter analyze` result
- contract: `python3 scripts/check_contract.py` result

Baseline (2026-10-15, full-repo check): backend pytest **121 passed**,
web build OK + vitest **33 passed**, mobile flutter test **86 passed, 2 skipped**,
`flutter analyze` clean. Full-stack E2E and the docker-compose stack were
**not** verified — never claim them as passing unless you actually ran them.

## Working rules

- Do not leave dev servers running when you finish a verification run.
- Do not invent endpoints, fields, or options: read the contract and the code first.
- Keep changes inside your owner's folder; prefer the smallest change that works.
- Report what passed, what failed, and what remains unverified — separately.
