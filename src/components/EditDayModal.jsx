import React, { useState, useEffect, useMemo } from 'react'
import { saveProgram, getAllKnownExerciseNames, deleteCustomItem, saveTemplate, deleteWorkoutBlock, updateWorkoutBlock } from '../supabase'
import {
  FIELD_CATALOG, DEFAULT_ACTIVITY_FIELDS, defaultFieldsFor,
} from '../data/commonActivities'
import { EXERCISE_CATALOG } from '../data/exerciseCatalog'
import { ACTIVITY_CATALOG } from '../data/activityCatalog'
import CatalogPickerModal from './CatalogPickerModal'
import RestPickerSheet from './RestPickerSheet'
import WorkoutBuilderModal from './WorkoutBuilderModal'

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

// Single screen-level explainer for Edit Day. Kept as data so we can render
// multiple sections in one modal — easier to find and lighter on screen
// real-estate than per-pill chips.
const EDIT_DAY_INFO = [
  {
    title: 'Exercise vs Activity',
    body: (
      <>
        <strong>Exercise</strong> is a strength-style movement logged with weight × reps (or checkboxes). All exercises in a day share the same Workout session.
        <br /><br />
        <strong>Activity</strong> is anything else — a run, yoga, mobility — logged with duration, distance, intensity, etc. Each activity is its own session and counts independently toward your weekly target.
      </>
    ),
  },
  {
    title: 'Track vs Check (exercises)',
    body: (
      <>
        <strong>Track</strong> — log weight and reps per set. The default for almost every lift.
        <br /><br />
        <strong>Check</strong> — just tick a box per set. Use for finishers, bodyweight movements, or anything where you don't care about loads.
      </>
    ),
  },
  {
    title: 'Group (superset)',
    body: (
      <>
        Tap the <strong>Group</strong> chip to cycle <em>none → A → B → C → none</em>. Exercises sharing a group letter render together as a superset on the workout screen.
      </>
    ),
  },
  {
    title: 'Activity fields',
    body: (
      <>
        Pick which numbers you want to track for each activity. Unused fields (HR, calories, elevation, rounds…) stay hidden. You can change this any time — past logs keep their values.
      </>
    ),
  },
]

