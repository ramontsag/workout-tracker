-- ============================================================
-- Gym tags
-- Run in Supabase SQL editor. Safe to re-run.
-- ============================================================

-- 1. Per-user gym list. Color is assigned by the client from a fixed
--    rotation; users can rename/delete but never pick a color.
CREATE TABLE IF NOT EXISTS gyms (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

-- 2. Currently active gym pointer on profiles. Single source of truth so
--    "current gym" can never be ambiguous. ON DELETE SET NULL so deleting a
--    gym doesn't break the profile row.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS active_gym_id UUID REFERENCES gyms(id) ON DELETE SET NULL;

-- 3. Stamp every workout with the gym it was logged at, captured at start
--    time. Workouts older than this migration stay NULL — graphs render
--    them in a neutral "unknown gym" colour.
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS gym_id UUID REFERENCES gyms(id) ON DELETE SET NULL;

-- 4. RLS — same per-user pattern as the rest of the schema.
ALTER TABLE gyms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_gyms" ON gyms;
CREATE POLICY "own_gyms" ON gyms
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 5. Useful indexes for the lookups the app actually does.
CREATE INDEX IF NOT EXISTS workouts_gym_id_idx ON workouts (gym_id);
CREATE INDEX IF NOT EXISTS gyms_user_id_idx    ON gyms     (user_id);
