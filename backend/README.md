# backend/ — FastAPI (Owner A)

Owner **A** — also owns `../contracts/openapi.yaml` and the DB schema in `migrations/`.

## Run (local)
```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
# health: curl http://localhost:8000/health
```

## Test
```bash
pip install pytest httpx
pytest
```

## Run (docker, via infra/)
```bash
docker compose -f ../infra/docker-compose.yml up backend
```

## Structure
```
backend/
├── app/
│   ├── main.py       # app + /health + feature router stubs
│   └── config.py     # settings (DB/Redis/JWT/nonce TTL/window)
├── migrations/       # SQL schema drafts (users, devices, courses, sessions, attendance, nonces)
├── tests/            # pytest (health smoke test)
├── requirements.txt
├── Dockerfile
└── .env.example
```

## Boundaries
- A implements auth / devices / sessions / attendance / sse routers per the contract.
- The contract (`../contracts/`) and DB schema (`migrations/`) are edited **only by A**.

## Full-stack E2E (Postgres + Redis + backend)
Bring up the whole stack (owner C's compose) and confirm real integration:
```bash
docker compose -f ../infra/docker-compose.yml up --build -d
curl http://localhost:8000/health     # {"status":"ok","db":"ok","redis":"ok"}
```
Postgres auto-applies `migrations/0001_initial_schema.sql` on first boot (bind-
mounted into `docker-entrypoint-initdb.d`). IDs/device UUIDs are stored as
**TEXT** to match the ORM (`String(36)`); native `uuid` columns break asyncpg
INSERTs (VARCHAR→uuid mismatch).

### Seed fixed accounts for B/C
Idempotent seed — safe to re-run; opens a fresh session each time:
```bash
docker compose -f ../infra/docker-compose.yml exec backend python -m scripts.seed_e2e
# or locally with DATABASE_URL set:  python -m scripts.seed_e2e
```
Seed logins (password for all: `seedpass123`):
| role       | email                      | notes                                   |
|------------|----------------------------|-----------------------------------------|
| professor  | prof.e2e@wku.ac.kr         | owns course "E2E Integration 101"       |
| student 1  | student1.e2e@wku.ac.kr     | device pre-bound: `11111111-1111-1111-1111-111111111111` |
| student 2  | student2.e2e@wku.ac.kr     | no device yet — register your own UUID  |

The script prints prof/student/course/open-session ids as JSON.

## SSE — manual verification (curl)
The two Server-Sent-Events streams are `text/event-stream`; `curl -N` disables
buffering so you see events live. (In automated tests the generators
`app.routers.sse.session_attendance_events` / `student_risk_events` are pulled
directly, since in-process ASGI transports can't read an infinite stream.)
```bash
TOKEN=...   # a professor access_token (for sessions) or student (for students)

# professor: live attendance aggregate for a session
curl -N http://localhost:8000/sse/sessions/<session_id> \
  -H "Authorization: Bearer $PROF_TOKEN"
# → event: attendance / data: {"session_id":...,"present":1,...} on each change

# student: risk-group warning stream (emits once absences cross threshold)
curl -N http://localhost:8000/sse/students/<student_id> \
  -H "Authorization: Bearer $STUDENT_TOKEN"
# → event: risk / data: {"level":"warning","absences":2,...}
```
After a `verifyAttendance` succeeds, the professor's `/sse/sessions/{id}` stream
emits an updated aggregate with `present` incremented.

