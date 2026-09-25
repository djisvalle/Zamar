# Annotate nice-to-haves: recents, snap, multi-select, overlap cycling, smoothing

## Context

`docs/annotate-mode-roadmap.md` items 7–11 ("Nice-to-have — lower priority"). The
quick wins and the bigger items (selection halo, shape rotate/resize, no remount across
the dock toggle) have landed, and the Annotate toolbar is now the iOS popover toolbar
from the native-iOS-look rollout. These five items are what's left on that roadmap.

All five are interaction changes on the canvas or in the tool popovers, so per the
Feature workflow in CLAUDE.md this spec (and a throwaway mock-up for 1–4) comes before
any code.

## Goals

- Stamping the same symbol or color many times down a chart takes one tap each, not a
  trip through the full palette.
- A stamp or text mark can be lined up exactly under a lyric line on a phone.
- Several marks can be moved, duplicated or deleted together.
- Stacked marks can each be reached, not only the topmost one.
- Stored pen strokes stay small and look smooth, without changing how drawing feels.

## Out of scope

- Snapping on the image, PDF and MusicXML views (no lyric lines to snap to; MusicXML
  already anchors to measures).
- Multi-select across views or pages.
- Any change to what persists for existing annotations (all five are additive).

## 1. Recently used row

**Where:** the top of the Pen, Highlighter, Text/Notation and Shapes popovers, above
the existing `ColorGrid` / notation palette in `AnnotateOverlay.tsx`.

**What:** a single row of up to 8 items, most recent first. The Pen, Highlighter and
Shapes popovers list colors. The Notation popover lists symbol and color pairs, so one
tap re-arms both. Using an item moves it to the front, and duplicates are collapsed.

**Storage:** one global list per popover, shared by every song, kept in `settings` as a
new `annotateRecents` JSON column (schema v7 migration, default `{}`). Global rather than
per-song because the point is repeating what you just did, and people stamp the same
dynamics song after song.

**Decided (2026-09-25):** recents persist across launches (schema v7).

## 2. Snap to lyric line

**Where:** placing or dragging a text/notation mark on the `chords` view.

**What:** while the finger is within 12pt of a lyric line's baseline or top edge (the
`.lyric-line` and `.chord-line` boxes from `ChordChart.tsx`, measured on pointer-down),
the mark's y snaps to that edge. A thin tint guide line spans the chart width while
snapped, and there's a light haptic tick on native when it engages, via
`@capacitor/haptics` (a new dependency, approved 2026-09-25; no haptic in the browser).
Moving further than 12pt away releases the snap. x is never snapped.

**Why only y:** chords sit at real character offsets, so snapping x to a chord chip
would be a separate, riskier feature. Vertical alignment is the part that's hard on a
phone.

**Toggle (decided 2026-09-25):** a "Snap to lyrics" switch, on by default, in the
Text and Notation popovers (where marks are placed), saved in `settings` as
`annotateSnap` (same schema v7 migration as recents). While off, marks place exactly where
the finger lifts, with no guide or haptic.

## 3. Multi-select

**Entry:** in the Select tool, long-press an object for 400ms, or drag a marquee
starting on empty canvas. This matches Freeform and Notes, where a marquee needs no
extra mode.

**While several are selected:**
- Every selected object shows the existing selection halo.
- Dragging any selected object moves them all together (one undo step).
- A small popover menu anchored above the selection's bounding box offers
  **Duplicate** and **Delete** (the `.ios-menu` style), like iOS's edit menu.
- Tapping empty canvas clears the selection.

The edit sheet (color/size/opacity) still opens only for a single selection.

**Decided (2026-09-25):** long-press on an object starts multi-select, and item 4 uses a
repeated tap.

## 4. Reach overlapping marks

**What:** tapping the same spot again within 1.5s, without moving more than 8pt,
selects the next object under that point, going down the stack and wrapping around.
The halo moves with it. This matches how Keynote and Figma cycle through stacked
objects on repeated clicks, and it keeps long-press free for multi-select (item 3).

**Hit list:** every object whose `hitTestAnnotation` passes at the tap point, ordered
top to bottom.

## 5. Pen stroke smoothing

**What:** when a pen or highlighter stroke finishes (pointer-up), simplify its points
with Ramer-Douglas-Peucker at a tolerance of 0.75 CSS px at natural size, then render
the stored points as a quadratic-midpoint curve instead of straight segments.

- Drawing feedback during the stroke is unchanged (raw points, live).
- Square strokes (two points) are left alone.
- MusicXML strokes keep `anchors` parallel to `points`: the kept indices from RDP
  select the matching anchors.
- Old strokes aren't rewritten. They get the curve rendering, which only makes them
  smoother.

**Where:** `utils/annotations.ts` (`simplifyPoints`, pure and unit-checkable) and
`drawStroke` in `AnnotateCanvas.tsx`.

This item has no UI surface, so it needs no mock-up.

## Sequencing

1. Smoothing (no UI, self-contained).
2. Recents row.
3. Overlap cycling.
4. Snap to lyric line.
5. Multi-select (largest; touches drag, undo and the menu).

Each lands as its own commit so any one can be dropped. Verification for each is the
same as the rest of Annotate: `npm run build`, plus a real-browser pass on the phone
viewport in both themes, with touch emulation for the gesture items.

## Decisions (2026-09-25, Israel)

1. Recents persist across launches (schema v7).
2. Long-press starts multi-select; a repeated tap cycles overlapping marks.
3. Snap to lyric line has an on/off switch, on by default.
4. Add `@capacitor/haptics` for the snap tick.
