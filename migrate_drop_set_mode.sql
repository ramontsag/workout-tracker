-- Adds a tri-state drop_set_mode ('off' | 'all' | 'last') for exercises so users
-- can configure drop sets to apply to every working set, only the last working
-- set, or be disabled entirely. Backfills from the existing has_drop_sets bool
-- so previously-enabled exercises default to 'all'. Safe to re-run.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS drop_set_mode text NOT NULL DEFAULT 'off';

ALTER TABLE exercises
  DROP CONSTRAINT IF EXISTS exercises_drop_set_mode_chk;

ALTER TABLE exercises
  ADD CONSTRAINT exercises_drop_set_mode_chk
  CHECK (drop_set_mode IN ('off', 'all', 'last'));

UPDATE exercises
   SET drop_set_mode = 'all'
 WHERE has_drop_sets = true
   AND drop_set_mode = 'off';
