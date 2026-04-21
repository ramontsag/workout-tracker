import React, { useState, useEffect } from 'react'
import {
  logBodyWeight, getBodyWeightLogs,
  getExerciseNames, getVolumeHistory,
} from '../supabase'
import { displayWeight, parseInputWeight, unitLabel, kgToLbs } from '../utils/units'

function getToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Weight line graph ─────────────────────────────────────────
// Weights stored in kg; convert for display based on user's unit preference.
function WeightGraph({ logs, unit }) {
  if (!logs || logs.length < 2) return null

  const data    = [...logs].reverse()
  const weights = data.map(l => unit === 'lbs' ? kgToLbs(Number(l.weight_kg)) : Number(l.weight_kg))
  const rawMin  = Math.min(...weights)
  const rawMax  = Math.max(...weights)
  const pad     = (rawMax - rawMin) * 0.2 || 0.5
  const yMin    = rawMin - pad
  const yMax    = rawMax + pad
  const range   = yMax - yMin

  const W = 280, H = 130
  const PL = 40, PR = 8, PT = 10, PB = 22
  const plotW = W - PL - PR
  const plotH = H - PT - PB

  const toX = i => PL + (i / (data.length - 1)) * plotW
  const toY = v => PT + (1 - (v - yMin) / range) * plotH

  const pts      = data.map((l, i) => ({ x: toX(i), y: toY(weights[i]), iso: l.logged_at }))
  const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const guides   = [rawMax, (rawMin + rawMax) / 2, rawMin]
  const midIdx   = Math.floor((data.length - 1) / 2)
  const xIdxs    = [...new Set([0, midIdx, data.length - 1])]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="weight-graph">
      {guides.map((v, i) => (
        <line key={i}
          x1={PL} y1={toY(v).toFixed(1)} x2={W - PR} y2={toY(v).toFixed(1)}
          stroke="var(--border)" strokeWidth="1" />
      ))}
      {guides.map((v, i) => (
        <text key={i} x={PL - 5} y={(toY(v) + 3.5).toFixed(1)}
          textAnchor="end" className="graph-label">
          {v.toFixed(1)}
        </text>
      ))}
      <polygon
        points={`${PL},${(PT + plotH).toFixed(1)} ${polyline} ${(W - PR).toFixed(1)},${(PT + plotH).toFixed(1)}`}
        fill="rgba(249,115,22,0.08)"
      />
      <polyline points={polyline} fill="none"
        stroke="var(--accent)" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)}
          r="3" fill="var(--accent)" stroke="var(--bg)" strokeWidth="1.5" />
      ))}
      {xIdxs.map(i => (
        <text key={i} x={toX(i).toFixed(1)} y={H - 5}
          textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
          className="graph-label">
          {fmtDate(data[i].iso)}
        </text>
      ))}
    </svg>
  )
}

// ── Sparkline for volume tab ──────────────────────────────────
function Sparkline({ values, color = 'var(--accent)' }) {
  if (!values || values.length < 2) return null
  const W = 100, H = 36, PAD = 3
  const min   = Math.min(...values)
  const max   = Math.max(...values)
  const range = max - min || 1
  const pts   = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2)
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="sparkline">
      <polyline points={pts} fill="none" stroke={color}
        strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────
