"""
Fix the attendance table copy to Render — strip any non-UUID prefix from
device_uuid (e.g. "delta:61e673ac-..." → "61e673ac-...") so it fits VARCHAR(36).

Usage:
    cd backend
    export RENDER_DB_URL="postgresql://USER:PASS@HOST:5432/DBNAME"
    .venv/bin/python scripts/fix_attendance_render.py
"""
import asyncio
import os
import sys

import asyncpg

LOCAL_URL = "postgresql://sdas:sdas@localhost:5432/sdas"
RENDER_URL = os.environ.get("RENDER_DB_URL", "")


async def main():
    if not RENDER_URL:
        sys.exit(
            "ERROR: set RENDER_DB_URL env var to the Render Postgres external URL.\n"
            "  export RENDER_DB_URL='postgresql://user:pass@host:5432/dbname'"
        )

    local = await asyncpg.connect(LOCAL_URL)
    render = await asyncpg.connect(RENDER_URL, ssl="require")

    # Clear any partial attendance data on Render first.
    await render.execute("TRUNCATE attendance CASCADE")
    print("==> Render attendance 테이블 비움")

    cols = await local.fetch(
        """
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'attendance'
        ORDER BY ordinal_position
        """
    )
    col_names = [c["column_name"] for c in cols]
    rows = await local.fetch("SELECT * FROM attendance")
    print(f"==> 로컬 attendance 행 수: {len(rows)}")

    # Clean device_uuid: if longer than 36, take the last 36 chars (the actual
    # UUID after any prefix like "delta:").
    cleaned = 0
    records = []
    for r in rows:
        vals = {c: r[c] for c in col_names}
        du = vals.get("device_uuid")
        if du and len(du) > 36:
            vals["device_uuid"] = du[-36:]
            cleaned += 1
        records.append(tuple(vals[c] for c in col_names))

    col_list = ", ".join(f'"{c}"' for c in col_names)
    placeholders = ", ".join(f"${i+1}" for i in range(len(col_names)))
    insert_sql = f'INSERT INTO attendance ({col_list}) VALUES ({placeholders})'

    await render.executemany(insert_sql, records)
    print(f"==> 복사 완료: {len(records)} rows (device_uuid 정리: {cleaned}행)")

    n = await render.fetchval("SELECT COUNT(*) FROM attendance")
    print(f"==> Render attendance 행 수: {n}")

    await local.close()
    await render.close()
    print("==> 완료!")


if __name__ == "__main__":
    asyncio.run(main())
