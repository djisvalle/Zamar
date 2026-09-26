import type { AnnotateRecents, AnnotationObject, AnnotationView, Pin, ShapeId, ShapeMark, Song, StickyColor, Stroke, TextMark } from "../state/types";

export const STROKE_WIDTH = 3;

/** Content width assumed for marks saved before `Song.annotationWidths`
 * existed and never shown on Live Stage since: the phone layout. */
export const DEFAULT_MARKED_WIDTH = 402;

/** Keeps `song.annotationWidths` in step with its marks: a view that has
 * marks but no recorded width gets `width` (the content width on screen
 * now), and a view with no marks loses its width. Returns `song` itself when
 * nothing changes. */
export function syncAnnotationWidths(song: Song, width: number | null): Song {
  const current = song.annotationWidths ?? {};
  const next: Partial<Record<AnnotationView, number>> = {};
  for (const view of Object.keys(song.annotations) as AnnotationView[]) {
    if (!song.annotations[view]?.length) continue;
    const w = current[view] ?? (width && width > 0 ? Math.round(width) : undefined);
    if (w) next[view] = w;
  }
  const same =
    Object.keys(next).length === Object.keys(current).length &&
    (Object.keys(next) as AnnotationView[]).every((v) => next[v] === current[v]);
  if (same) return song;
  if (Object.keys(next).length === 0) {
    const { annotationWidths: _dropped, ...rest } = song;
    return rest;
  }
  return { ...song, annotationWidths: next };
}

/** Draws a pen or highlighter stroke through exactly the points it was
 * drawn with. Strokes are recorded from every touch sample and then
 * reduced to within STROKE_SIMPLIFY_TOLERANCE of that path, so straight
 * segments between the kept points are faithful to the hand. Curving
 * through the midpoints instead (as this used to) rounded off every corner,
 * since after reduction the kept points are mostly the corners. */
export function tracePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  // A tap leaves one point; a zero-length segment still draws a round dot.
  if (pts.length === 1) ctx.lineTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}
export const ERASE_RADIUS = 14;
/** Pin badges are bigger than a stroke's hit radius (see `AnnotateCanvas.tsx`'s
 * `.pin-badge`-equivalent sizing), so the eraser needs a matching bigger
 * radius to feel consistent — tapping near a pin should erase it as readily
 * as tapping near a line of ink does. Also used as the floor for text/shape
 * marks, which are similarly bigger targets than a bare stroke. */
export const PIN_ERASE_RADIUS = 18;
/** Width-to-height ratio every shape glyph is drawn at (see `ShapeGlyph` in
 * AnnotateOverlay.tsx) — shared with hit-testing so a shape's erase/edit
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
 * AnnotateOverlay.tsx — only their glyph differs. */
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

/** How far (CSS px at the content's natural size) a simplified pen or
 * highlighter stroke may stray from what was drawn — below what the eye
 * can see at any stroke width the tools offer. */
export const STROKE_SIMPLIFY_TOLERANCE = 0.75;

/** Indices of the points Ramer-Douglas-Peucker keeps at `tolerance`, in
 * order. The first and last points are always kept. */
export function simplifyIndices(points: Point[], tolerance: number = STROKE_SIMPLIFY_TOLERANCE): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstDist = 0;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i], points[a], points[b]);
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst !== -1 && worstDist > tolerance) {
      keep[worst] = true;
      stack.push([a, worst], [worst, b]);
    }
  }
  return keep.flatMap((k, i) => (k ? [i] : []));
}

/** Drops the raw pointer samples a finished pen/highlighter stroke doesn't
 * need, keeping `anchors` parallel to `points`. Square strokes (two corner
 * points) come back unchanged. */
