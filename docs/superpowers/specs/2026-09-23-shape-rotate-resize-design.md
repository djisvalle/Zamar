# Rotate/resize handles for Annotate mode's Shapes tool

## Context

`docs/annotate-mode-roadmap.md` item 5 ("Bigger, higher-value" backlog): every
`ShapeMark` (slur, crescendo/decrescendo hairpin, arrow, line, bracket, outline/filled
rectangle, outline/filled ellipse — see `SHAPE_LIST` in `AnnotateScreen.tsx`) currently
renders at a single fixed aspect ratio (`SHAPE_ASPECT = 60/22`, `utils/annotations.ts`)
scaled uniformly by the existing Size slider. A hairpin or arrow can only point
horizontally right. That makes the Shapes tool a demo, not something usable on a real
chart — a diminuendo under a rising vocal line, or an arrow pointing at an angle to a
specific lyric, isn't possible today.

This is item 5 from the roadmap; item 4 ("persist annotations per song") turned out to
already be implemented — `Song.annotations` persists through `songsRepo.ts`'s
`annotations_json` column (added in the schema-v3 migration, see `src/data/db.ts`) as
part of the store's existing debounced songs/setlists/settings persistence effect
(`src/state/store.ts`). The roadmap doc's "Done so far" section was stale (carried over
from a `develop`-branch snapshot predating that merge) and has been corrected.

Design decisions confirmed with the user before writing this spec:

- Resizing line-type shapes uses a **new length handle** for length/extent, while the
  existing Size slider keeps controlling thickness/glyph weight — not a single handle
  that scales both together.
- Rotation is **free-angle with soft snapping** near common angles (0/45/90/135/etc.,
  ~5° tolerance), not pure free rotation or hard-snapped steps.
- **Rotation only applies to line-type shapes** (slur, hairpin-cresc, hairpin-dim,
  arrow, line, bracket). Rect/ellipse shapes get independent width/height resize only,
  matching what the roadmap actually calls out and keeping the box-shape interaction
  the same "drag two corners" feel the existing ink `square` tool already has.

## Goals

- A line-type shape's length and angle can both be set by dragging, so a hairpin or
  arrow can point in any direction and span any distance.
- A rect/ellipse shape's width and height can be resized independently (not just
  uniformly via the Size slider), so a box can frame a wider or taller region of the
  chart.
- Old persisted `ShapeMark`s (no `width`/`rotation`) render and behave exactly as they
  do today — no migration, no visual change until the person actually drags a new
  handle.
- Handles are touch-sized and match the existing Select-tool interaction model
  (tap-to-edit-sheet / drag-to-move) rather than introducing a new tool mode.

## Out of scope

- Rotation for rect/ellipse shapes (per the confirmed decision above).
- Any change to `TextMark`/notation stamps — this spec only touches `ShapeMark`.
- Any change to `Stroke` (pen/highlighter/square ink) — unrelated object type.
- A numeric angle/length input in the edit sheet — length and angle are handle-driven
  only, same as position already is (position has never had a numeric X/Y field
  either).

## Data model (`src/state/types.ts`)

```ts
export interface ShapeMark {
  id: string;
  kind: "shape";
  position: { x: number; y: number }; // center — unchanged; still what reprojection repositions
  shapeId: ShapeId;
  color: string;
  size: number; // thickness/height — unchanged meaning
  /** Length/horizontal extent in px, at rotation 0. Undefined means "never resized" —
   * falls back to `size * SHAPE_ASPECT`, i.e. today's fixed-aspect behavior. Old
   * persisted marks parse with this undefined and render identically to before. */
  width?: number;
  /** Degrees clockwise from the shape's default horizontal orientation. Undefined means
   * 0 — old persisted marks render unrotated, same as today. Ignored for rect-outline/
   * rect-fill/ellipse-outline/ellipse-fill (see "Out of scope"). */
  rotation?: number;
  anchor?: MusicalAnchor;
}
```

No schema/persistence change is needed beyond this — `songsRepo.ts` already serializes
whatever's on `Song.annotations` (and therefore every `ShapeMark`) into
`annotations_json` as opaque JSON; two new optional fields need no `ALTER TABLE`.

