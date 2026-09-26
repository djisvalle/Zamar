# Live Stage Annotate Mode — Improvement Roadmap

Snapshot date: 2026-09-22; status re-checked against `main` on 2026-09-25.

Captures where annotate mode stands after the initial build-out + Phase 1 UI
pass, and a prioritized backlog for a future session to pick up. Nothing in
this file has been implemented yet unless noted as "done" below. As of 2026-09-25 every
backlog item (1–11) is done, and so are the two "Deferred from the reference-image
discussion" items (done 2026-09-25).

## Done so far

- **Initial build-out**: freehand pen + highlighter (independent color/size/
  opacity), a 16-symbol notation stamp palette, a movable/editable text tool,
  an eraser, per-song undo/redo, and clear-this-page/clear-all. Lives in
  `src/screens/live-stage/AnnotateOverlay.tsx` and
  `src/components/AnnotateCanvas.tsx`; state is `Song.annotations`
  (`src/state/types.ts`), persisted per song — see the corrected note below.
  Originally built as a dedicated full-screen `AnnotateScreen.tsx` that
  replaced Live Stage while open; as of 2026-09-23, Annotate is composed as an
  overlay on the persistent Live Stage screen instead (drawn annotations now
  render on the normal chord/sheet view at all times, not just while the
  Annotate dock is open) — see
  `docs/superpowers/specs/2026-09-23-annotate-as-overlay-design.md`.
- **Phase 1 (object-editing model + Shapes tool)**: a full 32-color picker
  (2 swipeable pages), a live checkerboard preview showing the actual
  stroke/shape being styled, numeric Opacity(%)/Size(pt) readouts replacing
  the old S/M/L chips, ink strokes are now selectable objects in the Select
  tool (tap to open an edit sheet with color/opacity/size/duplicate/delete,
  or drag to move), Duplicate added alongside Delete everywhere, and a new
  Shapes tool (slur, crescendo/decrescendo hairpins, arrow, line, bracket,
  outline/filled rectangle and ellipse) sharing the same mark-object model
  as text/notation stamps.
- **Sticky notes and direct text entry** (2026-09-26): the Pin tool became
  "Sticky note". Notes always show their text, come in yellow/pink/blue/green,
  move and resize with the Select tool, are typed into in place, and print in
  PDF exports. The Text tool opens an empty field at the tap instead of
  placing a "Note" placeholder. Saved pins show as default-size yellow notes.
  See `docs/superpowers/specs/2026-09-26-sticky-notes-and-text-entry-design.md`.
- **Quick wins 1–3** (collapsible tool panel, canvas selection highlight,
  stronger Clear-page vs. Clear-all distinction) — done.
- **Persisted annotations per song** (was tracked as backlog item 4 below).
  Turned out to already be implemented by the time this doc was ported over
  from `develop`: `Song.annotations` persists through `songsRepo.ts`'s
  `annotations_json` column (schema v3, `src/data/db.ts`) as part of the
  store's existing debounced songs/setlists/settings persistence effect
  (`src/state/store.ts`). This doc's "Done so far" section didn't reflect
  that merge — corrected here. No further work needed on this item.

## Deferred from the reference-image discussion

These were explicitly scoped out of Phase 1 by the user's own call, not
forgotten:

Both done (2026-09-25): 59 symbols in `src/utils/notation.ts`, and favorites in a row
above the grid (press and hold to star). See
`docs/superpowers/specs/2026-09-25-priority-2-design.md`.

- ~~**Full multi-page notation symbol library**~~ (~50-60 curated symbols across
  dynamics, accidentals, articulation, ornaments, clefs, repeat signs,
  noteheads, rests, bowing — see the reference screenshots shared in this
  session for the full source material) to replace the current 16-symbol
  placeholder set.
- ~~**Persisted favorites**~~ for notation symbols (star-toggle, survives
  reload) — needs a small addition to `src/data/settingsRepo.ts` and
  `Settings` in `src/state/types.ts`. Only worth wiring once the full
  symbol library above exists to favorite from.

## Prioritized backlog (this session's ranking)

### Quick wins — small, worth doing regardless of what else gets picked up

