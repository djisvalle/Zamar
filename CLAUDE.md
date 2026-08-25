# Zamar — interactive mockup

## What this is

Zamar is an offline, on-device worship chord-chart / setlist app ("Make worship, made
easier"). This repo is **not** the production app — it's a click-through, non-functional
mockup built from the "Zamar Wireframe Gallery — HIG/Material Refresh" design (a Claude
Design project: `Zamar redesign scope questions`). That design doc renders ~60 seeded
states of one polymorphic board component across 8 pages, styled with an annotated
spec-sheet chrome ("Industry" wireframe system — blueprint corners, steel-blue).

This mockup deliberately does **not** reproduce that spec-sheet chrome. Instead it takes
the screens the spec sheet documents and wires them into one coherent, navigable app you
can actually click through — splash → onboarding → Live Stage → Library → Setlists →
Tuner → Settings → Export — using the app's own (friendlier, rounded) visual language,
not the wireframe annotation system. See the "What was intentionally left out" section
in `github.md`-style spirit: this is a UI/interaction mockup, not a functional build.

## Tech stack

- **Vite + React 18 + TypeScript**, no other runtime dependencies. Chosen to match the
  real Zamar codebase's `.tsx` convention (`LiveStageScreen.tsx`, `ChordGrid.tsx`, etc.)
  referenced by the design source, and because a mockup doesn't need a backend, router
  library, or state-management package.
- Plain CSS with custom properties (`src/theme.css`) — no Tailwind, no CSS-in-JS. The
  design is already token-driven (`--w-*` vars in the source), so plain CSS mirrors it
  most directly.

## Architecture

### Device-frame shell, not a website

The whole app renders inside a phone/tablet frame (`.device` in `App.tsx`), centered on
the page, with global **Appearance** (Light / Stage Dark) and **Viewport** (Phone /
Tablet) controls above it. This is a simplified carry-over of the original gallery's own
toggle bar — now driving one live app instead of an atlas of frozen boards. Frame
dimensions (`402×874` phone, `512.5×737.5` tablet) come straight from the source's
`main_logic.txt`.

### In-memory stack navigator, not URL routing

`src/navigation/Navigator.tsx` is a small `push`/`pop`/`replace`/`reset` stack of
`{ screen, params }` frames, exposed via context. There's exactly one "device" here, not
multiple routes to deep-link, so a router library would be dead weight — this models a
mobile app's screen stack (back-chevron pops) instead.

### Single global reducer, no persistence

`src/state/store.ts` is one `useReducer` (`songs[]`, `setlists[]`, `settings`, live
`stage` state, `viewport`) exposed via context. Every interaction — favoriting a song,
transposing a key, editing a setlist slot, saving a new song — dispatches a typed action
and mutates this in memory. **Nothing persists across a reload**; the app always reseeds
from `src/state/mockData.ts`. This mirrors the source doc's own framing: "driven by
in-memory state."

### Design tokens: two systems, only one of which is in the app

- **App-level tokens** (`--bg`, `--fg`, `--acc`, `--acc-deep`, `--surface`, `--line`,
  `--tint`, `--scrim`, in `theme.css`, light + dark) are the actual product visual
  language — Barlow / Barlow Condensed, steel-blue accent, rounded corners, chip-based
  key selectors. Taken verbatim from the `light`/`dark` objects in the source's
  `main_logic.txt`.
- The source's **"Industry" blueprint system** (square corners, corner registration
  marks, hairline borders) styles the *spec-sheet gallery itself*, not the product, and
  is intentionally **not used anywhere in this mockup** — see "What was intentionally
  left out" below.

### ChordPro rendering is real, not hardcoded

