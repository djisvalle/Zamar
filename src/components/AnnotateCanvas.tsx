import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import type { AnnotationObject, Pin, ShapeId, ShapeMark, StickyColor, Stroke, TextMark } from "../state/types";
import {
  boundsIntersect,
  hitsAt,
  hitTestAnnotation,
  isLineShape,
  isMark,
  isPin,
  isStroke,
  noteBox,
  NOTE_HEIGHT,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  NOTE_WIDTH,
  objectBounds,
  PALETTE_PAGES,
  resolveAccentColor,
  resolveSelectionColor,
  rotateAround,
  shapeHalfExtents,
  simplifyStroke,
  SHAPE_ASPECT,
  snapRotation,
  stickyColor,
  STROKE_WIDTH,
  textMarkHalfExtents,
  tracePath,
  translateObject,
  unionBounds,
  type Bounds,
} from "../utils/annotations";
import type { MxlScoreHandle } from "./MxlScore";
import { Icon, type IconName } from "./Icon";
import { SmuflGlyph } from "./SmuflGlyph";
import { notationSymbol, SMUFL_SIZE_SCALE } from "../utils/notation";
import { screenScaleOf } from "../utils/screenScale";

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

/** Space kept between an open note/text field and the top of the keyboard,
 * enough to clear Annotate's floating tool bar. */
const KEYBOARD_CLEARANCE = 96;

/** A sticky note being typed into. A new note isn't in `annotations` until
 * it's committed with some text, so it rides along here as `draft`. */
interface NoteEdit {
  id: string;
  isNew: boolean;
  draft?: Pin;
}

/** A plain text mark being typed into. A new field's left edge sits at the
 * tap (`centered` false); an existing mark's field is centred on it. */
interface TextEdit {
  id: string;
  isNew: boolean;
  x: number;
  y: number;
  centered: boolean;
  color: string;
  size: number;
  initial: string;
}

function isFreeText(obj: AnnotationObject): obj is TextMark {
  return isMark(obj) && obj.kind === "text" && !obj.symbolId;
}

/** Nearest ancestor that scrolls vertically. */
function scrollParentOf(node: HTMLElement): HTMLElement | null {
  for (let p = node.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

function strokesOf(annotations: AnnotationObject[]): Stroke[] {
  return annotations.filter(isStroke);
}

function marksOf(annotations: AnnotationObject[]): (TextMark | ShapeMark)[] {
  return annotations.filter(isMark);
}

/** Draws a stroke (see tracePath for why it goes through its exact points). */
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
    tracePath(ctx, pts);
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
    tracePath(ctx, pts);
    ctx.stroke();
  }
  ctx.restore();
}

/** Largest backing-store edge the canvas is allowed, in device pixels — a
 * long score times a 3x screen can otherwise pass the browser's canvas
 * limits and render nothing at all. */
const MAX_CANVAS_EDGE = 16384;

/** Backing-store pixels per CSS pixel: the screen's density (times any
 * magnification of the chart, see `screenScaleOf`), scaled down only as
 * far as needed to keep both edges under MAX_CANVAS_EDGE. */
function canvasScale(size: { width: number; height: number }, screenScale: number): number {
  const dpr = Math.max(window.devicePixelRatio || 1, 1) * screenScale;
  const longest = Math.max(size.width, size.height, 1);
  return Math.min(dpr, MAX_CANVAS_EDGE / longest);
}

/** Clears the canvas and maps drawing to CSS pixels. Stroke points are
 * stored in CSS pixels, while the backing store is `canvasScale` times
 * larger so ink stays sharp on high-density screens instead of being drawn
 * at 1x and stretched. */
