-- Adds timer_enabled to workout_blocks. The gear-menu "Disable rest timer"
-- toggle (WorkoutDay.jsx) writes this column; without it, those PATCHes
-- silently 400 because the column never existed in the original schema.
-- The reads default to true via `?? true`, so existing data is unaffected.
-- Safe to re-run.

ALTER TABLE workout_blocks
  ADD COLUMN IF NOT EXISTS timer_enabled boolean NOT NULL DEFAULT true;
