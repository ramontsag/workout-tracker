import React, { useState, useEffect } from 'react'
import { getTemplates, deleteTemplate, applyTemplate, getLastSessionForTemplateName } from '../supabase'

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtRelative(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days} days ago`
  if (days < 30)  return `${Math.floor(days / 7)} wk ago`
  return fmtDate(iso)
}

export default function ArchivesScreen({ user, program, onBack, onProgramUpdated, onViewSession }) {
  const [templates,   setTemplates]   = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [expandedId,  setExpandedId]  = useState(null)
  const [applyState,  setApplyState]  = useState({}) // { [id]: { dayId, saving, done, error } }
  const [deletingId,  setDeletingId]  = useState(null)
  const [confirmId,   setConfirmId]   = useState(null) // id awaiting delete confirm
  // Per-template last-session info: { [templateId]: { workout, sets } | null }.
  // Loaded lazily once templates list arrives so the page paints fast.
  const [lastSessions, setLastSessions] = useState({})

  useEffect(() => {
    if (!user?.id) return
    getTemplates(user.id)
      .then(t => { setTemplates(t); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [user?.id])

  // Load each template's most-recent completed session so the card can show
  // "Last performed: 2 days ago — N sets". Failures degrade quietly to no
  // history line on that card.
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
      setLastSessions(Object.fromEntries(pairs))
    })
    return () => { cancelled = true }
  }, [user?.id, templates])

  const handleDelete = async (id) => {
    setDeletingId(id)
    setConfirmId(null)
    try {
      await deleteTemplate(id)
      setTemplates(prev => prev.filter(t => t.id !== id))
      if (expandedId === id) setExpandedId(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setDeletingId(null)
    }
  }

  const handleApply = async (templateId) => {
    const state = applyState[templateId] || {}
    if (!state.dayId) return
    setApplyState(prev => ({ ...prev, [templateId]: { ...state, saving: true, error: '' } }))
    try {
      await applyTemplate(templateId, state.dayId, user.id)
      await onProgramUpdated()
      setApplyState(prev => ({ ...prev, [templateId]: { ...state, saving: false, done: true } }))
    } catch (e) {
      setApplyState(prev => ({ ...prev, [templateId]: { ...state, saving: false, error: e.message } }))
    }
  }

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Saved Workouts</div>
        </div>
      </header>

      <div className="content">
        {loading && (
          <div className="state-msg state-msg--empty">Loading…</div>
        )}
        {error && (
          <div className="err-msg">{error}</div>
        )}
        {!loading && !error && templates.length === 0 && (
          <div className="state-msg state-msg--empty">
            No saved workouts yet — open a workout and tap "Save"
          </div>
        )}

        {templates.map(t => {
          const isOpen   = expandedId === t.id
          const apply    = applyState[t.id] || {}
          const exCount  = t.exercises.length
          const isDeleting = deletingId === t.id
          const isConfirming = confirmId === t.id

          return (
            <div key={t.id} className="archive-card">
              <button
                className="archive-card-header"
                onClick={() => setExpandedId(isOpen ? null : t.id)}
              >
                <div className="archive-card-info">
                  <span className="archive-card-name">{t.name}</span>
                  <span className="archive-card-meta">
                    {exCount} item{exCount !== 1 ? 's' : ''} · {fmtDate(t.created_at)}
                  </span>
                  {(() => {
                    const last = lastSessions[t.id]
                    if (!last?.workout?.completed_at) return null
                    const setCount = (last.sets || []).filter(s => !s.is_warmup).length
                    return (
                      <span className="archive-card-last">
                        Last: {fmtRelative(last.workout.completed_at)} · {setCount} set{setCount === 1 ? '' : 's'}
                      </span>
                    )
                  })()}
                </div>
                <span className="archive-card-chevron">{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && (
                <div className="archive-card-body">
                  <ul className="archive-ex-list">
                    {t.exercises.map((e, i) => (
                      <li key={i} className="archive-ex-item">
                        <span className={`archive-ex-pill${e.item_type === 'activity' ? ' archive-ex-pill--act' : ''}`}>
                          {e.item_type === 'activity' ? 'A' : 'E'}
                        </span>
                        <span className="archive-ex-name">{e.exercise_name}</span>
                        {e.target && (
                          <span className="archive-ex-target">{e.target}</span>
                        )}
                      </li>
                    ))}
                  </ul>

                  {(() => {
                    const last = lastSessions[t.id]
                    if (!last?.workout?.id || !onViewSession) return null
                    return (
                      <button
                        className="archive-history-btn"
                        onClick={() => onViewSession({
                          workoutId: last.workout.id,
                          dayId:     last.workout.training_day_id,
                          blockId:   last.workout.workout_block_id,
                        })}
                      >
                        View last session ({fmtRelative(last.workout.completed_at)})
                      </button>
                    )
                  })()}

                  <div className="archive-apply-row">
                    <select
                      className="field-input archive-day-select"
                      value={apply.dayId || ''}
                      onChange={e => setApplyState(prev => ({
                        ...prev,
                        [t.id]: { ...apply, dayId: e.target.value, done: false, error: '' },
                      }))}
                    >
                      <option value="">Add to day…</option>
                      {program.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.name}{d.focus ? ` — ${d.focus}` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      className="archive-apply-btn"
                      onClick={() => handleApply(t.id)}
                      disabled={!apply.dayId || apply.saving || apply.done}
                    >
                      {apply.saving ? '…' : apply.done ? '✓ Added' : 'Add'}
                    </button>
                  </div>
                  <div className="archive-apply-hint">
                    Adds this workout as a new block on the chosen day — your existing exercises and activities stay.
                  </div>
                  {apply.error && (
                    <div className="err-msg" style={{ marginTop: 4 }}>{apply.error}</div>
                  )}

                  <div className="archive-delete-row">
                    {!isConfirming && (
                      <button
                        className="archive-delete-btn"
                        onClick={() => setConfirmId(t.id)}
                        disabled={isDeleting}
                      >
                        Delete
                      </button>
                    )}
                    {isConfirming && (
                      <>
                        <span className="archive-confirm-label">Delete "{t.name}"?</span>
                        <button
                          className="archive-delete-btn archive-delete-btn--confirm"
                          onClick={() => handleDelete(t.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? 'Deleting…' : 'Yes, delete'}
                        </button>
                        <button
                          className="archive-cancel-inline-btn"
                          onClick={() => setConfirmId(null)}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div style={{ height: 48 }} />
      </div>
    </div>
  )
}
