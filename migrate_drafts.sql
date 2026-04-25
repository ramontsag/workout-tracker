-- Stage 1: in-progress workout drafts
--
-- Autosave during a workout means we need to distinguish drafts from
-- completed sessions. Existing rows are treated as 'completed' by default,
-- so all current history queries keep working as long as they're patched
-- to filter on status (see src/supabase.js).
--
-- Safe to re-run: IF NOT EXISTS on every column and index.

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS status      TEXT        NOT NULL DEFAULT 'completed'
    CHECK (status IN ('in_progress','completed')),
  ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Live UI state during a draft (sets/activityLogs/exerciseList).
  -- workout_sets is NOT written until completion, so we preserve exact
  -- string values like '' vs '0' that the user typed mid-workout.
  ADD COLUMN IF NOT EXISTS draft_state JSONB;

-- Lookup index for the resume flow / Home dot.
CREATE INDEX IF NOT EXISTS workouts_inprogress_idx
  ON workouts (user_id, status, training_day_id)
  WHERE status = 'in_progress';

-- At most one in-progress workout per training day per user.
-- Prevents duplicate drafts if the resume effect races with a fresh-create.
CREATE UNIQUE INDEX IF NOT EXISTS workouts_one_inprogress_per_day_idx
  ON workouts (user_id, training_day_id)
  WHERE status = 'in_progress';
