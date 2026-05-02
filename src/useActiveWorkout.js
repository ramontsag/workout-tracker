import { useEffect, useState } from 'react'
import { getState, subscribe, start, clear } from './activeWorkoutStore'

// React hook for the active-workout store. Re-renders every second while a
// workout is active so the elapsed pill ticks.
export function useActiveWorkout() {
  const [state, setState] = useState(getState)
  useEffect(() => subscribe(setState), [])
  return { ...state, start, clear }
}
