-- Atomic saveProgram RPC.
--
-- Replaces the JS-side multi-step delete-then-insert flow. The whole
-- operation runs inside a single Postgres transaction (plpgsql functions
-- are atomic by default), so if anything fails — payload validation,
-- constraint violation, network drop server-side — every change rolls
-- back. The previous JS flow could leave a day with no exercises if the
-- delete succeeded but the insert failed.
--
-- Run this once in the Supabase SQL editor.

CREATE OR REPLACE FUNCTION public.save_program_atomic(
  p_user_id uuid,
  p_days    jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_day            jsonb;
  v_ex             record;
  v_day_id         uuid;
  v_existing_id    uuid;
  v_incoming_lower text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;
  -- Belt + suspenders: the caller's session must match the uid they passed.
  -- RLS on the underlying tables would block cross-user writes anyway, but
  -- this gives a clearer error message and short-circuits before any work.
  IF auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;

  -- Names of every day in the incoming payload, lowercased for case-
  -- insensitive matching against existing rows.
  SELECT COALESCE(array_agg(lower(d->>'name')), ARRAY[]::text[])
    INTO v_incoming_lower
    FROM jsonb_array_elements(p_days) AS d;

  -- 1) Drop training_days that exist in DB but were removed in the payload.
  --    FK CASCADE on exercises wipes their exercises too.
  DELETE FROM training_days
   WHERE user_id = p_user_id
     AND lower(name) <> ALL (v_incoming_lower);

  -- 2) For each incoming day: upsert by name → get id → wipe its exercises
  --    → re-insert from the payload.
  FOR v_day IN SELECT * FROM jsonb_array_elements(p_days)
  LOOP
    -- Locate existing day by case-insensitive name match.
    SELECT id INTO v_existing_id
      FROM training_days
     WHERE user_id = p_user_id
       AND lower(name) = lower(v_day->>'name')
     LIMIT 1;

    IF v_existing_id IS NOT NULL THEN
      UPDATE training_days
         SET name         = v_day->>'name',
             focus        = v_day->>'focus',
             color        = v_day->>'color',
             sort_order   = COALESCE((v_day->>'sort_order')::int, 0),
             rest_seconds = COALESCE((v_day->>'rest_seconds')::int, 90)
       WHERE id = v_existing_id
         AND user_id = p_user_id;
      v_day_id := v_existing_id;
    ELSE
      INSERT INTO training_days (
        user_id, name, focus, color, sort_order, rest_seconds
      ) VALUES (
        p_user_id,
        v_day->>'name',
        v_day->>'focus',
        v_day->>'color',
        COALESCE((v_day->>'sort_order')::int, 0),
        COALESCE((v_day->>'rest_seconds')::int, 90)
      )
      RETURNING id INTO v_day_id;
    END IF;

    -- 3) Wipe + re-insert this day's exercises.
    DELETE FROM exercises
     WHERE training_day_id = v_day_id
       AND user_id = p_user_id;

    -- 4) Insert each exercise. WITH ORDINALITY gives a 1-based index we can
    --    use as sort_order.
    FOR v_ex IN
      SELECT value, ordinality
        FROM jsonb_array_elements(COALESCE(v_day->'exercises', '[]'::jsonb))
        WITH ORDINALITY
    LOOP
      INSERT INTO exercises (
        user_id,
        training_day_id,
        name,
        target,
        item_type,
        track_mode,
        set_count,
        sort_order,
        activity_fields,
        superset_group,
        workout_block_id,
        has_drop_sets,
        drop_set_mode
      ) VALUES (
        p_user_id,
        v_day_id,
        v_ex.value->>'name',
        COALESCE(v_ex.value->>'target', ''),
        COALESCE(v_ex.value->>'item_type', 'exercise'),
        CASE WHEN COALESCE(v_ex.value->>'item_type','exercise') = 'exercise'
             THEN COALESCE(v_ex.value->>'track_mode', 'sets')
             ELSE 'sets' END,
        CASE WHEN COALESCE(v_ex.value->>'item_type','exercise') = 'exercise'
             THEN COALESCE(
                    NULLIF(v_ex.value->>'set_count','')::int,
                    CASE WHEN v_ex.value->>'track_mode' = 'check' THEN 1 ELSE 2 END
                  )
             ELSE NULL END,
        (v_ex.ordinality - 1)::int,
        CASE WHEN v_ex.value->>'item_type' = 'activity'
                  AND jsonb_typeof(v_ex.value->'activity_fields') = 'array'
             THEN v_ex.value->'activity_fields'
             ELSE NULL END,
        CASE WHEN COALESCE(v_ex.value->>'item_type','exercise') = 'exercise'
             THEN NULLIF(v_ex.value->>'superset_group', '')
             ELSE NULL END,
        CASE WHEN COALESCE(v_ex.value->>'item_type','exercise') = 'exercise'
             THEN NULLIF(v_ex.value->>'workout_block_id', '')::uuid
             ELSE NULL END,
        CASE WHEN COALESCE(v_ex.value->>'item_type','exercise') = 'exercise'
             THEN COALESCE((v_ex.value->>'has_drop_sets')::bool, false)
             ELSE false END,
        CASE WHEN COALESCE(v_ex.value->>'item_type','exercise') = 'exercise'
             THEN COALESCE(v_ex.value->>'drop_set_mode', 'off')
             ELSE 'off' END
      );
    END LOOP;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_program_atomic(uuid, jsonb) TO authenticated;
