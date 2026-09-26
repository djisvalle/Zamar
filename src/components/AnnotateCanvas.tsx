import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { AnnotationObject, Pin, ShapeId, ShapeMark, Stroke, TextMark } from "../state/types";
import {
  boundsIntersect,
  hitsAt,
  hitTestAnnotation,
  isLineShape,
  isMark,
  isPin,
  isStroke,
  objectBounds,
  PALETTE_PAGES,
  resolveAccentColor,
  resolveSelectionColor,
  rotateAround,
  shapeHalfExtents,
  simplifyStroke,
  SHAPE_ASPECT,
  snapRotation,
  STROKE_WIDTH,
  textMarkHalfExtents,
  traceSmooth,
  translateObject,
  unionBounds,
  type Bounds,
} from "../utils/annotations";
import type { MxlScoreHandle } from "./MxlScore";
import { Icon, type IconName } from "./Icon";
import { SmuflGlyph } from "./SmuflGlyph";
import { notationSymbol, SMUFL_SIZE_SCALE } from "../utils/notation";

export type AnnotateTool = "select" | "pen" | "highlighter" | "square" | "pin" | "text" | "notation" | "shapes" | "eraser";

interface InkStyle {
  color: string;
  size: number;
  opacity: number;
}

interface MarkStyle {
  color: string;
  size: number;
}

export interface ArmedSymbol {
  /** A `NotationSymbol` id (see utils/notation.ts). */
  id: string;
  /** Plain-text stand-in stored as the placed mark's `text`. */
  glyph?: string;
}

const TAP_THRESHOLD = 6;
const SELECT_HIT_RADIUS = 10;
/** How long a press on a mark takes to add it to (or drop it from) a
 * multi-selection. */
const LONG_PRESS_MS = 400;
/** A second tap this soon and this close to the first reaches the next mark
 * down in a stack instead of re-selecting the top one. */
const CYCLE_WINDOW_MS = 1500;
const CYCLE_SLOP = 8;
/** How close (px) a text/notation mark has to come to a lyric line to snap. */
const SNAP_DISTANCE = 12;
/** Gap between a snapped mark's edge and the line it snaps to. */
const SNAP_GAP = 2;

