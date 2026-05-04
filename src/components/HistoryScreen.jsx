import React, { useState, useEffect } from 'react'
import { getTemplates, getLastSessionForTemplateName } from '../supabase'
import { displayWeight, unitLabel, kgToLbs } from '../utils/units'

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtRelative(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days} days ago`
  if (days < 30)  return `${Math.floor(days / 7)} wk ago`
  return fmtDate(iso)
}

// Pre-compute the same headline numbers the post-workout summary modal shows
// (volume / total sets / total reps). Drop sets and warmups are excluded so
// the totals match the rest of the app's working-set semantics.
function summarise(sets) {
  let volumeKg = 0
  let totalSets = 0
  let totalReps = 0
  for (const s of (sets || [])) {
    if (s.is_warmup) continue
    const w = Number(s.weight_kg || 0)
    const r = Number(s.reps || 0)
    if (w > 0 && r > 0) {
      volumeKg += w * r
      totalSets += 1
      totalReps += r
    }
  }
  return { volumeKg, totalSets, totalReps }
}

export default function HistoryScreen({ user, profile, program, onBack, onViewSession }) {
  const unit  = profile?.weight_unit || 'kg'
  const label = unitLabel(unit)
  const [templates,    setTemplates]    = useState([])
  const [sessionsById, setSessionsById] = useState({}) // { [templateId]: { workout, sets } | null }
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    getTemplates(user.id)
      .then(t => {
        if (cancelled) return
        setTemplates(t)
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [user?.id])

  // Once templates land, fan out one getLastSessionForTemplateName per
  // template. Failures degrade quietly to a "No sessions yet" line.
  useEffect(() => {
    if (!user?.id || templates.length === 0) return
    let cancelled = false
    Promise.all(
      templates.map(t =>
        getLastSessionForTemplateName(t.name, user.id)
          .then(s => [t.id, s])
          .catch(() => [t.id, null])
      )
    ).then(pairs => {
      if (cancelled) return
      setSessionsById(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [user?.id, templates])

  // Sort templates by their last-session date (most recent first); templates
  // with no sessions sink to the bottom in their original order.
  const ordered = [...templates].sort((a, b) => {
    const da = sessionsById[a.id]?.workout?.completed_at
    const db = sessionsById[b.id]?.workout?.completed_at
    if (!da && !db) return 0
    if (!da) return 1
    if (!db) return -1
    return new Date(db) - new Date(da)
  })

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">History</div>
        </div>
      </header>

      <div className="content">
        {loading && (
          <div className="state-msg state-msg--empty">Loading…</div>
        )}
        {error && <div className="err-msg">{error}</div>}
        {!loading && !error && templates.length === 0 && (
          <div className="state-msg state-msg--empty">
            No saved templates yet — save a workout as a template first.
          </div>
        )}

        {ordered.map(t => {
          const last = sessionsById[t.id]
          const hasSession = !!last?.workout?.id
          const stats = hasSession ? summarise(last.sets) : null
          const volDisp = stats
            ? (unit === 'lbs' ? kgToLbs(stats.volumeKg) : stats.volumeKg)
            : 0

          return (
            <div key={t.id} className="history-card">
              <div className="history-card__head">
                <div className="history-card__name">{t.name}</div>
                {hasSession && (
                  <div className="history-card__when">{fmtRelative(last.workout.completed_at)}</div>
                )}
              </div>

              {hasSession ? (
                <>
                  <div className="history-card__stats">
                    <div className="history-card__stat">
                      <div className="history-card__stat-val">
                        {Math.round(volDisp).toLocaleString()}
                      </div>
                      <div className="history-card__stat-label">{label} lifted</div>
                    </div>
                    <div className="history-card__stat">
                      <div className="history-card__stat-val">{stats.totalSets}</div>
                      <div className="history-card__stat-label">{stats.totalSets === 1 ? 'set' : 'sets'}</div>
                    </div>
                    <div className="history-card__stat">
                      <div className="history-card__stat-val">{stats.totalReps}</div>
                      <div className="history-card__stat-label">{stats.totalReps === 1 ? 'rep' : 'reps'}</div>
                    </div>
                  </div>
                  <button
                    className="history-card__edit"
                    onClick={() => onViewSession({
                      workoutId: last.workout.id,
                      dayId:     last.workout.training_day_id,
                      blockId:   last.workout.workout_block_id,
                    })}
                  >
                    Open & edit
                  </button>
                </>
              ) : (
                <div className="history-card__empty">No sessions logged yet from this template.</div>
              )}
            </div>
          )
        })}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
