// Seed list shown in the activity autocomplete. User can type anything,
// these just appear as suggestions when the input is empty or partial.
export const CURATED_ACTIVITIES = [
  'Running', 'Cycling', 'Swimming', 'BJJ', 'Yoga', 'Climbing',
  'Hiking', 'Boxing', 'Basketball', 'Soccer', 'Tennis',
  'Stretching', 'Walk', 'HIIT',
]

// Catalog of trackable fields per activity. Order here = order shown in picker.
export const FIELD_CATALOG = [
  { key: 'duration_min', label: 'Duration', suffix: 'min' },
  { key: 'distance_km',  label: 'Distance', suffix: 'km'  }, // suffix swapped to mi for lbs users
  { key: 'intensity',    label: 'Intensity', suffix: '/5' },
  { key: 'avg_hr',       label: 'Avg HR',   suffix: 'bpm' },
  { key: 'calories',     label: 'Calories', suffix: 'kcal' },
  { key: 'rounds',       label: 'Rounds',   suffix: ''    },
  { key: 'elevation_m',  label: 'Elevation', suffix: 'm'  }, // suffix swapped to ft for lbs users
  { key: 'notes',        label: 'Notes',    suffix: ''    },
]

export const DEFAULT_ACTIVITY_FIELDS = ['duration_min', 'notes']

// Sensible-default field sets for the curated activities. Used only when
// the user first toggles an item to Activity and matches a known name —
// otherwise we fall back to DEFAULT_ACTIVITY_FIELDS.
export const FIELD_PRESETS = {
  Running:    ['duration_min', 'distance_km', 'avg_hr', 'notes'],
  Cycling:    ['duration_min', 'distance_km', 'avg_hr', 'elevation_m', 'notes'],
  Swimming:   ['duration_min', 'distance_km', 'notes'],
  BJJ:        ['duration_min', 'rounds', 'intensity', 'notes'],
  Yoga:       ['duration_min', 'notes'],
  Climbing:   ['duration_min', 'intensity', 'notes'],
  Hiking:     ['duration_min', 'distance_km', 'elevation_m', 'notes'],
  Boxing:     ['duration_min', 'rounds', 'intensity', 'notes'],
  Basketball: ['duration_min', 'intensity', 'notes'],
  Soccer:     ['duration_min', 'intensity', 'notes'],
  Tennis:     ['duration_min', 'intensity', 'notes'],
  Stretching: ['duration_min', 'notes'],
  Walk:       ['duration_min', 'distance_km', 'notes'],
  HIIT:       ['duration_min', 'rounds', 'intensity', 'notes'],
}

export function defaultFieldsFor(name) {
  return FIELD_PRESETS[name] || DEFAULT_ACTIVITY_FIELDS
}
