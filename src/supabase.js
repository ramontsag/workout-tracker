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
      .map(e => ({
        name:            e.name,
        target:          e.target || '',
        item_type:       e.item_type || 'exercise',
        activity_fields: Array.isArray(e.activity_fields) ? e.activity_fields : null,
      })),
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
        activity_fields: ex.item_type === 'activity' && Array.isArray(ex.activity_fields)
          ? ex.activity_fields
          : null,
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
      .eq('status', 'completed')
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

// ── Drafts (in-progress workouts) ─────────────────────────────
//
// Drafts live as workouts rows with status='in_progress' and the live
// UI state in workouts.draft_state (JSONB). We never write to
// workout_sets until the user hits Complete — that keeps history
// queries clean and preserves the exact strings the user typed
// (e.g. blank reps stays blank, not "0").

// Returns the in-progress workout for this training day, if any.
// Shape: { id, day_name, started_at, updated_at, draft_state } | null
export async function getInProgressWorkout(trainingDayId, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('workouts')
      .select('id, day_name, started_at, updated_at, draft_state')
      .eq('user_id', uid)
      .eq('training_day_id', trainingDayId)
      .eq('status', 'in_progress')
      .limit(1),
    5000, 'Load in-progress workout'
  )
  if (error) throw new Error(`Load draft failed: ${error.message}`)
  return data?.[0] || null
}

// Insert (workoutId omitted) or update (workoutId provided) the draft.
// draftState is whatever JSON-serialisable shape the caller wants to
// restore on resume — typically { sets, activityLogs, exerciseList }.
export async function upsertDraft({ workoutId, trainingDayId, dayLabel, draftState }, uid) {
  if (!uid) throw new Error('Not authenticated')

  if (workoutId) {
    const { data, error } = await withTimeout(
      supabase
        .from('workouts')
        .update({ draft_state: draftState, day_name: dayLabel, updated_at: new Date().toISOString() })
        .eq('id', workoutId)
        .eq('user_id', uid)
        .select('id, started_at, updated_at')
        .single(),
      5000, 'Save draft'
    )
    if (error) throw new Error(`Save draft failed: ${error.message}`)
    return data
  }

  const nowIso = new Date().toISOString()
  const { data, error } = await withTimeout(
    supabase
      .from('workouts')
      .insert({
        user_id:         uid,
        training_day_id: trainingDayId,
        day_name:        dayLabel,
        status:          'in_progress',
        started_at:      nowIso,
        updated_at:      nowIso,
        draft_state:     draftState,
      })
      .select('id, started_at, updated_at')
      .single(),
    5000, 'Create draft'
  )
  if (error) throw new Error(`Create draft failed: ${error.message}`)
  return data
}

// Delete a draft (cascades workout_sets — though drafts shouldn't have any).
export async function discardDraft(workoutId, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { error } = await withTimeout(
    supabase
      .from('workouts')
      .delete()
      .eq('id', workoutId)
      .eq('user_id', uid)
      .eq('status', 'in_progress'),
    5000, 'Discard draft'
  )
  if (error) throw new Error(`Discard failed: ${error.message}`)
}

// Returns training_day_ids that have an in-progress workout.
// Used by Home.jsx to render the "● in progress" indicator.
export async function getInProgressDayIds(uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('workouts')
      .select('training_day_id')
      .eq('user_id', uid)
      .eq('status', 'in_progress'),
    5000, 'Load in-progress days'
  )
  if (error) throw new Error(`Load drafts failed: ${error.message}`)
  return new Set((data || []).map(r => r.training_day_id))
}

// Add a single exercise row to an existing training day. Used by the
// "Also update program" toggle when the user adds an exercise mid-workout.
export async function addExerciseToProgram(trainingDayId, payload, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data: existing } = await withTimeout(
    supabase
      .from('exercises')
      .select('sort_order')
      .eq('training_day_id', trainingDayId)
      .order('sort_order', { ascending: false })
      .limit(1),
    5000, 'Load max sort_order'
  )
  const nextSort = (existing?.[0]?.sort_order ?? -1) + 1
  const { error } = await withTimeout(
    supabase.from('exercises').insert({
      user_id:         uid,
      training_day_id: trainingDayId,
      name:            payload.name,
      target:          payload.target || '',
      item_type:       payload.item_type || 'exercise',
      sort_order:      nextSort,
      activity_fields: payload.item_type === 'activity' && Array.isArray(payload.activity_fields)
        ? payload.activity_fields
        : null,
    }),
    5000, 'Add exercise to program'
  )
  if (error) throw new Error(`Add to program failed: ${error.message}`)
}

