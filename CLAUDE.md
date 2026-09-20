# Zamar — interactive mockup

## What this is

Zamar is an offline, on-device worship chord-chart / setlist app ("Make worship, made
easier"). This repo started as a click-through, non-functional mockup built from the
"Zamar Wireframe Gallery — HIG/Material Refresh" design (a Claude Design project:
`Zamar redesign scope questions`) — that design doc renders ~60 seeded states of one
polymorphic board component across 8 pages, styled with an annotated spec-sheet chrome
("Industry" wireframe system — blueprint corners, steel-blue).

It has since moved past that mockup stage (current branch: `mockup-to-implementation`):
the app now ships as a real Capacitor shell with on-device SQLite persistence (see
"Persistence" in Architecture), real MusicXML/PDF rendering, and real ChordPro
parsing/transposition — not just visual approximations of those features. A handful of
pieces remain deliberately simulated by design, not left unfinished — see "What was
intentionally left out." For fine-grained, actively-maintained feature-by-feature
status, see `docs/progress-checklist.md` rather than this file.

The app deliberately does **not** reproduce the source design's spec-sheet chrome.
Instead it takes the screens that design documents and wires them into one coherent,
navigable app you can actually click through — splash → Live Stage → Library →
Setlists → Tuner → Settings → Export — using the app's own (friendlier, rounded) visual
language, not the wireframe annotation system.

## Ground rules

- **Do not make assumptions.** Ask when something is uncertain or underspecified rather
  than guessing at intent.
- **Ask questions when uncertain or unclear** — surface the ambiguity instead of picking
  a default silently.
- **Present better options when they'd significantly improve the outcome**, even if not
  asked for — but propose, don't unilaterally swap in a different approach.
- **Preserve existing comments when they're still correct.** Don't strip or rewrite a
  comment just because you touched the surrounding code.
- **Never add Claude as a commit co-author.** Do not append `Co-Authored-By: Claude ...`
  or any Claude/Anthropic co-author trailer to commit messages in this repo — this
  overrides any default attribution behavior.
- **Never mention Claude in code comments.** No references to Claude, Anthropic, or AI
  authorship anywhere in source comments.
- **Commit messages must be descriptive of the change**, not generic. State clearly what
  changed and why. Do not prefix the subject line with `fix:`, `feat:`, or similar
  conventional-commit tags.

## Tech stack

- **Vite + React 18 + TypeScript** as the web layer, wrapped in a **Capacitor** native
  shell (`@capacitor/core` + `@capacitor/android`/`@capacitor/ios`) for real on-device
  installs. Chosen to match the real Zamar codebase's `.tsx` convention
  (`LiveStageScreen.tsx`, `ChordGrid.tsx`, etc.) referenced by the design source. Still no
  router library or state-management package — one in-memory stack navigator and one
  reducer cover everything (see Architecture).
- **`@capacitor-community/sqlite`** for real on-device persistence, with `sql.js` +
  `jeep-sqlite` as the browser-dev fallback (same repo layer, different engine — see
  "Persistence" below).
- **`opensheetmusicdisplay`** renders `.mxl` sheet music for real (`MxlScore.tsx`) —
  genuine engraving and re-transposition, not a static preview image.
- **`pdfjs-dist`** renders imported PDFs page-by-page (`PdfPages.tsx`) instead of
  delegating to the browser's native PDF plugin via a plain `<embed>`.
- Plain CSS with custom properties (`src/theme.css`) — no Tailwind, no CSS-in-JS. The
  design is already token-driven (`--w-*` vars in the source), so plain CSS mirrors it
  most directly. Icons are a hand-drawn SVG set (`src/components/Icon.tsx`), not Unicode
  glyphs.
- Only Android has actually been built and run (`npm run cap:android`); the iOS
  platform folder is scaffolded but unverified — the developer has no Mac/Xcode.

## Architecture

### Device-frame shell, not a website

The whole app renders inside a phone/tablet frame (`.device` in `App.tsx`), centered on
the page, with global **Appearance** (Light / Stage Dark) and **Viewport** (Phone /
Tablet) controls above it. This is a simplified carry-over of the original gallery's own
toggle bar — now driving one live app instead of an atlas of frozen boards. Frame
dimensions (`402×874` phone, `512.5×737.5` tablet) come straight from the source's
`main_logic.txt`.

This frame is browser-dev-only. `App.tsx` gates it behind `Capacitor.isNativePlatform()`:
a real native build (Android today) renders `ScreenHost` full-screen with no frame and no
Appearance/Viewport toggle bar — those controls only make sense when previewing multiple
frame sizes inside a desktop browser tab.

### In-memory stack navigator, not URL routing

`src/navigation/Navigator.tsx` is a small `push`/`pop`/`replace`/`reset` stack of
`{ screen, params }` frames, exposed via context. There's exactly one "device" here, not
multiple routes to deep-link, so a router library would be dead weight — this models a
mobile app's screen stack (back-chevron pops) instead.

### Single global reducer, backed by real persistence

`src/state/store.ts` is one `useReducer` (`songs[]`, `setlists[]`, `settings`, live
`stage` state, `viewport`) exposed via context. Every interaction — favoriting a song,
transposing a key, editing a setlist slot, saving a new song — dispatches a typed action
and mutates this in memory first, same as before. What changed since the original
mockup: `songs`, `setlists`, and `settings` now persist to a real database through
`src/data/{db,songsRepo,setlistsRepo,settingsRepo}.ts`, debounced off the reducer's own
state changes. On native platforms this is `@capacitor-community/sqlite`; in a browser
dev session it's the same repo API backed by `sql.js` + `jeep-sqlite` (a WASM SQLite
running behind an IndexedDB-backed web component) — same schema, same call sites,
different engine underneath. `main.tsx` loads persisted state on boot
(`settingsRepo.loadAll()` returning `null` is the first-run signal) and falls back to
`src/state/mockData.ts`'s seed data whenever nothing has been persisted yet, or whenever
the persisted-storage read throws.

