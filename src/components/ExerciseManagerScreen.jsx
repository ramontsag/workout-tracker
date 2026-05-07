import React, { useEffect, useMemo, useState } from 'react'
import { listLoggedExerciseNames, mergeExerciseHistory } from '../supabase'

// Lists every distinct exercise_name the user has ever logged a set
// for, with the count of sets. Lets the user pick two names and merge
// them into one — used to heal name-drift in past data so the
// "previous session" lookup keeps working when an exercise was
// historically logged under a slightly different spelling.
//
// New data won't drift because the catalog picker forces a stable
// spelling on add. This screen exists for the legacy mismatch.
//
// Props:
//   - userId
//   - onBack: () => void
export default function ExerciseManagerScreen({ userId, onBack }) {
  const [names,    setNames]    = useState([])      // [{ name, count }]
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [query,    setQuery]    = useState('')
  const [fromName, setFromName] = useState(null)
  const [toName,   setToName]   = useState(null)
  const [merging,  setMerging]  = useState(false)
  const [confirm,  setConfirm]  = useState(false)

  const reload = async () => {
    if (!userId) return
    setLoading(true)
    setError('')
    try {
      const list = await listLoggedExerciseNames(userId)
      setNames(list)
    } catch (e) {
      setError(e.message || 'Could not load exercises')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() /* eslint-disable-line */ }, [userId])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => q ? names.filter(n => n.name.toLowerCase().includes(q)) : names,
    [names, q]
  )

  // Suggest likely-duplicate pairs by lowercased name match. If two rows
  // have the same lowercased spelling they're the same exercise; we
  // surface those at the top so the user notices them immediately.
  const dupGroups = useMemo(() => {
    const groups = new Map()
    for (const n of names) {
      const k = n.name.trim().toLowerCase()
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k).push(n)
    }
    return [...groups.values()].filter(g => g.length > 1)
  }, [names])

  const onPick = (name) => {
    if (fromName === null)             { setFromName(name); return }
    if (fromName && toName === null && name !== fromName) {
      setToName(name); return
    }
    // Tapping again clears the selection so the user can restart.
    if (name === fromName) { setFromName(null); setToName(null); return }
    if (name === toName)   { setToName(null); return }
  }

  const reset = () => {
    setFromName(null)
    setToName(null)
    setConfirm(false)
  }

  const handleMerge = async () => {
    if (!fromName || !toName) return
    setMerging(true)
    setError('')
    try {
      await mergeExerciseHistory(fromName, toName, userId)
      reset()
      await reload()
    } catch (e) {
      setError(e.message || 'Merge failed')
    } finally {
      setMerging(false)
    }
  }

  const fromCount = names.find(n => n.name === fromName)?.count || 0
  const toCount   = names.find(n => n.name === toName)?.count   || 0

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Exercises</div>
          <div className="sub-header__sub">Heal split history</div>
        </div>
      </header>

      <div className="content">
        <p className="state-msg state-msg--empty" style={{ textAlign: 'left', padding: '0 0 12px' }}>
          If the same exercise was logged under two slightly-different names
          (e.g. "Bench press" vs "Barbell bench press"), tap the older one,
          then the canonical one, then Merge — past sets carry over so the
          "previous session" hint comes back.
        </p>

        {loading && <div className="state-msg">Loading…</div>}
        {error && <div className="err-msg">{error}</div>}

        {!loading && !error && (
          <>
            {dupGroups.length > 0 && (
              <div className="exmgr-dup-banner">
                <strong>{dupGroups.length} likely duplicate{dupGroups.length === 1 ? '' : 's'}</strong> — same name, different capitalization or spacing. Search below to find them.
              </div>
            )}

            <input
              className="picker-search"
              type="text"
              placeholder="Search your exercises…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            {(fromName || toName) && (
              <div className="exmgr-selection">
                <div className="exmgr-selection__row">
                  <span className="exmgr-selection__label">From</span>
                  <span className="exmgr-selection__name">{fromName || '—'}</span>
                  {fromName && <span className="exmgr-selection__count">{fromCount} sets</span>}
                </div>
                <div className="exmgr-selection__row">
                  <span className="exmgr-selection__label">→ Into</span>
                  <span className="exmgr-selection__name">{toName || '—'}</span>
                  {toName && <span className="exmgr-selection__count">{toCount} sets</span>}
                </div>
                <div className="exmgr-selection__actions">
                  {!confirm && (
                    <>
                      <button
                        className="modal-btn-primary exmgr-merge-btn"
                        disabled={!fromName || !toName || merging}
                        onClick={() => setConfirm(true)}
                      >
                        Merge
                      </button>
                      <button className="modal-btn-cancel exmgr-merge-btn" onClick={reset}>Clear</button>
                    </>
                  )}
                  {confirm && (
                    <>
                      <button
                        className="modal-btn-danger exmgr-merge-btn"
                        disabled={merging}
                        onClick={handleMerge}
                      >
                        {merging ? 'Merging…' : `Confirm merge (${fromCount + toCount} sets)`}
                      </button>
                      <button
                        className="modal-btn-cancel exmgr-merge-btn"
                        disabled={merging}
                        onClick={() => setConfirm(false)}
                      >Cancel</button>
                    </>
                  )}
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <div className="state-msg state-msg--empty">
                {names.length === 0 ? 'No logged exercises yet.' : 'No matches.'}
              </div>
            )}

            <div className="exmgr-list">
              {filtered.map(({ name, count }) => {
                const isFrom = fromName === name
                const isTo   = toName   === name
                const cls = `exmgr-row${isFrom ? ' exmgr-row--from' : ''}${isTo ? ' exmgr-row--to' : ''}`
                return (
                  <button
                    key={name}
                    className={cls}
                    onClick={() => onPick(name)}
                  >
                    <span className="exmgr-row__name">{name}</span>
                    <span className="exmgr-row__count">{count}</span>
                  </button>
                )
              })}
            </div>
          </>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
