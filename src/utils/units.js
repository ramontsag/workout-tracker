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
