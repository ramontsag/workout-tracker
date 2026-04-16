import React, { useState } from 'react'
import { saveProgram } from '../supabase'
import { DEFAULT_DAYS } from '../data/defaultProgram'

// ─────────────────────────────────────────────────────────────
// Single day accordion card
// ─────────────────────────────────────────────────────────────
function DayCard({
  day, isOpen, onToggle, onChange,
  newInput, onNewInputChange, onAddItem,
  onRemoveItem, onMoveItem, onToggleItemType, onUpdateTarget,
}) {
  const itemCount = day.exercises.length
  const exCount   = day.exercises.filter(e => e.item_type === 'exercise').length
  const actCount  = day.exercises.filter(e => e.item_type === 'activity').length

  let countLabel = `${itemCount} item${itemCount !== 1 ? 's' : ''}`
  if (itemCount === 0)
    countLabel = 'Rest day'
  else if (exCount > 0 && actCount > 0)
    countLabel = `${exCount} exercise${exCount !== 1 ? 's' : ''}, ${actCount} activit${actCount !== 1 ? 'ies' : 'y'}`

  const isEmpty = itemCount === 0
  const dayType = isEmpty ? 'empty' : exCount >= actCount ? 'gym' : 'rest'

  return (
    <div className={`day-edit-card ${isOpen ? 'day-edit-card--open' : ''}`}>
      {/* Header — always visible */}
      <button
        className="day-edit-header"
        onClick={onToggle}
      >
        <span className={`day-edit-dot day-edit-dot--${dayType}`} />
        <span className="day-edit-name-preview">
          {day.name || 'Unnamed'}
          {day.focus ? ` — ${day.focus}` : ''}
        </span>
        <span className="day-edit-count">{countLabel}</span>
        <span className="day-edit-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>

      {/* Body — only when open */}
      {isOpen && (
        <div className="day-edit-body">

          {/* Optional focus label */}
          <div style={{ marginTop: 14 }}>
            <label className="field-label">Focus <span style={{fontWeight:400,textTransform:'none',letterSpacing:0}}>(optional)</span></label>
            <input className="field-input" value={day.focus}
              onChange={e => onChange('focus', e.target.value)}
              placeholder="e.g. Chest & Back" />
          </div>

          {/* Rest time */}
          <label className="field-label" style={{ marginTop: 14 }}>Rest Time</label>
          <select
            className="field-input"
            value={day.rest_seconds ?? 90}
            onChange={e => onChange('rest_seconds', Number(e.target.value))}
          >
            <option value={60}>60 seconds</option>
            <option value={90}>90 seconds</option>
            <option value={120}>2 minutes</option>
            <option value={180}>3 minutes</option>
            <option value={300}>5 minutes</option>
          </select>

          {/* Items list */}
          <label className="field-label" style={{ marginTop: 16 }}>Items</label>
          <div className="ex-edit-list">
            {day.exercises.map((item, j) => {
              const isActivity = item.item_type === 'activity'
              return (
                <div key={j} className="ex-edit-item">
                  <div className="ex-edit-row">
                    {/* Reorder */}
                    <div className="ex-edit-reorder">
                      <button className="reorder-btn" onClick={() => onMoveItem(j, -1)} disabled={j === 0}>↑</button>
                      <button className="reorder-btn" onClick={() => onMoveItem(j,  1)} disabled={j === day.exercises.length - 1}>↓</button>
                    </div>

                    {/* Type toggle pill */}
                    <button
                      className={`item-type-pill ${isActivity ? 'item-type-pill--act' : 'item-type-pill--ex'}`}
                      onClick={() => onToggleItemType(j)}
                      title={isActivity ? 'Switch to Exercise' : 'Switch to Activity'}
                    >
                      {isActivity ? 'Activity' : 'Exercise'}
                    </button>

                    <span className="ex-edit-name">{item.name}</span>
                    <button className="ex-edit-remove" onClick={() => onRemoveItem(j)}>×</button>
                  </div>

                  {/* Target — only for exercise items */}
                  {!isActivity && (
                    <input
                      className="ex-target-input"
                      placeholder="Target (e.g. 3 sets of 8-10 reps)"
                      value={item.target || ''}
                      onChange={e => onUpdateTarget(j, e.target.value)}
                    />
                  )}
                </div>
              )
            })}
          </div>

          {/* Add item row — defaults to Exercise */}
          <div className="ex-add-row">
            <input
              className="field-input ex-add-input"
              placeholder="Add item…"
              value={newInput}
              onChange={e => onNewInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddItem() } }}
            />
            <button className="ex-add-btn" onClick={onAddItem}>+</button>
          </div>

        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
const WEEKDAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

export default function ProgramSetup({ userId, initialDays, isEditing, onComplete, onBack }) {
  const seed = (initialDays?.length > 0 ? initialDays : DEFAULT_DAYS)
    .filter(d => WEEKDAYS.includes(d.name))
    .sort((a, b) => WEEKDAYS.indexOf(a.name) - WEEKDAYS.indexOf(b.name))

  const [days,    setDays]    = useState(() =>
    seed.map(d => ({ ...d, exercises: (d.exercises || []).map(e => ({ ...e })) }))
  )
  const [inputs,  setInputs]  = useState(() => seed.map(() => ''))
  const [openIdx, setOpenIdx] = useState(-1)   // -1 = all collapsed
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  // ── Day helpers ───────────────────────────────────────────
  const updateDay = (i, field, val) =>
    setDays(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d))

  // ── Item helpers ──────────────────────────────────────────
  const addItem = (i) => {
    const name = inputs[i]?.trim()
    if (!name) return
    setDays(prev => prev.map((d, idx) =>
      idx === i ? { ...d, exercises: [...d.exercises, { name, target: '', item_type: 'exercise' }] } : d
    ))
    setInputs(prev => prev.map((v, idx) => idx === i ? '' : v))
  }

  const removeItem = (dayIdx, itemIdx) =>
    setDays(prev => prev.map((d, i) =>
      i === dayIdx ? { ...d, exercises: d.exercises.filter((_, j) => j !== itemIdx) } : d
    ))

  const moveItem = (dayIdx, itemIdx, dir) =>
    setDays(prev => prev.map((d, i) => {
      if (i !== dayIdx) return d
      const items  = [...d.exercises]
      const target = itemIdx + dir
      if (target < 0 || target >= items.length) return d
      ;[items[itemIdx], items[target]] = [items[target], items[itemIdx]]
      return { ...d, exercises: items }
    }))

  const toggleItemType = (dayIdx, itemIdx) =>
    setDays(prev => prev.map((d, i) =>
      i !== dayIdx ? d : {
        ...d,
        exercises: d.exercises.map((item, j) =>
          j !== itemIdx ? item : {
            ...item,
            item_type: item.item_type === 'exercise' ? 'activity' : 'exercise',
            target:    item.item_type === 'exercise' ? '' : item.target, // clear target when switching to activity
          }
        ),
      }
    ))

  const updateTarget = (dayIdx, itemIdx, target) =>
    setDays(prev => prev.map((d, i) =>
      i !== dayIdx ? d : {
        ...d,
        exercises: d.exercises.map((item, j) => j === itemIdx ? { ...item, target } : item),
      }
    ))

  // ── Save ──────────────────────────────────────────────────
  const handleSave = async () => {
    setError('')
    for (const d of days) {
      if (!d.name.trim())           { setError('Every day needs a name.');             return }
      if (d.exercises.some(e => !e.name?.trim())) { setError(`"${d.name}" has a blank item.`); return }
    }
    setSaving(true)
    try {
      await saveProgram(days, userId)
      await onComplete()
    } catch (e) {
      setError(e?.message || 'Save failed — please try again.')
      setSaving(false)
    }
  }

  return (
    <div className="screen">
      <header className="setup-header">
        {onBack && <button className="back-btn" onClick={onBack}>←</button>}
        <div className="setup-header__text">
          <div className="setup-header__title">
            {isEditing ? 'Edit Program' : 'Set Up Your Program'}
          </div>
          <div className="setup-header__sub">
            {isEditing ? 'Tap a day to expand it' : 'Pre-filled with defaults — edit freely'}
          </div>
        </div>
        <button className="setup-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? '…' : 'Save'}
        </button>
      </header>

      <div className="content" style={{ paddingTop: 8 }}>
        {error && <p className="err-msg" style={{ margin: '0 0 8px' }}>{error}</p>}

        {days.map((day, i) => (
          <DayCard
            key={i}
            day={day}
            isOpen={openIdx === i}
            onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
            onChange={(field, val) => updateDay(i, field, val)}
            newInput={inputs[i] || ''}
            onNewInputChange={val => setInputs(prev => prev.map((v, idx) => idx === i ? val : v))}
            onAddItem={() => addItem(i)}
            onRemoveItem={itemIdx => removeItem(i, itemIdx)}
            onMoveItem={(itemIdx, dir) => moveItem(i, itemIdx, dir)}
            onToggleItemType={itemIdx => toggleItemType(i, itemIdx)}
            onUpdateTarget={(itemIdx, target) => updateTarget(i, itemIdx, target)}
          />
        ))}

        {error && <p className="err-msg">{error}</p>}
        <button className="complete-btn" style={{ marginTop: 8 }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Program & Start Training'}
        </button>
        <div style={{ height: 48 }} />
      </div>
    </div>
  )
}
