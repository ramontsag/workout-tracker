import React, { useState, useEffect, useRef } from 'react'
import {
  getLastSession, getPreviousSessionVolume, saveTemplate, getExerciseBests,
  getInProgressWorkout, upsertDraft, discardDraft,
  addExerciseToProgram, removeExerciseFromProgram, getAllKnownExerciseNames,
  updateDayMeta, updateWorkoutBlock, deleteCustomItem,
  insertCompletedSession, updateCompletedSession,
  getTemplates, getLastSetsByExercise,
  getGyms, createGym, updateGym, deleteGym, setActiveGym,
} from '../supabase'
import GymPickerSheet from './GymPickerSheet'
import {
  displayWeight, parseInputWeight, unitLabel, kgToInputValue,
  displayDistance, parseInputDistance, distanceUnitLabel,
  displayElevation, parseInputElevation, elevationUnitLabel,
} from '../utils/units'
import { DEFAULT_ACTIVITY_FIELDS } from '../data/commonActivities'
import { useRestTimer } from '../useRestTimer'
import { useActiveWorkout } from '../useActiveWorkout'
import { getState as getActiveWorkout, start as startActiveWorkout, clear as clearActiveWorkout } from '../activeWorkoutStore'
import CatalogPickerModal from './CatalogPickerModal'
import EditDayModal from './EditDayModal'
import RestPickerSheet from './RestPickerSheet'
import { EXERCISE_CATALOG } from '../data/exerciseCatalog'
import { ACTIVITY_CATALOG } from '../data/activityCatalog'

function fmt(val) {
  return val === 0 || val === '0' ? '—' : val
}

function formatRestShort(s) {
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r === 0 ? `${m}m` : `${m}:${String(r).padStart(2, '0')}`
  }
  return `${s}s`
}

