import React, { useState, useEffect } from 'react'
import { getBodyWeightLogs, logBodyWeight, getWeeklyProgress, getInProgressDayIds, discardDraft, getInProgressWorkout } from '../supabase'
import { displayWeight, parseInputWeight, unitLabel } from '../utils/units'
import EditDayModal from './EditDayModal'

const DAY_ORDER = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const DAY_ABBREV = {
  Monday: 'MON', Tuesday: 'TUE', Wednesday: 'WED', Thursday: 'THU',
  Friday: 'FRI', Saturday: 'SAT', Sunday: 'SUN',
}

function getToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Completion ring ───────────────────────────────────────────
function CompletionRing({ completed, target }) {
  const SIZE = 76, CX = 38, R = 30, SW = 6
  const C        = 2 * Math.PI * R
  const progress = target > 0 ? completed / target : 0
  const over     = progress > 1
  const capped   = Math.min(progress, 1)
  const ringColor = over ? '#FFB800' : capped >= 1 ? 'var(--success)' : 'var(--accent)'

  // When over target, show a second arc for the overflow (up to 110%)
  const overflowPct    = over ? Math.min((progress - 1) / 0.1, 1) : 0
  const overflowOffset = (C * (1 - overflowPct)).toFixed(2)
  const mainOffset     = over ? '0' : (C * (1 - capped)).toFixed(2)

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="ring-svg">
      {/* Track */}
      <circle cx={CX} cy={CX} r={R} fill="none"
        stroke="var(--surface3)" strokeWidth={SW} />
      {/* Main arc */}
      {completed > 0 && (
        <circle cx={CX} cy={CX} r={R} fill="none"
          stroke={ringColor}
          strokeWidth={SW}
          strokeLinecap="round"
          strokeDasharray={C.toFixed(2)}
          strokeDashoffset={mainOffset}
          transform={`rotate(-90 ${CX} ${CX})`}
        />
      )}
      {/* Overflow arc — thinner ring on top when over target */}
      {over && (
        <circle cx={CX} cy={CX} r={R} fill="none"
          stroke="#fff"
          strokeWidth={SW - 3}
          strokeOpacity={0.35}
          strokeLinecap="round"
          strokeDasharray={C.toFixed(2)}
          strokeDashoffset={overflowOffset}
          transform={`rotate(-90 ${CX} ${CX})`}
        />
      )}
      {/* Centre: session count */}
      <text x={CX} y={CX - 5} textAnchor="middle"
        dominantBaseline="central" className="ring-count">
        {completed}
      </text>
      {/* Centre: /target */}
      <text x={CX} y={CX + 11} textAnchor="middle"
        dominantBaseline="central" className="ring-sub">
        /{target}
      </text>
    </svg>
  )
}

const OVER_MESSAGES = [
  'Beast mode — way above target!',
  'Absolutely smashing it this week.',
  'Target obliterated. Respect.',
  'You set the bar, then cleared it.',
]

function weeklyMessage(completed, target, workouts, activities) {
  if (completed === 0) return 'No sessions yet this week'
  const breakdown = [
    workouts  > 0 ? `${workouts} workout${workouts  !== 1 ? 's' : ''}` : null,
    activities > 0 ? `${activities} activit${activities !== 1 ? 'ies' : 'y'}` : null,
  ].filter(Boolean).join(' · ')
  if (completed > target) {
    const msg = OVER_MESSAGES[(completed - target - 1) % OVER_MESSAGES.length]
    return breakdown ? `${msg} (${breakdown})` : msg
  }
  if (completed === target) return `Target hit — great week!${breakdown ? ` (${breakdown})` : ''}`
  const rem = target - completed
  return `${rem} more to hit your target${breakdown ? ` · ${breakdown}` : ''}`
}

