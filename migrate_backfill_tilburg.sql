-- ============================================================
-- Backfill: stamp every existing workout with the user's "Tilburg Uni" gym.
--
-- Use this once per user (yourself + the two new accounts you sign up via
-- the app). Run AFTER the user has signed in at least once.
--
-- HOW TO USE
--   1. Replace 'PUT_USER_EMAIL_HERE' below with the target user's email.
--   2. Run the whole script in Supabase SQL Editor.
--   3. Repeat steps 1–2 for each user you want to backfill.
--
-- The script is idempotent: re-running it on the same user is a no-op.
-- It also picks the next free colour from the GYM_COLORS palette for the
-- new gym so your auto-assigned colours stay aligned with the JS code.
-- ============================================================

DO $$
DECLARE
  target_email   TEXT := 'PUT_USER_EMAIL_HERE';
  target_uid     UUID;
  tilburg_gym_id UUID;
  gym_color      TEXT;
  used_colors    TEXT[];
  palette        TEXT[] := ARRAY[
    '#FF5500', '#A855F7', '#22C55E', '#22D3EE',
    '#FACC15', '#EC4899', '#60A5FA', '#F97316'
  ];
  c              TEXT;
BEGIN
  -- 1. Resolve the user id from their email.
  SELECT id INTO target_uid
  FROM auth.users
  WHERE email = target_email;

  IF target_uid IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for email %', target_email;
  END IF;

  -- 2. Find or create the "Tilburg Uni" gym for this user.
  SELECT id INTO tilburg_gym_id
  FROM gyms
  WHERE user_id = target_uid AND name = 'Tilburg Uni';

  IF tilburg_gym_id IS NULL THEN
    -- Pick the first palette colour not already used by this user.
    SELECT array_agg(color) INTO used_colors FROM gyms WHERE user_id = target_uid;
    used_colors := COALESCE(used_colors, ARRAY[]::TEXT[]);
    gym_color := NULL;
    FOREACH c IN ARRAY palette LOOP
      IF NOT (c = ANY (used_colors)) THEN
        gym_color := c;
        EXIT;
      END IF;
    END LOOP;
    IF gym_color IS NULL THEN
      gym_color := palette[1];  -- recycle if all used
    END IF;

    INSERT INTO gyms (user_id, name, color)
    VALUES (target_uid, 'Tilburg Uni', gym_color)
    RETURNING id INTO tilburg_gym_id;
  END IF;

  -- 3. Make Tilburg Uni the user's active gym so future workouts auto-stamp.
  INSERT INTO profiles (id, active_gym_id)
  VALUES (target_uid, tilburg_gym_id)
  ON CONFLICT (id) DO UPDATE SET active_gym_id = EXCLUDED.active_gym_id;

  -- 4. Backfill every workout that doesn't already carry a gym.
  UPDATE workouts
  SET gym_id = tilburg_gym_id
  WHERE user_id = target_uid
    AND gym_id IS NULL;

  RAISE NOTICE 'Backfilled gym for user % (gym id %)', target_email, tilburg_gym_id;
END $$;
