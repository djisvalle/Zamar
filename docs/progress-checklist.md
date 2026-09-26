# Zamar — Progress Checklist

Snapshot date: 2026-09-25. Re-checked against `main` at commit `259c6a3`.
Cross-check sources: [review-findings.md](review-findings.md) (senior review, re-checked
2026-09-25) and [annotate-mode-roadmap.md](annotate-mode-roadmap.md).

## Still open at a glance

Everything below is detailed further down; this is the short list.

- **iOS native build** — scaffolded, never built in Xcode (see Shell & persistence).
- **Tuner on a real device** — only tried in the browser so far. Native mic permissions
  are in place; the pass to run is in `docs/device-testing.md` ("Tuner (real microphone)").
- **Capo** — cut; needs its own design pass against transpose/keys (see Nice-to-have).
- **Annotations export to PDF only** — ChordPro and MusicXML can't carry ink (see Export).
- **Crash-restore onboarding** from the source design is unwired.
- **OMR (PDF/photo → `.mxl`)** — R&D spike only.
- **Annotate:** per-song stave spacing; reprojecting marks across an
  engraving-zoom change. See the roadmap and the pins spec's "Future work / TODO".
- **Inline styles** — about 235 `style={{...}}` objects left in `src/`; needs its own
  spec/plan.

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
      (`Song.attachments`, one versioned bucket per kind). Live Stage and the Add/Edit Song
      preview render it via `MxlScore.tsx` (MusicXML), `<img>` (image), or `PdfPages.tsx`
      (PDF, rendered page-by-page with pdf.js rather than the browser's native PDF plugin, so
      pinch-zoom and pan are under app control) — a vertical scrolling viewer, not a
      horizontal pager.
- [x] **Transposition.** Chord letters transpose by real semitone distance
      (`chordpro.ts`'s `transposeChord`/`keySemitoneShift`). Sheet music transposes too, not
      just chords: `MxlScore.tsx` sets `osmd.TransposeCalculator` and `osmd.Sheet.Transpose`
      and re-renders whenever the `transpose` prop changes, driven by the same semitone value
      `LiveStage.tsx` computes from the selected key — genuine OSMD re-engraving in the new
      key (e.g. C → Eb), not a cosmetic shift.
- [x] **Enharmonic keys.** The key chips list all 15 key-signature keys (C♯ and D♭, F♯ and
      G♭, B and C♭), each with its relative minor, and the chip picked sets the spelling.
      Chords keep the right letter (`utils/keys.ts`: F in G → C is B♭, not A♯), and odd
      spellings (E♯, B♯, F♭, C♭, doubles) are simplified unless they name the key, or with
      Settings → Keys "Strict spelling", unless they're in its scale. Key moves go the
      nearest way (−5…+6). Scores use `utils/scoreTranspose.ts` in place of OSMD's
      calculator, so the key signature follows the chip and notes match it. Old `A#`/`D#`/`G#`
      keys load as B♭/E♭/A♭. Offsets on the chips are off by default (Settings → Keys).
      Spec: `docs/superpowers/specs/2026-09-25-enharmonic-key-picker-design.md`. A pure
      respelling (C♯ → D♭) re-spells a score too: OSMD skips transposing at 0 semitones,
      so `KeyAwareTransposeCalculator.apply` hands it an octave and takes it back out.
      Switching spellings at the same shift also re-keys the opening key signature, which
      OSMD used to leave as it was.
- [x] **Song & Set Library.** Song CRUD is complete (`ADD_SONG`/`UPDATE_SONG`/
      `DUPLICATE_SONG`/`DELETE_SONGS` in `store.ts`, wired from `Library.tsx`). Setlist CRUD
      is now complete too: sections and items within a setlist have full
      add/update/remove/duplicate/move actions, `ADD_SETLIST`/`UPDATE_SETLIST_META` manage
      metadata, and a `DELETE_SETLIST` reducer action (which also clears live `stage` state
      if the deleted setlist was the one currently on stage) is wired to a "Delete set" entry
      in `SetlistDetail.tsx`'s `⋯` menu, with the same Keep/Delete confirm-dialog style already
      used for song batch delete and section delete.
- [x] **Live Stage.** Single-song stage view is fully done. Whole-setlist playback also
      works — swipe gestures advance through `setlistSongIds` (`STAGE_ADVANCE` in
      `store.ts`); advancing past the last song is a no-op (the last song just stays on
      screen, no end-of-setlist screen). A next-song preview
      and progress bar are now rendered in `LiveStage.tsx`'s setlist-mode header (above the
      title/artist row): `Next: {title}` (or "Last song" on the final slot) plus a thin
      `var(--acc)`-fill bar sized to `(songIndex + 1) / setlistSongIds.length`, using the
      already-computed `songIndex`/`setlistSongIds`. No numeric "Song X of N" counter by
      design — just the next-song name and the bar.
