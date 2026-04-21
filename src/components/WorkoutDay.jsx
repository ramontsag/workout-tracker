import React, { useState, useEffect } from 'react'
import { getLastSession, saveWorkout, getPreviousSessionVolume, saveTemplate, getBestE1RMs } from '../supabase'

function fmt(val) {
  return val === 0 || val === '0' ? '—' : val
}

function calcSessionVolume(sets) {
  return Object.values(sets).flat().reduce((sum, s) => {
    const w = parseFloat(s.weight)
    const r = parseInt(s.reps)
    if (isNaN(w) || isNaN(r)) return sum
    return sum + w * r
  }, 0)
}

function buildVolumeMsg(currentVol, prev) {
  if (currentVol === 0) return null
  if (!prev || prev.volume === 0) {
    return "First session logged for this day — this is your baseline."
  }
  const pct = Math.round(((currentVol - prev.volume) / prev.volume) * 100)
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
function progressIndicator(sets, lastSets) {
  if (!lastSets || lastSets.length === 0) return null
  const currentVol = sets.reduce((sum, s) => {
    const w = parseFloat(s.weight); const r = parseInt(s.reps)
    return isNaN(w) || isNaN(r) ? sum : sum + w * r
  }, 0)
  const lastVol = lastSets.reduce((sum, s) => {
    const w = parseFloat(s.weight_kg); const r = parseInt(s.reps)
    return isNaN(w) || isNaN(r) ? sum : sum + w * r
  }, 0)
  if (currentVol === 0 || lastVol === 0) return null
  if (currentVol > lastVol)  return { label: '↑', cls: 'ex-progress--up' }
  if (currentVol < lastVol)  return { label: '↓', cls: 'ex-progress--down' }
  return { label: '→', cls: 'ex-progress--same' }
}

// ── Exercise item card (weight + reps per set) ────────────────
function ExerciseCard({ exercise, sets, lastSets, prSetIdx, onUpdate, onConfirm, onAdd, onRemove, onHistory }) {
  const prog = progressIndicator(sets, lastSets)
  const lastSummary = lastSets.length > 0
    ? lastSets.map(s => `${fmt(s.weight_kg)}kg×${fmt(s.reps)}`).join(' · ')
    : null

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
      </div>

      {lastSummary && (
        <div className="ex-last-summary">Last time: {lastSummary}</div>
      )}

      <div className="sets-list">
        {sets.map((set, idx) => {
          const prev = lastSets[idx]
          return (
            <React.Fragment key={idx}>
              <div className={`set-row${set.done ? ' set-row--done' : ''}`}>
                <span className="set-num">{idx + 1}</span>
                <div className="set-input-group">
                  <input
                    className="set-input"
                    type="number"
                    inputMode="decimal"
                    placeholder="KG"
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
                </div>
                {idx === prSetIdx && <span className="set-pr-badge">PR</span>}
                <button
                  className={`set-tick${set.done ? ' set-tick--done' : ''}`}
                  onClick={() => onConfirm(idx)}
                  title={set.done ? 'Done' : 'Mark set done'}
                >✓</button>
                {sets.length > 1 && (
                  <button className="set-remove" onClick={() => onRemove(idx)}>×</button>
                )}
              </div>
              {prev && (prev.weight_kg || prev.reps) && (
                <div className="set-prev">
                  {fmt(prev.weight_kg)}kg × {fmt(prev.reps)}
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>

      <button className="add-set-btn" onClick={onAdd}>Add Set</button>
    </div>
  )
}

// ── Activity item card (checkbox + optional notes) ────────────
function ActivityCard({ item, log, onToggle, onNotes }) {
  return (
    <div className="ex-card activity-item-card">
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
      <textarea
        className="activity-notes"
        placeholder="Details…"
        value={log.notes}
        onChange={e => onNotes(e.target.value)}
        rows={2}
      />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export default function WorkoutDay({ day, userId, onBack, onHistory }) {
  const exerciseItems = day.exercises.filter(e => e.item_type !== 'activity')
  const activityItems = day.exercises.filter(e => e.item_type === 'activity')

  const [sets, setSets] = useState(() =>
    Object.fromEntries(
      exerciseItems.map(ex => [ex.name, [
        { weight: '', reps: '', done: false },
        { weight: '', reps: '', done: false },
      ]])
    )
  )

  const [activityLogs, setActivityLogs] = useState(() =>
    Object.fromEntries(activityItems.map(a => [a.name, { checked: false, notes: '' }]))
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

  // PR tracking — bestE1RMs: historical best per exercise from DB
  // prFlags: { [exName]: setIdx } — which set in current session is a PR
  const [bestE1RMs, setBestE1RMs] = useState({})
  const [prFlags,   setPrFlags]   = useState({})

  useEffect(() => {
    getLastSession(day.id).then(setLastSession).catch(() => {})
  }, [day.id])

  // Pre-fill set count from last session once it loads
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
          next[exName] = Array.from({ length: count }, () => ({ weight: '', reps: '', done: false }))
        }
      }
      return next
    })
  }, [lastSession])

  // Load historical best e1RMs for all exercises on this day
  useEffect(() => {
    const names = exerciseItems.map(e => e.name)
    if (!names.length || !userId) return
    getBestE1RMs(names, userId).then(setBestE1RMs).catch(() => {})
  }, [day.id]) // eslint-disable-line

  // Recompute PR flags whenever sets change
  useEffect(() => {
    const newFlags = {}
    for (const [exName, exSets] of Object.entries(sets)) {
      const historical = bestE1RMs[exName] ?? 0
      let bestE1rm = 0
      let bestIdx  = -1
      exSets.forEach((set, idx) => {
        const w = parseFloat(set.weight)
        const r = parseInt(set.reps)
        if (isNaN(w) || isNaN(r) || w <= 0 || r <= 0) return
        const e1rm = w * (1 + r / 30)
        if (e1rm > bestE1rm) { bestE1rm = e1rm; bestIdx = idx }
      })
      if (bestIdx >= 0 && bestE1rm > historical) newFlags[exName] = bestIdx
    }
    setPrFlags(newFlags)
  }, [sets, bestE1RMs])

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
    setSets(prev => ({ ...prev, [exName]: [...prev[exName], { weight: '', reps: '', done: false }] }))

  const removeSet = (exName, idx) =>
    setSets(prev => ({ ...prev, [exName]: prev[exName].filter((_, i) => i !== idx) }))

  const getLastSets = (exName) => {
    if (!lastSession) return []
    return lastSession.sets.filter(s => s.exercise_name === exName)
  }

  // ── Activity helpers ────────────────────────────────────
  const toggleActivity = (name) =>
    setActivityLogs(prev => ({ ...prev, [name]: { ...prev[name], checked: !prev[name].checked } }))

  const setNotes = (name, notes) =>
    setActivityLogs(prev => ({ ...prev, [name]: { ...prev[name], notes } }))

  // ── Completion ──────────────────────────────────────────
  const hasData =
    Object.values(sets).some(s => s.some(r => r.weight !== '' || r.reps !== '')) ||
    Object.values(activityLogs).some(l => l.checked)

  const handleComplete = async () => {
    if (!hasData && !isRestDay) { setErrMsg('Log at least one set or check an activity first.'); return }
    setStatus('saving')
    setErrMsg('')
    try {
      const workout = await saveWorkout(
        day.id,
        `${day.name}${day.focus ? ` — ${day.focus}` : ''}`,
        sets, activityLogs, userId
      )
      const currentVol = calcSessionVolume(sets)
      let msg = ''
      try {
        const prev = await getPreviousSessionVolume(day.id, workout.id)
        msg = buildVolumeMsg(currentVol, prev) || ''
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
      await saveTemplate(archiveName, day.id, day.exercises, userId)
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

  const isRestDay = day.exercises.every(e => e.item_type === 'activity') // true for empty days too
  const isEmpty   = day.exercises.length === 0
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
        {/* Render items in their original order, mixing types */}
        {day.exercises.map(item =>
          item.item_type === 'activity' ? (
            <ActivityCard
              key={item.name}
              item={item}
              log={activityLogs[item.name]}
              onToggle={() => toggleActivity(item.name)}
              onNotes={notes => setNotes(item.name, notes)}
            />
          ) : (
            <ExerciseCard
              key={item.name}
              exercise={item}
              sets={sets[item.name]}
              lastSets={getLastSets(item.name)}
              prSetIdx={prFlags[item.name]}
              onUpdate={(idx, field, val) => updateSet(item.name, idx, field, val)}
              onConfirm={idx => confirmSet(item.name, idx)}
              onAdd={() => addSet(item.name)}
              onRemove={idx => removeSet(item.name, idx)}
              onHistory={() => onHistory(item.name)}
            />
          )
        )}

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
    </div>
  )
}
