-- ============================================================
-- Activity Days Migration
-- Run this in the Supabase SQL Editor.
-- Safe to run on an existing database — leaves workout data
-- completely untouched. Uses IF NOT EXISTS throughout.
-- ============================================================

-- ── Activity Days (e.g. Tuesday, Wednesday, Friday) ──────────
CREATE TABLE IF NOT EXISTS activity_days (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Activity Types (e.g. Cardio, Workout, Mobility) ──────────
CREATE TABLE IF NOT EXISTS activity_types (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_day_id UUID NOT NULL REFERENCES activity_days(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ── Activity Sessions (one per logged day visit) ──────────────
CREATE TABLE IF NOT EXISTS activity_sessions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_day_id UUID REFERENCES activity_days(id) ON DELETE SET NULL,
  day_name        TEXT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Activity Logs (checkbox + notes per activity) ─────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id    UUID NOT NULL REFERENCES activity_sessions(id) ON DELETE CASCADE,
  activity_name TEXT NOT NULL,
  checked       BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT NOT NULL DEFAULT ''
);

-- ── Row-Level Security ────────────────────────────────────────
ALTER TABLE activity_days     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_types    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs     ENABLE ROW LEVEL SECURITY;

-- Drop policies first so this is safe to re-run
DROP POLICY IF EXISTS "own_activity_days"     ON activity_days;
DROP POLICY IF EXISTS "own_activity_types"    ON activity_types;
DROP POLICY IF EXISTS "own_activity_sessions" ON activity_sessions;
DROP POLICY IF EXISTS "own_activity_logs"     ON activity_logs;

CREATE POLICY "own_activity_days"     ON activity_days     FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_activity_types"    ON activity_types    FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_activity_sessions" ON activity_sessions FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "own_activity_logs"     ON activity_logs     FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