/** A light haptic tick on iOS/Android; nothing in the browser. */
export function hapticTick() {
  if (!Capacitor.isNativePlatform()) return;
  Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

interface SnapTarget {
  /** Mark center y that puts the mark's edge SNAP_GAP from the line. */
  centerY: number;
  /** Where to draw the guide. */
  guideY: number;
}

function strokesOf(annotations: AnnotationObject[]): Stroke[] {
  return annotations.filter(isStroke);
}

function marksOf(annotations: AnnotationObject[]): (TextMark | ShapeMark)[] {
  return annotations.filter(isMark);
}

/** Traces a freehand polyline as quadratic curves through the midpoints
 * between samples (each sample is the control point), so a simplified
 * stroke still reads as a smooth line instead of visible straight segments. */
function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, canvas: HTMLCanvasElement, offset?: { x: number; y: number }) {
  ctx.strokeStyle = s.color ?? resolveAccentColor(canvas);
  ctx.lineWidth = s.size ?? STROKE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = s.opacity ?? 1;
  ctx.globalCompositeOperation = s.tool === "highlighter" ? "multiply" : "source-over";
  const pts = offset ? s.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) : s.points;
  if (s.tool === "square" && pts.length === 2) {
    const [a, b] = pts;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (pts.length > 0) {
    traceSmooth(ctx, pts);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

/** Draws a wide, translucent halo underneath a selected stroke so the
 * Select tool's current target is visible on the canvas itself — see the
 * annotate-mode roadmap's "Selection highlight on the canvas" item. Uses
 * the same path-building logic as `drawStroke` (including the `square`
 * tool's rect special-case) so the halo always matches the real shape. */
function drawSelectionHalo(ctx: CanvasRenderingContext2D, s: Stroke, canvas: HTMLCanvasElement, offset?: { x: number; y: number }) {
  ctx.save();
  ctx.strokeStyle = resolveSelectionColor(canvas);
  ctx.lineWidth = (s.size ?? STROKE_WIDTH) + 10;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.35;
  ctx.globalCompositeOperation = "source-over";
  const pts = offset ? s.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) : s.points;
  if (s.tool === "square" && pts.length === 2) {
    const [a, b] = pts;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (pts.length > 0) {
    traceSmooth(ctx, pts);
    ctx.stroke();
  }
  ctx.restore();
}

/** Wraps `children` (the real chart/attachment content) in a canvas overlay
 * that turns pointer drags into `Stroke`s, plus a sibling DOM layer of pin
 * badges and text/shape marks — the canvas is sized to the wrapped content's
 * natural height and lives inside the same scrollable ancestor as that
 * content, so native scroll carries everything together with no extra
 * wiring — see the spec's "Canvas mechanics" section. */
export function AnnotateCanvas({
  annotations,
  interactive,
  tool = "select",
  onCommit,
  onReproject,
  onEditRequest,
  onSelectRequest,
  selectedId,
  multiSelectedIds = [],
  onMultiSelect,
  snapToLyrics = false,
  scrollMode = false,
  scoreRef,
  reprojectSignal,
  penStyle = { color: PALETTE_PAGES[0][0], size: STROKE_WIDTH, opacity: 1 },
  highlighterStyle = { color: PALETTE_PAGES[0][2], size: 16, opacity: 0.3 },
  markStyle = { color: PALETTE_PAGES[0][3], size: 20 },
  shapeStyle = { color: PALETTE_PAGES[0][0], size: 22 },
  armedSymbol = { id: "" },
  armedShape = "line",
  eraserSize = 16,
  children,
}: {
  annotations: AnnotationObject[];
  /** false renders every stroke/mark/pin purely as static visuals — no
   * pointer capture, no drag/select/erase, no edit-sheet triggers — so the
   * chart underneath stays fully scrollable/swipeable/pinch-zoomable. Used
   * for Live Stage's persistent "annotations are always visible" overlay
   * (see the annotate-as-overlay design spec); `true` is today's full
   * drawing/editing behavior, used while the Annotate dock is open. */
  interactive: boolean;
  tool?: AnnotateTool;
  /** Called with the full next array whenever a draw/erase/place/move gesture
   * changes it — the caller owns undo history; this component only reports
   * finished user mutations. */
  onCommit: (next: AnnotationObject[]) => void;
  /** Called instead of `onCommit` when positions are being silently synced
   * to a re-rendered score (see `reprojectSignal`) rather than changed by
   * the person — this is not a user edit, so it must not push an undo-history
   * entry the way `onCommit` does. */
  onReproject: (next: AnnotationObject[]) => void;
  /** Fires when the `select` tool taps a stroke, or a text/shape mark is
   * tapped while `select` is active — the caller (AnnotateOverlay) owns the
   * style/edit-sheet UI, this component only knows a gesture happened. */
  onEditRequest?: (id: string) => void;
  /** Fires when the `select` tool's first tap lands on a `ShapeMark` that
   * isn't selected yet — selects it (so `ShapeHandles` renders and its
   * resize/rotate handles become reachable) WITHOUT opening its edit sheet.
   * Distinct from `onEditRequest`: tapping an already-selected shape (or any
   * non-shape mark) still goes straight through `onEditRequest` as before.
   * The caller is expected to keep its own selected-id state in sync with
   * both this and `onEditRequest` (see AnnotateOverlay). Also fires with
   * `null` when the `select` tool taps empty canvas — the caller should
   * clear its selected-id state in that case. */
  onSelectRequest?: (id: string | null) => void;
  /** Id of the currently selected stroke or mark (mirrors the caller's
   * open-edit-sheet state) — when set, that object is drawn/rendered with
   * a highlight so the Select tool's target is visible on the canvas, not
   * just in the edit sheet. */
  selectedId?: string | null;
  /** Ids in the current multi-selection (long-press or box select). When
   * non-empty it takes over from `selectedId`. */
  multiSelectedIds?: string[];
  /** Reports a new multi-selection; `[]` clears it. */
  onMultiSelect?: (ids: string[]) => void;
  /** Snap text/notation marks to the chart's lyric lines while placing or
   * dragging them. Only meaningful on the chords view, whose ChordChart
   * renders `.lyric-line`/`.chord-line` rows. */
  snapToLyrics?: boolean;
  /** true pauses drawing so the wrapped content can be scrolled with a
   * normal single-finger drag instead — a single finger can't both draw
   * and scroll, so Annotate mode's tool row offers this as an explicit
   * toggle. */
  scrollMode?: boolean;
  /** Only meaningful for the `musicxml` view — lets pin/stroke/mark placement
   * anchor to the score's nearest measure, and lets `reprojectSignal`
   * reposition existing anchored annotations after a transpose. Omitted on
   * every other view (chords/image/pdf), which have no measures to anchor
   * to. */
  scoreRef?: RefObject<MxlScoreHandle | null>;
  /** Changes value whenever the score behind `scoreRef` just re-rendered
   * from a transpose — triggers a reprojection pass via `onReproject`. */
  reprojectSignal?: number;
  /** Style newly drawn pen/square strokes pick up. */
  penStyle?: InkStyle;
  highlighterStyle?: InkStyle;
  /** Style newly placed text/notation marks pick up. */
  markStyle?: MarkStyle;
  /** Style newly placed shape marks pick up. */
  shapeStyle?: MarkStyle;
  /** Which notation stamp the Notation tool places next. */
  armedSymbol?: ArmedSymbol;
  /** Which shape the Shapes tool places next. */
  armedShape?: ShapeId;
  eraserSize?: number;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draft = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  // The Select tool's gesture in progress: a press on one or more stacked
  // objects (which becomes a drag once it moves), or a box drawn from empty
  // canvas.
  const selectGesture = useRef<
    | { kind: "press"; start: { x: number; y: number }; hits: string[]; long: boolean; timer: ReturnType<typeof setTimeout> }
    | { kind: "drag"; start: { x: number; y: number }; ids: string[]; lead: string; dx: number; dy: number }
    | { kind: "box"; start: { x: number; y: number } }
    | null
  >(null);
  const lastTap = useRef<{ at: number; p: { x: number; y: number }; hits: string; index: number } | null>(null);
  const placeStart = useRef<{ x: number; y: number } | null>(null);
  const snapped = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragPreview, setDragPreview] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [box, setBox] = useState<Bounds | null>(null);
  const [guideY, setGuideY] = useState<number | null>(null);
  // Where a text/notation mark being placed currently sits (it follows the
  // finger, snapping to lyric lines, until release).
  const [placeGhost, setPlaceGhost] = useState<{ x: number; y: number } | null>(null);
  const selection = interactive && tool === "select" ? (multiSelectedIds.length > 0 ? multiSelectedIds : selectedId ? [selectedId] : []) : [];
  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number; text: string; anchor: Pin["anchor"]; isNew: boolean } | null>(
    null
  );
  // Live values for the ShapeMark currently being resized/rotated via
  // ShapeHandles — applied on top of the real mark for rendering only,
  // committed to `annotations` via onCommit on pointer-up (see ShapeHandles).
  const [shapePreview, setShapePreview] = useState<{ id: string; width?: number; size?: number; rotation?: number } | null>(null);

  // Re-measures the wrapped content's natural size for as long as this
  // AnnotateCanvas instance stays mounted. This used to stop once a view had
  // any annotations (to stop marks drifting if content reflowed after being
  // drawn) — but every control that could cause that reflow is already
  // locked out elsewhere once a view has annotations (chordsLocked/
  // instrumentsLocked gate transpose/capo/zoom/lyrics-only for chords, and
  // zoom/instrument-visibility for musicxml; image/pdf have no reflowing
  // controls at all), so the extra freeze here was redundant — and actively
  // harmful for a freshly-mounted read-only canvas whose content (e.g. a
  // MusicXML score) is still mid-engrave on first paint: it would measure a
  // too-small size and then never correct it. Transpose is deliberately
  // exempt from the lock (it reprojects instead) and can itself change a
  // score's line-wrap height, so staying attached also keeps the canvas
  // sized correctly across a transpose, not just at mount.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.scrollHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const offsetFor = (id: string) => (dragPreview && dragPreview.ids.includes(id) ? { x: dragPreview.dx, y: dragPreview.dy } : undefined);
    for (const s of strokesOf(annotations)) {
      if (selection.includes(s.id)) drawSelectionHalo(ctx, s, canvas, offsetFor(s.id));
    }
    for (const s of strokesOf(annotations)) drawStroke(ctx, s, canvas, offsetFor(s.id));
    if (draft.current) drawStroke(ctx, draft.current, canvas);
    // draft.current is a ref (mutated imperatively by the pointer handlers
    // below, not React state) so it isn't itself a dependency — this effect
    // re-runs whenever `annotations`/`size`/`dragPreview`/`selectedId` change,
    // and the handlers call the canvas's 2D context directly for the
    // in-progress preview in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, size, dragPreview, selectedId, multiSelectedIds]);

  // Reprojection: silently re-derives every anchored pin/mark/stroke's
  // on-screen position from the score's current layout after a
  // transpose-triggered re-render — see MxlScoreHandle.clientPointForAnchor.
  // Not a user edit, so it goes through `onReproject`, not `onCommit` (no
  // undo-history entry).
  useEffect(() => {
    const handle = scoreRef?.current;
    const wrapperEl = wrapperRef.current;
    if (!handle || !wrapperEl || reprojectSignal === undefined) return;
    const rect = wrapperEl.getBoundingClientRect();
    const toContent = (client: { clientX: number; clientY: number }) => ({ x: client.clientX - rect.left, y: client.clientY - rect.top });
    let changed = false;
    const next = annotations.map((a) => {
      if (isPin(a) || isMark(a)) {
        if (!a.anchor) return a;
        const pt = handle.clientPointForAnchor(a.anchor);
        if (!pt) return a;
        changed = true;
        return { ...a, position: toContent(pt) };
      }
      if (!a.anchors) return a;
      changed = true;
      return {
        ...a,
        points: a.anchors.map((anchor, i) => {
          const pt = anchor && handle.clientPointForAnchor(anchor);
          return pt ? toContent(pt) : a.points[i];
        }),
      };
    });
    if (changed) onReproject(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reprojectSignal]);

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

  const eraseAt = (p: { x: number; y: number }) => {
    const kept = annotations.filter((a) => !hitTestAnnotation(a, p, eraserSize));
    if (kept.length !== annotations.length) onCommit(kept);
  };

  const capture = (e: React.PointerEvent) => {
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Nice-to-have only.
    }
  };

  // ---------- selection ----------
  const selectOnly = (id: string | null) => {
    onMultiSelect?.([]);
    onSelectRequest?.(id);
  };
  const selectMany = (ids: string[]) => {
    if (ids.length <= 1) {
      selectOnly(ids[0] ?? null);
      return;
    }
    onSelectRequest?.(null);
    onMultiSelect?.(ids);
  };

  // ---------- snap to lyric lines ----------
  /** Snap positions for a mark `halfH` tall: just under each lyric line, or
   * just over the chord row above it (the lyric line itself when a line has
   * no chords). Measured from the live DOM so it follows text size. */
  const snapTargets = (halfH: number): SnapTarget[] => {
    const wrap = wrapperRef.current;
    if (!wrap || !snapToLyrics) return [];
    const top = wrap.getBoundingClientRect().top;
    return Array.from(wrap.querySelectorAll<HTMLElement>(".lyric-line")).flatMap((lyric) => {
      const r = lyric.getBoundingClientRect();
      const above = lyric.previousElementSibling?.classList.contains("chord-line") ? lyric.previousElementSibling.getBoundingClientRect() : r;
      const under = r.bottom - top;
      const over = above.top - top;
      return [
        { centerY: under + SNAP_GAP + halfH, guideY: under },
        { centerY: over - SNAP_GAP - halfH, guideY: over },
      ];
    });
  };
  /** Snaps a mark's center y to the nearest target within SNAP_DISTANCE,
   * showing the guide (and a haptic tick when it first engages). */
  const snapY = (y: number, halfH: number): number => {
    let best: SnapTarget | null = null;
    for (const t of snapTargets(halfH)) {
      if (Math.abs(t.centerY - y) <= SNAP_DISTANCE && (!best || Math.abs(t.centerY - y) < Math.abs(best.centerY - y))) best = t;
    }
    if (!best) {
      snapped.current = null;
      setGuideY(null);
      return y;
    }
    if (snapped.current !== best.guideY) hapticTick();
    snapped.current = best.guideY;
    setGuideY(best.guideY);
    return best.centerY;
  };
  const clearSnap = () => {
    snapped.current = null;
    setGuideY(null);
  };
  const armedHalfH = () => textMarkHalfExtents({ id: "", kind: "text", position: { x: 0, y: 0 }, text: armedSymbol.glyph ?? "Note", symbolId: tool === "notation" ? armedSymbol.id : undefined, color: "", size: markStyle.size }).halfH;

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || scrollMode) return;
    e.stopPropagation();
    const p = toContentPoint(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    if (tool === "pin") {
      setEditingPin({
        id: `pin-${Date.now()}`,
        x: p.x,
        y: p.y,
        text: "",
        anchor: scoreRef?.current?.anchorAtClientPoint(e.clientX, e.clientY) ?? undefined,
        isNew: true,
      });
      return;
    }
    if (tool === "select") {
      capture(e);
      activePointer.current = e.pointerId;
      const hits = hitsAt(p, annotations, SELECT_HIT_RADIUS);
      if (hits.length === 0) {
        selectGesture.current = { kind: "box", start: p };
        return;
      }
      const timer = setTimeout(() => {
        const g = selectGesture.current;
        if (!g || g.kind !== "press") return;
        g.long = true;
        // Long-press adds the top object to the selection (or drops it if
        // it's already in), starting a multi-selection from whatever was
        // selected before.
        const id = g.hits[0];
        const next = selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id];
        hapticTick();
        onSelectRequest?.(null);
        onMultiSelect?.(next.length === 1 ? [] : next);
        if (next.length === 1) onSelectRequest?.(next[0]);
      }, LONG_PRESS_MS);
      selectGesture.current = { kind: "press", start: p, hits, long: false, timer };
      return;
    }
    if (tool === "text" || tool === "notation" || tool === "shapes") {
      capture(e);
      activePointer.current = e.pointerId;
      placeStart.current = p;
      // Text and notation marks follow the finger until release, so they can
      // be lined up (and snapped) before they land.
      if (tool !== "shapes") setPlaceGhost({ x: p.x, y: snapY(p.y, armedHalfH()) });
      return;
    }
    capture(e);
    activePointer.current = e.pointerId;
    // All-or-nothing per stroke: if the very first point can't anchor (the
    // score isn't ready yet), the whole stroke stays pixel-only rather than
    // a partially-anchored array — mixing anchored and unanchored points
    // within one stroke isn't a state reprojection needs to handle.
    const firstAnchor = scoreRef?.current?.anchorAtClientPoint(e.clientX, e.clientY);
    const style = tool === "highlighter" ? highlighterStyle : penStyle;
    draft.current = {
      id: `stroke-${Date.now()}`,
      tool,
      points: [p],
      anchors: firstAnchor ? [firstAnchor] : undefined,
      color: style.color,
      size: style.size,
      opacity: style.opacity,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || scrollMode || activePointer.current !== e.pointerId) return;
    e.stopPropagation();
    const p = toContentPoint(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    if (tool === "select") {
      const g = selectGesture.current;
      if (!g) return;
      if (g.kind === "box") {
        setBox({ left: Math.min(p.x, g.start.x), top: Math.min(p.y, g.start.y), right: Math.max(p.x, g.start.x), bottom: Math.max(p.y, g.start.y) });
        return;
      }
      if (g.kind === "press") {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) <= TAP_THRESHOLD) return;
        clearTimeout(g.timer);
        // Dragging a selected object moves the whole selection; dragging an
        // unselected one selects and moves just that one.
        const lead = g.hits[0];
        const ids = selection.includes(lead) ? selection : [lead];
        if (!selection.includes(lead)) selectOnly(lead);
        selectGesture.current = { kind: "drag", start: g.start, ids, lead, dx: 0, dy: 0 };
      }
      const d = selectGesture.current;
      if (!d || d.kind !== "drag") return;
      d.dx = p.x - d.start.x;
      d.dy = p.y - d.start.y;
      const leadObj = annotations.find((a) => a.id === d.lead);
      if (leadObj && isMark(leadObj) && leadObj.kind === "text") {
        d.dy = snapY(leadObj.position.y + d.dy, textMarkHalfExtents(leadObj).halfH) - leadObj.position.y;
      }
      setDragPreview({ ids: d.ids, dx: d.dx, dy: d.dy });
      return;
    }
    if (tool === "text" || tool === "notation") {
      if (placeStart.current) setPlaceGhost({ x: p.x, y: snapY(p.y, armedHalfH()) });
      return;
    }
    if (tool === "shapes") return;
    if (!draft.current) return;
    // A later point failing to anchor (point strayed off any measure and
    // findNearestMeasureAnchor still found *something* nearest, so this
    // really only happens if the score dropped out of "ready" mid-gesture)
    // drops anchoring for the whole stroke rather than leaving a gap in the
    // array — same all-or-nothing reasoning as the first point above.
    const anchor = draft.current.anchors && scoreRef?.current?.anchorAtClientPoint(e.clientX, e.clientY);
    draft.current =
      tool === "square"
        ? { ...draft.current, points: [draft.current.points[0], p], anchors: anchor ? [draft.current.anchors![0], anchor] : undefined }
        : {
            ...draft.current,
            points: [...draft.current.points, p],
            anchors: anchor ? [...draft.current.anchors!, anchor] : undefined,
          };
    // Repaint immediately for a live preview of the in-progress stroke —
    // `annotations`/`size` haven't changed, so the effect above won't
    // re-run on its own until the gesture finishes.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx && draft.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of strokesOf(annotations)) drawStroke(ctx, s, canvas);
      drawStroke(ctx, draft.current, canvas);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!interactive || activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    const p = toContentPoint(e);

    if (tool === "select") {
      const g = selectGesture.current;
      selectGesture.current = null;
      setDragPreview(null);
      setBox(null);
      clearSnap();
      if (!g) return;
      if (g.kind === "box") {
        const rect = { left: Math.min(p.x, g.start.x), top: Math.min(p.y, g.start.y), right: Math.max(p.x, g.start.x), bottom: Math.max(p.y, g.start.y) };
        if (rect.right - rect.left + (rect.bottom - rect.top) <= TAP_THRESHOLD * 2) {
          // Tapped empty canvas: clear the selection.
          selectOnly(null);
          lastTap.current = null;
          return;
        }
        selectMany(annotations.filter((a) => !isPin(a) && boundsIntersect(objectBounds(a), rect)).map((a) => a.id));
        return;
      }
      if (g.kind === "drag") {
        if (Math.hypot(g.dx, g.dy) <= TAP_THRESHOLD) return;
        const wrapRect = wrapperRef.current?.getBoundingClientRect();
        onCommit(
          annotations.map((a) => {
            if (!g.ids.includes(a.id)) return a;
            const moved = translateObject(a, g.dx, g.dy);
            // Marks on a score re-anchor to the measure under their new
            // spot; strokes and pins stay pixel-positioned once moved.
            if (isMark(moved) && scoreRef?.current && wrapRect) {
              const anchor = scoreRef.current.anchorAtClientPoint(wrapRect.left + moved.position.x, wrapRect.top + moved.position.y) ?? undefined;
              return { ...moved, anchor };
            }
            return moved;
          })
        );
        return;
      }
      clearTimeout(g.timer);
      if (g.long) return;
      // A plain tap. Tapping the same spot again soon after walks down the
      // stack of objects under it.
      const key = g.hits.join(",");
      const prev = lastTap.current;
      const again = prev && prev.hits === key && Date.now() - prev.at < CYCLE_WINDOW_MS && Math.hypot(p.x - prev.p.x, p.y - prev.p.y) < CYCLE_SLOP;
      const index = again ? (prev.index + 1) % g.hits.length : 0;
      lastTap.current = { at: Date.now(), p, hits: key, index };
      const id = g.hits[index];
      const obj = annotations.find((a) => a.id === id);
      if (g.hits.length > 1 || (obj && isMark(obj) && obj.kind === "shape" && selectedId !== id)) {
        // In a stack, a tap only selects, so the next tap can move on down
        // it; Edit is in the selection menu. A shape's first tap also only
        // selects, showing its resize/rotate handles.
        selectOnly(id);
      } else {
        onMultiSelect?.([]);
        onEditRequest?.(id);
      }
      return;
    }

    if (tool === "text" || tool === "notation" || tool === "shapes") {
      const start = placeStart.current;
      const ghost = placeGhost;
      placeStart.current = null;
      setPlaceGhost(null);
      clearSnap();
      if (!start) return;
      if (tool === "shapes" && Math.hypot(p.x - start.x, p.y - start.y) > TAP_THRESHOLD) return;
      const at = tool === "shapes" ? start : ghost ?? p;
      const wrapRect = wrapperRef.current?.getBoundingClientRect();
      const anchor = (wrapRect && scoreRef?.current?.anchorAtClientPoint(wrapRect.left + at.x, wrapRect.top + at.y)) ?? undefined;
      const id = `mark-${Date.now()}`;
      if (tool === "shapes") {
        const mark: ShapeMark = { id, kind: "shape", position: start, shapeId: armedShape, color: shapeStyle.color, size: shapeStyle.size, anchor };
        onCommit([...annotations, mark]);
      } else if (tool === "text") {
        const mark: TextMark = { id, kind: "text", position: at, text: "Note", color: markStyle.color, size: markStyle.size, anchor };
        onCommit([...annotations, mark]);
        onEditRequest?.(id);
      } else {
        const mark: TextMark = {
          id,
          kind: "text",
          position: at,
          text: armedSymbol.glyph ?? "",
          symbolId: armedSymbol.id,
          color: markStyle.color,
          size: markStyle.size,
          anchor,
        };
        onCommit([...annotations, mark]);
      }
      return;
    }

    if (draft.current && draft.current.points.length > 0) {
      onCommit([...annotations, simplifyStroke(draft.current)]);
    }
    draft.current = null;
  };

  // ---------- pins ----------
  const finishEditingPin = () => {
    if (!editingPin) return;
    const text = editingPin.text.trim();
    if (!text) {
      // Empty text discards a new pin instead of creating one, and deletes
      // an existing pin edited down to nothing — an empty sticky note isn't
      // worth keeping either way.
      if (!editingPin.isNew) onCommit(annotations.filter((a) => !(isPin(a) && a.id === editingPin.id)));
      setEditingPin(null);
      return;
    }
    const pin: Pin = { id: editingPin.id, kind: "pin", position: { x: editingPin.x, y: editingPin.y }, text, anchor: editingPin.anchor };
    onCommit(editingPin.isNew ? [...annotations, pin] : annotations.map((a) => (isPin(a) && a.id === pin.id ? pin : a)));
    setEditingPin(null);
  };

  const deleteEditingPin = () => {
    if (!editingPin) return;
    if (!editingPin.isNew) onCommit(annotations.filter((a) => !(isPin(a) && a.id === editingPin.id)));
    setEditingPin(null);
  };

  const wrapWidth = wrapperRef.current?.clientWidth ?? size.width;
  // Canvas ignores pointer events for tools that place/select via the
  // transparent overlay below (pin/select/text/notation/shapes) so it
  // doesn't also try to start an ink stroke.
  const overlayTool = tool === "pin" || tool === "select" || tool === "text" || tool === "notation" || tool === "shapes";

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      {children}
      <canvas
        ref={canvasRef}
        width={size.width}
        height={size.height}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          touchAction: interactive && !scrollMode ? "none" : "auto",
          pointerEvents: interactive && !scrollMode && !overlayTool ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {/* Placement/select tools still need to know where on the chart was
          tapped, even though the canvas itself ignores pointer events while
          one of them is active (so it doesn't also try to start a stroke) —
          this transparent layer catches the gesture instead. */}
      {interactive && overlayTool && !scrollMode && (
        <div
          style={{ position: "absolute", inset: 0, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {annotations.filter(isPin).map((pin) => (
          <PinBadge
            key={pin.id}
            pin={pin}
            tool={tool}
            canvasInteractive={interactive}
            onErase={() => onCommit(annotations.filter((a) => a.id !== pin.id))}
            onOpen={() => setEditingPin({ id: pin.id, x: pin.position.x, y: pin.position.y, text: pin.text, anchor: pin.anchor, isNew: false })}
            onDrag={(x, y, clientX, clientY) => {
              const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
              onCommit(annotations.map((a) => (isPin(a) && a.id === pin.id ? { ...a, position: { x, y }, anchor } : a)));
              if (editingPin?.id === pin.id) setEditingPin(null);
            }}
          />
        ))}
        {marksOf(annotations).map((mark) => {
          let displayMark: TextMark | ShapeMark =
            mark.kind === "shape" && shapePreview && shapePreview.id === mark.id
              ? { ...mark, ...shapePreview }
              : mark;
          if (dragPreview && dragPreview.ids.includes(mark.id)) displayMark = translateObject(displayMark, dragPreview.dx, dragPreview.dy);
          return (
            <Fragment key={mark.id}>
              <MarkBadge
                mark={displayMark}
                tool={tool}
                canvasInteractive={interactive}
                selected={selection.includes(mark.id)}
                onErase={() => onCommit(annotations.filter((a) => a.id !== mark.id))}
              />
              {interactive && tool === "select" && selectedId === mark.id && multiSelectedIds.length === 0 && !dragPreview && mark.kind === "shape" && (
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
        {placeGhost && (tool === "text" || tool === "notation") && (
          <MarkBadge
            mark={{
              id: "ghost",
              kind: "text",
              position: placeGhost,
              text: tool === "notation" ? armedSymbol.glyph ?? "" : "Note",
              symbolId: tool === "notation" ? armedSymbol.id : undefined,
              color: markStyle.color,
              size: markStyle.size,
            }}
            tool={tool}
            canvasInteractive={false}
            selected={false}
            onErase={() => {}}
          />
        )}
        {guideY !== null && <div className="snap-guide" style={{ top: guideY }} />}
        {box && <div className="select-box" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
        {selection.length > 0 && !dragPreview && !box && (
          <SelectionMenu
            bounds={unionBounds(annotations.filter((a) => selection.includes(a.id)).map(objectBounds))}
            wrapWidth={wrapWidth}
            onEdit={selection.length === 1 ? () => onEditRequest?.(selection[0]) : undefined}
            onDuplicate={() => {
              const stamp = Date.now();
              const copies = annotations
                .filter((a) => selection.includes(a.id))
                .map((a, i) => ({ ...translateObject(a, 16, 16), id: `${isStroke(a) ? "stroke" : isPin(a) ? "pin" : "mark"}-${stamp}-${i}` }));
              onCommit([...annotations, ...copies]);
              selectMany(copies.map((c) => c.id));
            }}
            onDelete={() => {
              onCommit(annotations.filter((a) => !selection.includes(a.id)));
              selectOnly(null);
            }}
          />
        )}
        {editingPin && (
          <PinEditor
            x={editingPin.x}
            y={editingPin.y}
            text={editingPin.text}
            maxLeft={wrapWidth - 176}
            onChange={(text) => setEditingPin((cur) => (cur ? { ...cur, text } : cur))}
            onDone={finishEditingPin}
            onDelete={deleteEditingPin}
          />
        )}
      </div>
    </div>
  );
}

export function ShapeGlyph({ shapeId, color, size, width }: { shapeId: ShapeId; color: string; size: number; width?: number }) {
  const w = width ?? size * SHAPE_ASPECT;
  const common = { stroke: color, strokeWidth: 2.5, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={w} height={size} viewBox="0 0 60 22" preserveAspectRatio="none" style={{ display: "block" }}>
      {shapeId === "slur" && <path d="M2 18 Q30 2 58 18" {...common} />}
      {shapeId === "hairpin-cresc" && <path d="M58 2 L2 11 L58 20" {...common} />}
      {shapeId === "hairpin-dim" && <path d="M2 2 L58 11 L2 20" {...common} />}
      {shapeId === "arrow" && <path d="M2 11 L54 11 M54 11 L44 4 M54 11 L44 18" {...common} />}
      {shapeId === "line" && <path d="M2 11 L58 11" {...common} />}
      {shapeId === "bracket" && <path d="M2 3 L2 11 L58 11 L58 3" {...common} />}
      {shapeId === "rect-outline" && <rect x="3" y="3" width="54" height="16" rx="2" {...common} />}
      {shapeId === "rect-fill" && <rect x="3" y="3" width="54" height="16" rx="2" fill={color} stroke="none" />}
      {shapeId === "ellipse-outline" && <ellipse cx="30" cy="11" rx="27" ry="9" {...common} />}
      {shapeId === "ellipse-fill" && <ellipse cx="30" cy="11" rx="27" ry="9" fill={color} stroke="none" />}
    </svg>
  );
}

function renderMarkGlyph(item: TextMark | ShapeMark) {
  if (item.kind === "shape") return <ShapeGlyph shapeId={item.shapeId} color={item.color} size={item.size} width={item.width} />;
  // Notation stamps draw as real engraved SMuFL glyphs. Looked up by
  // symbolId, so stamps saved before the switch (whose `text` is the bare
  // letters, e.g. "pp") render as proper glyphs too.
  const symbol = notationSymbol(item.symbolId);
  if (symbol) return <SmuflGlyph glyph={symbol.smufl} size={item.size * SMUFL_SIZE_SCALE} color={item.color} />;
  if (item.iconGlyph) return <Icon name={item.iconGlyph as IconName} size={item.size} strokeWidth={2} />;
  return item.text;
}

function MarkBadge({
  mark,
  tool,
  canvasInteractive,
  selected,
  onErase,
}: {
  mark: TextMark | ShapeMark;
  tool: AnnotateTool;
  /** Mirrors the wrapping AnnotateCanvas's `interactive` prop — `false`
   * disables the eraser handler below regardless of `tool`, so a mark shown
   * by the read-only overlay can't be erased. */
  canvasInteractive: boolean;
  selected: boolean;
  onErase: () => void;
}) {
  // Select-tool taps and drags are hit-tested by the canvas overlay (so a
  // repeated tap can reach a mark stacked under this one); only the eraser
  // still acts on the badge directly.
  const interactive = canvasInteractive && tool === "eraser";

  return (
    <div
      style={{
        position: "absolute",
        left: mark.position.x,
        top: mark.position.y,
        transform:
          mark.kind === "shape" && isLineShape(mark.shapeId) && mark.rotation
            ? `translate(-50%, -50%) rotate(${mark.rotation}deg)`
            : "translate(-50%, -50%)",
        color: mark.color,
        fontSize: mark.kind === "text" ? mark.size : undefined,
        fontWeight: 700,
        fontFamily: "var(--font-heading)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: interactive ? "auto" : "none",
        userSelect: "none",
        touchAction: "none",
        whiteSpace: "nowrap",
        outline: selected ? "2px solid var(--acc-deep)" : "none",
        outlineOffset: selected ? 4 : 0,
        borderRadius: selected ? 6 : 0,
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (tool === "eraser") onErase();
      }}
    >
      {renderMarkGlyph(mark)}
    </div>
  );
}

/** The iOS edit menu over the current selection: Edit (one object only),
 * Duplicate and Delete. Sits above the selection, or below it when there's
 * no room above. */
function SelectionMenu({
  bounds,
  wrapWidth,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  bounds: Bounds | null;
  wrapWidth: number;
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  if (!bounds) return null;
  const below = bounds.top < 56;
  const x = Math.min(Math.max((bounds.left + bounds.right) / 2, 110), Math.max(110, wrapWidth - 110));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div
      className="edit-menu"
      style={{ left: x, top: below ? bounds.bottom + 12 : bounds.top - 12, transform: below ? "translateX(-50%)" : "translate(-50%, -100%)" }}
      onPointerDown={stop}
      onPointerUp={stop}
      onClick={stop}
    >
      {onEdit && <button onClick={onEdit}>Edit</button>}
      <button onClick={onDuplicate}>Duplicate</button>
      <button className="destructive" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}

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

function PinBadge({
  pin,
  tool,
  canvasInteractive,
  onErase,
  onOpen,
  onDrag,
}: {
  pin: Pin;
  tool: AnnotateTool;
  /** Same role as MarkBadge's `canvasInteractive` — `false` makes the pin a
   * static badge with no drag/tap handling, for the read-only overlay. */
  canvasInteractive: boolean;
  onErase: () => void;
  onOpen: () => void;
  onDrag: (x: number, y: number, clientX: number, clientY: number) => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);

  return (
    <div
      style={{
        position: "absolute",
        left: pin.position.x,
        top: pin.position.y,
        width: 24,
        height: 24,
        borderRadius: "7px 7px 7px 2px",
        background: "var(--tint)",
        border: "1.5px solid var(--acc-deep)",
        color: "var(--acc-deep)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: canvasInteractive ? "auto" : "none",
        transform: "translate(-6px, -6px)",
        boxShadow: "0 2px 5px rgba(29,31,32,0.18)",
        touchAction: "none",
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        if (tool === "eraser") {
          onErase();
          return;
        }
        dragState.current = { startX: e.clientX, startY: e.clientY, origX: pin.position.x, origY: pin.position.y, moved: false };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragState.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
      }}
      onPointerUp={(e) => {
        const d = dragState.current;
        dragState.current = null;
        if (!d) return;
        if (d.moved) {
          const dx = e.clientX - d.startX;
          const dy = e.clientY - d.startY;
          onDrag(d.origX + dx, d.origY + dy, e.clientX, e.clientY);
        } else {
          onOpen();
        }
      }}
    >
      <Icon name="note" size={13} strokeWidth={2} />
    </div>
  );
}

function PinEditor({
  x,
  y,
  text,
  maxLeft,
  onChange,
  onDone,
  onDelete,
}: {
  x: number;
  y: number;
  text: string;
  maxLeft: number;
  onChange: (text: string) => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: Math.max(0, Math.min(x + 6, maxLeft)),
        top: y + 10,
        width: 176,
        background: "var(--surface)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 8,
        boxShadow: "0 6px 16px rgba(29,31,32,0.22)",
        pointerEvents: "auto",
        zIndex: 20,
      }}
    >
      <textarea
        autoFocus
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Bowing, chord fingering, a cue…"
        style={{
          width: "100%",
          minHeight: 52,
          border: "none",
          background: "none",
          resize: "none",
          font: "inherit",
          fontSize: 13,
          color: "var(--fg)",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
        <button onClick={onDelete} style={{ fontSize: 13, fontWeight: 700, border: "none", background: "none", color: "var(--acc-deep)", padding: "2px 4px" }}>
          Delete
        </button>
        <button onClick={onDone} style={{ fontSize: 13, fontWeight: 700, border: "none", background: "none", color: "var(--acc-deep)", padding: "2px 4px" }}>
          Done
        </button>
      </div>
    </div>
  );
}
