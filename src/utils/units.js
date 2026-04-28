// Weight is stored in kg in the DB. Display and input layers convert
// based on the user's `weight_unit` preference ('kg' | 'lbs').

const KG_PER_LB = 0.45359237

export const kgToLbs = (kg) => kg / KG_PER_LB
export const lbsToKg = (lb) => lb * KG_PER_LB

export const unitLabel = (unit) => (unit === 'lbs' ? 'lb' : 'kg')

// For display. Accepts a kg number, returns a string in the user's unit.
// Trims trailing .0, rounds to 1 decimal.
export function displayWeight(kg, unit) {
  if (kg == null || kg === '' || isNaN(kg)) return ''
  const val = unit === 'lbs' ? kgToLbs(Number(kg)) : Number(kg)
  const rounded = Math.round(val * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

// Parse a raw input string in the user's unit and return kg (number or NaN).
export function parseInputWeight(raw, unit) {
  const n = parseFloat(raw)
  if (isNaN(n)) return NaN
  return unit === 'lbs' ? lbsToKg(n) : n
}

// Inverse of displayWeight — takes kg, returns a string formatted for a
// prefilled input field in the user's unit. Empty string for 0/null.
export function kgToInputValue(kg, unit) {
  if (kg == null || kg === 0 || kg === '') return ''
  return displayWeight(kg, unit)
}

// ── Distance (km ↔ mi) ──────────────────────────────────────
// DB stores km. lbs users see miles.
const KM_PER_MILE = 1.609344

export const kmToMiles = (km) => km / KM_PER_MILE
export const milesToKm = (mi) => mi * KM_PER_MILE
export const distanceUnitLabel = (unit) => (unit === 'lbs' ? 'mi' : 'km')

export function displayDistance(km, unit) {
  if (km == null || km === '' || isNaN(km)) return ''
  const val = unit === 'lbs' ? kmToMiles(Number(km)) : Number(km)
  const rounded = Math.round(val * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : String(rounded)
}

export function parseInputDistance(raw, unit) {
  // Accept comma as the decimal separator too (European keyboards).
  const n = parseFloat(typeof raw === 'string' ? raw.replace(',', '.') : raw)
  if (isNaN(n)) return NaN
  return unit === 'lbs' ? milesToKm(n) : n
}

// ── Elevation (m ↔ ft) ──────────────────────────────────────
const M_PER_FOOT = 0.3048

export const metersToFeet = (m) => m / M_PER_FOOT
export const feetToMeters = (ft) => ft * M_PER_FOOT
export const elevationUnitLabel = (unit) => (unit === 'lbs' ? 'ft' : 'm')

export function displayElevation(m, unit) {
  if (m == null || m === '' || isNaN(m)) return ''
  const val = unit === 'lbs' ? metersToFeet(Number(m)) : Number(m)
  return String(Math.round(val))
}

export function parseInputElevation(raw, unit) {
  const n = parseFloat(raw)
  if (isNaN(n)) return NaN
  return unit === 'lbs' ? feetToMeters(n) : n
}

// ── Body measurements (cm ↔ in) ─────────────────────────────
// DB stores cm. lbs users see inches.
const CM_PER_INCH = 2.54

export const cmToInches    = (cm) => cm / CM_PER_INCH
export const inchesToCm    = (inches) => inches * CM_PER_INCH
export const lengthUnitLabel = (unit) => (unit === 'lbs' ? 'in' : 'cm')

export function displayLength(cm, unit) {
  if (cm == null || cm === '' || isNaN(cm)) return ''
  const val = unit === 'lbs' ? cmToInches(Number(cm)) : Number(cm)
  const rounded = Math.round(val * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function parseInputLength(raw, unit) {
  const n = parseFloat(raw)
  if (isNaN(n)) return NaN
  return unit === 'lbs' ? inchesToCm(n) : n
}

// kg-input-style helper for prefilling: cm (or null) → user-unit string.
export function cmToInputValue(cm, unit) {
  if (cm == null || cm === 0 || cm === '') return ''
  return displayLength(cm, unit)
}
