-- 0005_user_student_id.sql
-- Add a unique student_id (학번) column to users.
--
-- Existing accounts (created before this column existed) get a synthetic,
-- guaranteed-unique placeholder so the NOT-NULL + UNIQUE constraints can be
-- added without breaking old rows. The placeholder is never shown to real
-- students — they set their real 학번 at signup. Professors get NULL.
--
-- Owner: CLI A. Mirror in contracts/openapi.yaml in the same change.

-- 1. Add the column as nullable first (no default, no constraint).
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id VARCHAR(32);

-- 2. Backfill: give every existing STUDENT a synthetic unique 학번. The
--    placeholder is a short sequential id ("L<n>") — short enough to fit
--    VARCHAR(32) (a real 학번 like "2026123456" fits easily too), and unique
--    because row_number() is. Professors stay NULL.
WITH numbered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM users
  WHERE role = 'student' AND student_id IS NULL
)
UPDATE users u
SET student_id = 'L' || n.rn::text
FROM numbered n
WHERE u.id = n.id;

-- 3. Enforce uniqueness. NULLs (professors) are allowed and do not conflict.
ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_student_id;
ALTER TABLE users ADD CONSTRAINT uq_users_student_id UNIQUE (student_id);
