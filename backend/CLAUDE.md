# CLAUDE.md — backend/ (CLI A)

FastAPI (Python, async). You are **CLI A**: you own `backend/`, `backend/migrations/`,
and edits to `contracts/openapi.yaml`. Mobile (B) and web (C) only read what you publish.

## Setup & run
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # server will not be configured correctly without it
uvicorn app.main:app --reload --port 8000
curl http://localhost:8000/health
```

## Test
```bash
pytest                        # pytest.ini: testpaths=tests, asyncio_mode=auto
```
Baseline 2026-10-15: **121 passed**.

## Rules
- Schema changes go in `backend/migrations/` only — never patch the DB by hand.
- Every endpoint change must be mirrored in `contracts/openapi.yaml` in the same change,
  then verified with `python3 ../scripts/check_contract.py` from the repo root.
- Preserve the security invariants in the contract: nonce 15s TTL + single-use,
  1-min auth window, one attendance per account & per device UUID per session.
- Do not edit `mobile/`, `web/`, or `infra/`. If B/C need a contract change, they ask you.
