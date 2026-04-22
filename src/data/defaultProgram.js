// item helpers
const ex  = (name, target = '') => ({ name, target, item_type: 'exercise' })
const act = (name)               => ({ name, target: '', item_type: 'activity' })

// ── Unified days — Monday through Sunday ──────────────────────
// Every day is just a day. Each item is either exercise or activity.
export const DEFAULT_DAYS = [
  {
    name: 'Monday',
    focus: 'Chest & Back',
    color: '#f97316',
    exercises: [
      ex('Incline dumbbell press'),
      ex('Machine pull downs'),
      ex('Dips'),
      ex('Machine rows (LD)'),
      ex('Chest flys'),
      ex('Cable rows'),
      ex('Cable crunches'),
    ],
  },
  {
    name: 'Tuesday',
    focus: '',
    color: '#64748b',
    exercises: [
      act('Cardio'),
      act('Workout'),
      act('Mobility'),
    ],
  },
  {
    name: 'Wednesday',
    focus: '',
    color: '#64748b',
    exercises: [
      act('Cardio'),
      act('Workout'),
      act('Mobility'),
    ],
  },
  {
    name: 'Thursday',
    focus: 'Upper',
    color: '#3b82f6',
    exercises: [
      ex('Machine rows'),
      ex('Incline press machine'),
      ex('UCC hammer curls'),
      ex('UCC lateral raises'),
      ex('UCC overhead tricep extensions'),
      ex('Lat pull downs'),
      ex('Chest flys'),
      ex('Bicep curls to lateral raises'),
      ex('Cable extensions to face pulls'),
    ],
  },
  {
    name: 'Friday',
    focus: '',
    color: '#64748b',
    exercises: [
      act('Cardio'),
      act('Workout'),
      act('Mobility'),
    ],
  },
  {
    name: 'Saturday',
    focus: 'Legs',
    color: '#22c55e',
    exercises: [
      ex('Squats'),
      ex('Calf raises'),
      ex('RDLs'),
      ex('Leg raises'),
      ex('Curls'),
      ex('Sissy squat'),
      ex('Cable crunches'),
    ],
  },
  {
    name: 'Sunday',
    focus: 'Sharms',
    color: '#a855f7',
    exercises: [
      ex('Dumbbell shoulder press'),
      ex('Preacher curls'),
      ex('UCC extensions'),
      ex('UCC rear flys'),
      ex('UCC lateral raises'),
      ex('UCC hammer curls'),
      ex('Rope tricep extensions to face pulls'),
      ex('Leg raises'),
    ],
  },
]

// Kept for any legacy imports — alias to DEFAULT_DAYS
export const DEFAULT_PROGRAM = DEFAULT_DAYS

// Blank 7-day template. Used as the seed for every account other than the
// owner, so new sign-ups start with an empty program to customise.
export const EMPTY_DAYS = [
  { name: 'Monday',    focus: '', color: '#64748b', exercises: [] },
  { name: 'Tuesday',   focus: '', color: '#64748b', exercises: [] },
  { name: 'Wednesday', focus: '', color: '#64748b', exercises: [] },
  { name: 'Thursday',  focus: '', color: '#64748b', exercises: [] },
  { name: 'Friday',    focus: '', color: '#64748b', exercises: [] },
  { name: 'Saturday',  focus: '', color: '#64748b', exercises: [] },
  { name: 'Sunday',    focus: '', color: '#64748b', exercises: [] },
]

// Only this email sees the owner's personal default program. Everyone else
// (and any new sign-up) gets EMPTY_DAYS.
export const OWNER_EMAIL = 'ramontsag28@gmail.com'

// ── Shared color palette ──────────────────────────────────────
export const DAY_COLORS = [
  '#f97316', // orange
  '#3b82f6', // blue
  '#22c55e', // green
  '#a855f7', // purple
  '#ef4444', // red
  '#eab308', // yellow
  '#14b8a6', // teal
  '#ec4899', // pink
  '#64748b', // slate
]
