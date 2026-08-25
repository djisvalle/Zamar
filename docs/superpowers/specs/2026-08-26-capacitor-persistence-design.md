# Phase 1: Capacitor shell + SQLite persistence

## Context

Zamar is currently a pure browser mockup: Vite + React 18 + TypeScript, no
backend, no persistence, in-memory `useReducer` store that reseeds from
`src/state/mockData.ts` on every reload. CLAUDE.md frames the real product as
"offline, on-device" — this phase is the first step in turning the mockup
into an actual installable app.

"Implement the mockup to an actual app" decomposes into several independent
sub-projects: (1) a real native shell + on-device persistence, (2) a real
tuner (mic + pitch detection), (3) real chart import (OCR/parsing of
PDF/photo), (4) real PDF export generation. This spec covers **only sub-project
1**. The others are explicitly out of scope and will each get their own
brainstorm → spec → plan cycle later.

Platform decision (made during brainstorming): ship as a **mobile app via
Capacitor**, matching the phone-frame device shell the mockup already uses
and giving native mic/filesystem/share-sheet access for later phases. The
developer is on Windows, so **iOS builds cannot be verified locally** (no
Mac/Xcode) — the iOS platform folder is scaffolded for future use but only
Android is actually built, run, and tested in this phase.

## Goals

- The app installs and runs as a real Android app (APK/emulator), not just a
  browser tab.
- Songs, setlists, and settings survive an app restart (force-close +
  relaunch), backed by real on-device SQLite.
- `npm run dev` (browser) continues to work for fast iteration.
- No behavior change to any screen/component — this phase is purely
  plumbing underneath the existing reducer and UI.

## Out of scope

- Tuner mic/pitch detection (still the "Simulate" button).
- Real OCR/parsing of imported PDFs/photos (still the canned conversion).
- Real PDF export generation (still the timer-driven simulation).
- Building, running, or verifying the iOS platform (no Mac available).
- Any new automated test tooling (none exists today; see CLAUDE.md gotcha —
  `npm run build` stays the verification bar).
- App icons/splash screens beyond Capacitor's defaults.
- Persisting `stage` (live-stage runtime UI state) or `viewport` (dev-only
  frame-size toggle) — both are ephemeral/UI-only, not app data.

## Architecture

### Native shell

Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
`@capacitor/ios` as dependencies.

- `npx cap init` — appId `com.zamar.app`, appName `Zamar`, webDir `dist`.
- `npx cap add android` and `npx cap add ios` — both platform folders are
  scaffolded; only `android/` is built and run in this phase.
- New npm scripts: `cap:sync` (`vite build && npx cap sync`), `cap:android`
  (`npm run cap:sync && npx cap run android`).

### Device-frame chrome becomes native-aware

`App.tsx`'s `.device` phone/tablet frame simulation is a mockup-only artifact
for previewing screen sizes inside a browser tab. On a real installed app,
wrapping the whole UI in a little rendered phone frame is wrong — the app
should fill the real screen.

- Gate the frame rendering behind `Capacitor.isNativePlatform()` (from
  `@capacitor/core`): native builds render the app full-screen, no frame, no
  viewport toggle UI.
- `npm run dev` in a browser keeps today's frame + Phone/Tablet toggle
  unchanged, for convenience during development.
- `viewport` stays a field in `AppState` (existing screens/components don't
  change) but is never persisted — it's meaningless off a browser dev
  session.

### SQLite schema

Using `@capacitor-community/sqlite`. One schema version (v1) via the
plugin's upgrade-statement mechanism, so future phases have a real migration
path instead of needing to invent one later.

```sql
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL, -- 0/1
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachment_kind TEXT,       -- nullable; 1:1 optional, not worth a table
  attachment_role TEXT,
  attachment_dataUrl TEXT,
  attachment_name TEXT
);

CREATE TABLE setlists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE setlist_sections (
  id TEXT PRIMARY KEY,
  setlist_id TEXT NOT NULL REFERENCES setlists(id),
  label TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE setlist_items (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES setlist_sections(id),
  kind TEXT NOT NULL,
  song_id TEXT REFERENCES songs(id),
  label TEXT,
  keyOverride TEXT,
  capo INTEGER,
  note TEXT,
  position INTEGER NOT NULL
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- single row
  keepAwake INTEGER NOT NULL,
  autoscroll INTEGER NOT NULL,
  theme TEXT NOT NULL,
  textScale INTEGER NOT NULL,
  hasSeeded INTEGER NOT NULL,
  micPermissionAsked INTEGER NOT NULL
);
```