// MM:SS for short workouts, H:MM:SS once we cross an hour.
function formatDuration(secs) {
  if (!isFinite(secs) || secs < 0) secs = 0
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  const s = Math.floor(secs % 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
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
// Reads from the global rest-timer store so the countdown survives
// navigation, reload, and tab close. Wall-clock based — see restTimerStore.js.
function RestTimer({ onDismiss, onReset }) {
  const { remaining, total, active } = useRestTimer()
  if (total === 0) return null

  const done = !active
  const pct  = total > 0 ? (remaining / total) * 100 : 0
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
          <button className="rest-timer-btn" onClick={onReset} title="Reset">↺</button>
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
// Cumulative volume comparison vs last session of the same training day.
// Updates as sets are completed: first set today vs first set last week,
// two sets vs two, etc. Warmups and drop sets are excluded on both sides.
// Returns null (no arrow) until at least one working set is completed today,
// or when volumes match — per the user's spec, no glyph for "same".
function progressIndicator(sets, lastSets, unit) {
  const todayDone = (sets || []).filter(s => !s.is_warmup && !s.is_drop_set && s.done)
  const lastWork  = (lastSets || []).filter(s => !s.is_warmup && !s.is_drop_set)
  if (todayDone.length === 0 || lastWork.length === 0) return null

  const todayVol = todayDone.reduce((sum, s) => {
    const w = parseInputWeight(s.weight, unit); const r = parseInt(s.reps)
    return isNaN(w) || isNaN(r) ? sum : sum + w * r
  }, 0)
  const lastVol = lastWork.slice(0, todayDone.length).reduce((sum, s) => {
    const w = parseFloat(s.weight_kg); const r = parseInt(s.reps)
    return isNaN(w) || isNaN(r) ? sum : sum + w * r
  }, 0)
  if (todayVol === 0 || lastVol === 0) return null
  if (todayVol > lastVol) return { label: '↑', cls: 'ex-progress--up' }
  if (todayVol < lastVol) return { label: '↓', cls: 'ex-progress--down' }
  return null
}

// ── Post-workout summary modal ────────────────────────────────
// Shown after Complete Workout saves successfully. Surfaces total volume,
// total reps and sets, comparison vs last session, and any PRs hit. Tap
// Done (or backdrop) to navigate home.
function WorkoutSummary({ summary, unit, onClose, onEdit }) {
  if (!summary) return null
  const label = unitLabel(unit)
  const { totalVolKg, totalReps, totalSets, prs, volumeMsg } = summary
  const headline = prs.length > 0
    ? `🎉 ${prs.length} PR${prs.length === 1 ? '' : 's'} smashed!`
    : 'Workout complete 💪'
  const subline = prs.length === 0
    ? 'Another rep in the bank — consistency is the lift.'
    : null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card workout-summary" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title summary-title">{headline}</h3>
        {subline && <p className="summary-subline">{subline}</p>}
        <div className="summary-stats">
          <div className="summary-stat">
            <div className="summary-stat__val">{fmt(displayWeight(totalVolKg, unit))}</div>
            <div className="summary-stat__label">{label} lifted</div>
          </div>
          <div className="summary-stat">
            <div className="summary-stat__val">{totalSets}</div>
            <div className="summary-stat__label">{totalSets === 1 ? 'set' : 'sets'}</div>
          </div>
          <div className="summary-stat">
            <div className="summary-stat__val">{totalReps}</div>
            <div className="summary-stat__label">{totalReps === 1 ? 'rep' : 'reps'}</div>
          </div>
        </div>
        {volumeMsg && <p className="summary-msg">{volumeMsg}</p>}
        {prs.length > 0 && (
          <div className="summary-prs">
            {prs.map(pr => {
              let icon, msg
              if (pr.kind === 'weight') {
                icon = '🏆'
                msg = `New heaviest ${pr.exerciseName} — ${fmt(displayWeight(pr.currentWeightKg, unit))} ${label}`
              } else if (pr.kind === 'reps') {
                icon = '🔥'
                msg = `Rep PR on ${pr.exerciseName} — ${pr.score} reps at ${fmt(displayWeight(pr.currentWeightKg, unit))} ${label}`
              } else {
                icon = '📈'
                msg = `New estimated 1RM on ${pr.exerciseName} — ~${fmt(displayWeight(pr.score, unit))} ${label}`
              }
              return (
                <div key={pr.exerciseName} className="summary-pr">
                  <span className="summary-pr__icon">{icon}</span>
                  <span className="summary-pr__msg">{msg}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="modal-actions">
          {onEdit && (
            <button className="modal-btn-cancel" onClick={onEdit}>Edit</button>
          )}
          <button className="modal-btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
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
  onUpdate, onConfirm, onAdd, onHistory, onToggleWarmup,
  onRemoveExercise, onCopyLast, onAddDrop, onFocusWeight,
}) {
  const prog = progressIndicator(sets, lastSets, unit)
  const label = unitLabel(unit)
  const lastSummary = lastSets.length > 0
    ? lastSets
        .filter(s => !s.is_warmup && !s.is_drop_set)
        .map(s => `${fmt(displayWeight(s.weight_kg, unit))}${label}×${fmt(s.reps)}`)
        .join(' · ')
    : null

  // Working-set numbering: drops and warmups don't increment.
  // Index → 1-based number for working sets, null for warmups/drops.
  const workingNumbers = []
  let _wn = 0
  sets.forEach((s, i) => {
    if (!s.is_warmup && !s.is_drop_set) { _wn++; workingNumbers[i] = _wn }
    else workingNumbers[i] = null
  })

  return (
    <div className="ex-card">
      <div className="ex-header">
        <div className="ex-header__left">
          <div className="ex-header__name-row">
            <span className="ex-name">{exercise.name}</span>
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
        <div className="ex-last-summary">
          <span className="ex-last-summary__text">Last time: {lastSummary}</span>
          {onCopyLast && (
            <button
              type="button"
              className="ex-copy-btn"
              onClick={onCopyLast}
              title="Pre-fill empty sets with last session's values"
            >Copy</button>
          )}
        </div>
      )}

      <div className="sets-list">
        {sets.map((set, idx) => {
          const prev = lastSets[idx]
          const isDrop = !!set.is_drop_set
          const showIntensity = intensityMode !== 'off' && !set.is_warmup && !isDrop
          const intensityField = intensityMode === 'rpe' ? 'rpe' : 'rir'
          const setLabel = isDrop ? '↓' : set.is_warmup ? 'W' : workingNumbers[idx]
          return (
            <div key={idx} className="set-item">
              <div className={`set-row${set.done ? ' set-row--done' : ''}${set.is_warmup ? ' set-row--warmup' : ''}${isDrop ? ' set-row--drop' : ''}`}>
                <span className="set-num">{setLabel}</span>
                <div className="set-input-group">
                  <input
                    className="set-input"
                    type="text"
                    inputMode="decimal"
                    placeholder={label.toUpperCase()}
                    value={set.weight}
                    onChange={e => onUpdate(idx, 'weight', e.target.value)}
                    onFocus={e => {
                      if (set.weight_autofill && onFocusWeight) onFocusWeight(idx)
                      else e.target.select()
                    }}
                  />
                  <span className="set-sep">×</span>
                  <input
                    className="set-input"
                    type="number"
                    inputMode="numeric"
                    placeholder="REPS"
                    value={set.reps}
                    onChange={e => onUpdate(idx, 'reps', e.target.value)}
                    onFocus={e => e.target.select()}
                  />
                  {showIntensity && (
                    <input
                      className="set-input intensity-input"
                      type="text"
                      inputMode="decimal"
                      placeholder={intensityField.toUpperCase()}
                      value={set[intensityField] ?? ''}
                      onChange={e => {
                        // Store raw input so trailing decimals ("1." → "1.5")
                        // aren't eaten by parseFloat round-tripping. Strip
                        // anything that isn't a digit / dot / comma.
                        const raw = e.target.value.replace(/[^0-9.,]/g, '')
                        onUpdate(idx, intensityField, raw)
                      }}
                      onBlur={e => {
                        const v = e.target.value
                        if (v === '') return
                        const n = parseFloat(v.replace(',', '.'))
                        if (isNaN(n)) { onUpdate(idx, intensityField, ''); return }
                        const clamped = Math.max(0, Math.min(10, n))
                        if (String(clamped) !== v) onUpdate(idx, intensityField, String(clamped))
                      }}
                      onFocus={e => e.target.select()}
                    />
                  )}
                </div>
                {!isDrop && (
                  <button
                    className={`set-warmup-chip${set.is_warmup ? ' set-warmup-chip--on' : ''}`}
                    onClick={() => onToggleWarmup(idx)}
                    title={set.is_warmup ? 'Warmup — tap to unmark' : 'Mark as warmup'}
                    aria-label="Toggle warmup"
                  >W</button>
                )}
                <button
                  className={`set-tick${set.done ? ' set-tick--done' : ''}`}
                  onClick={() => onConfirm(idx)}
                  title={set.done ? 'Done' : 'Mark set done'}
                >✓</button>
              </div>
              {prev && (prev.weight_kg || prev.reps) && !isDrop && (
                <div className="set-prev">
                  {fmt(displayWeight(prev.weight_kg, unit))}{label} × {fmt(prev.reps)}
                  {prev.is_warmup && <span className="set-prev-warmup"> (warmup)</span>}
                </div>
              )}
              {/* + Drop appears after any ticked non-warmup set so chains are easy. */}
              {set.done && !set.is_warmup && onAddDrop && (
                <button
                  className="add-drop-btn"
                  onClick={() => onAddDrop(idx)}
                  title="Add a drop set"
                >+ Drop</button>
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
function ActivityCard({ item, log, unit, lastLog, onToggle, onUpdate, onRemoveExercise, onComplete, doneAt, saving }) {
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

  const isDone = !!doneAt
  return (
    <div className={`ex-card activity-item-card${isDone ? ' activity-item-card--done' : ''}`}>
      <div className="activity-row-wrap">
        <button className="activity-row" onClick={onToggle} disabled={isDone}>
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
                  type="text"
                  inputMode="decimal"
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
                  type="number"
                  inputMode="numeric"
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
                  type="number"
                  inputMode="numeric"
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
                  type="number"
                  inputMode="numeric"
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
                  type="number"
                  inputMode="numeric"
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
          disabled={isDone}
        />
      )}

      {/* Per-activity completion — saves this activity as its own session. */}
      {onComplete && (
        isDone ? (
          <div className="activity-done-row">
            <span className="activity-done-pill">
              ✓ Completed{doneAt ? ` ${new Date(doneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}
            </span>
          </div>
        ) : (
          <button
            className="activity-complete-btn"
            onClick={onComplete}
            disabled={saving}
          >{saving ? 'Saving…' : `Mark ${item.name} done`}</button>
        )
      )}
    </div>
  )
}

// ── Check-only exercise card ──────────────────────────────────
// Same shape as ExerciseCard but with checkboxes per set instead of
// weight/reps inputs. Used for finishers, bodyweight accessories, or
// anything the user just wants to check off without tracking load.
function CheckCard({ exercise, sets, onToggleCheck, onHistory, onRemoveExercise }) {
  return (
    <div className="ex-card">
      <div className="ex-header">
        <div className="ex-header__left">
          <div className="ex-header__name-row">
            <span className="ex-name">{exercise.name}</span>
          </div>
          {exercise.target && <div className="ex-target">{exercise.target}</div>}
        </div>
        <button className="ex-history-btn" onClick={onHistory} title="View history">↗</button>
        {onRemoveExercise && (
          <button className="ex-remove-btn" onClick={onRemoveExercise} title="Remove from this workout" aria-label="Remove exercise">×</button>
        )}
      </div>

      <div className="check-list">
        {sets.map((set, idx) => (
          <button
            key={idx}
            type="button"
            className={`check-row${set.checked ? ' check-row--done' : ''}`}
            onClick={() => onToggleCheck(idx)}
          >
            <span className="check-num">{idx + 1}</span>
            <span className={`check-box${set.checked ? ' check-box--done' : ''}`}>
              {set.checked && <span className="check-mark">✓</span>}
            </span>
            <span className="check-label">{set.checked ? 'Done' : 'Tap to check'}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
// `block` is the workout_blocks row we're scoping to. If null/undefined
// (legacy callers), we fall back to "all exercises in the day".
export default function WorkoutDay({ day, program, userId, profile, onBack, onHistory, onProgramUpdated, onCompleteHome, block, editingCompletedId = null }) {
  const unit          = profile?.weight_unit    || 'kg'
  const intensityMode = profile?.intensity_mode || 'off'
  const editingMode   = !!editingCompletedId
  const blockId       = block?.id || null
  const blockName     = block?.name || day?.focus || 'Workout'

  const makeEmptySet = () => ({ weight: '', reps: '', done: false, is_warmup: false, rir: '', rpe: '', checked: false, is_drop_set: false })
  // Activity log shape includes display-unit fields for distance/elevation
  // (distance_display, elevation_display) — we convert to canonical km/m at
  // save time so the DB always stores metric.
  const makeEmptyActivity = () => ({
    checked: false, notes: '',
    duration_min: '', distance_display: '', intensity: '',
    avg_hr: '', calories: '', rounds: '', elevation_display: '',
  })

  // Local-storage cache key — scoped per (user, day, block) so multi-workout
  // drafts on the same day don't trample each other.
  const lsKey  = userId ? `wt:draft:${userId}:${day.id}:${blockId || 'default'}` : null
  const cached = lsKey ? readLsDraft(lsKey) : null

  // Filter the day's exercises to JUST this block. Exercises with no block_id
  // (orphans / legacy) only show up if blockId is null.
  const filterToBlock = (xs) => (xs || []).filter(e => {
    if (e.item_type === 'activity') return false
    if (blockId)  return e.workout_block_id === blockId
    return !e.workout_block_id
  })

  const [exerciseList, setExerciseList] = useState(() =>
    Array.isArray(cached?.exerciseList) ? cached.exerciseList : filterToBlock(day.exercises)
  )
  const exerciseItems = exerciseList  // already activity-free
  const activityItems = []  // kept as empty for any leftover references

  const [sets, setSets] = useState(() =>
    cached?.sets && typeof cached.sets === 'object'
      ? cached.sets
      : Object.fromEntries(
          day.exercises.filter(e => e.item_type !== 'activity')
            .map(ex => {
              // Both Track and Check seed from set_count. Track defaults to 2,
              // Check to 1 — both adjustable per-exercise in Edit Day.
              if (ex.track_mode === 'check') {
                const n = Math.max(1, ex.set_count ?? 1)
                return [ex.name, Array.from({ length: n }, () => makeEmptySet())]
              }
              const n = Math.max(1, ex.set_count ?? 2)
              return [ex.name, Array.from({ length: n }, () => makeEmptySet())]
            })
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
  // Per-exercise last sets — keyed by exercise name, sourced from the most
  // recent COMPLETED workout that included that exercise (regardless of day).
  // Falls back to lastSession.sets when an exercise has no global history.
  const [lastByExercise, setLastByExercise] = useState({})
  const [status,      setStatus]      = useState('idle') // idle | saving | saved
  const [errMsg,      setErrMsg]      = useState('')
  const [volumeMsg,   setVolumeMsg]   = useState('')

  // Local completion state for the workout-block (only). Activities now live
  // on DayScreen and complete independently from there.
  const [workoutDoneAt, setWorkoutDoneAt] = useState(null)
  // True when the user has tapped "Edit" on the completed banner — they're
  // editing a workout that was already saved. Save calls updateCompletedSession
  // instead of insertCompletedSession.
  const [editingCompleted, setEditingCompleted] = useState(false)
  // Post-workout summary modal payload. null = hidden.
  const [summary, setSummary] = useState(null)
  // Hydrates from the block's persisted setting (DB default true).
  const [timerEnabled, setTimerEnabled] = useState(() => block?.timer_enabled ?? true)
  const restSeconds = block?.rest_seconds ?? day.rest_seconds ?? 90
  const restTimer = useRestTimer()

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
  const [pickerKind,    setPickerKind]    = useState(null)  // null | 'exercise' | 'activity'
  // Popup shown right after a pick — asks whether to also persist this item
  // to the day's program permanently.  null when not asking.
  const [addToProgramPrompt, setAddToProgramPrompt] = useState(null)  // { picked } | null
  const [knownNames,    setKnownNames]    = useState([])
  const [removeTarget,  setRemoveTarget]  = useState(null)  // { name, alsoProgram }
  const [editDayOpen,   setEditDayOpen]   = useState(false)
  const [menuOpen,      setMenuOpen]      = useState(false)
  const [restPickerOpen, setRestPickerOpen] = useState(false)

  // PR tracking — exerciseBests: historical bests per exercise from DB
  //   { [name]: { bestE1RM, bestWeight, maxRepsAtWeight: {kg->reps} } }
  // prFlags: { [exName]: { setIdx, kind, current, previous, currentWeightKg } }
  //   kind priority: 'weight' > 'reps' > 'e1rm' (rarest/most motivating first)
  const [exerciseBests, setExerciseBests] = useState({})
  const [prFlags,       setPrFlags]       = useState({})

  // Workout duration — set when the user taps "Start workout" or when an
  // existing draft is loaded (started_at from DB). null until then.
  const [workoutStartedAt, setWorkoutStartedAt] = useState(() => cached?.startedAt || null)
  const [durationSecs,     setDurationSecs]     = useState(0)
  const [confirmCancel,    setConfirmCancel]    = useState(false)
  // Locks the workout behind the Start prompt until the user explicitly starts.
  // Skips automatically when a draft is loaded, when the workout's already done,
  // or in edit-completed mode.
  const [needsStart, setNeedsStart] = useState(
    () => !cached?.workoutId && !cached?.startedAt && !editingMode
  )
  // Shown when the user taps Start but a different workout is already active —
  // prevents two workouts from running at once.
  const [activeBlockedBy, setActiveBlockedBy] = useState(null) // { dayName, blockName, dayId, blockId } | null

  // ── Gym tags ────────────────────────────────────────────
  // The user's gyms + the currently active one. Captured at Start time and
  // stamped onto the workout so a mid-workout gym switch doesn't retroactively
  // change history. Updated lazily — defaults to whatever is on profile.
  const [gyms, setGyms]                     = useState([])
  const [activeGymId, setActiveGymId]       = useState(profile?.active_gym_id || null)
  const [gymPickerOpen, setGymPickerOpen]   = useState(false)
  // The gym to stamp on this workout — frozen when the user taps Start so
  // a switch mid-workout doesn't retag the in-progress session.
  const [stampedGymId, setStampedGymId]     = useState(null)
  useEffect(() => {
    if (!userId) return
    getGyms(userId).then(setGyms).catch(() => {})
  }, [userId])
  // Reflect a freshly-loaded profile (initial mount races the gym fetch).
  useEffect(() => {
    if (profile?.active_gym_id !== undefined) setActiveGymId(profile.active_gym_id || null)
  }, [profile?.active_gym_id])
  const activeGym = activeGymId ? gyms.find(g => g.id === activeGymId) : null

  const handlePickGym = async (gymId) => {
    setActiveGymId(gymId)
    if (userId) {
      try { await setActiveGym(gymId, userId) } catch (e) { console.warn('[gym] set active failed', e.message) }
    }
  }
  const handleCreateGym = async (name) => {
    const created = await createGym(name, userId)
    setGyms(prev => [...prev, created])
    setActiveGymId(created.id)
    return created
  }
  const handleRenameGym = async (id, name) => {
    const updated = await updateGym(id, { name }, userId)
    setGyms(prev => prev.map(g => g.id === id ? { ...g, ...updated } : g))
  }
  const handleDeleteGym = async (id) => {
    await deleteGym(id, userId)
    setGyms(prev => prev.filter(g => g.id !== id))
    if (activeGymId === id) setActiveGymId(null)
  }

  // Whether a template already exists for this block — controls the
  // visibility of the "Save as template…" menu item so the user can't keep
  // re-saving the same workout.
  const [templateExistsForBlock, setTemplateExistsForBlock] = useState(false)
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    getTemplates(userId).then(list => {
      if (cancelled) return
      const has = (list || []).some(t =>
        t.day_id === day.id &&
        (t.name || '').trim().toLowerCase() === (blockName || '').trim().toLowerCase()
      )
      setTemplateExistsForBlock(has)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [userId, day.id, blockName])

  useEffect(() => {
    getLastSession(day.id).then(setLastSession).catch(() => {})
  }, [day.id])

  // Tick the duration display every second while a workout is running and
  // not yet completed.
  useEffect(() => {
    if (!workoutStartedAt || workoutDoneAt) return
    const tick = () => {
      const ms = Date.now() - new Date(workoutStartedAt).getTime()
      setDurationSecs(Math.max(0, Math.floor(ms / 1000)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [workoutStartedAt, workoutDoneAt])

  // Resume effect — runs once on mount.
  // If the local cache already populated state with the right workoutId, skip
  // the Supabase fetch entirely — same-tab navigation is fully local.
  // Otherwise check for an in-progress workout on this day:
  //   - started ≤12h ago and user hasn't typed yet: resume silently.
  //   - started >12h ago, OR user already started typing during the fetch:
  //     show prompt so we never clobber unsaved input.
  useEffect(() => {
    if (!userId) return
    if (cached?.workoutId) return  // local cache is the source of truth this session
    let cancelled = false
    ;(async () => {
      try {
        const draft = await getInProgressWorkout(day.id, blockId, userId)
        if (cancelled) return
        if (!draft) {
          setDraftLoaded(true)
          return
        }
        // If the user has typed anything during the round-trip, never silently
        // overwrite — prompt instead. stateRef holds the latest values from the
        // most recent render.
        const live = stateRef.current
        const userTyped =
          Object.values(live.sets || {}).some(arr => arr.some(r =>
            r.weight !== '' || r.reps !== '' || r.is_warmup || r.checked ||
            (r.rir !== '' && r.rir != null) || (r.rpe !== '' && r.rpe != null)
          )) ||
          Object.values(live.activityLogs || {}).some(l =>
            l.checked || l.notes || l.duration_min || l.distance_display ||
            l.intensity || l.avg_hr || l.calories || l.rounds || l.elevation_display
          )
        const ageMs = Date.now() - new Date(draft.started_at).getTime()
        if (userTyped || ageMs > 12 * 3600 * 1000) {
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
  }, [day.id, blockId, userId]) // eslint-disable-line

  function applyDraft(draft) {
    const ds = draft.draft_state || {}
    if (Array.isArray(ds.exerciseList)) setExerciseList(ds.exerciseList)
    if (ds.sets         && typeof ds.sets         === 'object') setSets(ds.sets)
    if (ds.activityLogs && typeof ds.activityLogs === 'object') setActivityLogs(ds.activityLogs)
    setWorkoutId(draft.id)
    setDraftLoaded(true)
    // Resuming an in-progress workout: skip the Start prompt and adopt the
    // draft's started_at so the duration counter shows the real elapsed time.
    if (draft.started_at) {
      setWorkoutStartedAt(draft.started_at)
      // Adopt as the active workout so the floating pill picks it up.
      startActiveWorkout({
        dayId: day.id, blockId, dayName: day.name, blockName,
        startedAt: draft.started_at,
      })
    }
    // Adopt the draft's original gym. Without this, completing a resumed
    // workout would re-stamp it with whatever gym is active *now* — possibly
    // overwriting the gym the user actually trained at when they started.
    if (draft.gym_id !== undefined) setStampedGymId(draft.gym_id || null)
    setNeedsStart(false)
  }

  // If the workout is already completed (edit mode, or done state hydrated
  // elsewhere), there's nothing to "start" — drop the prompt.
  useEffect(() => {
    if (editingMode || workoutDoneAt) setNeedsStart(false)
  }, [editingMode, workoutDoneAt])

  // Once the resume effect finishes with no draft, the user is on a fresh
  // workout — leave the Start prompt in place. Nothing to do here.

  // Load historical PR stats — refetch when the live exercise list changes
  // so mid-workout additions also get PR detection.
  const exerciseNamesKey = exerciseItems.map(e => e.name).join('||')
  useEffect(() => {
    const names = exerciseItems.map(e => e.name)
    if (!names.length || !userId) return
    getExerciseBests(names, userId).then(setExerciseBests).catch(() => {})
  }, [exerciseNamesKey, userId]) // eslint-disable-line

  // Per-exercise last sets — refetch when the live exercise list changes so
  // mid-workout adds also surface their previous-session data immediately.
  // This is global (across days) — the same exercise on a different day still
  // shows its last logged sets.
  useEffect(() => {
    if (!userId) return
    const names = exerciseItems.map(e => e.name)
    if (names.length === 0) { setLastByExercise({}); return }
    let cancelled = false
    getLastSetsByExercise(names, userId)
      .then(map => { if (!cancelled) setLastByExercise(map || {}) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [exerciseNamesKey, userId]) // eslint-disable-line

  // Recompute PR flags whenever sets change.
  // Checks each non-warmup set against three record types in priority order:
  //   weight PR (heaviest ever) > rep PR (most reps at this weight) > e1RM PR
  // Only the highest-priority hit on the best-qualifying set is surfaced.
  // Debounced so rapid typing in weight/reps inputs doesn't trigger a full
  // recompute on every keystroke — the flag is only meaningful once a value
  // has settled anyway.
  useEffect(() => {
    const id = setTimeout(() => {
    const newFlags = {}
    for (const [exName, exSets] of Object.entries(sets)) {
      const bests = exerciseBests[exName] || { bestE1RM: 0, bestWeight: 0, maxRepsAtWeight: {} }
      let winner = null  // { setIdx, kind, priority, score, previous, currentWeightKg }
      exSets.forEach((set, idx) => {
        if (set.is_warmup || set.is_drop_set) return
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
    }, 200)
    return () => clearTimeout(id)
  }, [sets, exerciseBests, unit])

  // ── Reconcile prescription edits from EditDayModal into the live session ──
  // When the user opens Edit Day mid-workout and saves, the parent re-fetches
  // and `day.exercises` updates. We diff against the last-synced prescription
  // so that:
  //   - exercises added via Edit Day appear at the bottom with empty sets
  //   - exercises removed via Edit Day drop out of the live list
  //   - exercises with property changes (target, track_mode, superset_group,
  //     has_drop_sets) pick those up — the spread { ...e, ...incoming } means
  //     fresh DB values win on every overlapping key.
  //   - set_count grows/shrinks the actual sets array. Grow appends empty
  //     rows; shrink trims trailing rows that are empty AND not warmup/drop
  //     and not yet done — never silently deletes logged data.
  // Picker-added exercises during the session aren't in the lastSynced ref,
  // so they're left alone by reconciliation.
  const lastSyncedRef = useRef(null)
  useEffect(() => {
    const incoming = filterToBlock(day.exercises)
    if (lastSyncedRef.current === null) {
      lastSyncedRef.current = incoming
      return
    }
    const lastSynced       = lastSyncedRef.current
    const lastSyncedNames  = new Set(lastSynced.map(e => e.name))
    const incomingNames    = new Set(incoming.map(e => e.name))
    const adds             = incoming.filter(e => !lastSyncedNames.has(e.name))
    const removeNames      = new Set(lastSynced.filter(e => !incomingNames.has(e.name)).map(e => e.name))
    const incomingByName   = Object.fromEntries(incoming.map(e => [e.name, e]))
    const lastSyncedByName = Object.fromEntries(lastSynced.map(e => [e.name, e]))
    lastSyncedRef.current  = incoming

    // 1) exerciseList: drop removed, merge fresh DB props over matching items,
    //    append new ones at the end. Single pass — no early return so every
    //    property edit is applied even when the diff is property-only.
    setExerciseList(prev => {
      const filtered = prev
        .filter(e => !removeNames.has(e.name))
        .map(e => incomingByName[e.name] ? { ...e, ...incomingByName[e.name] } : e)
      const filteredNames = new Set(filtered.map(e => e.name))
      const newOnes = adds.filter(a => !filteredNames.has(a.name))
      return [...filtered, ...newOnes]
    })

    // 2) sets state: handle adds, removes, and set_count grow/shrink.
    setSets(prev => {
      const next = { ...prev }
      // Adds: seed empty rows from set_count.
      for (const ex of adds) {
        if (next[ex.name]) continue
        const fallback = ex.track_mode === 'check' ? 1 : 2
        const n = Math.max(1, ex.set_count ?? fallback)
        next[ex.name] = Array.from({ length: n }, () => makeEmptySet())
      }
      // Removes: drop the row entirely.
      for (const name of removeNames) delete next[name]
      // Set count changed: grow appends, shrink trims trailing empties.
      // Working sets are counted by row position; warmups and drops are
      // mid-workout-only and not part of set_count, so we don't touch them.
      for (const ex of incoming) {
        const before = lastSyncedByName[ex.name]
        if (!before) continue
        const beforeCount = before.set_count
        const afterCount  = ex.set_count
        if (beforeCount === afterCount || afterCount == null) continue
        const current = next[ex.name] || []
        if (afterCount > current.length) {
          const extra = afterCount - current.length
          next[ex.name] = [
            ...current,
            ...Array.from({ length: extra }, () => makeEmptySet()),
          ]
        } else if (afterCount < current.length) {
          const arr = [...current]
          while (arr.length > afterCount) {
            const last = arr[arr.length - 1]
            const isEmpty = !last.weight && !last.reps && !last.checked && !last.done
              && !last.is_warmup && !last.is_drop_set
            if (!isEmpty) break
            arr.pop()
          }
          next[ex.name] = arr
        }
      }
      return next
    })
  }, [day.exercises]) // eslint-disable-line

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
        r.weight !== '' || r.reps !== '' || r.is_warmup || r.checked ||
        (r.rir !== '' && r.rir != null) || (r.rpe !== '' && r.rpe != null)
    ))) return true
    if (Object.values(a).some(l =>
        l.checked || l.notes || l.duration_min || l.distance_display ||
        l.intensity || l.avg_hr || l.calories || l.rounds || l.elevation_display
    )) return true
    // Exercise list mutated relative to this block's program slice.
    const blockProgram = filterToBlock(day.exercises)
    if (el.length !== blockProgram.length) return true
    for (let i = 0; i < el.length; i++) {
      if (el[i]?.name !== blockProgram[i]?.name) return true
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
      const dayLabel = `${day.name}${blockName && blockName !== 'Workout' ? ` — ${blockName}` : ''}`
      const result = await upsertDraft({
        workoutId:      workoutIdRef.current,
        trainingDayId:  day.id,
        workoutBlockId: blockId,
        dayLabel,
        // Stamp the gym at draft-creation time. A new draft uses the gym that
        // was frozen at Start (or the current active one for autosaves that
        // race ahead of Start). Existing drafts ignore this field — gym is
        // pinned at creation, never overwritten by later autosaves.
        gymId:          stampedGymId ?? activeGymId,
        draftState:     { sets: s, activityLogs: a, exerciseList: el },
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

  // Local mirror — writes on a short debounce so rapid typing doesn't trigger
  // a JSON.stringify of the full state on every keystroke. Same-tab navigation
  // (e.g. into ExerciseHistory and back) still restores instantly because the
  // value is well under one keystroke window away.
  useEffect(() => {
    if (!lsKey) return
    const hasContent = stateHasContent(sets, activityLogs, exerciseList)
    if (!hasContent && !workoutStartedAt) {
      clearLsDraft(lsKey)
      return
    }
    const id = setTimeout(() => {
      writeLsDraft(lsKey, { sets, activityLogs, exerciseList, workoutId, startedAt: workoutStartedAt })
    }, 250)
    return () => clearTimeout(id)
  }, [lsKey, sets, activityLogs, exerciseList, workoutId, workoutStartedAt]) // eslint-disable-line

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
  // Manual edits clear the autofill flag so the value stays put on focus.
  const updateSet = (exName, idx, field, value) => {
    setSets(prev => ({
      ...prev,
      [exName]: prev[exName].map((s, i) => {
        if (i !== idx) return s
        const next = { ...s, [field]: value }
        if (field === 'weight') next.weight_autofill = false
        return next
      }),
    }))
  }

  // Tapping a weight input that holds an auto-filled value clears it so the
  // user can type fresh. Manually entered values stay put.
  const focusWeightInput = (exName, idx) => {
    setSets(prev => {
      const current = prev[exName] || []
      const set = current[idx]
      if (!set || !set.weight_autofill) return prev
      return {
        ...prev,
        [exName]: current.map((s, i) =>
          i === idx ? { ...s, weight: '', weight_autofill: false } : s
        ),
      }
    })
  }

  const confirmSet = (exName, idx) => {
    setSets(prev => {
      const current = prev[exName] || []
      const wasDone = !!current[idx]?.done
      let updated = current.map((s, i) => i === idx ? { ...s, done: !s.done } : s)
      // When a working set is just ticked done with a weight, copy that weight
      // forward to the next still-empty working set so the user doesn't have
      // to retype the same number between sets.
      const justDone = !wasDone
      const setNow = updated[idx]
      if (justDone && setNow && !setNow.is_warmup && !setNow.is_drop_set
          && setNow.weight !== '' && setNow.weight != null) {
        for (let j = idx + 1; j < updated.length; j++) {
          const cand = updated[j]
          if (!cand || cand.is_warmup || cand.is_drop_set) continue
          if (cand.weight === '' || cand.weight == null) {
            updated = updated.map((s, k) =>
              k === j ? { ...s, weight: setNow.weight, weight_autofill: true } : s
            )
            break
          }
        }
      }
      return { ...prev, [exName]: updated }
    })
    // Only start the rest timer when ticking ON, not when un-ticking.
    const wasDone = !!sets[exName]?.[idx]?.done
    if (!wasDone && timerEnabled) restTimer.start(restSeconds, day.id, blockId)
  }

  const addSet = (exName) => {
    setSets(prev => {
      const current = prev[exName] || []
      // Inherit weight from the last working set that has one — so adding a
      // 4th set after three @ 60kg pre-fills 60. Marked autofill so a tap
      // clears it for fresh typing.
      let inherited = ''
      for (let i = current.length - 1; i >= 0; i--) {
        const s = current[i]
        if (!s || s.is_warmup || s.is_drop_set) continue
        if (s.weight !== '' && s.weight != null) { inherited = s.weight; break }
      }
      const fresh = makeEmptySet()
      if (inherited !== '') {
        fresh.weight = inherited
        fresh.weight_autofill = true
      }
      return { ...prev, [exName]: [...current, fresh] }
    })
  }

  const toggleWarmup = (exName, idx) =>
    setSets(prev => ({
      ...prev,
      [exName]: prev[exName].map((s, i) => i === idx ? { ...s, is_warmup: !s.is_warmup } : s),
    }))

  // Insert a drop set immediately after `parentIdx`, pre-filled with the parent's
  // weight (you "drop" from there) and empty reps. Drops chain — adding a drop
  // after a drop is allowed and useful for triple-drops.
  const addDropSet = (exName, parentIdx) => {
    setSets(prev => {
      const arr = prev[exName] || []
      const parent = arr[parentIdx]
      const drop = {
        ...makeEmptySet(),
        is_drop_set: true,
        weight: parent?.weight ?? '',
      }
      const next = [...arr.slice(0, parentIdx + 1), drop, ...arr.slice(parentIdx + 1)]
      return { ...prev, [exName]: next }
    })
  }

  // Check-mode toggle — flip `checked` and start the rest timer if enabled.
  const toggleCheck = (exName, idx) => {
    setSets(prev => {
      const current = prev[exName] || []
      const updated = current.map((s, i) => i === idx ? { ...s, checked: !s.checked } : s)
      return { ...prev, [exName]: updated }
    })
    const wasChecked = !!sets[exName]?.[idx]?.checked
    if (!wasChecked && timerEnabled) restTimer.start(restSeconds, day.id, blockId)
  }

  const getLastSets = (exName) => {
    // Prefer the global per-exercise history so the "Last time" hint and the
    // per-row preview reflect what the user did with this exercise most
    // recently — even if it was on a different training day or a different
    // workout block.
    const global = lastByExercise[exName]
    if (global && Array.isArray(global.sets) && global.sets.length > 0) {
      return global.sets
    }
    if (!lastSession) return []
    return lastSession.sets.filter(s => s.exercise_name === exName)
  }

  // Pre-fill empty sets with values from the most recent session of this
  // exercise. Already-typed sets are left untouched so a partial entry isn't
  // wiped. RIR/RPE are session-specific feelings and intentionally not copied.
  const copyLastSets = (exName) => {
    const last = getLastSets(exName)
    if (!last.length) return
    setSets(prev => {
      const current = prev[exName] || []
      const next = current.map((s, i) => {
        const src = last[i]
        if (!src) return s
        const isEmpty = s.weight === '' && s.reps === ''
        if (!isEmpty) return s
        return {
          ...s,
          weight:    kgToInputValue(src.weight_kg, unit),
          reps:      src.reps ? String(src.reps) : '',
          is_warmup: !!src.is_warmup,
        }
      })
      return { ...prev, [exName]: next }
    })
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
  // Open the categorized picker for either exercise or activity. Pre-fetch
  // the user's known names so the "Your X" group renders.
  const openAddPicker = async (kind) => {
    setPickerKind(kind)
    if (knownNames.length === 0 && userId) {
      try {
        const names = await getAllKnownExerciseNames(userId)
        setKnownNames(names)
      } catch { /* non-fatal */ }
    }
  }

  // Called when the user picks (or creates) an item in the catalog modal.
  // The item is always added to today's session immediately. Then we ask the
  // user (via a popup) whether to also persist it to the day's program — that
  // way the toggle never silently changes their long-term plan.
  const handlePickItem = (name) => {
    const trimmed = (name || '').trim()
    if (!trimmed) return
    if (exerciseList.some(e => e.name.toLowerCase() === trimmed.toLowerCase())) {
      setErrMsg(`"${trimmed}" is already in this workout.`)
      return
    }
    const isActivity = pickerKind === 'activity'
    const picked = isActivity
      ? { name: trimmed, target: '', item_type: 'activity', activity_fields: null }
      : { name: trimmed, target: '', item_type: 'exercise', track_mode: 'sets', set_count: 2, workout_block_id: blockId }
    setExerciseList(prev => [...prev, picked])
    if (isActivity) {
      setActivityLogs(prev => ({ ...prev, [trimmed]: makeEmptyActivity() }))
    } else {
      setSets(prev => ({ ...prev, [trimmed]: [makeEmptySet(), makeEmptySet()] }))
    }
    flushDraft()
    // Ask once, scoped to this add. If the user says no it's gone.
    setAddToProgramPrompt({ picked })
  }

  const confirmAddToProgram = async () => {
    const picked = addToProgramPrompt?.picked
    setAddToProgramPrompt(null)
    if (!picked) return
    try {
      await addExerciseToProgram(day.id, picked, userId)
      onProgramUpdated && onProgramUpdated()
    } catch (e) {
      setErrMsg(`Couldn't add to program: ${e.message}`)
    }
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
    Object.values(sets).some(s => s.some(r => r.weight !== '' || r.reps !== '' || r.checked)) ||
    Object.values(activityLogs).some(l =>
      l.checked || l.duration_min || l.distance_display || l.intensity ||
      l.avg_hr || l.calories || l.rounds || l.elevation_display || l.notes
    )

  // Build a save-shaped payload of the exercise sets (canonicalized to kg).
  const buildSetsForSave = () => Object.fromEntries(
    Object.entries(sets).map(([name, arr]) => [
      name,
      arr.map(s => ({
        weight_kg:   parseInputWeight(s.weight, unit),
        reps:        s.reps,
        is_warmup:   !!s.is_warmup,
        is_drop_set: !!s.is_drop_set,
        rir:         s.rir,
        rpe:         s.rpe,
        checked:     !!s.checked,
      })),
    ])
  )
  const buildTrackModeMap = () => Object.fromEntries(
    exerciseList
      .filter(e => e.item_type !== 'activity')
      .map(e => [e.name, e.track_mode === 'check' ? 'check' : 'sets'])
  )
  // Canonicalize a single activity log to the DB shape (km / m).
  const canonicalizeActivityLog = (log) => {
    const distKm = log.distance_display === '' || log.distance_display == null
      ? null
      : parseInputDistance(log.distance_display, unit)
    const elevM = log.elevation_display === '' || log.elevation_display == null
      ? null
      : parseInputElevation(log.elevation_display, unit)
    return {
      checked:      log.checked,
      notes:        log.notes,
      duration_min: log.duration_min,
      distance_km:  isNaN(distKm) ? null : distKm,
      intensity:    log.intensity,
      avg_hr:       log.avg_hr,
      calories:     log.calories,
      rounds:       log.rounds,
      elevation_m:  isNaN(elevM) ? null : elevM,
    }
  }

  // Complete the gym block (kind='workout') only — does not touch activities.
  const handleCompleteWorkout = async () => {
    const hasExerciseData = Object.values(sets).some(s => s.some(r => r.weight !== '' || r.reps !== '' || r.checked))
    if (!hasExerciseData) {
      setErrMsg('Log at least one set first.')
      return
    }
    setStatus('saving')
    setErrMsg('')
    try {
      const setsForSave = buildSetsForSave()
      const trackModeMap = buildTrackModeMap()
      const dayLabel = `${day.name}${blockName && blockName !== 'Workout' ? ` — ${blockName}` : ''}`

      const workout = await insertCompletedSession({
        trainingDayId:  day.id,
        dayLabel,
        kind:           'workout',
        workoutBlockId: blockId,
        // Prefer the gym frozen at Start time. Fall back to the current
        // active gym for paths that skipped Start (resumed drafts, edits).
        gymId:          stampedGymId ?? activeGymId,
        exerciseSets:   setsForSave,
        trackModeMap,
      }, userId)

      const currentVolKg = calcSessionVolume(sets, unit)
      let msg = ''
      try {
        const prev = await getPreviousSessionVolume(day.id, workout.id)
        msg = buildVolumeMsg(currentVolKg, prev) || ''
      } catch { /* non-fatal */ }
      setVolumeMsg(msg)
      setWorkoutDoneAt(workout.completed_at || new Date().toISOString())
      setStatus('saved')

      // Build the summary payload for the celebration modal. Counts non-warmup,
      // non-drop sets that have valid weight × reps (matching the volume calc).
      let totalReps = 0
      let totalSets = 0
      for (const arr of Object.values(sets)) {
        for (const s of arr) {
          if (s.is_warmup || s.is_drop_set) continue
          const w = parseInputWeight(s.weight, unit)
          const r = parseInt(s.reps)
          if (isNaN(w) || isNaN(r) || w <= 0 || r <= 0) continue
          totalSets += 1
          totalReps += r
        }
      }
      const prsList = Object.entries(prFlags).map(([name, info]) => ({
        exerciseName: name,
        ...info,
      }))
      setSummary({
        totalVolKg: currentVolKg,
        totalReps,
        totalSets,
        prs:        prsList,
        volumeMsg:  msg,
      })

      // Workout is done — tear down the draft so we don't resume into an
      // already-saved session.
      clearLsDraft(lsKey)
      if (workoutIdRef.current) {
        try { await discardDraft(workoutIdRef.current, userId) } catch {}
      }
      // Release the global "active workout" lock so other workouts can start.
      const existing = getActiveWorkout()
      if (existing.active && existing.dayId === day.id && existing.blockId === blockId) {
        clearActiveWorkout()
      }
    } catch (e) {
      setErrMsg(e.message || 'Failed to save — please try again.')
      setStatus('idle')
    }
  }


  // Save edits to a previously-completed workout. Wipes the existing
  // workout_sets rows for this workout id and inserts the new ones.
  const handleSaveEdit = async () => {
    const targetId = workoutIdRef.current || workoutId
    if (!targetId) {
      setErrMsg('No workout to update.')
      return
    }
    setStatus('saving')
    setErrMsg('')
    try {
      const setsForSave = buildSetsForSave()
      const trackModeMap = buildTrackModeMap()
      await updateCompletedSession(targetId, setsForSave, {}, userId, trackModeMap)
      setEditingCompleted(false)
      // Re-surface the completed banner so the user has a clear "saved" cue.
      setWorkoutDoneAt(new Date().toISOString())
      setStatus('saved')
    } catch (e) {
      setErrMsg(e.message || 'Save failed — please try again.')
      setStatus('idle')
    }
  }

  const handleArchiveTrigger = () => {
    setArchiveName(blockName && blockName !== 'Workout' ? blockName : day.name)
    setArchiveStep('naming')
  }

  const handleArchiveSave = async () => {
    if (!archiveName.trim()) { setArchiveError('Enter a name'); return }
    setArchiveStep('saving')
    setArchiveError('')
    try {
      await saveTemplate(archiveName, day.id, exerciseList, userId)
      setArchiveStep('done')
      // Hide the menu entry so the user can't rapid-tap and stack duplicates.
      setTemplateExistsForBlock(true)
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
  // Today's date — shown in small grey letters next to the workout name in
  // the header, so the user can see at a glance what date this session is.
  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
  // Headline title in the workout header. Prefer the block name (e.g. "Push")
  // when meaningful; fall back to the day name + focus.
  const headlineTitle = (blockName && blockName !== 'Workout')
    ? blockName
    : (day.focus?.trim() || day.name)


  return (
    <div className="screen">
      <div className="workout-sticky-top">
        <header className="workout-header">
          <button className="back-btn" onClick={onBack}>←</button>
          <div className="workout-header__info">
            <div className="workout-header__name workout-header__name--accent">
              {headlineTitle}
            </div>
            <div className="workout-header__date">{todayLabel}</div>
          </div>
          <div className="workout-header-menu-wrap">
            <button
              className="workout-gear-btn"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Day options"
              title="Options"
            >⚙</button>
            {menuOpen && (
              <>
                <div className="workout-menu-scrim" onClick={() => setMenuOpen(false)} />
                <div className="workout-menu">
                  <button className="workout-menu-item" onClick={() => { setMenuOpen(false); setEditDayOpen(true) }}>
                    Edit day…
                  </button>
                  {!templateExistsForBlock && (
                    <button className="workout-menu-item" onClick={() => { setMenuOpen(false); handleArchiveTrigger() }}>
                      Save as template…
                    </button>
                  )}
                  <button
                    className="workout-menu-item"
                    onClick={() => {
                      const next = !timerEnabled
                      setTimerEnabled(next)
                      if (!next) restTimer.stop()
                      setMenuOpen(false)
                      if (blockId) {
                        updateWorkoutBlock(blockId, { timer_enabled: next }, userId)
                          .then(() => onProgramUpdated && onProgramUpdated())
                          .catch(() => {})
                      }
                    }}
                  >
                    {timerEnabled ? 'Disable rest timer' : 'Enable rest timer'}
                  </button>
                  {workoutStartedAt && !workoutDoneAt && (
                    <button
                      className="workout-menu-item workout-menu-item--danger"
                      onClick={() => { setMenuOpen(false); setConfirmCancel(true) }}
                    >
                      Cancel workout…
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </header>

        {/* Rest preset picker — tap to open a sheet of values. */}
        <div className="workout-controls-row">
          <button
            type="button"
            className="rest-picker-trigger"
            onClick={() => setRestPickerOpen(true)}
            title="Change rest duration"
          >
            <span className="rest-picker-trigger-label">Rest</span>
            <span className="rest-picker-trigger-val">{formatRestShort(restSeconds)}</span>
            <span className="rest-picker-trigger-chev">▾</span>
          </button>
          <span className={`rest-timer-flag${timerEnabled ? '' : ' rest-timer-flag--off'}`}>
            {timerEnabled ? 'Timer on' : 'Timer off'}
          </span>
          {workoutStartedAt && (
            <span className="workout-duration-pill" title="Workout duration">
              ⏱ {formatDuration(durationSecs)}
            </span>
          )}
        </div>

        {restTimer.active && (
          <RestTimer
            onDismiss={restTimer.stop}
            onReset={restTimer.reset}
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

        {/* Render items, grouping by superset_group when present.
            Activity / check-mode items never participate in supersets. */}
        {(() => {
          const renderItem = (item) => {
            if (item.track_mode === 'check') {
              const n = Math.max(1, item.set_count ?? 1)
              const exSets = sets[item.name] || Array.from({ length: n }, () => makeEmptySet())
              return (
                <CheckCard
                  key={item.name}
                  exercise={item}
                  sets={exSets}
                  onToggleCheck={idx => toggleCheck(item.name, idx)}
                  onHistory={() => onHistory(item.name)}
                />
              )
            }
            const initialN = Math.max(1, item.set_count ?? 2)
            return (
              <ExerciseCard
                key={item.name}
                exercise={item}
                sets={sets[item.name] || Array.from({ length: initialN }, () => makeEmptySet())}
                lastSets={getLastSets(item.name)}
                prInfo={prFlags[item.name]}
                unit={unit}
                intensityMode={intensityMode}
                onUpdate={(idx, field, val) => updateSet(item.name, idx, field, val)}
                onConfirm={idx => confirmSet(item.name, idx)}
                onAdd={() => addSet(item.name)}
                onHistory={() => onHistory(item.name)}
                onToggleWarmup={idx => toggleWarmup(item.name, idx)}
                onCopyLast={() => copyLastSets(item.name)}
                onFocusWeight={idx => focusWeightInput(item.name, idx)}
                onAddDrop={item.has_drop_sets ? (idx) => addDropSet(item.name, idx) : undefined}
              />
            )
          }
          // Bundle same-group exercises into one wrapper card.
          // Group is positioned at the first occurrence in exerciseList.
          const seen = new Set()
          const out = []
          for (const item of exerciseList) {
            const g = item.item_type === 'exercise' ? item.superset_group : null
            if (g && !seen.has(g)) {
              seen.add(g)
              const members = exerciseList.filter(e => e.item_type === 'exercise' && e.superset_group === g)
              out.push(
                <div key={`superset-${g}`} className="superset-card">
                  <div className="superset-header">Superset {g} · alternate</div>
                  <div className="superset-body">
                    {members.map(m => renderItem(m))}
                  </div>
                </div>
              )
            } else if (!g) {
              out.push(renderItem(item))
            }
          }
          return out
        })()}

        {errMsg && <p className="err-msg">{errMsg}</p>}

        {/* Prominent "Save as template" CTA — promoted out of the gear menu
            so users actually discover it. Only shown when:
              - there's at least one exercise to save
              - we're not currently editing a previously-completed workout
              - a template for this block doesn't already exist
              - the user hasn't already opened the naming form
            Tapping opens the same naming form the menu item used. */}
        {exerciseItems.length > 0 && !editingCompleted && !templateExistsForBlock && archiveStep !== 'naming' && (
          <button
            type="button"
            className="save-template-cta"
            onClick={handleArchiveTrigger}
            title="Save this workout's structure as a reusable template"
          >
            <span className="save-template-cta__icon" aria-hidden="true">⭐</span>
            <span className="save-template-cta__text">Save as template</span>
            <span className="save-template-cta__hint">Reuse the structure on any day</span>
          </button>
        )}

        {/* Bottom button only completes the gym block. Activities each have
            their own Mark-done button. Hidden once the workout is done.
            In edit-completed mode, label changes and the handler routes to
            updateCompletedSession instead of insertCompletedSession. */}
        {exerciseItems.length > 0 && !workoutDoneAt && (
          <button
            className={`complete-btn ${status === 'saved' ? 'complete-btn--saved' : ''}`}
            onClick={editingCompleted ? handleSaveEdit : handleCompleteWorkout}
            disabled={status === 'saving'}
          >
            {status === 'saving'
              ? 'Saving…'
              : editingCompleted
                ? 'Save changes'
                : 'Complete Workout'}
          </button>
        )}

        {/* Tap "Edit" on the banner to fix a logging mistake — the cards
            re-open with the saved values still there, and Save updates the
            existing workout in place. */}
        {workoutDoneAt && (
          <div className="workout-done-banner">
            <span className="workout-done-banner__text">
              ✓ Workout completed {new Date(workoutDoneAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
            <button
              type="button"
              className="workout-done-banner__edit"
              onClick={() => {
                setEditingCompleted(true)
                setWorkoutDoneAt(null)
                setStatus('idle')
                setErrMsg('')
              }}
            >Edit</button>
          </div>
        )}

        {volumeMsg && (
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

      {/* ── Start workout prompt ──────────────────────────────
          Shown once per session before the user logs anything. Skipped when
          a draft is loaded (resumed) or when the workout is already done. */}
      {needsStart && draftLoaded && !workoutDoneAt && !editingMode && (() => {
        const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' })
        const isToday = day.name && day.name.toLowerCase() === todayName.toLowerCase()
        const dayLabel = isToday ? "today's" : `${day.name}'s`
        const isGenericBlock = !blockName || blockName.trim().toLowerCase() === 'workout'
        const title = isGenericBlock
          ? `Start ${dayLabel} workout`
          : `Start ${dayLabel} ${blockName}`
        return (
          <div className="modal-backdrop">
            <div className="modal-card">
              <h3 className="modal-title">{title}</h3>
              <p className="modal-body">
                Tap Start to begin — we'll track the workout duration until you complete it.
              </p>
              {/* Gym chip — non-blocking. Tap to switch / add a gym. The
                  selection auto-stamps onto every future workout until
                  changed. Activities don't get a gym tag. */}
              <div className="start-modal-gym">
                <button
                  type="button"
                  className={`gym-chip${activeGym ? '' : ' gym-chip--placeholder'}`}
                  onClick={() => setGymPickerOpen(true)}
                  title="Set workout location"
                >
                  <span className="gym-chip__dot" style={{ background: activeGym?.color || '#52525b' }} />
                  <span className="gym-chip__name">
                    {activeGym ? activeGym.name : '+ Set gym'}
                  </span>
                  <span className="gym-chip__chev">▾</span>
                </button>
              </div>
              <div className="modal-actions modal-actions--stack">
                <button
                  className="modal-btn-primary"
                  onClick={() => {
                    // Block a second concurrent workout. If another workout is
                    // active and it's not this one, surface the conflict modal
                    // and let the user navigate to it (or cancel it) first.
                    const existing = getActiveWorkout()
                    if (existing.active &&
                        (existing.dayId !== day.id || existing.blockId !== blockId)) {
                      setActiveBlockedBy(existing)
                      return
                    }
                    const startedAt = new Date().toISOString()
                    setWorkoutStartedAt(startedAt)
                    setNeedsStart(false)
                    // Freeze the gym at Start time so swapping gyms mid-workout
                    // doesn't retag the session.
                    setStampedGymId(activeGymId)
                    startActiveWorkout({
                      dayId: day.id, blockId, dayName: day.name, blockName,
                      startedAt,
                    })
                  }}
                >Start</button>
                <button
                  className="modal-btn-cancel"
                  onClick={() => { setEditDayOpen(true) }}
                >Edit workout</button>
                <button
                  className="modal-btn-cancel"
                  onClick={onBack}
                >Back</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Already-active-workout block ─────────────────────
          Triggered when the user taps Start while a different workout is
          already in progress. Lets them jump to the active one (it's the
          floating pill's normal target) or back out. */}
      {activeBlockedBy && (
        <div className="modal-backdrop" onClick={() => setActiveBlockedBy(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">A workout is already running</h3>
            <p className="modal-body">
              You have <strong>{activeBlockedBy.blockName && activeBlockedBy.blockName !== 'Workout' ? activeBlockedBy.blockName : (activeBlockedBy.dayName || 'a workout')}</strong> in
              progress. Finish or cancel it before starting another.
            </p>
            <div className="modal-actions">
              <button
                className="modal-btn-primary"
                onClick={() => {
                  const dest = activeBlockedBy
                  setActiveBlockedBy(null)
                  // Hand off to the parent's floating-timer tap path, which
                  // navigates back to the active workout's screen.
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('wt:goto-active-workout', {
                      detail: { dayId: dest.dayId, blockId: dest.blockId },
                    }))
                  }
                }}
              >Go to active workout</button>
              <button className="modal-btn-cancel" onClick={() => setActiveBlockedBy(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cancel workout confirmation ─────────────────────── */}
      {confirmCancel && (
        <div className="modal-backdrop" onClick={() => setConfirmCancel(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Cancel workout?</h3>
            <p className="modal-body">
              Anything you've logged in this session will be discarded. This can't be undone.
            </p>
            <div className="modal-actions">
              <button
                className="modal-btn-danger"
                onClick={async () => {
                  setConfirmCancel(false)
                  clearLsDraft(lsKey)
                  if (workoutIdRef.current) {
                    try { await discardDraft(workoutIdRef.current, userId) } catch {}
                  }
                  setWorkoutStartedAt(null)
                  // Release the active-workout lock if this is the active one.
                  const existing = getActiveWorkout()
                  if (existing.active && existing.dayId === day.id && existing.blockId === blockId) {
                    clearActiveWorkout()
                  }
                  onBack()
                }}
              >Cancel workout</button>
              <button className="modal-btn-cancel" onClick={() => setConfirmCancel(false)}>
                Keep going
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Categorized picker — same modal pattern as Edit Day */}
      {pickerKind && (
        <CatalogPickerModal
          open
          onClose={() => setPickerKind(null)}
          onPick={handlePickItem}
          catalog={pickerKind === 'activity' ? ACTIVITY_CATALOG : EXERCISE_CATALOG}
          userKnownNames={knownNames}
          existingNames={exerciseList.map(e => e.name)}
          title={pickerKind === 'activity' ? 'Add activity' : 'Add exercise'}
          createLabel={pickerKind === 'activity' ? '+ Create your own activity' : '+ Create your own exercise'}
          createPlaceholder={pickerKind === 'activity' ? 'Activity name' : 'Exercise name'}
          yourGroupLabel={pickerKind === 'activity' ? 'Your activities' : 'Your exercises'}
          onDeleteCustom={async (name) => {
            await deleteCustomItem(name, userId)
            setKnownNames(prev => prev.filter(n => n.toLowerCase() !== name.toLowerCase()))
            // If the deleted name is currently in the workout, drop it.
            setExerciseList(prev => prev.filter(e => e.name !== name))
          }}
        />
      )}

      {/* Per-day editor for the active workout */}
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

      <GymPickerSheet
        open={gymPickerOpen}
        gyms={gyms}
        activeGymId={activeGymId}
        onClose={() => setGymPickerOpen(false)}
        onPick={handlePickGym}
        onCreate={handleCreateGym}
        onRename={handleRenameGym}
        onDelete={handleDeleteGym}
      />

      <RestPickerSheet
        open={restPickerOpen}
        value={restSeconds}
        onClose={() => setRestPickerOpen(false)}
        onPick={(seconds) => {
          // Write to the block when we have one; fall back to the day for
          // legacy/orphan paths so the picker still does something useful.
          const writer = blockId
            ? updateWorkoutBlock(blockId, { rest_seconds: seconds }, userId)
            : updateDayMeta(day.id, { rest_seconds: seconds }, userId)
          writer
            .then(() => onProgramUpdated && onProgramUpdated())
            .catch(e => setErrMsg(e.message))
        }}
      />

      {/* ── Add-to-program prompt ────────────────────────── */}
      {addToProgramPrompt && (
        <div className="modal-backdrop" onClick={() => setAddToProgramPrompt(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Add to {day.name}'s plan?</h3>
            <p className="modal-body">
              <strong>{addToProgramPrompt.picked.name}</strong> is in today's session.
              Do you also want to add it to {day.name}'s program permanently, so it shows up every {day.name}?
            </p>
            <div className="modal-actions">
              <button className="modal-btn-primary" onClick={confirmAddToProgram}>
                Yes, add to {day.name}
              </button>
              <button className="modal-btn-cancel" onClick={() => setAddToProgramPrompt(null)}>
                Today only
              </button>
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

      {/* ── Post-workout summary ───────────────────────────
          Edit dismisses the summary and re-enters edit-completed mode so
          the user can fix a mistake before leaving. */}
      <WorkoutSummary
        summary={summary}
        unit={unit}
        onClose={() => {
          setSummary(null)
          if (onCompleteHome) onCompleteHome()
          else if (onBack) onBack()
        }}
        onEdit={() => {
          setSummary(null)
          setEditingCompleted(true)
          setWorkoutDoneAt(null)
          setStatus('idle')
          setErrMsg('')
        }}
      />
    </div>
  )
}
