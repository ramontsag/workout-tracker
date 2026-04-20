import { createClient } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────
// SINGLE INSTANCE — created once at module level.
//
// Why globalThis: Vite HMR re-executes this module on every file
// save. Without the guard, createClient() runs again → second
// GoTrueClient → two instances race for the same browser
// Navigator Lock → NavigatorLockAcquireTimeoutError everywhere.
//
// globalThis survives HMR re-evaluation. The `if` is false on
// every subsequent reload so the existing client is reused.
// ─────────────────────────────────────────────────────────────
const _KEY = '__supabase_wt__'

if (!globalThis[_KEY]) {
  globalThis[_KEY] = createClient(
    'https://vqcdmdvajknmzpecyodr.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZxY2RtZHZhamtubXpwZWN5b2RyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MjU5MjYsImV4cCI6MjA5MTUwMTkyNn0.MY8yxZ-TJP6Lf5mmADK-fvYkhY4v1x_qqIE46RZ2BiI',
    {
      auth: {
        persistSession: true,
        // Skipping URL detection removes a lock acquisition on every init
        detectSessionInUrl: false,
        // PKCE avoids implicit-flow URL fragments, fewer lock touchpoints
        flowType: 'pkce',
        // Explicit adapter — no runtime detection, no extra lock contention
        storage: window.localStorage,
      },
      db:     { schema: 'public' },
      global: { headers: {} },
    }
  )
}

export const supabase = globalThis[_KEY]

