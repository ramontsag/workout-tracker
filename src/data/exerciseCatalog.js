// Curated catalog of standard gym exercises, grouped by muscle and
// then by sub-group (e.g. Chest → Upper / Mid / Lower). Used by
// ProgramSetup's exercise picker. Custom exercises live alongside
// these via the user's program/history (see getAllKnownExerciseNames).

export const EXERCISE_CATALOG = [
  {
    group: 'Chest',
    subgroups: [
      { name: 'Upper (incline)', items: [
        'Incline barbell press', 'Incline dumbbell press',
        'Smith machine incline press', 'Incline chest press machine',
        'Incline dumbbell fly', 'Cable fly (low to high)',
        'Reverse-grip bench press', 'Incline push-up', 'Landmine press',
      ] },
      { name: 'Mid (flat)', items: [
        'Barbell bench press', 'Dumbbell bench press',
        'Smith machine bench press', 'Chest press machine',
        'Dumbbell fly (flat)', 'Cable fly (mid)', 'Pec deck',
        'Push-up', 'Svend press',
      ] },
      { name: 'Lower (decline)', items: [
        'Decline barbell press', 'Decline dumbbell press', 'Decline push-up',
        'Cable fly (high to low)',
        'Dips (chest)', 'Weighted dips (chest)',
        'Dumbbell pullover',
      ] },
    ],
  },
  {
    group: 'Back',
    subgroups: [
      { name: 'Lats (vertical pull)', items: [
        'Pull-up', 'Chin-up', 'Weighted pull-up',
        'Lat pulldown (wide)', 'Lat pulldown (close)', 'Lat pulldown (neutral)',
        'Single-arm lat pulldown', 'Straight-arm cable pulldown', 'Cable lat pullover',
      ] },
      { name: 'Mid back (horizontal pull)', items: [
        'Barbell row (bent over)', 'Pendlay row', 'T-bar row',
        'Single-arm dumbbell row',
        'Chest-supported row (dumbbell)',
        'Seated cable row (wide)', 'Seated cable row (close)', 'Seated cable row (neutral)',
        'Single-arm cable row',
        'Machine row (low)', 'Machine row (high)',
        'Inverted row', 'Meadows row', 'Seal row',
      ] },
      { name: 'Lower back / erectors', items: [
        'Hyperextension', 'Reverse hyperextension',
        'Good morning', 'Back extension (machine)',
      ] },
      { name: 'Traps', items: [
        'Shrug (barbell)', 'Shrug (dumbbell)', 'Shrug (cable)', 'Shrug (machine)',
        'Rack pull', 'Snatch-grip high pull',
      ] },
    ],
  },
  {
    group: 'Shoulders',
    subgroups: [
      { name: 'Front delts', items: [
        'Military press', 'Overhead press (dumbbell)',
        'Seated overhead press (barbell)', 'Seated overhead press (dumbbell)',
        'Shoulder press machine', 'Smith machine overhead press',
        'Arnold press', 'Push press', 'Z-press',
        'Front raise (dumbbell)', 'Front raise (cable)', 'Front raise (plate)',
        'Landmine press',
      ] },
      { name: 'Side delts', items: [
        'Lateral raise (dumbbell, standing)', 'Lateral raise (dumbbell, seated)',
        'Lateral raise (cable)', 'Lateral raise (machine)',
        'Single-arm lateral raise (cable)',
        'Leaning lateral raise', 'Lying side raise', 'Cable Y-raise',
        'Upright row (barbell)', 'Upright row (cable)',
      ] },
      { name: 'Rear delts', items: [
        'Rear delt fly (dumbbell)', 'Rear delt fly (cable)', 'Reverse pec deck',
        'Bent-over rear delt raise', 'Face pull', 'Prone Y-raise',
      ] },
    ],
  },
  {
    group: 'Biceps',
    subgroups: [
      { name: 'Long head (overhead / stretched)', items: [
        'Incline dumbbell curl', 'Bayesian curl', 'Drag curl',
        'Behind-the-body cable curl',
      ] },
      { name: 'Short head (peak / contracted)', items: [
        'Preacher curl (barbell)', 'Preacher curl (EZ-bar)',
        'Preacher curl (dumbbell)', 'Preacher curl (machine)',
        'Spider curl', 'Concentration curl',
      ] },
      { name: 'Both heads (general)', items: [
        'Barbell curl', 'EZ-bar curl',
        'Dumbbell curl (standing)', 'Dumbbell curl (seated)',
        'Cable curl (straight bar)', 'Cable curl (rope)', 'Single-arm cable curl',
      ] },
      { name: 'Brachialis / brachioradialis', items: [
        'Hammer curl (dumbbell)', 'Hammer curl (rope)', 'Cross-body hammer curl',
        'Reverse curl (barbell)', 'Reverse curl (cable)', 'Zottman curl',
      ] },
    ],
  },
  {
    group: 'Triceps',
    subgroups: [
      { name: 'Long head (overhead)', items: [
        'Overhead tricep extension (rope)', 'Overhead tricep extension (dumbbell)',
        'Overhead tricep extension (cable)',
        'Skull crusher (barbell)', 'Skull crusher (EZ-bar)', 'Skull crusher (dumbbell)',
      ] },
      { name: 'Lateral head (pushdown)', items: [
        'Tricep pushdown (rope)', 'Tricep pushdown (straight bar)', 'Tricep pushdown (V-bar)',
        'Single-arm tricep pushdown',
        'Tricep kickback (dumbbell)', 'Tricep kickback (cable)',
      ] },
      { name: 'Compound (all heads)', items: [
        'Close-grip bench press', 'JM press', 'Tricep dips', 'Bench dips',
        'Tricep extension machine',
      ] },
    ],
  },
  {
    group: 'Quads',
    subgroups: [
      { name: 'Compound (bilateral)', items: [
        'Back squat (barbell)', 'Front squat', 'Goblet squat',
        'Smith machine squat', 'Hack squat (machine)', 'Leg press',
        'Box squat', 'Pause squat', 'Belt squat',
      ] },
      { name: 'Isolation', items: [
        'Leg extension', 'Single-leg extension', 'Sissy squat',
      ] },
      { name: 'Unilateral', items: [
        'Bulgarian split squat', 'Walking lunge', 'Reverse lunge',
        'Step-up', 'Pistol squat', 'Single-leg press',
      ] },
    ],
  },
  {
    group: 'Hamstrings',
    subgroups: [
      { name: 'Hip-hinge (upper hams + glutes)', items: [
        'Romanian deadlift (barbell)', 'Romanian deadlift (dumbbell)',
        'Single-leg RDL', 'Stiff-leg deadlift',
        'Conventional deadlift', 'Sumo deadlift', 'Trap bar deadlift',
        'Cable pull-through',
      ] },
      { name: 'Knee-flexion (lower hams)', items: [
        'Lying leg curl', 'Seated leg curl', 'Standing leg curl', 'Single-leg curl',
        'Nordic curl', 'Glute-ham raise',
      ] },
    ],
  },
  {
    group: 'Glutes',
    subgroups: [
      { name: 'Glute max (extension / thrust)', items: [
        'Hip thrust (barbell)', 'Hip thrust (machine)', 'Single-leg hip thrust',
        'Glute bridge', 'Cable kickback',
      ] },
      { name: 'Glute med / abductors', items: [
        'Cable abduction', 'Hip abduction (machine)', 'Banded side step', 'Clamshell',
      ] },
      { name: 'Squat-pattern (glute focus)', items: [
        'Sumo squat', 'Cossack squat', 'Curtsy lunge',
      ] },
    ],
  },
  {
    group: 'Calves',
    subgroups: [
      { name: 'Gastrocnemius (knee straight)', items: [
        'Standing calf raise (machine)', 'Standing calf raise (smith)',
        'Calf raise (leg press)', 'Single-leg calf raise (dumbbell)',
        'Donkey calf raise',
      ] },
      { name: 'Soleus (knee bent)', items: [
        'Seated calf raise (machine)', 'Seated calf raise (dumbbell)',
      ] },
    ],
  },
  {
    group: 'Core',
    subgroups: [
      { name: 'Upper abs (flexion)', items: [
        'Crunch', 'Cable crunch', 'Decline sit-up', 'Sit-up',
        'Weighted crunch', 'V-up',
      ] },
      { name: 'Lower abs (hip flexion)', items: [
        'Hanging leg raise', 'Hanging knee raise', "Captain's chair leg raise",
        'Toes to bar', 'Reverse crunch', 'Lying leg raise', 'Garhammer raise',
      ] },
      { name: 'Anti-extension / stability', items: [
        'Plank', 'Dead bug', 'Bird dog', 'Ab wheel rollout',
        'Hollow body hold', 'L-sit hold',
      ] },
      { name: 'Obliques / rotational', items: [
        'Russian twist', 'Side plank', 'Pallof press',
        'Cable woodchopper', 'Cable rotation',
        'Side bend (dumbbell)', 'Suitcase carry',
      ] },
    ],
  },
  {
    group: 'Forearms / grip',
    subgroups: [
      { name: 'Flexors', items: [
        'Wrist curl (barbell)', 'Wrist curl (dumbbell)', 'Behind-the-back wrist curl',
      ] },
      { name: 'Extensors', items: [
        'Reverse wrist curl',
      ] },
      { name: 'Grip / carry', items: [
        "Farmer's walk", 'Dead hang', 'Plate pinch', 'Forearm roller',
      ] },
    ],
  },
  {
    group: 'Bodyweight / Calisthenics',
    subgroups: [
      { name: 'Push (skills & advanced)', items: [
        'Diamond push-up', 'Archer push-up', 'Pseudo planche push-up',
        'One-arm push-up (assisted)', 'One-arm push-up',
        'Pike push-up', 'Wall handstand push-up', 'Free handstand push-up',
        'Hindu push-up', 'Tiger bend push-up',
      ] },
      { name: 'Pull (skills & advanced)', items: [
        'Australian row (bodyweight)', 'Archer pull-up', 'Typewriter pull-up',
        'Commando pull-up', 'L-sit pull-up',
        'Muscle-up (bar)', 'Muscle-up (rings)',
        'Front lever pull', 'Front lever raise',
      ] },
      { name: 'Legs (single-leg & advanced)', items: [
        'Pistol squat', 'Shrimp squat', 'Cossack squat (bodyweight)',
        'Single-leg glute bridge', 'Single-leg Romanian deadlift (bodyweight)',
        'Jumping lunge',
      ] },
      { name: 'Static holds / levers', items: [
        'Tuck front lever hold', 'Advanced tuck front lever hold',
        'Straddle front lever hold', 'Full front lever hold',
        'Back lever hold',
        'Tuck planche hold', 'Straddle planche hold', 'Full planche hold',
        'V-sit hold', 'Manna hold',
        'Crow pose', 'Handstand hold',
        'Dragon flag', 'Human flag',
      ] },
      { name: 'Plyometric / explosive', items: [
        'Clap push-up', 'Plyo push-up', 'Jump squat',
      ] },
    ],
  },
  {
    group: 'Olympic / Power',
    subgroups: [
      { name: 'Snatch family', items: [
        'Snatch', 'Power snatch', 'Hang snatch', 'Snatch pull', 'Snatch-grip high pull',
      ] },
      { name: 'Clean family', items: [
        'Clean', 'Power clean', 'Hang clean', 'Clean pull', 'Clean high pull',
      ] },
      { name: 'Jerk', items: [
        'Push jerk', 'Split jerk',
      ] },
      { name: 'Combined', items: [
        'Clean and jerk',
      ] },
      { name: 'Power / speed', items: [
        'Push press', 'Kettlebell swing',
        'Box jump', 'Squat jump', 'Broad jump',
        'Medicine ball slam', 'Medicine ball throw',
      ] },
    ],
  },
]

// Flat, deduped list of every catalog name (some exercises are
// cross-listed in two groups, e.g. Landmine press appears under
// Chest/Upper and Shoulders/Front delts). Used by the inline
// autocomplete in ProgramSetup.
export const CATALOG_NAMES = [
  ...new Set(
    EXERCISE_CATALOG.flatMap(g => g.subgroups.flatMap(sg => sg.items))
  ),
]
