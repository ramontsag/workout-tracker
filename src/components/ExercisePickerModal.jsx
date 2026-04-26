import React, { useState, useMemo } from 'react'
import { EXERCISE_CATALOG } from '../data/exerciseCatalog'

// Categorized exercise picker — bottom sheet shown when adding to a day.
// Search filters across all groups. "Your exercises" surfaces names from
// the user's program/history that aren't in the curated catalog.
// "Create your own exercise" is the explicit path for new names.
//
// Props:
//   - open: boolean
//   - onClose: () => void
//   - onPick: (name: string) => void
//   - userKnownNames: string[]  (program + history names)
//   - existingNames: string[]   (already on this day; greyed out)
export default function ExercisePickerModal({ open, onClose, onPick, userKnownNames = [], existingNames = [] }) {
  const [query, setQuery] = useState('')
  const [openGroup, setOpenGroup] = useState('Chest')
  const [creatingName, setCreatingName] = useState(null)  // null | string

  const existingLower = useMemo(
    () => new Set(existingNames.map(n => (n || '').toLowerCase())),
    [existingNames]
  )

  // Names from the user's program/history that aren't in the curated catalog
  // — surfaced as a "Your exercises" group at the top.
  const yourExercises = useMemo(() => {
    const catalogLower = new Set(
      EXERCISE_CATALOG.flatMap(g => g.items).map(n => n.toLowerCase())
    )
    const seen = new Set()
    const out = []
    for (const n of userKnownNames) {
      const k = (n || '').toLowerCase()
      if (!k || catalogLower.has(k) || seen.has(k)) continue
      seen.add(k)
      out.push(n)
    }
    return out.sort((a, b) => a.localeCompare(b))
  }, [userKnownNames])

  const groups = useMemo(() => {
    const all = []
    if (yourExercises.length) all.push({ group: 'Your exercises', items: yourExercises })
    return [...all, ...EXERCISE_CATALOG]
  }, [yourExercises])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return groups
    return groups
      .map(g => ({
        group: g.group,
        items: g.items.filter(n => n.toLowerCase().includes(q)),
      }))
      .filter(g => g.items.length > 0)
  }, [q, groups])

  if (!open) return null

  const handlePick = (name) => {
    if (existingLower.has(name.toLowerCase())) return
    onPick(name)
    setQuery('')
    setCreatingName(null)
    onClose()
  }

  const handleCreate = () => {
    const name = (creatingName || '').trim()
    if (!name) return
    if (existingLower.has(name.toLowerCase())) return
    onPick(name)
    setQuery('')
    setCreatingName(null)
    onClose()
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">Add exercise</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <input
          className="picker-search"
          type="text"
          placeholder="Search…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />

        <div className="picker-list">
          {filtered.length === 0 && (
            <div className="picker-empty">No matches. Try a different word, or create your own below.</div>
          )}

          {filtered.map(g => {
            const isOpen = q ? true : openGroup === g.group
            return (
              <div key={g.group} className="picker-group">
                <button
                  className="picker-group-header"
                  onClick={() => !q && setOpenGroup(isOpen ? null : g.group)}
                >
                  <span className="picker-group-name">{g.group}</span>
                  <span className="picker-group-count">{g.items.length}</span>
                  {!q && <span className="picker-group-chev">{isOpen ? '▲' : '▼'}</span>}
                </button>
                {isOpen && (
                  <div className="picker-items">
                    {g.items.map(name => {
                      const taken = existingLower.has(name.toLowerCase())
                      return (
                        <button
                          key={name}
                          className={`picker-item${taken ? ' picker-item--taken' : ''}`}
                          onClick={() => !taken && handlePick(name)}
                          disabled={taken}
                          title={taken ? 'Already on this day' : ''}
                        >
                          {name}
                          {taken && <span className="picker-item-taken-tag">already on day</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="picker-create">
          {creatingName === null ? (
            <button
              className="picker-create-btn"
              onClick={() => setCreatingName(query)}
            >
              + Create your own exercise
            </button>
          ) : (
            <div className="picker-create-row">
              <input
                className="picker-create-input"
                placeholder="Exercise name"
                value={creatingName}
                onChange={e => setCreatingName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
                autoFocus
              />
              <button className="picker-create-confirm" onClick={handleCreate}>Add</button>
              <button className="picker-create-cancel" onClick={() => setCreatingName(null)} aria-label="Cancel">×</button>
            </div>
          )}
          {creatingName !== null && (
            <p className="picker-create-help">
              Pick a name you'll use consistently — once you create it, it'll appear here next time so your history stays in one place.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