- [x] **Annotate / custom notes on a song.** Three real capabilities, not the old
      decorative shell: freeform typed cues (`Song.notes`, UI-labeled "Cues" — editable
      from both Add/Edit Song's Cues tab and Live Stage's Annotate overlay), real
      canvas-drawn ink (pen/rectangle via `AnnotateCanvas.tsx`), and pins — short typed
      notes dropped at a point, rendered as their own DOM layer (not canvas pixels) so
      they stay individually tappable/draggable after placement. Ink and pins share one
      `Song.annotations` array per view (`AnnotationObject = Stroke | Pin`), rendered on
      Live Stage's normal (non-annotate) view at all times — not just while drawing — over
      whichever chart type is on screen: chords, image, PDF, or MusicXML, not just the
      chords view the old shell was stuck on. The Annotate dock (`AnnotateOverlay.tsx`) is
      an overlay on that same persistent Live Stage screen, not a separate screen with its
      own copy of the chart — opening it swaps in Annotate's header/toolbar and drawing
      controls over the same content instance already on screen, rather than navigating
      away. Eraser removes either kind; Undo/Clear operate on the whole mixed array
      uniformly.
      Controls that would reflow a view's content (chord-chart zoom, lyrics-only,
      MusicXML instrument visibility, MusicXML's own pinch-zoom) disable once that view
      has any annotation, so marks never silently drift out of alignment — **except
      transpose**, which is deliberately exempted: on `chords` it's always been a chord-
      chip label swap (never reflows the lyric line, so there was never a hazard), and on
      `musicxml` a real key change re-engraves the score but existing ink/pins are
      reprojected to their nearest measure afterward (`MusicalAnchor` in
      `state/types.ts`, anchored/reprojected via `MxlScore.tsx`'s
      `anchorAtClientPoint`/`clientPointForAnchor` against
      `osmd.GraphicSheet.MeasureList`) rather than left at stale pixel coordinates or
      blocking the Key control — verified in a real browser against the actual
      `As_The_Deer.mxl` render across multiple consecutive transposes, including one that
      changed a system's line-wrapping. Engraving zoom stays frozen rather than also
      being reprojected (matches Newzik's own behavior, checked as a reference rather
      than assumed). See
      `docs/superpowers/specs/2026-09-20-song-notes-and-annotations-design.md` for the
      original ink/notes pass and
      `docs/superpowers/specs/2026-09-22-annotation-pins-and-stave-spacing-design.md` for
      pins, reprojection, and stave spacing — including its "Future work / TODO" section
      (stickers, a color picker, per-song stave spacing, and reprojecting across an
      engraving-zoom change, all deliberately deferred, not gaps in this pass), and
      `docs/superpowers/specs/2026-09-23-annotate-as-overlay-design.md` for the move from
      a dedicated full-screen Annotate screen to this overlay-on-Live-Stage architecture.
- [x] **Stave spacing (Settings > Notation).** A global Compact/Default/Roomy preset
      (`Settings.staveSpacing`) maps to `osmd.EngravingRules.StaffDistance`/
      `MinimumDistanceBetweenSystems`, applied once when a score loads (not reactively —
      a spacing change only affects the next fresh load, never reflows an
      already-rendered, possibly-annotated one). Applies everywhere `MxlScore.tsx` is
      used: Live Stage (the same score instance stays mounted while Annotate opens and
      closes), Add/Edit Song's Sheet Music tab, and Import's preview.

