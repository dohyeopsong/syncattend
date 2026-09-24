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
