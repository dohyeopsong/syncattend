-- Syncattend (SDAS) — per-course semester start date for week estimation.
--
-- A session's week_number (1..15) can be auto-estimated from the current date
-- minus the course's semester_start_date. Stored per-course (not global) so the
-- next semester / seasonal term can start on a different date without touching a
-- global setting.
--
-- Pre-existing courses get a backfill of DATE '2026-09-01' (current semester
-- start) so estimation works for them immediately. New courses set this from the
-- create/update form; NULL means estimation is impossible -> manual fallback.

ALTER TABLE courses ADD COLUMN semester_start_date DATE;

-- Backfill every existing course to the current semester start.
UPDATE courses SET semester_start_date = DATE '2026-09-01'
    WHERE semester_start_date IS NULL;