1. **Collapsible tool panel.** Reuse the existing ﹀/︿ collapse pattern
   already used in `MusicToolbar.tsx` and `QuickEditSheet.tsx` so the
   color-grid/preview/slider panel can shrink to just the tool row while
   actively drawing, instead of permanently eating up to ~40% of screen
   height.
2. **Selection highlight on the canvas.** Tapping a stroke or mark opens its
   edit sheet, but nothing on the canvas itself marks *which* object is
   selected (no halo/outline) — ambiguous with overlapping marks.
3. **Stronger Clear-page vs. Clear-all visual distinction.** Currently only
   differ by text color in the Clear sheet; the more destructive "Clear all
   pages" option should carry more visual weight (icon, bolder styling).

### Bigger, higher-value

4. ~~Persist annotations per song.~~ Already implemented — see "Done so
   far" above.
5. ~~**Rotate/resize handles on shapes.**~~ **Done.** Every shape has resize handles and
   line-type shapes (slur, hairpins, arrow, line, bracket) also get a rotate handle
   (`AnnotateCanvas.tsx`'s `ShapeHandles`, optional `width`/`rotation` on `ShapeMark`).
   Original notes: Without this, hairpins and arrows
   only work pointing horizontally right — a diminuendo hairpin under a
   rising vocal line, or an arrow at an angle, isn't possible. Needs
   drag-handle math (resize + rotation transform) on top of the existing
   `ShapeMark` model in `AnnotateCanvas.tsx`/`AnnotateScreen.tsx`. Design
   spec: `docs/superpowers/specs/2026-09-23-shape-rotate-resize-design.md`.
   Bigger lift than the quick wins above, but what actually makes the
   Shapes tool useful beyond a demo.
6. ~~**Stop remounting chart content across the Annotate dock toggle.**~~ **Done
   (2026-09-24).** `LiveStage.tsx` now keeps its scroll container + one
   `AnnotateCanvas` + `content` at a single constant JSX slot in both dock states; only
   the canvas's props flip between read-only and interactive, and the bottom toolbar
   swaps (`MusicToolbar` ↔ `AnnotateToolbar`). `AnnotateOverlay`'s staged
   annotation/tool/undo state moved into a `useAnnotateSession` hook Live Stage owns.
   Opening Annotate no longer re-engraves the score or resets its zoom/scroll; the zoom
   is locked (not reset) while the dock is open. Cues now edit inside the toolbar
   instead of replacing the chart. Notation stamps also switched from UI-font letters
   to engraved SMuFL glyphs from a bundled Bravura font (`src/utils/notation.ts`,
   `src/components/SmuflGlyph.tsx`).

### Nice-to-have — lower priority

All five are **done (2026-09-25)**. Design and decisions:
`docs/superpowers/specs/2026-09-25-annotate-nice-to-haves-design.md`.

7. ~~Recently-used colors/symbols row~~ Done: a Recent row at the top of the
   Pen, Highlighter, Text, Notation and Shapes popovers, saved across launches
   in `settings.annotateRecents`.
8. ~~Snap-to-lyric-line guide~~ Done: text and notation marks snap under or
   over a lyric line on the chords view while placing or dragging, with a
   dashed guide and a haptic tick on native. "Snap to Lyrics" switch in the
   Text and Notation popovers (`settings.annotateSnap`, on by default).
9. ~~Multi-select~~ Done: long-press an object to add it, or drag a box from
   empty canvas. Dragging moves the selection together; an iOS edit menu
   offers Duplicate and Delete (plus Edit for a single object).
10. ~~Reach overlapping marks~~ Done, as a repeated tap rather than a
    long-press (long-press is multi-select): tapping the same spot again
    within 1.5s selects the next object down the stack.
11. ~~Pen stroke smoothing~~ Done: finished pen/highlighter strokes are
    simplified with Ramer-Douglas-Peucker (0.75px) and drawn as smooth
    curves.

## Suggested sequencing for the next session

Everything on this roadmap is finished. What's left for Annotate is in the progress
checklist: per-song stave spacing, and reprojecting marks across an engraving-zoom change.
