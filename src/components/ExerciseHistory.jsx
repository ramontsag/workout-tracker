import React, { useState, useEffect } from 'react'
import { getExerciseHistory } from '../supabase'
import { displayWeight, unitLabel, kgToLbs } from '../utils/units'

function fmt(val) { return val === 0 ? '—' : val }

export default function ExerciseHistory({ exercise, profile, onBack }) {
  const unit  = profile?.weight_unit || 'kg'
  const label = unitLabel(unit)

  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getExerciseHistory(exercise)
      .then(setSessions)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [exercise])

  // Sum in kg, excluding warmup sets from the headline volume figure.
  const volumeKg = (sets) =>
    sets
      .filter(s => !s.is_warmup)
      .reduce((acc, s) => acc + (s.weight_kg || 0) * (s.reps || 0), 0)

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

        {sessions.map((session, i) => {
          const date = session.date
            ? new Date(session.date).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
              })
            : 'Unknown date'
          const volKg = volumeKg(session.sets)
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
                {session.sets.map((s, idx) => (
                  <div key={idx} className={`history-set-row ${s.is_warmup ? 'history-set-row--warmup' : ''}`}>
                    <span className="history-set-num">
                      {s.is_warmup ? 'Warmup' : `Set ${s.set_number}`}
                    </span>
                    <span className="history-set-vals">
                      {s.weight_kg ? `${displayWeight(s.weight_kg, unit)} ${label}` : '—'} × {fmt(s.reps)} reps
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
