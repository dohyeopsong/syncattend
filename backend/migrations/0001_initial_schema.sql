-- Syncattend (SDAS) — initial schema (draft)
-- Owner A only. Aligns with ../contracts/openapi.yaml.
-- Applied automatically by Postgres via docker-entrypoint-initdb.d (see infra/).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- ---------------------------------------------------------------- users
CREATE TABLE IF NOT EXISTS users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid  UUID NOT NULL,                    -- app-generated, stored in Keychain/Keystore
    bound_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active    BOOLEAN NOT NULL DEFAULT true,
    UNIQUE (user_id, is_active) DEFERRABLE INITIALLY DEFERRED,
    UNIQUE (device_uuid)
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- Device change history for anomaly detection.
CREATE TABLE IF NOT EXISTS device_changes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    old_device_uuid UUID,
    new_device_uuid UUID NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_via TEXT NOT NULL DEFAULT 'school_email'  -- @wku.ac.kr re-auth
);

-- ------------------------------------------------------------- courses
CREATE TABLE IF NOT EXISTS courses (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    professor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
    course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (course_id, student_id)
);

-- ------------------------------------------------------------ sessions
-- Attendance session with a ~60s auth window (professor-opened, extendable).
CREATE TABLE IF NOT EXISTS sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    window_opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    window_expires_at TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions(course_id);

-- ---------------------------------------------------------- attendance
-- Server uniqueness rule: one attendance per account AND per device UUID per session.
CREATE TABLE IF NOT EXISTS attendance (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_uuid  UUID NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('present', 'absent', 'pending')),
    verified_at  TIMESTAMPTZ,
    corrected_by UUID REFERENCES users(id),           -- professor-in-the-loop
    -- uniqueness: one per (session, student) and one per (session, device)
    UNIQUE (session_id, student_id),
    UNIQUE (session_id, device_uuid)
);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);

-- --------------------------------------------------------------- nonces
-- QR / audio nonces are primarily managed in Redis (15s TTL, single-use).
-- This table is an optional audit trail of consumed nonces (relay-attack forensics).
CREATE TABLE IF NOT EXISTS nonces (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL CHECK (kind IN ('qr', 'audio')),
    value        TEXT NOT NULL,
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    consumed_at  TIMESTAMPTZ,                          -- set once used (single-use)
    consumed_by  UUID REFERENCES users(id),
    UNIQUE (session_id, kind, value)
);
CREATE INDEX IF NOT EXISTS idx_nonces_session ON nonces(session_id);
