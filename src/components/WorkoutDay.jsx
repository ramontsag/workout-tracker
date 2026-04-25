import React, { useState, useEffect, useRef } from 'react'
import {
  getLastSession, completeWorkout, getPreviousSessionVolume, saveTemplate, getExerciseBests,
  getInProgressWorkout, upsertDraft, discardDraft,
  addExerciseToProgram, removeExerciseFromProgram, getAllKnownExerciseNames,
} from '../supabase'
import {
  displayWeight, parseInputWeight, unitLabel,
  displayDistance, parseInputDistance, distanceUnitLabel,
  displayElevation, parseInputElevation, elevationUnitLabel,
} from '../utils/units'
import { DEFAULT_ACTIVITY_FIELDS } from '../data/commonActivities'

function fmt(val) {
  return val === 0 || val === '0' ? '—' : val
}

// ── Local draft cache ─────────────────────────────────────────
// Synchronous mirror of the in-progress workout, scoped per
// (user, training day). Read on mount so same-tab navigation
// (e.g. into ExerciseHistory and back) restores instantly,
// without waiting for the Supabase round-trip.
const lsKeyFor = (uid, dayId) => `wt:draft:${uid}:${dayId}`

function readLsDraft(key) {
  if (!key || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch { return null }
}

function writeLsDraft(key, data) {
  if (!key || typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(data)) } catch {}
}

function clearLsDraft(key) {
  if (!key || typeof window === 'undefined') return
  try { window.localStorage.removeItem(key) } catch {}
}

// Volume summed over working sets only, in kg, from the current session state.
// Caller passes unit so lbs input strings get converted before multiplying.
function calcSessionVolume(sets, unit) {
  return Object.values(sets).flat().reduce((sum, s) => {
    if (s.is_warmup) return sum
    const w = parseInputWeight(s.weight, unit)
    const r = parseInt(s.reps)
    if (isNaN(w) || isNaN(r)) return sum
    return sum + w * r
  }, 0)
}

// Both inputs are volumes in kg·reps. Comparison is unit-agnostic since it's
// a percentage, so there's no display conversion here.
function buildVolumeMsg(currentVolKg, prev) {
  if (currentVolKg === 0) return null
  if (!prev || prev.volume === 0) {
    return "First session logged for this day — this is your baseline."
  }
  const pct = Math.round(((currentVolKg - prev.volume) / prev.volume) * 100)
  const prevDay = new Date(prev.date).toLocaleDateString('en-US', { weekday: 'long' })
  if (pct > 0)  return `You pushed ${pct}% more volume than last ${prevDay} — keep going.`
  if (pct < 0)  return `Volume was ${Math.abs(pct)}% lighter than last ${prevDay} — recovery days count too.`
  return `Matched last ${prevDay}'s volume exactly — consistency is everything.`
}

