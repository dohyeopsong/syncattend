-- Syncattend (SDAS) — 0004: normalized weekly schedules
-- Aligns with ../contracts/openapi.yaml AND app/models.py.
--
-- Adds `course_schedules` (one row per weekly time slot) so a course can meet
-- multiple times per week (e.g. Mon 1교시 + Tue 1교시), and links each session
-- to the slot it belongs to via sessions.schedule_id (nullable). Fresh boots
-- already get both via the updated 0001; this migrates existing databases.
--
-- Idempotent: CREATE TABLE / ADD COLUMN IF NOT EXISTS + guarded index. Postgres
-- only; SQLite test DBs are built from the ORM via Base.metadata.create_all.

CREATE TABLE IF NOT EXISTS course_schedules (
    id           TEXT PRIMARY KEY,
    course_id    TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    day_of_week  INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    start_period INTEGER NOT NULL,
    end_period   INTEGER NOT NULL,
    CHECK (start_period >= 1 AND end_period >= start_period),
    UNIQUE (course_id, day_of_week, start_period)
);
CREATE INDEX IF NOT EXISTS idx_course_schedules_course ON course_schedules(course_id);

-- Link sessions to the weekly slot they belong to (Mon vs Tue of same course).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS schedule_id TEXT;

-- Add the FK only if absent (ON DELETE SET NULL keeps sessions when a slot is removed).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_sessions_schedule'
    ) THEN
        ALTER TABLE sessions ADD CONSTRAINT fk_sessions_schedule
            FOREIGN KEY (schedule_id) REFERENCES course_schedules(id) ON DELETE SET NULL;
    END IF;
END $$;