Attachment `dataUrl` (base64) stays as a plain TEXT column. Fine at
mockup-scale data volumes; moving large attachments to real on-disk files
(via the Filesystem plugin) is a future concern if it ever becomes a
problem, not something this phase needs to solve preemptively.

### Data access layer

New `src/data/` directory:

- `db.ts` — opens/creates the SQLite connection, runs the v1
  `CREATE TABLE IF NOT EXISTS` migration on first access.
- `songsRepo.ts`, `setlistsRepo.ts`, `settingsRepo.ts` — each exposes a
  `loadAll()` and a `replaceAll(...)` (transactional delete + reinsert).
  No per-field update methods — see "Persistence effect" below for why a
  full-slice replace is sufficient here.

### Boot sequence

`main.tsx` becomes async:

1. Try `settingsRepo.loadAll()`.
2. If no settings row exists (fresh install — mirrors today's
   `hasSeeded: false` first-run path), hydrate initial state from
   `mockData.ts` exactly as `initialState()` does today. Nothing is written
   to the DB yet; `FirstRun.tsx`'s existing "seed samples" (`SEED_SAMPLES`)
   vs. "start empty" (`START_EMPTY`) dispatch is unchanged, and the first
   write to SQLite happens naturally via the persistence effect once the
   user makes that choice.
3. If a settings row exists, hydrate `songs`/`setlists`/`settings` from
   SQLite via the repos' `loadAll()`.
4. `stage` always starts from `emptyStage`; `viewport` always starts
   `"phone"` — neither is read from disk.
5. Render `<StoreProvider initialState={...}>` with the resolved state.

Show a minimal loading state (e.g. blank screen or existing splash) while
step 1–3 resolve, since this is now async where it used to be synchronous.

### Persistence effect

The reducer (`src/state/store.ts`) itself is **unchanged** — stays pure and
synchronous, so no screen or component needs to change and the UI stays as
responsive as it is today.

`StoreProvider` gains one `useEffect` watching
`[state.songs, state.setlists, state.settings]`. Because the reducer only
ever returns a new array/object reference for a slice that actually changed,
the effect can debounce (~250ms) and, per changed slice, call that repo's
`replaceAll(...)` in a transaction. This is simpler and more robust than
mapping every action type to a targeted SQL write, and is more than fast
enough at this data scale (dozens of songs, a handful of setlists).

### Web dev support

`@capacitor-community/sqlite` has no automatic browser fallback (unlike
e.g. Capacitor's Preferences plugin). Wire up the `jeep-sqlite` web
component + its wasm dependency so the same DB code path works under
`npm run dev` in a browser, backed by IndexedDB under the hood. This keeps
CLAUDE.md's documented primary dev loop working unchanged.

### Error handling

If DB init fails (rare — e.g. plugin unavailable), fall back to in-memory-only
for that session with a `console.warn`. No user-facing UI for this edge case
in this phase — low risk at mockup scale, and building a real degraded-mode
UX isn't justified until it's an observed problem.

## Testing / verification

No automated test framework exists in this repo (CLAUDE.md gotcha: no
lint/test tooling configured, `npm run build` is the only verification
available) and this phase doesn't introduce one. Verification bar:

1. `npm run build` (`tsc -b && vite build`) is clean.
2. `npm run dev` in a browser: app loads, first-run flow works, creating a
   song/setlist works. Note this is a behavior change from today: a browser
   reload now round-trips through the same DB code path (via
   jeep-sqlite/IndexedDB) as the native build, so data persists across
   reloads instead of reseeding from mock data every time — verify a reload
   actually preserves changes.
3. `npx cap run android` against an emulator or device:
   - App launches full-screen, no phone-frame chrome.
   - First-run "seed samples" flow works; songs/setlists appear.
   - Create a song, edit a setlist, toggle a setting.
   - Force-close the app and relaunch: all of the above survived.
4. iOS: explicitly not built or verified (no Mac available). The `ios/`
   folder exists for future use from a Mac or CI.
