-- Tranche 2: richer activity tracking (hybrid app)
--
-- Safe to re-run: all columns IF NOT EXISTS, all nullable.
-- Canonical units in DB: km for distance, meters for elevation. Display
-- conversion (mi/ft) happens at the UI layer based on profile.weight_unit.

-- Per-activity field configuration. JSONB array of field keys,
-- e.g. ["duration_min","distance_km","avg_hr","notes"].
-- Only meaningful when exercises.item_type = 'activity'.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS activity_fields JSONB;

-- Logged activity metrics live alongside exercise sets in workout_sets
-- (rows with set_number=1 for activities are already the convention).
ALTER TABLE workout_sets
  ADD COLUMN IF NOT EXISTS duration_min NUMERIC(6,1),
  ADD COLUMN IF NOT EXISTS distance_km  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS intensity    SMALLINT CHECK (intensity BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS avg_hr       SMALLINT CHECK (avg_hr BETWEEN 30 AND 250),
  ADD COLUMN IF NOT EXISTS calories     NUMERIC(6,0),
  ADD COLUMN IF NOT EXISTS rounds       SMALLINT,
  ADD COLUMN IF NOT EXISTS elevation_m  NUMERIC(6,0);