// ── Main component ────────────────────────────────────────────
export default function Home({ program, userId, profile, onSelectDay, onProfile, onProgramUpdated }) {
  const unit = profile?.weight_unit || 'kg'
  const label = unitLabel(unit)
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' })

  const [lastWeight,     setLastWeight]     = useState(null)
  const [showForm,       setShowForm]       = useState(false)
  const [weightInput,    setWeightInput]    = useState('')
  const [dateInput,      setDateInput]      = useState(getToday)
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState('')
  const [weeklyProgress, setWeeklyProgress] = useState(null)
  const [draftDayIds,    setDraftDayIds]    = useState(new Set())

  useEffect(() => {
    if (!userId) return
    getBodyWeightLogs(userId, 1)
      .then(logs => setLastWeight(logs[0] || null))
      .catch(() => {})
    getWeeklyProgress(userId)
      .then(setWeeklyProgress)
      .catch(e => console.warn('weekly progress failed:', e.message))
    getInProgressDayIds(userId)
      .then(setDraftDayIds)
      .catch(() => {})
  }, [userId])

  const handleDiscardDraft = async (dayId) => {
    try {
      const draft = await getInProgressWorkout(dayId, userId)
      if (draft) await discardDraft(draft.id, userId)
    } catch { /* non-fatal */ }
    // Clear the local cache so the next open starts fresh.
    try { window.localStorage.removeItem(`wt:draft:${userId}:${dayId}`) } catch {}
    setDraftDayIds(prev => {
      const next = new Set(prev)
      next.delete(dayId)
      return next
    })
    setPendingDay(null)
  }

  const handleLogWeight = async () => {
    const kg = parseInputWeight(weightInput, unit)
    if (isNaN(kg) || kg <= 0) { setError('Enter a valid weight'); return }
    setSaving(true)
    setError('')
    try {
      const saved = await logBodyWeight(
        kg,
        new Date(dateInput + 'T12:00:00').toISOString(),
        null,
        userId
      )
      setLastWeight(saved)
      setWeightInput('')
      setDateInput(getToday())
      setShowForm(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const [pendingDay, setPendingDay] = useState(null)
  const [editDay,    setEditDay]    = useState(null)

  const sorted = program.filter(d => DAY_ORDER.includes(d.name)).sort((a, b) => {
    const ai = DAY_ORDER.indexOf(a.name)
    const bi = DAY_ORDER.indexOf(b.name)
    if (ai === -1 && bi === -1) return 0
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  const weekDone = weeklyProgress
    && weeklyProgress.completed > 0
    && weeklyProgress.completed >= weeklyProgress.target
  const weekOver = weeklyProgress && weeklyProgress.completed > weeklyProgress.target

  return (
    <div className="screen">
      <header className="home-header">
        <div>
          <h1 className="home-title">Session</h1>
          <div className="home-subtitle">What are we attacking today</div>
          <div className="home-date">
            {new Date().toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
            })}
          </div>
        </div>
        <button className="profile-btn" onClick={onProfile} aria-label="Profile">
          <svg className="orbit-ring-svg" viewBox="0 0 52 52" xmlns="http://www.w3.org/2000/svg">
            <circle cx="26" cy="26" r="23.5" fill="none" stroke="#00C2A8"
              strokeWidth="1.5" strokeDasharray="4 3" />
          </svg>
          <span className="profile-btn__icon">👤</span>
        </button>
      </header>

      {/* ── Weekly completion ring ───────────────────── */}
      {weeklyProgress && (
        <div className={`week-card${weekDone ? ' week-card--done' : ''}${weekOver ? ' week-card--over' : ''}`}>
          <CompletionRing
            completed={weeklyProgress.completed}
            target={weeklyProgress.target}
          />
          <div className="week-card-text">
            <div className="week-card-title">This week</div>
            <div className={`week-card-sub${weekDone ? ' week-card-sub--done' : ''}${weekOver ? ' week-card-sub--over' : ''}`}>
              {weeklyMessage(weeklyProgress.completed, weeklyProgress.target, weeklyProgress.workouts, weeklyProgress.activities)}
            </div>
          </div>
        </div>
      )}

      {/* ── Weight bar ──────────────────────────────────── */}
      <div className="weight-bar">
        <div className="weight-bar-inner">
          <div className="weight-bar-left">
            <div className="weight-bar-label">Bodyweight</div>
            <span className="weight-bar-reading">
              {lastWeight
                ? <>{displayWeight(Number(lastWeight.weight_kg), unit)} <span className="weight-bar-unit">{label}</span> <span className="weight-bar-dot">·</span> {fmtDate(lastWeight.logged_at)}</>
                : <span className="weight-bar-empty">No log yet</span>
              }
            </span>
          </div>
          <button
            className={`weight-bar-btn ${showForm ? 'weight-bar-btn--cancel' : ''}`}
            onClick={() => { setShowForm(f => !f); setError('') }}
          >
            {showForm ? 'Cancel' : 'LOG IT'}
          </button>
        </div>

        {showForm && (
          <div className="weight-bar-form">
            <div className="weight-bar-form-row">
              <input
                className="field-input weight-bar-input"
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder={label}
                value={weightInput}
                onChange={e => { setWeightInput(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleLogWeight()}
                autoFocus
              />
              <input
                className="field-input weight-bar-input"
                type="date"
                value={dateInput}
                onChange={e => setDateInput(e.target.value)}
              />
            </div>
            {error && <div className="weight-bar-error">{error}</div>}
            <button
              className="weight-bar-save"
              onClick={handleLogWeight}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* ── Day grid ────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div className="state-msg">No days set up yet.</div>
      ) : (
        <div className="day-grid">
          {sorted.map((day, i) => {
            const isToday  = day.name.toLowerCase() === today.toLowerCase()
            const items    = day.exercises || []
            const exCount  = items.filter(e => e.item_type !== 'activity').length
            const actCount = items.filter(e => e.item_type === 'activity').length
            const isEmpty  = items.length === 0
            const isGymDay = !isEmpty && exCount >= actCount

            let countLabel
            if (exCount > 0 && actCount > 0)
              countLabel = `${exCount} lift${exCount !== 1 ? 's' : ''} · ${actCount} activit${actCount !== 1 ? 'ies' : 'y'}`
            else if (exCount > 0)
              countLabel = `${exCount} lift${exCount !== 1 ? 's' : ''}`
            else if (actCount > 0)
              countLabel = `${actCount} activit${actCount !== 1 ? 'ies' : 'y'}`
            else
              countLabel = 'Rest day'

            const typeClass     = isEmpty ? 'day-card--empty' : isGymDay ? 'day-card--gym' : 'day-card--rest'
            const indicatorType = isEmpty ? 'empty' : isGymDay ? 'gym' : 'rest'
            const hasDraft      = draftDayIds.has(day.id)
            const isDone        = !!weeklyProgress?.completedDayIds?.includes(day.id)

            return (
              <div
                key={day.id}
                className={`day-card ${typeClass}${isToday ? ' day-card--today' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
                role="button"
                tabIndex={0}
                onClick={() => isToday ? onSelectDay(day) : setPendingDay(day)}
                onKeyDown={(e) => { if (e.key === 'Enter') (isToday ? onSelectDay(day) : setPendingDay(day)) }}
              >
                {hasDraft && (
                  <span className="day-card__draft-dot" title="Unfinished workout" aria-label="In progress" />
                )}
                {isDone && (
                  <span className={`day-card__done-mark day-card__done-mark--${indicatorType}`} title="Completed this week" aria-label="Completed">✓</span>
                )}
                {isToday && (
                  <div className={`day-card__stripe day-card__stripe--${indicatorType}`}>
                    <span className="day-card__abbr">{DAY_ABBREV[day.name] || day.name.slice(0, 3).toUpperCase()}</span>
                    <div className="day-card__pulse-dot" />
                  </div>
                )}
                <div className="day-card__content">
                  <div className="day-card__name">{day.name}</div>
                  {day.focus
                    ? <div className="day-card__focus">{day.focus}</div>
                    : (!isGymDay && !isEmpty && <div className="day-card__focus">rest / move</div>)
                  }
                  <div className="day-card__count">{countLabel}</div>
                </div>
                <div className="day-card__indicator-wrap">
                  <div className={`day-card__indicator-circle day-card__indicator-circle--${indicatorType}`}>
                    <div className="day-card__indicator-dash" />
                  </div>
                </div>
                <button
                  className={`day-card__edit day-card__edit--${indicatorType}`}
                  onClick={(e) => { e.stopPropagation(); setEditDay(day) }}
                  aria-label={`Edit ${day.name}`}
                  title="Edit day"
                >Edit</button>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ height: 40 }} />

      {editDay && (
        <EditDayModal
          open
          day={editDay}
          program={program}
          userId={userId}
          onClose={() => setEditDay(null)}
          onSaved={onProgramUpdated}
        />
      )}

      {pendingDay && (
        <div className="makeup-overlay" onClick={() => setPendingDay(null)}>
          <div className="makeup-sheet" onClick={e => e.stopPropagation()}>
            <div className="makeup-sheet__title">
              {pendingDay.name}{pendingDay.focus ? <span className="makeup-sheet__focus"> — {pendingDay.focus}</span> : null}
            </div>
            <div className="makeup-sheet__sub">
              {draftDayIds.has(pendingDay.id)
                ? 'You have an unfinished workout for this day.'
                : `Logging for today, ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`}
            </div>
            <div className="makeup-sheet__btns">
              <button className="makeup-sheet__go" onClick={() => { onSelectDay(pendingDay); setPendingDay(null) }}>
                {draftDayIds.has(pendingDay.id)
                  ? `Resume ${pendingDay.name}'s Workout`
                  : `Start ${pendingDay.name}'s Workout`}
              </button>
              {draftDayIds.has(pendingDay.id) && (
                <button className="makeup-sheet__discard" onClick={() => handleDiscardDraft(pendingDay.id)}>
                  Discard unfinished workout
                </button>
              )}
              <button className="makeup-sheet__cancel" onClick={() => setPendingDay(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
