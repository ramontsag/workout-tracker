import React, { useState, useEffect } from 'react'
import { getExerciseHistory } from '../supabase'
import { displayWeight, unitLabel, kgToLbs } from '../utils/units'
import { formatActivityLine, isActivityRow } from '../utils/sessionFormat'

function fmt(val) { return val === 0 ? '—' : val }

export default function ExerciseHistory({ exercise, profile, userId, onBack }) {
  const unit  = profile?.weight_unit || 'kg'
  const label = unitLabel(unit)

  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [range, setRange] = useState('6m')  // '4w' | '3m' | '6m' | 'all'

  useEffect(() => {
    if (!userId) return
    setLoading(true); setError(null)
    getExerciseHistory(exercise, userId)
      .then(setSessions)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [exercise, userId])

  // Volume sum in kg. Warmups excluded (preparatory, not work). Drop sets
  // INCLUDED — they're real work even if assistance-weighted, and this
  // matches getVolumeHistory in supabase.js (the Progress > Lifts source
  // of truth). Checked-mode rows store weight=0 and reps=0, so they
  // contribute zero naturally without needing a separate filter.
  const volumeKg = (sets) =>
    sets
      .filter(s => !s.is_warmup)
      .reduce((acc, s) => acc + (s.weight_kg || 0) * (s.reps || 0), 0)

  // Client-side range filter — 'all' shows everything; the rest cap at the
  // matching number of days back from now.
  const filteredSessions = (() => {
    if (range === 'all') return sessions
    const days   = range === '6m' ? 180 : range === '3m' ? 90 : 28
    const cutoff = Date.now() - days * 86400000
    return sessions.filter(s => s.date && new Date(s.date).getTime() >= cutoff)
  })()

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">{exercise}</div>
          <div className="sub-header__sub">All sessions</div>
        </div>
      </header>

      <div className="content">
        {loading && <div className="state-msg">Loading up...</div>}
        {error && <div className="err-msg">{error}</div>}

        {!loading && !error && sessions.length === 0 && (
          <div className="state-msg state-msg--empty">
            No history yet for this exercise.
          </div>
        )}

        {!loading && !error && sessions.length > 0 && (
          <div className="lifts-controls" style={{ margin: '4px 0 12px' }}>
            <div className="lifts-range">
              {[
                { k: '4w',  l: '4w'  },
                { k: '3m',  l: '3m'  },
                { k: '6m',  l: '6m'  },
                { k: 'all', l: 'All' },
              ].map(({ k, l }) => (
                <button
                  key={k}
                  className={`lifts-range__btn${range === k ? ' lifts-range__btn--on' : ''}`}
                  onClick={() => setRange(k)}
                >{l}</button>
              ))}
            </div>
            <span className="exhist-count">
              {filteredSessions.length} of {sessions.length}
            </span>
          </div>
        )}

        {!loading && !error && sessions.length > 0 && filteredSessions.length === 0 && (
          <div className="state-msg state-msg--empty">
            No sessions in this range.
          </div>
        )}

        {filteredSessions.map((session, i) => {
          const date = session.date
            ? new Date(session.date).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              })
            : 'Unknown date'

          // If every row in this session is an activity row, render the session
          // as an activity log (one line per session) and skip the volume + set-row
          // rendering that only makes sense for weighted sets.
          const allActivity = session.sets.length > 0 && session.sets.every(isActivityRow)
          const volKg = allActivity ? 0 : volumeKg(session.sets)
          const volDisplay = unit === 'lbs' ? kgToLbs(volKg) : volKg

          return (
            <div key={session.workoutId || i} className="history-card">
              <div className="history-card__header">
                <span className="history-card__date">{date}</span>
                <span className="history-card__day">{session.dayName}</span>
              </div>
              {volKg > 0 && (
                <div className="history-card__volume">
                  Volume: {Math.round(volDisplay).toLocaleString()} {label}
                </div>
              )}
              <div className="history-sets">
                {session.sets.map((s, idx) => {
                  if (isActivityRow(s)) {
                    const line = formatActivityLine(s, unit)
                    return (
                      <div key={idx} className="history-set-row">
                        <span className="history-set-vals">
                          {line || (s.checked ? 'Completed' : '—')}
                          {s.notes && <span className="history-set-notes"> · {s.notes}</span>}
                        </span>
                      </div>
                    )
                  }
                  // Mode is implicit in the row shape (see Finding A):
                  //   checked + weight=0 + reps=0  → check-mode log
                  //   is_drop_set                  → drop set (real work)
                  //   is_warmup                    → warmup
                  // Warmup / drop / check are orthogonal — a warmup drop
                  // set would render two pills.
                  const isCheck = !!s.checked && !s.weight_kg && !s.reps
                  const isDrop  = !!s.is_drop_set
                  const isWarmup = !!s.is_warmup
                  return (
                    <div key={idx} className={`history-set-row ${isWarmup ? 'history-set-row--warmup' : ''}`}>
                      <span className="history-set-num">
                        {isWarmup ? 'Warmup' : `Set ${s.set_number}`}
                      </span>
                      <span className="history-set-vals">
                        {isCheck
                          ? '✓ Checked'
                          : <>{s.weight_kg ? `${displayWeight(s.weight_kg, unit)} ${label}` : '—'} × {fmt(s.reps)} reps</>}
                      </span>
                      {(isCheck || isDrop) && (
                        <span className="history-set-pills">
                          {isCheck && <span className="history-set-pill history-set-pill--check">Check</span>}
                          {isDrop  && <span className="history-set-pill history-set-pill--drop">Drop</span>}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
