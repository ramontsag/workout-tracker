-- Add optional target text to exercises (e.g. '3 sets of 8-10 reps')
-- Safe to run on existing database — existing rows default to empty string.
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS target TEXT NOT NULL DEFAULT '';
