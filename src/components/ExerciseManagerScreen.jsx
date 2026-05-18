import React, { useEffect, useMemo, useState } from 'react'
import {
  getExerciseLibrary,
  renameExerciseLibrary,
  mergeExerciseLibrary,
  deleteExerciseLibrary,
  exerciseInActiveDraft,
} from '../supabase'

// Manage Exercises — user-controlled library. Replaces the old
// "heal split history" detector screen. No suggestions, no auto-merges:
// every rewrite is an explicit user action.

function fmtRelative(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'today'
  const days = Math.floor(ms / 86400000)
  if (days <= 0)  return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days} days ago`
  if (days < 30)  return `${Math.floor(days / 7)} wk ago`
  if (days < 365) return `${Math.floor(days / 30)} mo ago`
  return `${Math.floor(days / 365)} yr ago`
}

function subtitleFor(item) {
  if (!item.session_count) return 'Never used'
  const plural = item.session_count === 1 ? 'session' : 'sessions'
  const last = item.last_used_at ? ` · last used ${fmtRelative(item.last_used_at)}` : ''
  return `${item.session_count} ${plural}${last}`
}

export default function ExerciseManagerScreen({ userId, onBack }) {
  const [library, setLibrary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [query,   setQuery]   = useState('')

  const [menuFor,   setMenuFor]   = useState(null)
  const [renameFor, setRenameFor] = useState(null)
  const [mergeFor,  setMergeFor]  = useState(null)
  const [deleteFor, setDeleteFor] = useState(null)
  const [toast, setToast] = useState('')

  const reload = async () => {
    if (!userId) return
    setError('')
    try {
      const list = await getExerciseLibrary(userId)
      setLibrary(list)
    } catch (e) {
      setError(e.message || 'Could not load library')
    }
  }

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    getExerciseLibrary(userId)
      .then(list => { setLibrary(list); setLoading(false) })
      .catch(e => { setError(e.message || 'Could not load library'); setLoading(false) })
  }, [userId])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2500)
    return () => clearTimeout(id)
  }, [toast])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return library
    return library.filter(it => it.name.toLowerCase().includes(q))
  }, [library, q])

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Manage Exercises</div>
        </div>
      </header>

      <div className="content">
        <input
          className="picker-search"
          type="text"
          placeholder="Search exercises…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {loading && <div className="state-msg">Loading…</div>}
        {error   && <div className="err-msg">{error}</div>}

        {!loading && !error && filtered.length === 0 && (
          <div className="state-msg state-msg--empty">
            {library.length === 0
              ? 'Your library is empty — add or log an exercise first.'
              : 'No matches.'}
          </div>
        )}

        <div className="exmgr-list">
          {filtered.map(item => (
            <div key={item.name} className="exmgr-row">
              <div className="exmgr-row__text" style={{ flex: 1, minWidth: 0 }}>
                <div className="exmgr-row__name" style={{ fontWeight: 600 }}>{item.name}</div>
                <div className="exmgr-row__sub" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {subtitleFor(item)}
                </div>
              </div>
              <button
                className="exmgr-row__menu"
                aria-label={`Actions for ${item.name}`}
                title="Actions"
                onClick={() => setMenuFor(item)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: 18,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >⋯</button>
            </div>
          ))}
        </div>

        <div style={{ height: 40 }} />
      </div>

      {menuFor && (
        <div className="picker-overlay" onClick={() => setMenuFor(null)}>
          <div className="picker-sheet" onClick={e => e.stopPropagation()}>
            <div className="picker-header">
              <span className="picker-title">{menuFor.name}</span>
              <button className="picker-close" onClick={() => setMenuFor(null)} aria-label="Close">×</button>
            </div>
            <div className="picker-list">
              <button
                className="picker-item"
                onClick={() => { setRenameFor(menuFor); setMenuFor(null) }}
              >Rename</button>
              <button
                className="picker-item"
                onClick={() => { setMergeFor(menuFor); setMenuFor(null) }}
              >Merge into another</button>
              <button
                className="picker-item"
                onClick={() => { setDeleteFor(menuFor); setMenuFor(null) }}
                style={{ color: 'var(--danger)' }}
              >Delete</button>
            </div>
          </div>
        </div>
      )}

      {renameFor && (
        <RenameModal
          item={renameFor}
          library={library}
          userId={userId}
          onClose={() => setRenameFor(null)}
          onDone={async (newName) => {
            setRenameFor(null)
            setToast(`Renamed to ${newName}`)
            await reload()
          }}
        />
      )}

      {mergeFor && (
        <MergeModal
          source={mergeFor}
          library={library}
          userId={userId}
          onClose={() => setMergeFor(null)}
          onDone={async (toName) => {
            setMergeFor(null)
            setToast(`Merged into ${toName}.`)
            await reload()
          }}
        />
      )}

      {deleteFor && (
        <DeleteModal
          item={deleteFor}
          userId={userId}
          onClose={() => setDeleteFor(null)}
          onDone={async (name) => {
            setDeleteFor(null)
            setToast(`Deleted ${name}.`)
            await reload()
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-elev, #1f1f1f)',
            color: 'var(--text, #fff)',
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid var(--border, #333)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            fontSize: 14,
            zIndex: 1000,
            maxWidth: '88vw',
          }}
        >{toast}</div>
      )}
    </div>
  )
}

// ── Rename modal ─────────────────────────────────────────────
function RenameModal({ item, library, userId, onClose, onDone }) {
  const [value, setValue] = useState(item.name)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  const trimmed = value.trim()
  const isEmpty = trimmed.length === 0
  const isNoop  = trimmed === item.name
  const isDup   = !isEmpty
    && trimmed.toLowerCase() !== item.name.toLowerCase()
    && library.some(l =>
        l.name.toLowerCase() === trimmed.toLowerCase()
        && l.name.toLowerCase() !== item.name.toLowerCase()
      )

  const handleSave = async () => {
    if (isEmpty) { setError('Name required'); return }
    if (isDup)   { setError(`"${trimmed}" already exists in your library`); return }
    if (isNoop)  { onClose(); return }
    setBusy(true); setError('')
    try {
      await renameExerciseLibrary(item.name, trimmed, userId)
      await onDone(trimmed)
    } catch (e) {
      if (e.message === 'DUPLICATE_NAME') {
        setError(`"${trimmed}" already exists in your library`)
      } else if (e.message === 'NAME_REQUIRED') {
        setError('Name required')
      } else {
        setError(e.message || 'Rename failed')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Rename exercise</h3>
        <label className="field-label">Name</label>
        <input
          className="field-input"
          value={value}
          onChange={e => { setValue(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') handleSave() }}
          autoFocus
        />
        {error && <div className="err-msg" style={{ marginTop: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button
            className="modal-btn-primary"
            onClick={handleSave}
            disabled={busy || isEmpty || isDup}
          >{busy ? 'Saving…' : 'Save'}</button>
          <button className="modal-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Merge modal ──────────────────────────────────────────────
function MergeModal({ source, library, userId, onClose, onDone }) {
  const [step,   setStep]   = useState('pick')
  const [target, setTarget] = useState(null)
  const [query,  setQuery]  = useState('')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')

  const q = query.trim().toLowerCase()
  const others = useMemo(
    () => library
      .filter(l => l.name.toLowerCase() !== source.name.toLowerCase())
      .filter(l => !q || l.name.toLowerCase().includes(q)),
    [library, q, source.name]
  )

  const handleMerge = async () => {
    if (!target) return
    setBusy(true); setError('')
    try {
      await mergeExerciseLibrary(source.name, target.name, userId)
      await onDone(target.name)
    } catch (e) {
      setError(e.message || 'Merge failed')
      setBusy(false)
    }
  }

  if (step === 'pick') {
    return (
      <div className="picker-overlay" onClick={onClose}>
        <div className="picker-sheet" onClick={e => e.stopPropagation()}>
          <div className="picker-header">
            <span className="picker-title">Merge {source.name} into…</span>
            <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <input
            className="picker-search"
            type="text"
            placeholder="Search exercises…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          <div className="picker-list">
            {others.length === 0 && (
              <div className="picker-empty">
                {library.length <= 1
                  ? 'No other exercises in your library.'
                  : 'No matches.'}
              </div>
            )}
            {others.map(it => (
              <button
                key={it.name}
                className="picker-item"
                onClick={() => { setTarget(it); setStep('confirm') }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                  <span>{it.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {it.session_count} {it.session_count === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const n = source.session_count
  const sessionsCopy = n === 0
    ? 'No completed sessions are logged against'
    : `All ${n} session${n === 1 ? '' : 's'} logged against`

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Merge {source.name} into {target.name}?</h3>
        <p className="modal-body">
          You're about to merge <strong>{source.name}</strong> into <strong>{target.name}</strong>.
          {' '}{sessionsCopy} <strong>{source.name}</strong> will be moved to <strong>{target.name}</strong>'s history.
          {' '}<strong>{source.name}</strong> will be removed from your library. This cannot be undone.
          {' '}Charts, PRs, and any history views for <strong>{target.name}</strong> will recalculate to include the merged sessions.
        </p>
        {error && <div className="err-msg" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button
            className="modal-btn-primary"
            onClick={handleMerge}
            disabled={busy}
          >{busy ? 'Merging…' : 'Merge'}</button>
          <button
            className="modal-btn-cancel"
            onClick={() => { setStep('pick'); setTarget(null) }}
            disabled={busy}
          >Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ── Delete modal ─────────────────────────────────────────────
function DeleteModal({ item, userId, onClose, onDone }) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  // null = still probing; true / false = result. UI renders the warning
  // sentence only when true.
  const [draftRef, setDraftRef] = useState(null)
  const n = item.session_count

  useEffect(() => {
    let cancelled = false
    exerciseInActiveDraft(item.name, userId)
      .then(r => { if (!cancelled) setDraftRef(!!r) })
      .catch(() => { if (!cancelled) setDraftRef(false) })
    return () => { cancelled = true }
  }, [item.name, userId])

  const handleDelete = async () => {
    setBusy(true); setError('')
    try {
      await deleteExerciseLibrary(item.name, userId)
      await onDone(item.name)
    } catch (e) {
      setError(e.message || 'Delete failed')
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <h3 className="modal-title">Delete {item.name}?</h3>
        <p className="modal-body">
          {n === 0
            ? <>Delete <strong>{item.name}</strong>? This will permanently remove the exercise from your library. This cannot be undone.</>
            : <>Delete <strong>{item.name}</strong>? This will permanently remove the exercise and all {n} session{n === 1 ? '' : 's'} logged against it. This cannot be undone.</>}
          {draftRef === true && (
            <> This exercise is currently in a workout you have in progress. Deleting it will remove those sets from that workout.</>
          )}
        </p>
        {error && <div className="err-msg" style={{ marginBottom: 8 }}>{error}</div>}
        <div className="modal-actions">
          <button
            className="modal-btn-danger"
            onClick={handleDelete}
            disabled={busy}
          >{busy ? 'Deleting…' : 'Delete'}</button>
          <button className="modal-btn-cancel" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
