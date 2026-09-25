# Zamar

## What this is

Zamar is an offline, on-device worship chord-chart / setlist app ("Make worship, made
easier"). It began as a click-through mockup of the "Zamar Wireframe Gallery —
HIG/Material Refresh" design (Claude Design project `Zamar redesign scope questions`) and
is now a real Capacitor app with on-device SQLite persistence, real MusicXML/PDF rendering,
and real ChordPro parsing/transposition. A few pieces are still simulated on purpose (see
"Deliberately simulated or left out"). For feature-by-feature status, see
`docs/progress-checklist.md`.

The source design's annotated spec-sheet chrome ("Industry" blueprint system: square
corners, registration marks) is **not** reproduced. The app uses its own rounded visual
language.

## Target platform & users

Architected to be **OS-agnostic** (Capacitor + web tech; iOS, Android, and browser-dev as
equal citizens; no iOS-only APIs in required code paths). But the initial users are **iOS
users leaving OnSong**, so **UI/UX defaults to iOS conventions** (Apple HIG: navigation
chrome, gestures, sheets, type and touch-target sizing) while the implementation stays
portable. When an iOS convention and a cross-platform default conflict, favor iOS but flag
the tension rather than silently picking one.

## Ground rules

- **Do not make assumptions.** Ask when something is uncertain or underspecified.
- **Present better options when they'd significantly improve the outcome**, but propose,
  don't unilaterally swap approaches.
- **Preserve existing comments when they're still correct.**
- **Never add Claude as a commit co-author.** No `Co-Authored-By: Claude ...` or any
  Claude/Anthropic trailer in commit messages. This overrides default attribution behavior.
- **Never mention Claude, Anthropic, or AI authorship in code comments.**
- **Never reference Claude, Anthropic, or AI authorship in PR descriptions** (no
  "Generated with Claude Code" footer, session links, or model names).
- **Commit messages describe the change** (what and why). No `fix:`/`feat:`-style prefixes.

## Tech stack

- **Vite + React 18 + TypeScript**, wrapped in **Capacitor** (`@capacitor/android`,
  `@capacitor/ios`). No router library or state-management package.
- **`@capacitor-community/sqlite`** on native; **`sql.js` + `jeep-sqlite`** as the
  browser-dev fallback (same repo layer and schema, different engine).
- **`opensheetmusicdisplay`** renders and re-transposes `.mxl` scores (`MxlScore.tsx`).
- **`tesseract.js`** (+ `@tesseract.js-data/eng`) for offline OCR on import; **`pdf-lib`** and
  **`fflate`** build exports; **`@capacitor/share`** + **`@capacitor/filesystem`** share them.
- **`pdfjs-dist`** renders PDFs page-by-page with pinch-zoom/pan (`PdfPages.tsx`).
- Plain CSS with custom properties (`src/theme.css`), no Tailwind or CSS-in-JS. Icons are a
  hand-drawn SVG set (`src/components/Icon.tsx`).
- Only Android has actually been built and run. The iOS folder is scaffolded but
  unverified (no Mac/Xcode available).

## Architecture

- **Device frame (browser dev only).** `App.tsx` renders the app inside a `.device` frame
  with Appearance (Light / Stage Dark) and Viewport (Phone `402×874`, iPad Air 11″
  `820×1180`, iPad Air 13″ `1024×1366`) controls. On native (`Capacitor.isNativePlatform()`)
  it renders full-screen with no frame or toggle bar.
- **Tabbed stack navigator, no URL routing.** `src/navigation/Navigator.tsx` keeps one
  `{ screen, params }` stack per tab (Live Stage, Library, Setlists, Tuner, Settings —
  `TabBar.tsx`) with `push`/`pop`/`replace`/`reset`/`switchTab`. `MODAL_SCREENS`
  (`add-edit-song`, `import-song`) hide the tab bar, per iOS modal convention.
- **One global reducer, persisted to SQLite.** `src/state/store.ts` is one `useReducer`
  (`songs`, `setlists`, `settings`, `stage`, `viewport`). `songs`/`setlists`/`settings` are
  written to the DB via `src/data/{db,songsRepo,setlistsRepo,settingsRepo}.ts` in one
  debounced, atomic `executeSet`. `main.tsx` loads persisted state on boot, seeds from
  `src/state/mockData.ts` only when nothing is stored, and runs in-memory only (persistence
  off) if the read throws, so it never overwrites real data with seed data. `stage` and
  `viewport` are session UI state and are not persisted. No sync or backend.
- **Design tokens.** `--bg`, `--fg`, `--acc`, `--acc-deep`, `--surface`, `--line`,
  `--tint`, `--scrim` in `theme.css`, light and dark, applied via `data-theme` on `.device`.
  Barlow / Barlow Condensed, steel-blue accent.
- **ChordPro and transposition are real.** `src/utils/chordpro.ts` parses both `[C]lyric`
  ChordPro and chords-over-lyrics, positions chords from real offsets, and transposes by
  semitone distance (`keySemitoneShift`/`transposeChord`). `MxlScore.tsx` re-engraves
  MusicXML in the display key via OSMD.
- **Attachments are categorized, versioned buckets.** `Song.attachments`
  (`src/state/types.ts`) holds up to one bucket per kind (`musicxml` → Sheet Music, `pdf`,
  `image` → Photo), each an ordered list of versions plus a `selectedVersionId`. All
  mutations go through `src/utils/attachments.ts` (`addVersion`, `removeVersion`,
  `renameVersion`, `selectVersion`). Imports are additive at the version level. Live
  Stage's category/version choice is local state; only Add/Edit Song's "Use this version"
  changes the persisted default. Rationale:
  `docs/superpowers/specs/2026-09-20-attachment-categories-design.md`.
