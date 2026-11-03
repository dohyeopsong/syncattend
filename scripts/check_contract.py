#!/usr/bin/env python3
"""Compare backend operation_ids against contracts/openapi.yaml.

Static check only: it does not import the FastAPI app, so it runs anywhere
(Claude Code terminal, Muse over SSH, CI) without backend dependencies.

Usage:  python3 scripts/check_contract.py
Exit:   0 = in sync, 1 = drift found
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND_APP = ROOT / "backend" / "app"
CONTRACT = ROOT / "contracts" / "openapi.yaml"


def backend_operation_ids() -> set[str]:
    ids: set[str] = set()
    pattern = re.compile(r"""operation_id\s*=\s*["']([^"']+)["']""")
    for py in BACKEND_APP.rglob("*.py"):
        ids.update(pattern.findall(py.read_text(encoding="utf-8", errors="ignore")))
    return ids


def contract_operation_ids() -> set[str]:
    text = CONTRACT.read_text(encoding="utf-8")
    return set(re.findall(r"operationId:\s*([A-Za-z0-9_]+)", text))


def main() -> int:
    if not BACKEND_APP.exists() or not CONTRACT.exists():
        print(f"ERROR: expected {BACKEND_APP} and {CONTRACT} to exist")
        return 1

    backend = backend_operation_ids()
    contract = contract_operation_ids()

    print(f"backend operation_ids : {len(backend)}")
    print(f"contract operationIds : {len(contract)}")

    missing = sorted(backend - contract)
    extra = sorted(contract - backend)

    if missing:
        print("\nIn backend but MISSING from contract:")
        for op in missing:
            print(f"  - {op}")
    if extra:
        print("\nIn contract but NOT in backend:")
        for op in extra:
            print(f"  - {op}")

    if missing or extra:
        print("\nRESULT: DRIFT")
        return 1
    print("\nRESULT: IN SYNC")
    return 0


if __name__ == "__main__":
    sys.exit(main())