## Nice-to-have — R&D / spike candidates

Not core functionality, not scheduled — flagged here so they don't get lost.

- [ ] **PDF/Image → `.mxl` conversion (OMR).** Optical Music Recognition to convert an
      imported PDF or photo of sheet music into real `.mxl`/MusicXML (so it could then get
      genuine transposition/re-engraving via `MxlScore.tsx`, instead of staying a static
      image/PDF attachment). Note this is a different problem from `import/`'s existing
      "Chords & lyrics" conversion path, which reads text (pdf.js text layer or OCR) from
      text charts — OMR would mean actually recognizing musical notation from a raster/PDF
      source, which is a much harder, open-ended problem (accuracy on real-world scans,
      licensing/bundling an OMR engine or model, on-device feasibility offline). **Action:**
      spike/R&D only for now — evaluate feasibility and candidate approaches before
      committing to a real implementation.
- [ ] **Real Capo functionality.** Cut entirely on 2026-09-22 rather than left half-wired
      (see "Dead Capo control" above) — the Stage Tools stepper and the run sheet's per-slot
      override existed but neither ever changed anything rendered. Low priority: core,
      high-priority work (Annotate pins, MusicXML transpose-safe reprojection) comes first.
      When revisited, this needs its own small design pass rather than just re-adding a bare
      stepper — a real capo has to reconcile with the existing transpose/key system (what a
      capo actually changes is the relationship between the key you finger and the key that
      sounds, not an independent number sitting next to it).

## Done — working functionality

### Shell & persistence
- [x] Capacitor native shell for Android (built and verified)
- [ ] Capacitor native shell for iOS — scaffolded; build previously broken by a Windows-backslash
      path in `Package.swift`, **now fixed** in the working tree (forward slashes), not yet
      verified with an actual Xcode build
- [x] SQLite persistence for songs, setlists, and settings (survives reload, native + web
      sql.js/jeep-sqlite fallback)
- [x] Screens keep clear of the bottom safe area when no bottom tab bar is showing (modal
      screens, and every screen on a tablet), so Android's navigation bar no longer covers
      the end of the app (`--screen-bottom` in `theme.css`). Needs an on-device recheck

### Live Stage
- [x] Chord chart rendering with real transpose math (not hand-placed spacing)
- [x] One consolidated Stage Tools sheet (Add-Song, Quick-edit, annotate mode, view picker,
      lyrics/zoom-or-instrument controls) opened from a slim one-row bottom bar
- [x] Idle auto-hide chrome (6s); advancing past a setlist's last song is a no-op
- [x] A song can persist a default Live Stage view (chords, or a specific attachment kind),
      set from Add/Edit Song
- [x] Chord/Sheet toggle renders the real attached file — MusicXML via OpenSheetMusicDisplay,
      or photo/PDF via `<img>`/`PdfPages.tsx` (pdf.js) — with real pinch-to-zoom and drag-to-pan
- [x] Setlist-mode next-song preview and progress bar in the stage header
- [x] Each song opens at the top of its chart (the scroll position and PDF zoom no longer
      carry over from the previous song), and a reprise's next-song line and progress bar
      follow the slot on stage rather than the song's first slot
- [x] Swiping between songs works over sheet music and PDFs too: the score and PDF views
      keep a gesture only when it's a pinch (or a pan on a zoomed-in PDF)

### Library
- [x] A–Z grouped list, live search, filter chips
- [x] Multi-select + batch delete, row context sheet, empty/no-results states

### Setlists
- [x] Upcoming/Past/Templates tabs, run-sheet detail, derived per-slot start times
- [x] Drag a slot's grip to reorder it, within its section or into another one (pointer
      events, so it works with touch in the iOS/Android web views; `useDragReorder.ts`).
      Attachment versions in Add/Edit Song reorder the same way
