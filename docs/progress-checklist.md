# Zamar — Progress Checklist

Snapshot date: 2026-09-19. Branch: `mockup-to-implementation`.
Cross-check source: [review-findings.md](review-findings.md) (2026-09-12 senior review) verified
against the current working tree (uncommitted changes on top of commit `54be3a2`).

**Re-audited 2026-09-20 against `a64300c` (post-merge, includes the setlist-delete and
last-unimplemented-states work).** Every item below was re-checked directly against source —
see per-item notes for what changed and what didn't.

This app has moved past the original CLAUDE.md description of an in-memory mockup into a
real Capacitor + SQLite app, with a few pieces still deliberately simulated. See notes on
each item for what "done" actually means.

## Done — working functionality

### Shell & persistence
- [x] Capacitor native shell for Android (built and verified)
- [ ] Capacitor native shell for iOS — scaffolded; build previously broken by a Windows-backslash
      path in `Package.swift`, **now fixed** in the working tree (forward slashes, confirmed still
      in place at `ios/App/CapApp-SPM/Package.swift:15`), still not verified with an actual Xcode
      build — no Mac/Xcode available in this environment to close that out
- [x] SQLite persistence for songs, setlists, and settings (survives reload, native + web
      sql.js/jeep-sqlite fallback)

### Live Stage
- [x] Chord chart rendering with real transpose/capo math (not hand-placed spacing)
- [x] Expandable transpose/capo toolbar, Add-Song drawer, quick-edit sheet, annotate mode
- [x] Idle auto-hide chrome (6s), end-of-setlist state
- [x] Chord/Sheet toggle renders the real attached file — MusicXML via OpenSheetMusicDisplay,
      or photo/PDF via `<img>`/`<embed>` — with real pinch-to-zoom and drag-to-pan

### Library
- [x] A–Z grouped list, live search, filter chips
- [x] Multi-select + batch delete, row context sheet, empty/no-results states

### Setlists
- [x] Upcoming/Past/Templates tabs, run-sheet detail, derived per-slot start times
- [x] Per-slot key/capo/note override sheet, Add-to-set drawer

### Add/Edit Song
- [x] Combined new/edit screen, ChordPro-vs-Chords-over-Lyrics editing
- [x] Live `{key: ...}` directive detection, format-aware quick-insert chips, live Preview tab
- [x] Sheet Music tab appears once a song has an attachment, with remove-attachment action

### Import
- [x] Real file picker (PDF, photo, MusicXML) with genuine `FileReader` upload
- [x] "Sheet music" declaration path is fully real end-to-end (file stored and rendered later
      on Live Stage, no simulation involved)

### Tuner
- [x] Instrument presets (Chromatic/Guitar/Bass/Ukulele/Violin/Viola/Cello) with real standard
      tuning reference frequencies; readout computed relative to selected preset

### Settings & visual polish
- [x] Appearance sub-screen (Light/Stage Dark/Auto), type-`ERASE`-to-confirm reset
- [x] Real hand-drawn SVG icon set (`Icon.tsx`) replacing raw Unicode glyphs
- [x] Toggle-switch knob fixed to a neutral color regardless of on/off state
- [x] Backdrop blur added to sheets/dialogs/drawers

### Sheet music rendering
- [x] Replaced the fake, identical-for-every-song `ScorePreview` SVG with `MxlScore.tsx`,
      a real renderer built on OpenSheetMusicDisplay (loads `.mxl` directly, real engraving)
- [x] Real pinch-to-zoom / drag-to-pan on the rendered score

## Working as designed (intentionally simulated, not bugs)

- [ ] Tuner readings are toggled by a "Simulate" button — no real mic/pitch detection
- [ ] Import's "Chords & lyrics" conversion is a timer-driven fake — always produces the same
      canned ChordPro sample regardless of actual file content
- [ ] Export's PDF generation is a timer-driven progress simulation — no real PDF output

## To-do — confirmed still open (re-verified 2026-09-20 against `a64300c`)

