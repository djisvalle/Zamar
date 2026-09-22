# Shape Rotate/Resize Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `ShapeMark` (slur, hairpin, arrow, line, bracket, rect, ellipse) in
Annotate mode's Shapes tool be resized independently of its thickness, and — for
line-type shapes only — rotated to any angle, via drag handles shown when the Select
tool has it selected.

**Architecture:** `ShapeMark` gains two optional fields, `width` and `rotation`, so old
persisted marks parse and render unchanged (no migration). Geometry helpers in
`src/utils/annotations.ts` compute a shape's local bounding box and handle
rotation-aware hit-testing. `src/components/AnnotateCanvas.tsx` renders the shape glyph
at its `width`/`rotation`, and adds a new `ShapeHandles` component (resize handle for
every shape; an additional rotate handle for line-type shapes only) that drives a local
live-preview state during the drag gesture and commits the final value through the
existing `onCommit` path on pointer-up — the same commit-on-release shape every other
drag gesture in this file already uses.

**Tech Stack:** React 18 + TypeScript, plain CSS transforms (no drawing/gesture
library), the existing SQLite persistence layer (annotations already persist as opaque
JSON — no schema change in this plan).

**Spec:** `docs/superpowers/specs/2026-09-23-shape-rotate-resize-design.md`

## Global Constraints