- [x] Per-slot key/note override sheet, Add-to-set sheet (was a side drawer)
- [x] Artist and BPM stay blank when not given (no more "Unknown"/80; tempo 0 = none),
      time signature still defaults to 4/4; the run sheet shows "N/A BPM" for a blank tempo
      and songs saved with the old "Unknown" artist load with it blank (`hydrateState`)
- [x] Drag a section's header grip to reorder sections (`MOVE_SECTION`), or Move up/down
      from its `⋯` sheet; songs keep their order within it and a live set stays on its song
- [x] Adding lives in the detail toolbar ("+" → Add songs / Add section) so it stays in
      reach on a long set; an empty section's row is an "Add songs here" button, and a
      section's `⋯` sheet can add songs to that section
- [x] The set loaded on Live Stage shows "Resume Set" instead of "Start Set"; its `⋯` menu
      adds "Restart set from the top" and "Stop set"

### Add/Edit Song
- [x] Combined new/edit screen, ChordPro-vs-Chords-over-Lyrics editing
- [x] Chart-problem banner in the editor: unbalanced `[`/`]`, unclosed `{directive}`, and
      chord symbols transposition can't move (`findChordProIssues`)
- [x] Live `{key: ...}` directive detection, format-aware quick-insert chips, live Preview tab
- [x] ◀ ▶ caret keys under the chart editor move the cursor one character (repeat on hold)
      without dismissing the keyboard, as in OnSong (`CaretKeys.tsx`)
- [x] Undo/redo for the chart text (↶ ↷ in the same bar, and Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or
      Ctrl+Y): typing undoes in bursts, chip inserts and field-driven directive rewrites
      one at a time (`useTextHistory.ts`). History is per visit; it resets after Import
- [x] Expand button in the same bar hides the tabs, song fields and format/Import row so
      the chart editor fills the screen (quick-insert chips and Cancel/Save stay); a Save
      with invalid fields collapses it again to show them
- [x] Sheet Music tab appears once a song has an attachment, with remove-attachment action

### Import
- [x] Converting chords into a song form that already has a chart asks Replace / Append /
      Compare instead of overwriting it
- [x] Real file picker (PDF, photo, MusicXML) with genuine `FileReader` upload
- [x] "Sheet music" declaration path is fully real end-to-end (file stored and rendered later
      on Live Stage, no simulation involved)
- [x] "Chords & lyrics" conversion is real (`utils/chartImport.ts`): pdf.js reads a PDF's text
      layer; photos and scanned PDFs go through bundled, offline Tesseract OCR, with chord rows
      re-read using a chord-only character set. Header fills title/artist/key/tempo/time.
      No-text files get a real error with "keep it as a PDF/photo". Sheet-vs-chords is still
      declared by the user, not detected.

### Tuner
- [x] Instrument presets (Chromatic/Guitar/Bass/Ukulele/Violin/Viola/Cello) with real standard
      tuning reference frequencies; readout computed relative to selected preset
- [x] Real mic input (`getUserMedia`) with McLeod pitch detection (`utils/pitch.ts`,
      `screens/tuner/useMicPitch.ts`); Auto string follow or tap-to-lock; denied/unavailable mic
      states. Android declares `RECORD_AUDIO`/`MODIFY_AUDIO_SETTINGS` and iOS has
      `NSMicrophoneUsageDescription`. Not yet tried on a real iOS or Android device; the
      checklist for that run is in `docs/device-testing.md`.

### Export
- [x] Real files (`utils/exportSet.ts`): PDF via pdf-lib (charts, copied PDF attachments,
      photos, OSMD-engraved scores in the set key, optional note names on noteheads), multi-song ChordPro, MusicXML scores
      re-keyed to the set key (`utils/musicxmlTranspose.ts`; zipped when several). Shared
      through the OS share sheet (`utils/shareFile.ts`, Capacitor Share + Filesystem) or
      downloaded in the browser.
- [x] Annotate marks print in the PDF export ("Include annotations"), over chord charts,
      photos, PDF pages and scores. Each view's marked width is recorded
      (`Song.annotationWidths`) so marks land where they were drawn. ChordPro and MusicXML
      can't carry them. Spec: `docs/superpowers/specs/2026-09-25-priority-2-design.md`.