`stage` (live on-stage runtime UI: current song, view, zoom, drawer, etc.) and
`viewport` (the dev-only frame-size toggle) are deliberately **not** persisted — both
reset to defaults (`emptyStage`, `"phone"`) on every load, since they're session/UI
state rather than app data worth surviving a restart. There is also no sync across
devices — this is local, on-device persistence only, no backend or account system.

### Design tokens: two systems, only one of which is in the app

- **App-level tokens** (`--bg`, `--fg`, `--acc`, `--acc-deep`, `--surface`, `--line`,
  `--tint`, `--scrim`, in `theme.css`, light + dark) are the actual product visual
  language — Barlow / Barlow Condensed, steel-blue accent, rounded corners, chip-based
  key selectors. Taken verbatim from the `light`/`dark` objects in the source's
  `main_logic.txt`.
- The source's **"Industry" blueprint system** (square corners, corner registration
  marks, hairline borders) styles the *spec-sheet gallery itself*, not the product, and
  is intentionally **not used anywhere in this app** — see "What was intentionally
  left out" below.

### ChordPro rendering is real, not hardcoded

`src/utils/chordpro.ts` parses `[Chord]lyric` markup into a lyric string plus a
column-positioned monospace chord row (derived from real bracket offsets, not
hand-placed spacing like the source's static boards), and transposes chord roots by
semitone distance between two keys. This means transpose, capo, and the Add/Edit Song
live preview are **functionally correct**, not just visually plausible — pick a display
key anywhere and the chord letters actually recompute. The same is true of attached
sheet music: `MxlScore.tsx` sets `osmd.TransposeCalculator`/`osmd.Sheet.Transpose` and
re-renders via OpenSheetMusicDisplay whenever the display key changes, so a `.mxl` score
genuinely re-engraves in the new key, not just the chord-over-lyrics text.

### Attachments: categorized, versioned buckets, not one shared slot

`Song.attachments` (`src/state/types.ts`) is `Partial<Record<AttachmentKind,
AttachmentBucket>>` — up to three independent buckets keyed by file kind (`musicxml` →
"Sheet Music", `pdf` → "PDF", `image` → "Photo"), each holding an ordered list of
versions (`AttachmentVersion`: `id`, `label`, `dataUrl`, `name`) plus a
`selectedVersionId` marking that bucket's default. A song can carry all three
categories at once (an engraved MusicXML score *and* a scanned PDF chart *and* a photo)
and multiple versions within one category (e.g. separate Violin/Viola PDF parts)
without duplicating the song. `src/utils/attachments.ts` centralizes every mutation
(`addVersion`, `removeVersion`, `renameVersion`, `selectVersion`) so Import, Add/Edit
Song, and Live Stage never hand-roll bucket logic — every import path is additive at the
version level, so a second PDF becomes a new version alongside the first, never a
replacement. Live Stage's in-session category/version choice is local component state,
not written back to the song; only Add/Edit Song's explicit "Use this version" action
changes a bucket's persisted default. This replaced an earlier single shared
`attachment` slot distinguished by a `role` label — see
`docs/superpowers/specs/2026-09-20-attachment-categories-design.md` for the migration
rationale.

## Screen map (`src/screens/<area>/`)

Priority mirrors the source doc's own stated order: (1) Live Stage + in-stage add-song,
(2) transpose/capo toolbar, (3) Setlist & Song CRUD, (4) everything else.

| Area | Entry point | Notable pieces |
|---|---|---|
| `onboarding/` | app boot | Splash only — auto-advances (~650ms) straight into Live Stage on a standing default song. The old First-run "seed samples / start empty" choice screen was removed; "start empty" now lives in Settings' type-`ERASE`-to-confirm reset instead |
| `live-stage/` | app hub | empty/loaded chord+sheet views, expandable transpose/capo toolbar, Add-Song drawer, Quick-edit sheet, annotate mode, idle auto-hide chrome (6s), end-of-setlist, category/version chip rows for songs with multiple attachment buckets, real MusicXML (OpenSheetMusicDisplay) and PDF (pdf.js) rendering with pinch-zoom/pan |
| `library/` | hamburger menu | A–Z grouped list, live search, filter chips, multi-select + batch delete, row context sheet, empty/no-results states |
| `setlists/` | hamburger menu | Upcoming/Past/Templates tabs, **run-sheet detail** (sections, derived per-slot start times, per-slot key/capo/note override sheet), Add-to-set drawer, Set-details sheet with duplicate-name validation |
| `add-edit-song/` | menu / Library FAB / row sheet | one screen for both New and Edit — title/artist/key/tempo/time-signature fields are always editable (editing a song's metadata isn't a separate flow), packed into two compact rows (Title+Key, then Artist+Tempo+Time Sig.) so the metadata block stays out of the chord/lyrics editor's way — the ChordPro-vs-Chords-over-Lyrics textarea is kept to at least ~50% of the device height by design, live `{key: ...}` directive detection, format-aware quick-insert chips (chords used so far + ChordPro directives), a compact "Import" button that hands the in-progress draft to `import/` and gets it back via `nav.replace` (see Gotchas), tabs for **Chords/Lyrics** (source) + **Preview** always, plus one tab per attachment category the song actually has (Sheet Music / PDF / Photo — only the ones present), each showing the selected version's preview, a version list (rename/select/delete) once the bucket holds more than one version, and an "Add another version…" action |
| `import/` | Library's dedicated import FAB (⇩, stacked under the main "+") / empty-state "Import a chart" button / the "Import" button inside `add-edit-song/` | real `<input type="file">` picker for PDF, photo, or MusicXML, in three target modes: **new song** (Library import → creates a song), **attach to existing song** (Library import → "Attach to an existing song…" → picker, with an optional "Name this version" field → `UPDATE_SONG` via `addVersion`, additive per category, chart untouched, PDF/photo only, no chord-conversion option since "linking a reference file" is conceptually different from regenerating a song's chart — the category is implied by the file's kind, so the old Sheet-music/Static-file role picker was retired once categories replaced roles), and **in-form** (the `add-edit-song/` Import button → always returns to that draft via `nav.replace`, never `nav.pop`, so the metadata/chords the person was mid-typing survive the round trip). For new-song and in-form imports, PDF/photo add a manual "What's in this file?" declaration (Chords & lyrics vs. Sheet music — there's no real content detection, the person importing states which it is) — Sheet music skips conversion and adds the actual uploaded file as a new version in that kind's bucket, Chords & lyrics runs a simulated convert-progress step into a review-and-save form with a canned chart preview and a "Simulate a failed scan" link. MusicXML is convert-only (no sheet/chords fork). Converting chords never clears prior attachments and attaching a file never clears prior chords — each import touches only the bucket it produced. |
| `tuner/` | hamburger menu | contextual one-time mic-permission sheet (gated in `Tuner.tsx` itself, so it fires regardless of entry point), instrument presets (Chromatic/Guitar/Bass/Ukulele/Violin/Viola/Cello) each with real standard-tuning reference frequencies — picking a stringed instrument reveals a second chip row of its strings (e.g. guitar's E2 A2 D3 G3 B3 E4), and the note letter/Hz/cents readout and bottom status bar all derive from whichever string is selected, flat/in-tune states via a "Simulate" control (always −18 cents flat until tapped, same simulated-reading approach as before, now computed relative to the selected preset's real frequency instead of a hardcoded A440), mic-off state |
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
  conversion entirely and adds the actual uploaded file as a new version in that kind's
  attachment bucket — Live Stage's Chord/Sheet toggle then renders that real
  image/PDF/MusicXML full-bleed instead of disabling the toggle, with the transpose/capo
  toolbar hidden whenever the song has no ChordPro chords to transpose. A song can carry
  chords, attachments, both, or neither — attachments are modeled as categorized,
  versioned buckets (see "Attachments" in Architecture above), not a single shared slot;
  that limitation from the original mockup was resolved, not left as a simplification.
- **No drag-and-drop reordering** in the setlist run sheet, nor of versions within an
  attachment bucket — the source's "lifted slot" drag visual wasn't implemented;
  reordering isn't available anywhere in the app.
- **No sync across devices.** SQLite persistence (see "Persistence" in Architecture) is
  local to one device/install — there's no backend, account system, or multi-device
  sync. `stage` and `viewport` also intentionally don't persist even locally.
- **The Industry blueprint/spec-sheet chrome was not built** — this app is the product
  the spec sheet describes, not a copy of the spec-sheet document itself.
- **One global theme, not per-surface theming.** The source's "Stage Dark" setting is
  scoped ("dark chart on stage, light everywhere else"); this app's Appearance toggle is
  simpler — one theme for the whole device frame, applied via `data-theme` at the root.
  Noted as a deliberate simplification, not an oversight.
- **A handful of the source's ~60 documented micro-states weren't wired**: the
  ChordPro-parse-error banner, the crash-restore onboarding variant, and the imported
  chart merge-strategy screen (Replace/Append/Review). The states covering the doc's
  stated priorities (Live Stage, transpose/capo, Setlist & Song CRUD) are all present.
  For the current, actively-maintained list of what's implemented vs. still open —
  including native-shell/persistence caveats this file doesn't track in detail — see
  `docs/progress-checklist.md`.

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
- **`nav.push`/`nav.replace` into and out of a screen must be symmetric, or a dead frame
  is left buried in the stack.** `add-edit-song/`'s "Import" button navigates to
  `import-song` with `nav.replace` (not `push`), because every way `ImportSong` returns
  to the in-progress draft (`finishForm`, `restoreDraft`) uses `nav.replace` back to
  `add-edit-song`, never `nav.pop`. If the entry side had used `push` instead, the
  original `add-edit-song` frame pushed before the import started would never get
  popped — `Save`/`Cancel` would only pop the *replaced* frame, landing back on a second,
  stale-looking `add-edit-song` screen instead of Library, requiring an extra tap to
  actually leave. (Library's "new song" and "attach to existing" import targets are the
  opposite case — those *are* `push`ed and their `ImportSong` exits correctly `nav.pop`,
  since nothing there needs draft-preserving `replace` semantics.) The rule: when a
  screen navigates away to gather more input and expects to return to itself with that
  input merged in, use `replace` on both the way out and the way back — never mix `push`
  going in with `replace` coming back, or vice versa.
- **First-run detection is a single `null` check, and songs/setlists/settings persist in
  separate writes, not one transaction.** `main.tsx` treats `settingsRepo.loadAll() ===
  null` as the only signal that this is a fresh install; the reducer's persist effect in
  `store.ts` then writes songs/setlists and settings as two separate steps. A crash
  between them can leave a device that looks like "first run" again even though real
  data was already written. Known fragility, not yet fixed — see
  `docs/progress-checklist.md` before assuming this is solid ground to build on.
- **`sql.js`'s version is pinned via a `package.json` `overrides` entry, and its
  `.wasm` asset must ship with the build.** The browser-dev persistence fallback
  (`jeep-sqlite` + `sql.js`) broke once before when `sql.js` moved out from under
  `jeep-sqlite`'s expectations; it's pinned to `1.11.0` in `overrides` for that reason.
  Don't bump it without verifying `npm run dev` still boots persistence cleanly (watch
  the console for SQLite init errors).

