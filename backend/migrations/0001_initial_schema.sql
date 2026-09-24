-- Syncattend (SDAS) — initial schema (draft)
-- Owner A only. Aligns with ../contracts/openapi.yaml AND app/models.py.
-- Applied automatically by Postgres via docker-entrypoint-initdb.d (see infra/).
--
-- IDs and app-generated device UUIDs are stored as TEXT (36-char UUID strings),
-- matching the ORM (app/models.py uses String(36) for cross-DB portability:
-- the same models run on PostgreSQL in prod and SQLite in tests). The app
-- always generates ids as strings (uuid4()), so asyncpg binds VARCHAR; using
-- native UUID columns here caused "column is of type uuid but expression is of
-- type character varying" on every INSERT. TEXT keeps SQL and ORM in lockstep.

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT UNIQUE NOT NULL,             -- @wku.ac.kr for students
    password_hash TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('student', 'professor')),
    name         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------- devices
-- One active app-generated UUID binding per account.
-- New/unknown UUID must pass email re-auth before binding (enforced in app layer).
CREATE TABLE IF NOT EXISTS devices (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid  TEXT NOT NULL,                    -- app-generated, stored in Keychain/Keystore
    bound_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active    BOOLEAN NOT NULL DEFAULT true,
    -- "one active device per account" and "one active binding per UUID" are
    -- enforced in the app layer (see routers/devices.py), matching the ORM
    -- which declares only UNIQUE(device_uuid). A partial/DEFERRABLE unique on
    -- (user_id, is_active) would break reregister (multiple is_active=false rows).
    UNIQUE (device_uuid)
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- Device change history for anomaly detection.
CREATE TABLE IF NOT EXISTS device_changes (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_device_uuid TEXT,
    new_device_uuid TEXT NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_via TEXT NOT NULL DEFAULT 'school_email'  -- @wku.ac.kr re-auth
);

-- ------------------------------------------------------------- courses
CREATE TABLE IF NOT EXISTS courses (
    id           TEXT PRIMARY KEY,
    professor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (course_id, student_id)
);

-- ------------------------------------------------------------ sessions
-- Attendance session with a ~60s auth window (professor-opened, extendable).
CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    window_opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_expires_at TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions(course_id);

-- ---------------------------------------------------------- attendance
-- Server uniqueness rule: one attendance per account AND per device UUID per session.
CREATE TABLE IF NOT EXISTS attendance (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('present', 'absent', 'pending')),
    verified_at  TIMESTAMPTZ,
    corrected_by TEXT REFERENCES users(id),           -- professor-in-the-loop
    -- uniqueness: one per (session, student) and one per (session, device)
    UNIQUE (session_id, student_id),
    UNIQUE (session_id, device_uuid)
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);

-- --------------------------------------------------------------- nonces
-- QR / audio nonces are primarily managed in Redis (15s TTL, single-use).
-- This table is an optional audit trail of consumed nonces (relay-attack forensics).
CREATE TABLE IF NOT EXISTS nonces (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('qr', 'audio')),
    value        TEXT NOT NULL,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at  TIMESTAMPTZ,                          -- set once used (single-use)
    consumed_by  TEXT REFERENCES users(id),
    UNIQUE (session_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_nonces_session ON nonces(session_id);
