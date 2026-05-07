import React from 'react'
import { useRestTimer } from '../useRestTimer'
import { useActiveWorkout } from '../useActiveWorkout'

// Single persistent pill — visible from any screen except the workout itself.
// Combines the workout-elapsed and rest-remaining counters into one orange
// pill so we don't stack two visually-competing badges. The rest portion
// only appears when a rest timer is active. Tap returns to the workout.
export default function FloatingTimer({ onTap }) {
  const rest = useRestTimer()
  const active = useActiveWorkout()

  const showWorkout = active.active
  const showRest    = rest.active && rest.total > 0

  if (!showWorkout && !showRest) return null

  // Rest-only state (active workout missing somehow): still show the pill so
  // the rest timer remains tappable.
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

  const dayId   = active.dayId   || rest.dayId
  const blockId = active.blockId || rest.blockId

  return (
    <div className="floating-pills">
      <button
        className="floating-pill floating-pill--workout"
        onClick={() => onTap?.(dayId, blockId)}
        title="Return to workout"
      >
        <span className="floating-pill-label">
          ⏱ {showWorkout ? elapsedLabel : '—'}
          {showRest && (
            <>
              <span className="floating-pill-sep"> · </span>
              <span className="floating-pill-rest">Rest {restLabel}</span>
            </>
          )}
        </span>
        <span className="floating-pill-arrow">→</span>
      </button>
    </div>
  )
}
