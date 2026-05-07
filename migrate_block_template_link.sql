-- Adds the link from a workout block back to its source template.
-- Used by "Apply changes to template" buttons in EditDayModal and the
-- post-workout extra-sets banner — without this column, we can't reliably
-- find which template a day's block came from.

ALTER TABLE workout_blocks
  ADD COLUMN IF NOT EXISTS template_id UUID
    REFERENCES templates(id) ON DELETE SET NULL;

-- Best-effort backfill so existing template-derived blocks don't lose
-- the link. Matches by case-insensitive name within the same user; not
-- perfect but covers the typical "applied a template, kept its name"
-- case. New blocks created via createWorkoutBlock(... fromTemplateId)
-- will set this column directly.
UPDATE workout_blocks wb
   SET template_id = t.id
  FROM templates t
 WHERE wb.user_id = t.user_id
   AND lower(wb.name) = lower(t.name)
   AND wb.template_id IS NULL;