- [x] Single-song export from the Library row sheet ("Export…"): the same screen and
      formats, with a key picker for that export only (starts at the saved key, never saved)
      and an Up/Down choice for which way a score moves.

### Settings & visual polish
- [x] Appearance sub-screen (Light/Stage Dark/Auto), type-`ERASE`-to-confirm reset
- [x] Keys section: "Show key offsets" and "Strict spelling" toggles
- [x] Real hand-drawn SVG icon set (`Icon.tsx`) replacing raw Unicode glyphs
- [x] Toggle-switch knob fixed to a neutral color regardless of on/off state
- [x] Backdrop blur added to sheets/dialogs/drawers

### Sheet music rendering
- [x] Replaced the fake, identical-for-every-song `ScorePreview` SVG with `MxlScore.tsx`,
      a real renderer built on OpenSheetMusicDisplay (loads `.mxl` directly, real engraving)
- [x] Real pinch-to-zoom / drag-to-pan on the rendered score

## Working as designed (intentionally simulated, not bugs)

- [x] ~~Tuner readings are simulated~~ — real since the tuner/import/export change
- [x] ~~Import's "Chords & lyrics" conversion is a canned sample~~ — real, see Import above
- [x] ~~Export's PDF generation is simulated~~ — real, see Export above

## To-do — confirmed still open (verified against current working tree)

- [x] **Dead Settings toggles.** Fixed: removed `keepAwake`/`autoscroll` entirely (Settings row,
      `Settings`/`AppState` types, the SQLite `settings` table via a v3→v4 drop-and-recreate
      migration, and the now-unused generic `UPDATE_SETTINGS` action) rather than wiring them up
      — neither had a real mechanism behind it (Wake Lock plugin, scroll timer) worth adding as a
      new native dependency in this pass.
