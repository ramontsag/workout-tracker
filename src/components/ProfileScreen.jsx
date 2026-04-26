import React, { useState, useEffect } from 'react'
import { getProfile, signOut, saveWeeklyTarget, submitFeedback } from '../supabase'

export default function ProfileScreen({ user, totalWorkouts, totalActivities, onBack, onProgress, onArchives, onSettings }) {
  const [profile,        setProfile]       = useState(null)
  const [signingOut,     setSigningOut]    = useState(false)
  const [weeklyTarget,   setWeeklyTarget]  = useState(4)
  const [targetSaving,   setTargetSaving]  = useState(false)
  const [feedbackOpen,   setFeedbackOpen]  = useState(false)
  const [feedbackText,   setFeedbackText]  = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('idle') // idle | saving | done | error
  const [feedbackError,  setFeedbackError] = useState('')

  useEffect(() => {
    getProfile().then(p => {
      setProfile(p)
      if (p?.weekly_target != null) setWeeklyTarget(p.weekly_target)
    }).catch(() => {})
  }, [user?.id])

  const handleTargetChange = async (delta) => {
    const next = Math.max(1, Math.min(7, weeklyTarget + delta))
    if (next === weeklyTarget || targetSaving) return
    setWeeklyTarget(next)
    setTargetSaving(true)
    try {
      await saveWeeklyTarget(next, user.id)
    } catch {
      setWeeklyTarget(weeklyTarget)
    } finally {
      setTargetSaving(false)
    }
  }

  const openFeedback = () => {
    setFeedbackText('')
    setFeedbackError('')
    setFeedbackStatus('idle')
    setFeedbackOpen(true)
  }

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) { setFeedbackError('Please enter a message'); return }
    setFeedbackStatus('saving')
    setFeedbackError('')
    try {
      await submitFeedback(feedbackText, user.id)
      setFeedbackStatus('done')
    } catch (e) {
      setFeedbackError(e.message)
      setFeedbackStatus('error')
    }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try { await signOut() } catch { setSigningOut(false) }
  }

  const displayName = profile?.name || user?.user_metadata?.name || 'Athlete'
  const initials    = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Profile</div>
        </div>
      </header>

      <div className="content">

        {/* Avatar + name */}
        <div className="profile-hero">
          <div className="profile-avatar">{initials}</div>
          <div className="profile-name">{displayName}</div>
          <div className="profile-email">{user?.email}</div>
        </div>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{totalWorkouts ?? '—'}</div>
            <div className="stat-label">Workouts</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{totalActivities ?? '—'}</div>
            <div className="stat-label">Activities</div>
          </div>
        </div>

        {/* Actions */}
        <div className="profile-actions">
          <button className="profile-action-btn" onClick={onProgress}>
            <span className="profile-action-icon">📈</span>
            <span className="profile-action-text">
              <span className="profile-action-title">Progress</span>
              <span className="profile-action-sub">Weight trend & workout volume</span>
            </span>
            <span className="profile-action-chevron">›</span>
          </button>

          <button className="profile-action-btn" style={{ marginTop: 8 }} onClick={onArchives}>
            <span className="profile-action-icon">🗂️</span>
            <span className="profile-action-text">
              <span className="profile-action-title">Saved Workouts</span>
              <span className="profile-action-sub">Your saved workout plans</span>
            </span>
            <span className="profile-action-chevron">›</span>
          </button>

          <button className="profile-action-btn" style={{ marginTop: 8 }} onClick={onSettings}>
            <span className="profile-action-icon">⚙️</span>
            <span className="profile-action-text">
              <span className="profile-action-title">Settings</span>
              <span className="profile-action-sub">Units &amp; intensity tracking</span>
            </span>
            <span className="profile-action-chevron">›</span>
          </button>

          <div className="target-row">
            <div className="target-row-left">
              <span className="target-row-title">Weekly Target</span>
              <span className="target-row-sub">sessions per week</span>
            </div>
            <div className="target-stepper">
              <button
                className="stepper-btn"
                onClick={() => handleTargetChange(-1)}
                disabled={weeklyTarget <= 1 || targetSaving}
                aria-label="Decrease target"
              >−</button>
              <span className="stepper-val">{weeklyTarget}</span>
              <button
                className="stepper-btn"
                onClick={() => handleTargetChange(+1)}
                disabled={weeklyTarget >= 7 || targetSaving}
                aria-label="Increase target"
              >+</button>
            </div>
          </div>
        </div>

        {/* Sign out */}
        <button
          className="signout-btn"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>

        <button className="feedback-btn" onClick={openFeedback}>
          Send feedback or suggestion
        </button>

        <div style={{ height: 48 }} />
      </div>

      {/* Feedback modal */}
      {feedbackOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setFeedbackOpen(false) }}>
          <div className="modal">
            {feedbackStatus === 'done' ? (
              <>
                <div className="modal-title">Thanks for your feedback!</div>
                <p className="modal-body-text">Your message has been received. We read every submission.</p>
                <button className="modal-primary-btn" onClick={() => setFeedbackOpen(false)}>Done</button>
              </>
            ) : (
              <>
                <div className="modal-title">Send feedback</div>
                <textarea
                  className="modal-textarea"
                  placeholder="What's on your mind? Bugs, ideas, requests…"
                  value={feedbackText}
                  onChange={e => { setFeedbackText(e.target.value); setFeedbackError('') }}
                  rows={5}
                  autoFocus
                />
                {feedbackError && <div className="err-msg" style={{ marginTop: 4 }}>{feedbackError}</div>}
                <div className="modal-actions">
                  <button
                    className="modal-primary-btn"
                    onClick={handleFeedbackSubmit}
                    disabled={feedbackStatus === 'saving'}
                  >
                    {feedbackStatus === 'saving' ? 'Sending…' : 'Send'}
                  </button>
                  <button className="modal-cancel-btn" onClick={() => setFeedbackOpen(false)}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
