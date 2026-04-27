import React, { useState, useEffect, useRef } from 'react'
import {
  getCompletedSessionsThisWeek,
  getInProgressWorkout,
  insertCompletedSession,
  addExerciseToProgram,
  getAllKnownExerciseNames,
} from '../supabase'
import WorkoutBuilderModal from './WorkoutBuilderModal'
import {
  parseInputDistance, distanceUnitLabel,
  parseInputElevation, elevationUnitLabel,
  displayDistance, displayElevation,
} from '../utils/units'
import { DEFAULT_ACTIVITY_FIELDS } from '../data/commonActivities'
import EditDayModal from './EditDayModal'
import CatalogPickerModal from './CatalogPickerModal'
import { ACTIVITY_CATALOG } from '../data/activityCatalog'

// Local-storage key for ad-hoc activity input state on a per-day basis.
// Keeps unsaved typing across navigations until the user checks the activity
// off (which writes to DB) or discards.
const lsKeyFor = (uid, dayId) => `wt:dayinputs:${uid}:${dayId}`
const readLs = (key) => {
  if (!key || typeof window === 'undefined') return null
  try { return JSON.parse(window.localStorage.getItem(key) || 'null') } catch { return null }
}
const writeLs = (key, val) => {
  if (!key || typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
const clearLs = (key) => {
  if (!key || typeof window === 'undefined') return
  try { window.localStorage.removeItem(key) } catch {}
}

const makeEmptyActivity = () => ({
  notes: '',
  duration_min: '', distance_display: '', intensity: '',
  avg_hr: '', calories: '', rounds: '', elevation_display: '',
})

// Single activity card: shows fields configured for this activity, an
// inputs grid, a check circle (left), and locks once saved as a session.
function DayActivityCard({ item, log, unit, onUpdate, onComplete, doneAt, saving }) {
  const fields = item.activity_fields || DEFAULT_ACTIVITY_FIELDS
  const has = (k) => fields.includes(k)
  const isDone = !!doneAt

  return (
    <div className={`day-activity-card${isDone ? ' day-activity-card--done' : ''}`}>
      <div className="day-activity-card__top">
        <button
          type="button"
          className={`day-activity-check${isDone ? ' day-activity-check--on' : ''}`}
          onClick={onComplete}
          disabled={isDone || saving}
          aria-label={isDone ? 'Completed' : 'Mark complete'}
        >{isDone ? '✓' : ''}</button>
        <div className="day-activity-card__title">
          <span className="day-activity-card__name">{item.name}</span>
          {item.target && <span className="day-activity-card__target">{item.target}</span>}
          {isDone && (
            <span className="day-activity-card__time">
              ✓ Completed {new Date(doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      {!isDone && (
        <div className="day-activity-card__body">
          {(has('duration_min') || has('distance_km') || has('avg_hr') ||
            has('calories') || has('rounds') || has('elevation_m') || has('intensity')) && (
            <div className="activity-log-grid">
              {has('duration_min') && (
                <div className="activity-field">
                  <label className="activity-field-label">Duration</label>
                  <div className="activity-field-input-wrap">
                    <input
                      className="activity-field-input"
                      type="number" inputMode="decimal"
                      value={log.duration_min ?? ''}
                      onChange={e => onUpdate('duration_min', e.target.value)}
                      onFocus={e => e.target.select()}
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
                      type="number" inputMode="decimal" step="0.01"
                      value={log.distance_display ?? ''}
                      onChange={e => onUpdate('distance_display', e.target.value)}
                      onFocus={e => e.target.select()}
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
                      type="number" inputMode="numeric"
                      value={log.avg_hr ?? ''}
                      onChange={e => onUpdate('avg_hr', e.target.value)}
                      onFocus={e => e.target.select()}
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
                      type="number" inputMode="numeric"
                      value={log.calories ?? ''}
                      onChange={e => onUpdate('calories', e.target.value)}
                      onFocus={e => e.target.select()}
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
                      type="number" inputMode="numeric"
                      value={log.rounds ?? ''}
                      onChange={e => onUpdate('rounds', e.target.value)}
                      onFocus={e => e.target.select()}
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
                      type="number" inputMode="numeric"
                      value={log.elevation_display ?? ''}
                      onChange={e => onUpdate('elevation_display', e.target.value)}
                      onFocus={e => e.target.select()}
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
      )}
    </div>
  )
}

export default function DayScreen({ day, program, userId, profile, onBack, onSelectWorkout, onProgramUpdated }) {
  const unit = profile?.weight_unit || 'kg'

  // Each workout block is its own session. Activities are independent items.
  const blocks        = day.workout_blocks || []
  const activityItems = (day.exercises || []).filter(e => e.item_type === 'activity')

  // Per-week completion state, keyed by block id (for workouts) and activity
  // name. Hydrated from DB on mount.
  const [workoutDoneByBlock, setWorkoutDoneByBlock] = useState({})  // { [blockId]: ISO }
  const [activityDoneAt, setActivityDoneAt]         = useState({})  // { [name]: ISO }
  const [activitySaving, setActivitySaving]         = useState({})
  const [builderOpen, setBuilderOpen]               = useState(false)

  // Activity input state — typed values that haven't been saved yet.
  const lsKey = userId ? lsKeyFor(userId, day.id) : null
  const [activityInputs, setActivityInputs] = useState(() => {
    const cached = readLs(lsKey) || {}
    const seed = {}
    for (const a of activityItems) {
      seed[a.name] = (cached[a.name]) || makeEmptyActivity()
    }
    return seed
  })
  // Eslint won't see activityItems as a dep in initializer; keep ref to silence churn.
  const inputsRef = useRef(activityInputs)
  inputsRef.current = activityInputs

  useEffect(() => {
    if (!lsKey) return
    writeLs(lsKey, activityInputs)
  }, [lsKey, activityInputs])

  // Hydrate completion state for the current week — both workout-block
  // completions and activity completions.
  useEffect(() => {
    if (!userId || !day.id) return
    let cancelled = false
    ;(async () => {
      try {
        const sessions = await getCompletedSessionsThisWeek(userId, day.id)
        if (cancelled) return
        const blockMap = {}
        const actMap = {}
        for (const s of sessions) {
          if (s.kind === 'workout') {
            const key = s.workout_block_id || '_default'
            if (!blockMap[key]) blockMap[key] = s.completed_at
          } else if (s.kind === 'activity' && s.activity_name) {
            actMap[s.activity_name] = s.completed_at
          }
        }
        setWorkoutDoneByBlock(blockMap)
        setActivityDoneAt(actMap)
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  }, [userId, day.id])

  const updateActivityInput = (name, field, val) => {
    setActivityInputs(prev => ({
      ...prev,
      [name]: { ...(prev[name] || makeEmptyActivity()), [field]: val },
    }))
  }

  const handleCompleteActivity = async (name) => {
    const log = activityInputs[name] || makeEmptyActivity()
    const distKm = log.distance_display === '' || log.distance_display == null
      ? null
      : parseInputDistance(log.distance_display, unit)
    const elevM = log.elevation_display === '' || log.elevation_display == null
      ? null
      : parseInputElevation(log.elevation_display, unit)
    const canonical = {
      checked:      true,
      notes:        log.notes,
      duration_min: log.duration_min,
      distance_km:  isNaN(distKm) ? null : distKm,
      intensity:    log.intensity,
      avg_hr:       log.avg_hr,
      calories:     log.calories,
      rounds:       log.rounds,
      elevation_m:  isNaN(elevM) ? null : elevM,
    }
    setActivitySaving(prev => ({ ...prev, [name]: true }))
    try {
      const saved = await insertCompletedSession({
        trainingDayId: day.id,
        dayLabel:      name,
        kind:          'activity',
        activityName:  name,
        activityLogs:  { [name]: canonical },
      }, userId)
      setActivityDoneAt(prev => ({ ...prev, [name]: saved.completed_at || new Date().toISOString() }))
      // Clear inputs for this activity since it's done.
      setActivityInputs(prev => {
        const next = { ...prev }
        delete next[name]
        return next
      })
    } catch (e) {
      alert(`Couldn't save ${name}: ${e.message}`)
    } finally {
      setActivitySaving(prev => {
        const next = { ...prev }; delete next[name]; return next
      })
    }
  }

  // ── Add to today UI state ─────────────────────────────────
  const [addOpen, setAddOpen] = useState(false)
  const [pickerKind, setPickerKind] = useState(null)  // null | 'activity'
  const [knownNames, setKnownNames] = useState([])
  const [editDayOpen, setEditDayOpen] = useState(false)

  const openAddActivity = async () => {
    setAddOpen(false)
    setPickerKind('activity')
    if (knownNames.length === 0 && userId) {
      try {
        const names = await getAllKnownExerciseNames(userId)
        setKnownNames(names)
      } catch { /* non-fatal */ }
    }
  }

  const handlePickActivity = async (name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    if (activityItems.some(a => a.name.toLowerCase() === trimmed.toLowerCase())) {
      setPickerKind(null)
      return
    }
    // For now, ad-hoc activities are added permanently to the day's program.
    // (Today-only adds will come in a follow-up — needs a different storage path.)
    try {
      await addExerciseToProgram(day.id, {
        name: trimmed,
        target: '',
        item_type: 'activity',
        activity_fields: null,
      }, userId)
      onProgramUpdated && onProgramUpdated()
    } catch (e) {
      alert(`Couldn't add activity: ${e.message}`)
    }
    setPickerKind(null)
  }

  // Helper that maps a block to its current status for the card UI.
  const statusForBlock = (b) => {
    const key = b.id || '_default'
    if (workoutDoneByBlock[key]) return { kind: 'completed', at: workoutDoneByBlock[key] }
    return { kind: 'not_started' }
  }

  return (
    <div className="screen">
      <header className="sub-header day-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">{day.name}</div>
        </div>
        <button
          className="day-edit-pill"
          onClick={() => setEditDayOpen(true)}
        >Edit</button>
      </header>

      <div className="content">
        {/* ── Workout section ───────────────────────────────── */}
        {blocks.length > 0 && (
          <>
            <div className="day-section-label day-section-label--workout">
              {blocks.length === 1 ? 'Workout' : 'Workouts'}
            </div>
            {blocks.map(b => {
              const status = statusForBlock(b)
              const exCount = (b.exercises || []).length
              return (
                <button
                  key={b.id || '_default'}
                  className={`day-workout-card day-workout-card--${status.kind}`}
                  onClick={() => onSelectWorkout(b)}
                >
                  <div className="day-workout-card__main">
                    <div className="day-workout-card__name">{b.name}</div>
                    <div className="day-workout-card__count">
                      {exCount} exercise{exCount === 1 ? '' : 's'}
                    </div>
                    <div className="day-workout-card__status">
                      {status.kind === 'completed'
                        ? <span className="day-workout-card__status-done">
                            ✓ Completed {new Date(status.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </span>
                        : <span className="day-workout-card__status-idle">Tap to start workout</span>}
                    </div>
                  </div>
                  <span className="day-workout-card__arrow">›</span>
                </button>
              )
            })}
          </>
        )}

        {/* ── Activities section ────────────────────────────── */}
        {activityItems.length > 0 && (
          <>
            <div className="day-section-label day-section-label--activity">Activities</div>
            {activityItems.map(item => (
              <DayActivityCard
                key={item.name}
                item={item}
                log={activityInputs[item.name] || makeEmptyActivity()}
                unit={unit}
                onUpdate={(field, val) => updateActivityInput(item.name, field, val)}
                onComplete={() => handleCompleteActivity(item.name)}
                doneAt={activityDoneAt[item.name] || null}
                saving={!!activitySaving[item.name]}
              />
            ))}
          </>
        )}

        {blocks.length === 0 && activityItems.length === 0 && (
          <div className="state-msg state-msg--empty">
            Nothing in {day.name} yet — tap “Add to today” to start.
          </div>
        )}

        {/* ── Add to today ──────────────────────────────────── */}
        <button className="day-add-btn" onClick={() => setAddOpen(true)}>+ Add to today</button>

        <div style={{ height: 60 }} />
      </div>

      {/* Add menu */}
      {addOpen && (
        <div className="modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Add to today</h3>
            <p className="modal-body">What do you want to add to {day.name}?</p>
            <div className="modal-actions modal-actions--stack">
              <button
                className="modal-btn-primary day-add-btn--ex"
                onClick={() => { setAddOpen(false); setBuilderOpen(true) }}
              >+ Add a workout</button>
              <button
                className="modal-btn-primary day-add-btn--act"
                onClick={openAddActivity}
              >+ Add an activity</button>
              <button className="modal-btn-cancel" onClick={() => setAddOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <WorkoutBuilderModal
        open={builderOpen}
        dayId={day.id}
        userId={userId}
        onClose={() => setBuilderOpen(false)}
        onCreated={async (block) => {
          if (onProgramUpdated) await onProgramUpdated()
          // Jump straight into the new (empty) workout's session so the user
          // can start adding exercises and logging sets.
          if (block) onSelectWorkout(block)
        }}
      />

      {pickerKind === 'activity' && (
        <CatalogPickerModal
          open
          onClose={() => setPickerKind(null)}
          onPick={handlePickActivity}
          catalog={ACTIVITY_CATALOG}
          userKnownNames={knownNames}
          existingNames={activityItems.map(a => a.name)}
          title="Add activity"
          createLabel="+ Create your own activity"
          createPlaceholder="Activity name"
          yourGroupLabel="Your activities"
        />
      )}

      {editDayOpen && (
        <EditDayModal
          open
          day={day}
          program={program || [day]}
          userId={userId}
          onClose={() => setEditDayOpen(false)}
          onSaved={onProgramUpdated}
        />
      )}
    </div>
  )
}