- [x] **Dead Capo control.** Fixed: removed `stage.capo`/`STAGE_SET_CAPO` (Stage Tools' Capo
      stepper) and `SetlistItem.capo` (the run sheet's per-slot Capo override) entirely, same
      call as `keepAwake`/`autoscroll` above — both were pure UI state with no effect on any
      rendered chart; `chordpro.ts` never read `capo`, so the value had nothing to drive. The
      SQLite `setlist_items.capo` column is left in place, unused, rather than migrated away
      (nullable, harmless). `AddEditSong.tsx`'s `{capo: ...}` ChordPro directive detection is
      untouched — a different concern (recognizing real ChordPro syntax in typed/imported
      charts), not the interactive stepper. See "Real Capo functionality" below for the
      low-priority follow-up.
- [x] **"Stage Dark" copy vs. behavior mismatch.** Fixed: Settings' Appearance row now reads "One
      theme for the whole device, applied everywhere at once," matching `App.tsx`'s actual
      `data-theme`-on-`.device`-root behavior instead of describing the per-surface scoping this
      app doesn't implement.
- [x] **Text-size slider disconnected from the real chart.** Fixed: there is one saved text
      size, `settings.textScale`. Live Stage renders at it, the Appearance slider and the
      stage's Zoom +/- buttons both change it, and `stage.zoom` no longer exists. Annotated
      chord charts still lock the Zoom buttons, and render at the size they were marked at
      (`Song.chordsTextScale`, pinned when the first mark is saved and dropped when marks are
      cleared), so changing the size from Appearance no longer reflows them under their marks.
- [x] **Persistence "first run" gate is still fragile.** Fixed: `main.tsx`'s `loadInitial()` now
      loads settings/songs/setlists together and only treats the install as first-run when
      songs and setlists are *also* empty. If a crash left real song/setlist data with no
      settings row, that data is carried forward with default settings instead of being
      silently reseeded over. Songs+setlists were already one atomic transaction in
      `store.ts`; settings still persists as a separate write, but losing just the settings
      row no longer causes data loss on next boot.
- [x] **Setlist status is a static field, not derived from date.** Fixed: added
      `setlistStatus()` to `setlistCalc.ts`, which derives "upcoming"/"past" from `date`
      (comparing to today, `"template"` still a manual override) instead of trusting the
      stored `status` field. `Setlists.tsx`'s tab filter uses it instead of `sl.status`.
- [x] **Library FABs can cover the last list rows.** Superseded: the FABs are gone (see
      UI/UX polish below), so the bottom padding described here no longer applies. Original
      fix: the scrollable list in
      `Library.tsx` now reserves `paddingBottom: 150` (roughly the FAB stack's footprint)
      when not in select mode, so the last rows scroll clear of `.fab-stack`. Same issue
      existed in `Setlists.tsx` (single FAB over its list) — fixed there too with
      `paddingBottom: 90`, sized to that screen's smaller single-FAB footprint.
- [x] **New setlist writes to the store immediately.** Fixed: `Setlists.tsx` now gates
      `ADD_SETLIST` behind a "New setlist" name dialog with Cancel/Create — tapping "+" /
      "Build a set" no longer writes to the store until the user confirms a name, matching
      Add/Edit Song's wait-for-Save pattern.
- [x] Stale comment in `types.ts`: fixed — the "in-memory only, like everything else in this
      mockup" note on `dataUrl` is removed now that SQLite persistence has landed.
- [x] CLAUDE.md itself is stale on "Single global reducer, no persistence" and the mockup framing
      generally — fixed: rewritten (What this is / Tech stack / Architecture / Screen map /
      Gotchas) to describe the real Capacitor + SQLite app, added a "Ground rules" section, and
      pointed to this checklist as the actively-maintained status source.
- [x] `chordpro.ts`'s `normalizeRoot` only maps 5 flats; fixed — added the two missing enharmonic
      flats (`Cb`→B, `Fb`→E) so every root the chord regex accepts now resolves instead of
      silently no-opping on an uncommon one.
- [x] `setlistCalc.ts` treats a missing AM/PM suffix as AM with no validation. Fixed: added
      format validation (`TIME_PATTERN` in `SetDetailsSheet.tsx`) at the one place `Setlist.time`
      is actually edited — Save is disabled with a field error until the time is blank or a
      well-formed "H:MM AM/PM", so `startClockLabel`'s AM default can no longer fire on a real
      ambiguous value.
- [ ] Heavy use of ad-hoc inline `style={{...}}` objects instead of shared CSS classes. Deferred:
      about 235 occurrences left in `src/` (down from 373 at first count) — real visual-regression risk across the whole app, so this
      needs its own dedicated spec/plan per the Feature workflow rather than a sweep bundled with
      the smaller fixes above.

## To-do — UI/UX polish (from the design review, not yet actioned)

- [x] No iOS-style Large Title on root screens: fixed — `Header` (`src/components/Header.tsx`)
      takes a `large` prop that renders the small bar with only the back/action controls, plus
      a big bold title line beneath it (`.hdr-large-wrap`/`.hdr-large-title` in `theme.css`).
      Wired on Library, Setlists, and Settings. Library's select-mode header (`"N selected"` /
      Cancel) intentionally keeps the old compact single-line style, matching iOS's own
      collapse-to-compact behaviour while an in-page action bar is active.
- [x] List rows use a "boxed card per row" Material-ish style: fixed by the iOS look rollout
      (grouped lists, PR #13).
- [x] FABs were a Material Design pattern: removed in favor of header and toolbar actions.
- [x] Chord/lyric chart text runs a little small relative to iOS defaults: fixed — bumped
      `ChordChart`'s base sizes (`src/components/ChordChart.tsx`, mirrored in the `.chord-line`/
      `.lyric-line` fallbacks in `theme.css`) from 12/14.5px to 14/17px (lyric line now matches
      iOS's 17px body default), and the section-label size from 11 to 12px. All three surfaces
      that render `ChordChart` (Live Stage, Add/Edit Song preview, the Appearance specimen)
      pick this up automatically; the existing zoom/text-scale sliders still scale from these
      new bases.
- [x] Small surrounding UI copy: fixed by snapping to iOS text styles with an 11pt floor.
      Descriptions and status lines went up to 13, 10px labels to 11. Tab bar labels stay at
      iOS's own 10pt.
