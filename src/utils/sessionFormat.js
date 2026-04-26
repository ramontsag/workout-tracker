// Shared formatters for activity-style log rows. Used by ProgressScreen
// (per-session list) and ExerciseHistory (per-row in an activity's history).
//
// Activity rows on workout_sets are stored with weight_kg = 0, reps = 0,
// and the activity-specific fields populated. isActivityRow distinguishes
// them from real exercise sets.

import {
  displayDistance, distanceUnitLabel,
  displayElevation, elevationUnitLabel,
} from './units'

export function formatActivityLine(s, unit) {
  const parts = []
  if (s.distance_km  != null && s.distance_km  > 0) parts.push(`${displayDistance(s.distance_km, unit)} ${distanceUnitLabel(unit)}`)
  if (s.duration_min != null && s.duration_min > 0) parts.push(`${Math.round(s.duration_min)} min`)
  if (s.intensity    != null && s.intensity    > 0) parts.push(`${s.intensity}/5`)
  if (s.avg_hr       != null && s.avg_hr       > 0) parts.push(`${s.avg_hr} bpm`)
  if (s.calories     != null && s.calories     > 0) parts.push(`${s.calories} kcal`)
  if (s.rounds       != null && s.rounds       > 0) parts.push(`${s.rounds} rds`)
  if (s.elevation_m  != null && s.elevation_m  > 0) parts.push(`${displayElevation(s.elevation_m, unit)} ${elevationUnitLabel(unit)}`)
  return parts.join(' · ')
}

export function isActivityRow(s) {
  const noLoad = (s.weight_kg == null || s.weight_kg === 0) &&
                 (s.reps      == null || s.reps      === 0)
  const hasActivityField = !!(
    s.duration_min || s.distance_km || s.intensity ||
    s.avg_hr || s.calories || s.rounds || s.elevation_m ||
    s.checked || (s.notes && s.notes.length)
  )
  return noLoad && hasActivityField
}