- No automated test framework exists in this repo (CLAUDE.md's documented gotcha) —
  `npm run build` (`tsc -b && vite build`) clean, plus the manual verification steps
  described in each task, is the correctness bar. Every task ends with a clean build.
- Rotation only applies to line-type shapes (slur, hairpin-cresc, hairpin-dim, arrow,
  line, bracket) — rect-outline, rect-fill, ellipse-outline, ellipse-fill get
  independent width/height resize only, never a rotate handle or transform.
- Old persisted `ShapeMark`s (no `width`/`rotation`) must render and hit-test
  identically to today until a handle is actually dragged — no migration.
- A resize handle never shrinks a shape's `width` or `size` below 16px.
- Never add Claude as a commit co-author beyond the exact trailer this repo's system
  reminder specifies; never mention Claude in code comments (CLAUDE.md ground rules).
- Commit messages describe the change, not generic `feat:`/`fix:` tags (CLAUDE.md
  ground rules).

---

## Task 1: Data model

**Files:**
- Modify: `src/state/types.ts:119-127`

**Interfaces:**
- Produces: `ShapeMark.width?: number`, `ShapeMark.rotation?: number`. Every later task
  reads/writes these exact names.
- Consumes: nothing (foundational task).

- [ ] **Step 1: Add the two optional fields to `ShapeMark`**

Current (`src/state/types.ts:119-127`):

```ts
export interface ShapeMark {
  id: string;
  kind: "shape";
  position: { x: number; y: number };
  shapeId: ShapeId;
  color: string;
  size: number;
  anchor?: MusicalAnchor;
}
```

Replace with:

```ts
export interface ShapeMark {
  id: string;
  kind: "shape";
  position: { x: number; y: number };
  shapeId: ShapeId;
  color: string;
  size: number;
  /** Length/horizontal extent in px, at rotation 0. Undefined means "never
   * resized" — falls back to `size * SHAPE_ASPECT`, i.e. the original
   * fixed-aspect behavior. Old persisted marks parse with this undefined
   * and render identically to before. */
  width?: number;
  /** Degrees clockwise from the shape's default horizontal orientation.
   * Undefined means 0 — old persisted marks render unrotated, same as
   * today. Ignored for rect-outline/rect-fill/ellipse-outline/
   * ellipse-fill — only line-type shapes rotate (see `isLineShape` in
   * `utils/annotations.ts`). */
  rotation?: number;
  anchor?: MusicalAnchor;
}
```

- [ ] **Step 2: Verify the build is clean**

Run: `npm run build`
Expected: succeeds with no TypeScript errors (the two new fields are optional, so every
existing `ShapeMark` literal in the codebase — seed data, `AnnotateCanvas.tsx`'s mark
creation in `onPointerUp` — still type-checks with no changes needed yet).

- [ ] **Step 3: Commit**

```bash
git add src/state/types.ts
git commit -m "Add optional width/rotation fields to ShapeMark for resize/rotate handles"
```

---

## Task 2: Geometry and rotation-aware hit-testing

**Files:**
- Modify: `src/utils/annotations.ts`

**Interfaces:**
- Consumes: `ShapeMark.width`/`ShapeMark.rotation` (Task 1).
- Produces: `isLineShape(shapeId: ShapeId): boolean`, `shapeHalfExtents(mark: ShapeMark):
  { halfW: number; halfH: number }`, `rotateAround(point, center, degrees): { x: number;
  y: number }`, `snapRotation(degrees: number): number`. Task 3 imports all four by
  these exact names.

- [ ] **Step 1: Import `ShapeId` alongside the existing type imports**

Current (`src/utils/annotations.ts:1`):

```ts
import type { AnnotationObject, Pin, ShapeMark, Stroke, TextMark } from "../state/types";
```

Replace with:

```ts
import type { AnnotationObject, Pin, ShapeId, ShapeMark, Stroke, TextMark } from "../state/types";
```

- [ ] **Step 2: Add the shape-category classification and geometry helpers**

Insert after the `SHAPE_ASPECT` constant (`src/utils/annotations.ts:14`, right before the
`isPin` doc comment):

```ts

/** Shapes whose glyph is inherently directional (drawn left-to-right) and
 * therefore support the Select tool's rotate handle. Rect/ellipse shapes
 * are symmetric boxes and only support resize — see the rotate/resize
 * design spec. */
const LINE_SHAPE_IDS: ReadonlySet<ShapeId> = new Set([
  "slur",
  "hairpin-cresc",
  "hairpin-dim",
  "arrow",
  "line",
  "bracket",
]);

export function isLineShape(shapeId: ShapeId): boolean {
  return LINE_SHAPE_IDS.has(shapeId);
}

/** A shape mark's local (unrotated) bounding box half-extents, in px —
 * `width ?? size * SHAPE_ASPECT` by `size`, i.e. today's fixed-aspect
 * sizing when `width` was never set. */
export function shapeHalfExtents(mark: ShapeMark): { halfW: number; halfH: number } {
  const width = mark.width ?? mark.size * SHAPE_ASPECT;
  return { halfW: width / 2, halfH: mark.size / 2 };
}

/** Rotates `point` around `center` by `degrees` clockwise (screen-space,
 * y-down) — used both to place canvas handles and to hit-test a rotated
 * shape by testing in its own local, unrotated frame. */
export function rotateAround(
  point: { x: number; y: number },
  center: { x: number; y: number },
  degrees: number
): { x: number; y: number } {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

const ROTATION_SNAP_INCREMENT = 45;
const ROTATION_SNAP_TOLERANCE = 5;

/** Snaps `degrees` to the nearest 45° increment when within
 * `ROTATION_SNAP_TOLERANCE` of it, otherwise returns it unchanged — lets
 * the rotate handle land a clean horizontal/vertical shape with a
 * fingertip while still allowing any angle. */
export function snapRotation(degrees: number): number {
  const normalized = ((degrees % 360) + 360) % 360;
  const nearest = Math.round(normalized / ROTATION_SNAP_INCREMENT) * ROTATION_SNAP_INCREMENT;
  return Math.abs(normalized - nearest) <= ROTATION_SNAP_TOLERANCE ? nearest % 360 : normalized;
}
```

- [ ] **Step 3: Make `hitTestMark` rotation-aware for shape marks**

Current (`src/utils/annotations.ts:99-104`):

```ts
export function hitTestMark(mark: TextMark | ShapeMark, point: Point, radius: number = PIN_ERASE_RADIUS): boolean {
  const floor = Math.max(radius, PIN_ERASE_RADIUS);
  const halfW = mark.kind === "shape" ? Math.max(floor, (mark.size * SHAPE_ASPECT) / 2) : Math.max(floor, (mark.text.length || 1) * mark.size * 0.32);
  const halfH = Math.max(floor, mark.size * (mark.kind === "shape" ? 0.5 : 0.9));
  return Math.abs(point.x - mark.position.x) <= halfW && Math.abs(point.y - mark.position.y) <= halfH;
}
```

Replace with:

```ts
export function hitTestMark(mark: TextMark | ShapeMark, point: Point, radius: number = PIN_ERASE_RADIUS): boolean {
  const floor = Math.max(radius, PIN_ERASE_RADIUS);
  if (mark.kind === "shape") {
    const rotated = isLineShape(mark.shapeId) && mark.rotation;
    const local = rotated ? rotateAround(point, mark.position, -mark.rotation!) : point;
    const { halfW, halfH } = shapeHalfExtents(mark);
    return Math.abs(local.x - mark.position.x) <= Math.max(floor, halfW) && Math.abs(local.y - mark.position.y) <= Math.max(floor, halfH);
  }
  const halfW = Math.max(floor, (mark.text.length || 1) * mark.size * 0.32);
  const halfH = Math.max(floor, mark.size * 0.9);
  return Math.abs(point.x - mark.position.x) <= halfW && Math.abs(point.y - mark.position.y) <= halfH;
}
```

- [ ] **Step 4: Verify the build is clean**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. This task's helpers aren't wired into any
UI yet, so there's no interactive check here — Task 3 exercises them end-to-end.

- [ ] **Step 5: Commit**

```bash
git add src/utils/annotations.ts
git commit -m "Add shape rotation/resize geometry helpers and rotation-aware hit-testing"
```

---

## Task 3: Shape rendering, and resize/rotate handles

**Files:**
- Modify: `src/components/AnnotateCanvas.tsx`

**Interfaces:**
- Consumes: `isLineShape`, `shapeHalfExtents`, `rotateAround`, `snapRotation` (Task 2);
  `ShapeMark.width`/`ShapeMark.rotation` (Task 1).
- Produces: nothing further consumed by other tasks — this is the last task.

- [ ] **Step 1: Import the new geometry helpers and `Fragment`**

Current (`src/components/AnnotateCanvas.tsx:1-3`):

```ts
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AnnotationObject, Pin, ShapeId, ShapeMark, Stroke, TextMark } from "../state/types";
import { hitTestAnnotation, isMark, isPin, isStroke, resolveAccentColor, resolveSelectionColor, SHAPE_ASPECT, STROKE_WIDTH, topStrokeHit } from "../utils/annotations";
```

Replace with:

```ts
import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AnnotationObject, Pin, ShapeId, ShapeMark, Stroke, TextMark } from "../state/types";
import {
  hitTestAnnotation,
  isLineShape,
  isMark,
  isPin,
  isStroke,
  resolveAccentColor,
  resolveSelectionColor,
  rotateAround,
  shapeHalfExtents,
  SHAPE_ASPECT,
  snapRotation,
  STROKE_WIDTH,
  topStrokeHit,
} from "../utils/annotations";
```

- [ ] **Step 2: Add `shapePreview` state**

Current (`src/components/AnnotateCanvas.tsx:163-167`):

```ts
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragPreview, setDragPreview] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number; text: string; anchor: Pin["anchor"]; isNew: boolean } | null>(
    null
  );
```

Replace with:

```ts
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragPreview, setDragPreview] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number; text: string; anchor: Pin["anchor"]; isNew: boolean } | null>(
    null
  );
  // Live values for the ShapeMark currently being resized/rotated via
  // ShapeHandles — applied on top of the real mark for rendering only,
  // committed to `annotations` via onCommit on pointer-up (see ShapeHandles).
  const [shapePreview, setShapePreview] = useState<{ id: string; width?: number; size?: number; rotation?: number } | null>(null);
```

- [ ] **Step 3: Add a `toContent` helper next to `toContentPoint`**

Current (`src/components/AnnotateCanvas.tsx:245-248`):

```ts
  const toContentPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
```

Replace with:

```ts
  const toContentPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Same conversion as toContentPoint, but from raw client coordinates
  // rather than a PointerEvent — ShapeHandles' rotate handle needs this to
  // compute an angle from the shape's center, not just a delta.
  const toContent = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = wrapperRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };
```

- [ ] **Step 4: Wire `ShapeHandles` and live preview into the marks render loop**

Current (`src/components/AnnotateCanvas.tsx:499-512`):

```tsx
        {marksOf(annotations).map((mark) => (
          <MarkBadge
            key={mark.id}
            mark={mark}
            tool={tool}
            selected={mark.id === selectedId}
            onErase={() => onCommit(annotations.filter((a) => a.id !== mark.id))}
            onEdit={() => onEditRequest?.(mark.id)}
            onDrag={(x, y, clientX, clientY) => {
              const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
              onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, position: { x, y }, anchor } : a)));
            }}
          />
        ))}
```

Replace with:

```tsx
        {marksOf(annotations).map((mark) => {
          const displayMark: TextMark | ShapeMark =
            mark.kind === "shape" && shapePreview && shapePreview.id === mark.id
              ? { ...mark, ...shapePreview }
              : mark;
          return (
            <Fragment key={mark.id}>
              <MarkBadge
                mark={displayMark}
                tool={tool}
                selected={mark.id === selectedId}
                onErase={() => onCommit(annotations.filter((a) => a.id !== mark.id))}
                onEdit={() => onEditRequest?.(mark.id)}
                onDrag={(x, y, clientX, clientY) => {
                  const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
                  onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, position: { x, y }, anchor } : a)));
                }}
              />
              {tool === "select" && selectedId === mark.id && mark.kind === "shape" && (
                <ShapeHandles
                  mark={displayMark as ShapeMark}
                  toContent={toContent}
                  onPreview={(p) => setShapePreview(p ? { id: mark.id, ...p } : null)}
                  onResize={(width, size) => onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, width, size } : a)))}
                  onRotate={(rotation) => onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, rotation } : a)))}
                />
              )}
            </Fragment>
          );
        })}
```

- [ ] **Step 5: Give `ShapeGlyph` an independent `width` prop**

Current (`src/components/AnnotateCanvas.tsx:529-533`):

```tsx
export function ShapeGlyph({ shapeId, color, size }: { shapeId: ShapeId; color: string; size: number }) {
  const w = size * SHAPE_ASPECT;
  const common = { stroke: color, strokeWidth: 2.5, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={w} height={size} viewBox="0 0 60 22" style={{ display: "block" }}>
```

Replace with:

```tsx
export function ShapeGlyph({ shapeId, color, size, width }: { shapeId: ShapeId; color: string; size: number; width?: number }) {
  const w = width ?? size * SHAPE_ASPECT;
  const common = { stroke: color, strokeWidth: 2.5, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={w} height={size} viewBox="0 0 60 22" style={{ display: "block" }}>
```

- [ ] **Step 6: Pass `width` through `renderMarkGlyph`**

Current (`src/components/AnnotateCanvas.tsx:548-552`):

```tsx
function renderMarkGlyph(item: TextMark | ShapeMark) {
  if (item.kind === "shape") return <ShapeGlyph shapeId={item.shapeId} color={item.color} size={item.size} />;
  if (item.iconGlyph) return <Icon name={item.iconGlyph as IconName} size={item.size} strokeWidth={2} />;
  return item.text;
}
```

Replace with:

```tsx
function renderMarkGlyph(item: TextMark | ShapeMark) {
  if (item.kind === "shape") return <ShapeGlyph shapeId={item.shapeId} color={item.color} size={item.size} width={item.width} />;
  if (item.iconGlyph) return <Icon name={item.iconGlyph as IconName} size={item.size} strokeWidth={2} />;
  return item.text;
}
```

- [ ] **Step 7: Apply the rotation transform in `MarkBadge`**

Current (`src/components/AnnotateCanvas.tsx:576-578`, inside `MarkBadge`'s style object):

```ts
        left: mark.position.x,
        top: mark.position.y,
        transform: "translate(-50%, -50%)",
```

Replace with:

```ts
        left: mark.position.x,
        top: mark.position.y,
        transform:
          mark.kind === "shape" && isLineShape(mark.shapeId) && mark.rotation
            ? `translate(-50%, -50%) rotate(${mark.rotation}deg)`
            : "translate(-50%, -50%)",
```

- [ ] **Step 8: Add the `ShapeHandles` component**

Insert immediately after the closing `}` of `MarkBadge` (`src/components/AnnotateCanvas.tsx:624`,
right before the `PinBadge` function starts):

```tsx

/** Resize (length for line-type shapes, independent width+height for
 * rect/ellipse) and, for line-type shapes only, rotate handles shown when
 * the Select tool has a `ShapeMark` selected. Drag state lives in refs (the
 * gesture itself doesn't need React state); `onPreview` reports live values
 * up to the parent for on-canvas feedback while dragging, and
 * `onResize`/`onRotate` commit the final value on pointer-up — the same
 * commit-on-release shape every other drag gesture in this file uses. */
function ShapeHandles({
  mark,
  toContent,
  onPreview,
  onResize,
  onRotate,
}: {
  mark: ShapeMark;
  toContent: (clientX: number, clientY: number) => { x: number; y: number };
  onPreview: (preview: { width?: number; size?: number; rotation?: number } | null) => void;
  onResize: (width: number, size: number) => void;
  onRotate: (rotation: number) => void;
}) {
  const resizeDrag = useRef<{
    startClientX: number;
    startClientY: number;
    startWidth: number;
    startSize: number;
    rotation: number;
    isLine: boolean;
    currentWidth: number;
    currentSize: number;
  } | null>(null);
  const rotateDrag = useRef<{ startAngle: number; startRotation: number; current: number } | null>(null);

  const { halfW, halfH } = shapeHalfExtents(mark);
  const rotation = mark.rotation ?? 0;
  const isLine = isLineShape(mark.shapeId);
  const STEM = 28;
  const resizeLocal = isLine ? { x: halfW, y: 0 } : { x: halfW, y: halfH };

  return (
    <div
      style={{
        position: "absolute",
        left: mark.position.x,
        top: mark.position.y,
        transform: isLine && rotation ? `rotate(${rotation}deg)` : undefined,
        transformOrigin: "0 0",
        pointerEvents: "none",
      }}
    >
      {isLine && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: -(halfH + STEM),
            width: 1,
            height: halfH + STEM,
            background: "var(--acc-deep)",
          }}
        />
      )}
      {isLine && (
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            const p = toContent(e.clientX, e.clientY);
            rotateDrag.current = {
              startAngle: (Math.atan2(p.y - mark.position.y, p.x - mark.position.x) * 180) / Math.PI,
              startRotation: rotation,
              current: rotation,
            };
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = rotateDrag.current;
            if (!d) return;
            const p = toContent(e.clientX, e.clientY);
            const angle = (Math.atan2(p.y - mark.position.y, p.x - mark.position.x) * 180) / Math.PI;
            const next = snapRotation(d.startRotation + (angle - d.startAngle));
            d.current = next;
            onPreview({ rotation: next });
          }}
          onPointerUp={() => {
            const d = rotateDrag.current;
            rotateDrag.current = null;
            if (!d) return;
            onPreview(null);
            onRotate(d.current);
          }}
          onPointerCancel={() => {
            rotateDrag.current = null;
            onPreview(null);
          }}
          aria-label="Rotate shape"
          style={{
            position: "absolute",
            left: 0,
            top: -(halfH + STEM),
            transform: "translate(-50%, -50%)",
            width: 20,
            height: 20,
            borderRadius: 99,
            background: "var(--surface)",
            border: "2px solid var(--acc-deep)",
            pointerEvents: "auto",
            touchAction: "none",
            cursor: "grab",
          }}
        />
      )}
      <div
        onPointerDown={(e) => {
          e.stopPropagation();
          resizeDrag.current = {
            startClientX: e.clientX,
            startClientY: e.clientY,
            startWidth: halfW * 2,
            startSize: mark.size,
            rotation,
            isLine,
            currentWidth: halfW * 2,
            currentSize: mark.size,
          };
          (e.target as Element).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = resizeDrag.current;
          if (!d) return;
          const rawDx = e.clientX - d.startClientX;
          const rawDy = e.clientY - d.startClientY;
          const local = d.isLine ? rotateAround({ x: rawDx, y: rawDy }, { x: 0, y: 0 }, -d.rotation) : { x: rawDx, y: rawDy };
          const nextWidth = Math.max(16, d.startWidth + local.x * 2);
          const nextSize = d.isLine ? d.startSize : Math.max(16, d.startSize + local.y * 2);
          d.currentWidth = nextWidth;
          d.currentSize = nextSize;
          onPreview({ width: nextWidth, size: nextSize });
        }}
        onPointerUp={() => {
          const d = resizeDrag.current;
          resizeDrag.current = null;
          if (!d) return;
          onPreview(null);
          onResize(d.currentWidth, d.currentSize);
        }}
        onPointerCancel={() => {
          resizeDrag.current = null;
          onPreview(null);
        }}
        aria-label="Resize shape"
        style={{
          position: "absolute",
          left: resizeLocal.x,
          top: resizeLocal.y,
          transform: "translate(-50%, -50%)",
          width: 18,
          height: 18,
          borderRadius: isLine ? 99 : 4,
          background: "var(--surface)",
          border: "2px solid var(--acc-deep)",
          pointerEvents: "auto",
          touchAction: "none",
          cursor: isLine ? "ew-resize" : "nwse-resize",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 9: Verify the build is clean**

Run: `npm run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 10: Manual verification**

Run `npm run dev`, open a song on Live Stage, open Annotate mode, select the Shapes
tool:

1. Place a hairpin (crescendo or decrescendo). Switch to the Select tool and tap it to
   select it — confirm a thin stem + round rotate handle appears above it, and a small
   resize handle appears at its right edge.
2. Drag the resize handle along the shape's own direction — confirm the hairpin's
   length changes live while dragging, and that opening its edit sheet afterward shows
   the Size (thickness) slider unchanged from before the drag.
3. Drag the rotate handle in a slow circle — confirm the hairpin rotates freely and
   live, and audibly/visually "catches" near 0°/45°/90°/135°/180°/etc.
4. With the hairpin rotated (e.g. ~30°), drag its resize handle again — confirm it
   lengthens/shortens along its *current* rotated direction, not the original
   horizontal axis.
5. Tap directly on the rotated hairpin's visible glyph (not where it would have been
   unrotated) with the Select tool — confirm it selects correctly (verifies the
   rotation-aware hit-test from Task 2).
6. Place a rectangle (outline or filled). Select it — confirm a resize handle appears
   at its bottom-right corner and no rotate handle appears anywhere for it.
7. Drag the rectangle's resize handle diagonally — confirm width and height change
   independently (e.g. drag mostly rightward to get a wide, short rectangle).
8. Duplicate a resized/rotated shape (via its edit sheet's Duplicate button) — confirm
   the copy keeps the same width/rotation.
9. Change the color of a resized/rotated shape via its edit sheet — confirm
   width/rotation are unaffected after the color commits.
10. Reload the page (`npm run dev`'s browser tab) — confirm the resized/rotated shape
    persists and renders identically after reload (verifies Task 1's fields round-trip
    through the existing `annotations_json` persistence with no extra wiring needed).
11. Load or seed a song with a shape mark placed *before* this feature (any shape
    placed and saved prior to this change, or one from existing seed data if present)
    — confirm it still renders at its original fixed-aspect, unrotated appearance with
    no visual change, until a handle is explicitly dragged on it.

- [ ] **Step 11: Commit**

```bash
git add src/components/AnnotateCanvas.tsx
git commit -m "Add resize handles to every shape and rotate handles to line-type shapes"
```