export default function ProgressScreen({ user, profile, onBack }) {
  const unit  = profile?.weight_unit || 'kg'
  const label = unitLabel(unit)
  const [activeTab, setActiveTab] = useState('weight')

  // ── Weight state ────────────────────────────────────────
  const [weightLogs,     setWeightLogs]     = useState([])
  const [showWeightForm, setShowWeightForm] = useState(false)
  const [weightInput,    setWeightInput]    = useState('')
  const [dateInput,      setDateInput]      = useState(getToday)
  const [weightSaving,   setWeightSaving]   = useState(false)
  const [weightError,    setWeightError]    = useState('')

  // ── Volume state ────────────────────────────────────────
  const [exerciseNames,     setExerciseNames]     = useState([])
  const [selectedExercise,  setSelectedExercise]  = useState('')
  const [volumeHistory,     setVolumeHistory]     = useState([])
  const [volumeLoading,     setVolumeLoading]     = useState(false)
  const [volumeError,       setVolumeError]       = useState('')

  useEffect(() => {
    if (!user?.id) return
    getBodyWeightLogs(user.id, 12).then(setWeightLogs).catch(() => {})
    getExerciseNames(user.id)
      .then(names => {
        setExerciseNames(names)
        if (names.length) setSelectedExercise(names[0])
      })
      .catch(() => {})
  }, [user?.id])

  useEffect(() => {
    if (!selectedExercise || !user?.id) return
    setVolumeLoading(true)
    setVolumeError('')
    getVolumeHistory(selectedExercise, user.id)
      .then(data => { setVolumeHistory(data); setVolumeLoading(false) })
      .catch(e  => { setVolumeError(e.message); setVolumeLoading(false) })
  }, [selectedExercise, user?.id])

  const handleLogWeight = async () => {
    const kg = parseInputWeight(weightInput, unit)
    if (isNaN(kg) || kg <= 0) { setWeightError('Enter a valid weight'); return }
    setWeightSaving(true)
    setWeightError('')
    try {
      const saved = await logBodyWeight(
        kg,
        new Date(dateInput + 'T12:00:00').toISOString(),
        null,
        user.id
      )
      setWeightLogs(prev => [saved, ...prev].slice(0, 12))
      setWeightInput('')
      setDateInput(getToday())
      setShowWeightForm(false)
    } catch (e) {
      setWeightError(e.message)
    } finally {
      setWeightSaving(false)
    }
  }

  // Volume sparkline values — raw kg·reps numbers. The chart is relative so
  // unit conversion here would only change the y-axis scale, not shape.
  const volumeSparkValues = [...volumeHistory].reverse().map(s => s.totalVolume)

  return (
    <div className="screen">
      <header className="sub-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <div className="sub-header__info">
          <div className="sub-header__title">Progress</div>
        </div>
      </header>

      {/* ── Tabs ──────────────────────────────────────────── */}
      <div className="setup-tabs">
        <button
          className={`setup-tab ${activeTab === 'weight' ? 'setup-tab--active' : ''}`}
          onClick={() => setActiveTab('weight')}
        >
          Weight
        </button>
        <button
          className={`setup-tab ${activeTab === 'workout' ? 'setup-tab--active' : ''}`}
          onClick={() => setActiveTab('workout')}
        >
          Workout
        </button>
      </div>

      <div className="content">

        {/* ── Weight tab ────────────────────────────────── */}
        {activeTab === 'weight' && (
          <>
            {weightLogs.length >= 2 ? (
              <div className="progress-graph-wrap">
                <WeightGraph logs={weightLogs} unit={unit} />
              </div>
            ) : (
              <div className="state-msg state-msg--empty">
                {weightLogs.length === 0
                  ? 'No entries yet — log your first weight below'
                  : 'Log one more entry to see your trend'}
              </div>
            )}

            <button
              className={`weight-toggle-btn ${showWeightForm ? 'weight-toggle-btn--cancel' : ''}`}
              onClick={() => { setShowWeightForm(f => !f); setWeightError('') }}
            >
              {showWeightForm ? 'Cancel' : '+ Log Weight'}
            </button>

            {showWeightForm && (
              <div className="weight-form" style={{ marginTop: 10 }}>
                <div className="weight-form-row">
                  <div className="weight-form-field">
                    <label className="field-label">Weight ({label})</label>
                    <input
                      className="field-input"
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      placeholder={unit === 'lbs' ? 'e.g. 182' : 'e.g. 82.5'}
                      value={weightInput}
                      onChange={e => { setWeightInput(e.target.value); setWeightError('') }}
                      onKeyDown={e => e.key === 'Enter' && handleLogWeight()}
                      autoFocus
                    />
                  </div>
                  <div className="weight-form-field">
                    <label className="field-label">Date</label>
                    <input
                      className="field-input"
                      type="date"
                      value={dateInput}
                      onChange={e => setDateInput(e.target.value)}
                    />
                  </div>
                </div>
                {weightError && (
                  <div className="err-msg" style={{ textAlign: 'left', marginTop: 0 }}>{weightError}</div>
                )}
                <button
                  className="weight-log-btn"
                  onClick={handleLogWeight}
                  disabled={weightSaving}
                >
                  {weightSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            )}

            {weightLogs.length > 0 && (
              <div className="weight-history-list" style={{ marginTop: 16 }}>
                {weightLogs.slice(0, 12).map(entry => (
                  <div key={entry.id} className="weight-history-item">
                    <span className="weight-history-date">{fmtDate(entry.logged_at)}</span>
                    <span className="weight-history-val">{displayWeight(Number(entry.weight_kg), unit)} {label}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Workout tab ───────────────────────────────── */}
        {activeTab === 'workout' && (
          <>
            {exerciseNames.length === 0 ? (
              <div className="state-msg state-msg--empty">No exercises in your program yet</div>
            ) : (
              <>
                <select
                  className="field-input volume-select"
                  value={selectedExercise}
                  onChange={e => setSelectedExercise(e.target.value)}
                >
                  {exerciseNames.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>

                {volumeLoading && (
                  <div className="state-msg state-msg--empty">Loading…</div>
                )}
                {volumeError && (
                  <div className="err-msg" style={{ textAlign: 'left' }}>{volumeError}</div>
                )}

                {!volumeLoading && !volumeError && (
                  <>
                    {volumeSparkValues.length >= 2 && (
                      <div className="sparkline-wrap">
                        <Sparkline values={volumeSparkValues} color="#3b82f6" />
                      </div>
                    )}
                    {volumeHistory.length > 0 ? (
                      <div className="weight-history-list">
                        {volumeHistory.map(s => {
                          const vol = unit === 'lbs' ? kgToLbs(s.totalVolume) : s.totalVolume
                          return (
                            <div key={s.workoutId} className="weight-history-item">
                              <span className="weight-history-date">{fmtDate(s.date)}</span>
                              <span className="weight-history-val">
                                {Math.round(vol).toLocaleString()} {label}·reps
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="state-msg state-msg--empty">No sessions logged yet</div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        <div style={{ height: 40 }} />
      </div>
    </div>
  )
}
