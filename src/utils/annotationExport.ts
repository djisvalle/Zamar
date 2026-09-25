import type { AnnotationObject, MusicalAnchor, ShapeMark, Stroke, TextMark } from "../state/types";
import { isLineShape, isPin, isShapeMark, isStroke, SHAPE_ASPECT, STROKE_WIDTH, traceSmooth } from "./annotations";
import { notationSymbol, SMUFL_SIZE_SCALE } from "./notation";

/** Draws a song's marks onto an export canvas the way Live Stage shows
 * them, for the PDF export. Everything is placed through `map`, which turns
 * a mark's saved position (content-relative CSS px, plus the measure anchor
 * on scores) into canvas px, or null to leave that mark out. */

type Point = { x: number; y: number };
export type PointMap = (p: Point, anchor?: MusicalAnchor) => Point | null;

/** The light theme's colors: exports are always printed on white. */
export interface MarkColors {
  acc: string;
  accDeep: string;
  tint: string;
  fontBody: string;
  fontHeading: string;
}

/** Reads the light theme's tokens off a throwaway element, so an export
 * made in Stage Dark still prints dark-on-white marks. */
export function lightMarkColors(): MarkColors {
  const el = document.createElement("div");
  el.className = "device";
  el.setAttribute("data-theme", "light");
  el.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px";
  document.body.appendChild(el);
  const css = getComputedStyle(el);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const colors = {
    acc: read("--acc", "#4f7aa3"),
    accDeep: read("--acc-deep", "#416180"),
    tint: read("--tint", "rgba(79, 122, 163, 0.14)"),
    fontBody: read("--font-body", "sans-serif"),
    fontHeading: read("--font-heading", "sans-serif"),
  };
  el.remove();
  return colors;
}

/** Waits for Bravura, so notation stamps don't print in a fallback font. */
export async function loadMarkFonts(): Promise<void> {
  await document.fonts?.load("100px Bravura", "").catch(() => {});
}