// ─────────────────────────────────────────────────────────────
// Timeout wrapper — every network call goes through this.
// Rejects with a user-friendly message if the promise stalls.
// ─────────────────────────────────────────────────────────────
function withTimeout(promise, ms = 5000, label = 'Request') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out — check your connection and try again`)),
      ms
    )
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

// ── Auth ──────────────────────────────────────────────────────
// Auth functions only call supabase.auth.* — never supabase.from().
// DB functions (below) receive uid as a parameter so they never
// touch auth at all, eliminating every cross-concern lock conflict.

export async function signIn(email, password) {
  const { data, error } = await withTimeout(
    supabase.auth.signInWithPassword({ email, password }),
    5000, 'Login'
  )
  if (error) throw error
  return data
}

export async function signUp(email, password, name) {
  const { data, error } = await withTimeout(
    supabase.auth.signUp({ email, password, options: { data: { name } } }),
    5000, 'Sign up'
  )
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await withTimeout(supabase.auth.signOut(), 5000, 'Sign out')
  if (error) throw error
}

export async function resetPassword(email) {
  const { error } = await withTimeout(
    supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
    5000, 'Password reset'
  )
  if (error) throw error
}

// ── Profile ───────────────────────────────────────────────────

export async function getProfile() {
  const { data, error } = await withTimeout(
    supabase.from('profiles').select('*').single(),
    5000, 'Load profile'
  )
  if (error) return null
  return data
}

// ── Program ───────────────────────────────────────────────────

export async function getProgram() {
  // Query both tables in parallel.
  // activity_days may or may not still exist (depends on whether
  // migrate_unified.sql has been run). The catch makes it non-fatal.
  const [trainingResult, activityResult] = await Promise.all([
    withTimeout(
      supabase.from('training_days').select('*, exercises(*)').order('sort_order', { ascending: true }),
      5000, 'Load training days'
    ),
    withTimeout(
      supabase.from('activity_days').select('*, activity_types(*)').order('sort_order', { ascending: true }),
      5000, 'Load activity days'
    ).catch(() => ({ data: null, error: null })),
  ])

  if (trainingResult.error) throw new Error(`Could not load program: ${trainingResult.error.message}`)

  const trainingDays = (trainingResult.data || []).map(day => ({
    id:           day.id,
    name:         day.name,
    focus:        day.focus,
    color:        day.color,
    sort_order:   day.sort_order,
    rest_seconds: day.rest_seconds ?? 90,
    exercises:    (day.exercises || [])
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(e => ({ name: e.name, target: e.target || '', item_type: e.item_type || 'exercise' })),
  }))

  // Names already covered by training_days — used to skip duplicates
  // after migration_unified.sql copies activity_days into training_days.
  const trainingNames = new Set(trainingDays.map(d => d.name.toLowerCase()))

  const activityDays = (activityResult.data || [])
    .filter(day => !trainingNames.has(day.name.toLowerCase()))
    .map(day => ({
      id:         day.id,
      name:       day.name,
      focus:      '',
      color:      day.color,
      sort_order: day.sort_order,
      exercises:  (day.activity_types || [])
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(a => ({ name: a.name, target: '', item_type: 'activity' })),
    }))

  return [...trainingDays, ...activityDays]
}

// uid is passed in from App state — this function never calls any
// auth method so it never acquires the Navigator Lock.
export async function saveProgram(days, uid) {
  if (!uid) throw new Error('Not authenticated — please log in again')

  const db = (q, label) => withTimeout(q, 5000, label)

  // 1 — fetch existing days to decide update vs insert
  const { data: existing, error: fetchErr } = await db(
    supabase.from('training_days').select('id, name').eq('user_id', uid),
    'Fetch existing days'
  )
  if (fetchErr) throw new Error(`Fetch failed: ${fetchErr.message}`)

  const existingByName = Object.fromEntries(
    (existing || []).map(d => [d.name.toLowerCase(), d.id])
  )
  const incomingNames = new Set(days.map(d => d.name.toLowerCase()))

  const toUpdate = []
  const toInsert = []
  days.forEach((day, i) => {
    const id = existingByName[day.name.toLowerCase()]
    if (id) toUpdate.push({ ...day, id, sort_order: i })
    else     toInsert.push({ ...day, sort_order: i })
  })

  const toDelete = (existing || [])
    .filter(d => !incomingNames.has(d.name.toLowerCase()))
    .map(d => d.id)

  const dayIdMap = {}

  // 2 — delete removed days (CASCADE deletes their exercises)
  if (toDelete.length) {
    const { error } = await db(
      supabase.from('training_days').delete().in('id', toDelete),
      'Delete removed days'
    )
    if (error) throw new Error(`Delete failed: ${error.message}`)
  }

  // 3 — upsert existing days (preserves IDs → workout history stays linked)
  if (toUpdate.length) {
    const { error } = await db(
      supabase.from('training_days').upsert(
        toUpdate.map(d => ({
          id: d.id, user_id: uid,
          name: d.name, focus: d.focus, color: d.color, sort_order: d.sort_order,
          rest_seconds: d.rest_seconds ?? 90,
        })),
        { onConflict: 'id' }
      ),
      'Update existing days'
    )
    if (error) throw new Error(`Update failed: ${error.message}`)
    toUpdate.forEach(d => { dayIdMap[d.name.toLowerCase()] = d.id })
  }

  // 4 — insert new days, capture their generated IDs
  if (toInsert.length) {
    const { data: newDays, error } = await db(
      supabase
        .from('training_days')
        .insert(toInsert.map(d => ({
          user_id: uid,
          name: d.name, focus: d.focus, color: d.color, sort_order: d.sort_order,
          rest_seconds: d.rest_seconds ?? 90,
        })))
        .select('id, name'),
      'Insert new days'
    )
    if (error) throw new Error(`Insert days failed: ${error.message}`)
    ;(newDays || []).forEach(d => { dayIdMap[d.name.toLowerCase()] = d.id })
  }

  // 5a — delete old exercises for updated days
  const updatedIds = toUpdate.map(d => d.id)
  if (updatedIds.length) {
    const { error } = await db(
      supabase.from('exercises').delete().in('training_day_id', updatedIds),
      'Delete old exercises'
    )
    if (error) throw new Error(`Delete exercises failed: ${error.message}`)
  }

  // 5b — batch insert all exercises in one round trip
  const allExercises = []
  for (const day of days) {
    const dayId = dayIdMap[day.name.toLowerCase()]
    if (!dayId) continue
    day.exercises.forEach((ex, j) =>
      allExercises.push({
        user_id:         uid,
        training_day_id: dayId,
        name:            ex.name,
        target:          ex.target || '',
        item_type:       ex.item_type || 'exercise',
        sort_order:      j,
      })
    )
  }
  if (allExercises.length) {
    const { error } = await db(
      supabase.from('exercises').insert(allExercises),
      'Insert exercises'
    )
    if (error) throw new Error(`Insert exercises failed: ${error.message}`)
  }
}

// ── Workouts ──────────────────────────────────────────────────

export async function getLastSession(trainingDayId) {
  const { data: sessions } = await withTimeout(
    supabase
      .from('workouts')
      .select('id, completed_at')
      .eq('training_day_id', trainingDayId)
      .order('completed_at', { ascending: false })
      .limit(1),
    5000, 'Load last session'
  )
  if (!sessions?.length) return null

  const { data: sets } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('*')
      .eq('workout_id', sessions[0].id)
      .order('set_number', { ascending: true }),
    5000, 'Load last session sets'
  )
  return { workout: sessions[0], sets: sets || [] }
}

// uid passed in from App state — no auth call needed
// exerciseSets:  { [name]: [{ weight, reps }] }  — exercise items
// activityLogs:  { [name]: { checked, notes } }   — activity items
export async function saveWorkout(trainingDayId, dayLabel, exerciseSets, activityLogs, uid) {
  if (!uid) throw new Error('Not authenticated')

  const { data: workout, error: wErr } = await withTimeout(
    supabase
      .from('workouts')
      .insert({
        user_id: uid,
        training_day_id: trainingDayId,
        day_name: dayLabel,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single(),
    5000, 'Save workout'
  )
  if (wErr) throw new Error(`Save workout failed: ${wErr.message}`)

  const rowsToInsert = []

  // Exercise items — one row per set
  for (const [exerciseName, sets] of Object.entries(exerciseSets)) {
    sets.forEach((set, idx) => {
      const w = parseFloat(set.weight)
      const r = parseInt(set.reps)
      if (!isNaN(w) || !isNaN(r)) {
        rowsToInsert.push({
          user_id:       uid,
          workout_id:    workout.id,
          exercise_name: exerciseName,
          set_number:    idx + 1,
          weight_kg:     isNaN(w) ? 0 : w,
          reps:          isNaN(r) ? 0 : r,
          checked:       false,
          notes:         '',
        })
      }
    })
  }

  // Activity items — one row per activity (set_number = 1)
  for (const [activityName, log] of Object.entries(activityLogs)) {
    rowsToInsert.push({
      user_id:       uid,
      workout_id:    workout.id,
      exercise_name: activityName,
      set_number:    1,
      weight_kg:     0,
      reps:          0,
      checked:       log.checked,
      notes:         log.notes || '',
    })
  }

  if (rowsToInsert.length) {
    const { error: sErr } = await withTimeout(
      supabase.from('workout_sets').insert(rowsToInsert),
      5000, 'Save sets'
    )
    if (sErr) throw new Error(`Save sets failed: ${sErr.message}`)
  }

  return workout
}

// ── History ───────────────────────────────────────────────────

export async function getExerciseHistory(exerciseName) {
  const { data, error } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('*, workout:workouts(id, completed_at, day_name)')
      .eq('exercise_name', exerciseName)
      .order('set_number', { ascending: true }),
    5000, 'Load history'
  )
  if (error) throw new Error(`Load history failed: ${error.message}`)

  const byWorkout = {}
  for (const set of data || []) {
    const wid = set.workout_id
    if (!byWorkout[wid]) {
      byWorkout[wid] = {
        workoutId: wid,
        date:      set.workout?.completed_at,
        dayName:   set.workout?.day_name,
        sets:      [],
      }
    }
    byWorkout[wid].sets.push(set)
  }
  return Object.values(byWorkout).sort((a, b) => new Date(b.date) - new Date(a.date))
}

// ── Weekly Progress ───────────────────────────────────────────

// Returns the ISO timestamp of this week's Monday at local midnight.
// Used to filter sessions to the current calendar week.
function getWeekStart() {
  const now = new Date()
  const day = now.getDay()                     // 0 = Sun, 1 = Mon, …
  const daysToMon = day === 0 ? -6 : 1 - day  // back to Monday
  const mon = new Date(now)
  mon.setDate(now.getDate() + daysToMon)
  mon.setHours(0, 0, 0, 0)
  return mon.toISOString()
}

// Counts sessions since Monday 00:00 local time.
// - workouts: rows in the workouts table this week (each session = 1)
// - activities: checked workout_sets rows this week (needs checked column migration)
// Returns { completed, target, workouts, activities }
export async function getWeeklyProgress(uid) {
  if (!uid) throw new Error('Not authenticated')
  const weekStart = getWeekStart()

  const [profileRes, weekWorkoutsRes] = await Promise.all([
    withTimeout(
      supabase.from('profiles').select('weekly_target').eq('id', uid).single(),
      5000, 'Load weekly target'
    ),
    withTimeout(
      supabase.from('workouts').select('id, day_name').eq('user_id', uid).gte('completed_at', weekStart),
      5000, 'Load week workouts'
    ),
  ])

  if (profileRes.error)     throw new Error(`Load progress failed: ${profileRes.error.message}`)
  if (weekWorkoutsRes.error) throw new Error(`Load progress failed: ${weekWorkoutsRes.error.message}`)

  const target       = profileRes.data?.weekly_target ?? 4
  const weekWorkouts = weekWorkoutsRes.data || []
  const workoutCount = weekWorkouts.length

  // Each completed session = 1 unit of progress, regardless of what's inside it
  return { completed: workoutCount, target, workouts: workoutCount, activities: 0 }
}

// Updates weekly_target on the current user's profile row.
// Requires uid so we can provide an explicit filter — Supabase JS v2 rejects
// filterless updates as a safety guard even when RLS would scope them correctly.
export async function saveWeeklyTarget(target, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { error } = await withTimeout(
    supabase.from('profiles').update({ weekly_target: target }).eq('id', uid),
    5000, 'Save weekly target'
  )
  if (error) throw new Error(`Save target failed: ${error.message}`)
}

// ── Stats ─────────────────────────────────────────────────────

export async function getStats() {
  const [workoutsRes, activitiesRes] = await Promise.all([
    withTimeout(
      supabase.from('workouts').select('*', { count: 'exact', head: true }),
      5000, 'Load stats'
    ),
    withTimeout(
      supabase.from('workout_sets').select('*', { count: 'exact', head: true }).eq('checked', true),
      5000, 'Load activity stats'
    ).catch(() => ({ count: 0 })),
  ])
  if (workoutsRes.error) throw new Error(`Load stats failed: ${workoutsRes.error.message}`)
  return { totalWorkouts: workoutsRes.count || 0, totalActivities: activitiesRes.count || 0 }
}

// ── Volume Comparison ─────────────────────────────────────────

// Returns the total volume (weight_kg × reps, summed) and date of the most
// recent workout on this training day, excluding the workout just saved.
// No uid parameter — RLS filters to the authenticated user automatically.
export async function getPreviousSessionVolume(trainingDayId, excludeWorkoutId) {
  const { data: sessions, error } = await withTimeout(
    supabase
      .from('workouts')
      .select('id, completed_at')
      .eq('training_day_id', trainingDayId)
      .neq('id', excludeWorkoutId)
      .order('completed_at', { ascending: false })
      .limit(1),
    5000, 'Load previous session'
  )
  if (error || !sessions?.length) return null

  const { data: prevSets, error: setsErr } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('weight_kg, reps')
      .eq('workout_id', sessions[0].id),
    5000, 'Load previous sets'
  )
  if (setsErr) return null

  const volume = (prevSets || []).reduce(
    (sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0),
    0
  )
  return { volume, date: sessions[0].completed_at }
}

// ── Body Weight ───────────────────────────────────────────────

// weightKg: number, loggedAt: ISO string, notes: string | null
export async function logBodyWeight(weightKg, loggedAt, notes, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('body_weight_logs')
      .insert({ user_id: uid, weight_kg: weightKg, logged_at: loggedAt, notes: notes || null })
      .select()
      .single(),
    5000, 'Save weight'
  )
  if (error) throw new Error(`Save weight failed: ${error.message}`)
  return data
}

// Returns up to `limit` entries, newest first.
export async function getBodyWeightLogs(uid, limit = 20) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('body_weight_logs')
      .select('id, weight_kg, logged_at, notes')
      .eq('user_id', uid)
      .order('logged_at', { ascending: false })
      .limit(limit),
    5000, 'Load weight logs'
  )
  if (error) throw new Error(`Load weight logs failed: ${error.message}`)
  return data || []
}

// ── Feedback ──────────────────────────────────────────────────

export async function submitFeedback(message, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { error } = await withTimeout(
    supabase.from('feedback').insert({ user_id: uid, message: message.trim() }),
    5000, 'Submit feedback'
  )
  if (error) throw new Error(`Submit failed: ${error.message}`)
}

// ── Templates (archived workouts) ────────────────────────────

const TEMPLATE_LIMIT = 10

// Save current day's exercises as a named template.
// Throws 'LIMIT_REACHED' if the user already has 10 templates.
export async function saveTemplate(name, dayId, exercises, uid) {
  if (!uid) throw new Error('Not authenticated')

  const { count, error: countErr } = await withTimeout(
    supabase.from('templates').select('*', { count: 'exact', head: true }).eq('user_id', uid),
    5000, 'Check template count'
  )
  if (countErr) throw new Error(`Check failed: ${countErr.message}`)
  if (count >= TEMPLATE_LIMIT) throw new Error('LIMIT_REACHED')

  const { data: tmpl, error: tErr } = await withTimeout(
    supabase
      .from('templates')
      .insert({ user_id: uid, name: name.trim(), day_id: dayId || null })
      .select()
      .single(),
    5000, 'Save template'
  )
  if (tErr) throw new Error(`Save template failed: ${tErr.message}`)

  if (exercises.length) {
    const { error: eErr } = await withTimeout(
      supabase.from('template_exercises').insert(
        exercises.map((e, i) => ({
          template_id:   tmpl.id,
          exercise_name: e.name,
          item_type:     e.item_type || 'exercise',
          target:        e.target    || '',
          sort_order:    i,
        }))
      ),
      5000, 'Save template exercises'
    )
    if (eErr) throw new Error(`Save exercises failed: ${eErr.message}`)
  }

  return tmpl
}

// Returns all templates with their exercises, newest first.
export async function getTemplates(uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('templates')
      .select('*, template_exercises(*)')
      .eq('user_id', uid)
      .order('created_at', { ascending: false }),
    5000, 'Load templates'
  )
  if (error) throw new Error(`Load templates failed: ${error.message}`)
  return (data || []).map(t => ({
    ...t,
    exercises: (t.template_exercises || []).sort((a, b) => a.sort_order - b.sort_order),
  }))
}

// Delete a template (cascades to template_exercises via FK).
export async function deleteTemplate(templateId) {
  const { error } = await withTimeout(
    supabase.from('templates').delete().eq('id', templateId),
    5000, 'Delete template'
  )
  if (error) throw new Error(`Delete failed: ${error.message}`)
}

// Replace a training day's exercises with the template's exercises.
export async function applyTemplate(templateId, trainingDayId, uid) {
  if (!uid) throw new Error('Not authenticated')

  const { data: texs, error: fetchErr } = await withTimeout(
    supabase
      .from('template_exercises')
      .select('*')
      .eq('template_id', templateId)
      .order('sort_order', { ascending: true }),
    5000, 'Load template exercises'
  )
  if (fetchErr) throw new Error(`Load failed: ${fetchErr.message}`)

  const { error: delErr } = await withTimeout(
    supabase.from('exercises').delete().eq('training_day_id', trainingDayId),
    5000, 'Clear day exercises'
  )
  if (delErr) throw new Error(`Clear failed: ${delErr.message}`)

  if (texs?.length) {
    const { error: insErr } = await withTimeout(
      supabase.from('exercises').insert(
        texs.map(e => ({
          user_id:         uid,
          training_day_id: trainingDayId,
          name:            e.exercise_name,
          item_type:       e.item_type  || 'exercise',
          target:          e.target     || '',
          sort_order:      e.sort_order,
        }))
      ),
      5000, 'Apply template exercises'
    )
    if (insErr) throw new Error(`Apply failed: ${insErr.message}`)
  }
}

// ── PR Tracking ───────────────────────────────────────────────

// Returns the best e1RM (Epley: weight * (1 + reps/30)) ever recorded
// for each of the given exercise names for this user.
// Result: { [exerciseName]: bestE1RM }
export async function getBestE1RMs(exerciseNames, uid) {
  if (!uid || !exerciseNames.length) return {}
  const { data, error } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('exercise_name, weight_kg, reps')
      .eq('user_id', uid)
      .in('exercise_name', exerciseNames)
      .gt('weight_kg', 0)
      .gt('reps', 0),
    5000, 'Load PR history'
  )
  if (error) throw new Error(`Load PR history failed: ${error.message}`)
  const best = {}
  for (const row of (data || [])) {
    const e1rm = row.weight_kg * (1 + row.reps / 30)
    if (!best[row.exercise_name] || e1rm > best[row.exercise_name]) {
      best[row.exercise_name] = e1rm
    }
  }
  return best
}

// ── Volume Stats ──────────────────────────────────────────────

// Returns exercise names (item_type = 'exercise') for the user's program.
export async function getExerciseNames(uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('exercises')
      .select('name')
      .eq('user_id', uid)
      .eq('item_type', 'exercise')
      .order('name', { ascending: true }),
    5000, 'Load exercise names'
  )
  if (error) throw new Error(`Load exercises failed: ${error.message}`)
  // Deduplicate — same exercise can appear on multiple days
  const seen = new Set()
  return (data || []).filter(r => seen.has(r.name) ? false : seen.add(r.name)).map(r => r.name)
}

// Returns volume per session for a given exercise, newest first.
// Volume = sum(weight_kg * reps) across all sets in that workout.
export async function getVolumeHistory(exerciseName, uid, limit = 10) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('weight_kg, reps, workout:workouts(id, completed_at, day_name)')
      .eq('exercise_name', exerciseName)
      .eq('user_id', uid)
      .order('workout_id', { ascending: false }),
    5000, 'Load volume history'
  )
  if (error) throw new Error(`Load volume failed: ${error.message}`)

  // Group rows by workout, sum volume per session
  const byWorkout = {}
  for (const row of data || []) {
    const wid = row.workout?.id
    if (!wid) continue
    if (!byWorkout[wid]) {
      byWorkout[wid] = {
        workoutId:   wid,
        date:        row.workout.completed_at,
        dayName:     row.workout.day_name,
        totalVolume: 0,
      }
    }
    byWorkout[wid].totalVolume += (row.weight_kg || 0) * (row.reps || 0)
  }

  return Object.values(byWorkout)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)
}
