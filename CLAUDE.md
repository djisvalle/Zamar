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
- **Never commit as Claude.** Author and committer are always
  `Israel Valle <israelvalle48@gmail.com>`, never `Claude <noreply@anthropic.com>`. Check
  `git config user.name`/`user.email` first; if the environment is set to Claude, commit with
  `git -c user.name="Israel Valle" -c user.email="israelvalle48@gmail.com" commit ...`.
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
- **`@capacitor/status-bar`** matches the OS status bar to the theme; **`@capacitor/haptics`**
  gives Annotate's snap-to-lyric-line tick on native.
- Notation stamps are engraved SMuFL glyphs from a bundled **Bravura** font
  (`src/assets/fonts/`, `utils/notation.ts`, `components/SmuflGlyph.tsx`).
- **`pdfjs-dist`** renders PDFs page by page, nearest pages first, with pinch-zoom/pan
  (`PdfPages.tsx`; see `docs/superpowers/specs/2026-09-27-pdf-progressive-rendering-design.md`).
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
  `{ id, screen, params }` stack per tab (Live Stage, Library, Setlists, Tuner, Settings —
  `TabBar.tsx`) with `push`/`pop`/`replace`/`reset`/`switchTab`. `MODAL_SCREENS`
  (`add-edit-song`, `import-song`) hide the tab bar, per iOS modal convention.
- **Tabs stay mounted.** A tab mounts on its first visit, and `ScreenHost` (`App.tsx`) then
  keeps every frame of every visited tab mounted in its own `.screen-layer`, keyed by frame
  id; all but the active tab's top are `visibility: hidden` + `inert`. So Live Stage keeps
  its score, scroll and zoom across tab switches, and Library its search. `replace`,
  `reset` and `resetTab` keep a frame's id when the screen stays the same, so they update it
  rather than remount it. See
  `docs/superpowers/specs/2026-09-26-tab-persistence-and-fast-start-design.md`.
- **Boot.** `index.html` shows a static splash (themed from `localStorage`'s `zamar.theme`,
  else the system setting) while JS and the database load; the first React render replaces
  it, straight into Live Stage. `main.tsx` starts loading the stage song's attachment and
  its renderer (`preloadStageSong`) before that render.
- **One global reducer, persisted to SQLite.** `src/state/store.ts` is one `useReducer`
  (`songs`, `setlists`, `settings`, `stage`, `viewport`). `songs`/`setlists`/`settings` are
  written to the DB via `src/data/{db,songsRepo,setlistsRepo,settingsRepo}.ts` in one
  debounced, atomic `executeSet` holding only the rows that changed: the store diffs against a
  snapshot of what's on disk by object identity (`src/data/persistPlan.ts`), so reducers must
  never mutate in place. `main.tsx` loads persisted state on boot, seeds from
  `src/state/mockData.ts` only when nothing is stored, and runs in-memory only (persistence
  off) if the read throws, so it never overwrites real data with seed data. `stage` and
  `viewport` are session UI state and are not persisted. No sync or backend.
- **Design tokens.** `--bg`, `--fg`, `--acc`, `--acc-deep`, `--surface`, `--line`,
  `--tint`, `--scrim` in `theme.css`, light and dark, applied via `data-theme` on `.device`.
  Barlow / Barlow Condensed, steel-blue accent.
- **ChordPro and transposition are real.** `src/utils/chordpro.ts` parses both `[C]lyric`
  ChordPro and chords-over-lyrics (including bar lines `C | F` and passing moves `Bb/F-F`),
  stacks each chord over the lyric text it starts on, and transposes
  letter-aware between two keys (`utils/keys.ts`: 17 key chips (every sharp and flat name for
  the black keys, no C♭; old C♭ keys load as B), nearest-way `keySemitoneShift`, spelling
  rules). `{comment}` and `{start_of_chorus}`/`{soc}`-style directives render as section
  labels. In Add/Edit Song the `{title}`, `{artist}`, `{key}`, `{tempo}` and `{time}`
  directives and the song's fields stay in sync both ways. `MxlScore.tsx` re-engraves MusicXML in the display
  key via OSMD with `utils/scoreTranspose.ts` in place of OSMD's own transpose calculator.
- **Attachments are categorized, versioned buckets.** `Song.attachments`
  (`src/state/types.ts`) holds up to one bucket per kind (`musicxml` → Sheet Music, `pdf`,
  `image` → Photo), each an ordered list of versions plus a `selectedVersionId`. All
  mutations go through `src/utils/attachments.ts` (`addVersion`, `removeVersion`,
  `renameVersion`, `selectVersion`). Imports are additive at the version level. Live
  Stage's category/version choice is local state; only Add/Edit Song's "Use this version"
  changes the persisted default. Rationale:
  `docs/superpowers/specs/2026-09-20-attachment-categories-design.md`. A version holds no
  file: the bytes live in the `attachment_data` table by version id, read on demand (and
  prefetched for the next setlist song) through `src/data/attachmentData.ts`; a new import
  is held there until a save writes it for a song that references it. See
  `docs/superpowers/specs/2026-09-26-incremental-persistence-design.md`.
