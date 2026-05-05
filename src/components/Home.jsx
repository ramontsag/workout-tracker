import React, { useState, useEffect } from 'react'
import { getBodyWeightLogs, logBodyWeight, getWeeklyProgress, getInProgressDayIds } from '../supabase'
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

// ── Energy ring ───────────────────────────────────────────────
// Multi-layer SVG: dim track + gradient progress arc (orange→cyan)
// + leading-edge dot at the arc tip + soft halo glow that pulses when the
// target is reached. Numbers in the centre use the display font for a
// HUD-style readout.
function EnergyRing({ completed, target }) {
  const SIZE = 96, CX = 48, R = 36, SW = 5
  const C        = 2 * Math.PI * R
  const progress = target > 0 ? completed / target : 0
  const over     = progress > 1
  const capped   = Math.min(progress, 1)

  // Leading-edge dot position along the arc. Top of the circle is 12 o'clock
  // (-90deg in math coords), and the arc grows clockwise.
  const angleRad = (-90 + capped * 360) * Math.PI / 180
  const dotX = CX + R * Math.cos(angleRad)
  const dotY = CX + R * Math.sin(angleRad)

  const mainOffset = (C * (1 - capped)).toFixed(2)
  const stateClass = over ? 'energy-ring--over'
                   : capped >= 1 ? 'energy-ring--done'
                   : ''

  // Per-instance gradient ID so multiple rings on the same screen don't
  // collide on the same <defs> id.
  const gradId = `er-grad-${target}-${completed}`

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}
         className={`energy-ring ${stateClass}`}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#FF5500" />
          <stop offset="100%" stopColor="#00C2A8" />
        </linearGradient>
        <radialGradient id={`${gradId}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="#00C2A8" stopOpacity="0" />
          <stop offset="78%" stopColor="#00C2A8" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#00C2A8" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Halo — dormant until the user hits target */}
      <circle cx={CX} cy={CX} r={R + 8} fill={`url(#${gradId}-halo)`}
              className="energy-ring__halo" />

      {/* Track ring */}
      <circle cx={CX} cy={CX} r={R} fill="none"
              stroke="rgba(255, 255, 255, 0.07)" strokeWidth={SW} />

      {/* Progress arc */}
      {completed > 0 && (
        <circle cx={CX} cy={CX} r={R} fill="none"
                stroke={over ? '#FFB800' : `url(#${gradId})`}
                strokeWidth={SW}
                strokeLinecap="round"
                strokeDasharray={C.toFixed(2)}
                strokeDashoffset={mainOffset}
                transform={`rotate(-90 ${CX} ${CX})`}
                className="energy-ring__arc"
        />
      )}

      {/* Leading-edge dot — sits at the tip of the arc, hidden when
          the ring fills the entire circle so it doesn't overlap the start. */}
      {completed > 0 && capped < 1 && (
        <circle cx={dotX} cy={dotY} r={3.5}
                fill="#FF8A4C" className="energy-ring__tip" />
      )}

      {/* HUD readout */}
      <text x={CX} y={CX - 4} textAnchor="middle" dominantBaseline="central"
            className="energy-ring__count">{completed}</text>
      <text x={CX} y={CX + 14} textAnchor="middle" dominantBaseline="central"
            className="energy-ring__sub">/ {target}</text>
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
    const refresh = () => {
      getBodyWeightLogs(userId, 1)
        .then(logs => setLastWeight(logs[0] || null))
        .catch(() => {})
      getWeeklyProgress(userId)
        .then(setWeeklyProgress)
        .catch(e => console.warn('weekly progress failed:', e.message))
      getInProgressDayIds(userId)
        .then(setDraftDayIds)
        .catch(() => {})
    }
    refresh()
    // Re-fetch when the tab becomes visible again — catches week rollovers
    // (Monday 00:00) and stale data from the app being backgrounded.
    const onVis = () => { if (!document.hidden) refresh() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', refresh)
    }
  }, [userId])

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
          <EnergyRing
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
                type="text"
                inputMode="decimal"
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
            const isToday   = day.name.toLowerCase() === today.toLowerCase()
            const items     = day.exercises || []
            const blocks    = day.workout_blocks || []
            const exItems   = items.filter(e => e.item_type !== 'activity')
            const actItems  = items.filter(e => e.item_type === 'activity')
            const exCount   = exItems.length
            const actCount  = actItems.length
            // A day "has workouts" if any workout_block has exercises in it,
            // OR (legacy) if there are exercises but no blocks structure yet.
            const populatedBlocks = blocks.filter(b => (b.exercises || []).length > 0)
            const blockCount = populatedBlocks.length || (exCount > 0 ? 1 : 0)
            const isEmpty    = exCount === 0 && actCount === 0
            const isHybrid   = blockCount > 0 && actCount > 0
            const isGymOnly  = blockCount > 0 && actCount === 0
            const isActOnly  = blockCount === 0 && actCount > 0

            // Title: hybrid → "Hybrid"; workout-only → join block names;
            // activity-only → join activity names; empty → "Rest day".
            let dayTitle
            if (isEmpty)        dayTitle = 'Rest day'
            else if (isHybrid)  dayTitle = 'Hybrid'
            else if (isGymOnly) dayTitle = populatedBlocks.length
              ? populatedBlocks.map(b => b.name).join(' · ')
              : (day.focus?.trim() || 'Workout')
            else                dayTitle = actItems.map(a => a.name).join(' · ')

            let countLabel
            if (isHybrid)
              countLabel = `${blockCount} workout${blockCount !== 1 ? 's' : ''} · ${actCount} activit${actCount !== 1 ? 'ies' : 'y'}`
            else if (isGymOnly && blockCount > 1)
              countLabel = `${blockCount} workouts · ${exCount} lift${exCount !== 1 ? 's' : ''}`
            else if (isGymOnly)
              countLabel = `${exCount} lift${exCount !== 1 ? 's' : ''}`
            else if (isActOnly)
              countLabel = `${actCount} activit${actCount !== 1 ? 'ies' : 'y'}`
            else
              countLabel = ''

            const indicatorType = isEmpty ? 'empty'
              : isHybrid ? 'hybrid'
              : isGymOnly ? 'gym'
              : 'rest'
            const typeClass = `day-card--${indicatorType}`
            const hasDraft  = draftDayIds.has(day.id)
            // ✓ now follows the CALENDAR day work happened on, not the
            // planned training_day_id. So if Sunday's plan was done on
            // Monday, Sunday stays unchecked and Monday gets the ✓.
            // The pill row below shows what was actually done on each
            // calendar day, regardless of plan.
            const calendarActual = weeklyProgress?.actualByWeekday?.[day.name] || []
            const isDone    = calendarActual.length > 0
            // Dedupe by kind+label so a re-saved block doesn't double-count.
            const dedupedActual = (() => {
              const seen = new Set(); const out = []
              for (const a of calendarActual) {
                const k = `${a.kind}:${a.label.toLowerCase()}`
                if (seen.has(k)) continue
                seen.add(k); out.push(a)
              }
              return out
            })()
            const offScheduleActual = dedupedActual.filter(a => !a.onSchedule)
            const onScheduleActual  = dedupedActual.filter(a =>  a.onSchedule)
            // "Override" = this calendar day has work logged, but NONE of it
            // was from this day's plan. Triggers the dimmed title + tinted ✓.
            const isOverridden = isDone && onScheduleActual.length === 0
            const overrideKind = isOverridden && offScheduleActual.length
              ? (offScheduleActual.some(a => a.kind === 'workout') ? 'workout' : 'activity')
              : null
            // Per-day completion badge ("2/3") — only meaningful on days with
            // multiple items. Counts follow the CALENDAR day (matches ✓): if
            // you did 1 thing on Monday — even one of Sunday's planned items —
            // Monday reads 1/3 of its plan. Capped at total so doing extras
            // doesn't push it past "complete".
            const totalItems    = blockCount + actCount
            const doneItems     = Math.min(totalItems, dedupedActual.length)
            const showBadge     = isDone && totalItems > 1 && doneItems > 0

            return (
              <div
                key={day.id}
                className={`day-card ${typeClass}${isToday ? ' day-card--today' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
                role="button"
                tabIndex={0}
                onClick={() => onSelectDay(day)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSelectDay(day) }}
              >
                {isToday && (
                  <div className={`day-card__stripe day-card__stripe--${indicatorType}`}>
                    <span className="day-card__abbr">{DAY_ABBREV[day.name] || day.name.slice(0, 3).toUpperCase()}</span>
                    <div className="day-card__pulse-dot" />
                  </div>
                )}
                <div className="day-card__content">
                  <div className="day-card__name-row">
                    <div className="day-card__name">{day.name}</div>
                    <button
                      className={`day-card__edit day-card__edit--${indicatorType}`}
                      onClick={(e) => { e.stopPropagation(); setEditDay(day) }}
                      aria-label={`Edit ${day.name}`}
                      title="Edit day"
                    >Edit</button>
                  </div>
                  <div className={`day-card__focus${isOverridden ? ' day-card__focus--overridden' : ''}`}>{dayTitle}</div>
                  {countLabel && (
                    <div className={`day-card__count${isOverridden ? ' day-card__count--overridden' : ''}`}>{countLabel}</div>
                  )}
                  {/* "Did:" pills — what was actually done on this CALENDAR
                      day but NOT part of this day's plan (e.g. Sunday's
                      workout done on Monday). Loud styling + a "DID" label so
                      they dominate the (now-dimmed) planned title when the
                      day was overridden. */}
                  {offScheduleActual.length > 0 && (
                    <div className="day-card__actual">
                      <span className="day-card__actual-label" aria-label="Actually did">↳</span>
                      {offScheduleActual.map((a, k) => (
                        <span
                          key={k}
                          className={`day-card__actual-pill day-card__actual-pill--${a.kind}`}
                          title={`Actually done on ${day.name}`}
                        >
                          ✓ {a.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="day-card__indicator-wrap">
                  {showBadge && (
                    <span
                      className="day-card__progress-badge"
                      title={`${doneItems} of ${totalItems} items done this week`}
                    >{doneItems}/{totalItems}</span>
                  )}
                  <div className={`day-card__indicator-circle day-card__indicator-circle--${indicatorType}${isDone ? ' day-card__indicator-circle--done' : ''}${overrideKind ? ` day-card__indicator-circle--override-${overrideKind}` : ''}`}
                    title={isDone ? `Completed ${doneItems}/${totalItems} this week` : undefined}
                    aria-label={isDone ? 'Completed' : undefined}
                  >
                    {isDone
                      ? <span className="day-card__indicator-check">✓</span>
                      : <div className="day-card__indicator-dash" />}
                  </div>
                </div>
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

    </div>
  )
}
