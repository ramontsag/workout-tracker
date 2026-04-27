import React, { useState, useEffect } from 'react'
import { getProfile, signOut, saveWeeklyTarget, submitFeedback, getLatestBodyMeasurement, logBodyMeasurements } from '../supabase'
import { displayLength, parseInputLength, lengthUnitLabel } from '../utils/units'

// Body-measurement field config — drives both the form and the summary line.
const MEASURE_SINGLE = [
  { key: 'neck_cm',  label: 'Neck'   },
  { key: 'chest_cm', label: 'Chest'  },
  { key: 'waist_cm', label: 'Waist'  },
  { key: 'glute_cm', label: 'Glutes' },
]
const MEASURE_PAIRED = [
  { keyL: 'arm_left_cm',     keyR: 'arm_right_cm',     label: 'Arm'     },
  { keyL: 'forearm_left_cm', keyR: 'forearm_right_cm', label: 'Forearm' },
  { keyL: 'thigh_left_cm',   keyR: 'thigh_right_cm',   label: 'Thigh'   },
  { keyL: 'calf_left_cm',    keyR: 'calf_right_cm',    label: 'Calf'    },
]
const ALL_MEASURE_KEYS = [
  ...MEASURE_SINGLE.map(f => f.key),
  ...MEASURE_PAIRED.flatMap(f => [f.keyL, f.keyR]),
]

function relTime(iso) {
  if (!iso) return ''
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0)  return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7)   return `${days}d ago`
  if (days < 30)  return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

// Pick the first 2 fields with values for the collapsed summary.
function measurementsSummary(last, unit) {
  if (!last) return null
  const lbl = lengthUnitLabel(unit)
  const parts = []
  for (const f of MEASURE_SINGLE) {
    if (parts.length >= 2) break
    if (last[f.key] != null) parts.push(`${f.label} ${displayLength(last[f.key], unit)}${lbl}`)
  }
  if (parts.length < 2) {
    for (const f of MEASURE_PAIRED) {
      if (parts.length >= 2) break
      const v = last[f.keyL] ?? last[f.keyR]
      if (v != null) parts.push(`${f.label} ${displayLength(v, unit)}${lbl}`)
    }
  }
  return parts
}

