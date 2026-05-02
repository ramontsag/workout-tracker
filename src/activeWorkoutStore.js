// Active workout store — wall-clock based, persisted in localStorage.
// Tracks the single workout the user has Started but not yet completed,
// independent of the per-block draft. Used for:
//   - the floating "in-progress workout" pill outside the workout screen
//   - blocking a second workout from being started while one is active
// Cleared when the workout is Completed or Cancelled.

const LS_KEY = 'wt:active_workout'

let listeners = new Set()
let intervalId = null
const TICK_MS = 1000

function readPersisted() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.started_at !== 'string') return null
    return parsed
  } catch { return null }
}

function writePersisted(data) {
  if (typeof window === 'undefined') return
  try {
    if (data == null) window.localStorage.removeItem(LS_KEY)
    else              window.localStorage.setItem(LS_KEY, JSON.stringify(data))
  } catch {}
}

export function getState() {
  const p = readPersisted()
  if (!p) return { active: false, dayId: null, blockId: null, dayName: '', blockName: '', startedAt: null, elapsed: 0 }
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(p.started_at).getTime()) / 1000))
  return {
    active:    true,
    dayId:     p.day_id || null,
    blockId:   p.block_id || null,
    dayName:   p.day_name || '',
    blockName: p.block_name || '',
    startedAt: p.started_at,
    elapsed,
  }
}

export function start({ dayId, blockId = null, dayName = '', blockName = '', startedAt }) {
  writePersisted({
    day_id:     dayId,
    block_id:   blockId,
    day_name:   dayName,
    block_name: blockName,
    started_at: startedAt || new Date().toISOString(),
  })
  ensureTicking()
  notify()
}

export function clear() {
  writePersisted(null)
  notify()
}

export function subscribe(fn) {
  listeners.add(fn)
  ensureTicking()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && intervalId) {
      clearInterval(intervalId)
      intervalId = null
    }
  }
}

function notify() {
  const state = getState()
  for (const fn of listeners) fn(state)
  if (!state.active && intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function ensureTicking() {
  if (intervalId || listeners.size === 0) return
  if (!getState().active) return
  intervalId = setInterval(notify, TICK_MS)
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === LS_KEY) notify()
  })
}