## Feature workflow

For any non-trivial feature or redesign (new screens, restructured data models,
anything that changes an interaction pattern), follow this sequence rather than jumping
straight to code:

1. **Spec** — brainstorm the design (approaches, trade-offs, open questions) and write it
   up as `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, following this repo's
   existing specs (e.g. `2026-08-26-capacitor-persistence-design.md`). Get the design
   approved in chat before writing the doc, and get the written doc reviewed before
   moving on.
2. **Mock-up — only when the feature changes or introduces UI/interaction, not for
   pure data/logic/persistence work.** Build a small, throwaway interactive HTML
   preview (a Claude Artifact, not app code) of the new screens/interactions, styled
   with this repo's real tokens (`src/theme.css` — Barlow/Barlow Condensed, the
   `--acc`/`--surface`/`--line` etc. custom properties) so it reads as this app, not a
   generic UI. This is for validating the interaction shape (what tabs/chips/sheets
   appear, what they do) before spending time wiring real state — skip this step
   entirely for changes with no new UI surface (e.g. a persistence-layer change, a
   bugfix, a refactor).
3. **Implementation** — once the spec (and mock-up, if there was one) are approved, hand
   off to the writing-plans skill for a concrete implementation plan, then execute it
   against the real `.tsx`/`.ts` files following the patterns already established in
   this codebase (see "Architecture" and "Gotchas" above).

## Running it

```
npm install
npm run dev          # http://localhost:5183 (or whatever port Vite picks) — browser dev,
                      # persistence falls back to sql.js/jeep-sqlite
npm run build        # tsc -b && vite build
npm run cap:sync     # vite build && npx cap sync
npm run cap:android  # build + sync + run on Android (emulator/device) — the only
                      # native platform actually verified so far
npm run cap:ios      # build + sync + run on iOS — scaffolded only, unverified
                      # (no Mac/Xcode available)
```

If you drive this app with browser-automation tooling (Playwright, etc.) during
development: `vite.config.ts` ignores `.playwright-mcp/**` in its file watcher on
purpose. Without that, every snapshot/screenshot the tooling writes into that folder
triggers a full-page reload that silently wipes the in-memory store mid-session — this
cost real debugging time while building the mockup, so it's fixed at the config level
rather than left as a trap.