export default function ProfileScreen({ user, totalWorkouts, totalActivities, onBack, onProgress, onArchives, onSettings }) {
  const [profile,        setProfile]       = useState(null)
  const [signingOut,     setSigningOut]    = useState(false)
  const [weeklyTarget,   setWeeklyTarget]  = useState(4)
  const [targetSaving,   setTargetSaving]  = useState(false)
  const [feedbackOpen,   setFeedbackOpen]  = useState(false)
  const [feedbackText,   setFeedbackText]  = useState('')
  const [feedbackStatus, setFeedbackStatus] = useState('idle') // idle | saving | done | error
  const [feedbackError,  setFeedbackError] = useState('')

  // Body measurements
  const unit = profile?.weight_unit || 'kg'
  const [lastMeasure,     setLastMeasure]     = useState(null)
  const [showMeasureForm, setShowMeasureForm] = useState(false)
  const [measureInputs,   setMeasureInputs]   = useState({})
  const [measureNotes,    setMeasureNotes]    = useState('')
  const [measureSaving,   setMeasureSaving]   = useState(false)
  const [measureError,    setMeasureError]    = useState('')

  useEffect(() => {
    getProfile().then(p => {
      setProfile(p)
      if (p?.weekly_target != null) setWeeklyTarget(p.weekly_target)
    }).catch(() => {})
    if (user?.id) {
      getLatestBodyMeasurement(user.id).then(setLastMeasure).catch(() => {})
    }
  }, [user?.id])

  const handleLogMeasurements = async () => {
    const payload = {}
    let count = 0
    for (const k of ALL_MEASURE_KEYS) {
      const raw = measureInputs[k]
      if (raw === '' || raw == null) continue
      const cm = parseInputLength(raw, unit)
      if (isNaN(cm) || cm <= 0) {
        setMeasureError(`Invalid value for ${k.replace(/_cm$/, '').replace(/_/g, ' ')}`)
        return
      }
      payload[k] = cm
      count++
    }
    if (count === 0) {
      setMeasureError('Fill in at least one measurement')
      return
    }
    if (measureNotes.trim()) payload.notes = measureNotes.trim()

    setMeasureSaving(true)
    setMeasureError('')
    try {
      const saved = await logBodyMeasurements(payload, user.id)
      setLastMeasure(saved)
      setMeasureInputs({})
      setMeasureNotes('')
      setShowMeasureForm(false)
    } catch (e) {
      setMeasureError(e.message)
    } finally {
      setMeasureSaving(false)
    }
  }

  const handleTargetChange = async (delta) => {
    // Cap at 14 — sessions, not days. Activities count separately so users
    // doing 1 lift + 1 activity per day can reach 14 sessions/week.
    const next = Math.max(1, Math.min(14, weeklyTarget + delta))
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

        {/* ── Measurements bar ───────────────────────────── */}
        <div className="weight-bar measure-bar" style={{ margin: '12px 0 10px' }}>
          <div className="weight-bar-inner">
            <div className="weight-bar-left">
              <div className="weight-bar-label">Body measurements</div>
              <span className="weight-bar-reading">
                {lastMeasure ? (() => {
                  const parts = measurementsSummary(lastMeasure, unit)
                  return (
                    <>
                      {parts && parts.length > 0 ? parts.join(' · ') : 'Logged'}
                      {' '}<span className="weight-bar-dot">·</span>{' '}
                      {relTime(lastMeasure.measured_at)}
                    </>
                  )
                })() : <span className="weight-bar-empty">No log yet</span>}
              </span>
            </div>
            <button
              className={`weight-bar-btn ${showMeasureForm ? 'weight-bar-btn--cancel' : ''}`}
              onClick={() => { setShowMeasureForm(f => !f); setMeasureError('') }}
            >
              {showMeasureForm ? 'Cancel' : 'LOG IT'}
            </button>
          </div>

          {showMeasureForm && (
            <div className="weight-bar-form measure-form">
              {MEASURE_SINGLE.map(f => (
                <div key={f.key} className="measure-row">
                  <label className="measure-row__label">{f.label}</label>
                  <input
                    className="field-input measure-input"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    placeholder={lengthUnitLabel(unit)}
                    value={measureInputs[f.key] ?? ''}
                    onChange={e => {
                      const v = e.target.value
                      setMeasureInputs(prev => ({ ...prev, [f.key]: v }))
                      setMeasureError('')
                    }}
                  />
                  <span className="measure-row__unit">{lengthUnitLabel(unit)}</span>
                </div>
              ))}
              {MEASURE_PAIRED.map(f => (
                <div key={f.keyL} className="measure-row measure-row--paired">
                  <label className="measure-row__label">{f.label}</label>
                  <span className="measure-row__side">L</span>
                  <input
                    className="field-input measure-input"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    placeholder={lengthUnitLabel(unit)}
                    value={measureInputs[f.keyL] ?? ''}
                    onChange={e => {
                      const v = e.target.value
                      setMeasureInputs(prev => ({ ...prev, [f.keyL]: v }))
                      setMeasureError('')
                    }}
                  />
                  <span className="measure-row__side">R</span>
                  <input
                    className="field-input measure-input"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    placeholder={lengthUnitLabel(unit)}
                    value={measureInputs[f.keyR] ?? ''}
                    onChange={e => {
                      const v = e.target.value
                      setMeasureInputs(prev => ({ ...prev, [f.keyR]: v }))
                      setMeasureError('')
                    }}
                  />
                  <span className="measure-row__unit">{lengthUnitLabel(unit)}</span>
                </div>
              ))}
              <textarea
                className="field-input measure-notes"
                placeholder="Notes (optional)…"
                value={measureNotes}
                onChange={e => setMeasureNotes(e.target.value)}
                rows={2}
              />
              {measureError && <div className="weight-bar-error">{measureError}</div>}
              <button
                className="weight-bar-save"
                onClick={handleLogMeasurements}
                disabled={measureSaving}
              >
                {measureSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
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
                disabled={weeklyTarget >= 14 || targetSaving}
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
