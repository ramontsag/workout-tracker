import React, { useState, useMemo } from 'react'

// Generic categorized picker — bottom-sheet modal used for both exercises and
// activities. Accepts any catalog shaped as either:
//   [{ group, items: string[] }]                              (flat groups)
//   [{ group, subgroups: [{ name, items: string[] }] }]       (nested)
// The component normalizes flat groups into a single nameless subgroup so the
// render path is uniform.
//
// Props:
//   - open: boolean
//   - onClose: () => void
//   - onPick: (name: string) => void
//   - catalog: [{ group, items? | subgroups? }]
//   - userKnownNames?: string[]   names from the user's program/history
//   - existingNames?:  string[]   names already on this day; greyed out
//   - title?: string                          default "Add item"
//   - createLabel?: string                    default "+ Create your own"
//   - createPlaceholder?: string              default "Name"
//   - yourGroupLabel?: string                 default "Your items"
//   - onDeleteCustom?: (name: string) => Promise<void>   if provided, items
//       in the "Your X" group get a × delete affordance with confirm.
export default function CatalogPickerModal({
  open, onClose, onPick,
  catalog,
  userKnownNames = [],
  existingNames  = [],
  title             = 'Add item',
  createLabel       = '+ Create your own',
  createPlaceholder = 'Name',
  yourGroupLabel    = 'Your items',
  onDeleteCustom    = null,
}) {
  const [query, setQuery] = useState('')
  const [openGroup, setOpenGroup] = useState(null)
  const [creatingName, setCreatingName] = useState(null)  // null | string
  const [confirmDelete, setConfirmDelete] = useState(null) // null | name

  const existingLower = useMemo(
    () => new Set(existingNames.map(n => (n || '').toLowerCase())),
    [existingNames]
  )

  // Normalize catalog entries — flat groups get a single nameless subgroup.
  const normalizedCatalog = useMemo(
    () => catalog.map(g =>
      g.subgroups
        ? g
        : { group: g.group, subgroups: [{ name: '', items: g.items || [] }] }
    ),
    [catalog]
  )

  // User names not already in the catalog become a "Your X" group at the top.
  const yourItems = useMemo(() => {
    const catalogLower = new Set(
      normalizedCatalog.flatMap(g => g.subgroups.flatMap(sg => sg.items)).map(n => n.toLowerCase())
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
  }, [userKnownNames, normalizedCatalog])

  const groups = useMemo(() => {
    const all = []
    if (yourItems.length) {
      all.push({ group: yourGroupLabel, subgroups: [{ name: '', items: yourItems }] })
    }
    return [...all, ...normalizedCatalog]
  }, [yourItems, normalizedCatalog, yourGroupLabel])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return groups
    return groups
      .map(g => ({
        group: g.group,
        subgroups: g.subgroups
          .map(sg => ({ ...sg, items: sg.items.filter(n => n.toLowerCase().includes(q)) }))
          .filter(sg => sg.items.length > 0),
      }))
      .filter(g => g.subgroups.length > 0)
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
          <span className="picker-title">{title}</span>
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
            const totalItems = g.subgroups.reduce((n, sg) => n + sg.items.length, 0)
            const isYourGroup = g.group === yourGroupLabel
            return (
              <div key={g.group} className="picker-group">
                <button
                  className="picker-group-header"
                  onClick={() => !q && setOpenGroup(isOpen ? null : g.group)}
                >
                  <span className="picker-group-name">{g.group}</span>
                  <span className="picker-group-count">{totalItems}</span>
                  {!q && <span className="picker-group-chev">{isOpen ? '▲' : '▼'}</span>}
                </button>
                {isOpen && (
                  <div className="picker-items">
                    {g.subgroups.map((sg, sgi) => (
                      <div key={sg.name || `sg-${sgi}`} className="picker-subgroup">
                        {sg.name && <div className="picker-subgroup-name">{sg.name}</div>}
                        {sg.items.map(name => {
                          const taken = existingLower.has(name.toLowerCase())
                          const canDelete = isYourGroup && !!onDeleteCustom
                          return (
                            <div key={name} className="picker-item-row">
                              <button
                                className={`picker-item${taken ? ' picker-item--taken' : ''}`}
                                onClick={() => !taken && handlePick(name)}
                                disabled={taken}
                                title={taken ? 'Already on this day' : ''}
                              >
                                {name}
                                {taken && <span className="picker-item-taken-tag">already on day</span>}
                              </button>
                              {canDelete && (
                                <button
                                  className="picker-item-delete"
                                  onClick={(e) => { e.stopPropagation(); setConfirmDelete(name) }}
                                  aria-label={`Delete ${name}`}
                                  title="Delete this custom item and its history"
                                >×</button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div className="picker-create">
          {creatingName === null ? (
            <button className="picker-create-btn" onClick={() => setCreatingName(query)}>
              {createLabel}
            </button>
          ) : (
            <div className="picker-create-row">
              <input
                className="picker-create-input"
                placeholder={createPlaceholder}
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

      {confirmDelete && (
        <div className="confirm-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-card" onClick={e => e.stopPropagation()}>
            <div className="confirm-title">Delete "{confirmDelete}"?</div>
            <p className="confirm-body">
              This will remove it from your program AND every workout entry you've ever logged for it. This can't be undone.
            </p>
            <div className="confirm-actions">
              <button
                className="confirm-danger"
                onClick={async () => {
                  try { await onDeleteCustom(confirmDelete) } catch {}
                  setConfirmDelete(null)
                }}
              >Delete forever</button>
              <button
                className="confirm-cancel"
                onClick={() => setConfirmDelete(null)}
              >Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
