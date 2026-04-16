-- ============================================================
-- Workout Tracker — Full Schema (Auth-enabled, Multi-user)
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Drop old tables if you ran a previous schema
DROP TABLE IF EXISTS workout_sets      CASCADE;
DROP TABLE IF EXISTS workouts          CASCADE;
DROP TABLE IF EXISTS activity_logs     CASCADE;
DROP TABLE IF EXISTS activity_sessions CASCADE;
DROP TABLE IF EXISTS activity_types    CASCADE;
DROP TABLE IF EXISTS activity_days     CASCADE;

-- ── Profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Training Days (weight-room sessions) ──────────────────────
CREATE TABLE IF NOT EXISTS training_days (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  focus      TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#f97316',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exercises (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  training_day_id UUID NOT NULL REFERENCES training_days(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS workouts (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  training_day_id UUID REFERENCES training_days(id) ON DELETE SET NULL,
  day_name        TEXT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workout_sets (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id    UUID NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  exercise_name TEXT NOT NULL,
  set_number    INTEGER NOT NULL,
  weight_kg     NUMERIC(6,2) NOT NULL DEFAULT 0,
  reps          INTEGER NOT NULL DEFAULT 0
);

-- ── Activity Days (cardio / rest / sport sessions) ────────────
CREATE TABLE IF NOT EXISTS activity_days (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Activities that belong to an activity day (e.g. Cardio, Mobility)
CREATE TABLE IF NOT EXISTS activity_types (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_day_id UUID NOT NULL REFERENCES activity_days(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- A logged activity session (one per day visit)
CREATE TABLE IF NOT EXISTS activity_sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_day_id UUID REFERENCES activity_days(id) ON DELETE SET NULL,
  day_name        TEXT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Individual checkbox + notes per activity in a session
CREATE TABLE IF NOT EXISTS activity_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  activity_name TEXT NOT NULL,
  checked       BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT NOT NULL DEFAULT ''
);

-- ── Row-Level Security ────────────────────────────────────────
ALTER TABLE profiles          ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE exercises         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workouts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workout_sets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_profile"            ON profiles          FOR ALL USING (id       = auth.uid()) WITH CHECK (id       = auth.uid());
CREATE POLICY "own_training_days"      ON training_days     FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_exercises"          ON exercises         FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_workouts"           ON workouts          FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_workout_sets"       ON workout_sets      FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_activity_days"      ON activity_days     FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_activity_types"     ON activity_types    FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_activity_sessions"  ON activity_sessions FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());
CREATE POLICY "own_activity_logs"      ON activity_logs     FOR ALL USING (user_id  = auth.uid()) WITH CHECK (user_id  = auth.uid());

-- ── Auto-create profile on sign-up ───────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (new.id, new.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