export function simplifyStroke(stroke: Stroke): Stroke {
  if (stroke.tool === "square") return stroke;
  const kept = simplifyIndices(stroke.points);
  if (kept.length === stroke.points.length) return stroke;
  return {
    ...stroke,
    points: kept.map((i) => stroke.points[i]),
    anchors: stroke.anchors ? kept.map((i) => stroke.anchors![i]) : undefined,
  };
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

/** Sticky-note colours: paper tones that stay the same in Stage Dark (a
 * note sits on the page, like the score's white paper), dark enough at the
 * edge to separate from white and light enough for black text. */
export const STICKY_COLORS: Record<StickyColor, { fill: string; edge: string; label: string }> = {
  yellow: { fill: "#FFE680", edge: "#E6C84A", label: "Yellow" },
  pink: { fill: "#FFC2D6", edge: "#E89AB4", label: "Pink" },
  blue: { fill: "#BFE0FF", edge: "#8DBFEA", label: "Blue" },
  green: { fill: "#C8F0B8", edge: "#98CF84", label: "Green" },
};
export const STICKY_COLOR_IDS = Object.keys(STICKY_COLORS) as StickyColor[];
export const STICKY_TEXT_COLOR = "#1c1c1e";
export const NOTE_WIDTH = 160;
export const NOTE_HEIGHT = 120;
export const NOTE_MIN_WIDTH = 96;
export const NOTE_MIN_HEIGHT = 64;

/** A note's box in content coordinates. Pins saved before sticky notes
 * have no size and get the default. */
export function noteBox(pin: Pin): { left: number; top: number; width: number; height: number } {
  return { left: pin.position.x, top: pin.position.y, width: pin.width ?? NOTE_WIDTH, height: pin.height ?? NOTE_HEIGHT };
}

export function stickyColor(pin: Pin): { fill: string; edge: string; label: string } {
  return STICKY_COLORS[pin.color ?? "yellow"] ?? STICKY_COLORS.yellow;
}

/** True if `point` lands on the note, or within `radius` of its edge. */
export function hitTestPin(pin: Pin, point: Point, radius: number = 0): boolean {
  const b = noteBox(pin);
  return point.x >= b.left - radius && point.x <= b.left + b.width + radius && point.y >= b.top - radius && point.y <= b.top + b.height + radius;
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
  const { halfW, halfH } = textMarkHalfExtents(mark);
  return Math.abs(point.x - mark.position.x) <= Math.max(floor, halfW) && Math.abs(point.y - mark.position.y) <= Math.max(floor, halfH);
}

/** Rough half-size of a text or notation mark around its center. A notation
 * stamp is one glyph drawn at SMUFL_SIZE_SCALE × size (see AnnotateCanvas's
 * renderMarkGlyph), not a run of UI-font letters. */
export function textMarkHalfExtents(mark: TextMark): { halfW: number; halfH: number } {
  return {
    halfW: mark.symbolId ? mark.size * 0.8 : (mark.text.length || 1) * mark.size * 0.32,
    halfH: mark.size * 0.9,
  };
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

/** Every sticky note, ink stroke and text/shape mark under a point, topmost
 * first — the Select tool's hit list. Notes draw above everything else, so
 * they come first. A repeated tap walks down the list to reach objects
 * stacked under the top one. */
export function hitsAt(point: Point, items: AnnotationObject[], radius: number = ERASE_RADIUS): string[] {
  const ids: string[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (isPin(item) && hitTestPin(item, point)) ids.push(item.id);
  }
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (isPin(item)) continue;
    if (isMark(item) ? hitTestMark(item, point, radius) : hitTestStroke(item, point, radius)) ids.push(item.id);
  }
  return ids;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Axis-aligned bounds of a stroke, mark or pin in content coordinates,
 * for box selection and for placing the selection's edit menu. */
export function objectBounds(obj: AnnotationObject): Bounds {
  if (isPin(obj)) {
    const b = noteBox(obj);
    return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height };
  }
  if (isMark(obj)) {
    let { halfW, halfH } = obj.kind === "shape" ? shapeHalfExtents(obj) : textMarkHalfExtents(obj);
    if (obj.kind === "shape" && isLineShape(obj.shapeId) && obj.rotation) {
      // A rotated line shape's box: its full length could point any way.
      halfW = halfH = Math.max(halfW, halfH);
    }
    return { left: obj.position.x - halfW, top: obj.position.y - halfH, right: obj.position.x + halfW, bottom: obj.position.y + halfH };
  }
  const pad = (obj.size ?? STROKE_WIDTH) / 2;
  const xs = obj.points.map((p) => p.x);
  const ys = obj.points.map((p) => p.y);
  return { left: Math.min(...xs) - pad, top: Math.min(...ys) - pad, right: Math.max(...xs) + pad, bottom: Math.max(...ys) + pad };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  return {
    left: Math.min(...list.map((b) => b.left)),
    top: Math.min(...list.map((b) => b.top)),
    right: Math.max(...list.map((b) => b.right)),
    bottom: Math.max(...list.map((b) => b.bottom)),
  };
}

/** Moves any annotation by (dx, dy). A manual move drops musical anchors,
 * so the next transpose doesn't snap it back to where it was. */
export function translateObject<T extends AnnotationObject>(obj: T, dx: number, dy: number): T {
  if (isStroke(obj)) return { ...obj, points: obj.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), anchors: undefined };
  return { ...obj, position: { x: obj.position.x + dx, y: obj.position.y + dy }, anchor: undefined };
}

/** How many entries each Annotate popover's Recent row keeps. */
export const MAX_RECENTS = 8;

function pushRecent<T>(list: T[], item: T, same: (a: T, b: T) => boolean): T[] {
  return [item, ...list.filter((x) => !same(x, item))].slice(0, MAX_RECENTS);
}

/** Folds newly added annotations into the Recent rows: each one's color
 * (and, for a notation stamp, its symbol) moves to the front of its tool's
 * row. Returns the same object when nothing changed. */
export function recordRecents(recents: AnnotateRecents, added: AnnotationObject[]): AnnotateRecents {
  let next = recents;
  const eq = (a: string, b: string) => a === b;
  for (const obj of added) {
    if (isPin(obj)) continue;
    if (isStroke(obj)) {
      if (!obj.color) continue;
      const key = obj.tool === "highlighter" ? "highlighter" : "pen";
      next = { ...next, [key]: pushRecent(next[key], obj.color, eq) };
    } else if (obj.kind === "shape") {
      next = { ...next, shapes: pushRecent(next.shapes, obj.color, eq) };
    } else if (obj.symbolId) {
      const entry = { symbolId: obj.symbolId, color: obj.color };
      next = { ...next, notation: pushRecent(next.notation, entry, (a, b) => a.symbolId === b.symbolId && a.color === b.color) };
    } else {
      next = { ...next, text: pushRecent(next.text, obj.color, eq) };
    }
  }
  return next;
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
