import React, { useState, useEffect, useMemo } from 'react'
import { saveProgram, getAllKnownExerciseNames } from '../supabase'
import {
  FIELD_CATALOG, DEFAULT_ACTIVITY_FIELDS, defaultFieldsFor,
} from '../data/commonActivities'
import { EXERCISE_CATALOG } from '../data/exerciseCatalog'
import { ACTIVITY_CATALOG } from '../data/activityCatalog'
import { DAY_COLORS } from '../data/defaultProgram'
import CatalogPickerModal from './CatalogPickerModal'

// Per-day editor sheet. Replaces the old Edit Program screen.
// Reachable from: each day's gear icon on Home, the gear icon in the
// Workout header. Saves the full program via saveProgram() so the parent
// can re-fetch and reflect the new state.
//
// Props:
//   - open: boolean
//   - onClose: () => void
//   - day: the day object being edited (must include id, name, focus, color,
//     rest_seconds, exercises[])
//   - program: full program array (saveProgram requires it)
//   - userId: current user id
//   - onSaved: () => Promise<void>  parent should reload program after save
export default function EditDayModal({ open, onClose, day, program, userId, onSaved }) {
  // Local working copy — mutated freely until Save.
  const [draft, setDraft] = useState(() => cloneDay(day))
  const [pickerKind, setPickerKind] = useState(null)  // null | 'exercise' | 'activity'
  const [knownNames, setKnownNames] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  useEffect(() => {
    if (open) setDraft(cloneDay(day))
  }, [open, day])

  useEffect(() => {
    if (!userId || !open) return
    getAllKnownExerciseNames(userId)
      .then(setKnownNames)
      .catch(() => {})
  }, [userId, open])

  const itemCount = draft.exercises.length

  const update = (field, val) =>
    setDraft(prev => ({ ...prev, [field]: val }))

  const updateItem = (idx, fields) =>
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.map((it, i) => i === idx ? { ...it, ...fields } : it),
    }))

  const removeItem = (idx) =>
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== idx),
    }))

  const moveItem = (idx, dir) =>
    setDraft(prev => {
      const items = [...prev.exercises]
      const t = idx + dir
      if (t < 0 || t >= items.length) return prev
      ;[items[idx], items[t]] = [items[t], items[idx]]
      return { ...prev, exercises: items }
    })

  const addExercise = (name) =>
    setDraft(prev => ({
      ...prev,
      exercises: [...prev.exercises, {
        name, target: '', item_type: 'exercise', track_mode: 'sets', set_count: null,
      }],
    }))

  const addActivity = (name) =>
    setDraft(prev => ({
      ...prev,
      exercises: [...prev.exercises, {
        name, target: '', item_type: 'activity',
        activity_fields: defaultFieldsFor(name),
      }],
    }))

  const toggleTrackMode = (idx) =>
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.map((it, i) => {
        if (i !== idx || it.item_type === 'activity') return it
        const becomingCheck = it.track_mode !== 'check'
        return {
          ...it,
          track_mode: becomingCheck ? 'check' : 'sets',
          set_count:  becomingCheck ? (it.set_count ?? 1) : null,
        }
      }),
    }))

  const setSetCount = (idx, n) =>
    updateItem(idx, { set_count: Math.max(1, Math.min(10, n)) })

  const toggleActivityField = (idx, key) =>
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.map((it, i) => {
        if (i !== idx) return it
        const cur = it.activity_fields || DEFAULT_ACTIVITY_FIELDS
        const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]
        return { ...it, activity_fields: next }
      }),
    }))

  // Catalog the picker should browse based on which add button was tapped.
  const pickerCatalog = pickerKind === 'activity' ? ACTIVITY_CATALOG : EXERCISE_CATALOG
  const pickerTitle   = pickerKind === 'activity' ? 'Add activity' : 'Add exercise'
  const pickerCreate  = pickerKind === 'activity' ? '+ Create your own activity' : '+ Create your own exercise'
  const pickerYour    = pickerKind === 'activity' ? 'Your activities' : 'Your exercises'
  const pickerOnPick  = pickerKind === 'activity' ? addActivity : addExercise

  const handleSave = async () => {
    if (!userId || !day) return
    setSaving(true)
    setError('')
    try {
      // Merge our edited day back into the program, preserving the rest.
      const merged = program.map(d => d.id === day.id ? { ...draft } : d)
      await saveProgram(merged, userId)
      await onSaved?.()
      onClose()
    } catch (e) {
      setError(e?.message || 'Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-sheet edit-day-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">{draft.name}</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="edit-day-body">
          {/* Focus */}
          <label className="field-label">Focus <span className="field-label-hint">optional</span></label>
          <input
            className="field-input"
            value={draft.focus || ''}
            onChange={e => update('focus', e.target.value)}
            placeholder="e.g. Chest & Back"
          />

          {/* Color */}
          <label className="field-label" style={{ marginTop: 14 }}>Color</label>
          <div className="color-swatches">
            {DAY_COLORS.map(c => (
              <button
                key={c}
                type="button"
                className={`color-swatch${draft.color === c ? ' color-swatch--on' : ''}`}
                style={{ background: c }}
                onClick={() => update('color', c)}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>

          {/* Rest seconds */}
          <label className="field-label" style={{ marginTop: 14 }}>Rest between sets</label>
          <div className="rest-stepper">
            <button
              type="button"
              className="set-count-btn"
              onClick={() => update('rest_seconds', Math.max(30, (draft.rest_seconds ?? 90) - 15))}
            >−</button>
            <span className="rest-stepper-val">{formatRest(draft.rest_seconds ?? 90)}</span>
            <button
              type="button"
              className="set-count-btn"
              onClick={() => update('rest_seconds', Math.min(600, (draft.rest_seconds ?? 90) + 15))}
            >+</button>
          </div>

          {/* Items list */}
          <label className="field-label" style={{ marginTop: 18 }}>
            Items <span className="field-label-hint">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
          </label>
          {draft.exercises.length === 0 && (
            <div className="edit-day-empty">No items yet. Add an exercise or an activity below.</div>
          )}
          <div className="edit-day-items">
            {draft.exercises.map((item, idx) => {
              const isActivity = item.item_type === 'activity'
              const isCheck    = !isActivity && item.track_mode === 'check'
              return (
                <div key={idx} className="ex-edit-item">
                  <div className="ex-edit-row">
                    <div className="ex-edit-reorder">
                      <button className="reorder-btn" onClick={() => moveItem(idx, -1)} disabled={idx === 0}>↑</button>
                      <button className="reorder-btn" onClick={() => moveItem(idx,  1)} disabled={idx === draft.exercises.length - 1}>↓</button>
                    </div>
                    <span className={`item-type-pill ${isActivity ? 'item-type-pill--act' : 'item-type-pill--ex'}`}>
                      {isActivity ? 'Activity' : 'Exercise'}
                    </span>
                    {!isActivity && (
                      <button
                        className={`item-track-pill ${isCheck ? 'item-track-pill--check' : 'item-track-pill--track'}`}
                        onClick={() => toggleTrackMode(idx)}
                        title={isCheck ? 'Switch to Track' : 'Switch to Check'}
                      >
                        {isCheck ? 'Check' : 'Track'}
                      </button>
                    )}
                    <span className="ex-edit-name">{item.name}</span>
                    <button className="ex-edit-remove" onClick={() => removeItem(idx)}>×</button>
                  </div>

                  {!isActivity && !isCheck && (
                    <input
                      className="ex-target-input"
                      placeholder="Target (e.g. 3 sets of 8-10 reps)"
                      value={item.target || ''}
                      onChange={e => updateItem(idx, { target: e.target.value })}
                    />
                  )}
                  {!isActivity && isCheck && (
                    <div className="set-count-row">
                      <span className="set-count-label">Sets</span>
                      <button type="button" className="set-count-btn" onClick={() => setSetCount(idx, (item.set_count ?? 1) - 1)}>−</button>
                      <span className="set-count-value">{item.set_count ?? 1}</span>
                      <button type="button" className="set-count-btn" onClick={() => setSetCount(idx, (item.set_count ?? 1) + 1)}>+</button>
                    </div>
                  )}
                  {isActivity && (
                    <div className="activity-fields-picker">
                      {FIELD_CATALOG.map(f => {
                        const active = (item.activity_fields || DEFAULT_ACTIVITY_FIELDS).includes(f.key)
                        return (
                          <button
                            key={f.key}
                            type="button"
                            className={`activity-field-pill${active ? ' activity-field-pill--on' : ''}`}
                            onClick={() => toggleActivityField(idx, f.key)}
                          >
                            {f.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add buttons */}
          <div className="edit-day-add-row">
            <button className="ex-browse-btn" onClick={() => setPickerKind('exercise')}>+ Add exercise</button>
            <button className="ex-browse-btn ex-browse-btn--alt" onClick={() => setPickerKind('activity')}>+ Add activity</button>
          </div>

          {error && <p className="err-msg">{error}</p>}
        </div>

        <div className="picker-create">
          <button className="picker-create-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      {pickerKind && (
        <CatalogPickerModal
          open
          onClose={() => setPickerKind(null)}
          onPick={pickerOnPick}
          catalog={pickerCatalog}
          userKnownNames={knownNames}
          existingNames={draft.exercises.map(e => e.name)}
          title={pickerTitle}
          createLabel={pickerCreate}
          createPlaceholder={pickerKind === 'activity' ? 'Activity name' : 'Exercise name'}
          yourGroupLabel={pickerYour}
        />
      )}
    </div>
  )
}

function cloneDay(day) {
  if (!day) return { id: null, name: '', focus: '', color: '#64748b', rest_seconds: 90, exercises: [] }
  return {
    ...day,
    exercises: (day.exercises || []).map(e => ({ ...e })),
  }
}

function formatRest(s) {
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, '0')}`
  }
  return `${s}s`
}
