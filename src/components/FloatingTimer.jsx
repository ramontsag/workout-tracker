import React from 'react'
import { useRestTimer } from '../useRestTimer'
import { useActiveWorkout } from '../useActiveWorkout'

// Persistent floating pills — visible from any screen except the workout itself.
//   Workout pill: shown while a workout is Started but not Completed. Tap returns to it.
//   Rest pill: shown while the rest timer is running. Tap returns to it.
// Both stack centred at the bottom of the screen.
export default function FloatingTimer({ onTap }) {
  const rest = useRestTimer()
  const active = useActiveWorkout()

  const showRest    = rest.active && rest.total > 0
  const showWorkout = active.active

  if (!showRest && !showWorkout) return null

  const restMins = Math.floor(rest.remaining / 60)
  const restSecs = rest.remaining % 60
  const restLabel = restMins > 0
    ? `${restMins}:${String(restSecs).padStart(2, '0')}`
    : `${rest.remaining}s`

  const elapsed = active.elapsed || 0
  const h = Math.floor(elapsed / 3600)
  const m = Math.floor((elapsed % 3600) / 60)
  const s = elapsed % 60
  const pad = (n) => String(n).padStart(2, '0')
  const elapsedLabel = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  const workoutTitle = active.blockName && active.blockName !== 'Workout'
    ? active.blockName
    : (active.dayName || 'Workout')

  return (
    <div className="floating-pills">
      {showWorkout && (
        <button
          className="floating-pill floating-pill--workout"
          onClick={() => onTap?.(active.dayId, active.blockId)}
          title="Return to workout"
        >
          <span className="floating-pill-label">⏱ {workoutTitle} {elapsedLabel}</span>
          <span className="floating-pill-arrow">→</span>
        </button>
      )}
      {showRest && (
        <button
          className="floating-pill floating-pill--rest"
          onClick={() => onTap?.(rest.dayId, rest.blockId)}
          title="Return to workout"
        >
          <span className="floating-pill-label">Rest {restLabel}</span>
          <span className="floating-pill-arrow">→</span>
        </button>
      )}
    </div>
  )
}
