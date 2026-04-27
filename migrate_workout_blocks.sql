-- workout_blocks: groups exercises under a name on a training_day.
-- Adds per-block rest_seconds (was previously only on training_days).
-- Backfills one block per existing day that has exercises.

CREATE TABLE IF NOT EXISTS workout_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  training_day_id uuid NOT NULL REFERENCES training_days(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT 'Workout',
  sort_order      integer NOT NULL DEFAULT 0,
  rest_seconds    integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workout_blocks_user ON workout_blocks(user_id);
CREATE INDEX IF NOT EXISTS idx_workout_blocks_day  ON workout_blocks(training_day_id);

ALTER TABLE workout_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "blocks_select_own" ON workout_blocks;
CREATE POLICY "blocks_select_own" ON workout_blocks
  FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "blocks_insert_own" ON workout_blocks;
CREATE POLICY "blocks_insert_own" ON workout_blocks
  FOR INSERT WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "blocks_update_own" ON workout_blocks;
CREATE POLICY "blocks_update_own" ON workout_blocks
  FOR UPDATE USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "blocks_delete_own" ON workout_blocks;
CREATE POLICY "blocks_delete_own" ON workout_blocks
  FOR DELETE USING (auth.uid() = user_id);

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS workout_block_id uuid
  REFERENCES workout_blocks(id) ON DELETE CASCADE;

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS workout_block_id uuid
  REFERENCES workout_blocks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_exercises_block ON exercises(workout_block_id);
CREATE INDEX IF NOT EXISTS idx_workouts_block  ON workouts(workout_block_id);

INSERT INTO workout_blocks (user_id, training_day_id, name, sort_order, rest_seconds)
SELECT td.user_id,
       td.id,
       COALESCE(NULLIF(trim(td.focus), ''), 'Workout'),
       0,
       td.rest_seconds
  FROM training_days td
 WHERE EXISTS (
   SELECT 1 FROM exercises e
    WHERE e.training_day_id = td.id
      AND COALESCE(e.item_type, 'exercise') <> 'activity'
 )
 AND NOT EXISTS (
   SELECT 1 FROM workout_blocks wb WHERE wb.training_day_id = td.id
 );

UPDATE exercises e
   SET workout_block_id = wb.id
  FROM workout_blocks wb
 WHERE wb.training_day_id = e.training_day_id
   AND COALESCE(e.item_type, 'exercise') <> 'activity'
   AND e.workout_block_id IS NULL;
