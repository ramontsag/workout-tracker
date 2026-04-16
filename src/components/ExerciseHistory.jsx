import React, { useState, useEffect } from 'react'
import { getExerciseHistory } from '../supabase'

function fmt(val) { return val === 0 ? '—' : val }

export default function ExerciseHistory({ exercise, onBack }) {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getExerciseHistory(exercise)
      .then(setSessions)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [exercise])

  const volume = (sets) =>
    sets.reduce((acc, s) => acc + (s.weight_kg || 0) * (s.reps || 0), 0)

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
          const vol = volume(session.sets)

          return (
            <div key={session.workoutId || i} className="history-card">
              <div className="history-card__header">
                <span className="history-card__date">{date}</span>
                <span className="history-card__day">{session.dayName}</span>
              </div>
              {vol > 0 && (
                <div className="history-card__volume">
                  Volume: {vol.toLocaleString()} kg
                </div>
              )}
              <div className="history-sets">
                {session.sets.map((s, idx) => (
                  <div key={idx} className="history-set-row">
                    <span className="history-set-num">Set {s.set_number}</span>
                    <span className="history-set-vals">
                      {fmt(s.weight_kg)} kg × {fmt(s.reps)} reps
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