function paintStroke(g: CanvasRenderingContext2D, s: Stroke, map: PointMap, scale: number, colors: MarkColors) {
  const pts: Point[] = [];
  for (let i = 0; i < s.points.length; i++) {
    const p = map(s.points[i], s.anchors?.[i]);
    if (!p) return;
    pts.push(p);
  }
  if (!pts.length) return;
  g.save();
  g.strokeStyle = s.color ?? colors.acc;
  g.lineWidth = (s.size ?? STROKE_WIDTH) * scale;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.globalAlpha = s.opacity ?? 1;
  g.globalCompositeOperation = s.tool === "highlighter" ? "multiply" : "source-over";
  if (s.tool === "square" && pts.length === 2) {
    const [a, b] = pts;
    g.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else {
    traceSmooth(g, pts);
    g.stroke();
  }
  g.restore();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrapText(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** On stage a pin is a small badge that opens its note when tapped; on
 * paper the note is printed in a tag beside the badge instead. */
function paintPin(g: CanvasRenderingContext2D, at: Point, text: string, scale: number, colors: MarkColors) {
  const badge = 24 * scale;
  const x = at.x - 6 * scale;
  const y = at.y - 6 * scale;
  g.save();
  g.fillStyle = "#ffffff";
  roundRect(g, x, y, badge, badge, 7 * scale);
  g.fill();
  g.fillStyle = colors.tint;
  g.fill();
  g.lineWidth = 1.5 * scale;
  g.strokeStyle = colors.accDeep;
  g.stroke();
  // Three text lines, standing in for the badge's note icon.
  g.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const ly = y + (8 + i * 4) * scale;
    g.beginPath();
    g.moveTo(x + 7 * scale, ly);
    g.lineTo(x + (i === 2 ? 13 : 17) * scale, ly);
    g.stroke();
  }
  const note = text.trim();
  if (note) {
    const size = 12 * scale;
    const pad = 5 * scale;
    g.font = `${size}px ${colors.fontBody}`;
    const lines = wrapText(g, note, 160 * scale);
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + pad * 2;
    const lineH = size * 1.3;
    const h = lines.length * lineH + pad * 2 - (lineH - size);
    const tx = x + badge + 3 * scale;
    g.fillStyle = "rgba(255, 255, 255, 0.92)";
    roundRect(g, tx, y, w, h, 5 * scale);
    g.fill();
    g.lineWidth = 1 * scale;
    g.strokeStyle = colors.accDeep;
    g.stroke();
    g.fillStyle = "#000000";
    g.textBaseline = "top";
    lines.forEach((l, i) => g.fillText(l, tx + pad, y + pad + i * lineH));
  }
  g.restore();
}

function paintText(g: CanvasRenderingContext2D, m: TextMark, at: Point, scale: number, colors: MarkColors) {
  g.save();
  g.fillStyle = m.color;
  const symbol = notationSymbol(m.symbolId);
  if (symbol) {
    // Centered on its ink, as SmuflGlyph does on stage: SMuFL glyphs sit on
    // a staff-relative baseline, so the em box would put each off-center.
    g.font = `${m.size * SMUFL_SIZE_SCALE * scale}px Bravura`;
    const ink = g.measureText(symbol.smufl);
    const x = at.x - (ink.actualBoundingBoxRight - ink.actualBoundingBoxLeft) / 2 + ink.actualBoundingBoxLeft;
    const y = at.y + (ink.actualBoundingBoxAscent - ink.actualBoundingBoxDescent) / 2;
    g.fillText(symbol.smufl, x, y);
  } else {
    g.font = `700 ${m.size * scale}px ${colors.fontHeading}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(m.text, at.x, at.y);
  }
  g.restore();
}

/** Same drawing as ShapeGlyph: a 60×22 box stretched to the shape's size,
 * centered on its position and turned by its rotation. */
function paintShape(g: CanvasRenderingContext2D, m: ShapeMark, at: Point, scale: number) {
  const w = (m.width ?? m.size * SHAPE_ASPECT) * scale;
  const h = m.size * scale;
  g.save();
  g.translate(at.x, at.y);
  if (isLineShape(m.shapeId) && m.rotation) g.rotate((m.rotation * Math.PI) / 180);
  g.scale(w / 60, h / 22);
  g.translate(-30, -11);
  g.strokeStyle = m.color;
  g.fillStyle = m.color;
  g.lineWidth = 2.5;
  g.lineCap = "round";
  g.lineJoin = "round";
  const path = new Path2D();
  switch (m.shapeId) {
    case "slur":
      path.moveTo(2, 18);
      path.quadraticCurveTo(30, 2, 58, 18);
      break;
    case "hairpin-cresc":
      path.moveTo(58, 2);
      path.lineTo(2, 11);
      path.lineTo(58, 20);
      break;
    case "hairpin-dim":
      path.moveTo(2, 2);
      path.lineTo(58, 11);
      path.lineTo(2, 20);
      break;
    case "arrow":
      path.moveTo(2, 11);
      path.lineTo(54, 11);
      path.moveTo(44, 4);
      path.lineTo(54, 11);
      path.lineTo(44, 18);
      break;
    case "line":
      path.moveTo(2, 11);
      path.lineTo(58, 11);
      break;
    case "bracket":
      path.moveTo(2, 3);
      path.lineTo(2, 11);
      path.lineTo(58, 11);
      path.lineTo(58, 3);
      break;
    case "rect-outline":
    case "rect-fill":
      path.roundRect(3, 3, 54, 16, 2);
      break;
    case "ellipse-outline":
    case "ellipse-fill":
      path.ellipse(30, 11, 27, 9, 0, 0, Math.PI * 2);
      break;
  }
  if (m.shapeId === "rect-fill" || m.shapeId === "ellipse-fill") g.fill(path);
  else g.stroke(path);
  g.restore();
}

/** Paints `items` the way Live Stage stacks them: ink strokes on the canvas
 * underneath, then pins and marks in the layer above, each in saved order.
 * `scale` is canvas px per stage CSS px, for line widths and mark sizes. */
export function paintAnnotations(g: CanvasRenderingContext2D, items: AnnotationObject[], map: PointMap, scale: number, colors: MarkColors) {
  for (const item of items) if (isStroke(item)) paintStroke(g, item, map, scale, colors);
  for (const item of items) {
    if (isStroke(item)) continue;
    const at = map(item.position, item.anchor);
    if (!at) continue;
    if (isPin(item)) paintPin(g, at, item.text, scale, colors);
    else if (isShapeMark(item)) paintShape(g, item, at, scale);
    else paintText(g, item, at, scale, colors);
  }
}
