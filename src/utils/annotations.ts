import type { AnnotationObject, Pin, ShapeId, ShapeMark, Stroke, TextMark } from "../state/types";

export const STROKE_WIDTH = 3;
export const ERASE_RADIUS = 14;
/** Pin badges are bigger than a stroke's hit radius (see `AnnotateCanvas.tsx`'s
 * `.pin-badge`-equivalent sizing), so the eraser needs a matching bigger
 * radius to feel consistent — tapping near a pin should erase it as readily
 * as tapping near a line of ink does. Also used as the floor for text/shape
 * marks, which are similarly bigger targets than a bare stroke. */
export const PIN_ERASE_RADIUS = 18;
/** Width-to-height ratio every shape glyph is drawn at (see `ShapeGlyph` in
 * AnnotateScreen.tsx) — shared with hit-testing so a shape's erase/edit
 * target matches what's actually drawn on screen. */
export const SHAPE_ASPECT = 60 / 22;

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

/** `Stroke` kept its own `tool` discriminant rather than gaining a `kind`
 * field when `Pin` was added, so persisted `Stroke[]` JSON from before pins
 * existed parses as valid `AnnotationObject[]` with no migration — this is
 * the one place that distinguishes them. */
export function isPin(obj: AnnotationObject): obj is Pin {
  return "kind" in obj && obj.kind === "pin";
}

export function isTextMark(obj: AnnotationObject): obj is TextMark {
  return "kind" in obj && obj.kind === "text";
}

export function isShapeMark(obj: AnnotationObject): obj is ShapeMark {
  return "kind" in obj && obj.kind === "shape";
}

/** Text and shape stamps share one drag/tap/edit-sheet code path in
 * AnnotateScreen.tsx — only their glyph differs. */
export function isMark(obj: AnnotationObject): obj is TextMark | ShapeMark {
  return isTextMark(obj) || isShapeMark(obj);
}

export function isStroke(obj: AnnotationObject): obj is Stroke {
  return !("kind" in obj);
}

interface Point {
  x: number;
  y: number;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function strokeSegments(stroke: Stroke): [Point, Point][] {
  if (stroke.tool === "square" && stroke.points.length === 2) {
    const [a, b] = stroke.points;
    const corners: Point[] = [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ];
    return corners.map((c, i) => [c, corners[(i + 1) % corners.length]] as [Point, Point]);
  }
  const segments: [Point, Point][] = [];
  for (let i = 0; i < stroke.points.length - 1; i++) {
    segments.push([stroke.points[i], stroke.points[i + 1]]);
  }
  if (segments.length === 0 && stroke.points.length === 1) {
    segments.push([stroke.points[0], stroke.points[0]]);
  }
  return segments;
}

/** True if `point` lands within `radius` of any part of `stroke`'s drawn
 * path. Used by the eraser tool, which removes whole strokes rather than
 * partial pixel regions — see the spec's "object eraser" decision. `radius`
 * defaults to `ERASE_RADIUS` but grows with the eraser-size control and a
 * thick stroke's own half-width, so erasing feels proportional to what's
 * actually drawn. */
export function hitTestStroke(stroke: Stroke, point: Point, radius: number = ERASE_RADIUS): boolean {
  const effective = Math.max(radius, (stroke.size ?? STROKE_WIDTH) / 2 + radius / 2);
  return strokeSegments(stroke).some(([a, b]) => distanceToSegment(point, a, b) <= effective);
}

/** True if `point` lands within `radius` of `pin`'s position. */
export function hitTestPin(pin: Pin, point: Point, radius: number = PIN_ERASE_RADIUS): boolean {
  return Math.hypot(point.x - pin.position.x, point.y - pin.position.y) <= Math.max(radius, PIN_ERASE_RADIUS);
}

/** True if `point` lands within a text/shape mark's rough bounding box —
 * good enough for an eraser/select-tool hit test, not pixel-exact glyph
 * metrics. */
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

/** Eraser-tool hit test across a mixed `AnnotationObject[]` array, regardless
 * of kind — the one tool that removes anything. */
export function hitTestAnnotation(obj: AnnotationObject, point: Point, radius?: number): boolean {
  if (isPin(obj)) return hitTestPin(obj, point, radius);
  if (isMark(obj)) return hitTestMark(obj, point, radius);
  return hitTestStroke(obj, point, radius);
}

/** Topmost ink stroke under a point, for the select tool's tap-to-edit /
 * drag-to-move — text/shape marks handle their own hit-testing via their own
 * DOM nodes, so only strokes need this at the canvas level. */
export function topStrokeHit(point: Point, items: AnnotationObject[], radius: number = ERASE_RADIUS): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!isStroke(item)) continue;
    if (hitTestStroke(item, point, radius)) return item.id;
  }
  return null;
}

/** Resolves the app's single fixed annotation color from the live theme's
 * `--acc` custom property (read off `el`'s computed style), so drawn marks
 * without an explicit `color` track the accent color in both Light and
 * Stage Dark without hardcoding a hex value that could drift out of sync
 * with theme.css. */
export function resolveAccentColor(el: Element): string {
  const value = getComputedStyle(el).getPropertyValue("--acc").trim();
  return value || "#5980a6";
}

/** Resolves the app's "selected/active" indicator color from the live
 * theme's `--acc-deep` custom property — the same token `ColorGrid`'s
 * selected-swatch ring and `ToolButton`'s active state already use — so
 * the Select tool's canvas halo (see AnnotateCanvas.tsx) matches every
 * other "this is the selected one" indicator in Annotate mode. */
export function resolveSelectionColor(el: Element): string {
  const value = getComputedStyle(el).getPropertyValue("--acc-deep").trim();
  return value || "#416180";
}

// Two swipeable 16-swatch pages, shared by every color-picking control.
export const PALETTE_PAGES: string[][] = [
  ["#1a1a1a", "#e63946", "#ffd400", "#2a6fdb", "#3fb950", "#4b3fd6", "#e08e0b", "#9aa0a6", "#cfd4d9", "#a3242c", "#c9a227", "#7ec8ff", "#2a9d5c", "#7c3fd6", "#7a4b2a", "#33383d"],
  ["#f4f1ea", "#ef5da8", "#f2c94c", "#4fd1ff", "#a9e8a0", "#a53fe0", "#e0b98a", "#8aa6e8", "#4d6fd1", "#2f8f8a", "#4fd1c5", "#7fb23a", "#3fd1e0", "#4a74d6", "#7fe0c6", "#2f8f5c"],
];
