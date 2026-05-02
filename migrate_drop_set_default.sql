-- Hardens workout_sets.is_drop_set so missing payload keys can no longer
-- trigger "null value in column is_drop_set ... violates not-null constraint".
-- Backfills any pre-existing NULLs (defensive — there shouldn't be any if the
-- column was created NOT NULL, but harmless if there are).
--
-- Safe to re-run.

UPDATE workout_sets SET is_drop_set = false WHERE is_drop_set IS NULL;

ALTER TABLE workout_sets
  ALTER COLUMN is_drop_set SET DEFAULT false,
  ALTER COLUMN is_drop_set SET NOT NULL;