`src/utils/chordpro.ts` parses `[Chord]lyric` markup into a lyric string plus a
column-positioned monospace chord row (derived from real bracket offsets, not
hand-placed spacing like the source's static boards), and transposes chord roots by
semitone distance between two keys. This means transpose, capo, and the Add/Edit Song
live preview are **functionally correct**, not just visually plausible — pick a display
key anywhere and the chord letters actually recompute.

## Screen map (`src/screens/<area>/`)

Priority mirrors the source doc's own stated order: (1) Live Stage + in-stage add-song,
(2) transpose/capo toolbar, (3) Setlist & Song CRUD, (4) everything else.

| Area | Entry point | Notable pieces |
|---|---|---|
| `onboarding/` | app boot | Splash (auto-advances) → First-run (seed samples / start empty) |
| `live-stage/` | app hub | empty/loaded chord+sheet views, expandable transpose/capo toolbar, Add-Song drawer, Quick-edit sheet, annotate mode, idle auto-hide chrome (6s), end-of-setlist |
| `library/` | hamburger menu | A–Z grouped list, live search, filter chips, multi-select + batch delete, row context sheet, empty/no-results states |
| `setlists/` | hamburger menu | Upcoming/Past/Templates tabs, **run-sheet detail** (sections, derived per-slot start times, per-slot key/capo/note override sheet), Add-to-set drawer, Set-details sheet with duplicate-name validation |
| `add-edit-song/` | menu / Library FAB / row sheet | title/artist/tempo form, live `{key: ...}` directive detection, ChordPro-vs-Chords-over-Lyrics format toggle with format-aware quick-insert chips (chords used so far + ChordPro directives), ChordPro source + rendered preview tabs, validation, discard-changes confirm |
| `import/` | Library's dedicated import FAB (⇩, stacked under the main "+") / empty-state "Import a chart" button | real `<input type="file">` picker for PDF, photo, or MusicXML; PDF/photo add a manual "What's in this file?" declaration (Chords & lyrics vs. Sheet music — there's no real content detection, the person importing states which it is) — Sheet music skips conversion and attaches the actual uploaded file (`Song.attachment`) as-is, Chords & lyrics runs a simulated convert-progress step into a review-and-save form with a canned chart preview and a "Simulate a failed scan" link; MusicXML is convert-only (no sheet/chords fork — it's treated as inherently having both) |
| `tuner/` | hamburger menu | contextual one-time mic-permission sheet (gated in `Tuner.tsx` itself, so it fires regardless of entry point), flat/in-tune states via a "Simulate" control, mic-off state |
| `settings/` | hamburger menu | toggles, Appearance sub-screen (Light/Stage Dark/Auto + live specimen + text-size slider), type-`ERASE`-to-confirm reset |
| `export/` | a setlist's ⋯ menu | format tabs, option toggles, timer-driven progress simulation, share-sheet mock, offline-error variant |

Shared primitives live in `src/components/`: `Header`, `Overlays` (`Dialog`/`Sheet`/
`SideDrawer`), `Toggle`/`Segmented`, `KeyChips`, `ChordChart`, `StatusBar`.

## What was intentionally left out

Stated up front so nobody mistakes this for a functional build:

- **No real microphone / pitch detection** — the Tuner's readings are toggled by a
  "Simulate" button.
- **No real chord/lyric parsing of imported files, and no real sheet-vs-chords
  detection.** `src/screens/import/ImportSong.tsx` uses a real `<input type="file">`
  (PDF, photo, or MusicXML all genuinely upload via `FileReader` → data URL — this part
  isn't faked), but "converting" that file into a chart is a timer-driven simulation:
  every conversion produces the same fixed ChordPro sample, never content actually
  derived from the file. Same spirit as Export's simulated PDF generation (its progress
  bar is a timer too; there's still no real PDF/MusicXML generation). Whether a PDF/photo
  contains sheet music or chords/lyrics isn't detected either — the person importing
  declares it via the "What's in this file?" toggle; nothing inspects the file's actual
  content. The one path that *is* fully real end-to-end: declaring "Sheet music" skips
  conversion entirely and stores the actual uploaded file as `Song.attachment`
  (`{ kind: "image" | "pdf", dataUrl, name }`) with `displayMode: "original"` — Live
  Stage then renders that real image/PDF full-bleed (via `<img>`/`<embed>`) instead of
  `ChordChart`, replacing the Chord/Sheet toggle with an "ORIGINAL" badge and hiding the
  transpose/capo toolbar, since there's no chart to transpose.
- **No drag-and-drop reordering** in the setlist run sheet — the source's "lifted slot"
  drag visual wasn't implemented; reordering isn't available.
- **No persistence or sync** — by design; every reload reseeds from mock data.
- **The Industry blueprint/spec-sheet chrome was not built** — this mockup is the app
  the spec sheet describes, not a copy of the spec-sheet document itself.
- **One global theme, not per-surface theming.** The source's "Stage Dark" setting is
  scoped ("dark chart on stage, light everywhere else"); this mockup's Appearance toggle
  is simpler — one theme for the whole device frame. Noted as a deliberate
  simplification, not an oversight.
- **A handful of the source's ~60 documented micro-states weren't wired**: the
  ChordPro-parse-error banner, the crash-restore onboarding variant, and the imported
  chart merge-strategy screen (Replace/Append/Review). The states covering the doc's
  stated priorities (Live Stage, transpose/capo, Setlist & Song CRUD) are all present.

## Gotchas

- **Gate contextual permission/onboarding sheets in the destination screen, not the
  navigator call site.** The Tuner's one-time mic-permission sheet was originally gated
  in `LiveStage.tsx`'s own "open tuner" handler — but `MenuDrawer.tsx` (and any other
  future entry point) navigated straight to `"tuner"` without going through it, so the
  gate silently never fired from the menu. Fixed by moving the check into `Tuner.tsx`
  itself (`if (!state.settings.micPermissionAsked) ...`), so it's enforced regardless of
  how the screen was reached. Apply the same pattern to any future contextual gate.
- **No lint/test tooling is configured.** `npm run build` (`tsc -b && vite build`) is
  the only verification available — treat a clean build as the correctness bar.

## Running it

```
npm install
npm run dev      # http://localhost:5183 (or whatever port Vite picks)
npm run build    # tsc -b && vite build
```

If you drive this app with browser-automation tooling (Playwright, etc.) during
development: `vite.config.ts` ignores `.playwright-mcp/**` in its file watcher on
purpose. Without that, every snapshot/screenshot the tooling writes into that folder
triggers a full-page reload that silently wipes the in-memory store mid-session — this
cost real debugging time while building the mockup, so it's fixed at the config level
rather than left as a trap.
