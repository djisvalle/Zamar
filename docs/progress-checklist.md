# Zamar — Progress Checklist

Snapshot date: 2026-09-19. Branch: `mockup-to-implementation`.
Cross-check source: [review-findings.md](review-findings.md) (2026-09-12 senior review) verified
against the current working tree (uncommitted changes on top of commit `54be3a2`).

This app has moved past the original CLAUDE.md description of an in-memory mockup into a
real Capacitor + SQLite app, with a few pieces still deliberately simulated. See notes on
each item for what "done" actually means.

## Done — working functionality

### Shell & persistence
- [x] Capacitor native shell for Android (built and verified)
- [ ] Capacitor native shell for iOS — scaffolded; build previously broken by a Windows-backslash
      path in `Package.swift`, **now fixed** in the working tree (forward slashes), not yet
      verified with an actual Xcode build
- [x] SQLite persistence for songs, setlists, and settings (survives reload, native + web
      sql.js/jeep-sqlite fallback)

### Live Stage
- [x] Chord chart rendering with real transpose/capo math (not hand-placed spacing)
- [x] Expandable transpose/capo toolbar, Add-Song drawer, quick-edit sheet
- [x] Annotate mode: freehand pen + highlighter (each with its own color/size/opacity),
      a movable/editable text tool, a 16-symbol music-notation stamp palette (dynamics,
      articulation, accidentals, bowing), an eraser, per-song undo/redo, and clear-this-page
      vs. clear-all — session-only state (`state.annotations`/`state.annotationHistory` in
      `src/state/store.ts`), not persisted to SQLite
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

## To-do — confirmed still open (verified against current working tree)

- [ ] **Dead Settings toggles.** `keepAwake` / `autoscroll` persist a boolean but nothing reads
      either flag anywhere (no Wake Lock call, no scroll timer). Either wire them up or remove
      them.
- [ ] **"Stage Dark" copy vs. behavior mismatch.** Settings still claims *"Dark chart on stage,
      light everywhere else,"* but `App.tsx` applies `data-theme` to the whole `.device` root —
      it darkens the entire app. Fix the copy to match the simplification, or scope the theme.
- [ ] **Text-size slider disconnected from the real chart.** `Appearance.tsx`'s sample is driven
      by `settings.textScale`; the actual Live Stage chart is driven by a separate
      `stage.zoom` (session-only, resets every session). Unify these into one value.
- [ ] **Persistence "first run" gate is still fragile.** `main.tsx` still treats
      `settingsRepo.loadAll() === null` as the sole first-run signal, while `store.ts`'s persist
      effect still writes songs/setlists and then settings as two separate steps (not one
      transaction). A crash between the two writes still risks a silent reseed-over-real-data on
      next boot. The fix-round commits addressed overlap/race timing, not this root design.
- [ ] **Setlist status is a static field, not derived from date.** `createSetlist()` hardcodes
      `status: "upcoming"`; nothing recomputes "upcoming" vs. "past" from the setlist's actual
      date. Currently masked because seed data ships with zero setlists — will resurface as soon
      as a real setlist's date passes.
- [ ] **Library FABs can cover the last list rows.** The scrollable list has no bottom padding
      reserved for `.fab-stack`; last 1–2 rows (and their "⋯" menu) can sit under the FABs.
- [ ] **New setlist writes to the store immediately.** Tapping "+" / "Build a set" dispatches
      `ADD_SETLIST` before the user enters any details, with no cancel/discard path — inconsistent
      with Add/Edit Song, which waits for Save.
- [ ] Stale comment in `types.ts`: `dataUrl` still documented as "in-memory only, like everything
      else in this mockup" — no longer accurate once SQLite persistence landed.
- [ ] CLAUDE.md itself is stale on "Single global reducer, no persistence" and the mockup framing
      generally — needs a pass once the above items settle.
- [ ] `chordpro.ts`'s `normalizeRoot` only maps 5 flats; an uncommon root silently no-ops instead
      of erroring.
- [ ] `setlistCalc.ts` treats a missing AM/PM suffix as AM with no validation.
- [ ] Heavy use of ad-hoc inline `style={{...}}` objects instead of shared CSS classes.

## To-do — UI/UX polish (from the design review, not yet actioned)

- [ ] No iOS-style Large Title on root screens (Library/Setlists/Settings all use the same
      small inline header)
- [ ] List rows use a "boxed card per row" Material-ish style rather than iOS's fused
      grouped-table look (valid alternative, just noting the departure)
- [ ] FABs remain a Material Design pattern, not native to iOS — noted as out of scope for now
      (bigger layout change than warranted)
- [ ] Chord/lyric chart text runs a little small relative to iOS defaults — legibility concern
      for a "read it from a music stand" use case
