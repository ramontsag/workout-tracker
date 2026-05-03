import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getProgram, getStats, getProfile, seedProgramIfMissing } from './supabase'
import AuthScreen      from './components/AuthScreen'
import Home            from './components/Home'
import DayScreen       from './components/DayScreen'
import WorkoutDay      from './components/WorkoutDay'
import ExerciseHistory from './components/ExerciseHistory'
import ProfileScreen   from './components/ProfileScreen'
import ProgressScreen  from './components/ProgressScreen'
import ArchivesScreen  from './components/ArchivesScreen'
import SettingsScreen  from './components/SettingsScreen'
import FloatingTimer   from './components/FloatingTimer'
import { stop as stopRestTimer } from './restTimerStore'
import { clear as clearActiveWorkout } from './activeWorkoutStore'

// Screens: loading → auth → home
//          home → workout → history → workout
//          home → profile → progress | archives | settings
// Brand-new accounts get 7 empty days auto-seeded so they always land on home.

export default function App() {
  const [screen,          setScreen]         = useState('loading')
  const [user,            setUser]           = useState(null)
  const [program,         setProgram]        = useState([])
  const [activeDay,       setActiveDay]      = useState(null)
  const [activeBlock,     setActiveBlock]    = useState(null)
  const [activeExercise,  setActiveExercise] = useState(null)
  const [totalWorkouts,   setTotalWorkouts]  = useState(null)
  const [totalActivities, setTotalActivities] = useState(null)
  const [profile,         setProfile]        = useState(null)

  const screenRef = useRef('loading')
  const go = (s) => { screenRef.current = s; setScreen(s) }

  // Bootstrap path — used on initial sign-in. Seeds an empty 7-day program
  // for fresh accounts and navigates to home.
  const loadProgram = useCallback(async (uid) => {
    try {
      if (uid) {
        try { await seedProgramIfMissing(uid) } catch (e) { console.warn('[App] seed failed:', e.message) }
      }
      const days = await getProgram()
      setProgram(days)
      go('home')
    } catch (err) {
      console.error('[App] loadProgram failed:', err.message)
      go('home')
    }
  }, []) // eslint-disable-line

  // Pure refetch — used after edits (rest stepper, EditDayModal save). Does
  // NOT navigate, so the user stays where they are.
  const refreshProgram = useCallback(async () => {
    try {
      const days = await getProgram()
      setProgram(days)
    } catch (err) {
      console.warn('[App] refreshProgram failed:', err.message)
    }
  }, [])

  const loadProfile = useCallback(async () => {
    try {
      const p = await getProfile()
      if (p) setProfile(p)
    } catch {}
  }, [])

  useEffect(() => {
    const fallback = setTimeout(() => {
      if (screenRef.current === 'loading') {
        console.warn('[App] Auth init timed out — showing login')
        go('auth')
      }
    }, 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'INITIAL_SESSION') {
          clearTimeout(fallback)
          if (session?.user) {
            setUser(session.user)
            await loadProgram(session.user.id)
            loadProfile()
            getStats().then(s => { setTotalWorkouts(s.totalWorkouts); setTotalActivities(s.totalActivities) }).catch(() => {})
          } else go('auth')

        } else if (event === 'SIGNED_IN') {
          if (session?.user) {
            setUser(session.user)
            // Only navigate on a real sign-in; token refreshes also fire SIGNED_IN
            // but we must not disrupt an active screen (e.g. mid-workout logging)
            if (screenRef.current === 'auth') {
              await loadProgram(session.user.id)
              loadProfile()
              getStats().then(s => { setTotalWorkouts(s.totalWorkouts); setTotalActivities(s.totalActivities) }).catch(() => {})
            }
          }

        } else if (event === 'SIGNED_OUT') {
          setUser(null); setProgram([]); setActiveDay(null); setTotalWorkouts(null); setTotalActivities(null); setProfile(null)
          // Tear down floating-pill state so the next user doesn't inherit
          // the previous account's in-progress workout / rest timer.
          stopRestTimer()
          clearActiveWorkout()
          go('auth')
        }
      }
    )

    return () => { clearTimeout(fallback); subscription.unsubscribe() }
  }, [loadProgram, loadProfile]) // eslint-disable-line

  // Tap on the floating timer pill — jumps back to the workout that started
  // it. Validates the day AND the block still exist in the current program;
  // if either is gone (e.g. block was deleted via Edit Day after the timer
  // started), stop the timer and stay put rather than landing on something stale.
  const handleFloatingTimerTap = (dayId, blockId) => {
    const day = dayId ? program.find(d => d.id === dayId) : null
    if (!day) { stopRestTimer(); return }
    const block = blockId
      ? (day.workout_blocks || []).find(b => b.id === blockId)
      : null
    if (blockId && !block) { stopRestTimer(); return }
    setActiveDay(day)
    setActiveBlock(block || null)
    go('workout')
  }

  // Same destination the floating pill uses, but driven by an internal event
  // so a deep child (e.g. WorkoutDay's "active workout already running" modal)
  // can ask to navigate without re-prop-drilling.
  useEffect(() => {
    const onGoto = (e) => {
      const { dayId, blockId } = e.detail || {}
      handleFloatingTimerTap(dayId, blockId)
    }
    window.addEventListener('wt:goto-active-workout', onGoto)
    return () => window.removeEventListener('wt:goto-active-workout', onGoto)
  }, [program]) // eslint-disable-line

  // ── Render ────────────────────────────────────────────────────
  const renderScreen = () => {
    if (screen === 'loading') {
      return (
        <div className="splash">
          <div className="splash-logo">💪</div>
          <div className="splash-text">Loading…</div>
        </div>
      )
    }
    if (screen === 'auth') return <AuthScreen />

    if (screen === 'history' && activeExercise) {
      return (
        <ExerciseHistory
          exercise={activeExercise}
          profile={profile}
          onBack={() => go('workout')}
        />
      )
    }

    if (screen === 'day' && activeDay) {
      const liveDay = program.find(d => d.id === activeDay.id) || activeDay
      return (
        <DayScreen
          day={liveDay}
          program={program}
          userId={user?.id}
          profile={profile}
          onBack={() => { setActiveDay(null); setActiveBlock(null); go('home') }}
          onSelectWorkout={(block) => { setActiveBlock(block || null); go('workout') }}
          onProgramUpdated={refreshProgram}
        />
      )
    }

    if (screen === 'workout' && activeDay) {
      // Re-derive activeDay from program so EditDayModal saves see the latest items.
      const liveDay = program.find(d => d.id === activeDay.id) || activeDay
      // Back from a workout goes to DayScreen if the day has activities or
      // multiple workout blocks; else straight home.
      const hasActivities = (liveDay.exercises || []).some(e => e.item_type === 'activity')
      const multipleBlocks = (liveDay.workout_blocks || []).length > 1
      // Re-derive the live block too so renames / new exercises propagate.
      const liveBlock = activeBlock
        ? (liveDay.workout_blocks || []).find(b => b.id === activeBlock.id) || activeBlock
        : null
      return (
        <WorkoutDay
          day={liveDay}
          block={liveBlock}
          program={program}
          userId={user?.id}
          profile={profile}
          onBack={() => {
            if (hasActivities || multipleBlocks) { setActiveBlock(null); go('day') }
            else { setActiveDay(null); setActiveBlock(null); go('home') }
          }}
          onCompleteHome={() => { setActiveDay(null); setActiveBlock(null); go('home') }}
          onHistory={exercise => { setActiveExercise(exercise); go('history') }}
          onProgramUpdated={refreshProgram}
          onProfileUpdated={setProfile}
        />
      )
    }

    if (screen === 'profile') {
      return (
        <ProfileScreen
          user={user}
          totalWorkouts={totalWorkouts}
          totalActivities={totalActivities}
          onBack={() => go('home')}
          onProgress={() => go('progress')}
          onArchives={() => go('archives')}
          onSettings={() => go('settings')}
        />
      )
    }

    if (screen === 'progress') {
      return (
        <ProgressScreen
          user={user}
          profile={profile}
          onBack={() => go('profile')}
        />
      )
    }

    if (screen === 'archives') {
      return (
        <ArchivesScreen
          user={user}
          program={program}
          onBack={() => go('profile')}
          onProgramUpdated={refreshProgram}
        />
      )
    }

    if (screen === 'settings') {
      return (
        <SettingsScreen
          user={user}
          profile={profile}
          onBack={() => go('profile')}
          onProfileUpdated={setProfile}
        />
      )
    }

    return (
      <Home
        program={program}
        userId={user?.id}
        profile={profile}
        onSelectDay={day => {
          setActiveDay(day)
          const hasActivities = (day.exercises || []).some(e => e.item_type === 'activity')
          const blocks        = day.workout_blocks || []
          // Single-workout, no-activities days skip straight into the only
          // workout's session — fastest path to logging.
          if (blocks.length === 1 && !hasActivities) {
            setActiveBlock(blocks[0])
            go('workout')
          } else {
            setActiveBlock(null)
            go('day')
          }
        }}
        onProfile={() => go('profile')}
        onProgramUpdated={refreshProgram}
      />
    )
  }

  return (
    <>
      {renderScreen()}
      {screen !== 'workout' && screen !== 'loading' && screen !== 'auth' && (
        <FloatingTimer onTap={handleFloatingTimerTap} />
      )}
    </>
  )
}
