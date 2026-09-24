# backend/migrations/ — DB Schema (Owner A only)

Draft PostgreSQL schema for Syncattend V3. **Only owner A edits this.**

- `0001_initial_schema.sql` — users, devices (+ device_changes), courses (+ enrollments),
  sessions (with 60s auth window), attendance (server uniqueness constraints), nonces (single-use audit).

## How it's applied
For local dev, `infra/docker-compose.yml` mounts this folder into Postgres'
`docker-entrypoint-initdb.d`, so `0001_initial_schema.sql` runs on first container start.

For managed environments, A can later adopt Alembic (already in `requirements.txt`)
and translate these into versioned migrations.

## Key contract-aligned constraints
- `attendance` has `UNIQUE(session_id, student_id)` AND `UNIQUE(session_id, device_uuid)`
  → enforces "one attendance per account & per device UUID per session".
- `devices.device_uuid` is UNIQUE and app-generated (not a hardware/OS id).
- `nonces` records single-use consumption for relay-attack forensics (live TTL is in Redis).