- **Annotations and cues.** `Song.annotations` holds ink, pins, text and shapes per view
  type; `Song.notes` is the per-song "Cues" text. Annotate is an overlay on the persistent
  Live Stage (`AnnotateOverlay.tsx` + `components/AnnotateCanvas.tsx`, helpers in
  `utils/annotations.ts`). See `docs/superpowers/specs/2026-09-23-annotate-as-overlay-design.md`
  and `docs/annotate-mode-roadmap.md`.

## Screens (`src/screens/<area>/`)

| Area | Reached from | Notable pieces |
|---|---|---|
| `onboarding/` | app boot | Splash only; auto-advances (650ms) into Live Stage |
| `live-stage/` | tab | chords or attachment view, key chips + Stage Tools sheet (Add to Setlist, Quick edit, Annotate, view/version picker, capo/lyrics/zoom), idle auto-hide chrome (6s), per-song default view |
| `library/` | tab | A–Z list, search, filter chips, multi-select delete, row context sheet, "+" and import FABs |
| `setlists/` | tab | Upcoming/Past/Templates, run-sheet detail (sections, derived start times, per-slot overrides), Add-to-set sheet, Set-details sheet |
| `add-edit-song/` | Library "+" / row sheet | one screen for New and Edit; metadata in two compact rows, chord/lyrics editor kept ≥ ~50% of device height, quick-insert chips, Chords/Lyrics + Preview tabs plus one tab per attachment category present, "Import" button |
| `import/` | Library import FAB / empty state / Add/Edit Song "Import" | real file picker (PDF, photo, MusicXML) in three modes: new song, attach to existing song (PDF/photo only), and in-form (returns to the draft) |
| `tuner/` | tab | one-time mic-permission pre-prompt, live mic pitch detection (`utils/pitch.ts`), instrument presets with Auto string follow |
| `settings/` | tab | stave spacing, Appearance sub-screen (Light/Stage Dark/Auto, text size), type-`ERASE` reset |
| `export/` | a setlist's ⋯ menu / Library row sheet (one song) | format tabs, options, per-song "In this export" list, real PDF/ChordPro/MusicXML files (`utils/exportSet.ts`) handed to the OS share sheet (`utils/shareFile.ts`) |

Shared primitives are in `src/components/`.

## Deliberately simulated or left out

- **Sheet-vs-chords is declared, not detected.** Import asks "What's in this file?".
  "Chords & lyrics" conversion is real (`utils/chartImport.ts`: pdf.js text layer, else
  bundled offline Tesseract OCR), but OCR'd charts usually need touching up.
- **MusicXML export can't re-key scores.** Scores go out as imported; the PDF export does
  engrave them in the set key. Annotations aren't exported in any format.
- **One global theme**, not the source's scoped "dark on stage, light elsewhere".
- **Unwired source micro-state:** crash-restore onboarding.
- **Capo is cut** (TODO): it needs its own design pass against the transpose/key system
  before it comes back. See `docs/progress-checklist.md`.

## Gotchas

- **Gate contextual permission/onboarding sheets in the destination screen**, not at the
  call site. The Tuner's mic sheet lives in `Tuner.tsx` so it fires however the screen is
  reached.
- **Keep `push`/`replace` symmetric.** Add/Edit Song's "Import" uses `nav.replace` to
  `import-song`, and `ImportSong` returns with `nav.replace` (`finishForm`,
  `restoreDraft`). Mixing `push` in with `replace` out leaves a stale frame in the stack.
  Library's import targets are `push`ed and exit with `nav.pop`.
- **`sql.js` is pinned to `1.11.0`** via `package.json` `overrides`, because a bump broke
  `jeep-sqlite` before. Verify `npm run dev` still boots persistence before changing it.
- **`vite.config.ts` ignores `.playwright-mcp/**`** so browser-automation snapshots don't
  trigger reloads that wipe in-memory state.
- **Tesseract's model keeps its file name.** `vite.config.ts` emits
  `eng.traineddata.gz` unhashed under `assets/ocr/`, because Tesseract builds that URL from a
  folder plus the fixed name. Don't fold it into the hashed asset pattern.
- **No lint/test tooling.** `npm run build` is the only check; a clean build is the bar.

## Feature workflow

For non-trivial features or redesigns:

1. **Spec.** Brainstorm, get the design approved in chat, then write
   `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (follow existing specs) and get
   it reviewed.
2. **Mock-up, only for UI/interaction changes.** A throwaway interactive HTML Artifact
   styled with `src/theme.css` tokens, to validate the interaction shape. Skip for
   data/logic/persistence work, bugfixes, and refactors.
3. **Implementation.** Write a plan (`docs/superpowers/plans/`) with the writing-plans
   skill, then execute it following the patterns above.

## Running it

```
npm install
npm run dev          # browser dev (Vite picks the port); persistence via sql.js/jeep-sqlite
npm run build        # tsc -b && vite build
npm run cap:sync     # vite build && npx cap sync
npm run cap:android  # build + sync + run on Android (verified)
npm run cap:ios      # build + sync + run on iOS (unverified)
```

Device setup, signing, debugging and an on-device test checklist are in
`docs/device-testing.md`.
