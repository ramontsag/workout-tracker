-- ============================================================
-- Range constraints on workout_sets.rir / workout_sets.rpe
--
-- Both columns are NUMERIC(3,1) and were added without bounds,
-- so a stray "-5" or "99" would persist. RIR/RPE only make sense
-- in [0, 10], so enforce that at the DB layer too.
--
-- The DELETE first nukes any pre-existing out-of-range rows so
-- the constraint can be added without ALTER ... NOT VALID gymnastics.
-- ============================================================

UPDATE workout_sets SET rir = NULL WHERE rir IS NOT NULL AND (rir < 0 OR rir > 10);
UPDATE workout_sets SET rpe = NULL WHERE rpe IS NOT NULL AND (rpe < 0 OR rpe > 10);

ALTER TABLE workout_sets
  DROP CONSTRAINT IF EXISTS workout_sets_rir_range,
  DROP CONSTRAINT IF EXISTS workout_sets_rpe_range;

ALTER TABLE workout_sets
  ADD CONSTRAINT workout_sets_rir_range CHECK (rir IS NULL OR (rir >= 0 AND rir <= 10)),
  ADD CONSTRAINT workout_sets_rpe_range CHECK (rpe IS NULL OR (rpe >= 0 AND rpe <= 10));
