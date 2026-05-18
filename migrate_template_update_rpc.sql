-- migrate_template_update_rpc.sql
-- Atomic template-definition replace. Single PL/pgSQL body = single
-- transaction: name update + exercises wipe + exercises reinsert either
-- all commit or all roll back. No half-state on network drops.
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.update_template(
  p_user_id      uuid,
  p_template_id  uuid,
  p_name         text,
  p_exercises    jsonb  -- array of {name, item_type?, target?}; sort_order = array index
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE
  v_name  text := nullif(btrim(p_name), '');
  v_count int;
BEGIN
  IF p_user_id IS NULL OR auth.uid() IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'user_id mismatch';
  END IF;
  IF p_template_id IS NULL THEN
    RAISE EXCEPTION 'template_id_required';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  -- Existence + ownership check. If the template was deleted out from
  -- under the caller, surface a distinct error so the UI can fall back
  -- to the save-as-new flow.
  SELECT count(*) INTO v_count
    FROM templates
   WHERE id = p_template_id
     AND user_id = p_user_id;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  UPDATE templates
     SET name = v_name
   WHERE id = p_template_id
     AND user_id = p_user_id;

  DELETE FROM template_exercises
   WHERE template_id = p_template_id;

  -- Bulk insert from the jsonb array. Array index → sort_order. Rows
  -- with blank names are skipped defensively (the JS layer should already
  -- filter these, but cheap to double-up).
  IF p_exercises IS NOT NULL AND jsonb_typeof(p_exercises) = 'array' THEN
    INSERT INTO template_exercises (template_id, exercise_name, item_type, target, sort_order)
    SELECT p_template_id,
           btrim(coalesce(elem->>'name', '')),
           coalesce(nullif(btrim(elem->>'item_type'), ''), 'exercise'),
           coalesce(elem->>'target', ''),
           (ord - 1)::int
      FROM jsonb_array_elements(p_exercises) WITH ORDINALITY arr(elem, ord)
     WHERE btrim(coalesce(elem->>'name', '')) <> '';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_template(uuid, uuid, text, jsonb) TO authenticated;
