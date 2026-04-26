import React from 'react'

// Bottom-sheet picker for rest duration. Tap a preset to choose.
// Used by both the workout-screen header and EditDayModal.
//
// Props:
//   - open: boolean
//   - value: number (current rest in seconds)
//   - onPick: (seconds: number) => void
//   - onClose: () => void
const PRESETS = [30, 45, 60, 75, 90, 120, 150, 180, 240, 300]

function format(s) {
  if (s >= 60) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, '0')}`
  }
  return `${s} seconds`
}

export default function RestPickerSheet({ open, value, onPick, onClose }) {
  if (!open) return null
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker-sheet rest-picker-sheet" onClick={e => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">Rest between sets</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="rest-picker-list">
          {PRESETS.map(s => (
            <button
              key={s}
              className={`rest-picker-item${s === value ? ' rest-picker-item--on' : ''}`}
              onClick={() => { onPick(s); onClose() }}
            >
              <span>{format(s)}</span>
              {s === value && <span className="rest-picker-check">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
