# Zamar — Progress Checklist

Snapshot date: 2026-09-19. Branch: `mockup-to-implementation`.
Cross-check source: [review-findings.md](review-findings.md) (2026-09-12 senior review) verified
against the current working tree (uncommitted changes on top of commit `54be3a2`).

This app has moved past the original CLAUDE.md description of an in-memory mockup into a
real Capacitor + SQLite app, with a few pieces still deliberately simulated. See notes on
each item for what "done" actually means.

## Core functionality — high priority

The load-bearing capabilities the app is built around. Verified against the current
working tree on 2026-09-19.

- [x] **Chord & Lyrics.** Songs support lyrics plus chords entered as either ChordPro
      (`[C]lyric`) or Chords-over-Lyrics, toggled via a `Segmented` control in
      `add-edit-song/AddEditSong.tsx`. Both formats are genuinely parsed (not just accepted
      as text) by `src/utils/chordpro.ts` — `parseChordProLine` for bracket syntax,
      `isChordLine`/`mergeChordAndLyricLine` for the over-lyrics format — and both feed the
      same real transpose math.
- [x] **Music Sheet.** Songs can carry sheet music as `.mxl`, image, or PDF
      (`Song.attachment`). Live Stage and the Add/Edit Song preview render it via
      `MxlScore.tsx` (MusicXML), `<img>` (image), or `<embed type="application/pdf">` (PDF)
      inside a `overflow-y: auto` / `touchAction: pan-y` container — a vertical scrolling
      viewer, not a horizontal pager. Note: the PDF `<embed>` defers to the browser's native
      PDF plugin for its internal scroll/zoom, which isn't itself under app control.
- [x] **Transposition.** Chord letters transpose by real semitone distance
      (`chordpro.ts`'s `transposeChord`/`keySemitoneShift`). Sheet music transposes too, not
      just chords: `MxlScore.tsx` sets `osmd.TransposeCalculator` and `osmd.Sheet.Transpose`
      and re-renders whenever the `transpose` prop changes, driven by the same semitone value
      `LiveStage.tsx` computes from the selected key — genuine OSMD re-engraving in the new
      key (e.g. C → Eb), not a cosmetic shift.
- [x] **Song & Set Library.** Song CRUD is complete (`ADD_SONG`/`UPDATE_SONG`/
      `DUPLICATE_SONG`/`DELETE_SONGS` in `store.ts`, wired from `Library.tsx`). Setlist CRUD
      is now complete too: sections and items within a setlist have full
      add/update/remove/duplicate/move actions, `ADD_SETLIST`/`UPDATE_SETLIST_META` manage
      metadata, and a `DELETE_SETLIST` reducer action (which also clears live `stage` state
      if the deleted setlist was the one currently on stage) is wired to a "Delete set" entry
      in `SetlistDetail.tsx`'s `⋯` menu, with the same Keep/Delete confirm-dialog style already
      used for song batch delete and section delete.
- [ ] **Live Stage.** Single-song stage view is fully done. Whole-setlist playback also
      works — swipe gestures advance through `setlistSongIds` (`STAGE_ADVANCE` in
      `store.ts`), and an end-of-setlist "Set complete" screen exists — but while a song is
      actively on stage there is **no current-song-position indicator, no next-song preview,
      and no progress bar**. `songIndex`/`setlistSongIds.length` are already computed in
      `LiveStage.tsx` but never rendered. The only "next song" UI in the codebase is
      `AddSongDrawer.tsx`'s `upNext()`, which appends to the setlist — a queue-building
      action, unrelated to an on-stage display.
      **To do:** add a compact "Song X of N" / next-song-title indicator and a progress bar
      to `LiveStage.tsx`'s setlist-mode header, using the already-computed `songIndex` and
      `setlistSongIds`.
- [ ] **Annotate / custom notes on a song.** Should let the user write or mark up custom
      notes on a song regardless of its chart type — chords+lyrics, PDF/image, or `.mxl`.
      **Currently missing across the board:**
      - Live Stage's "Annotate" mode (`stage.annotate` in `store.ts`/`types.ts`, rendered by
        `AnnotateMode` in `LiveStage.tsx`) is a decorative shell: it shows a chord chart with
        chords hidden plus a floating tool palette (pen/square/eraser/color-dot icons), but
        none of those icons have click handlers, there's no `<canvas>` or stroke state, and
        nothing is persisted — "Done"/"Undo" just toggle the mode off. No real drawing exists
        yet on the chords+lyrics view either.
      - The Annotate control is only ever rendered when `view === "chords"`
        (`MusicToolbar.tsx`) — switching to the sheet/attachment view (PDF, image, or
        MusicXML) removes the Annotate icon entirely, and a chord-less attachment-only song
        may not even get a toolbar (`hasChords || hasScore` gate in `LiveStage.tsx`). So
        there is no path to annotate a PDF/image or a rendered `.mxl` score at all.
      - `Song` (`src/state/types.ts`) has no freeform `notes` field, and `add-edit-song/` has
        no notes textarea — the only freeform text in the data model today is
        `SetlistItem.note` (the run-sheet "note for the band," edited in
        `SlotDetailSheet.tsx`), which is scoped to one song's slot in one setlist, not to the
        song itself, and is unrelated to chart/attachment display.
      **To do:** decide on a real annotation model (e.g. per-song freeform notes field, and/or
      persisted markup strokes keyed by song + chart type), wire actual drawing/writing
      interactions for chords+lyrics, and extend the same capability to the PDF/image and
      MusicXML sheet views instead of gating Annotate to `view === "chords"` only.

## Nice-to-have — R&D / spike candidates

Not core functionality, not scheduled — flagged here so they don't get lost.

- [ ] **PDF/Image → `.mxl` conversion (OMR).** Optical Music Recognition to convert an
      imported PDF or photo of sheet music into real `.mxl`/MusicXML (so it could then get
      genuine transposition/re-engraving via `MxlScore.tsx`, instead of staying a static
      image/PDF attachment). Note this is a different problem from `import/`'s existing
      "Chords & lyrics" conversion path, which is already a simulated/canned conversion for
      text charts — OMR would mean actually recognizing musical notation from a raster/PDF
      source, which is a much harder, open-ended problem (accuracy on real-world scans,
      licensing/bundling an OMR engine or model, on-device feasibility offline). **Action:**
      spike/R&D only for now — evaluate feasibility and candidate approaches before
      committing to a real implementation.

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