export default function EditDayModal({ open, onClose, day, program, userId, onSaved }) {
  // Local working copy — mutated freely until Save.
  const [draft, setDraft] = useState(() => cloneDay(day))
  const [pickerKind, setPickerKind] = useState(null)  // null | 'exercise' | 'activity'
  // Which block the rest picker is editing. null = closed.
  const [restPickerBlockId, setRestPickerBlockId] = useState(null)
  const [knownNames, setKnownNames] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [tplStep,  setTplStep]  = useState({})  // { [blockId]: 'saving'|'done'|'limit' }
  const [tplError, setTplError] = useState('')
  // Which block a "+ Add exercise" press is targeting. null = no picker open
  // (or activity picker, which has no block).
  const [pickerBlockId, setPickerBlockId] = useState(null)
  const [builderOpen, setBuilderOpen]     = useState(false)

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

  const updateBlock = (blockId, fields) =>
    setDraft(prev => ({
      ...prev,
      workout_blocks: (prev.workout_blocks || []).map(b =>
        b.id === blockId ? { ...b, ...fields } : b
      ),
    }))

  const updateItem = (idx, fields) =>
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.map((it, i) => i === idx ? { ...it, ...fields } : it),
    }))

  const removeItem = (idx) => {
    const it = draft.exercises[idx]
    if (!it) return
    const label = it.item_type === 'activity' ? 'activity' : 'exercise'
    if (!window.confirm(`Remove ${label} "${it.name}" from this day? Past logs are kept.`)) return
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== idx),
    }))
  }

  // Move within same item-type only (so exercises stay among exercises and
  // activities stay among activities — sections aren't crossable).
  const moveItem = (idx, dir) =>
    setDraft(prev => {
      const items = [...prev.exercises]
      const here = items[idx]
      let t = idx + dir
      while (t >= 0 && t < items.length && items[t].item_type !== here.item_type) {
        t += dir
      }
      if (t < 0 || t >= items.length) return prev
      ;[items[idx], items[t]] = [items[t], items[idx]]
      return { ...prev, exercises: items }
    })

  const addExercise = (name, blockId) =>
    setDraft(prev => ({
      ...prev,
      exercises: [...prev.exercises, {
        name, target: '', item_type: 'exercise', track_mode: 'sets', set_count: null,
        workout_block_id: blockId || null,
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

  // Cycle the superset group: none → A → B → C → none.
  // Activities never get a group — only barbell/dumbbell-style exercises.
  const cycleGroup = (idx) => {
    const cycle = [null, 'A', 'B', 'C']
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.map((it, i) => {
        if (i !== idx || it.item_type === 'activity') return it
        const cur = it.superset_group || null
        const ci = cycle.indexOf(cur)
        return { ...it, superset_group: cycle[(ci + 1) % cycle.length] }
      }),
    }))
  }

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
  const pickerOnPick  = pickerKind === 'activity'
    ? addActivity
    : (name) => addExercise(name, pickerBlockId)

  const handleSaveTemplate = async (block) => {
    const name = (block?.name || '').trim()
    const blockExercises = draft.exercises.filter(e =>
      e.item_type !== 'activity' && (e.workout_block_id || null) === (block?.id || null)
    )
    if (!name)                  { setTplError('Name the workout first'); return }
    if (!blockExercises.length) { setTplError('Add at least one exercise');  return }
    setTplError('')
    setTplStep(prev => ({ ...prev, [block.id]: 'saving' }))
    try {
      await saveTemplate(name, day.id, blockExercises, userId)
      setTplStep(prev => ({ ...prev, [block.id]: 'done' }))
      setTimeout(() => setTplStep(prev => ({ ...prev, [block.id]: null })), 1800)
    } catch (e) {
      if (e.message === 'LIMIT_REACHED') {
        setTplStep(prev => ({ ...prev, [block.id]: 'limit' }))
        setTimeout(() => setTplStep(prev => ({ ...prev, [block.id]: null })), 2400)
      } else {
        setTplError(e.message)
        setTplStep(prev => ({ ...prev, [block.id]: null }))
      }
    }
  }

  const handleDeleteBlock = async (block) => {
    if (!block?.id) return
    if (!window.confirm(`Delete "${block.name}" and all its exercises?`)) return
    try {
      await deleteWorkoutBlock(block.id, userId)
      // Drop the block's exercises from the local draft so the UI updates
      // before the parent refresh comes back.
      setDraft(prev => ({
        ...prev,
        exercises: prev.exercises.filter(e => e.workout_block_id !== block.id),
        workout_blocks: (prev.workout_blocks || []).filter(b => b.id !== block.id),
      }))
      onSaved?.()
    } catch (e) {
      setError(e.message)
    }
  }

  const handleSave = async () => {
    if (!userId || !day) return
    setSaving(true)
    setError('')
    try {
      // 1) Persist per-block edits (name, rest_seconds). Diff against the
      //    original day so we only patch what actually changed.
      const originalById = Object.fromEntries(
        (day.workout_blocks || []).map(b => [b.id, b])
      )
      const blockUpdates = []
      for (const b of (draft.workout_blocks || [])) {
        if (!b.id) continue
        const orig = originalById[b.id] || {}
        const fields = {}
        if ((b.name || '').trim() !== (orig.name || '').trim()) {
          fields.name = (b.name || '').trim() || 'Workout'
        }
        if ((b.rest_seconds ?? null) !== (orig.rest_seconds ?? null)) {
          fields.rest_seconds = b.rest_seconds ?? 90
        }
        if (Object.keys(fields).length) {
          blockUpdates.push(updateWorkoutBlock(b.id, fields, userId))
        }
      }
      if (blockUpdates.length) await Promise.all(blockUpdates)

      // 2) Persist the day (exercises + day meta). saveProgram requires the
      //    full program, with this day's edits merged in.
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
          <button
            className="info-btn"
            onClick={() => setInfoOpen(true)}
            aria-label="How this works"
            title="How this works"
          >ⓘ</button>
          <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="edit-day-body">
          {/* Workout name and rest live on each block now — see below. */}

          {/* Items list — grouped by type so the day is structured the same way
              the user logs it. */}
          {(() => {
            const exIndexed  = draft.exercises.map((it, i) => ({ it, i })).filter(x => x.it.item_type !== 'activity')
            const actIndexed = draft.exercises.map((it, i) => ({ it, i })).filter(x => x.it.item_type === 'activity')

            const renderRow = ({ it, i }, n, total) => {
              const isActivity = it.item_type === 'activity'
              const isCheck    = !isActivity && it.track_mode === 'check'
              return (
                <div key={i} className="ex-edit-item">
                  <div className="ex-edit-row">
                    <div className="ex-edit-reorder">
                      <button className="reorder-btn" onClick={() => moveItem(i, -1)} disabled={n === 0}>↑</button>
                      <button className="reorder-btn" onClick={() => moveItem(i,  1)} disabled={n === total - 1}>↓</button>
                    </div>
                    <span className={`item-type-pill ${isActivity ? 'item-type-pill--act' : 'item-type-pill--ex'}`}>
                      {isActivity ? 'Activity' : 'Exercise'}
                    </span>
                    {!isActivity && (
                      <button
                        className={`item-track-pill ${isCheck ? 'item-track-pill--check' : 'item-track-pill--track'}`}
                        onClick={() => toggleTrackMode(i)}
                        title={isCheck ? 'Switch to Track' : 'Switch to Check'}
                      >
                        {isCheck ? 'Check' : 'Track'}
                      </button>
                    )}
                    {!isActivity && (
                      <button
                        className={`item-group-pill${it.superset_group ? ' item-group-pill--on' : ''}`}
                        onClick={() => cycleGroup(i)}
                        title="Cycle superset group (none → A → B → C)"
                      >
                        {it.superset_group ? `★${it.superset_group}` : 'Group'}
                      </button>
                    )}
                    <span className="ex-edit-name">{it.name}</span>
                    <button className="ex-edit-remove" onClick={() => removeItem(i)}>×</button>
                  </div>

                  {!isActivity && !isCheck && (
                    <input
                      className="ex-target-input"
                      placeholder="Target (e.g. 3 sets of 8-10 reps)"
                      value={it.target || ''}
                      onChange={e => updateItem(i, { target: e.target.value })}
                    />
                  )}
                  {!isActivity && isCheck && (
                    <div className="set-count-row">
                      <span className="set-count-label">Sets</span>
                      <button type="button" className="set-count-btn" onClick={() => setSetCount(i, (it.set_count ?? 1) - 1)}>−</button>
                      <span className="set-count-value">{it.set_count ?? 1}</span>
                      <button type="button" className="set-count-btn" onClick={() => setSetCount(i, (it.set_count ?? 1) + 1)}>+</button>
                    </div>
                  )}
                  {isActivity && (
                    <div className="activity-fields-picker">
                      {FIELD_CATALOG.map(f => {
                        const active = (it.activity_fields || DEFAULT_ACTIVITY_FIELDS).includes(f.key)
                        return (
                          <button
                            key={f.key}
                            type="button"
                            className={`activity-field-pill${active ? ' activity-field-pill--on' : ''}`}
                            onClick={() => toggleActivityField(i, f.key)}
                          >
                            {f.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            }

            // Group exercise entries by their workout_block_id (null = orphan
            // / pre-backfill). Each block becomes its own card.
            const draftBlocks = draft.workout_blocks || []
            const exByBlock = {}
            for (const entry of exIndexed) {
              const k = entry.it.workout_block_id || '_orphan'
              if (!exByBlock[k]) exByBlock[k] = []
              exByBlock[k].push(entry)
            }
            // Always include configured blocks (even empty ones).
            const renderBlocks = []
            for (const b of draftBlocks) {
              renderBlocks.push({ block: b, entries: exByBlock[b.id] || [] })
            }
            // Append orphan exercises as a stub block so they remain visible.
            if (exByBlock['_orphan']?.length) {
              renderBlocks.push({
                block: { id: null, name: draft.focus || 'Workout' },
                entries: exByBlock['_orphan'],
              })
            }
            // If the day has no blocks at all but has exercises (shouldn't
            // happen post-backfill), surface them via a stub.
            if (renderBlocks.length === 0 && exIndexed.length > 0) {
              renderBlocks.push({
                block: { id: null, name: draft.focus || 'Workout' },
                entries: exIndexed,
              })
            }

            return (
              <>
                <div className="day-section-label day-section-label--workout">
                  Workouts <span className="field-label-hint">{renderBlocks.length} {renderBlocks.length === 1 ? 'block' : 'blocks'}</span>
                </div>
                {renderBlocks.map(({ block, entries }) => {
                  const blockKey = block.id || '_orphan'
                  const tplState = tplStep[blockKey]
                  const editable = !!block.id
                  return (
                    <div key={blockKey} className="block-card">
                      <div className="block-card__header">
                        {editable ? (
                          <input
                            className="block-card__name-input"
                            value={block.name || ''}
                            placeholder="Workout name"
                            onChange={e => updateBlock(block.id, { name: e.target.value })}
                          />
                        ) : (
                          <span className="block-card__name">{block.name}</span>
                        )}
                        {block.id && (
                          <button
                            type="button"
                            className="block-card__delete"
                            onClick={() => handleDeleteBlock(block)}
                            title="Delete this workout"
                            aria-label="Delete workout"
                          >×</button>
                        )}
                      </div>

                      {editable && (
                        <div className="block-card__rest-row">
                          <span className="block-card__rest-label">Rest between sets</span>
                          <button
                            type="button"
                            className="rest-picker-trigger rest-picker-trigger--inline"
                            onClick={() => setRestPickerBlockId(block.id)}
                          >
                            <span className="rest-picker-trigger-val">{formatRest(block.rest_seconds ?? 90)}</span>
                            <span className="rest-picker-trigger-chev">▾</span>
                          </button>
                        </div>
                      )}

                      {entries.length === 0 ? (
                        <div className="edit-day-empty">No exercises in this workout yet.</div>
                      ) : (
                        <div className="edit-day-items">
                          {entries.map((entry, n) => renderRow(entry, n, entries.length))}
                        </div>
                      )}
                      <button
                        className="ex-browse-btn"
                        style={{ marginTop: 8 }}
                        onClick={() => {
                          setPickerBlockId(block.id || null)
                          setPickerKind('exercise')
                        }}
                      >+ Add exercise</button>

                      {block.id && (
                        <button
                          type="button"
                          className="tpl-save-chip block-card__tpl"
                          onClick={() => handleSaveTemplate(block)}
                          disabled={tplState === 'saving' || entries.length === 0}
                          title="Save this workout as a reusable template"
                        >
                          {tplState === 'saving' ? 'Saving…'
                           : tplState === 'done'  ? '✓ Saved'
                           : tplState === 'limit' ? 'Limit'
                           : '⌂ Save as template'}
                        </button>
                      )}
                    </div>
                  )
                })}
                {tplError && <div className="err-msg" style={{ marginTop: 4 }}>{tplError}</div>}
                <button
                  className="ex-browse-btn"
                  style={{ marginTop: 12 }}
                  onClick={() => setBuilderOpen(true)}
                >+ Add a workout</button>

                <div className="day-section-label day-section-label--activity" style={{ marginTop: 22 }}>
                  Activities <span className="field-label-hint">{actIndexed.length} {actIndexed.length === 1 ? 'activity' : 'activities'}</span>
                </div>
                {actIndexed.length === 0 ? (
                  <div className="edit-day-empty">No activities yet.</div>
                ) : (
                  <div className="edit-day-items">
                    {actIndexed.map((entry, n) => renderRow(entry, n, actIndexed.length))}
                  </div>
                )}
                <button
                  className="ex-browse-btn ex-browse-btn--alt"
                  style={{ marginTop: 8 }}
                  onClick={() => setPickerKind('activity')}
                >+ Add activity</button>
              </>
            )
          })()}

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
          onDeleteCustom={async (name) => {
            await deleteCustomItem(name, userId)
            // Drop the deleted name from the local list so the UI updates instantly.
            setKnownNames(prev => prev.filter(n => n.toLowerCase() !== name.toLowerCase()))
            // Also remove it from the current draft if present.
            setDraft(prev => ({ ...prev, exercises: prev.exercises.filter(e => e.name !== name) }))
          }}
        />
      )}

      <RestPickerSheet
        open={!!restPickerBlockId}
        value={(draft.workout_blocks || []).find(b => b.id === restPickerBlockId)?.rest_seconds ?? 90}
        onClose={() => setRestPickerBlockId(null)}
        onPick={(seconds) => updateBlock(restPickerBlockId, { rest_seconds: seconds })}
      />

      <WorkoutBuilderModal
        open={builderOpen}
        dayId={day?.id}
        userId={userId}
        onClose={() => setBuilderOpen(false)}
        onCreated={() => { onSaved?.() }}
      />

      {infoOpen && (
        <div className="modal-backdrop" onClick={() => setInfoOpen(false)}>
          <div className="modal-card info-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">How Edit Day works</h3>
            <div className="info-sections">
              {EDIT_DAY_INFO.map((section, i) => (
                <div key={i} className="info-section">
                  <div className="info-section__title">{section.title}</div>
                  <div className="info-section__body">{section.body}</div>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="modal-btn-primary" onClick={() => setInfoOpen(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function cloneDay(day) {
  if (!day) return { id: null, name: '', focus: '', color: '#64748b', rest_seconds: 90, exercises: [], workout_blocks: [] }
  return {
    ...day,
    exercises:      (day.exercises || []).map(e => ({ ...e })),
    workout_blocks: (day.workout_blocks || []).map(b => ({ ...b })),
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
