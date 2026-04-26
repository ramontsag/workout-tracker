import React, { useState, useEffect } from 'react'
import { saveProgram, getAllKnownExerciseNames } from '../supabase'
import { DEFAULT_DAYS, EMPTY_DAYS, OWNER_EMAIL } from '../data/defaultProgram'
import {
  CURATED_ACTIVITIES, FIELD_CATALOG, defaultFieldsFor, DEFAULT_ACTIVITY_FIELDS,
} from '../data/commonActivities'
import { EXERCISE_CATALOG, CATALOG_NAMES } from '../data/exerciseCatalog'
import ExercisePickerModal from './ExercisePickerModal'

// ─────────────────────────────────────────────────────────────
// Single day accordion card
// ─────────────────────────────────────────────────────────────
function DayCard({
  day, isOpen, onToggle, onChange,
  newInput, onNewInputChange, onAddItem, onAddItemWithName,
  onRemoveItem, onMoveItem, onToggleItemType, onUpdateTarget, onToggleActivityField,
  onToggleTrackMode, onUpdateSetCount, onOpenPicker,
  suggestions,
}) {
  const [showSuggest, setShowSuggest] = useState(false)

  // Existing names on this day (case-insensitive) — exclude from autocomplete
  const existingLower = new Set(day.exercises.map(e => (e.name || '').toLowerCase()))
  const q = newInput.trim().toLowerCase()
  const matches = q
    ? suggestions
        .filter(n => n.toLowerCase().includes(q) && !existingLower.has(n.toLowerCase()))
        .slice(0, 6)
    : []
  const shouldShow = showSuggest && matches.length > 0
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
              const isCheck    = !isActivity && item.track_mode === 'check'
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

                    {/* Track / Check toggle — only for exercise items */}
                    {!isActivity && (
                      <button
                        className={`item-track-pill ${isCheck ? 'item-track-pill--check' : 'item-track-pill--track'}`}
                        onClick={() => onToggleTrackMode(j)}
                        title={isCheck ? 'Switch to Track (sets · reps · weight)' : 'Switch to Check (just tick off)'}
                      >
                        {isCheck ? 'Check' : 'Track'}
                      </button>
                    )}

                    <span className="ex-edit-name">{item.name}</span>
                    <button className="ex-edit-remove" onClick={() => onRemoveItem(j)}>×</button>
                  </div>

                  {/* Track-mode → free-form target text */}
                  {!isActivity && !isCheck && (
                    <input
                      className="ex-target-input"
                      placeholder="Target (e.g. 3 sets of 8-10 reps)"
                      value={item.target || ''}
                      onChange={e => onUpdateTarget(j, e.target.value)}
                    />
                  )}

                  {/* Check-mode → numeric Sets stepper */}
                  {!isActivity && isCheck && (
                    <div className="set-count-row">
                      <span className="set-count-label">Sets</span>
                      <button
                        type="button"
                        className="set-count-btn"
                        onClick={() => onUpdateSetCount(j, Math.max(1, (item.set_count ?? 1) - 1))}
                        aria-label="Fewer sets"
                      >−</button>
                      <span className="set-count-value">{item.set_count ?? 1}</span>
                      <button
                        type="button"
                        className="set-count-btn"
                        onClick={() => onUpdateSetCount(j, Math.min(10, (item.set_count ?? 1) + 1))}
                        aria-label="More sets"
                      >+</button>
                    </div>
                  )}

                  {/* Field picker — only for activity items */}
                  {isActivity && (
                    <div className="activity-fields-picker">
                      {FIELD_CATALOG.map(f => {
                        const active = (item.activity_fields || DEFAULT_ACTIVITY_FIELDS).includes(f.key)
                        return (
                          <button
                            key={f.key}
                            type="button"
                            className={`activity-field-pill${active ? ' activity-field-pill--on' : ''}`}
                            onClick={() => onToggleActivityField(j, f.key)}
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

          {/* Add item — Browse opens the categorized picker; the input
              still works for power users who type fast. */}
          <button
            type="button"
            className="ex-browse-btn"
            onClick={onOpenPicker}
          >
            + Browse exercises
          </button>

          <div className="ex-add-wrap">
            <div className="ex-add-row">
              <input
                className="field-input ex-add-input"
                placeholder="…or type a name"
                value={newInput}
                onChange={e => { onNewInputChange(e.target.value); setShowSuggest(true) }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAddItem(); setShowSuggest(false) } }}
              />
              <button className="ex-add-btn" onClick={onAddItem}>+</button>
            </div>
            {shouldShow && (
              <div className="autocomplete-list">
                {matches.map(name => (
                  <button
                    key={name}
                    type="button"
                    className="autocomplete-item"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { onAddItemWithName(name); setShowSuggest(false) }}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
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

export default function ProgramSetup({ userId, userEmail, initialDays, isEditing, onComplete, onBack }) {
  // Fresh accounts: owner gets the personal default, everyone else starts blank.
  const fallback = (userEmail || '').toLowerCase() === OWNER_EMAIL.toLowerCase()
    ? DEFAULT_DAYS
    : EMPTY_DAYS
  const seed = (initialDays?.length > 0 ? initialDays : fallback)
    .filter(d => WEEKDAYS.includes(d.name))
    .sort((a, b) => WEEKDAYS.indexOf(a.name) - WEEKDAYS.indexOf(b.name))

  const [days,    setDays]    = useState(() =>
    seed.map(d => ({ ...d, exercises: (d.exercises || []).map(e => ({ ...e })) }))
  )
  const [inputs,  setInputs]  = useState(() => seed.map(() => ''))
  const [openIdx, setOpenIdx] = useState(-1)   // -1 = all collapsed
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [pickerForDay, setPickerForDay] = useState(null)  // dayIdx | null
  const [knownNames, setKnownNames] = useState([])        // user's own names only

  useEffect(() => {
    if (!userId) return
    getAllKnownExerciseNames(userId)
      .then(names => {
        setKnownNames(names || [])
        // Merge the user's own program/history names with the curated
        // catalog of common exercises and the curated activities list.
        // Dedupe case-insensitively — user's own casing wins because it
        // comes first in the array.
        const seen = new Map()
        for (const n of [...names, ...CATALOG_NAMES, ...CURATED_ACTIVITIES]) {
          const k = n.toLowerCase()
          if (!seen.has(k)) seen.set(k, n)
        }
        setSuggestions([...seen.values()].sort((a, b) => a.localeCompare(b)))
      })
      .catch(() => {})
  }, [userId])

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

  // Add from autocomplete — uses the suggested name directly, ignoring
  // whatever partial text is in the input. Clears the input afterward.
  const addItemWithName = (i, name) => {
    const n = (name || '').trim()
    if (!n) return
    setDays(prev => prev.map((d, idx) =>
      idx === i ? { ...d, exercises: [...d.exercises, { name: n, target: '', item_type: 'exercise' }] } : d
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
        exercises: d.exercises.map((item, j) => {
          if (j !== itemIdx) return item
          const becomingActivity = item.item_type === 'exercise'
          return {
            ...item,
            item_type:       becomingActivity ? 'activity' : 'exercise',
            target:          becomingActivity ? '' : item.target,
            // Seed field selection with a preset based on the name (e.g.
            // "Running" gets distance+duration+HR). If already configured,
            // keep the existing selection.
            activity_fields: becomingActivity
              ? (item.activity_fields || defaultFieldsFor(item.name))
              : item.activity_fields,
          }
        }),
      }
    ))

  const updateTarget = (dayIdx, itemIdx, target) =>
    setDays(prev => prev.map((d, i) =>
      i !== dayIdx ? d : {
        ...d,
        exercises: d.exercises.map((item, j) => j === itemIdx ? { ...item, target } : item),
      }
    ))

  const toggleTrackMode = (dayIdx, itemIdx) =>
    setDays(prev => prev.map((d, i) =>
      i !== dayIdx ? d : {
        ...d,
        exercises: d.exercises.map((item, j) => {
          if (j !== itemIdx || item.item_type === 'activity') return item
          const becomingCheck = item.track_mode !== 'check'
          return {
            ...item,
            track_mode: becomingCheck ? 'check' : 'sets',
            // When flipping to check-mode, default to 1 set if not already set.
            // When flipping back to track-mode, drop set_count.
            set_count:  becomingCheck ? (item.set_count ?? 1) : null,
          }
        }),
      }
    ))

  const updateSetCount = (dayIdx, itemIdx, n) =>
    setDays(prev => prev.map((d, i) =>
      i !== dayIdx ? d : {
        ...d,
        exercises: d.exercises.map((item, j) => j === itemIdx ? { ...item, set_count: n } : item),
      }
    ))

  const toggleActivityField = (dayIdx, itemIdx, fieldKey) =>
    setDays(prev => prev.map((d, i) =>
      i !== dayIdx ? d : {
        ...d,
        exercises: d.exercises.map((item, j) => {
          if (j !== itemIdx) return item
          const current = item.activity_fields || DEFAULT_ACTIVITY_FIELDS
          const next = current.includes(fieldKey)
            ? current.filter(k => k !== fieldKey)
            : [...current, fieldKey]
          return { ...item, activity_fields: next }
        }),
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
            onAddItemWithName={name => addItemWithName(i, name)}
            onRemoveItem={itemIdx => removeItem(i, itemIdx)}
            onMoveItem={(itemIdx, dir) => moveItem(i, itemIdx, dir)}
            onToggleItemType={itemIdx => toggleItemType(i, itemIdx)}
            onUpdateTarget={(itemIdx, target) => updateTarget(i, itemIdx, target)}
            onToggleTrackMode={itemIdx => toggleTrackMode(i, itemIdx)}
            onUpdateSetCount={(itemIdx, n) => updateSetCount(i, itemIdx, n)}
            onToggleActivityField={(itemIdx, fieldKey) => toggleActivityField(i, itemIdx, fieldKey)}
            onOpenPicker={() => setPickerForDay(i)}
            suggestions={suggestions}
          />
        ))}

        <ExercisePickerModal
          open={pickerForDay !== null}
          onClose={() => setPickerForDay(null)}
          onPick={(name) => {
            if (pickerForDay !== null) addItemWithName(pickerForDay, name)
          }}
          userKnownNames={knownNames}
          existingNames={pickerForDay !== null ? days[pickerForDay].exercises.map(e => e.name) : []}
        />

        {error && <p className="err-msg">{error}</p>}
        <button className="complete-btn" style={{ marginTop: 8 }} onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : isEditing ? 'Save Changes' : 'Save Program & Start Training'}
        </button>
        <div style={{ height: 48 }} />
      </div>
    </div>
  )
}