function beginPaint(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / Math.max(canvas.clientWidth, 1);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return ctx;
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
  screenScale = 1,
  penStyle = { color: PALETTE_PAGES[0][0], size: STROKE_WIDTH, opacity: 1 },
  highlighterStyle = { color: PALETTE_PAGES[0][2], size: 16, opacity: 0.3 },
  markStyle = { color: PALETTE_PAGES[0][3], size: 20 },
  shapeStyle = { color: PALETTE_PAGES[0][0], size: 22 },
  armedSymbol = { id: "" },
  armedShape = "line",
  noteColor = "yellow",
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
   * renders `.chart-line` rows. */
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
  /** How far the chart (this layer included) is magnified on screen — see
   * screenScaleOf. Pointer input measures it from the DOM; this copy only
   * sizes the ink canvases' backing stores so magnified ink stays sharp. */
  screenScale?: number;
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
  /** Colour the Sticky note tool gives new notes. */
  noteColor?: StickyColor;
  eraserSize?: number;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Holds only the stroke being drawn, so each finger movement repaints one
  // stroke instead of every stroke on the page.
  const liveRef = useRef<HTMLCanvasElement | null>(null);
  const liveFrame = useRef<number | null>(null);
  const liveBounds = useRef<Bounds | null>(null);
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
  // A Sticky note/Text/Eraser press waiting to become a tap (or, for the
  // eraser, a drag). These act on release rather than on touch so that the
  // first finger of a two-finger scroll never places or erases anything.
  const pendingTap = useRef<{ x: number; y: number } | null>(null);
  // Touches currently down, and the last centre point of a two-finger
  // scroll while one is in progress.
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const twoFingerPan = useRef<{ x: number; y: number } | null>(null);
  const snapped = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragPreview, setDragPreview] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [box, setBox] = useState<Bounds | null>(null);
  const [guideY, setGuideY] = useState<number | null>(null);
  // Where a text/notation mark being placed currently sits (it follows the
  // finger, snapping to lyric lines, until release).
  const [placeGhost, setPlaceGhost] = useState<{ x: number; y: number } | null>(null);
  const selection = interactive && tool === "select" ? (multiSelectedIds.length > 0 ? multiSelectedIds : selectedId ? [selectedId] : []) : [];
  // The sticky note or text field being typed into, if any. Mirrored in refs
  // so closing is idempotent: a tap outside closes it on pointerdown and the
  // field's own blur follows right after.
  const [noteEdit, setNoteEditState] = useState<NoteEdit | null>(null);
  const noteEditRef = useRef<NoteEdit | null>(null);
  const [textEdit, setTextEditState] = useState<TextEdit | null>(null);
  const textEditRef = useRef<TextEdit | null>(null);
  const fieldRef = useRef<HTMLTextAreaElement | HTMLDivElement | null>(null);
  const fieldOpenedAt = useRef(0);
  const setNoteEdit = (v: NoteEdit | null) => {
    noteEditRef.current = v;
    setNoteEditState(v);
  };
  const setTextEdit = (v: TextEdit | null) => {
    textEditRef.current = v;
    setTextEditState(v);
  };
  // Live size for the note being resized by its handle, committed on release.
  const [notePreview, setNotePreview] = useState<{ id: string; width: number; height: number } | null>(null);
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
  //
  // Measures the content box, not the wrapper: the wrapper's scrollHeight
  // includes the canvas itself, so the canvas could only ever grow — a
  // taller earlier layout (another viewport, a mid-engrave score) left a
  // screen or more of blank space below the chart.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas && beginPaint(canvas);
    if (!canvas || !ctx) return;
    const offsetFor = (id: string) => (dragPreview && dragPreview.ids.includes(id) ? { x: dragPreview.dx, y: dragPreview.dy } : undefined);
    for (const s of strokesOf(annotations)) {
      if (selection.includes(s.id)) drawSelectionHalo(ctx, s, canvas, offsetFor(s.id));
    }
    for (const s of strokesOf(annotations)) drawStroke(ctx, s, canvas, offsetFor(s.id));
    // The stroke in progress lives on the live layer (see paintLive). Once
    // it's committed it's drawn above with the rest, so the live layer is
    // cleared in the same frame and the stroke never flickers.
    if (!draft.current) {
      const live = liveRef.current;
      if (live) beginPaint(live);
      liveBounds.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, size, screenScale, dragPreview, selectedId, multiSelectedIds]);

  // Client (screen) and content coordinates differ by the chart's
  // magnification as well as its offset — see screenScaleOf.
  const clientToContent = (clientX: number, clientY: number): { x: number; y: number } => {
    const wrap = wrapperRef.current!;
    const rect = wrap.getBoundingClientRect();
    const k = screenScaleOf(wrap);
    return { x: (clientX - rect.left) / k, y: (clientY - rect.top) / k };
  };
  const contentToClient = (p: { x: number; y: number }): { clientX: number; clientY: number } => {
    const wrap = wrapperRef.current!;
    const rect = wrap.getBoundingClientRect();
    const k = screenScaleOf(wrap);
    return { clientX: rect.left + p.x * k, clientY: rect.top + p.y * k };
  };
  const anchorAtContent = (p: { x: number; y: number }) => {
    const handle = scoreRef?.current;
    if (!handle || !wrapperRef.current) return undefined;
    const c = contentToClient(p);
    return handle.anchorAtClientPoint(c.clientX, c.clientY) ?? undefined;
  };

  // Reprojection: silently re-derives every anchored pin/mark/stroke's
  // on-screen position from the score's current layout after a
  // transpose-triggered re-render — see MxlScoreHandle.clientPointForAnchor.
  // Not a user edit, so it goes through `onReproject`, not `onCommit` (no
  // undo-history entry).
  useEffect(() => {
    const handle = scoreRef?.current;
    const wrapperEl = wrapperRef.current;
    if (!handle || !wrapperEl || reprojectSignal === undefined) return;
    const toContent = (client: { clientX: number; clientY: number }) => clientToContent(client.clientX, client.clientY);
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

  const toContentPoint = (e: React.PointerEvent): { x: number; y: number } => clientToContent(e.clientX, e.clientY);

  // Same conversion as toContentPoint, but from raw client coordinates
  // rather than a PointerEvent — ShapeHandles' rotate handle needs this to
  // compute an angle from the shape's center, not just a delta.
  const toContent = (clientX: number, clientY: number): { x: number; y: number } => clientToContent(clientX, clientY);

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
    const k = screenScaleOf(wrap);
    return Array.from(wrap.querySelectorAll<HTMLElement>(".chart-line")).flatMap((line) => {
      const r = line.getBoundingClientRect();
      const under = (r.bottom - top) / k;
      const over = (r.top - top) / k;
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

  /** Cancels whatever the first finger started, when a second finger turns
   * the gesture into a scroll. */
  const abortGesture = () => {
    activePointer.current = null;
    pendingTap.current = null;
    placeStart.current = null;
    setPlaceGhost(null);
    const g = selectGesture.current;
    if (g && g.kind === "press") clearTimeout(g.timer);
    selectGesture.current = null;
    setDragPreview(null);
    setBox(null);
    clearSnap();
    draft.current = null;
    if (liveRef.current) beginPaint(liveRef.current);
    liveBounds.current = null;
  };

  const centroid = () => {
    const pts = [...touches.current.values()];
    return { x: pts.reduce((a, q) => a + q.x, 0) / pts.length, y: pts.reduce((a, q) => a + q.y, 0) / pts.length };
  };

  /** Two fingers scroll the chart while any tool is active; one finger
   * keeps drawing. Returns true when the event belongs to a two-finger
   * scroll and the tool should ignore it. */
  const trackTouch = (e: React.PointerEvent, phase: "down" | "move" | "up"): boolean => {
    if (e.pointerType !== "touch") return false;
    const t = touches.current;
    if (phase === "down") {
      // A primary touch starts a new sequence: anything still tracked is a
      // finger whose up event was lost.
      if (e.isPrimary) {
        t.clear();
        twoFingerPan.current = null;
      }
      t.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (t.size === 2 && !twoFingerPan.current) {
        abortGesture();
        twoFingerPan.current = centroid();
        capture(e);
      }
      return twoFingerPan.current !== null;
    }
    if (phase === "move") {
      if (!t.has(e.pointerId)) return false;
      t.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const last = twoFingerPan.current;
      if (!last) return false;
      if (t.size >= 2) {
        const c = centroid();
        const scroller = wrapperRef.current && scrollParentOf(wrapperRef.current);
        if (scroller) {
          scroller.scrollTop -= c.y - last.y;
          scroller.scrollLeft -= c.x - last.x;
        }
        twoFingerPan.current = c;
      }
      return true;
    }
    t.delete(e.pointerId);
    if (!twoFingerPan.current) return false;
    // The scroll lasts until every finger is up, so the last one lifting
    // doesn't then draw.
    if (t.size === 0) twoFingerPan.current = null;
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || scrollMode) return;
    e.stopPropagation();
    if (trackTouch(e, "down")) return;
    // With a note or text field open, a tap anywhere else only closes it.
    // The document-level listener below usually got there first.
    if (closedBy.current === e.nativeEvent || noteEditRef.current || textEditRef.current) {
      e.preventDefault();
      closeField();
      return;
    }
    const p = toContentPoint(e);
    if (tool === "eraser" || tool === "pin" || tool === "text") {
      e.preventDefault();
      capture(e);
      activePointer.current = e.pointerId;
      pendingTap.current = p;
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
    if (tool === "notation" || tool === "shapes") {
      capture(e);
      activePointer.current = e.pointerId;
      placeStart.current = p;
      // Notation stamps follow the finger until release, so they can be
      // lined up (and snapped) before they land.
      if (tool !== "shapes") setPlaceGhost({ x: p.x, y: snapY(p.y, armedHalfH()) });
      return;
    }
    capture(e);
    activePointer.current = e.pointerId;
    const style = tool === "highlighter" ? highlighterStyle : penStyle;
    // Anchors to the score's measures are worked out once, on release (see
    // anchorStroke) — per point while drawing, the measure search made every
    // movement slower.
    draft.current = {
      id: `stroke-${Date.now()}`,
      tool,
      points: [p],
      color: style.color,
      size: style.size,
      opacity: style.opacity,
    };
    paintLive();
  };

  /** Repaints the live layer with the stroke in progress, at most once per
   * frame. */
  const paintLive = () => {
    if (liveFrame.current !== null) return;
    liveFrame.current = requestAnimationFrame(() => {
      liveFrame.current = null;
      const live = liveRef.current;
      const d = draft.current;
      const ctx = live?.getContext("2d");
      if (!live || !ctx || !d) return;
      // Clear only around the stroke (and where a rectangle stroke was last
      // frame): wiping the whole page-sized layer every frame is most of the
      // cost on a high-density tablet screen.
      const pad = (d.size ?? STROKE_WIDTH) + 4;
      const b = objectBounds(d);
      const area = unionBounds([{ left: b.left - pad, top: b.top - pad, right: b.right + pad, bottom: b.bottom + pad }, ...(liveBounds.current ? [liveBounds.current] : [])])!;
      liveBounds.current = area;
      const scale = live.width / Math.max(live.clientWidth, 1);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(area.left, area.top, area.right - area.left, area.bottom - area.top);
      drawStroke(ctx, d, live);
    });
  };

  /** Gives a finished stroke on a score one measure anchor per point, so
   * it follows the music through a transpose. All-or-nothing: if any point
   * can't anchor (the score isn't ready), the stroke stays pixel-only. */
  const anchorStroke = (stroke: Stroke): Stroke => {
    if (!scoreRef?.current || !wrapperRef.current) return stroke;
    const anchors = stroke.points.map((pt) => anchorAtContent(pt));
    return anchors.every((a) => a) ? { ...stroke, anchors: anchors as NonNullable<Stroke["anchors"]> } : stroke;
  };

  /** A tap with the Sticky note or Text tool: types into the note or text
   * under it, or starts a new one there. */
  const placeAt = (p: { x: number; y: number }) => {
    const hit = annotations.find((a) => a.id === hitsAt(p, annotations, SELECT_HIT_RADIUS)[0]);
    const editable = hit && (tool === "pin" ? (isPin(hit) ? hit : null) : isFreeText(hit) ? hit : null);
    if (editable) {
      startInlineEdit(editable);
      return;
    }
    if (tool === "pin") {
      const x = Math.max(0, Math.min(p.x, size.width - NOTE_WIDTH));
      const y = Math.max(0, Math.min(p.y, size.height - NOTE_HEIGHT));
      const draft: Pin = {
        id: `pin-${Date.now()}`,
        kind: "pin",
        position: { x, y },
        text: "",
        color: noteColor,
        anchor: anchorAtContent({ x, y }),
      };
      openNote({ id: draft.id, isNew: true, draft });
      return;
    }
    setTextEdit({
      id: `mark-${Date.now()}`,
      isNew: true,
      x: Math.max(0, Math.min(p.x, size.width - 40)),
      y: snapY(p.y, markStyle.size * 0.9),
      centered: false,
      color: markStyle.color,
      size: markStyle.size,
      initial: "",
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || scrollMode) return;
    if (trackTouch(e, "move")) {
      e.stopPropagation();
      return;
    }
    if (activePointer.current !== e.pointerId) return;
    e.stopPropagation();
    const p = toContentPoint(e);
    if (tool === "eraser") {
      // Starts erasing once the finger moves, including where it went down.
      const start = pendingTap.current;
      if (start) {
        if (Math.hypot(p.x - start.x, p.y - start.y) <= TAP_THRESHOLD) return;
        pendingTap.current = null;
        eraseAt(start);
      }
      eraseAt(p);
      return;
    }
    if (tool === "pin" || tool === "text") {
      const start = pendingTap.current;
      // A drag isn't a tap: nothing is placed.
      if (start && Math.hypot(p.x - start.x, p.y - start.y) > TAP_THRESHOLD) pendingTap.current = null;
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
      // Moving a selection repaints the canvas, so do it once per frame.
      if (liveFrame.current === null) {
        liveFrame.current = requestAnimationFrame(() => {
          liveFrame.current = null;
          const g = selectGesture.current;
          if (g && g.kind === "drag") setDragPreview({ ids: g.ids, dx: g.dx, dy: g.dy });
        });
      }
      return;
    }
    if (tool === "notation") {
      if (placeStart.current) setPlaceGhost({ x: p.x, y: snapY(p.y, armedHalfH()) });
      return;
    }
    if (tool === "shapes") return;
    const d = draft.current;
    if (!d) return;
    if (tool === "square") {
      d.points = [d.points[0], p];
    } else {
      // Every sample the screen reported since the last event, not just the
      // latest: a fast stroke otherwise keeps one point per frame, and the
      // curve through those sparse points cuts corners.
      const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
      if (samples.length > 0) {
        for (const c of samples) d.points.push(clientToContent(c.clientX, c.clientY));
      } else {
        d.points.push(p);
      }
    }
    paintLive();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!interactive) return;
    if (trackTouch(e, "up")) return;
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    const p = toContentPoint(e);

    if (tool === "eraser" || tool === "pin" || tool === "text") {
      const start = pendingTap.current;
      pendingTap.current = null;
      if (!start) return;
      if (tool === "eraser") eraseAt(start);
      else placeAt(start);
      return;
    }

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
        selectMany(annotations.filter((a) => boundsIntersect(objectBounds(a), rect)).map((a) => a.id));
        return;
      }
      if (g.kind === "drag") {
        if (Math.hypot(g.dx, g.dy) <= TAP_THRESHOLD) return;
        onCommit(
          annotations.map((a) => {
            if (!g.ids.includes(a.id)) return a;
            const moved = translateObject(a, g.dx, g.dy);
            // Marks and notes on a score re-anchor to the measure under their
            // new spot; strokes stay pixel-positioned once moved.
            if ((isMark(moved) || isPin(moved)) && scoreRef?.current) {
              return { ...moved, anchor: anchorAtContent(moved.position) };
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
      // A note or plain text: the first tap selects it, a tap on it once
      // it's selected types into it. Notes are opaque, so a tap on one
      // never cycles down to whatever is hidden underneath.
      const top = annotations.find((a) => a.id === g.hits[0]);
      if (top && (isPin(top) || (g.hits.length === 1 && isFreeText(top)))) {
        lastTap.current = null;
        if (selectedId === top.id && multiSelectedIds.length === 0) startInlineEdit(top);
        else selectOnly(top.id);
        return;
      }
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

    if (tool === "notation" || tool === "shapes") {
      const start = placeStart.current;
      const ghost = placeGhost;
      placeStart.current = null;
      setPlaceGhost(null);
      clearSnap();
      if (!start) return;
      if (tool === "shapes" && Math.hypot(p.x - start.x, p.y - start.y) > TAP_THRESHOLD) return;
      const at = tool === "shapes" ? start : ghost ?? p;
      const anchor = anchorAtContent(at);
      const id = `mark-${Date.now()}`;
      if (tool === "shapes") {
        const mark: ShapeMark = { id, kind: "shape", position: start, shapeId: armedShape, color: shapeStyle.color, size: shapeStyle.size, anchor };
        onCommit([...annotations, mark]);
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

    const finished = draft.current;
    draft.current = null;
    if (finished && finished.points.length > 0) {
      onCommit([...annotations, anchorStroke(simplifyStroke(finished))]);
    } else if (liveRef.current) {
      beginPaint(liveRef.current);
      liveBounds.current = null;
    }
  };

  // ---------- sticky notes and text fields ----------
  const openNote = (edit: NoteEdit) => {
    setTextEdit(null);
    setNoteEdit(edit);
  };

  const startInlineEdit = (obj: Pin | TextMark) => {
    if (isPin(obj)) {
      openNote({ id: obj.id, isNew: false });
      return;
    }
    setNoteEdit(null);
    setTextEdit({ id: obj.id, isNew: false, x: obj.position.x, y: obj.position.y, centered: true, color: obj.color, size: obj.size, initial: obj.text });
  };

  const finishNote = (edit: NoteEdit, raw: string) => {
    const text = raw.replace(/\s+$/, "");
    if (edit.isNew) {
      // A note left blank is dropped rather than kept empty.
      if (text.trim() && edit.draft) onCommit([...annotations, { ...edit.draft, text }]);
      return;
    }
    const current = annotations.find((a): a is Pin => a.id === edit.id && isPin(a));
    if (!current) return;
    if (!text.trim()) {
      onCommit(annotations.filter((a) => a.id !== edit.id));
      selectOnly(null);
    } else if (text !== current.text) {
      onCommit(annotations.map((a) => (a.id === edit.id ? { ...current, text } : a)));
    }
  };

  const finishText = (edit: TextEdit, raw: string, rect: DOMRect | undefined) => {
    clearSnap();
    const text = raw.replace(/\s+/g, " ").trim();
    if (edit.isNew) {
      if (!text) return;
      // Centre the mark on the field as it was drawn, so it lands exactly
      // where it was typed.
      const at = rect && wrapperRef.current ? clientToContent(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: edit.x, y: edit.y };
      const anchor = anchorAtContent(at);
      const mark: TextMark = { id: edit.id, kind: "text", position: at, text, color: edit.color, size: edit.size, anchor };
      onCommit([...annotations, mark]);
      return;
    }
    const current = annotations.find((a): a is TextMark => a.id === edit.id && isMark(a) && a.kind === "text");
    if (!current) return;
    if (!text) {
      onCommit(annotations.filter((a) => a.id !== edit.id));
      selectOnly(null);
    } else if (text !== current.text) {
      onCommit(annotations.map((a) => (a.id === edit.id ? { ...current, text } : a)));
    }
  };

  /** Commits whichever field is open. Safe to call more than once. */
  const closeField = () => {
    const el = fieldRef.current;
    const note = noteEditRef.current;
    const text = textEditRef.current;
    if (note) {
      setNoteEdit(null);
      finishNote(note, el instanceof HTMLTextAreaElement ? el.value : "");
    } else if (text) {
      setTextEdit(null);
      finishText(text, el ? el.innerText : "", el?.getBoundingClientRect());
    }
  };

  const onFieldBlur = () => {
    // The tap that opened the field can still move focus off it on some
    // WebViews; take focus back rather than closing a field that was never
    // really left.
    if (Date.now() - fieldOpenedAt.current < 350) {
      setTimeout(() => fieldRef.current?.focus(), 0);
      return;
    }
    closeField();
  };

  // Focus a newly opened field inside the same tap, so the keyboard comes
  // up, with the caret after any existing text.
  const openFieldId = noteEdit?.id ?? textEdit?.id ?? null;
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!openFieldId || !el) return;
    fieldOpenedAt.current = Date.now();
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      el.setSelectionRange(el.value.length, el.value.length);
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [openFieldId]);

  // Keeps the open field above the on-screen keyboard (and the floating tool
  // bar over it) by scrolling the chart's pane. visualViewport reports the
  // area the keyboard leaves visible on Android and iOS WebViews.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!openFieldId || !vv) return;
    const keepVisible = () => {
      const el = fieldRef.current;
      if (!el) return;
      const over = el.getBoundingClientRect().bottom - (vv.offsetTop + vv.height - KEYBOARD_CLEARANCE);
      if (over <= 0) return;
      const scroller = scrollParentOf(el);
      if (scroller) scroller.scrollTop += over;
    };
    const timer = setTimeout(keepVisible, 300);
    vv.addEventListener("resize", keepVisible);
    return () => {
      clearTimeout(timer);
      vv.removeEventListener("resize", keepVisible);
    };
  }, [openFieldId]);

  // A tap anywhere outside the open field closes it: on the chart, on the
  // tool bar (so Done and Undo see the committed text), or on parts of the
  // stage that swallow the tap without moving focus. Remembers the event so
  // the chart's own pointerdown doesn't treat the same tap as a new placement.
  const closedBy = useRef<Event | null>(null);
  const closeFieldRef = useRef(closeField);
  closeFieldRef.current = closeField;
  useEffect(() => {
    if (!openFieldId) return;
    const onDown = (e: PointerEvent) => {
      const el = fieldRef.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      closedBy.current = e;
      closeFieldRef.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [openFieldId]);

  // Switching tools, leaving draw mode or pausing for scroll closes the
  // field the same way a tap outside does.
  useEffect(() => {
    closeField();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool, interactive, scrollMode]);

  const wrapWidth = wrapperRef.current?.clientWidth ?? size.width;
  const pixelScale = canvasScale(size, screenScale);
  // Canvas ignores pointer events for tools that place/select via the
  // transparent overlay below (pin/select/text/notation/shapes) so it
  // doesn't also try to start an ink stroke.
  const overlayTool = tool === "pin" || tool === "select" || tool === "text" || tool === "notation" || tool === "shapes";

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <div ref={contentRef}>{children}</div>
      <canvas
        ref={canvasRef}
        width={Math.round(size.width * pixelScale)}
        height={Math.round(size.height * pixelScale)}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: size.height,
          touchAction: interactive && !scrollMode ? "none" : "auto",
          pointerEvents: interactive && !scrollMode && !overlayTool ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <canvas
        ref={liveRef}
        width={Math.round(size.width * pixelScale)}
        height={Math.round(size.height * pixelScale)}
        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: size.height, pointerEvents: "none" }}
      />
      {/* Placement/select tools still need to know where on the chart was
          tapped, even though the canvas itself ignores pointer events while
          one of them is active (so it doesn't also try to start a stroke) —
          this transparent layer catches the gesture instead. */}
      {interactive && overlayTool && !scrollMode && (
        <div
          style={{ position: "absolute", inset: 0, touchAction: "none" }}
          // This layer never takes focus: without this, the mousedown that
          // follows a tap would pull focus off the field that tap just opened.
          onMouseDown={(e) => e.preventDefault()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      )}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {marksOf(annotations).map((mark) => {
          let displayMark: TextMark | ShapeMark =
            mark.kind === "shape" && shapePreview && shapePreview.id === mark.id
              ? { ...mark, ...shapePreview }
              : mark;
          if (dragPreview && dragPreview.ids.includes(mark.id)) displayMark = translateObject(displayMark, dragPreview.dx, dragPreview.dy);
          if (textEdit && textEdit.id === mark.id) return null;
          return (
            <Fragment key={mark.id}>
              <MarkBadge mark={displayMark} selected={selection.includes(mark.id)} />
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
        {/* Notes draw above ink and marks, like paper stuck on the page. */}
        {annotations.filter(isPin).map((pin) => {
          let shown: Pin = notePreview && notePreview.id === pin.id ? { ...pin, width: notePreview.width, height: notePreview.height } : pin;
          if (dragPreview && dragPreview.ids.includes(pin.id)) shown = translateObject(shown, dragPreview.dx, dragPreview.dy);
          const editing = noteEdit?.id === pin.id;
          return (
            <Fragment key={pin.id}>
              <StickyNote
                pin={shown}
                selected={selection.includes(pin.id) && !editing}
                editing={editing}
                fieldRef={fieldRef}
                onBlur={onFieldBlur}
                onClose={closeField}
              />
              {interactive && tool === "select" && selectedId === pin.id && multiSelectedIds.length === 0 && !dragPreview && !editing && (
                <NoteHandle
                  pin={shown}
                  maxRight={size.width}
                  maxBottom={size.height}
                  onPreview={(p) => setNotePreview(p ? { id: pin.id, ...p } : null)}
                  onResize={(width, height) => onCommit(annotations.map((a) => (a.id === pin.id ? { ...a, width, height } : a)))}
                />
              )}
            </Fragment>
          );
        })}
        {noteEdit?.isNew && noteEdit.draft && (
          <StickyNote pin={noteEdit.draft} selected={false} editing fieldRef={fieldRef} onBlur={onFieldBlur} onClose={closeField} />
        )}
        {textEdit && (
          <div
            ref={(el) => {
              fieldRef.current = el;
            }}
            className="text-field"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-label="Text"
            style={{
              left: textEdit.x,
              top: textEdit.y,
              transform: textEdit.centered ? "translate(-50%, -50%)" : "translateY(-50%)",
              color: textEdit.color,
              fontSize: textEdit.size,
              maxWidth: Math.max(80, wrapWidth - (textEdit.centered ? 0 : textEdit.x)),
            }}
            onBlur={onFieldBlur}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                closeField();
              }
            }}
            onPaste={(e) => {
              // Plain text only: a pasted rich-text run would carry its own
              // fonts and colours into the field.
              e.preventDefault();
              document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s+/g, " "));
            }}
          >
            {textEdit.initial}
          </div>
        )}
        {placeGhost && tool === "notation" && (
          <MarkBadge
            mark={{
              id: "ghost",
              kind: "text",
              position: placeGhost,
              text: armedSymbol.glyph ?? "",
              symbolId: armedSymbol.id,
              color: markStyle.color,
              size: markStyle.size,
            }}
            selected={false}
          />
        )}
        {guideY !== null && <div className="snap-guide" style={{ top: guideY }} />}
        {box && <div className="select-box" style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }} />}
        {selection.length > 0 && !dragPreview && !box && !openFieldId && (
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

/** A text, notation or shape mark. Purely visual: every tool hit-tests
 * marks through the canvas or its overlay instead (so a repeated tap can
 * reach a mark stacked under this one, and the eraser can wait to see
 * whether a second finger turns the touch into a scroll). */
function MarkBadge({ mark, selected }: { mark: TextMark | ShapeMark; selected: boolean }) {

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
        pointerEvents: "none",
        userSelect: "none",
        touchAction: "none",
        whiteSpace: "nowrap",
        outline: selected ? "2px solid var(--acc-deep)" : "none",
        outlineOffset: selected ? 4 : 0,
        borderRadius: selected ? 6 : 0,
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
    startX: number;
    startY: number;
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
          const start = toContent(e.clientX, e.clientY);
          resizeDrag.current = {
            startX: start.x,
            startY: start.y,
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
          const p = toContent(e.clientX, e.clientY);
          const rawDx = p.x - d.startX;
          const rawDy = p.y - d.startY;
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

/** A sticky note: always shows its text, clipped with a fade when it runs
 * past the box. Hit-tested by the canvas overlay like every other object,
 * so it takes pointer events only while its text is being edited. */
function StickyNote({
  pin,
  selected,
  editing,
  fieldRef,
  onBlur,
  onClose,
}: {
  pin: Pin;
  selected: boolean;
  editing: boolean;
  fieldRef: React.MutableRefObject<HTMLTextAreaElement | HTMLDivElement | null>;
  onBlur: () => void;
  onClose: () => void;
}) {
  const b = noteBox(pin);
  const c = stickyColor(pin);
  return (
    <div
      className={"sticky-note" + (selected ? " selected" : "")}
      style={
        {
          left: b.left,
          top: b.top,
          width: b.width,
          height: b.height,
          "--note-fill": c.fill,
          "--note-edge": c.edge,
          pointerEvents: editing ? "auto" : "none",
        } as React.CSSProperties
      }
      onPointerDown={editing ? (e) => e.stopPropagation() : undefined}
    >
      {editing ? (
        <textarea
          ref={(el) => {
            fieldRef.current = el;
          }}
          defaultValue={pin.text}
          placeholder="Type a note"
          aria-label="Note text"
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
      ) : (
        <>
          {pin.text}
          <div className="sticky-note-fade" />
        </>
      )}
    </div>
  );
}

/** Bottom-right resize handle for the selected sticky note. Reports a live
 * size while dragging and commits it on release, like ShapeHandles. */
function NoteHandle({
  pin,
  maxRight,
  maxBottom,
  onPreview,
  onResize,
}: {
  pin: Pin;
  maxRight: number;
  maxBottom: number;
  onPreview: (size: { width: number; height: number } | null) => void;
  onResize: (width: number, height: number) => void;
}) {
  const drag = useRef<{ x: number; y: number; k: number; width: number; height: number; current: { width: number; height: number } } | null>(null);
  const b = noteBox(pin);
  return (
    <div
      className="note-handle"
      aria-label="Resize note"
      style={{ left: b.left + b.width, top: b.top + b.height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        // Pointer travel is in screen pixels; the note is sized in content
        // pixels (see screenScaleOf).
        const k = screenScaleOf(e.currentTarget.offsetParent as HTMLElement | null);
        drag.current = { x: e.clientX, y: e.clientY, k, width: b.width, height: b.height, current: { width: b.width, height: b.height } };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const width = Math.max(NOTE_MIN_WIDTH, Math.min(d.width + (e.clientX - d.x) / d.k, Math.max(NOTE_MIN_WIDTH, maxRight - b.left)));
        const height = Math.max(NOTE_MIN_HEIGHT, Math.min(d.height + (e.clientY - d.y) / d.k, Math.max(NOTE_MIN_HEIGHT, maxBottom - b.top)));
        d.current = { width, height };
        onPreview(d.current);
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        onPreview(null);
        if (d.current.width !== d.width || d.current.height !== d.height) onResize(d.current.width, d.current.height);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onPreview(null);
      }}
    />
  );
}
