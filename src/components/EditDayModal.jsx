import React, { useState, useEffect, useMemo } from 'react'
import { saveProgram, getAllKnownExerciseNames, getAllKnownActivityNames, deleteCustomItem, saveTemplate, deleteWorkoutBlock, updateWorkoutBlock, applyBlockToTemplate } from '../supabase'
import { getState as getRestTimerState, stop as stopRestTimer } from '../restTimerStore'
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
  // Snapshot at open-time so we can detect unsaved edits ("dirty" state). The
  // per-block "Save as template" chip is disabled while dirty so the template
  // never captures the unsaved working copy (audit M5).
  const [openSnapshot, setOpenSnapshot] = useState(() => JSON.stringify(cloneDay(day)))
  // Form is "dirty" if the draft diverges from the snapshot OR if any
  // destructive op has been staged for Save Changes (block delete, custom
  // delete). Both must enable the Save button — staged deletes alone
  // don't always alter the visible draft.
  const draftDirty = JSON.stringify(draft) !== openSnapshot
  const [pickerKind, setPickerKind] = useState(null)  // null | 'exercise' | 'activity'
  // Which block the rest picker is editing. null = closed.
  const [restPickerBlockId, setRestPickerBlockId] = useState(null)
  const [knownExerciseNames, setKnownExerciseNames] = useState([])
  const [knownActivityNames, setKnownActivityNames] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [tplStep,  setTplStep]  = useState({})  // { [blockId]: 'saving'|'done'|'limit' }
  const [tplError, setTplError] = useState('')
  // Mirror of tplStep but for "Apply to template" — kept separate so both
  // chips can fire independently and surface their own status text.
  const [applyStep, setApplyStep] = useState({})  // { [blockId]: 'saving'|'done' }
  // Which block a "+ Add exercise" press is targeting. null = no picker open
  // (or activity picker, which has no block).
  const [pickerBlockId, setPickerBlockId] = useState(null)
  const [builderOpen, setBuilderOpen]     = useState(false)
  // Pending DB ops that only commit when the user presses Save Changes.
  // Closing the modal (× or backdrop) discards them silently — every
  // mutation in this sheet flows through Save Changes, no exceptions.
  const [pendingBlockDeletes,  setPendingBlockDeletes]  = useState([]) // block ids
  const [pendingCustomDeletes, setPendingCustomDeletes] = useState([]) // names
  // New blocks the user added via the builder modal. Each entry is
  // `{ tempId, name }` — the tempId matches the synthetic id set on the
  // staged block + its staged exercises in `draft`. handleSave runs
  // createWorkoutBlock for each of these and remaps tempId → real id
  // before saveProgram inserts the day's exercises.
  const [pendingBlockCreates,  setPendingBlockCreates]  = useState([]) // [{ tempId, name }]
  // True whenever there's something to commit — either the visible draft
  // diverged from the snapshot or a staged DB op is queued. The Save button
  // and "Save day first" gating both depend on this.
  const isDirty = draftDirty
    || pendingBlockDeletes.length > 0
    || pendingCustomDeletes.length > 0
    || pendingBlockCreates.length > 0

  useEffect(() => {
    if (open) {
      const fresh = cloneDay(day)
      setDraft(fresh)
      setOpenSnapshot(JSON.stringify(fresh))
      setPendingBlockDeletes([])
      setPendingCustomDeletes([])
      setPendingBlockCreates([])
      setError('')
    }
  }, [open, day])

  // Warn on tab close / refresh while there are pending edits. Cleans up
  // as soon as the modal closes or the dirty state resolves so we don't
  // leak the listener across modal lifecycles.
  useEffect(() => {
    if (!open || !isDirty) return
    const handler = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [open, isDirty])

  useEffect(() => {
    if (!userId || !open) return
    getAllKnownExerciseNames(userId).then(setKnownExerciseNames).catch(() => {})
    getAllKnownActivityNames(userId).then(setKnownActivityNames).catch(() => {})
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
    if (!window.confirm(`Remove ${label} "${it.name}" from this day? Past sessions keep their data, but anything logged in your current session for it will be discarded.`)) return
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.filter((_, i) => i !== idx),
    }))
  }

  // Move within same item-type AND same workout block. Crossing block
  // boundaries used to silently put the moved row under a sibling block
  // visually because the per-block render groups by workout_block_id while
  // the swap happened on global index.
  const moveItem = (idx, dir) =>
    setDraft(prev => {
      const items = [...prev.exercises]
      const here = items[idx]
      let t = idx + dir
      while (
        t >= 0 && t < items.length &&
        (items[t].item_type !== here.item_type ||
         (items[t].workout_block_id || null) !== (here.workout_block_id || null))
      ) {
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
        name, target: '', item_type: 'exercise', track_mode: 'sets', set_count: 2,
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
          set_count:  it.set_count ?? (becomingCheck ? 1 : 2),
        }
      }),
    }))

  const setSetCount = (idx, n) =>
    updateItem(idx, { set_count: Math.max(1, Math.min(15, n)) })

  // Cycle drop-set mode: off → all → last → off.
  // 'all'  = the live workout shows "+ Drop" on every completed working set.
  // 'last' = "+ Drop" only on the last completed working set.
  const cycleDropMode = (idx) => {
    const cycle = ['off', 'all', 'last']
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.map((it, i) => {
        if (i !== idx || it.item_type === 'activity') return it
        const cur = it.drop_set_mode || (it.has_drop_sets ? 'all' : 'off')
        const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length]
        return { ...it, drop_set_mode: next, has_drop_sets: next !== 'off' }
      }),
    }))
  }

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

  // Push current draft's block exercises back into the template the block
  // was seeded from. Disabled while dirty for the same reason as Save as
  // template — the template should reflect the saved state, not in-flight
  // edits the user might still discard.
  const handleApplyToTemplate = async (block) => {
    if (!block?.id || !block?.template_id) return
    const blockExercises = draft.exercises
      .filter(e => e.item_type !== 'activity' && (e.workout_block_id || null) === block.id)
      .map(e => ({ name: e.name, target: e.target || '', item_type: 'exercise' }))
    if (!blockExercises.length) { setTplError('Add at least one exercise'); return }
    setTplError('')
    setApplyStep(prev => ({ ...prev, [block.id]: 'saving' }))
    try {
      await applyBlockToTemplate(block.id, blockExercises, userId)
      setApplyStep(prev => ({ ...prev, [block.id]: 'done' }))
      setTimeout(() => setApplyStep(prev => ({ ...prev, [block.id]: null })), 1800)
    } catch (e) {
      setTplError(e.message)
      setApplyStep(prev => ({ ...prev, [block.id]: null }))
    }
  }

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

  const handleDeleteBlock = (block) => {
    if (!block?.id) return
    if (!window.confirm(`Delete "${block.name}" and all its exercises? This will be applied when you press Save changes.`)) return
    // Stage the deletion + remove the block from the visible draft. Actual
    // DB delete happens in handleSave; the rest timer is also only stopped
    // there — staging is reversible by closing the modal, so we mustn't
    // touch external state until the commit lands.
    setPendingBlockDeletes(prev => prev.includes(block.id) ? prev : [...prev, block.id])
    setDraft(prev => ({
      ...prev,
      exercises: prev.exercises.filter(e => e.workout_block_id !== block.id),
      workout_blocks: (prev.workout_blocks || []).filter(b => b.id !== block.id),
    }))
  }

  // Stage a new block from the WorkoutBuilderModal (deferred mode). The
  // intent carries a temporary id; we inject the block + any seeded
  // template exercises into draft so the UI updates immediately. handleSave
  // creates the real block(s) and remaps tempId → real id before
  // saveProgram inserts the staged exercises.
  const handleStageBlockIntent = (intent) => {
    if (!intent || !intent.isDeferred) {
      // Backwards-compat: if a non-deferred block lands here (shouldn't,
      // since EditDayModal passes defer=true), fall back to the old behavior
      // of mirroring the real block id straight into the draft.
      if (intent?.id) {
        const seeded = (intent.seededExercises || []).map(e => ({
          id:               e.id,
          name:             e.name,
          target:           e.target || '',
          item_type:        'exercise',
          track_mode:       e.track_mode || 'sets',
          set_count:        e.set_count ?? 2,
          activity_fields:  null,
          superset_group:   e.superset_group || null,
          workout_block_id: intent.id,
        }))
        setDraft(prev => ({
          ...prev,
          workout_blocks: [...(prev.workout_blocks || []), { id: intent.id, name: intent.name }],
          exercises:      [...prev.exercises, ...seeded],
        }))
      }
      return
    }
    // Deferred path — stage with a synthetic tempId.
    const { tempId, name: blockName, templateExercises = [] } = intent
    const seeded = templateExercises.map(e => ({
      ...e,
      workout_block_id: tempId,
    }))
    setDraft(prev => ({
      ...prev,
      workout_blocks: [...(prev.workout_blocks || []), {
        id:           tempId,
        name:         blockName,
        rest_seconds: 90,
        timer_enabled: true,
        sort_order:   (prev.workout_blocks || []).length,
        exercises:    seeded,
      }],
      exercises: [...prev.exercises, ...seeded],
    }))
    setPendingBlockCreates(prev => [...prev, { tempId, name: blockName }])
  }

  const handleSave = async () => {
    if (!userId || !day) return
    setSaving(true)
    setError('')
    // Local copies of staging state — cleared incrementally as each op
    // succeeds so a partial-failure retry doesn't try to redo work that
    // already landed (which would throw "row not found" on already-deleted
    // blocks and leave the modal permanently broken).
    let blockDeletesLeft  = [...pendingBlockDeletes]
    let customDeletesLeft = [...pendingCustomDeletes]
    let blockCreatesLeft  = [...pendingBlockCreates]
    // tempId → real id, populated as we create deferred blocks.
    const tempIdMap = {}
    try {
      // 0) Create staged blocks first so the saveProgram payload below can
      //    reference real block ids. Each successful create gets popped off
      //    `blockCreatesLeft` immediately.
      for (const intent of [...blockCreatesLeft]) {
        const block = await createWorkoutBlock(day.id, intent.name, userId, {})
        tempIdMap[intent.tempId] = block.id
        blockCreatesLeft = blockCreatesLeft.filter(i => i.tempId !== intent.tempId)
      }

      // 0b) Apply staged block deletions. Each successful delete gets popped
      //     so a retry after a partial failure doesn't re-attempt them.
      for (const id of [...blockDeletesLeft]) {
        await deleteWorkoutBlock(id, userId)
        // Stop the floating rest timer if it was tracking this just-deleted
        // block — only at commit time, since staging a delete is reversible.
        if (getRestTimerState().blockId === id) stopRestTimer()
        blockDeletesLeft = blockDeletesLeft.filter(x => x !== id)
      }

      // 0c) Apply staged custom-item deletions (best-effort — already-gone
      //     rows are fine). Each clears off `customDeletesLeft` after
      //     attempt so a retry doesn't loop on the same name.
      for (const name of [...customDeletesLeft]) {
        try { await deleteCustomItem(name, userId) } catch { /* tolerate */ }
        customDeletesLeft = customDeletesLeft.filter(n => n !== name)
      }

      // 1) Build the merged draft: remap temp block ids → real ids on both
      //    workout_blocks and exercises, and drop deleted blocks.
      const remapId = (id) => (id != null && tempIdMap[id]) || id
      const mergedDraft = {
        ...draft,
        workout_blocks: (draft.workout_blocks || [])
          .filter(b => !pendingBlockDeletes.includes(b.id))
          .map(b => ({ ...b, id: remapId(b.id) })),
        exercises: (draft.exercises || []).map(e => ({
          ...e,
          workout_block_id: remapId(e.workout_block_id),
        })),
      }

      // 2) Per-block updates (name, rest_seconds). Skip pending deletes and
      //    pending creates (newly-created blocks just used the user's chosen
      //    name on insert, no diff to apply).
      const originalById = Object.fromEntries(
        (day.workout_blocks || []).map(b => [b.id, b])
      )
      const blockUpdates = []
      for (const b of mergedDraft.workout_blocks) {
        if (!b.id) continue
        if (pendingBlockDeletes.includes(b.id)) continue
        const orig = originalById[b.id]
        if (!orig) continue // newly created above — no diff to apply
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

      // 3) Persist day-level state (exercises + day meta) via saveProgram.
      const mergedProgram = program.map(d => d.id === day.id ? mergedDraft : d)
      await saveProgram(mergedProgram, userId)
      // Clear remaining staging only on full success.
      setPendingBlockDeletes([])
      setPendingCustomDeletes([])
      setPendingBlockCreates([])
      await onSaved?.()
      onClose()
    } catch (e) {
      // Persist whatever's still pending so a retry picks up where we left
      // off — without this, a transient failure would forget the rest of
      // the work and the user would have to redo it.
      setPendingBlockDeletes(blockDeletesLeft)
      setPendingCustomDeletes(customDeletesLeft)
      setPendingBlockCreates(blockCreatesLeft)
      setError(e?.message || 'Save failed — please try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleDiscard = () => {
    if (!isDirty) return
    if (!window.confirm('Discard changes? This cannot be undone.')) return
    const fresh = cloneDay(day)
    setDraft(fresh)
    setOpenSnapshot(JSON.stringify(fresh))
    setPendingBlockDeletes([])
    setPendingCustomDeletes([])
    setPendingBlockCreates([])
    setError('')
  }

  // Single close path so the backdrop and the × button share one
  // confirmation prompt. When the modal is opened mid-workout, "Leave"
  // closes just this sheet — the live workout underneath is unaffected.
  const requestClose = () => {
    if (isDirty && !window.confirm('Unsaved changes. Leave anyway?')) return
    onClose()
  }

  if (!open) return null

  return (
    <div className="picker-overlay" onClick={requestClose}>
      <div className="picker-sheet edit-day-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">{draft.name}</span>
          <button
            className="info-btn"
            onClick={() => setInfoOpen(true)}
            aria-label="How this works"
            title="How this works"
          >ⓘ</button>
          <button className="picker-close" onClick={requestClose} aria-label="Close">×</button>
        </div>

        {/* Sticky action bar — single source of truth for committing edits.
            Pinned right under the header so it's reachable without scrolling
            to the bottom of long days. Disabled until something is dirty so
            it never reads "Save changes" when nothing's changed. */}
        <div className="edit-day-action-bar">
          {isDirty && !saving && (
            <button
              className="edit-day-discard-btn"
              onClick={handleDiscard}
              disabled={saving || !isDirty}
            >
              Discard
            </button>
          )}
          <button
            className="edit-day-save-btn"
            onClick={handleSave}
            disabled={saving || !isDirty}
          >
            {saving       ? 'Saving…'
             : !isDirty   ? 'No unsaved changes'
             :              'Save changes'}
          </button>
        </div>

        <div className="edit-day-body">
          {isDirty && !saving && (
            <div className="edit-day-banner" role="status">Unsaved changes</div>
          )}
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
                    {!isActivity && (
                      <button
                        className={`item-track-pill ${isCheck ? 'item-track-pill--check' : 'item-track-pill--track'}`}
                        onClick={() => toggleTrackMode(i)}
                        title={isCheck ? 'Switch to Track' : 'Switch to Check'}
                      >
                        {isCheck ? 'Check' : 'Track'}
                      </button>
                    )}
                    {!isActivity && !isCheck && (() => {
                      const dm = it.drop_set_mode || (it.has_drop_sets ? 'all' : 'off')
                      // Compact labels keep the row narrow so the × remove
                      // button doesn't get pushed off-screen on 375px width.
                      const label = dm === 'all'  ? '↓ All'
                                  : dm === 'last' ? '↓ Last'
                                  : 'Dropset'
                      const title = dm === 'all'  ? 'Drop set offered on every working set — tap for last-only'
                                  : dm === 'last' ? 'Drop set offered on the last working set only — tap to disable'
                                  :                 'Tap to enable drop sets (all working sets)'
                      return (
                        <button
                          className={`item-drop-pill item-drop-pill--${dm}`}
                          onClick={() => cycleDropMode(i)}
                          title={title}
                        >
                          {label}
                        </button>
                      )
                    })()}
                    {!isActivity && (
                      <button
                        className={`item-group-pill${it.superset_group ? ' item-group-pill--on' : ''}`}
                        onClick={() => cycleGroup(i)}
                        title="Cycle superset group (none → A → B → C)"
                      >
                        {it.superset_group ? `★${it.superset_group}` : 'Superset'}
                      </button>
                    )}
                    <span className="ex-edit-name">{it.name}</span>
                    <button className="ex-edit-remove" onClick={() => removeItem(i)}>×</button>
                  </div>

                  {!isActivity && !isCheck && (
                    <input
                      className="ex-target-input"
                      placeholder="Target (e.g. 8-10 reps)"
                      value={it.target || ''}
                      onChange={e => updateItem(i, { target: e.target.value })}
                    />
                  )}
                  {!isActivity && (() => {
                    const fallback = isCheck ? 1 : 2
                    const value = it.set_count ?? fallback
                    return (
                      <div className="set-count-row">
                        <span className="set-count-label">Sets</span>
                        <button type="button" className="set-count-btn" onClick={() => setSetCount(i, value - 1)} disabled={value <= 1}>−</button>
                        <span className="set-count-value">{value}</span>
                        <button type="button" className="set-count-btn" onClick={() => setSetCount(i, value + 1)} disabled={value >= 15}>+</button>
                      </div>
                    )
                  })()}
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
                        <div className="block-card__tpl-row">
                          <button
                            type="button"
                            className="tpl-save-chip"
                            onClick={() => handleSaveTemplate(block)}
                            disabled={tplState === 'saving' || entries.length === 0 || isDirty}
                            title={
                              isDirty
                                ? 'Tap "Save changes" first — templates capture the saved version.'
                                : 'Save this workout as a reusable template'
                            }
                          >
                            {tplState === 'saving' ? 'Saving…'
                             : tplState === 'done'  ? '✓ Saved'
                             : tplState === 'limit' ? 'Limit'
                             : isDirty               ? 'Save day first'
                             : '⌂ Save as template'}
                          </button>
                          {block.template_id && (() => {
                            const apState = applyStep[block.id]
                            return (
                              <button
                                type="button"
                                className="tpl-save-chip tpl-save-chip--apply"
                                onClick={() => handleApplyToTemplate(block)}
                                disabled={apState === 'saving' || entries.length === 0 || isDirty}
                                title={
                                  isDirty
                                    ? 'Tap "Save changes" first — the template captures the saved version.'
                                    : 'Push these changes back to the saved template'
                                }
                              >
                                {apState === 'saving' ? 'Applying…'
                                 : apState === 'done'  ? '✓ Applied'
                                 : isDirty              ? 'Save day first'
                                 : '↻ Apply to template'}
                              </button>
                            )
                          })()}
                        </div>
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
                {actIndexed.length > 0 && (
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
      </div>

      {pickerKind && (
        <CatalogPickerModal
          open
          onClose={() => setPickerKind(null)}
          onPick={pickerOnPick}
          catalog={pickerCatalog}
          userKnownNames={pickerKind === 'activity' ? knownActivityNames : knownExerciseNames}
          existingNames={draft.exercises
            .filter(e => (e.item_type === 'activity') === (pickerKind === 'activity'))
            .map(e => e.name)}
          title={pickerTitle}
          createLabel={pickerCreate}
          createPlaceholder={pickerKind === 'activity' ? 'Activity name' : 'Exercise name'}
          yourGroupLabel={pickerYour}
          kind={pickerKind === 'activity' ? 'activity' : 'workout'}
          deleteConfirmBody="Removes it from your program when you press Save changes. Close this sheet without saving to undo. Past workout history is preserved."
          onDeleteCustom={async (name) => {
            // Stage only — the actual DB delete runs in handleSave so closing
            // the modal without saving cleanly reverts the change.
            setPendingCustomDeletes(prev => prev.includes(name) ? prev : [...prev, name])
            const setter = pickerKind === 'activity' ? setKnownActivityNames : setKnownExerciseNames
            setter(prev => prev.filter(n => n.toLowerCase() !== name.toLowerCase()))
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
        defer
        onClose={() => setBuilderOpen(false)}
        onCreated={handleStageBlockIntent}
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
