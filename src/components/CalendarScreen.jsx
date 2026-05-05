import React, { useState, useEffect, useMemo } from 'react'
import { getCompletedSessionsInRange } from '../supabase'

// Calendar trial — month grid showing what was actually done each day.
// Each cell shows the date + up to 2 small kind-colored dots (orange =
// workout, cyan = activity, purple if both kinds the same day) and a tiny
// session count. Tap a day to open a sheet listing the day's completions.

const WEEK_HEADERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']  // Mon-first

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1) }
function startOfNextMonth(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 1) }
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}
function fmtMonth(d) {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}
function fmtDayHeading(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}
// Friendly label for a session row in the bottom sheet.
function labelForSession(s) {
  if (s.kind === 'activity' && s.activity_name) return s.activity_name
  // workouts.day_name often looks like "Monday — Push A" — take what's
  // after the em-dash; fall back to the raw value.
  const parts = (s.day_name || '').split(/[—\-:]/)
  if (parts.length > 1) return parts.slice(1).join('—').trim() || s.day_name
  return s.day_name || (s.kind === 'workout' ? 'Workout' : 'Session')
}

export default function CalendarScreen({ userId, onBack }) {
  const [cursor, setCursor]       = useState(() => startOfMonth(new Date()))
  const [sessions, setSessions]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [selectedDay, setSelectedDay] = useState(null)  // Date | null

  const today = new Date()

  // Load sessions for the visible month. Range is [first of month, first of
  // next month) so we never double-fetch the boundary.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true); setError('')
    const start = startOfMonth(cursor).toISOString()
    const end   = startOfNextMonth(cursor).toISOString()
    getCompletedSessionsInRange(start, end, userId)
      .then(rows => { if (!cancelled) setSessions(rows) })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load month') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cursor, userId])

  // Group sessions by yyyy-mm-dd local key for O(1) cell lookups.
  const byDay = useMemo(() => {
    const m = {}
    for (const s of sessions) {
      const d = new Date(s.completed_at)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!m[key]) m[key] = []
      m[key].push(s)
    }
    return m
  }, [sessions])

  // Build the cells for the visible month. Pads with prev-month + next-month
  // dates so the grid is always full weeks (Mon-Sun rows).
  const cells = useMemo(() => {
    const first = startOfMonth(cursor)
    const lastDay = startOfNextMonth(cursor) - 1
    // Mon-first offset: getDay() returns 0=Sun..6=Sat → convert to 0=Mon..6=Sun
    const leading = (first.getDay() + 6) % 7
    const out = []
    // Leading days from prev month
    for (let i = leading; i > 0; i--) {
      const d = new Date(first.getFullYear(), first.getMonth(), 1 - i)
      out.push({ date: d, inMonth: false })
    }
    // This month's days
    const lastDate = new Date(lastDay).getDate()
    for (let dt = 1; dt <= lastDate; dt++) {
      out.push({ date: new Date(first.getFullYear(), first.getMonth(), dt), inMonth: true })
    }
    // Trailing days to fill the final week
    while (out.length % 7 !== 0) {
      const last = out[out.length - 1].date
      out.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false })
    }
    return out
  }, [cursor])

  const goPrev = () => setCursor(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))
  const goNext = () => setCursor(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))
  const goToday = () => setCursor(startOfMonth(new Date()))

  const selectedSessions = selectedDay
    ? (byDay[`${selectedDay.getFullYear()}-${selectedDay.getMonth()}-${selectedDay.getDate()}`] || [])
    : []

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Calendar</div>
          <div className="sub-header__sub">What you actually did</div>
        </div>
      </header>

      <div className="content">
        <div className="calendar-toolbar">
          <button className="calendar-nav-btn" onClick={goPrev} aria-label="Previous month">‹</button>
          <button className="calendar-month-btn" onClick={goToday} title="Jump to current month">
            {fmtMonth(cursor)}
          </button>
          <button className="calendar-nav-btn" onClick={goNext} aria-label="Next month">›</button>
        </div>

        {error && <div className="err-msg" style={{ margin: '8px 16px' }}>{error}</div>}

        <div className="calendar-grid">
          {WEEK_HEADERS.map((h, i) => (
            <div key={`h-${i}`} className="calendar-weekday">{h}</div>
          ))}
          {cells.map(({ date, inMonth }, i) => {
            const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
            const items = byDay[key] || []
            const isToday = sameDay(date, today)
            const isFuture = date > today && !isToday
            const hasWorkout = items.some(s => s.kind === 'workout')
            const hasActivity = items.some(s => s.kind === 'activity')
            const isHybrid = hasWorkout && hasActivity
            const cellClasses = [
              'calendar-cell',
              !inMonth && 'calendar-cell--out',
              isFuture && 'calendar-cell--future',
              isToday && 'calendar-cell--today',
              items.length > 0 && 'calendar-cell--done',
            ].filter(Boolean).join(' ')
            return (
              <button
                key={`c-${i}`}
                className={cellClasses}
                onClick={() => setSelectedDay(date)}
                aria-label={`${date.getDate()}, ${items.length} session${items.length === 1 ? '' : 's'}`}
              >
                <span className="calendar-cell__num">{date.getDate()}</span>
                <span className="calendar-cell__dots">
                  {isHybrid ? (
                    <span className="calendar-dot calendar-dot--hybrid" />
                  ) : (
                    <>
                      {hasWorkout  && <span className="calendar-dot calendar-dot--workout" />}
                      {hasActivity && <span className="calendar-dot calendar-dot--activity" />}
                    </>
                  )}
                </span>
                {items.length > 1 && (
                  <span className="calendar-cell__count">{items.length}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Legend — quick visual key for first-time users. */}
        <div className="calendar-legend">
          <span className="calendar-legend__item">
            <span className="calendar-dot calendar-dot--workout" /> workout
          </span>
          <span className="calendar-legend__item">
            <span className="calendar-dot calendar-dot--activity" /> activity
          </span>
          <span className="calendar-legend__item">
            <span className="calendar-dot calendar-dot--hybrid" /> both
          </span>
        </div>

        {loading && <div className="state-msg">Loading…</div>}

        <div style={{ height: 60 }} />
      </div>

      {/* Day detail sheet — slides up when a cell is tapped. */}
      {selectedDay && (
        <div className="picker-overlay" onClick={() => setSelectedDay(null)}>
          <div className="picker-sheet calendar-sheet" onClick={e => e.stopPropagation()}>
            <div className="picker-header">
              <span className="picker-title">{fmtDayHeading(selectedDay)}</span>
              <button className="picker-close" onClick={() => setSelectedDay(null)} aria-label="Close">×</button>
            </div>
            <div className="picker-list">
              {selectedSessions.length === 0 ? (
                <div className="picker-empty">Nothing logged on this day.</div>
              ) : (
                <div className="calendar-day-list">
                  {selectedSessions.map(s => (
                    <div key={s.id} className={`calendar-day-row calendar-day-row--${s.kind}`}>
                      <span className="calendar-day-row__check">✓</span>
                      <span className="calendar-day-row__label">{labelForSession(s)}</span>
                      <span className="calendar-day-row__time">
                        {new Date(s.completed_at).toLocaleTimeString('en-US', {
                          hour: 'numeric', minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
