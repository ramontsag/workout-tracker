-- ============================================================
-- Unified Days Migration
-- Run in Supabase SQL Editor.
-- Safe on existing data — uses IF NOT EXISTS / ON CONFLICT.
-- ============================================================

-- 1. item_type column on exercises ('exercise' | 'activity')
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'exercise';

-- 2. checked + notes on workout_sets so activity items can be logged
--    alongside exercise items in the same workout row
ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS checked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';

-- 3. Copy activity_days into training_days
--    focus = '' because activity days don't have a training focus
INSERT INTO training_days (id, user_id, name, focus, color, sort_order, created_at)
SELECT id, user_id, name, '', color, sort_order, created_at
FROM activity_days
ON CONFLICT (id) DO NOTHING;

-- 4. Copy activity_types into exercises, marked as item_type = 'activity'
INSERT INTO exercises (id, user_id, training_day_id, name, target, sort_order, item_type)
SELECT id, user_id, activity_day_id, name, '', sort_order, 'activity'
FROM activity_types
ON CONFLICT (id) DO NOTHING;
