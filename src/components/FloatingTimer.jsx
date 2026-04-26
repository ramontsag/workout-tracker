import React from 'react'
import { useRestTimer } from '../useRestTimer'

// Persistent rest timer pill — visible from any screen except the workout itself.
// Tap to jump back to the workout that started it. Hides automatically when the
// timer reaches 0 or is dismissed.
export default function FloatingTimer({ onTap }) {
  const { remaining, total, active, dayId } = useRestTimer()
  if (!active || total === 0) return null

  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const label = mins > 0
    ? `${mins}:${String(secs).padStart(2, '0')}`
    : `${remaining}s`

  return (
    <button
      className="floating-timer"
      onClick={() => onTap?.(dayId)}
      title="Return to workout"
    >
      <span className="floating-timer-label">Rest {label}</span>
      <span className="floating-timer-arrow">→</span>
    </button>
  )
}