- **Annotations and cues.** `Song.annotations` holds ink, sticky notes (stored as `Pin`),
  text, notation stamps and shapes per view type; `Song.notes` is the per-song "Cues" text. Annotate is an overlay on the persistent
  Live Stage (`AnnotateOverlay.tsx` + `components/AnnotateCanvas.tsx`, helpers in
  `utils/annotations.ts`). See `docs/superpowers/specs/2026-09-23-annotate-as-overlay-design.md`
  and `docs/annotate-mode-roadmap.md`. Marks are pixel positions, so Live Stage lays the chart
  out at one fixed width (the portrait width, or the width a view was marked at; `usePortraitWidth`
  in `LiveStage.tsx`) and magnifies it with a CSS transform to fill the pane in either
  orientation. Code inside the chart that turns pointer coordinates into content coordinates
  must divide by `screenScaleOf` (`utils/screenScale.ts`). While annotating, one finger draws
  and two fingers scroll.

## Screens (`src/screens/<area>/`)

| Area | Reached from | Notable pieces |
|---|---|---|
| `live-stage/` | tab | chords or attachment view, key chips + Stage Tools sheet (Add to Setlist, Quick edit, Annotate, view/version picker, capo/lyrics/zoom), idle auto-hide chrome (6s) plus tap-empty-space to toggle it, per-song default view, setlist strip (next song, progress, slot notes), song-to-song swipes (also over PDFs and scores), each song opens at the top |
| `library/` | tab | A–Z list, search, filter chips, multi-select delete, row context sheet, header "+" menu (New song / Import a chart) |
| `setlists/` | tab | Upcoming/Past/Templates, run-sheet detail (sections, derived start times, per-slot key/note overrides), drag-to-reorder slots and sections (`useDragReorder.ts`), toolbar "+" (Add songs / Add section), Start/Resume/Restart/Stop set, Add-to-set sheet, Set-details sheet |
| `add-edit-song/` | Library "+" / row sheet | one screen for New and Edit; metadata in two compact rows, chord/lyrics editor kept ≥ ~50% of device height, quick-insert chips, caret keys + undo/redo + expand bar under the editor (`CaretKeys.tsx`, `useTextHistory.ts`), chart-problem banner, Chords/Lyrics + Preview tabs plus one tab per attachment category present, "Import" button |
| `import/` | Library "+" menu / empty state / row sheet / Add/Edit Song "Import" | real file picker (PDF, photo, MusicXML) in three modes: new song, attach to existing song (PDF/photo only), and in-form (returns to the draft) |
| `tuner/` | tab | one-time mic-permission pre-prompt, live mic pitch detection (`utils/pitch.ts`), instrument presets with Auto string follow |
| `settings/` | tab | stave spacing, Keys (key offsets, strict spelling), Appearance sub-screen (Light/Stage Dark/Auto, text size), type-`ERASE` reset |
| `export/` | a setlist's ⋯ menu / Library row sheet (one song) | format tabs, options, per-song "In this export" list, real PDF/ChordPro/MusicXML files (`utils/exportSet.ts`) handed to the OS share sheet (`utils/shareFile.ts`) |

Shared primitives are in `src/components/`.

## Deliberately simulated or left out

- **Sheet-vs-chords is declared, not detected.** Import asks "What's in this file?".
  "Chords & lyrics" conversion is real (`utils/chartImport.ts`: pdf.js text layer, else
  bundled offline Tesseract OCR), but OCR'd charts usually need touching up.
- **Annotations only export to PDF.** ChordPro and MusicXML can't carry ink. Marks on a chord
  chart print over a replica of the stage layout (see
  `docs/superpowers/specs/2026-09-25-priority-2-design.md`), so they need chords included.
- **One global theme**, not the source's scoped "dark on stage, light elsewhere".
- **Unwired source micro-state:** crash-restore onboarding.
- **Artist and tempo may be blank.** No "Unknown"/80 BPM defaults; tempo `0` means none.
  `hydrateState` loads old "Unknown" artists as blank.
- **Capo is cut** (TODO): it needs its own design pass against the transpose/key system
  before it comes back. See `docs/progress-checklist.md`.

## Gotchas

- **Screens read their own frame with `useFrame()`**, not `useNavigator().top`, which
  describes the active tab and is wrong for a screen kept mounted behind another. Anything
  that runs on a timer or holds a device resource pauses while `useFrame().showing` is
  false (Live Stage's idle timer, the Tuner's mic).
- **Never set `visibility: visible` explicitly** inside a screen; leave it unset to inherit.
  An explicit `visible` shows through the hidden layer of a tab that isn't on screen.
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
- **Tesseract's model keeps its file name.** `vite.config.ts` emits the model unhashed as
  `assets/ocr/eng.traineddata`, because Tesseract builds that URL from a folder plus the fixed
  name. Don't fold it into the hashed asset pattern. It deliberately drops the `.gz` suffix
  (the data is still gzipped; Tesseract detects that) because a `.gz` asset left Android OCR
  stuck on "Preparing text recognition…".
- **`#root` needs `min-width: 0`.** It's a flex item, so without it a `nowrap` chip row
  widens the whole app past the screen instead of scrolling in its lane.
- **Inline styles are mid-migration.** About 235 `style={{...}}` objects remain; the plan
  for moving the fixed ones into `theme.css` is
  `docs/superpowers/specs/2026-09-26-inline-styles-to-css-design.md`. Put new fixed styles
  in `theme.css` under a purpose-named class; keep only runtime values inline.
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
