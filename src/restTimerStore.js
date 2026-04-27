// Rest timer store — wall-clock based, persisted in localStorage.
// State lives outside React so it survives navigation, reload, and
// tab close. `remaining` is recomputed from `end_at - now` so the
// countdown stays correct even if the tab was backgrounded.

const LS_KEY = 'wt:rest_timer'
const TICK_MS = 250

let listeners = new Set()
let intervalId = null

function readPersisted() {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.end_at !== 'number') return null
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
  if (!p) return { active: false, remaining: 0, total: 0, dayId: null, blockId: null }
  const remaining = Math.max(0, Math.round((p.end_at - Date.now()) / 1000))
  return {
    active:    remaining > 0,
    remaining,
    total:     p.total || 0,
    dayId:     p.day_id || null,
    blockId:   p.block_id || null,
  }
}

export function start(totalSeconds, dayId = null, blockId = null) {
  const total = Math.max(1, Math.floor(totalSeconds))
  writePersisted({
    end_at: Date.now() + total * 1000,
    total,
    day_id: dayId,
    block_id: blockId,
  })
  ensureTicking()
  notify()
}

export function reset() {
  const p = readPersisted()
  if (!p) return
  writePersisted({ ...p, end_at: Date.now() + (p.total || 0) * 1000 })
  ensureTicking()
  notify()
}

export function stop() {
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
  // Stop ticking once the timer reaches zero — saves CPU and avoids
  // re-rendering subscribers every 250ms forever. start() will call
  // ensureTicking() to resume on the next set.
  if (!state.active && intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function ensureTicking() {
  if (intervalId || listeners.size === 0) return
  intervalId = setInterval(notify, TICK_MS)
}

// Sync across tabs — if another tab starts/stops the timer, ours updates too.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === LS_KEY) notify()
  })
}
