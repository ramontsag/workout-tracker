import React, { useState, useEffect } from 'react'
import { saveMainLifts, getAllKnownExerciseNames } from '../supabase'

// Sheet modal for picking the user's "main lifts" — each slot is a free-text
// label paired with an exercise from their catalog/history. The Strength tab
// computes its score from whatever's saved here.
//
// Props:
//   - open: boolean
//   - initialSlots: [{ slot, exercise }]
//   - userId
//   - onClose: () => void
//   - onSaved: (slots) => void   parent should refresh the Strength tab data
const MAX_SLOTS = 6
const SUGGESTED_LABELS = ['Squat', 'Bench', 'Deadlift', 'Overhead Press', 'Row', 'Pull-up']

export default function MainLiftsSetup({ open, initialSlots, userId, onClose, onSaved }) {
  const [slots,   setSlots]   = useState([])
  const [known,   setKnown]   = useState([])
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  useEffect(() => {
    if (!open) return
    // Seed the working copy from props every time the sheet opens.
    setSlots(
      Array.isArray(initialSlots) && initialSlots.length
        ? initialSlots.map(s => ({ slot: s.slot || '', exercise: s.exercise || '' }))
        : [{ slot: 'Squat', exercise: '' }]
    )
    setError('')
    if (userId) {
      getAllKnownExerciseNames(userId).then(setKnown).catch(() => setKnown([]))
    }
  }, [open, initialSlots, userId])

  if (!open) return null

  const updateSlot = (idx, fields) =>
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...fields } : s))

  const removeSlot = (idx) =>
    setSlots(prev => prev.filter((_, i) => i !== idx))

  const addSlot = () => {
    if (slots.length >= MAX_SLOTS) return
    // Suggest a label not already in use.
    const used = new Set(slots.map(s => s.slot.toLowerCase()))
    const next = SUGGESTED_LABELS.find(l => !used.has(l.toLowerCase())) || `Lift ${slots.length + 1}`
    setSlots(prev => [...prev, { slot: next, exercise: '' }])
  }

  const moveSlot = (idx, dir) =>
    setSlots(prev => {
      const arr = [...prev]
      const t = idx + dir
      if (t < 0 || t >= arr.length) return prev
      ;[arr[idx], arr[t]] = [arr[t], arr[idx]]
      return arr
    })

  const handleSave = async () => {
    const cleaned = slots
      .map(s => ({ slot: (s.slot || '').trim(), exercise: (s.exercise || '').trim() }))
    if (cleaned.length === 0) {
      setError('Add at least one lift')
      return
    }
    if (cleaned.some(s => !s.slot)) {
      setError('Every slot needs a name')
      return
    }
    if (cleaned.some(s => !s.exercise)) {
      setError('Pick an exercise for every slot')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await saveMainLifts(cleaned, userId)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">Main lifts</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="edit-day-body">
          <div className="field-label-hint" style={{ marginBottom: 12 }}>
            Pick 1–6 lifts to track on the Strength tab. Each slot pairs a name (Bench, Squat…) with one exercise from your catalog.
          </div>

          <div className="edit-day-items">
            {slots.map((s, idx) => (
              <div key={idx} className="ex-edit-item">
                <div className="ex-edit-row">
                  <div className="ex-edit-reorder">
                    <button className="reorder-btn" onClick={() => moveSlot(idx, -1)} disabled={idx === 0}>↑</button>
                    <button className="reorder-btn" onClick={() => moveSlot(idx,  1)} disabled={idx === slots.length - 1}>↓</button>
                  </div>
                  <input
                    className="field-input"
                    style={{ flex: '0 1 110px', padding: '6px 10px', fontSize: 13 }}
                    placeholder="Slot name"
                    value={s.slot}
                    onChange={e => updateSlot(idx, { slot: e.target.value })}
                  />
                  <select
                    className="field-input"
                    style={{ flex: 1, padding: '6px 10px', fontSize: 13, minWidth: 0 }}
                    value={s.exercise}
                    onChange={e => updateSlot(idx, { exercise: e.target.value })}
                  >
                    <option value="">— pick exercise —</option>
                    {known.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <button
                    className="ex-edit-remove"
                    onClick={() => removeSlot(idx)}
                    disabled={slots.length <= 1}
                    title={slots.length <= 1 ? 'At least one slot required' : 'Remove'}
                  >×</button>
                </div>
              </div>
            ))}
          </div>

          <div className="edit-day-add-row" style={{ marginTop: 12 }}>
            <button
              className="ex-browse-btn"
              onClick={addSlot}
              disabled={slots.length >= MAX_SLOTS}
            >
              + Add slot {slots.length >= MAX_SLOTS ? '(max 6)' : ''}
            </button>
          </div>

          {error && <p className="err-msg">{error}</p>}
        </div>

        <div className="picker-create">
          <button className="picker-create-btn" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save main lifts'}
          </button>
        </div>
      </div>
    </div>
  )
}