All twelve items below were re-checked line-by-line against current source. None were touched by
the setlist-delete / last-unimplemented-states work that landed since the 09-19 snapshot — every
one still reproduces exactly as described.

- [ ] **Dead Settings toggles.** `keepAwake` / `autoscroll` still only flip
      `state.settings.keepAwake` / `.autoscroll` (`Settings.tsx:21-31`); no Wake Lock call, no
      scroll timer anywhere reads either flag. Either wire them up or remove them.
- [ ] **"Stage Dark" copy vs. behavior mismatch.** `Settings.tsx:38` still reads "Dark chart on
      stage, light everywhere else," but `App.tsx:69` / `:121` apply `data-theme` to the whole
      `.device` root in both the native and web render paths — it darkens the entire app. Fix the
      copy to match the simplification, or scope the theme.
- [ ] **Text-size slider disconnected from the real chart.** `Appearance.tsx:36,47` drives its
      sample off `settings.textScale`; `LiveStage.tsx:276` still feeds the real chart from a
      separate, session-only `stage.zoom`. Two same-range controls for the same thing, still don't
      compose. Unify these into one value.
- [ ] **Persistence "first run" gate is still fragile.** `main.tsx:16-17` still treats
      `settingsRepo.loadAll() === null` as the sole first-run signal, with no atomic
      songs/setlists+settings write and a catch-all that falls back to `initialState()` on any
      read failure. Unchanged since the 09-12 review — the fix-round commits addressed
      overlap/race timing, not this root design.
- [ ] **Setlist status is a static field, not derived from date.** `Setlists.tsx:25` still
      hardcodes `status: "upcoming"` in the new-setlist object; nothing recomputes "upcoming" vs.
      "past" from the actual date. Still masked by zero-setlist seed data.
- [ ] **Library FABs can cover the last list rows.** `Library.tsx:198`'s scroll container
      (`flex-1 hidden-scroll`) still carries no bottom padding sized to `.fab-stack`'s height —
      last 1–2 rows (and their "⋯" menu) can still sit under the FABs.
- [ ] **New setlist writes to the store immediately.** `Setlists.tsx:28` still dispatches
      `ADD_SETLIST` before `nav.push("setlist-detail", ...)` — no cancel/discard path, still
      inconsistent with Add/Edit Song's wait-for-Save flow.
- [ ] Stale comment in `types.ts:13`: `dataUrl` still documented as "in-memory only, like
      everything else in this mockup" — no longer accurate once SQLite persistence landed.
- [ ] CLAUDE.md itself is still stale on "Single global reducer, no persistence" and the mockup
      framing generally — needs a pass once the above items settle.
- [ ] `chordpro.ts`'s `FLAT_TO_SHARP` (lines 3-9) still maps exactly 5 flats (Db/Eb/Gb/Ab/Bb); an
      uncommon root (e.g. `Cb`, `Fb`) still silently no-ops in `normalizeRoot` instead of erroring.
- [ ] `setlistCalc.ts:53` (`startClockLabel`) still computes `isPM = /pm/i.test(m[3] ?? "")`, so a
      missing AM/PM suffix is still silently treated as AM with no validation.
- [ ] Heavy use of ad-hoc inline `style={{...}}` objects instead of shared CSS classes — still
      pervasive (e.g. every row of `Library.tsx`, `Appearance.tsx`'s whole layout).

## To-do — UI/UX polish (from the design review, not yet actioned)

Re-checked 2026-09-20 — all four still apply, none touched since the design review:

- [ ] No iOS-style Large Title on root screens (`Header` component is used unchanged on
      Library/Setlists/Settings; no large-title variant exists in the codebase)
- [ ] List rows use a "boxed card per row" Material-ish style (`.list-row` in `theme.css:359`)
      rather than iOS's fused grouped-table look (valid alternative, just noting the departure)
- [ ] FABs remain a Material Design pattern, not native to iOS — noted as out of scope for now
      (bigger layout change than warranted)
- [ ] Chord/lyric chart text runs a little small relative to iOS defaults — legibility concern
      for a "read it from a music stand" use case
