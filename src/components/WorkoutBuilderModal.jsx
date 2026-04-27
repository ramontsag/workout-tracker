import React, { useState, useEffect } from 'react'
import { createWorkoutBlock, getTemplates } from '../supabase'

// Modal for creating a new workout block on a day. Asks for a name and
// optionally seeds exercises from one of the user's saved templates.
//
// Props:
//   - open: boolean
//   - dayId: training_day_id where the block will live
//   - userId
//   - onClose
//   - onCreated(block): called with the new block { id, name } once saved
export default function WorkoutBuilderModal({ open, dayId, userId, onClose, onCreated }) {
  const [name, setName]               = useState('')
  const [mode, setMode]               = useState('blank')   // 'blank' | 'template'
  const [templates, setTemplates]     = useState([])
  const [selectedTpl, setSelectedTpl] = useState(null)
  const [tplLoading, setTplLoading]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (!open) return
    setName('')
    setMode('blank')
    setSelectedTpl(null)
    setError('')
  }, [open])

  useEffect(() => {
    if (!open || mode !== 'template' || !userId) return
    if (templates.length > 0) return
    setTplLoading(true)
    getTemplates(userId)
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setTplLoading(false))
  }, [open, mode, userId, templates.length])

  if (!open) return null

  const handleSave = async () => {
    const trimmed = (name || '').trim()
    if (!trimmed) { setError('Name your workout first'); return }
    if (mode === 'template' && !selectedTpl) { setError('Pick a template, or switch to Blank'); return }
    setSaving(true)
    setError('')
    try {
      const block = await createWorkoutBlock(
        dayId,
        trimmed,
        userId,
        mode === 'template' ? { fromTemplateId: selectedTpl } : {},
      )
      onCreated && onCreated(block)
      onClose && onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  // When user picks a template, prefill the name from it (saves a tap).
  const handlePickTemplate = (t) => {
    setSelectedTpl(t.id)
    if (!name.trim()) setName(t.name || '')
    setError('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card builder-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Add a workout</h3>

        <label className="field-label">Workout name</label>
        <input
          className="field-input"
          placeholder="e.g. Chest & Back"
          value={name}
          onChange={e => { setName(e.target.value); setError('') }}
          autoFocus
        />

        <div className="builder-tabs">
          <button
            type="button"
            className={`builder-tab${mode === 'blank' ? ' builder-tab--on' : ''}`}
            onClick={() => setMode('blank')}
          >Start blank</button>
          <button
            type="button"
            className={`builder-tab${mode === 'template' ? ' builder-tab--on' : ''}`}
            onClick={() => setMode('template')}
          >From template</button>
        </div>

        {mode === 'blank' && (
          <div className="builder-hint">
            Creates an empty workout. You'll add exercises one by one on the next screen.
          </div>
        )}

        {mode === 'template' && (
          <div className="builder-templates">
            {tplLoading && <div className="state-msg state-msg--empty">Loading…</div>}
            {!tplLoading && templates.length === 0 && (
              <div className="state-msg state-msg--empty">
                No saved templates yet. Save a workout as a template from Edit Day, then come back.
              </div>
            )}
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                className={`builder-template${selectedTpl === t.id ? ' builder-template--on' : ''}`}
                onClick={() => handlePickTemplate(t)}
              >
                <span className="builder-template__name">{t.name}</span>
                <span className="builder-template__count">
                  {(t.exercises || []).length} exercise{(t.exercises || []).length === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="err-msg" style={{ marginTop: 8 }}>{error}</div>}

        <div className="modal-actions">
          <button
            className="modal-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >{saving ? 'Saving…' : 'Save workout'}</button>
          <button className="modal-btn-cancel" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
