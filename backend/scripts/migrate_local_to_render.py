"""
Migrate local Docker DB data → Render DB.

Dumps data from the local Docker postgres (localhost:5432) and restores it into
the Render postgres, replacing whatever is there. Uses asyncpg for both ends so
no psql binary is needed.

Usage:
    cd backend
    export RENDER_DB_URL="postgresql://USER:PASS@HOST:5432/DBNAME"
    .venv/bin/python scripts/migrate_local_to_render.py
"""
import asyncio
import os
import sys

import asyncpg

LOCAL_URL = "postgresql://sdas:sdas@localhost:5432/sdas"
RENDER_URL = os.environ.get("RENDER_DB_URL", "")

# Tables in dependency order (parents first, children last). TRUNCATE in reverse.
TABLES = [
    "alembic_version",
    "users",
    "devices",
    "device_changes",
    "courses",
    "course_schedules",
    "enrollments",
    "sessions",
    "attendance",
    "nonces",
]


async def main():
    if not RENDER_URL:
        sys.exit(
            "ERROR: set RENDER_DB_URL env var to the Render Postgres external URL.\n"
            "  export RENDER_DB_URL='postgresql://user:pass@host:5432/dbname'"
        )

    print("==> Connecting to local Docker DB …")
    local = await asyncpg.connect(LOCAL_URL)

    print("==> Connecting to Render DB …")
    render = await asyncpg.connect(RENDER_URL, ssl="require")

    # 1) Read row counts from local (before migration).
    print("\n=== 로컬 데이터 행 수 ===")
    for t in TABLES:
        try:
            n = await local.fetchval(f"SELECT COUNT(*) FROM {t}")
            print(f"  {t}: {n}")
        except asyncpg.UndefinedTableError:
            print(f"  {t}: (테이블 없음 — 건너뜀)")

    # 2) TRUNCATE all tables on Render (reverse dependency order).
    print("\n==> Render DB 기존 데이터 삭제 (TRUNCATE) …")
    for t in reversed(TABLES):
        try:
            await render.execute(f'TRUNCATE TABLE "{t}" CASCADE')
        except asyncpg.UndefinedTableError:
            pass  # table doesn't exist yet on render — skip
    print("  완료")

    # 3) For each table, pull all rows from local and INSERT into Render.
    print("\n==> 데이터 복사 (local → render) …")
    for t in TABLES:
        try:
            cols = await local.fetch(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_name = $1
                ORDER BY ordinal_position
                """,
                t,
            )
        except Exception:
            continue
        if not cols:
            continue
        col_names = [c["column_name"] for c in cols]

        # Pull all rows.
        rows = await local.fetch(f'SELECT * FROM "{t}"')
        if not rows:
            print(f"  {t}: 0 rows (건너뜀)")
            continue

        col_list = ", ".join(f'"{c}"' for c in col_names)
        placeholders = ", ".join(f"${i+1}" for i in range(len(col_names)))
        insert_sql = f'INSERT INTO "{t}" ({col_list}) VALUES ({placeholders})'

        records = [tuple(r[c] for c in col_names) for r in rows]
        try:
            await render.executemany(insert_sql, records)
            print(f"  {t}: {len(records)} rows 복사 완료")
        except Exception as e:
            print(f"  {t}: 오류 — {e}")

    # 4) Verify row counts on Render after migration.
    print("\n=== Render 복원 후 행 수 ===")
    for t in TABLES:
        try:
            n = await render.fetchval(f"SELECT COUNT(*) FROM {t}")
            print(f"  {t}: {n}")
        except asyncpg.UndefinedTableError:
            print(f"  {t}: (테이블 없음)")

    await local.close()
    await render.close()
    print("\n==> 마이그레이션 완료!")


if __name__ == "__main__":
    asyncio.run(main())
