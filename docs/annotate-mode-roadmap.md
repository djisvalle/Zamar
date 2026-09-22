# Live Stage Annotate Mode — Improvement Roadmap

Snapshot date: 2026-09-22. Branch: `claude/annotation-refinements-uuym7v`.

Captures where annotate mode stands after the initial build-out + Phase 1 UI
pass, and a prioritized backlog for a future session to pick up. Nothing in
this file has been implemented yet unless noted as "done" below.

## Done so far

- **Initial build-out**: freehand pen + highlighter (independent color/size/
  opacity), a 16-symbol notation stamp palette, a movable/editable text tool,
  an eraser, per-song undo/redo, and clear-this-page/clear-all. Lives in
  `src/screens/live-stage/AnnotateMode.tsx`; state in
  `state.annotations`/`state.annotationHistory` (`src/state/store.ts`),
  keyed by song id, session-only (not persisted to SQLite).
- **Phase 1 (object-editing model + Shapes tool)**: a full 32-color picker
  (2 swipeable pages), a live checkerboard preview showing the actual
  stroke/shape being styled, numeric Opacity(%)/Size(pt) readouts replacing
  the old S/M/L chips, ink strokes are now selectable objects in the Select
  tool (tap to open an edit sheet with color/opacity/size/duplicate/delete,
  or drag to move), Duplicate added alongside Delete everywhere, and a new
  Shapes tool (slur, crescendo/decrescendo hairpins, arrow, line, bracket,
  outline/filled rectangle and ellipse) sharing the same mark-object model
  as text/notation stamps.

## Deferred from the reference-image discussion

These were explicitly scoped out of Phase 1 by the user's own call, not
forgotten:

- **Full multi-page notation symbol library** (~50-60 curated symbols across
  dynamics, accidentals, articulation, ornaments, clefs, repeat signs,
  noteheads, rests, bowing — see the reference screenshots shared in this
  session for the full source material) to replace the current 16-symbol
  placeholder set.
- **Persisted favorites** for notation symbols (star-toggle, survives
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

4. **Persist annotations per song.** Biggest real-world usefulness gap —
   right now every reload wipes markup. The SQLite repo pattern already
   exists for songs/setlists/settings (`src/data/songsRepo.ts` etc.); an
   `annotationsRepo.ts` following the same shape, wired into
   `StoreProvider`'s existing debounced persistence effect
   (`src/state/store.ts`), is mostly plumbing rather than new design.
5. **Rotate/resize handles on shapes.** Without this, hairpins and arrows
   only work pointing horizontally right — a diminuendo hairpin under a
   rising vocal line, or an arrow at an angle, isn't possible. Needs
   drag-handle math (resize + rotation transform) on top of the existing
   `ShapeAnnotation` model in `AnnotateMode.tsx`. Bigger lift than anything
   above, but what actually makes the Shapes tool useful beyond a demo.

### Nice-to-have — lower priority

6. **Recently-used colors/symbols row** above the full color grid / notation
   palette, for fast repeat stamping (e.g. placing the same "pp" or the same
   red color many times down one chart).
7. **Snap-to-lyric-line guide** while placing/dragging a mark, so it's easy
   to align a stamp exactly under a specific word or chord on a small phone
   screen.
8. **Multi-select (marquee or shift-tap)** for batch move/delete/duplicate
   once a chart has many marks on it.
9. **Long-press to cycle through overlapping strokes** when several marks
   are stacked close together (tap currently always grabs the topmost one).
10. **Pen stroke smoothing/simplification** (e.g. Douglas-Peucker) — a long
    or fast freehand gesture currently stores every raw pointer sample
    as-is; fine for a mockup, worth revisiting for a real build.

## Suggested sequencing for the next session

Do items 1–3 together first (small, compound well, quick to verify). Then
tackle 4 and 5 as their own separate passes — each is a meaningful chunk of
work on its own and shouldn't be bundled with the quick wins.
