-- Adds an has_drop_sets flag on exercises so the live workout UI only shows
-- the "+ Drop" button on exercises configured for drop sets. Configured per
-- exercise in the Edit Day modal.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS has_drop_sets boolean NOT NULL DEFAULT false;
