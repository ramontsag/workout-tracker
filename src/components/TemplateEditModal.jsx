import React, { useEffect, useMemo, useState } from 'react'
import { updateTemplate, getAllKnownExerciseNames } from '../supabase'
import { EXERCISE_CATALOG } from '../data/exerciseCatalog'
import CatalogPickerModal from './CatalogPickerModal'

// Edit a saved template's name and exercise list. Mirrors the look of the
// day-edit flow but stripped to template fundamentals: no rest, blocks,
// track-mode or set-count — those are day-level. Targets are kept since
// they belong to the exercise on the template.
//
// Props:
//   - open: boolean
//   - template: { id, name, exercises: [{ exercise_name, target, item_type, sort_order }] }
//   - userId
//   - onClose: () => void
//   - onSaved: (updatedTemplate) => void   parent reloads after save
export default function TemplateEditModal({ open, template, userId, onClose, onSaved }) {
  const [name, setName]               = useState('')
  const [items, setItems]             = useState([])  // [{ name, target, item_type }]
  const [pickerOpen, setPickerOpen]   = useState(false)
  const [knownNames, setKnownNames]   = useState([])
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  useEffect(() => {
    if (!open || !template) return
    setName(template.name || '')
    setItems(
      (template.exercises || [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(e => ({
          name:      e.exercise_name,
          target:    e.target || '',
          item_type: e.item_type || 'exercise',
        }))
    )
    setError('')
  }, [open, template])

  useEffect(() => {
    if (!open || !userId) return
    getAllKnownExerciseNames(userId).then(setKnownNames).catch(() => {})
  }, [open, userId])

  // Lower-cased names already in this template — passed to the picker so
  // duplicates are visually disabled.
  const existingLower = useMemo(
    () => items.map(it => (it.name || '').toLowerCase()),
    [items]
  )

  if (!open || !template) return null

  const move = (idx, dir) => {
    const j = idx + dir
    if (j < 0 || j >= items.length) return
    setItems(prev => {
      const next = prev.slice()
      const [it] = next.splice(idx, 1)
      next.splice(j, 0, it)
      return next
    })
  }

  const remove = (idx) => {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  const updateItem = (idx, field, val) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  }

  const handlePick = (pickedName) => {
    setItems(prev => [...prev, { name: pickedName, target: '', item_type: 'exercise' }])
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name your template'); return }
    setSaving(true)
    setError('')
    try {
      await updateTemplate(template.id, name.trim(), items, userId)
      onSaved && await onSaved()
      onClose && onClose()
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card template-edit-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Edit saved workout</h3>

        <label className="field-label">Name</label>
        <input
          className="field-input"
          value={name}
          onChange={e => { setName(e.target.value); setError('') }}
          placeholder="Template name"
          autoFocus
        />

        <div className="template-edit-list">
          {items.length === 0 && (
            <div className="state-msg state-msg--empty">
              No exercises yet — tap "Add exercise" below.
            </div>
          )}
          {items.map((it, i) => (
            <div key={`${it.name}-${i}`} className="template-edit-row">
              <div className="template-edit-row__main">
                <div className="template-edit-row__name">{it.name}</div>
                <input
                  className="field-input template-edit-row__target"
                  value={it.target}
                  onChange={e => updateItem(i, 'target', e.target.value)}
                  placeholder="Target (e.g. 3×8 @ RPE 8)"
                />
              </div>
              <div className="template-edit-row__actions">
                <button
                  type="button"
                  className="template-edit-row__btn"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >↑</button>
                <button
                  type="button"
                  className="template-edit-row__btn"
                  onClick={() => move(i, +1)}
                  disabled={i === items.length - 1}
                  aria-label="Move down"
                >↓</button>
                <button
                  type="button"
                  className="template-edit-row__btn template-edit-row__btn--danger"
                  onClick={() => remove(i)}
                  aria-label="Remove"
                >×</button>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="template-edit-add-btn"
          onClick={() => setPickerOpen(true)}
        >+ Add exercise</button>

        {error && <div className="err-msg" style={{ marginTop: 8 }}>{error}</div>}

        <div className="modal-actions">
          <button
            className="modal-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >{saving ? 'Saving…' : 'Save changes'}</button>
          <button
            className="modal-btn-cancel"
            onClick={onClose}
            disabled={saving}
          >Cancel</button>
        </div>
      </div>

      <CatalogPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={handlePick}
        catalog={EXERCISE_CATALOG}
        userKnownNames={knownNames}
        existingNames={items.map(it => it.name)}
        title="Add exercise"
        yourGroupLabel="Your exercises"
        kind="workout"
      />
    </div>
  )
}