## Geometry

Effective box for a `ShapeMark`, in local (unrotated) space centered on `position`:

- **width** = `mark.width ?? mark.size * SHAPE_ASPECT`
- **height** = `mark.size`

For line-type shapes, the rendered glyph and its container are wrapped in
`transform: rotate(${mark.rotation ?? 0}deg)`, applied around `position` (the
container's own center, via `transform-origin: center`). Rect/ellipse never receive a
rotate transform, regardless of a stray `rotation` value (defensive — the UI never sets
one on those `shapeId`s, but rendering ignores it either way).

## Canvas handles (`src/components/AnnotateCanvas.tsx`)

Today, `MarkBadge` renders one draggable node per mark, active only when `tool ===
"select"` (drag to move, tap to open the edit sheet). This spec adds a second small
component, `ShapeHandles`, rendered as a sibling of the selected mark's `MarkBadge`
only when `tool === "select" && selectedId === mark.id && mark.kind === "shape"`:

- **Resize handle** — a small circular handle at local point `(width/2, 0)` (line-type)
  or `(width/2, height/2)` (rect/ellipse), rotated into place by the same transform as
  the glyph. Dragging it:
  - *Line-type:* recomputes `width` from the drag distance projected onto the shape's
    current rotated axis (so dragging along the shape's own direction lengthens/
    shortens it; dragging perpendicular has no effect) — this keeps resize and rotate
    as two independent, non-fighting gestures on two different handles.
  - *Rect/ellipse:* recomputes `width`/`size` independently from the drag's local x/y
    offset from center (no rotation to project through), same two-corner feel as the
    ink `square` tool.
  - Clamped to a minimum of 16px so a shape can't be dragged down to invisible.
- **Rotate handle** — line-type shapes only, a small circular handle offset above
  center by a fixed stem length (e.g. 28px) at the shape's current rotation, connected
  by a thin 1px line to the shape's center for a visual "this is what you're turning"
  affordance (same visual language as PowerPoint/Keynote/Figma's rotate handle).
  Dragging it computes `angle = atan2(pointer.y - center.y, pointer.x - center.x)`,
  converts to the shape's rotation convention, and soft-snaps to the nearest 45°
  increment when within 5° of it.

Both handles commit through the existing `onCommit`/history path (`AnnotateScreen.tsx`'s
`commit`) on pointer-up, matching how a mark drag-move already works — no live commit
per pointermove, only a local drag-preview state re-render, then one committed write at
the end of the gesture (mirrors the existing `dragPreview` pattern already used for
stroke drags in `AnnotateCanvas.tsx`).

## Hit-testing (`src/utils/annotations.ts`)

`hitTestMark` currently does an axis-aligned box test against `position ± halfW/halfH`.
For a rotated line-type shape this would misjudge taps once `rotation` is non-zero. Fix:
before the box test, inverse-rotate the tap point around `mark.position` by
`-(mark.rotation ?? 0)` degrees (a no-op when `rotation` is undefined/0, so rect/ellipse
and never-rotated marks are unaffected), then run the same box test as today using
`width ?? size*SHAPE_ASPECT` in place of the current `size * SHAPE_ASPECT` for `halfW`.

## Rendering (`ShapeGlyph`, `AnnotateCanvas.tsx`)

`ShapeGlyph`'s `size` prop currently drives both `viewBox` height and (via
`SHAPE_ASPECT`) width. It gains an optional `width` prop (falls back to
`size * SHAPE_ASPECT`, preserving every existing call site with no changes needed) and
the wrapping container gets the `rotate()` transform described above, applied only when
the shape is a line-type `shapeId` and `rotation` is set.

`ShapeGlyph`'s `<svg>` also gains `preserveAspectRatio="none"`. Without it, the SVG's
default `xMidYMid meet` scales the fixed `60 22` viewBox to fit inside the `width`×
`size` box while preserving its aspect ratio, centered — i.e. widening `width` beyond
what preserves 60:22 just adds empty space around the glyph, and the resize handle
would have no visible effect. `preserveAspectRatio="none"` makes the glyph genuinely
stretch to fill the box, which is what makes independent width/height resize actually
visible. Accepted trade-off: `arrow`'s arrowhead, `bracket`'s end-ticks, and
`rect-outline`/`ellipse-outline`'s border thickness scale non-uniformly (stretch) when
width and height diverge a lot from the original 60:22 ratio — standard, expected
behavior for a freeform resize handle (the same way PowerPoint/Keynote's own shape
resize distorts a shape's stroke/corner features), not something this feature
compensates for.

## Interaction: selecting a shape vs. opening its edit sheet

`AnnotateScreen.tsx` originally used one `editingId` state to drive both which mark is
"selected" on the canvas (the condition `ShapeHandles` renders under) and whether
`EditMarkSheet`/`EditInkSheet` (wrapped in `Sheet`, `src/components/Overlays.tsx`) is
open. `Sheet` renders a full-viewport, click-intercepting `.backdrop` with no allowance
for something else on screen to stay interactive underneath it. Tapping a `ShapeMark`
to select it (revealing its handles) therefore also opened the edit sheet on top,
whose backdrop blocked every subsequent pointer event over the canvas — the handles
rendered but were unreachable by any real drag gesture.

Fixed by decoupling "select" from "open edit sheet" strictly for `ShapeMark` taps: a
separate `selectedId` state drives `AnnotateCanvas`'s `selectedId` prop, and a new
`onSelectRequest: (id: string | null) => void` callback lets `MarkBadge` select an
unselected shape (no sheet) on its first tap; a second tap on an already-selected
shape, or any tap on a `TextMark`, still opens the sheet exactly as before. `null`
support on `onSelectRequest` also gives `selectedId` a real deselect path — an
empty-canvas tap under the Select tool, or switching to any other tool, clears it, so a
shape's outline/handles never get stuck on screen. `Stroke`/`Pin` tap behavior is
unaffected — this decoupling is scoped to `ShapeMark` only. `Overlays.tsx`'s `Sheet`
component itself was deliberately left unchanged (it's shared by every sheet/drawer/
dialog in the app); this fix lives entirely in `AnnotateScreen.tsx`/`AnnotateCanvas.tsx`.

## Edit sheet (`EditMarkSheet`, `AnnotateScreen.tsx`)

No new fields. Size slider behavior is unchanged (thickness/height only) — though its
practical meaning shifts once a shape has been resized: for a shape whose `width` is
still undefined, Size scales length *and* thickness together (via the
`size * SHAPE_ASPECT` fallback); after one resize-handle drag sets an explicit `width`,
Size only affects thickness from then on. This is a direct, intended consequence of the
backward-compatible fallback, not a bug. Duplicate already does a shallow
`{...item, id, position: shifted}` copy (`duplicateMark` in `AnnotateScreen.tsx`), so
`width`/`rotation` carry over to the duplicate automatically — no code change needed
there.

## Testing / verification

No automated test framework exists in this repo (per CLAUDE.md's documented gotcha);
`npm run build` clean is the correctness bar, plus manual click-through:

1. `npm run build` is clean.
2. Place a hairpin, drag its resize handle along its own axis — confirm length changes
   and thickness (Size slider value) does not.
3. Drag the same hairpin's rotate handle — confirm it rotates freely, snaps near 45°
   increments, and the resize handle/stem track the new angle.
4. Place a rectangle, drag its resize handle — confirm width and height change
   independently and no rotate handle appears for it.
5. Open the edit sheet for a rotated/resized shape, change color, confirm rotation/
   width are preserved after the color change commits.
6. Duplicate a rotated/resized shape — confirm the copy keeps the same rotation/width.
7. Tap directly on a rotated hairpin's visible glyph (not its former unrotated
   position) with the Select tool — confirm it selects the shape, not a miss.
8. Reload the app (`npm run dev` browser reload) — confirm the rotated/resized shape
   persists and renders identically after reload.
9. Load a song with a pre-existing (pre-this-feature) shape mark from seed data or an
   old save — confirm it still renders at its original fixed-aspect, unrotated
   appearance until explicitly dragged.
