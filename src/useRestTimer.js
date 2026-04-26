import { useEffect, useState } from 'react'
import { getState, subscribe, start, stop, reset } from './restTimerStore'

// React hook for the rest timer store. Re-renders on each tick.
export function useRestTimer() {
  const [state, setState] = useState(getState)
  useEffect(() => subscribe(setState), [])
  return { ...state, start, stop, reset }
}
