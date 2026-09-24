-- Syncattend (SDAS) — 0002: course schedule/catalog fields
-- Owner A only. Aligns with ../contracts/openapi.yaml AND app/models.py.
--
-- Adds optional timetable/catalog metadata to courses so the app can build
-- real timetables (요일/교시/강의실/학점/학수번호/학과). All columns are
-- nullable for backward compatibility with courses created under 0001.
--
-- Idempotent: uses ADD COLUMN IF NOT EXISTS so re-running (or running after a
-- fresh 0001 that already includes these columns) is a no-op. Postgres only;
-- SQLite test DBs are built directly from the ORM via Base.metadata.create_all.

ALTER TABLE courses ADD COLUMN IF NOT EXISTS code           TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS department     TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS professor_name TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS day_of_week    INTEGER;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS start_period   INTEGER;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS end_period     INTEGER;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS location       TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS credits        NUMERIC(3,1);

-- Guard day_of_week range (0=Mon..6=Sun). Add the constraint only if absent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ck_courses_day_of_week'
    ) THEN
        ALTER TABLE courses ADD CONSTRAINT ck_courses_day_of_week
            CHECK (day_of_week IS NULL OR (day_of_week >= 0 AND day_of_week <= 6));
    END IF;
END $$;
