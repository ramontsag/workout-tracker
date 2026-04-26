// Curated catalog of common activities (cardio / sports / mobility).
// Used by ActivityPickerModal. Custom activities live alongside via the
// user's program/history (see getAllKnownExerciseNames — activities and
// exercises share the names table).

export const ACTIVITY_CATALOG = [
  { group: 'Cardio', items: [
    'Running', 'Cycling', 'Swimming', 'Walk', 'Hiking', 'HIIT',
    'Rowing', 'Elliptical', 'Stair climber', 'Jump rope',
  ] },
  { group: 'Sports', items: [
    'BJJ', 'Boxing', 'Kickboxing', 'MMA', 'Climbing',
    'Basketball', 'Soccer', 'Tennis', 'Padel', 'Volleyball',
    'Skiing', 'Snowboarding', 'Surfing',
  ] },
  { group: 'Mobility', items: [
    'Yoga', 'Stretching', 'Mobility', 'Pilates', 'Foam rolling',
  ] },
  { group: 'Other', items: [
    'Workout', 'Recovery', 'Meditation',
  ] },
]

// Flat, deduped list of every activity name — used by autocomplete merges.
export const ACTIVITY_NAMES = [
  ...new Set(ACTIVITY_CATALOG.flatMap(g => g.items)),
]
