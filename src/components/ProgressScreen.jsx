import React, { useState, useEffect } from 'react'
import {
  logBodyWeight, getBodyWeightLogs,
  getExerciseNames, getVolumeHistory,
  getActivityNames, getActivityHistory, bucketActivityByWeek,
  getBodyMeasurements,
  getStrengthHistory,
  getGyms,
} from '../supabase'
import MainLiftsSetup from './MainLiftsSetup'
import {
  displayWeight, parseInputWeight, unitLabel, kgToLbs,
  displayLength, lengthUnitLabel,
  displayDistance, distanceUnitLabel,
  displayElevation, elevationUnitLabel,
} from '../utils/units'
import { formatActivityLine } from '../utils/sessionFormat'

// Body-tab metric definitions. The 'value' getter pulls the right field
// from a row in the right unit. Length fields convert cm → user unit.
const MEASURE_FIELDS = [
  { key: 'neck_cm',          label: 'Neck'        },
  { key: 'chest_cm',         label: 'Chest'       },
  { key: 'waist_cm',         label: 'Waist'       },
  { key: 'glute_cm',         label: 'Glutes'      },
  { key: 'arm_left_cm',      label: 'Arm L'       },
  { key: 'arm_right_cm',     label: 'Arm R'       },
  { key: 'forearm_left_cm',  label: 'Forearm L'   },
  { key: 'forearm_right_cm', label: 'Forearm R'   },
  { key: 'thigh_left_cm',    label: 'Thigh L'     },
  { key: 'thigh_right_cm',   label: 'Thigh R'     },
  { key: 'calf_left_cm',     label: 'Calf L'      },
  { key: 'calf_right_cm',    label: 'Calf R'      },
]

function getToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Generic trend line ────────────────────────────────────────
// data: [{ date: ISO, value: number, color?: string, gymName?: string }] —
//   any order; sorted internally. `color` and `gymName` are optional; when
//   present, the line and dots are coloured per-segment by gym, and the
//   dominant gym for each contiguous run is rendered as a faint label.
//
// Caller is responsible for unit conversion before passing values in.
const UNKNOWN_COLOR = 'var(--accent)'

