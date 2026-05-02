import React, { useState } from 'react'

// Bottom-sheet picker for the user's gyms. Powers the gym chip on the
// Start-workout modal. Lets the user:
//   - Switch active gym (tap a row).
//   - Add a new gym (always-visible row at the bottom).
//   - Rename / delete a gym (long-press / pencil button).
//
// Props:
//   - open
//   - gyms: [{ id, name, color }]
//   - activeGymId: string | null
//   - onPick(id|null), onClose
//   - onCreate(name) → returns Promise<gym>
//   - onRename(id, name) → returns Promise
//   - onDelete(id) → returns Promise
export default function GymPickerSheet({
  open, gyms, activeGymId, onPick, onClose, onCreate, onRename, onDelete,
}) {
  const [adding, setAdding]       = useState(false)
  const [newName, setNewName]     = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName]   = useState('')
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState('')

  if (!open) return null

  const handleAdd = async () => {
    const name = newName.trim()
    if (!name) { setErr('Enter a name'); return }
    setBusy(true); setErr('')
    try {
      const created = await onCreate(name)
      setNewName('')
      setAdding(false)
      // The new gym auto-becomes active in createGym; close so the user
      // sees their selection reflected on the Start modal.
      if (created?.id) onPick(created.id)
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleRenameSave = async (id) => {
    const name = editName.trim()
    if (!name) { setErr('Enter a name'); return }
    setBusy(true); setErr('')
    try {
      await onRename(id, name)
      setEditingId(null)
      setEditName('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this gym? Workouts logged here will lose their gym tag.')) return
    setBusy(true); setErr('')
    try {
      await onDelete(id)
      // If the deleted gym was active, fall back to no-gym.
      if (id === activeGymId) onPick(null)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-sheet gym-picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">Where are you lifting?</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="gym-picker-list">
          {/* "No gym" option — useful for travel days or when the user just
              doesn't want a tag stamped on this workout. */}
          <button
            className={`gym-picker-item${activeGymId == null ? ' gym-picker-item--on' : ''}`}
            onClick={() => { onPick(null); onClose() }}
          >
            <span className="gym-picker-dot" style={{ background: '#52525b' }} />
            <span className="gym-picker-name">No gym</span>
            {activeGymId == null && <span className="gym-picker-check">✓</span>}
          </button>

          {gyms.map(g => (
            <div key={g.id} className="gym-picker-row">
              {editingId === g.id ? (
                <div className="gym-picker-edit">
                  <span className="gym-picker-dot" style={{ background: g.color }} />
                  <input
                    className="field-input gym-picker-edit-input"
                    value={editName}
                    autoFocus
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleRenameSave(g.id)}
                  />
                  <button
                    className="gym-picker-save"
                    onClick={() => handleRenameSave(g.id)}
                    disabled={busy}
                  >Save</button>
                  <button
                    className="gym-picker-cancel"
                    onClick={() => { setEditingId(null); setEditName('') }}
                  >×</button>
                </div>
              ) : (
                <>
                  <button
                    className={`gym-picker-item${g.id === activeGymId ? ' gym-picker-item--on' : ''}`}
                    onClick={() => { onPick(g.id); onClose() }}
                  >
                    <span className="gym-picker-dot" style={{ background: g.color }} />
                    <span className="gym-picker-name">{g.name}</span>
                    {g.id === activeGymId && <span className="gym-picker-check">✓</span>}
                  </button>
                  <button
                    className="gym-picker-edit-btn"
                    title="Rename"
                    onClick={() => { setEditingId(g.id); setEditName(g.name); setErr('') }}
                    aria-label={`Rename ${g.name}`}
                  >✎</button>
                  <button
                    className="gym-picker-delete-btn"
                    title="Delete"
                    onClick={() => handleDelete(g.id)}
                    aria-label={`Delete ${g.name}`}
                  >×</button>
                </>
              )}
            </div>
          ))}

          {adding ? (
            <div className="gym-picker-edit gym-picker-edit--add">
              <span className="gym-picker-dot" style={{ background: '#52525b' }} />
              <input
                className="field-input gym-picker-edit-input"
                placeholder="Gym name"
                value={newName}
                autoFocus
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
              <button
                className="gym-picker-save"
                onClick={handleAdd}
                disabled={busy}
              >{busy ? '…' : 'Add'}</button>
              <button
                className="gym-picker-cancel"
                onClick={() => { setAdding(false); setNewName(''); setErr('') }}
              >×</button>
            </div>
          ) : (
            <button
              className="gym-picker-add"
              onClick={() => { setAdding(true); setErr('') }}
            >+ Add a gym</button>
          )}
        </div>

        {err && <div className="gym-picker-error">{err}</div>}
      </div>
    </div>
  )
}
