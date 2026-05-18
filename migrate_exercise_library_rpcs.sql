-- migrate_exercise_library_rpcs.sql
-- Adds atomic rename / merge / delete functions for the Manage Exercises screen.
-- Safe to re-run (CREATE OR REPLACE).

-- ── rename_exercise ─────────────────────────────────────────────
-- Renames one exercise across workout_sets, exercises, template_exercises.
-- Fails if the target name already exists as a DIFFERENT exercise
-- (case-insensitive). Pure case changes (lower(from) = lower(to)) are
-- allowed and fall through to update.
CREATE OR REPLACE FUNCTION public.rename_exercise(
  p_user_id  uuid,
  p_from     text,
  p_to       text
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_from text := nullif(btrim(p_from), '');
  v_to   text := nullif(btrim(p_to),   '');
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;
  IF v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION 'names_required';
  END IF;

  -- Collision: any existing name that case-insensitively equals v_to
  -- AND is not just a case-variant of v_from.
  IF EXISTS (
    SELECT 1 FROM (
      SELECT name AS n FROM exercises       WHERE user_id = p_user_id
      UNION
      SELECT exercise_name FROM workout_sets WHERE user_id = p_user_id
    ) x
    WHERE lower(x.n) = lower(v_to)
      AND lower(x.n) <> lower(v_from)
  ) THEN
    RAISE EXCEPTION 'duplicate_name';
  END IF;

  UPDATE workout_sets
     SET exercise_name = v_to
   WHERE user_id = p_user_id
     AND exercise_name = v_from;

  UPDATE exercises
     SET name = v_to
   WHERE user_id = p_user_id
     AND name = v_from;

  UPDATE template_exercises te
     SET exercise_name = v_to
   WHERE te.exercise_name = v_from
     AND EXISTS (
       SELECT 1 FROM templates t
        WHERE t.id = te.template_id
          AND t.user_id = p_user_id
     );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rename_exercise(uuid, text, text) TO authenticated;

-- ── merge_exercise ──────────────────────────────────────────────
-- Defensive ordering: collisions are deleted BEFORE the rename UPDATE
-- so the function works whether or not template_exercises has a
-- UNIQUE (template_id, lower(exercise_name)) constraint. Same for
-- exercises (training_day_id + name).
CREATE OR REPLACE FUNCTION public.merge_exercise(
  p_user_id  uuid,
  p_from     text,
  p_to       text
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_from text := nullif(btrim(p_from), '');
  v_to   text := nullif(btrim(p_to),   '');
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;
  IF v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION 'names_required';
  END IF;
  IF lower(v_from) = lower(v_to) THEN
    RAISE EXCEPTION 'same_name';
  END IF;

  -- 1) Move every logged set from from → to. workout_sets has no
  --    uniqueness on exercise_name, so a plain UPDATE is fine.
  UPDATE workout_sets
     SET exercise_name = v_to
   WHERE user_id = p_user_id
     AND exercise_name = v_from;

  -- 2a) exercises: pre-delete v_from rows that would collide on the
  --     same training_day with an existing v_to row.
  DELETE FROM exercises e1
   WHERE e1.user_id = p_user_id
     AND lower(e1.name) = lower(v_from)
     AND EXISTS (
       SELECT 1 FROM exercises e2
        WHERE e2.user_id = p_user_id
          AND e2.training_day_id = e1.training_day_id
          AND lower(e2.name) = lower(v_to)
     );

  -- 2b) Rename surviving v_from rows.
  UPDATE exercises
     SET name = v_to
   WHERE user_id = p_user_id
     AND name = v_from;

  -- 2c) Final dedupe: collapse multiple v_to rows on the same
  --     training_day (only reachable when there is no UNIQUE
  --     constraint and the user had duplicate v_from rows pre-existing).
  DELETE FROM exercises
   WHERE id IN (
     SELECT id FROM (
       SELECT id,
              row_number() OVER (
                PARTITION BY training_day_id, lower(name)
                ORDER BY sort_order, id
              ) AS rn
         FROM exercises
        WHERE user_id = p_user_id
          AND lower(name) = lower(v_to)
     ) s
     WHERE rn > 1
   );

  -- 3a) template_exercises: pre-delete v_from rows that would collide
  --     inside the same template with an existing v_to row.
  DELETE FROM template_exercises te1
   WHERE lower(te1.exercise_name) = lower(v_from)
     AND EXISTS (
       SELECT 1 FROM templates t
        WHERE t.id = te1.template_id
          AND t.user_id = p_user_id
     )
     AND EXISTS (
       SELECT 1 FROM template_exercises te2
        WHERE te2.template_id = te1.template_id
          AND lower(te2.exercise_name) = lower(v_to)
     );

  -- 3b) Rename surviving v_from rows.
  UPDATE template_exercises te
     SET exercise_name = v_to
   WHERE te.exercise_name = v_from
     AND EXISTS (
       SELECT 1 FROM templates t
        WHERE t.id = te.template_id
          AND t.user_id = p_user_id
     );

  -- 3c) Final dedupe inside each template.
  DELETE FROM template_exercises
   WHERE id IN (
     SELECT id FROM (
       SELECT te.id,
              row_number() OVER (
                PARTITION BY te.template_id, lower(te.exercise_name)
                ORDER BY te.sort_order, te.id
              ) AS rn
         FROM template_exercises te
         JOIN templates t ON t.id = te.template_id
        WHERE t.user_id = p_user_id
          AND lower(te.exercise_name) = lower(v_to)
     ) s
     WHERE rn > 1
   );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_exercise(uuid, text, text) TO authenticated;

-- ── delete_exercise_completely ──────────────────────────────────
-- Removes the exercise from the user's library, history, and templates.
-- Parent `workouts` rows are left intact (a workout may have other
-- exercises). If you'd rather purge workouts that become empty, do it
-- from JS after this call.
CREATE OR REPLACE FUNCTION public.delete_exercise_completely(
  p_user_id  uuid,
  p_name     text
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_name text := nullif(btrim(p_name), '');
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  DELETE FROM workout_sets
   WHERE user_id = p_user_id
     AND exercise_name = v_name;

  DELETE FROM exercises
   WHERE user_id = p_user_id
     AND name = v_name;

  DELETE FROM template_exercises te
   WHERE te.exercise_name = v_name
     AND EXISTS (
       SELECT 1 FROM templates t
        WHERE t.id = te.template_id
          AND t.user_id = p_user_id
     );
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_exercise_completely(uuid, text) TO authenticated;