// Remove an exercise row by name (case-insensitive) from a training day.
// Used by the "Also update program" toggle when removing mid-workout.
export async function removeExerciseFromProgram(trainingDayId, exerciseName, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { error } = await withTimeout(
    supabase
      .from('exercises')
      .delete()
      .eq('training_day_id', trainingDayId)
      .eq('user_id', uid)
      .ilike('name', exerciseName),
    5000, 'Remove from program'
  )
  if (error) throw new Error(`Remove from program failed: ${error.message}`)
}

// Finalize a draft: insert workout_sets from the canonicalized state, then
// flip the draft row to status='completed'. The draft row was created on
// entry to WorkoutDay (see upsertDraft) so workoutId always exists.
//
// exerciseSets:  { [name]: [{ weight_kg, reps, is_warmup, rir, rpe }] }
//   weight_kg is already in kg (caller converts from user unit)
// activityLogs:  { [name]: { checked, notes, duration_min, distance_km,
//                            intensity, avg_hr, calories, rounds, elevation_m } }
//   distance/elevation already canonicalized to km/m by caller.
export async function completeWorkout(workoutId, dayLabel, exerciseSets, activityLogs, uid) {
  if (!uid) throw new Error('Not authenticated')
  if (!workoutId) throw new Error('No workout id')

  const rowsToInsert = []

  // Exercise items — one row per set
  for (const [exerciseName, sets] of Object.entries(exerciseSets)) {
    sets.forEach((set, idx) => {
      const w = typeof set.weight_kg === 'number' ? set.weight_kg : parseFloat(set.weight_kg)
      const r = parseInt(set.reps)
      if (!isNaN(w) || !isNaN(r)) {
        const rir = set.rir === '' || set.rir == null ? null : parseFloat(set.rir)
        const rpe = set.rpe === '' || set.rpe == null ? null : parseFloat(set.rpe)
        rowsToInsert.push({
          user_id:       uid,
          workout_id:    workoutId,
          exercise_name: exerciseName,
          set_number:    idx + 1,
          weight_kg:     isNaN(w) ? 0 : w,
          reps:          isNaN(r) ? 0 : r,
          checked:       false,
          notes:         '',
          is_warmup:     !!set.is_warmup,
          rir:           isNaN(rir) ? null : rir,
          rpe:           isNaN(rpe) ? null : rpe,
        })
      }
    })
  }

  // Activity items — one row per activity (set_number = 1)
  const numOrNull = (v) => {
    if (v === '' || v == null) return null
    const n = typeof v === 'number' ? v : parseFloat(v)
    return isNaN(n) ? null : n
  }
  const intOrNull = (v) => {
    if (v === '' || v == null) return null
    const n = typeof v === 'number' ? v : parseInt(v)
    return isNaN(n) ? null : n
  }
  for (const [activityName, log] of Object.entries(activityLogs)) {
    const duration = numOrNull(log.duration_min)
    const distance = numOrNull(log.distance_km)
    const intensity = intOrNull(log.intensity)
    const avgHr = intOrNull(log.avg_hr)
    const cals = numOrNull(log.calories)
    const rnds = intOrNull(log.rounds)
    const elev = numOrNull(log.elevation_m)
    const notes = log.notes || ''
    // Skip completely-blank activities (day has it scheduled but user didn't log).
    // Prevents Progress > Activities from counting empty rows as sessions.
    const hasAnyData = !!log.checked || notes.length > 0 ||
      [duration, distance, intensity, avgHr, cals, rnds, elev].some(v => v != null)
    if (!hasAnyData) continue
    rowsToInsert.push({
      user_id:       uid,
      workout_id:    workoutId,
      exercise_name: activityName,
      set_number:    1,
      weight_kg:     0,
      reps:          0,
      checked:       !!log.checked,
      notes,
      duration_min:  duration,
      distance_km:   distance,
      intensity,
      avg_hr:        avgHr,
      calories:      cals,
      rounds:        rnds,
      elevation_m:   elev,
    })
  }

  if (rowsToInsert.length) {
    const { error: sErr } = await withTimeout(
      supabase.from('workout_sets').insert(rowsToInsert),
      5000, 'Save sets'
    )
    if (sErr) throw new Error(`Save sets failed: ${sErr.message}`)
  }

  // Finalize the workout row — flip status, set completed_at, clear draft_state.
  const completedAt = new Date().toISOString()
  const { data: workout, error: wErr } = await withTimeout(
    supabase
      .from('workouts')
      .update({
        status:       'completed',
        day_name:     dayLabel,
        completed_at: completedAt,
        updated_at:   completedAt,
        draft_state:  null,
      })
      .eq('id', workoutId)
      .eq('user_id', uid)
      .select()
      .single(),
    5000, 'Complete workout'
  )
  if (wErr) throw new Error(`Complete workout failed: ${wErr.message}`)
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
      supabase.from('workouts').select('id, day_name')
        .eq('user_id', uid)
        .eq('status', 'completed')
        .gte('completed_at', weekStart),
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

// Generic settings updater. `fields` is a partial profile object, e.g.
// { weight_unit: 'lbs' } or { intensity_mode: 'rir', weight_unit: 'kg' }.
export async function saveSettings(fields, uid) {
  if (!uid) throw new Error('Not authenticated')
  const { error } = await withTimeout(
    supabase.from('profiles').update(fields).eq('id', uid),
    5000, 'Save settings'
  )
  if (error) throw new Error(`Save settings failed: ${error.message}`)
}

// ── Stats ─────────────────────────────────────────────────────

export async function getStats() {
  const [workoutsRes, activitiesRes] = await Promise.all([
    withTimeout(
      supabase.from('workouts').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
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
      .eq('status', 'completed')
      .neq('id', excludeWorkoutId)
      .order('completed_at', { ascending: false })
      .limit(1),
    5000, 'Load previous session'
  )
  if (error || !sessions?.length) return null

  const { data: prevSets, error: setsErr } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('weight_kg, reps, is_warmup')
      .eq('workout_id', sessions[0].id),
    5000, 'Load previous sets'
  )
  if (setsErr) return null

  const volume = (prevSets || [])
    .filter(s => !s.is_warmup)
    .reduce((sum, s) => sum + (s.weight_kg || 0) * (s.reps || 0), 0)
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

// Returns per-exercise PR stats used to flag weight / rep / e1RM PRs.
// Warmup sets and zeroes are excluded so they never count toward records.
// Result shape:
//   { [exerciseName]: {
//       bestE1RM:        number,
//       bestWeight:      number,
//       maxRepsAtWeight: { [kgRounded]: maxReps }   // keyed by weight rounded to 1 decimal
//   } }
export async function getExerciseBests(exerciseNames, uid) {
  if (!uid || !exerciseNames.length) return {}
  const { data, error } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('exercise_name, weight_kg, reps, is_warmup')
      .eq('user_id', uid)
      .in('exercise_name', exerciseNames)
      .gt('weight_kg', 0)
      .gt('reps', 0),
    5000, 'Load PR history'
  )
  if (error) throw new Error(`Load PR history failed: ${error.message}`)

  const bests = {}
  for (const row of (data || [])) {
    if (row.is_warmup) continue
    const name = row.exercise_name
    const w = Number(row.weight_kg)
    const r = Number(row.reps)
    const e1rm = w * (1 + r / 30)
    if (!bests[name]) bests[name] = { bestE1RM: 0, bestWeight: 0, maxRepsAtWeight: {} }
    const b = bests[name]
    if (e1rm > b.bestE1RM) b.bestE1RM = e1rm
    if (w > b.bestWeight)  b.bestWeight = w
    const key = w.toFixed(1)
    if (!b.maxRepsAtWeight[key] || r > b.maxRepsAtWeight[key]) b.maxRepsAtWeight[key] = r
  }
  return bests
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

// Returns the union of exercise names the user has ever defined in their
// program OR logged in a past workout. Used by the autocomplete in
// ProgramSetup so suggestions include lifts they've dropped from the
// current program but still remember by name. Deduped case-insensitively,
// preserving the first occurrence's casing.
export async function getAllKnownExerciseNames(uid) {
  if (!uid) throw new Error('Not authenticated')
  const [fromProgram, fromLogs] = await Promise.all([
    withTimeout(
      supabase
        .from('exercises')
        .select('name')
        .eq('user_id', uid)
        .eq('item_type', 'exercise'),
      5000, 'Load program names'
    ),
    withTimeout(
      supabase
        .from('workout_sets')
        .select('exercise_name')
        .eq('user_id', uid),
      5000, 'Load history names'
    ),
  ])
  if (fromProgram.error) throw new Error(`Load names failed: ${fromProgram.error.message}`)
  if (fromLogs.error)    throw new Error(`Load names failed: ${fromLogs.error.message}`)

  const seen = new Map() // lowercase → original
  for (const row of fromProgram.data || []) {
    const name = (row.name || '').trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  for (const row of fromLogs.data || []) {
    const name = (row.exercise_name || '').trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

// Returns volume per session for a given exercise, newest first.
// Volume = sum(weight_kg * reps) across all working sets in that workout.
// Warmup sets are excluded so the user's progress chart reflects real work.
export async function getVolumeHistory(exerciseName, uid, limit = 10) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('weight_kg, reps, is_warmup, workout:workouts(id, completed_at, day_name)')
      .eq('exercise_name', exerciseName)
      .eq('user_id', uid)
      .order('workout_id', { ascending: false }),
    5000, 'Load volume history'
  )
  if (error) throw new Error(`Load volume failed: ${error.message}`)

  // Group rows by workout, sum volume per session (excluding warmups)
  const byWorkout = {}
  for (const row of data || []) {
    if (row.is_warmup) continue
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

// ── Activity Stats ────────────────────────────────────────────

// Returns distinct activity names defined in the user's current program,
// sorted alphabetically. Used by the Progress screen's Activities tab.
export async function getActivityNames(uid) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('exercises')
      .select('name')
      .eq('user_id', uid)
      .eq('item_type', 'activity')
      .order('name', { ascending: true }),
    5000, 'Load activity names'
  )
  if (error) throw new Error(`Load activities failed: ${error.message}`)
  const seen = new Set()
  return (data || []).filter(r => seen.has(r.name) ? false : seen.add(r.name)).map(r => r.name)
}

// Returns per-session metrics for one activity, newest first.
// Row shape: { date, duration_min, distance_km, intensity, avg_hr,
//              calories, rounds, elevation_m, notes, checked }
export async function getActivityHistory(activityName, uid, limit = 52) {
  if (!uid) throw new Error('Not authenticated')
  const { data, error } = await withTimeout(
    supabase
      .from('workout_sets')
      .select('duration_min, distance_km, intensity, avg_hr, calories, rounds, elevation_m, notes, checked, workout:workouts(id, completed_at, day_name)')
      .eq('exercise_name', activityName)
      .eq('user_id', uid)
      .order('workout_id', { ascending: false }),
    5000, 'Load activity history'
  )
  if (error) throw new Error(`Load activity history failed: ${error.message}`)

  return (data || [])
    .map(row => ({
      workoutId:    row.workout?.id,
      date:         row.workout?.completed_at,
      dayName:      row.workout?.day_name,
      duration_min: row.duration_min,
      distance_km:  row.distance_km,
      intensity:    row.intensity,
      avg_hr:       row.avg_hr,
      calories:     row.calories,
      rounds:       row.rounds,
      elevation_m:  row.elevation_m,
      notes:        row.notes,
      checked:      row.checked,
    }))
    .filter(r => r.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit)
}

// Pure client-side helper: buckets session history into weekly totals.
// weekStart is the Monday ISO date (YYYY-MM-DD) of each bucket, most recent first.
// Returns up to `weeks` buckets. Missing weeks get zero-valued entries so the
// sparkline doesn't misleadingly smooth over inactive periods.
export function bucketActivityByWeek(sessions, weeks = 12) {
  // Floor a date to the Monday of its week, local time.
  const mondayOf = (d) => {
    const x = new Date(d)
    const day = x.getDay()            // 0 = Sun
    const delta = day === 0 ? -6 : 1 - day
    x.setDate(x.getDate() + delta)
    x.setHours(0, 0, 0, 0)
    return x
  }

  // Build the target bucket range: last `weeks` Mondays including this week.
  const thisMonday = mondayOf(new Date())
  const buckets = []
  for (let i = 0; i < weeks; i++) {
    const d = new Date(thisMonday)
    d.setDate(thisMonday.getDate() - i * 7)
    buckets.push({
      weekStart:     d.toISOString().slice(0, 10),
      totalDuration: 0,
      totalDistance: 0,
      sessionCount:  0,
    })
  }
  const byKey = Object.fromEntries(buckets.map(b => [b.weekStart, b]))

  for (const s of sessions) {
    if (!s.date) continue
    const key = mondayOf(s.date).toISOString().slice(0, 10)
    const b = byKey[key]
    if (!b) continue
    if (s.duration_min) b.totalDuration += Number(s.duration_min)
    if (s.distance_km)  b.totalDistance += Number(s.distance_km)
    b.sessionCount += 1
  }

  return buckets
}