// ── Rest timer ────────────────────────────────────────────────
// Mounts fresh on each `key` change (parent increments key per set).
// Counts down from `total`, can be reset or dismissed.
function RestTimer({ total, onDismiss }) {
  const [remaining, setRemaining] = useState(total)

  useEffect(() => {
    const id = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  const done = remaining === 0
  const pct  = (remaining / total) * 100
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const label = done
    ? 'Go!'
    : mins > 0
      ? `${mins}:${String(secs).padStart(2, '0')}`
      : `${remaining}s`

  return (
    <div className={`rest-timer${done ? ' rest-timer--done' : ''}`}>
      <div className="rest-timer-top">
        <span className="rest-timer-label">
          {done ? `Rest done — ${label}` : `Rest  ${label}`}
        </span>
        <div className="rest-timer-btns">
          <button className="rest-timer-btn" onClick={() => setRemaining(total)} title="Reset">↺</button>
          <button className="rest-timer-btn" onClick={onDismiss} title="Dismiss">×</button>
        </div>
      </div>
      <div className="rest-timer-track">
        <div className="rest-timer-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Progressive overload indicator ───────────────────────────
// Warmup sets are excluded on both sides so a heavier warmup can't mask
// a lighter real session and vice versa.
function progressIndicator(sets, lastSets, unit) {
  if (!lastSets || lastSets.length === 0) return null
  const currentVol = sets.reduce((sum, s) => {
    if (s.is_warmup) return sum
    const w = parseInputWeight(s.weight, unit); const r = parseInt(s.reps)
    return isNaN(w) || isNaN(r) ? sum : sum + w * r
  }, 0)
  const lastVol = lastSets.reduce((sum, s) => {
    if (s.is_warmup) return sum
    const w = parseFloat(s.weight_kg); const r = parseInt(s.reps)
    return isNaN(w) || isNaN(r) ? sum : sum + w * r
  }, 0)
  if (currentVol === 0 || lastVol === 0) return null
  if (currentVol > lastVol)  return { label: '↑', cls: 'ex-progress--up' }
  if (currentVol < lastVol)  return { label: '↓', cls: 'ex-progress--down' }
  return { label: '→', cls: 'ex-progress--same' }
}

// ── PR popover ────────────────────────────────────────────────
// Anchored to the PR badge. `info` has: kind ('weight'|'reps'|'e1rm'),
// current, previous (in kg or reps). `unit` formats weights.
function PRPopover({ info, unit, onDismiss }) {
  if (!info) return null
  const label = unitLabel(unit)
  let icon, line1, line2
  if (info.kind === 'weight') {
    icon  = '🏆'
    line1 = 'New heaviest weight'
    line2 = info.previous > 0
      ? `Prev best: ${displayWeight(info.previous, unit)} ${label}`
      : 'First recorded weight for this lift'
  } else if (info.kind === 'reps') {
    icon  = '🔥'
    line1 = `New rep PR at ${displayWeight(info.currentWeightKg, unit)} ${label}`
    line2 = `Prev best at this weight: ${info.previous} reps`
  } else {
    icon  = '📈'
    line1 = 'New estimated 1RM'
    line2 = info.previous > 0
      ? `Prev best ≈ ${displayWeight(info.previous, unit)} ${label}`
      : 'First recorded e1RM for this lift'
  }
  return (
    <div className="pr-popover" onClick={e => { e.stopPropagation(); onDismiss() }}>
      <span className="pr-popover__icon">{icon}</span>
      <div className="pr-popover__text">
        <div className="pr-popover__line1">{line1}</div>
        <div className="pr-popover__line2">{line2}</div>
      </div>
    </div>
  )
}

// ── Exercise item card (weight + reps per set) ────────────────
function ExerciseCard({
  exercise, sets, lastSets, prInfo, unit, intensityMode,
  onUpdate, onConfirm, onAdd, onRemove, onHistory, onToggleWarmup,
  onRemoveExercise,
}) {
  const prog = progressIndicator(sets, lastSets, unit)
  const label = unitLabel(unit)
  const lastSummary = lastSets.length > 0
    ? lastSets
        .filter(s => !s.is_warmup)
        .map(s => `${fmt(displayWeight(s.weight_kg, unit))}${label}×${fmt(s.reps)}`)
        .join(' · ')
    : null

  const [prOpenIdx, setPrOpenIdx] = useState(null)

  return (
    <div className="ex-card">
      <div className="ex-header">
        <div className="ex-header__left">
          <div className="ex-header__name-row">
            <button className="ex-name" onClick={onHistory}>{exercise.name}</button>
            {prog && <span className={`ex-progress ${prog.cls}`}>{prog.label}</span>}
          </div>
          {exercise.target && <div className="ex-target">{exercise.target}</div>}
        </div>
        <button className="ex-history-btn" onClick={onHistory} title="View history">↗</button>
        {onRemoveExercise && (
          <button className="ex-remove-btn" onClick={onRemoveExercise} title="Remove from this workout" aria-label="Remove exercise">×</button>
        )}
      </div>

      {lastSummary && (
        <div className="ex-last-summary">Last time: {lastSummary}</div>
      )}

      <div className="sets-list">
        {sets.map((set, idx) => {
          const prev = lastSets[idx]
          const isPRSet = prInfo && prInfo.setIdx === idx
          const showIntensity = intensityMode !== 'off' && !set.is_warmup
          const intensityField = intensityMode === 'rpe' ? 'rpe' : 'rir'
          return (
            <div key={idx} className="set-item">
              <div className={`set-row${set.done ? ' set-row--done' : ''}${set.is_warmup ? ' set-row--warmup' : ''}`}>
                <span className="set-num">{set.is_warmup ? 'W' : idx + 1}</span>
                <div className="set-input-group">
                  <input
                    className="set-input"
                    type="number"
                    inputMode="decimal"
                    placeholder={label.toUpperCase()}
                    value={set.weight}
                    onChange={e => onUpdate(idx, 'weight', e.target.value)}
                  />
                  <span className="set-sep">×</span>
                  <input
                    className="set-input"
                    type="number"
                    inputMode="numeric"
                    placeholder="REPS"
                    value={set.reps}
                    onChange={e => onUpdate(idx, 'reps', e.target.value)}
                  />
                  {showIntensity && (
                    <input
                      className="set-input intensity-input"
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      placeholder={intensityField.toUpperCase()}
                      value={set[intensityField] ?? ''}
                      onChange={e => onUpdate(idx, intensityField, e.target.value)}
                    />
                  )}
                </div>
                <button
                  className={`set-warmup-chip${set.is_warmup ? ' set-warmup-chip--on' : ''}`}
                  onClick={() => onToggleWarmup(idx)}
                  title={set.is_warmup ? 'Warmup — tap to unmark' : 'Mark as warmup'}
                  aria-label="Toggle warmup"
                >W</button>
                {isPRSet && (
                  <button
                    className="set-pr-badge"
                    onClick={() => setPrOpenIdx(prOpenIdx === idx ? null : idx)}
                    title="Personal record"
                  >PR</button>
                )}
                <button
                  className={`set-tick${set.done ? ' set-tick--done' : ''}`}
                  onClick={() => onConfirm(idx)}
                  title={set.done ? 'Done' : 'Mark set done'}
                >✓</button>
                {sets.length > 1 && (
                  <button className="set-remove" onClick={() => onRemove(idx)}>×</button>
                )}
              </div>
              {isPRSet && prOpenIdx === idx && (
                <PRPopover info={prInfo} unit={unit} onDismiss={() => setPrOpenIdx(null)} />
              )}
              {prev && (prev.weight_kg || prev.reps) && (
                <div className="set-prev">
                  {fmt(displayWeight(prev.weight_kg, unit))}{label} × {fmt(prev.reps)}
                  {prev.is_warmup && <span className="set-prev-warmup"> (warmup)</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <button className="add-set-btn" onClick={onAdd}>Add Set</button>
    </div>
  )
}

// ── Activity item card — configured fields inline ─────────────
// `item.activity_fields` is the user's selection (array of field keys).
// Backwards-compat: if null/undefined, falls back to checkbox + notes only.
function ActivityCard({ item, log, unit, lastLog, onToggle, onUpdate, onRemoveExercise }) {
  const fields = item.activity_fields || DEFAULT_ACTIVITY_FIELDS
  const has = (k) => fields.includes(k)

  // "Last time" summary — one compact line of the fields the user tracks.
  const summaryParts = []
  if (lastLog) {
    if (has('duration_min') && lastLog.duration_min)
      summaryParts.push(`${lastLog.duration_min} min`)
    if (has('distance_km')  && lastLog.distance_km)
      summaryParts.push(`${displayDistance(lastLog.distance_km, unit)} ${distanceUnitLabel(unit)}`)
    if (has('intensity')    && lastLog.intensity)
      summaryParts.push(`${lastLog.intensity}/5`)
    if (has('avg_hr')       && lastLog.avg_hr)
      summaryParts.push(`${lastLog.avg_hr} bpm`)
    if (has('calories')     && lastLog.calories)
      summaryParts.push(`${lastLog.calories} kcal`)
    if (has('rounds')       && lastLog.rounds)
      summaryParts.push(`${lastLog.rounds} rounds`)
    if (has('elevation_m')  && lastLog.elevation_m)
      summaryParts.push(`${displayElevation(lastLog.elevation_m, unit)} ${elevationUnitLabel(unit)}`)
  }

  return (
    <div className="ex-card activity-item-card">
      <div className="activity-row-wrap">
        <button className="activity-row" onClick={onToggle}>
          <div
            className={`activity-checkbox ${log.checked ? 'activity-checkbox--checked' : ''}`}
            style={log.checked ? { background: 'var(--success)', borderColor: 'var(--success)' } : {}}
          >
            {log.checked && <span className="activity-check-mark">✓</span>}
          </div>
          <span className={`activity-name ${log.checked ? 'activity-name--checked' : ''}`}>
            {item.name}
          </span>
        </button>
        {onRemoveExercise && (
          <button className="ex-remove-btn" onClick={onRemoveExercise} title="Remove from this workout" aria-label="Remove activity">×</button>
        )}
      </div>

      {summaryParts.length > 0 && (
        <div className="activity-last-summary">Last: {summaryParts.join(' · ')}</div>
      )}

      {(has('duration_min') || has('distance_km') || has('avg_hr') ||
        has('calories') || has('rounds') || has('elevation_m') || has('intensity')) && (
        <div className="activity-log-grid">
          {has('duration_min') && (
            <div className="activity-field">
              <label className="activity-field-label">Duration</label>
              <div className="activity-field-input-wrap">
                <input
                  className="activity-field-input"
                  type="number"
                  inputMode="decimal"
                  value={log.duration_min ?? ''}
                  onChange={e => onUpdate('duration_min', e.target.value)}
                />
                <span className="activity-field-suffix">min</span>
              </div>
            </div>
          )}
          {has('distance_km') && (
            <div className="activity-field">
              <label className="activity-field-label">Distance</label>
              <div className="activity-field-input-wrap">
                <input
                  className="activity-field-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={log.distance_display ?? ''}
                  onChange={e => onUpdate('distance_display', e.target.value)}
                />
                <span className="activity-field-suffix">{distanceUnitLabel(unit)}</span>
              </div>
            </div>
          )}
          {has('avg_hr') && (
            <div className="activity-field">
              <label className="activity-field-label">Avg HR</label>
              <div className="activity-field-input-wrap">
                <input
                  className="activity-field-input"
                  type="number"
                  inputMode="numeric"
                  value={log.avg_hr ?? ''}
                  onChange={e => onUpdate('avg_hr', e.target.value)}
                />
                <span className="activity-field-suffix">bpm</span>
              </div>
            </div>
          )}
          {has('calories') && (
            <div className="activity-field">
              <label className="activity-field-label">Calories</label>
              <div className="activity-field-input-wrap">
                <input
                  className="activity-field-input"
                  type="number"
                  inputMode="numeric"
                  value={log.calories ?? ''}
                  onChange={e => onUpdate('calories', e.target.value)}
                />
                <span className="activity-field-suffix">kcal</span>
              </div>
            </div>
          )}
          {has('rounds') && (
            <div className="activity-field">
              <label className="activity-field-label">Rounds</label>
              <div className="activity-field-input-wrap">
                <input
                  className="activity-field-input"
                  type="number"
                  inputMode="numeric"
                  value={log.rounds ?? ''}
                  onChange={e => onUpdate('rounds', e.target.value)}
                />
                <span className="activity-field-suffix">×</span>
              </div>
            </div>
          )}
          {has('elevation_m') && (
            <div className="activity-field">
              <label className="activity-field-label">Elevation</label>
              <div className="activity-field-input-wrap">
                <input
                  className="activity-field-input"
                  type="number"
                  inputMode="numeric"
                  value={log.elevation_display ?? ''}
                  onChange={e => onUpdate('elevation_display', e.target.value)}
                />
                <span className="activity-field-suffix">{elevationUnitLabel(unit)}</span>
              </div>
            </div>
          )}
          {has('intensity') && (
            <div className="activity-field activity-field--wide">
              <label className="activity-field-label">Intensity</label>
              <div className="intensity-dots">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`intensity-dot${(log.intensity || 0) >= n ? ' intensity-dot--on' : ''}`}
                    onClick={() => onUpdate('intensity', log.intensity === n ? '' : n)}
                    aria-label={`Intensity ${n}`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {has('notes') && (
        <textarea
          className="activity-notes"
          placeholder="Details…"
          value={log.notes || ''}
          onChange={e => onUpdate('notes', e.target.value)}
          rows={2}
        />
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export default function WorkoutDay({ day, userId, profile, onBack, onHistory }) {
  const unit          = profile?.weight_unit    || 'kg'
  const intensityMode = profile?.intensity_mode || 'off'

  const makeEmptySet = () => ({ weight: '', reps: '', done: false, is_warmup: false, rir: '', rpe: '' })
  // Activity log shape includes display-unit fields for distance/elevation
  // (distance_display, elevation_display) — we convert to canonical km/m at
  // save time so the DB always stores metric.
  const makeEmptyActivity = () => ({
    checked: false, notes: '',
    duration_min: '', distance_display: '', intensity: '',
    avg_hr: '', calories: '', rounds: '', elevation_display: '',
  })

  // Local-storage cache key (synchronous mirror of the draft, see readLsDraft).
  // null until userId arrives — handlers no-op when null.
  const lsKey  = userId ? lsKeyFor(userId, day.id) : null
  const cached = lsKey ? readLsDraft(lsKey) : null

  // Live exercise list — starts from the program but can be mutated mid-workout.
  // Render and state lookups all use this, not day.exercises directly.
  const [exerciseList, setExerciseList] = useState(() =>
    Array.isArray(cached?.exerciseList) ? cached.exerciseList : day.exercises
  )
  const exerciseItems = exerciseList.filter(e => e.item_type !== 'activity')
  const activityItems = exerciseList.filter(e => e.item_type === 'activity')

  const [sets, setSets] = useState(() =>
    cached?.sets && typeof cached.sets === 'object'
      ? cached.sets
      : Object.fromEntries(
          day.exercises.filter(e => e.item_type !== 'activity')
            .map(ex => [ex.name, [makeEmptySet(), makeEmptySet()]])
        )
  )
  const [activityLogs, setActivityLogs] = useState(() =>
    cached?.activityLogs && typeof cached.activityLogs === 'object'
      ? cached.activityLogs
      : Object.fromEntries(
          day.exercises.filter(e => e.item_type === 'activity')
            .map(a => [a.name, makeEmptyActivity()])
        )
  )

  const [lastSession, setLastSession] = useState(null)
  const [status,      setStatus]      = useState('idle') // idle | saving | saved
  const [errMsg,      setErrMsg]      = useState('')
  const [volumeMsg,   setVolumeMsg]   = useState('')
  const [timerKey,     setTimerKey]    = useState(0)
  const [timerActive,  setTimerActive] = useState(false)
  const [timerEnabled, setTimerEnabled] = useState(true)
  const restSeconds = day.rest_seconds ?? 90

  // save-workout state
  const [archiveStep,  setArchiveStep]  = useState(null)  // null | 'naming' | 'saving' | 'done' | 'limit'
  const [archiveName,  setArchiveName]  = useState('')
  const [archiveError, setArchiveError] = useState('')

  // Draft / autosave state. workoutId hydrates from the local cache so
  // same-tab navigations don't lose the link to the in-progress draft row.
  const [workoutId,   setWorkoutId]   = useState(cached?.workoutId || null)
  // If cache had data, treat the draft as loaded — autosave can run immediately,
  // and the Supabase resume effect only fires for cross-device pickup.
  const [draftLoaded, setDraftLoaded] = useState(!!cached)
  const [resumeBanner, setResumeBanner] = useState(null)  // { startedAt } | null  (silent resume notice)
  const [resumePrompt, setResumePrompt] = useState(null)  // { draftId, draftState, startedAt } | null  (>12h)

  // Mid-workout add/remove UI state
  const [pickerOpen,         setPickerOpen]         = useState(false)
  const [pickerName,         setPickerName]         = useState('')
  const [pickerType,         setPickerType]         = useState('exercise')
  const [pickerAlsoProgram,  setPickerAlsoProgram]  = useState(false)
  const [pickerErr,          setPickerErr]          = useState('')
  const [knownNames,         setKnownNames]         = useState([])
  const [removeTarget,       setRemoveTarget]       = useState(null)  // { name, alsoProgram }

  // PR tracking — exerciseBests: historical bests per exercise from DB
  //   { [name]: { bestE1RM, bestWeight, maxRepsAtWeight: {kg->reps} } }
  // prFlags: { [exName]: { setIdx, kind, current, previous, currentWeightKg } }
  //   kind priority: 'weight' > 'reps' > 'e1rm' (rarest/most motivating first)
  const [exerciseBests, setExerciseBests] = useState({})
  const [prFlags,       setPrFlags]       = useState({})

  useEffect(() => {
    getLastSession(day.id).then(setLastSession).catch(() => {})
  }, [day.id])

  // Resume effect — runs once on mount.
  // If the local cache already populated state with the right workoutId, skip
  // the Supabase fetch entirely — same-tab navigation is fully local.
  // Otherwise check for an in-progress workout on this day:
  //   - started ≤12h ago: resume silently (banner shown, autosave continues).
  //   - started >12h  ago: show prompt asking the user to Resume or Discard.
  useEffect(() => {
    if (!userId) return
    if (cached?.workoutId) return  // local cache is the source of truth this session
    let cancelled = false
    ;(async () => {
      try {
        const draft = await getInProgressWorkout(day.id, userId)
        if (cancelled) return
        if (!draft) {
          setDraftLoaded(true)
          return
        }
        const ageMs = Date.now() - new Date(draft.started_at).getTime()
        if (ageMs > 12 * 3600 * 1000) {
          setResumePrompt({
            draftId:    draft.id,
            draftState: draft.draft_state,
            startedAt:  draft.started_at,
          })
        } else {
          applyDraft(draft)
          setResumeBanner({ startedAt: draft.started_at })
        }
      } catch {
        // Non-fatal — proceed without resume.
        setDraftLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [day.id, userId]) // eslint-disable-line

  function applyDraft(draft) {
    const ds = draft.draft_state || {}
    if (Array.isArray(ds.exerciseList)) setExerciseList(ds.exerciseList)
    if (ds.sets         && typeof ds.sets         === 'object') setSets(ds.sets)
    if (ds.activityLogs && typeof ds.activityLogs === 'object') setActivityLogs(ds.activityLogs)
    setWorkoutId(draft.id)
    setDraftLoaded(true)
  }

  // Pre-fill set count from last session once it loads (only on untouched sets)
  useEffect(() => {
    if (!lastSession) return
    setSets(prev => {
      const next = { ...prev }
      for (const [exName, currentSets] of Object.entries(prev)) {
        const untouched = currentSets.every(s => s.weight === '' && s.reps === '')
        if (!untouched) continue
        const prevCount = lastSession.sets.filter(s => s.exercise_name === exName).length
        const count = prevCount > 0 ? prevCount : 2
        if (count !== currentSets.length) {
          next[exName] = Array.from({ length: count }, () => makeEmptySet())
        }
      }
      return next
    })
  }, [lastSession])

  // Load historical PR stats — refetch when the live exercise list changes
  // so mid-workout additions also get PR detection.
  const exerciseNamesKey = exerciseItems.map(e => e.name).join('||')
  useEffect(() => {
    const names = exerciseItems.map(e => e.name)
    if (!names.length || !userId) return
    getExerciseBests(names, userId).then(setExerciseBests).catch(() => {})
  }, [exerciseNamesKey, userId]) // eslint-disable-line

  // Recompute PR flags whenever sets change.
  // Checks each non-warmup set against three record types in priority order:
  //   weight PR (heaviest ever) > rep PR (most reps at this weight) > e1RM PR
  // Only the highest-priority hit on the best-qualifying set is surfaced.
  useEffect(() => {
    const newFlags = {}
    for (const [exName, exSets] of Object.entries(sets)) {
      const bests = exerciseBests[exName] || { bestE1RM: 0, bestWeight: 0, maxRepsAtWeight: {} }
      let winner = null  // { setIdx, kind, priority, score, previous, currentWeightKg }
      exSets.forEach((set, idx) => {
        if (set.is_warmup) return
        const wKg = parseInputWeight(set.weight, unit)
        const r   = parseInt(set.reps)
        if (isNaN(wKg) || isNaN(r) || wKg <= 0 || r <= 0) return

        // Weight PR (priority 0, best/highest)
        if (wKg > (bests.bestWeight || 0)) {
          const candidate = { setIdx: idx, kind: 'weight', priority: 0, score: wKg,
                              previous: bests.bestWeight || 0, currentWeightKg: wKg }
          if (!winner || candidate.priority < winner.priority ||
              (candidate.priority === winner.priority && candidate.score > winner.score)) {
            winner = candidate
            return
          }
        }
        // Rep PR at this weight (priority 1)
        const key = wKg.toFixed(1)
        const prevRepsAtWeight = bests.maxRepsAtWeight?.[key] || 0
        if (r > prevRepsAtWeight) {
          const candidate = { setIdx: idx, kind: 'reps', priority: 1, score: r,
                              previous: prevRepsAtWeight, currentWeightKg: wKg }
          if (!winner || candidate.priority < winner.priority ||
              (candidate.priority === winner.priority && candidate.score > winner.score)) {
            winner = candidate
            // fall through — a higher-priority weight PR could still show up
          }
        }
        // e1RM PR (priority 2)
        const e1rm = wKg * (1 + r / 30)
        if (e1rm > (bests.bestE1RM || 0)) {
          const candidate = { setIdx: idx, kind: 'e1rm', priority: 2, score: e1rm,
                              previous: bests.bestE1RM || 0, currentWeightKg: wKg }
          if (!winner || candidate.priority < winner.priority ||
              (candidate.priority === winner.priority && candidate.score > winner.score)) {
            winner = candidate
          }
        }
      })
      if (winner) newFlags[exName] = winner
    }
    setPrFlags(newFlags)
  }, [sets, exerciseBests, unit])

  // ── Autosave (drafts) ─────────────────────────────────────
  // The live state is captured into a ref so flush handlers (visibility,
  // unmount) always see the latest values without re-binding on every keystroke.
  const stateRef     = useRef({ sets, activityLogs, exerciseList })
  stateRef.current   = { sets, activityLogs, exerciseList }
  const workoutIdRef = useRef(workoutId)
  workoutIdRef.current = workoutId
  const flushPendingRef = useRef(false)  // guards against overlapping flushes

  // Detect whether the current state has anything worth saving.
  // Comparing exercise list identity to the program — any mid-workout
  // add/remove counts as "changed" too.
  const stateHasContent = (s, a, el) => {
    if (Object.values(s).some(arr => arr.some(r =>
        r.weight !== '' || r.reps !== '' || r.is_warmup ||
        (r.rir !== '' && r.rir != null) || (r.rpe !== '' && r.rpe != null)
    ))) return true
    if (Object.values(a).some(l =>
        l.checked || l.notes || l.duration_min || l.distance_display ||
        l.intensity || l.avg_hr || l.calories || l.rounds || l.elevation_display
    )) return true
    // Exercise list mutated relative to the program
    if (el.length !== day.exercises.length) return true
    for (let i = 0; i < el.length; i++) {
      if (el[i]?.name !== day.exercises[i]?.name) return true
    }
    return false
  }

  const flushDraft = async () => {
    if (!draftLoaded || !userId) return
    if (flushPendingRef.current) return
    const { sets: s, activityLogs: a, exerciseList: el } = stateRef.current
    if (!stateHasContent(s, a, el)) return
    flushPendingRef.current = true
    try {
      const dayLabel = `${day.name}${day.focus ? ` — ${day.focus}` : ''}`
      const result = await upsertDraft({
        workoutId:     workoutIdRef.current,
        trainingDayId: day.id,
        dayLabel,
        draftState:    { sets: s, activityLogs: a, exerciseList: el },
      }, userId)
      if (!workoutIdRef.current && result?.id) {
        workoutIdRef.current = result.id
        setWorkoutId(result.id)
      }
    } catch (e) {
      // Silent — the next debounce tick will retry. Surface only if persistent.
      console.warn('[autosave] failed', e?.message)
    } finally {
      flushPendingRef.current = false
    }
  }

  // Debounced autosave to Supabase: 5s after last keystroke or list mutation.
  useEffect(() => {
    if (!draftLoaded) return
    const id = setTimeout(flushDraft, 5000)
    return () => clearTimeout(id)
  }, [sets, activityLogs, exerciseList, draftLoaded]) // eslint-disable-line

  // Synchronous local mirror — writes on every change so same-tab navigation
  // (e.g. into ExerciseHistory and back) restores instantly. Only writes when
  // there's actual content; the empty initial state shouldn't pollute storage.
  useEffect(() => {
    if (!lsKey) return
    if (!stateHasContent(sets, activityLogs, exerciseList)) {
      // Nothing to save — clear any stale entry.
      clearLsDraft(lsKey)
      return
    }
    writeLsDraft(lsKey, { sets, activityLogs, exerciseList, workoutId })
  }, [lsKey, sets, activityLogs, exerciseList, workoutId]) // eslint-disable-line

  // Flush on tab hide (mobile background) + unmount.
  useEffect(() => {
    const onVis = () => { if (document.hidden) flushDraft() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      flushDraft()
    }
  }, [draftLoaded]) // eslint-disable-line

  // ── Exercise helpers ────────────────────────────────────
  const updateSet = (exName, idx, field, value) => {
    setSets(prev => ({
      ...prev,
      [exName]: prev[exName].map((s, i) => i === idx ? { ...s, [field]: value } : s),
    }))
  }

  const confirmSet = (exName, idx) => {
    setSets(prev => ({
      ...prev,
      [exName]: prev[exName].map((s, i) => i === idx ? { ...s, done: true } : s),
    }))
    if (timerEnabled) {
      setTimerKey(k => k + 1)
      setTimerActive(true)
    }
  }

  const addSet = (exName) =>
    setSets(prev => ({ ...prev, [exName]: [...prev[exName], makeEmptySet()] }))

  const toggleWarmup = (exName, idx) =>
    setSets(prev => ({
      ...prev,
      [exName]: prev[exName].map((s, i) => i === idx ? { ...s, is_warmup: !s.is_warmup } : s),
    }))

  const removeSet = (exName, idx) =>
    setSets(prev => ({ ...prev, [exName]: prev[exName].filter((_, i) => i !== idx) }))

  const getLastSets = (exName) => {
    if (!lastSession) return []
    return lastSession.sets.filter(s => s.exercise_name === exName)
  }

  // ── Activity helpers ────────────────────────────────────
  const toggleActivity = (name) =>
    setActivityLogs(prev => ({ ...prev, [name]: { ...prev[name], checked: !prev[name].checked } }))

  const updateActivityField = (name, field, value) =>
    setActivityLogs(prev => ({ ...prev, [name]: { ...prev[name], [field]: value } }))

  // Last-session activity log for a given activity, if any.
  // Only the first matching row (set_number=1) is relevant.
  const getLastActivityLog = (name) => {
    if (!lastSession) return null
    return lastSession.sets.find(s => s.exercise_name === name && s.set_number === 1) || null
  }

  // ── Mid-workout add / remove exercise ────────────────────
  const openAddPicker = async () => {
    setPickerOpen(true)
    setPickerName('')
    setPickerErr('')
    setPickerType('exercise')
    setPickerAlsoProgram(false)
    if (knownNames.length === 0 && userId) {
      try {
        const names = await getAllKnownExerciseNames(userId)
        setKnownNames(names)
      } catch { /* non-fatal */ }
    }
  }

  const confirmAddPicker = async () => {
    const name = pickerName.trim()
    if (!name) { setPickerErr('Enter a name.'); return }
    if (exerciseList.some(e => e.name.toLowerCase() === name.toLowerCase())) {
      setPickerErr('Already in this workout.'); return
    }
    const picked = {
      name,
      target:    '',
      item_type: pickerType,
      activity_fields: pickerType === 'activity' ? null : undefined,
    }
    setExerciseList(prev => [...prev, picked])
    if (pickerType === 'activity') {
      setActivityLogs(prev => ({ ...prev, [name]: makeEmptyActivity() }))
    } else {
      setSets(prev => ({ ...prev, [name]: [makeEmptySet(), makeEmptySet()] }))
    }
    setPickerOpen(false)
    if (pickerAlsoProgram) {
      try {
        await addExerciseToProgram(day.id, picked, userId)
      } catch (e) {
        setErrMsg(`Couldn't add to program: ${e.message}`)
      }
    }
    flushDraft()
  }

  const confirmRemoveExercise = async () => {
    if (!removeTarget) return
    const { name, alsoProgram } = removeTarget
    setExerciseList(prev => prev.filter(e => e.name !== name))
    setSets(prev => {
      if (!(name in prev)) return prev
      const next = { ...prev }; delete next[name]; return next
    })
    setActivityLogs(prev => {
      if (!(name in prev)) return prev
      const next = { ...prev }; delete next[name]; return next
    })
    setRemoveTarget(null)
    if (alsoProgram) {
      try {
        await removeExerciseFromProgram(day.id, name, userId)
      } catch (e) {
        setErrMsg(`Couldn't remove from program: ${e.message}`)
      }
    }
    flushDraft()
  }

  // ── Completion ──────────────────────────────────────────
  const hasData =
    Object.values(sets).some(s => s.some(r => r.weight !== '' || r.reps !== '')) ||
    Object.values(activityLogs).some(l =>
      l.checked || l.duration_min || l.distance_display || l.intensity ||
      l.avg_hr || l.calories || l.rounds || l.elevation_display || l.notes
    )

  const handleComplete = async () => {
    if (!hasData && !isRestDay) { setErrMsg('Log at least one set or check an activity first.'); return }
    setStatus('saving')
    setErrMsg('')
    try {
      // Convert user-unit weights to kg before persisting.
      // Preserves empty strings → NaN → saved as 0 in supabase.js.
      const setsForSave = Object.fromEntries(
        Object.entries(sets).map(([name, arr]) => [
          name,
          arr.map(s => ({
            weight_kg: parseInputWeight(s.weight, unit),
            reps:      s.reps,
            is_warmup: !!s.is_warmup,
            rir:       s.rir,
            rpe:       s.rpe,
          })),
        ])
      )
      // Canonicalize activity distances/elevations into km/m before saving.
      const activityLogsForSave = Object.fromEntries(
        Object.entries(activityLogs).map(([name, log]) => {
          const distKm = log.distance_display === '' || log.distance_display == null
            ? null
            : parseInputDistance(log.distance_display, unit)
          const elevM  = log.elevation_display === '' || log.elevation_display == null
            ? null
            : parseInputElevation(log.elevation_display, unit)
          return [name, {
            checked:      log.checked,
            notes:        log.notes,
            duration_min: log.duration_min,
            distance_km:  isNaN(distKm) ? null : distKm,
            intensity:    log.intensity,
            avg_hr:       log.avg_hr,
            calories:     log.calories,
            rounds:       log.rounds,
            elevation_m:  isNaN(elevM) ? null : elevM,
          }]
        })
      )
      // Ensure a draft row exists before flipping it to completed.
      const dayLabel = `${day.name}${day.focus ? ` — ${day.focus}` : ''}`
      let id = workoutIdRef.current
      if (!id) {
        const draft = await upsertDraft({
          trainingDayId: day.id,
          dayLabel,
          draftState:    { sets, activityLogs, exerciseList },
        }, userId)
        id = draft.id
        setWorkoutId(id)
        workoutIdRef.current = id
      }
      const workout = await completeWorkout(
        id, dayLabel, setsForSave, activityLogsForSave, userId
      )
      // The draft is now a finalized workout — drop the local cache.
      clearLsDraft(lsKey)
      const currentVolKg = calcSessionVolume(sets, unit)
      let msg = ''
      try {
        const prev = await getPreviousSessionVolume(day.id, workout.id)
        msg = buildVolumeMsg(currentVolKg, prev) || ''
      } catch {
        // non-fatal — skip the message if the fetch fails
      }
      setVolumeMsg(msg)
      setStatus('saved')
    } catch (e) {
      setErrMsg(e.message || 'Failed to save — please try again.')
      setStatus('idle')
    }
  }

  const handleArchiveTrigger = () => {
    setArchiveName(day.name + (day.focus ? ` — ${day.focus}` : ''))
    setArchiveStep('naming')
  }

  const handleArchiveSave = async () => {
    if (!archiveName.trim()) { setArchiveError('Enter a name'); return }
    setArchiveStep('saving')
    setArchiveError('')
    try {
      await saveTemplate(archiveName, day.id, exerciseList, userId)
      setArchiveStep('done')
    } catch (e) {
      if (e.message === 'LIMIT_REACHED') {
        setArchiveStep('limit')
      } else {
        setArchiveError(e.message)
        setArchiveStep('naming')
      }
    }
  }

  const isRestDay = exerciseList.every(e => e.item_type === 'activity') // true for empty days too
  const isEmpty   = exerciseList.length === 0
  const isGymDay  = !isEmpty && exerciseItems.length >= activityItems.length
  const titleColor = isEmpty ? '#666' : isGymDay ? 'var(--accent)' : 'var(--cyan)'

  const lastDate = lastSession?.workout?.completed_at
    ? new Date(lastSession.workout.completed_at).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : null


  return (
    <div className="screen">
      <div className="workout-sticky-top">
        <header className="workout-header">
          <button className="back-btn" onClick={onBack}>←</button>
          <div className="workout-header__info">
            <div className="workout-header__name">
              {day.name}
              {day.focus && <><span style={{ color: 'var(--text-muted)' }}> — </span><span style={{ color: titleColor }}>{day.focus}</span></>}
            </div>
          </div>
          {lastDate && <div className="workout-header__last">Last: {lastDate}</div>}
          <button
            className={`timer-toggle${timerEnabled ? ' timer-toggle--on' : ''}`}
            onClick={() => {
              const next = !timerEnabled
              setTimerEnabled(next)
              if (!next) setTimerActive(false)
            }}
            title={timerEnabled ? 'Timer on — tap to disable' : 'Timer off — tap to enable'}
          >
            ⏱
          </button>
          <button
            className="save-workout-btn"
            onClick={handleArchiveTrigger}
            title="Save workout as template"
            aria-label="Save workout"
          >
            Save
          </button>
        </header>

        {timerActive && (
          <RestTimer
            key={timerKey}
            total={restSeconds}
            onDismiss={() => setTimerActive(false)}
          />
        )}
      </div>

      <div className="content">
        {resumeBanner && (
          <div className="resume-banner">
            <span>Resumed from earlier — your sets are loaded.</span>
            <div className="resume-banner-btns">
              <button
                className="resume-banner-discard"
                onClick={async () => {
                  clearLsDraft(lsKey)
                  if (!workoutId) { setResumeBanner(null); onBack(); return }
                  try { await discardDraft(workoutId, userId) } catch {}
                  onBack()
                }}
                title="Discard this draft and go back"
              >Discard</button>
              <button className="resume-banner-x" onClick={() => setResumeBanner(null)} aria-label="Dismiss">×</button>
            </div>
          </div>
        )}

        {/* Render items in their original order, mixing types */}
        {exerciseList.map(item =>
          item.item_type === 'activity' ? (
            <ActivityCard
              key={item.name}
              item={item}
              log={activityLogs[item.name] || makeEmptyActivity()}
              unit={unit}
              lastLog={getLastActivityLog(item.name)}
              onToggle={() => toggleActivity(item.name)}
              onUpdate={(field, val) => updateActivityField(item.name, field, val)}
              onRemoveExercise={() => setRemoveTarget({ name: item.name, alsoProgram: false })}
            />
          ) : (
            <ExerciseCard
              key={item.name}
              exercise={item}
              sets={sets[item.name] || [makeEmptySet(), makeEmptySet()]}
              lastSets={getLastSets(item.name)}
              prInfo={prFlags[item.name]}
              unit={unit}
              intensityMode={intensityMode}
              onUpdate={(idx, field, val) => updateSet(item.name, idx, field, val)}
              onConfirm={idx => confirmSet(item.name, idx)}
              onAdd={() => addSet(item.name)}
              onRemove={idx => removeSet(item.name, idx)}
              onHistory={() => onHistory(item.name)}
              onToggleWarmup={idx => toggleWarmup(item.name, idx)}
              onRemoveExercise={() => setRemoveTarget({ name: item.name, alsoProgram: false })}
            />
          )
        )}

        <button className="add-exercise-btn" onClick={openAddPicker}>
          + Add exercise
        </button>

        {errMsg && <p className="err-msg">{errMsg}</p>}

        <button
          className={`complete-btn ${status === 'saved' ? 'complete-btn--saved' : ''}`}
          onClick={handleComplete}
          disabled={status === 'saving' || status === 'saved'}
        >
          {status === 'saved'   ? '✓ Done!'
           : status === 'saving' ? 'Saving…'
           : isRestDay ? 'Ticked Off' : 'Complete Workout'}
        </button>

        {status === 'saved' && volumeMsg && (
          <div className="volume-msg">{volumeMsg}</div>
        )}

        {archiveStep === 'naming' && (
          <div className="archive-form">
            <div className="archive-form-label">Save workout as template</div>
            <input
              className="field-input"
              placeholder="Template name…"
              value={archiveName}
              onChange={e => { setArchiveName(e.target.value); setArchiveError('') }}
              onKeyDown={e => e.key === 'Enter' && handleArchiveSave()}
              autoFocus
            />
            {archiveError && <div className="err-msg" style={{ marginTop: 4 }}>{archiveError}</div>}
            <div className="archive-form-actions">
              <button className="archive-save-btn" onClick={handleArchiveSave}>Save</button>
              <button className="archive-cancel-btn" onClick={() => setArchiveStep(null)}>Cancel</button>
            </div>
          </div>
        )}

        {archiveStep === 'saving' && (
          <div className="archive-msg">Saving…</div>
        )}

        {archiveStep === 'done' && (
          <div className="archive-msg archive-msg--done">Saved!</div>
        )}

        {archiveStep === 'limit' && (
          <div className="archive-msg archive-msg--warn">
            Saved workout limit reached (10/10) — delete one from Saved Workouts first.
          </div>
        )}

        <div style={{ height: 40 }} />
      </div>

      {/* ── Resume prompt: draft started >12h ago ──────────── */}
      {resumePrompt && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <h3 className="modal-title">Unfinished workout</h3>
            <p className="modal-body">
              You started this workout {new Date(resumePrompt.startedAt).toLocaleString('en-US', {
                weekday: 'short', hour: 'numeric', minute: '2-digit',
              })} but didn't finish. Resume where you left off, or discard?
            </p>
            <div className="modal-actions">
              <button
                className="modal-btn-primary"
                onClick={() => {
                  applyDraft({ id: resumePrompt.draftId, draft_state: resumePrompt.draftState })
                  setResumeBanner({ startedAt: resumePrompt.startedAt })
                  setResumePrompt(null)
                }}
              >Resume</button>
              <button
                className="modal-btn-danger"
                onClick={async () => {
                  clearLsDraft(lsKey)
                  try { await discardDraft(resumePrompt.draftId, userId) } catch {}
                  setResumePrompt(null)
                  setDraftLoaded(true)
                }}
              >Discard</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add exercise picker ──────────────────────────── */}
      {pickerOpen && (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Add exercise to this workout</h3>
            <div className="picker-type-row">
              <button
                className={`picker-type-chip${pickerType === 'exercise' ? ' picker-type-chip--on' : ''}`}
                onClick={() => setPickerType('exercise')}
              >Exercise</button>
              <button
                className={`picker-type-chip${pickerType === 'activity' ? ' picker-type-chip--on' : ''}`}
                onClick={() => setPickerType('activity')}
              >Activity</button>
            </div>
            <input
              className="field-input"
              list="picker-known-names"
              placeholder="Exercise name…"
              value={pickerName}
              onChange={e => { setPickerName(e.target.value); setPickerErr('') }}
              onKeyDown={e => e.key === 'Enter' && confirmAddPicker()}
              autoFocus
            />
            <datalist id="picker-known-names">
              {knownNames.map(n => <option key={n} value={n} />)}
            </datalist>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={pickerAlsoProgram}
                onChange={e => setPickerAlsoProgram(e.target.checked)}
              />
              Also add to {day.name} program
            </label>
            {pickerErr && <div className="err-msg" style={{ marginTop: 4 }}>{pickerErr}</div>}
            <div className="modal-actions">
              <button className="modal-btn-primary" onClick={confirmAddPicker}>Add</button>
              <button className="modal-btn-cancel" onClick={() => setPickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Remove exercise confirm ──────────────────────── */}
      {removeTarget && (
        <div className="modal-backdrop" onClick={() => setRemoveTarget(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Remove {removeTarget.name}?</h3>
            <p className="modal-body">This will remove it from today's workout.</p>
            <label className="modal-checkbox">
              <input
                type="checkbox"
                checked={removeTarget.alsoProgram}
                onChange={e => setRemoveTarget({ ...removeTarget, alsoProgram: e.target.checked })}
              />
              Also remove from {day.name} program
            </label>
            <div className="modal-actions">
              <button className="modal-btn-danger" onClick={confirmRemoveExercise}>Remove</button>
              <button className="modal-btn-cancel" onClick={() => setRemoveTarget(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
