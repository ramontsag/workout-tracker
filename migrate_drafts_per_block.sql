-- Per-block draft scoping. The original draft uniqueness rule was
-- "one in-progress workout per (user, training_day)". With multi-block
-- days that's wrong: each block needs its own autosave draft.
--
-- Drop the old per-day index and replace it with a per-(day, block) one.
-- workout_block_id may be NULL on legacy/orphan drafts — Postgres treats
-- NULLs as distinct in unique indexes, which is fine for the rare orphan path.

DROP INDEX IF EXISTS workouts_one_inprogress_per_day_idx;

-- Backfill: any pre-existing in-progress draft with NULL workout_block_id
-- gets associated with its day's first block, so resume keeps working.
UPDATE workouts w
   SET workout_block_id = (
     SELECT wb.id FROM workout_blocks wb
      WHERE wb.training_day_id = w.training_day_id
      ORDER BY wb.sort_order ASC, wb.created_at ASC
      LIMIT 1
   )
 WHERE w.status = 'in_progress'
   AND w.workout_block_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS workouts_one_inprogress_per_day_block_idx
  ON workouts (user_id, training_day_id, workout_block_id)
  WHERE status = 'in_progress';
