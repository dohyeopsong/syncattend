-- Syncattend (SDAS) — dual-auth (start + end) attendance redesign.
--
-- Replaces the single auth-window model with a two-phase lifecycle:
--   check_in  -> the "start of class" auth window is open
--   check_out -> the "end of class" auth window is open (professor opens it)
--   closed    -> session finalised; attendance states are derived at batchClose
--
-- Pre-launch change: no existing attendance data to migrate. The final status
-- (present / late / early_leave / absent) is DERIVED from the two timestamps
-- below at close time, so verified_at is split into check_in/check_out stamps.
--
-- Aligns with app/models.py and contracts/openapi.yaml (owner A keeps in sync).

-- sessions: status(open/closed) -> phase(check_in/check_out/closed)
ALTER TABLE sessions DROP COLUMN status;
ALTER TABLE sessions ADD COLUMN phase TEXT NOT NULL DEFAULT 'check_in'
    CHECK (phase IN ('check_in', 'check_out', 'closed'));

-- attendance: verified_at -> check_in_verified_at + check_out_verified_at
ALTER TABLE attendance DROP COLUMN verified_at;
ALTER TABLE attendance ADD COLUMN check_in_verified_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN check_out_verified_at TIMESTAMPTZ;

-- attendance.status gains late / early_leave (final states derived at close).
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS ck_attendance_status;
ALTER TABLE attendance ADD CONSTRAINT ck_attendance_status
    CHECK (status IN ('present', 'absent', 'late', 'early_leave', 'pending'));
