import type { AnnotationObject, Pin, Stroke } from "../state/types";

export const STROKE_WIDTH = 3;
export const ERASE_RADIUS = 14;
/** Pin badges are bigger than a stroke's hit radius (see `AnnotateCanvas.tsx`'s
 * `.pin-badge`-equivalent sizing), so the eraser needs a matching bigger
 * radius to feel consistent — tapping near a pin should erase it as readily
 * as tapping near a line of ink does. */
export const PIN_ERASE_RADIUS = 18;

/** `Stroke` kept its own `tool` discriminant rather than gaining a `kind`
 * field when `Pin` was added, so persisted `Stroke[]` JSON from before pins
 * existed parses as valid `AnnotationObject[]` with no migration — this is
 * the one place that distinguishes them. */
export function isPin(obj: AnnotationObject): obj is Pin {
  return "kind" in obj && obj.kind === "pin";
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
 * partial pixel regions — see the spec's "object eraser" decision. */
export function hitTestStroke(stroke: Stroke, point: Point, radius: number = ERASE_RADIUS): boolean {
  return strokeSegments(stroke).some(([a, b]) => distanceToSegment(point, a, b) <= radius);
}

/** True if `point` lands within `radius` of `pin`'s position. */
export function hitTestPin(pin: Pin, point: Point, radius: number = PIN_ERASE_RADIUS): boolean {
  return Math.hypot(point.x - pin.position.x, point.y - pin.position.y) <= radius;
}

/** Eraser-tool hit test across a mixed `AnnotationObject[]` array, regardless
 * of kind — the one tool that removes anything. */
export function hitTestAnnotation(obj: AnnotationObject, point: Point): boolean {
  return isPin(obj) ? hitTestPin(obj, point) : hitTestStroke(obj, point);
}

/** Resolves the app's single fixed annotation color from the live theme's
 * `--acc` custom property (read off `el`'s computed style), so drawn marks
 * track the accent color in both Light and Stage Dark without hardcoding a
 * hex value that could drift out of sync with theme.css. */
export function resolveAccentColor(el: Element): string {
  const value = getComputedStyle(el).getPropertyValue("--acc").trim();
  return value || "#5980a6";
}
