-- Syncattend (SDAS) — 0003: session week number (1..15주차)
-- Aligns with ../contracts/openapi.yaml AND app/models.py.
--
-- Adds an optional academic week number to attendance sessions so attendance
-- can be reported per week ("1주차 출석" .. "15주차 출석"). Nullable for
-- backward compatibility with sessions created under 0001; fresh boots already
-- get the column via the updated 0001 CREATE TABLE sessions.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + guarded CHECK constraint, so re-running
-- (or running after a fresh 0001) is a no-op. Postgres only; SQLite test DBs are
-- built directly from the ORM via Base.metadata.create_all.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS week_number INTEGER;

-- Guard week_number range (1..15). Add the constraint only if absent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_sessions_week_number'
    ) THEN
        ALTER TABLE sessions ADD CONSTRAINT ck_sessions_week_number
            CHECK (week_number IS NULL OR (week_number >= 1 AND week_number <= 15));
    END IF;
END $$;
