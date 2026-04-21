-- Tranche 1: kg/lbs unit preference, intensity mode (RIR/RPE), warmup + intensity per set
--
-- Run once in Supabase SQL editor. Safe to re-run: all columns use IF NOT EXISTS
-- and are nullable or defaulted, so existing rows are unaffected.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS weight_unit TEXT DEFAULT 'kg'
    CHECK (weight_unit IN ('kg', 'lbs')),
  ADD COLUMN IF NOT EXISTS intensity_mode TEXT DEFAULT 'off'
    CHECK (intensity_mode IN ('off', 'rir', 'rpe'));

ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS is_warmup BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rir       NUMERIC(3,1),
  ADD COLUMN IF NOT EXISTS rpe       NUMERIC(3,1);
