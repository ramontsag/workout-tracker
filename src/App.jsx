import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getProgram, getStats, getProfile } from './supabase'
import AuthScreen      from './components/AuthScreen'
import ProgramSetup    from './components/ProgramSetup'
import Home            from './components/Home'
import WorkoutDay      from './components/WorkoutDay'
import ExerciseHistory from './components/ExerciseHistory'
import ProfileScreen   from './components/ProfileScreen'
import ProgressScreen  from './components/ProgressScreen'
import ArchivesScreen  from './components/ArchivesScreen'
import SettingsScreen  from './components/SettingsScreen'

// Screens: loading → auth → setup → home
//          home → workout → history → workout
//          home → profile → setup (edit) | progress

export default function App() {
  const [screen,          setScreen]         = useState('loading')
  const [user,            setUser]           = useState(null)
  const [program,         setProgram]        = useState([])
  const [activeDay,       setActiveDay]      = useState(null)
  const [activeExercise,  setActiveExercise] = useState(null)
  const [totalWorkouts,   setTotalWorkouts]  = useState(null)
  const [totalActivities, setTotalActivities] = useState(null)
  const [profile,         setProfile]        = useState(null)

  const screenRef = useRef('loading')
  const go = (s) => { screenRef.current = s; setScreen(s) }

  const loadProgram = useCallback(async () => {
    try {
      const days = await getProgram()
      setProgram(days)
      go(days.length > 0 ? 'home' : 'setup')
    } catch (err) {
      console.error('[App] loadProgram failed:', err.message)
      go('setup')
    }
  }, []) // eslint-disable-line

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
            await loadProgram()
            loadProfile()
            getStats().then(s => { setTotalWorkouts(s.totalWorkouts); setTotalActivities(s.totalActivities) }).catch(() => {})
          } else go('auth')

        } else if (event === 'SIGNED_IN') {
          if (session?.user) {
            setUser(session.user)
            // Only navigate on a real sign-in; token refreshes also fire SIGNED_IN
            // but we must not disrupt an active screen (e.g. mid-workout logging)
            if (screenRef.current === 'auth') {
              await loadProgram()
              loadProfile()
              getStats().then(s => { setTotalWorkouts(s.totalWorkouts); setTotalActivities(s.totalActivities) }).catch(() => {})
            }
          }

        } else if (event === 'SIGNED_OUT') {
          setUser(null); setProgram([]); setActiveDay(null); setTotalWorkouts(null); setTotalActivities(null); setProfile(null)
          go('auth')
        }
      }
    )

    return () => { clearTimeout(fallback); subscription.unsubscribe() }
  }, [loadProgram, loadProfile]) // eslint-disable-line

  // ── Render ────────────────────────────────────────────────────

  if (screen === 'loading') {
    return (
      <div className="splash">
        <div className="splash-logo">💪</div>
        <div className="splash-text">Loading…</div>
      </div>
    )
  }

  if (screen === 'auth') return <AuthScreen />

  if (screen === 'setup') {
    return (
      <ProgramSetup
        userId={user?.id}
        userEmail={user?.email}
        initialDays={program.length > 0 ? program : null}
        isEditing={program.length > 0}
        onComplete={loadProgram}
        onBack={program.length > 0 ? () => go('home') : null}
      />
    )
  }

  if (screen === 'history' && activeExercise) {
    return (
      <ExerciseHistory
        exercise={activeExercise}
        profile={profile}
        onBack={() => go('workout')}
      />
    )
  }

  if (screen === 'workout' && activeDay) {
    return (
      <WorkoutDay
        day={activeDay}
        userId={user?.id}
        profile={profile}
        onBack={() => { setActiveDay(null); go('home') }}
        onHistory={exercise => { setActiveExercise(exercise); go('history') }}
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
        onEditProgram={() => go('setup')}
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
        onProgramUpdated={loadProgram}
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
      onSelectDay={day => { setActiveDay(day); go('workout') }}
      onProfile={() => go('profile')}
    />
  )
}