function TrendLine({ data, fillColor = 'rgba(249,115,22,0.08)', strokeColor = UNKNOWN_COLOR }) {
  if (!data || data.length < 2) return null

  // Render oldest → newest left-to-right.
  const sorted = [...data].sort((a, b) => new Date(a.date) - new Date(b.date))
  const values = sorted.map(d => Number(d.value))
  const rawMin  = Math.min(...values)
  const rawMax  = Math.max(...values)
  const pad     = (rawMax - rawMin) * 0.2 || 0.5
  const yMin    = rawMin - pad
  const yMax    = rawMax + pad
  const range   = yMax - yMin

  const W = 280, H = 130
  const PL = 40, PR = 8, PT = 10, PB = 22
  const plotW = W - PL - PR
  const plotH = H - PT - PB

  const toX = i => PL + (i / (sorted.length - 1)) * plotW
  const toY = v => PT + (1 - (v - yMin) / range) * plotH

  const pts = sorted.map((d, i) => ({
    x:        toX(i),
    y:        toY(values[i]),
    iso:      d.date,
    color:    d.color || null,
    gymName:  d.gymName || null,
    gymKey:   d.color ? d.color : '__none__',
  }))
  // Used for the area fill underneath; one polyline irrespective of segment.
  const polyline = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const guides   = [rawMax, (rawMin + rawMax) / 2, rawMin]
  const midIdx   = Math.floor((sorted.length - 1) / 2)
  const xIdxs    = [...new Set([0, midIdx, sorted.length - 1])]

  // Segment runs: contiguous runs of points with the same gymKey. The line
  // entering point i uses point i's colour, so a segment from run k to run
  // k+1 visually "switches" at the boundary point.
  const segments = []
  for (let i = 1; i < pts.length; i++) {
    segments.push({
      from: pts[i - 1],
      to:   pts[i],
      stroke: pts[i].color || strokeColor,
    })
  }

  // Group points into contiguous runs to label the "dominant" gym for each
  // run. Only render the label when the run is wide enough to fit the name
  // without overflowing — otherwise the chart gets cluttered fast.
  const runs = []
  for (let i = 0; i < pts.length; i++) {
    const last = runs[runs.length - 1]
    if (last && last.gymKey === pts[i].gymKey) last.points.push(pts[i])
    else runs.push({ gymKey: pts[i].gymKey, gymName: pts[i].gymName, color: pts[i].color, points: [pts[i]] })
  }

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
        fill={fillColor}
      />
      {/* Line segments — coloured by the entering point's gym so colour
          switches happen at gym boundaries. */}
      {segments.map((seg, i) => (
        <line key={`s${i}`}
          x1={seg.from.x.toFixed(1)} y1={seg.from.y.toFixed(1)}
          x2={seg.to.x.toFixed(1)}   y2={seg.to.y.toFixed(1)}
          stroke={seg.stroke}
          strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" />
      ))}
      {/* Faint gym labels — one per contiguous run, centered under the run.
          Skipped when the run is narrower than the label can fit. */}
      {runs.map((run, i) => {
        if (!run.gymName) return null
        const xs = run.points.map(p => p.x)
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const w = maxX - minX
        // Heuristic: ~6px per char + breathing room. Skip labels that won't fit.
        if (w < (run.gymName.length * 5 + 8)) return null
        const cx = (minX + maxX) / 2
        return (
          <text key={`gn${i}`}
            x={cx.toFixed(1)}
            y={(PT + plotH - 6).toFixed(1)}
            textAnchor="middle"
            fill={run.color || 'var(--text-muted)'}
            opacity="0.45"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase' }}
          >
            {run.gymName}
          </text>
        )
      })}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(1)} cy={p.y.toFixed(1)}
          r="3" fill={p.color || strokeColor} stroke="var(--bg)" strokeWidth="1.5" />
      ))}
      {xIdxs.map(i => (
        <text key={i} x={toX(i).toFixed(1)} y={H - 5}
          textAnchor={i === 0 ? 'start' : i === sorted.length - 1 ? 'end' : 'middle'}
          className="graph-label">
          {fmtDate(sorted[i].iso)}
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
  const unit    = profile?.weight_unit || 'kg'
  const label   = unitLabel(unit)
  const lenLabel = lengthUnitLabel(unit)
  const [activeTab, setActiveTab] = useState('strength')

  // ── Strength state ──────────────────────────────────────
  // Local mainLifts copy seeded from profile. We mutate this on save so the
  // tab updates instantly without waiting for App to re-fetch profile.
  const [mainLifts,         setMainLifts]      = useState(profile?.main_lifts || [])
  const [strengthSeries,    setStrengthSeries] = useState([])
  const [strengthLoading,   setStrengthLoading] = useState(false)
  const [setupOpen,         setSetupOpen]      = useState(false)

  // ── Gyms (for graph segment colours) ────────────────────
  // Lookup map keyed by gym id → { color, name }. Workouts with a gym_id
  // outside this map (e.g. a since-deleted gym) fall back to a neutral
  // accent colour.
  const [gymMap, setGymMap] = useState({})
  useEffect(() => {
    if (!user?.id) return
    getGyms(user.id)
      .then(list => {
        const m = {}
        for (const g of list) m[g.id] = { color: g.color, name: g.name }
        setGymMap(m)
      })
      .catch(() => {})
  }, [user?.id])

  // ── Body state ────────────────────────────────────────
  // selectedMetric: 'weight' or one of MEASURE_FIELDS keys (e.g. 'waist_cm')
  const [selectedMetric, setSelectedMetric] = useState('weight')
  const [weightLogs,     setWeightLogs]     = useState([])
  const [measurements,   setMeasurements]   = useState([])
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
  const [liftsMetric,       setLiftsMetric]       = useState('volume')  // 'volume' | 'e1rm'
  const [liftsRange,        setLiftsRange]        = useState('6m')      // '4w' | '3m' | '6m' | 'all'
  const [showFormulaInfo,   setShowFormulaInfo]   = useState(false)

  // ── Activities state ────────────────────────────────────
  const [activityNames,    setActivityNames]    = useState([])
  const [selectedActivity, setSelectedActivity] = useState('')
  const [activityHistory,  setActivityHistory]  = useState([])
  const [activityLoading,  setActivityLoading]  = useState(false)
  const [activityError,    setActivityError]    = useState('')

  useEffect(() => {
    if (!user?.id) return
    getBodyWeightLogs(user.id, 52).then(setWeightLogs).catch(() => {})
    getBodyMeasurements(user.id, 52).then(setMeasurements).catch(() => {})
    getExerciseNames(user.id)
      .then(names => {
        setExerciseNames(names)
        if (names.length) setSelectedExercise(names[0])
      })
      .catch(() => {})
    getActivityNames(user.id)
      .then(names => {
        setActivityNames(names)
        if (names.length) setSelectedActivity(names[0])
      })
      .catch(() => {})
  }, [user?.id])

  // Refetch the strength time series whenever the slots change.
  useEffect(() => {
    if (!user?.id) return
    const names = (mainLifts || []).map(s => s.exercise).filter(Boolean)
    if (!names.length) { setStrengthSeries([]); return }
    setStrengthLoading(true)
    getStrengthHistory(user.id, names)
      .then(s => { setStrengthSeries(s); setStrengthLoading(false) })
      .catch(() => { setStrengthLoading(false) })
  }, [user?.id, mainLifts])

  useEffect(() => {
    if (!selectedExercise || !user?.id) return
    setVolumeLoading(true)
    setVolumeError('')
    getVolumeHistory(selectedExercise, user.id)
      .then(data => { setVolumeHistory(data); setVolumeLoading(false) })
      .catch(e  => { setVolumeError(e.message); setVolumeLoading(false) })
  }, [selectedExercise, user?.id])

  useEffect(() => {
    if (!selectedActivity || !user?.id) return
    setActivityLoading(true)
    setActivityError('')
    getActivityHistory(selectedActivity, user.id)
      .then(data => { setActivityHistory(data); setActivityLoading(false) })
      .catch(e  => { setActivityError(e.message); setActivityLoading(false) })
  }, [selectedActivity, user?.id])

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
      setWeightLogs(prev => [saved, ...prev].slice(0, 52))
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

  // ── Lifts tab derived ────────────────────────────────────
  // Date-range filter (client-side) + metric switch (volume vs e1RM). The
  // chart and the history list both read from this filtered+mapped slice.
  const filteredVolumeHistory = (() => {
    if (liftsRange === 'all') return volumeHistory
    const days   = liftsRange === '6m' ? 180 : liftsRange === '3m' ? 90 : 28
    const cutoff = Date.now() - days * 86400000
    return volumeHistory.filter(s => new Date(s.date).getTime() >= cutoff)
  })()
  const liftsSparkValues = [...filteredVolumeHistory].reverse().map(s =>
    liftsMetric === 'volume'
      ? (unit === 'lbs' ? kgToLbs(s.totalVolume) : s.totalVolume)
      : (unit === 'lbs' ? kgToLbs(s.maxE1RMkg || 0) : (s.maxE1RMkg || 0))
  )

  // ── Strength tab derived ─────────────────────────────────
  // Latest snapshot (best e1RM so far per exercise) — drives both the
  // headline score and the per-slot mini-cards.
  const latestSnap   = strengthSeries.length ? strengthSeries[strengthSeries.length - 1] : null
  const latestPerEx  = latestSnap?.perExercise || {}
  const totalE1RMkg  = latestSnap?.totalE1RM || 0
  const totalE1RMDsp = unit === 'lbs' ? kgToLbs(totalE1RMkg) : totalE1RMkg
  const latestBwKg   = weightLogs[0]?.weight_kg ? Number(weightLogs[0].weight_kg) : 0
  const bwRatio      = latestBwKg > 0 ? totalE1RMkg / latestBwKg : null

  // 4-week-ago snapshot for the per-slot delta arrows.
  const fourWeeksAgo = Date.now() - 28 * 86400000
  const snap4wAgo    = (() => {
    let last = null
    for (const s of strengthSeries) {
      if (new Date(s.date).getTime() <= fourWeeksAgo) last = s
      else break
    }
    return last
  })()

  // Trend dataset for the chart, in user's display unit so the y-axis labels
  // line up with the headline score. Each point also carries gym metadata so
  // TrendLine can colour line segments per-gym and label contiguous runs.
  const strengthTrend = strengthSeries.map(s => {
    const g = s.gymId ? gymMap[s.gymId] : null
    return {
      date:    s.date,
      value:   unit === 'lbs' ? kgToLbs(s.totalE1RM) : s.totalE1RM,
      color:   g?.color || null,
      gymName: g?.name  || null,
    }
  })

  // ── Body tab derived ─────────────────────────────────────
  // Measurement fields shown in the dropdown — any field the user has logged
  // at least once, so the option appears after the very first measurement
  // session. The chart itself still requires ≥2 entries before it renders;
  // the empty state nudges the user to log one more.
  const availableMeasureFields = MEASURE_FIELDS.filter(f =>
    measurements.some(m => m[f.key] != null)
  )
  // Build the chart dataset for whichever metric is selected, already in
  // the user's display unit so the y-axis labels match the values shown.
  let bodyDataset = []           // [{ date, value }]
  let bodyUnitLabel = label
  if (selectedMetric === 'weight') {
    bodyDataset = weightLogs.map(l => ({
      date:  l.logged_at,
      value: unit === 'lbs' ? kgToLbs(Number(l.weight_kg)) : Number(l.weight_kg),
    }))
    bodyUnitLabel = label
  } else {
    bodyDataset = measurements
      .filter(m => m[selectedMetric] != null)
      .map(m => ({
        date:  m.measured_at,
        value: parseFloat(displayLength(m[selectedMetric], unit)),
      }))
    bodyUnitLabel = lenLabel
  }
  const bodyHistoryRows = [...bodyDataset]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 12)

  // ── Activity derived stats ─────────────────────────────
  // Primary metric: distance_km if any session has it, else duration_min, else session count.
  const hasDistance = activityHistory.some(s => s.distance_km != null && s.distance_km > 0)
  const hasDuration = activityHistory.some(s => s.duration_min != null && s.duration_min > 0)
  const primaryMetric = hasDistance ? 'distance' : hasDuration ? 'duration' : 'count'

  // Buckets come back newest-first (index 0 = this week).
  const activityWeekly = bucketActivityByWeek(activityHistory, 12)
  // Sparkline reads oldest→newest so time flows left-to-right.
  const activitySparkValues = [...activityWeekly].reverse().map(w => {
    if (primaryMetric === 'distance') return w.totalDistance
    if (primaryMetric === 'duration') return w.totalDuration
    return w.sessionCount
  })

  const thisWeek = activityWeekly[0] || { totalDuration: 0, totalDistance: 0, sessionCount: 0 }
  const last4 = activityWeekly.slice(0, 4)
  const avg4 = last4.length
    ? {
        dur:   last4.reduce((a, w) => a + w.totalDuration, 0) / last4.length,
        dist:  last4.reduce((a, w) => a + w.totalDistance, 0) / last4.length,
        count: last4.reduce((a, w) => a + w.sessionCount, 0) / last4.length,
      }
    : { dur: 0, dist: 0, count: 0 }

  // Notable: longest single distance, or longest duration, or highest rounds.
  const notable = (() => {
    if (hasDistance) {
      const max = Math.max(...activityHistory.map(s => s.distance_km || 0))
      return { label: 'Longest', value: `${displayDistance(max, unit)} ${distanceUnitLabel(unit)}` }
    }
    if (hasDuration) {
      const max = Math.max(...activityHistory.map(s => s.duration_min || 0))
      return { label: 'Longest', value: `${Math.round(max)} min` }
    }
    const hasRounds = activityHistory.some(s => s.rounds != null && s.rounds > 0)
    if (hasRounds) {
      const max = Math.max(...activityHistory.map(s => s.rounds || 0))
      return { label: 'Most rounds', value: String(max) }
    }
    return { label: 'Sessions', value: String(activityHistory.length) }
  })()

  const formatSessionLine = (s) => formatActivityLine(s, unit)

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
          className={`setup-tab ${activeTab === 'strength' ? 'setup-tab--active' : ''}`}
          onClick={() => setActiveTab('strength')}
        >
          Strength
        </button>
        <button
          className={`setup-tab ${activeTab === 'workout' ? 'setup-tab--active' : ''}`}
          onClick={() => setActiveTab('workout')}
        >
          Lifts
        </button>
        <button
          className={`setup-tab ${activeTab === 'body' ? 'setup-tab--active' : ''}`}
          onClick={() => setActiveTab('body')}
        >
          Body
        </button>
        <button
          className={`setup-tab ${activeTab === 'activities' ? 'setup-tab--active' : ''}`}
          onClick={() => setActiveTab('activities')}
        >
          Activities
        </button>
      </div>

      <div className="content">

        {/* ── Strength tab ──────────────────────────────── */}
        {activeTab === 'strength' && (
          <>
            {(!mainLifts || mainLifts.length === 0) ? (
              <div className="strength-empty">
                <div className="strength-empty__icon">🏋️</div>
                <div className="strength-empty__title">Pick the lifts you care about</div>
                <div className="strength-empty__sub">
                  Add 1–6 main lifts (Squat, Bench, Deadlift…) and we'll track your total e1RM over time.
                </div>
                <button className="strength-setup-btn" onClick={() => setSetupOpen(true)}>
                  Set up main lifts
                </button>
              </div>
            ) : (
              <>
                <div className="strength-headline">
                  <div className="strength-headline__top">
                    <span className="strength-headline__label">Strength score</span>
                    <button className="strength-edit-chip" onClick={() => setSetupOpen(true)}>Edit lifts</button>
                  </div>
                  <div className="strength-headline__row">
                    <span className="strength-headline__total">
                      {Math.round(totalE1RMDsp).toLocaleString()} <span className="strength-headline__unit">{label}</span>
                    </span>
                    {bwRatio != null && bwRatio > 0 && (
                      <span className="strength-headline__ratio">· {bwRatio.toFixed(2)}× BW</span>
                    )}
                  </div>
                  <div className="strength-headline__hint">
                    sum of estimated 1-rep max across {mainLifts.length} lift{mainLifts.length === 1 ? '' : 's'}
                  </div>
                </div>

                {strengthTrend.length >= 2 && (
                  <div className="progress-graph-wrap">
                    <TrendLine data={strengthTrend} />
                  </div>
                )}

                {strengthLoading && strengthTrend.length < 2 && (
                  <div className="state-msg state-msg--empty">Loading…</div>
                )}
                {!strengthLoading && strengthTrend.length === 0 && (
                  <div className="state-msg state-msg--empty">
                    Log a working set on any of these lifts to start the trend
                  </div>
                )}

                <div className="strength-slots">
                  {mainLifts.map(lift => {
                    const eKg     = latestPerEx[lift.exercise] || 0
                    const eDsp    = unit === 'lbs' ? kgToLbs(eKg) : eKg
                    const e4wKg   = snap4wAgo?.perExercise?.[lift.exercise] || 0
                    const deltaPct = e4wKg > 0
                      ? ((eKg - e4wKg) / e4wKg) * 100
                      : (eKg > 0 ? 100 : 0)
                    const arrow = deltaPct > 0.5 ? '▲' : deltaPct < -0.5 ? '▼' : '•'
                    const deltaCls = deltaPct > 0.5 ? 'up' : deltaPct < -0.5 ? 'down' : 'flat'
                    return (
                      <button
                        key={lift.slot + ':' + lift.exercise}
                        className="strength-slot"
                        onClick={() => {
                          setSelectedExercise(lift.exercise)
                          setActiveTab('workout')
                        }}
                      >
                        <div className="strength-slot__name">{lift.slot}</div>
                        <div className="strength-slot__exname">{lift.exercise}</div>
                        <div className="strength-slot__val">
                          {eKg > 0
                            ? <>{Math.round(eDsp).toLocaleString()} <span className="strength-slot__unit">{label}</span></>
                            : <span className="strength-slot__nodata">— no data —</span>}
                        </div>
                        {eKg > 0 && (
                          <div className={`strength-slot__delta strength-slot__delta--${deltaCls}`}>
                            {arrow} {Math.abs(deltaPct).toFixed(1)}%
                            <span className="strength-slot__delta-label"> · 4w</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ── Body tab ──────────────────────────────────── */}
        {activeTab === 'body' && (
          <>
            <select
              className="field-input volume-select"
              value={selectedMetric}
              onChange={e => setSelectedMetric(e.target.value)}
            >
              <option value="weight">Body weight</option>
              {availableMeasureFields.map(f => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>

            {bodyDataset.length >= 2 ? (
              <div className="progress-graph-wrap">
                <TrendLine data={bodyDataset} />
              </div>
            ) : (
              <div className="state-msg state-msg--empty">
                {bodyDataset.length === 0
                  ? (selectedMetric === 'weight'
                      ? 'No entries yet — log your first weight below'
                      : 'No entries for this metric yet')
                  : 'Log one more entry to see your trend'}
              </div>
            )}

            {/* Bodyweight log form is only on this metric — measurements are
                logged from the Profile screen. */}
            {selectedMetric === 'weight' && (
              <>
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
              </>
            )}

            {bodyHistoryRows.length > 0 && (
              <div className="weight-history-list" style={{ marginTop: 16 }}>
                {bodyHistoryRows.map((row, i) => (
                  <div key={`${row.date}-${i}`} className="weight-history-item">
                    <span className="weight-history-date">{fmtDate(row.date)}</span>
                    <span className="weight-history-val">
                      {Number.isInteger(row.value) ? row.value : row.value.toFixed(1)} {bodyUnitLabel}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Lifts tab ─────────────────────────────────── */}
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

                {/* Metric + range controls */}
                <div className="lifts-controls">
                  <div className="lifts-toggle" role="tablist">
                    <button
                      className={`lifts-toggle__btn${liftsMetric === 'volume' ? ' lifts-toggle__btn--on' : ''}`}
                      onClick={() => setLiftsMetric('volume')}
                    >Volume</button>
                    <button
                      className={`lifts-toggle__btn${liftsMetric === 'e1rm' ? ' lifts-toggle__btn--on' : ''}`}
                      onClick={() => setLiftsMetric('e1rm')}
                    >e1RM</button>
                  </div>
                  <div className="lifts-range">
                    {[
                      { k: '4w',  l: '4w'  },
                      { k: '3m',  l: '3m'  },
                      { k: '6m',  l: '6m'  },
                      { k: 'all', l: 'All' },
                    ].map(({ k, l }) => (
                      <button
                        key={k}
                        className={`lifts-range__btn${liftsRange === k ? ' lifts-range__btn--on' : ''}`}
                        onClick={() => setLiftsRange(k)}
                      >{l}</button>
                    ))}
                  </div>
                  <button
                    className="lifts-info-btn"
                    onClick={() => setShowFormulaInfo(true)}
                    aria-label="How are PRs and e1RM calculated?"
                    title="How are PRs and e1RM calculated?"
                  >ⓘ</button>
                </div>

                {volumeLoading && (
                  <div className="state-msg state-msg--empty">Loading…</div>
                )}
                {volumeError && (
                  <div className="err-msg" style={{ textAlign: 'left' }}>{volumeError}</div>
                )}

                {!volumeLoading && !volumeError && (
                  <>
                    {liftsSparkValues.length >= 2 && (
                      <div className="sparkline-wrap">
                        <Sparkline
                          values={liftsSparkValues}
                          color={liftsMetric === 'volume' ? '#3b82f6' : '#FFB800'}
                        />
                      </div>
                    )}
                    {filteredVolumeHistory.length > 0 ? (
                      <div className="weight-history-list">
                        {filteredVolumeHistory.map(s => {
                          const valKg = liftsMetric === 'volume' ? s.totalVolume : (s.maxE1RMkg || 0)
                          const val   = unit === 'lbs' ? kgToLbs(valKg) : valKg
                          const suffix = liftsMetric === 'volume' ? `${label}·reps` : label
                          return (
                            <div key={s.workoutId} className="weight-history-item">
                              <span className="weight-history-date">{fmtDate(s.date)}</span>
                              <span className="weight-history-val">
                                {valKg > 0
                                  ? <>{Math.round(val).toLocaleString()} {suffix}</>
                                  : '—'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="state-msg state-msg--empty">
                        {volumeHistory.length === 0
                          ? 'No sessions logged yet'
                          : 'No sessions in this range'}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* ── Activities tab ────────────────────────────── */}
        {activeTab === 'activities' && (
          <>
            {activityNames.length === 0 ? (
              <div className="state-msg state-msg--empty">No activities in your program yet</div>
            ) : (
              <>
                <select
                  className="field-input volume-select"
                  value={selectedActivity}
                  onChange={e => setSelectedActivity(e.target.value)}
                >
                  {activityNames.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>

                {activityLoading && (
                  <div className="state-msg state-msg--empty">Loading…</div>
                )}
                {activityError && (
                  <div className="err-msg" style={{ textAlign: 'left' }}>{activityError}</div>
                )}

                {!activityLoading && !activityError && (
                  <>
                    {activityHistory.length < 2 ? (
                      <div className="state-msg state-msg--empty">
                        {activityHistory.length === 0
                          ? 'No sessions logged yet'
                          : 'Log one more session to see your trend'}
                      </div>
                    ) : (
                      <>
                        {activitySparkValues.some(v => v > 0) && (
                          <div className="sparkline-wrap">
                            <Sparkline values={activitySparkValues} color="#00C2A8" />
                          </div>
                        )}

                        <div className="progress-stat-row">
                          <div className="progress-stat-box">
                            <div className="progress-stat-label">This week</div>
                            <div className="progress-stat-value">
                              {primaryMetric === 'distance'
                                ? `${displayDistance(thisWeek.totalDistance, unit)} ${distanceUnitLabel(unit)}`
                                : primaryMetric === 'duration'
                                ? `${Math.round(thisWeek.totalDuration)} min`
                                : `${thisWeek.sessionCount} ${thisWeek.sessionCount === 1 ? 'session' : 'sessions'}`}
                            </div>
                          </div>
                          <div className="progress-stat-box">
                            <div className="progress-stat-label">4-wk avg</div>
                            <div className="progress-stat-value">
                              {primaryMetric === 'distance'
                                ? `${displayDistance(avg4.dist, unit)} ${distanceUnitLabel(unit)}`
                                : primaryMetric === 'duration'
                                ? `${Math.round(avg4.dur)} min`
                                : `${avg4.count.toFixed(1)}/wk`}
                            </div>
                          </div>
                          <div className="progress-stat-box">
                            <div className="progress-stat-label">{notable.label}</div>
                            <div className="progress-stat-value">{notable.value}</div>
                          </div>
                        </div>
                      </>
                    )}

                    {activityHistory.length > 0 && (
                      <div className="weight-history-list" style={{ marginTop: 16 }}>
                        {activityHistory.map((s, i) => {
                          const line = formatSessionLine(s)
                          return (
                            <div key={`${s.date}-${i}`} className="weight-history-item">
                              <span className="weight-history-date">{fmtDate(s.date)}</span>
                              <span className="weight-history-val">
                                {line || (s.checked ? 'done' : '—')}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        <div style={{ height: 40 }} />
      </div>

      <MainLiftsSetup
        open={setupOpen}
        initialSlots={mainLifts}
        userId={user?.id}
        onClose={() => setSetupOpen(false)}
        onSaved={(slots) => setMainLifts(slots)}
      />

      {showFormulaInfo && (
        <div className="modal-backdrop" onClick={() => setShowFormulaInfo(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">How PRs and e1RM work</h3>
            <p className="modal-body">
              <strong>PRs</strong> are detected three ways, in priority order:
              <br />· <strong>Weight PR</strong> — heaviest weight ever for that lift.
              <br />· <strong>Reps PR</strong> — most reps you've done at that exact weight.
              <br />· <strong>e1RM PR</strong> — highest estimated 1-rep max.
              <br /><br />
              <strong>e1RM</strong> uses the Epley formula: <em>weight × (1 + reps / 30)</em>.
              The same formula is used for every exercise.
              <br /><br />
              Warmup sets and drop sets are excluded from PRs and e1RM. Drop sets still
              count toward total volume since they're real work.
            </p>
            <div className="modal-actions">
              <button className="modal-btn-primary" onClick={() => setShowFormulaInfo(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
