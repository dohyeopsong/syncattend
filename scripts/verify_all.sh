#!/usr/bin/env bash
# verify_all.sh — full-repo verification for Syncattend.
# This is the script Muse (or any terminal) runs to VERIFY, not to develop.
# It changes no code and leaves no server running.
#
# Usage:
#   bash scripts/verify_all.sh              # backend + contract + web + mobile
#   bash scripts/verify_all.sh --live       # also boot backend and curl /health
#
# Baseline (2026-10-15): backend pytest 121 passed | web build OK, vitest 33 passed
#                        mobile flutter test 86 passed, 2 skipped, analyze clean
#                        contract DRIFT (backend 34 vs contract 30 operationIds)

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE=0
[ "${1:-}" = "--live" ] && LIVE=1
FAILURES=0

section() { echo; echo "===== $1 ====="; }
fail() { FAILURES=$((FAILURES + 1)); echo ">> FAIL: $1"; }
pass() { echo ">> PASS: $1"; }

# --- Backend tests -----------------------------------------------------------
section "backend: pytest"
if [ -d "$ROOT/backend/.venv" ]; then
  # shellcheck disable=SC1091
  source "$ROOT/backend/.venv/bin/activate"
fi
if [ ! -f "$ROOT/backend/.env" ]; then
  echo "NOTE: backend/.env missing (only .env.example). pytest may still run; the server needs it."
fi
(cd "$ROOT/backend" && python -m pytest -q) && pass "backend pytest" || fail "backend pytest"

# --- Contract drift ----------------------------------------------------------
section "contract: backend vs contracts/openapi.yaml"
python3 "$ROOT/scripts/check_contract.py" && pass "contract in sync" || fail "contract drift"

# --- Web ---------------------------------------------------------------------
section "web: build + vitest"
(cd "$ROOT/web" && npm run build) && pass "web build" || fail "web build"
(cd "$ROOT/web" && npm test) && pass "web vitest" || fail "web vitest"

# --- Mobile ------------------------------------------------------------------
section "mobile: flutter test + analyze"
(cd "$ROOT/mobile" && flutter test) && pass "mobile flutter test" || fail "mobile flutter test"
(cd "$ROOT/mobile" && flutter analyze) && pass "mobile flutter analyze" || fail "mobile flutter analyze"

# --- Optional live backend check --------------------------------------------
if [ "$LIVE" = "1" ]; then
  section "backend live: uvicorn + /health"
  (cd "$ROOT/backend" && uvicorn app.main:app --port 8000 >/tmp/syncattend-uvicorn.log 2>&1) &
  UV_PID=$!
  sleep 5
  if curl -sf http://localhost:8000/health; then
    echo
    pass "backend /health"
  else
    fail "backend /health (see /tmp/syncattend-uvicorn.log)"
  fi
  kill "$UV_PID" 2>/dev/null
  wait "$UV_PID" 2>/dev/null
fi

echo
echo "===== SUMMARY ====="
if [ "$FAILURES" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "$FAILURES check(s) FAILED — see sections above."
  echo "NOT covered by this script: full-stack E2E, docker compose stack."
  exit 1
fi
