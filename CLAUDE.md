# Workout Tracker — Project Context

## What this is
A personal workout tracking web app built with React + Vite + Supabase.
Deployed target: Vercel. Local dev: localhost:5173.

## Stack
- React + Vite
- Supabase (auth, database)
- Single Supabase client instance in src/supabase.js — never recreate it

## Critical rules
- Never use getUser() — always use getSession()
- Never use StrictMode
- Every async operation needs a timeout and error state
- Every new database column or table needs a SQL migration printed for the user to run
- When adding features that touch the database, always ask: "does this need a new column or table?" and print the SQL before writing any code

## Database tables
- profiles, training_days, exercises, workouts, workout_sets
- activity_days, activity_types, activity_sessions, activity_logs
- exercises has columns: item_type (exercise/activity), target (text)

## Verification checklist (run after every change)
1. Does the UI reflect the change correctly?
2. Does it save toase without errors?
3. Does it load correctly after a page refresh?
4. Is there a loading state and an error state?
5. Does it work on mobile width (375px)?

## Build principles
- One feature at a time
- Plan before coding
- Print all SQL needed before touching any component
- Never leave a spinner with no timeout

## Subagent usage

After making any code change that modifies behaviour (not just formatting), invoke the code-reviewer subagent on the diff before reporting completion to the user. Pass the diff and the spec/prompt that produced it.

Before generating any migration SQL or writing code that assumes specific schema (column existence, constraint behaviour, RPC availability), invoke the schema-verifier subagent first with a summary of what schema the change requires. Wait for its verdict before producing the migration.

If the user is asking for a small UI tweak that doesn't touch the database and is too small to need review (single-line copy change, color tweak), the code-reviewer can be skipped. Use judgment.

