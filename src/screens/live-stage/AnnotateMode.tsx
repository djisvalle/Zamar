import { useRef, useState } from "react";
import { useStore } from "../../state/store";
import { ChordChart } from "../../components/ChordChart";
import { Icon, type IconName } from "../../components/Icon";
import { Sheet } from "../../components/Overlays";
import type { AnnotationItem, AnnotationTool, InkAnnotation, ShapeAnnotation, ShapeId, TextAnnotation } from "../../state/types";

interface Point {
  x: number;
  y: number;
}

/** Text and shape stamps share one drag/tap/color/size/duplicate/delete code
 * path (see `AnnotationMark`/`EditMarkSheet`) — only their glyph differs. */
type MarkAnnotation = TextAnnotation | ShapeAnnotation;

interface NotationSymbol {
  id: string;
  label: string;
  glyph?: string;
  icon?: IconName;
}

// Curated starter set — the full multi-page notation library (dynamics,
// ornaments, clefs, noteheads, etc.) is a separate follow-up pass.
const NOTATION_SYMBOLS: NotationSymbol[] = [
  { id: "pp", label: "Pianissimo", glyph: "pp" },
  { id: "p", label: "Piano", glyph: "p" },
  { id: "mp", label: "Mezzo-piano", glyph: "mp" },
  { id: "mf", label: "Mezzo-forte", glyph: "mf" },
  { id: "f", label: "Forte", glyph: "f" },
  { id: "ff", label: "Fortissimo", glyph: "ff" },
  { id: "sfz", label: "Sforzando", glyph: "sfz" },
  { id: "accent", label: "Accent", glyph: ">" },
  { id: "staccato", label: "Staccato", glyph: "•" },
  { id: "fermata", label: "Fermata", icon: "fermata" },
  { id: "flat", label: "Flat", glyph: "♭" },
  { id: "sharp", label: "Sharp", glyph: "♯" },
  { id: "natural", label: "Natural", glyph: "♮" },
  { id: "trill", label: "Trill", glyph: "tr" },
  { id: "up-bow", label: "Up bow", icon: "bow-up" },
  { id: "down-bow", label: "Down bow", icon: "bow-down" },
];

interface ShapeDef {
  id: ShapeId;
  label: string;
}

const SHAPE_LIST: ShapeDef[] = [
  { id: "slur", label: "Slur" },
  { id: "hairpin-cresc", label: "Crescendo" },
  { id: "hairpin-dim", label: "Decrescendo" },
  { id: "arrow", label: "Arrow" },
  { id: "line", label: "Line" },
  { id: "bracket", label: "Bracket" },
  { id: "rect-outline", label: "Rectangle" },
  { id: "rect-fill", label: "Filled rectangle" },
  { id: "ellipse-outline", label: "Ellipse" },
  { id: "ellipse-fill", label: "Filled ellipse" },
];
const SHAPE_ASPECT = 60 / 22;

// Two swipeable 16-swatch pages, shared by every color-picking control.
const PALETTE_PAGES: string[][] = [
  ["#1a1a1a", "#e63946", "#ffd400", "#2a6fdb", "#3fb950", "#4b3fd6", "#e08e0b", "#9aa0a6", "#cfd4d9", "#a3242c", "#c9a227", "#7ec8ff", "#2a9d5c", "#7c3fd6", "#7a4b2a", "#33383d"],
  ["#f4f1ea", "#ef5da8", "#f2c94c", "#4fd1ff", "#a9e8a0", "#a53fe0", "#e0b98a", "#8aa6e8", "#4d6fd1", "#2f8f8a", "#4fd1c5", "#7fb23a", "#3fd1e0", "#4a74d6", "#7fe0c6", "#2f8f5c"],
];

const TAP_THRESHOLD = 6;
const INK_HIT_RADIUS = 10;

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y + 0.01}`;
  }
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/** Maps a real stroke's own points into a small preview box, preserving
 * aspect ratio and centering — so an ink stroke's edit sheet shows *that*
 * stroke, not a generic sample. */
function fitPointsToBox(points: Point[], w: number, h: number, pad: number): string {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY, 4);
  const offX = (w - spanX * scale) / 2 - minX * scale;
  const offY = (h - spanY * scale) / 2 - minY * scale;
  return pointsToPath(points.map((p) => ({ x: p.x * scale + offX, y: p.y * scale + offY })));
}

/** Rough hit-test radius for an ink stroke, and a rough bounding box for a
 * text/shape mark — good enough for an eraser gesture in a mockup, not
 * pixel-exact glyph metrics. */
function eraserHits(pt: Point, items: AnnotationItem[], radius: number): Set<string> {
  const hits = new Set<string>();
  for (const item of items) {
    if (item.kind === "ink") {
      const hitR = radius + item.size / 2;
      if (item.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= hitR)) hits.add(item.id);
    } else if (item.kind === "shape") {
      const halfW = Math.max(radius, (item.size * SHAPE_ASPECT) / 2);
      const halfH = Math.max(radius, item.size / 2);
      if (Math.abs(pt.x - item.x) <= halfW && Math.abs(pt.y - item.y) <= halfH) hits.add(item.id);
    } else {
      const halfW = Math.max(radius, (item.text.length || 1) * item.size * 0.32);
      const halfH = Math.max(radius, item.size * 0.9);
      if (Math.abs(pt.x - item.x) <= halfW && Math.abs(pt.y - item.y) <= halfH) hits.add(item.id);
    }
  }
  return hits;
}

/** Topmost ink stroke under a point, for tap-to-edit/drag-to-move in the
 * select tool (text/shape marks handle their own hit-testing via their own
 * DOM nodes, so only ink strokes need this at the canvas level). */
function topInkHit(pt: Point, items: AnnotationItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "ink") continue;
    const hitR = INK_HIT_RADIUS + item.size / 2;
    if (item.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= hitR)) return item.id;
  }
  return null;
}

export function AnnotateMode({ song, onDone }: { song: { id: string; chordpro: string }; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const items = state.annotations[song.id] ?? [];
  const history = state.annotationHistory[song.id] ?? { past: [], future: [] };
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const [tool, setTool] = useState<AnnotationTool>("select");
  const [pen, setPen] = useState({ color: PALETTE_PAGES[0][0], size: 3, opacity: 1 });
  const [highlighter, setHighlighter] = useState({ color: PALETTE_PAGES[0][2], size: 16, opacity: 0.3 });
  const [markStyle, setMarkStyle] = useState({ color: PALETTE_PAGES[0][3], size: 20 });
  const [shapeStyle, setShapeStyle] = useState({ color: PALETTE_PAGES[0][0], size: 22 });
  const [eraserSize, setEraserSize] = useState(16);
  const [armedSymbol, setArmedSymbol] = useState<NotationSymbol>(NOTATION_SYMBOLS[0]);
  const [armedShape, setArmedShape] = useState<ShapeId>("hairpin-cresc");
  const [clearOpen, setClearOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [liveStroke, setLiveStroke] = useState<{ tool: "pen" | "highlighter"; points: Point[] } | null>(null);
  const [eraseTouched, setEraseTouched] = useState<Set<string>>(new Set());
  const [draggingInkId, setDraggingInkId] = useState<string | null>(null);
  const [inkDragOffset, setInkDragOffset] = useState<Point>({ x: 0, y: 0 });

  const contentRef = useRef<HTMLDivElement | null>(null);
  const pointerActive = useRef(false);
  const gestureStart = useRef<Point | null>(null);
  const idCounter = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${song.id}-${Date.now()}-${idCounter.current++}`;

  const commit = (nextItems: AnnotationItem[]) => dispatch({ type: "ANNOTATE_COMMIT", songId: song.id, items: nextItems });

  const contentPoint = (e: React.PointerEvent): Point => {
    const rect = contentRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const pt = contentPoint(e);
    if (tool === "select") {
      const hitId = topInkHit(pt, items);
      if (!hitId) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      gestureStart.current = pt;
      pointerActive.current = true;
      setDraggingInkId(hitId);
      setInkDragOffset({ x: 0, y: 0 });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    gestureStart.current = pt;
    pointerActive.current = true;
    if (tool === "pen" || tool === "highlighter") {
      setLiveStroke({ tool, points: [pt] });
    } else if (tool === "eraser") {
      setEraseTouched(eraserHits(pt, items, eraserSize));
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    const pt = contentPoint(e);
    if (tool === "select") {
      if (draggingInkId && gestureStart.current) {
        setInkDragOffset({ x: pt.x - gestureStart.current.x, y: pt.y - gestureStart.current.y });
      }
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      setLiveStroke((s) => (s ? { ...s, points: [...s.points, pt] } : s));
    } else if (tool === "eraser") {
      const hits = eraserHits(pt, items, eraserSize);
      if (hits.size > 0) setEraseTouched((prev) => new Set([...prev, ...hits]));
    }
  };

  const finishGesture = (e: React.PointerEvent) => {
    const pt = contentPoint(e);

    if (tool === "select") {
      if (!pointerActive.current || !draggingInkId) {
        pointerActive.current = false;
        gestureStart.current = null;
        return;
      }
      pointerActive.current = false;
      const id = draggingInkId;
      const offset = inkDragOffset;
      setDraggingInkId(null);
      setInkDragOffset({ x: 0, y: 0 });
      gestureStart.current = null;
      if (Math.hypot(offset.x, offset.y) > TAP_THRESHOLD) {
        commit(
          items.map((i) =>
            i.id === id && i.kind === "ink" ? { ...i, points: i.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) } : i
          )
        );
      } else {
        setEditingId(id);
      }
      return;
    }

    if (!pointerActive.current) {
      gestureStart.current = null;
      return;
    }
    pointerActive.current = false;
    const start = gestureStart.current;
    gestureStart.current = null;

    if (tool === "pen" || tool === "highlighter") {
      const stroke = liveStroke;
      setLiveStroke(null);
      if (stroke && stroke.points.length > 0) {
        const settings = tool === "pen" ? pen : highlighter;
        const item: InkAnnotation = {
          id: nextId("ink"),
          kind: "ink",
          tool,
          color: settings.color,
          size: settings.size,
          opacity: settings.opacity,
          points: stroke.points,
        };
        commit([...items, item]);
      }
      return;
    }
    if (tool === "eraser") {
      if (eraseTouched.size > 0) commit(items.filter((i) => !eraseTouched.has(i.id)));
      setEraseTouched(new Set());
      return;
    }
    if ((tool === "text" || tool === "notation" || tool === "shapes") && start) {
      if (Math.hypot(pt.x - start.x, pt.y - start.y) > TAP_THRESHOLD) return;
      if (tool === "text") {
        const item: TextAnnotation = {
          id: nextId("text"),
          kind: "text",
          text: "Note",
          color: markStyle.color,
          size: markStyle.size,
          x: start.x,
          y: start.y,
        };
        commit([...items, item]);
        setEditingId(item.id);
      } else if (tool === "notation") {
        const item: TextAnnotation = {
          id: nextId("sym"),
          kind: "text",
          text: armedSymbol.glyph ?? "",
          iconGlyph: armedSymbol.icon,
          symbolId: armedSymbol.id,
          color: markStyle.color,
          size: markStyle.size,
          x: start.x,
          y: start.y,
        };
        commit([...items, item]);
      } else {
        const item: ShapeAnnotation = {
          id: nextId("shape"),
          kind: "shape",
          shapeId: armedShape,
          color: shapeStyle.color,
          size: shapeStyle.size,
          x: start.x,
          y: start.y,
        };
        commit([...items, item]);
      }
    }
  };

  const onPointerCancel = () => {
    pointerActive.current = false;
    gestureStart.current = null;
    setLiveStroke(null);
    setEraseTouched(new Set());
    setDraggingInkId(null);
    setInkDragOffset({ x: 0, y: 0 });
  };

  const commitMove = (id: string, x: number, y: number) => {
    commit(items.map((i) => (i.id === id && i.kind !== "ink" ? { ...i, x, y } : i)));
  };

  const duplicateInk = (item: InkAnnotation) => {
    const copy: InkAnnotation = { ...item, id: nextId("ink"), points: item.points.map((p) => ({ x: p.x + 14, y: p.y + 14 })) };
    commit([...items, copy]);
    setEditingId(copy.id);
  };

  const duplicateMark = (item: MarkAnnotation) => {
    const copy: MarkAnnotation = { ...item, id: nextId(item.kind === "shape" ? "shape" : item.symbolId ? "sym" : "text"), x: item.x + 16, y: item.y + 16 };
    commit([...items, copy]);
    setEditingId(copy.id);
  };

  const editingInk = items.find((i): i is InkAnnotation => i.id === editingId && i.kind === "ink");
  const editingMark = items.find((i): i is MarkAnnotation => i.id === editingId && (i.kind === "text" || i.kind === "shape"));
  const visibleItems = eraseTouched.size > 0 ? items.filter((i) => !eraseTouched.has(i.id)) : items;
  const inkItems = visibleItems.filter((i): i is InkAnnotation => i.kind === "ink");
  const markItems = visibleItems.filter((i): i is MarkAnnotation => i.kind === "text" || i.kind === "shape");

  return (
    <div className="screen">
      <div className="hdr tinted">
        <button className="hdr-btn" onClick={() => dispatch({ type: "ANNOTATE_UNDO", songId: song.id })} disabled={!canUndo} aria-label="Undo">
          <Icon name="undo" size={19} strokeWidth={2} />
        </button>
        <button className="hdr-btn" onClick={() => dispatch({ type: "ANNOTATE_REDO", songId: song.id })} disabled={!canRedo} aria-label="Redo">
          <Icon name="redo" size={19} strokeWidth={2} />
        </button>
        <span className="flex-1 text-center muted" style={{ fontSize: 12 }}>
          Annotating
        </span>
        <button className="hdr-btn" onClick={() => setClearOpen(true)} aria-label="Clear annotations">
          <Icon name="trash" size={18} strokeWidth={1.9} />
        </button>
        <button className="hdr-action" onClick={onDone}>
          Done
        </button>
      </div>

      <div className="flex-1 hidden-scroll" style={{ overflowY: "auto" }}>
        <div
          ref={contentRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishGesture}
          onPointerCancel={onPointerCancel}
          style={{
            position: "relative",
            minHeight: "100%",
            padding: "12px 14px 40px",
            display: "flex",
            flexDirection: "column",
            gap: 11,
            fontSize: 13,
            lineHeight: 1.35,
            touchAction: tool === "select" ? "pan-y" : "none",
          }}
        >
          <ChordChart chordpro={song.chordpro} hideChords />

          <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            {inkItems.map((item) => {
              const pts = item.id === draggingInkId ? item.points.map((p) => ({ x: p.x + inkDragOffset.x, y: p.y + inkDragOffset.y })) : item.points;
              return (
                <path
                  key={item.id}
                  d={pointsToPath(pts)}
                  stroke={item.color}
                  strokeOpacity={item.opacity}
                  strokeWidth={item.size}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={item.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
                />
              );
            })}
            {liveStroke && (
              <path
                d={pointsToPath(liveStroke.points)}
                stroke={liveStroke.tool === "pen" ? pen.color : highlighter.color}
                strokeOpacity={liveStroke.tool === "pen" ? pen.opacity : highlighter.opacity}
                strokeWidth={liveStroke.tool === "pen" ? pen.size : highlighter.size}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={liveStroke.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
              />
            )}
          </svg>

          {markItems.map((item) => (
            <AnnotationMark key={item.id} item={item} tool={tool} onMoveEnd={commitMove} onTap={() => setEditingId(item.id)} />
          ))}
        </div>
      </div>

      <AnnotateDock
        tool={tool}
        onSelectTool={setTool}
        pen={pen}
        onPenChange={setPen}
        highlighter={highlighter}
        onHighlighterChange={setHighlighter}
        markStyle={markStyle}
        onMarkStyleChange={setMarkStyle}
        shapeStyle={shapeStyle}
        onShapeStyleChange={setShapeStyle}
        eraserSize={eraserSize}
        onEraserSizeChange={setEraserSize}
        armedSymbol={armedSymbol}
        onArmSymbol={setArmedSymbol}
        armedShape={armedShape}
        onArmShape={setArmedShape}
      />

      {editingInk && (
        <EditInkSheet
          item={editingInk}
          onColorChange={(color) => commit(items.map((i) => (i.id === editingInk.id ? { ...i, color } : i)))}
          onSizeChange={(size) => commit(items.map((i) => (i.id === editingInk.id ? { ...i, size } : i)))}
          onOpacityChange={(opacity) => commit(items.map((i) => (i.id === editingInk.id ? { ...i, opacity } : i)))}
          onDuplicate={() => duplicateInk(editingInk)}
          onDelete={() => {
            commit(items.filter((i) => i.id !== editingInk.id));
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}

      {editingMark && (
        <EditMarkSheet
          item={editingMark}
          onColorChange={(color) => commit(items.map((i) => (i.id === editingMark.id ? { ...i, color } : i)))}
          onSizeChange={(size) => commit(items.map((i) => (i.id === editingMark.id ? { ...i, size } : i)))}
          onTextChange={
            editingMark.kind === "text" && !editingMark.symbolId
              ? (text) => commit(items.map((i) => (i.id === editingMark.id ? { ...i, text } : i)))
              : undefined
          }
          onDuplicate={() => duplicateMark(editingMark)}
          onDelete={() => {
            commit(items.filter((i) => i.id !== editingMark.id));
            setEditingId(null);
          }}
          onClose={() => setEditingId(null)}
        />
      )}

      {clearOpen && (
        <Sheet onClose={() => setClearOpen(false)}>
          <div className="sheet-title">Clear annotations</div>
          <div className="muted" style={{ fontSize: 11, marginTop: -6 }}>
            Both options can be undone with Undo.
          </div>
          <button
            className="sheet-row"
            onClick={() => {
              dispatch({ type: "ANNOTATE_CLEAR_PAGE", songId: song.id });
              setClearOpen(false);
            }}
          >
            <span>Clear this page</span>
          </button>
          <button
            className="sheet-row"
            style={{ color: "#8c3b3b", fontWeight: 600 }}
            onClick={() => {
              dispatch({ type: "ANNOTATE_CLEAR_ALL" });
              setClearOpen(false);
            }}
          >
            <span>Clear all pages</span>
          </button>
          <button className="sheet-row" onClick={() => setClearOpen(false)}>
            <span>Cancel</span>
          </button>
        </Sheet>
      )}
    </div>
  );
}

function ShapeGlyph({ shapeId, color, size }: { shapeId: ShapeId; color: string; size: number }) {
  const w = size * SHAPE_ASPECT;
  const common = { stroke: color, strokeWidth: 2.5, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg width={w} height={size} viewBox="0 0 60 22" style={{ display: "block" }}>
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

function renderMarkGlyph(item: MarkAnnotation) {
  if (item.kind === "shape") return <ShapeGlyph shapeId={item.shapeId} color={item.color} size={item.size} />;
  if (item.iconGlyph) return <Icon name={item.iconGlyph} size={item.size} strokeWidth={2} />;
  return item.text;
}

function AnnotationMark({
  item,
  tool,
  onMoveEnd,
  onTap,
}: {
  item: MarkAnnotation;
  tool: AnnotationTool;
  onMoveEnd: (id: string, x: number, y: number) => void;
  onTap: () => void;
}) {
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  const start = useRef<Point | null>(null);
  const moved = useRef(false);

  const onDown = (e: React.PointerEvent) => {
    if (tool !== "select") return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    if (Math.hypot(dx, dy) > 3) moved.current = true;
    setDrag({ dx, dy });
  };
  const onUp = (e: React.PointerEvent) => {
    if (!start.current) return;
    e.stopPropagation();
    if (moved.current && drag) {
      onMoveEnd(item.id, item.x + drag.dx, item.y + drag.dy);
    } else {
      onTap();
    }
    start.current = null;
    setDrag(null);
  };

  const x = item.x + (drag?.dx ?? 0);
  const y = item.y + (drag?.dy ?? 0);

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        color: item.color,
        fontSize: item.kind === "text" ? item.size : undefined,
        fontWeight: 700,
        fontFamily: "var(--font-heading)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: tool === "select" ? "grab" : "default",
        pointerEvents: tool === "select" ? "auto" : "none",
        userSelect: "none",
        touchAction: "none",
        whiteSpace: "nowrap",
      }}
    >
      {renderMarkGlyph(item)}
    </div>
  );
}

function AnnotateDock({
  tool,
  onSelectTool,
  pen,
  onPenChange,
  highlighter,
  onHighlighterChange,
  markStyle,
  onMarkStyleChange,
  shapeStyle,
  onShapeStyleChange,
  eraserSize,
  onEraserSizeChange,
  armedSymbol,
  onArmSymbol,
  armedShape,
  onArmShape,
}: {
  tool: AnnotationTool;
  onSelectTool: (t: AnnotationTool) => void;
  pen: { color: string; size: number; opacity: number };
  onPenChange: (v: { color: string; size: number; opacity: number }) => void;
  highlighter: { color: string; size: number; opacity: number };
  onHighlighterChange: (v: { color: string; size: number; opacity: number }) => void;
  markStyle: { color: string; size: number };
  onMarkStyleChange: (v: { color: string; size: number }) => void;
  shapeStyle: { color: string; size: number };
  onShapeStyleChange: (v: { color: string; size: number }) => void;
  eraserSize: number;
  onEraserSizeChange: (v: number) => void;
  armedSymbol: NotationSymbol;
  onArmSymbol: (s: NotationSymbol) => void;
  armedShape: ShapeId;
  onArmShape: (s: ShapeId) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface)", maxHeight: "58%", overflowY: "auto" }}>
      {tool === "pen" && <InkControls value={pen} onChange={onPenChange} sizeRange={[1, 14]} opacityRange={[0.3, 1]} />}
      {tool === "highlighter" && <InkControls value={highlighter} onChange={onHighlighterChange} sizeRange={[6, 34]} opacityRange={[0.1, 0.7]} />}
      {(tool === "text" || tool === "notation") && (
        <div style={{ padding: "9px 14px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
          {tool === "notation" && (
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
              {NOTATION_SYMBOLS.map((sym) => (
                <button
                  key={sym.id}
                  className={"chip" + (armedSymbol.id === sym.id ? " active" : "")}
                  style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, minWidth: 30, justifyContent: "center" }}
                  onClick={() => onArmSymbol(sym)}
                  aria-label={sym.label}
                >
                  {sym.icon ? <Icon name={sym.icon} size={13} strokeWidth={2} /> : sym.glyph}
                </button>
              ))}
            </div>
          )}
          <ColorGrid value={markStyle.color} onChange={(color) => onMarkStyleChange({ ...markStyle, color })} />
          <NumberField label="Size" value={markStyle.size} unit="pt" min={10} max={48} onChange={(size) => onMarkStyleChange({ ...markStyle, size })} />
        </div>
      )}
      {tool === "shapes" && (
        <div style={{ padding: "9px 14px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {SHAPE_LIST.map((s) => (
              <button
                key={s.id}
                className={"chip" + (armedShape === s.id ? " active" : "")}
                style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 10px" }}
                onClick={() => onArmShape(s.id)}
                aria-label={s.label}
              >
                <ShapeGlyph shapeId={s.id} color={armedShape === s.id ? "#ffffff" : "#8a8f98"} size={13} />
              </button>
            ))}
          </div>
          <ColorGrid value={shapeStyle.color} onChange={(color) => onShapeStyleChange({ ...shapeStyle, color })} />
          <NumberField label="Size" value={shapeStyle.size} unit="pt" min={12} max={48} onChange={(size) => onShapeStyleChange({ ...shapeStyle, size })} />
        </div>
      )}
      {tool === "eraser" && (
        <div style={{ padding: "10px 14px 4px" }}>
          <NumberField label="Eraser size" value={eraserSize} unit="pt" min={8} max={40} onChange={onEraserSizeChange} />
        </div>
      )}
      {tool === "select" && (
        <div className="muted" style={{ padding: "10px 14px 2px", fontSize: 11 }}>
          Tap a stroke or mark to edit it, drag to move it.
        </div>
      )}

      <div style={{ padding: "8px 4px 10px", display: "flex", alignItems: "center" }}>
        <ToolButton icon="cursor" label="Select" active={tool === "select"} onClick={() => onSelectTool("select")} />
        <ToolButton icon="edit" label="Pen" active={tool === "pen"} onClick={() => onSelectTool("pen")} />
        <ToolButton icon="highlighter" label="Highlight" active={tool === "highlighter"} onClick={() => onSelectTool("highlighter")} />
        <ToolButton icon="text" label="Text" active={tool === "text"} onClick={() => onSelectTool("text")} />
        <ToolButton icon="music" label="Notation" active={tool === "notation"} onClick={() => onSelectTool("notation")} />
        <ToolButton icon="shapes" label="Shapes" active={tool === "shapes"} onClick={() => onSelectTool("shapes")} />
        <ToolButton icon="eraser" label="Eraser" active={tool === "eraser"} onClick={() => onSelectTool("eraser")} />
      </div>
    </div>
  );
}

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage: "repeating-conic-gradient(var(--line) 0% 25%, var(--surface) 0% 50%)",
  backgroundSize: "10px 10px",
};

function InkPreview({ color, size, opacity, points }: { color: string; size: number; opacity: number; points?: Point[] }) {
  const w = 92;
  const h = 58;
  const d = points && points.length > 1 ? fitPointsToBox(points, w, h, 9) : "M8 44 C 28 12, 54 52, 84 16";
  return (
    <div style={{ width: w, height: h, flex: "none", borderRadius: 9, overflow: "hidden", border: "1px solid var(--line)", ...CHECKER_STYLE }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${w} ${h}`}>
        <path d={d} stroke={color} strokeOpacity={opacity} strokeWidth={size} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function ColorGrid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [page, setPage] = useState(0);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0) return;
    setPage(Math.round(el.scrollLeft / el.clientWidth));
  };
  const goTo = (i: number) => {
    scrollRef.current?.scrollTo({ left: i * scrollRef.current.clientWidth, behavior: "smooth" });
  };

  return (
    <div>
      <div ref={scrollRef} onScroll={onScroll} style={{ display: "flex", overflowX: "auto", scrollSnapType: "x mandatory" }}>
        {PALETTE_PAGES.map((colors, pi) => (
          <div
            key={pi}
            style={{ flex: "0 0 100%", scrollSnapAlign: "start", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, padding: "2px 1px" }}
          >
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => onChange(c)}
                aria-label={`Color ${c}`}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 99,
                  background: c,
                  border: value === c ? "2.5px solid var(--acc-deep)" : "1.5px solid var(--line)",
                  boxShadow: value === c ? "0 0 0 2px var(--surface) inset" : undefined,
                  justifySelf: "center",
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "center", gap: 5, marginTop: 6 }}>
        {PALETTE_PAGES.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            aria-label={`Color page ${i + 1}`}
            style={{ width: 6, height: 6, borderRadius: 99, border: "none", padding: 0, background: page === i ? "var(--acc-deep)" : "var(--line)" }}
          />
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {label}
        </span>
        <span>
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--acc-deep)" }}>{value}</span>{" "}
          <span className="muted" style={{ fontSize: 11 }}>
            {unit}
          </span>
        </span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--acc)" }} />
    </div>
  );
}

function ToolButton({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, background: "none", border: "none" }}
    >
      <span style={{ fontSize: 18, lineHeight: 1, display: "flex", color: active ? "var(--acc-deep)" : "var(--mut)" }}>
        <Icon name={icon} size={18} strokeWidth={1.8} />
      </span>
      <span className="muted" style={{ fontSize: 9, fontWeight: 600, color: active ? "var(--acc-deep)" : "var(--mut)" }}>
        {label}
      </span>
    </button>
  );
}

function InkControls({
  value,
  onChange,
  sizeRange,
  opacityRange,
}: {
  value: { color: string; size: number; opacity: number };
  onChange: (v: { color: string; size: number; opacity: number }) => void;
  sizeRange: [number, number];
  opacityRange: [number, number];
}) {
  return (
    <div style={{ padding: "9px 14px 6px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <InkPreview color={value.color} size={value.size} opacity={value.opacity} />
        <div style={{ flex: 1 }}>
          <ColorGrid value={value.color} onChange={(color) => onChange({ ...value, color })} />
        </div>
      </div>
      <NumberField
        label="Opacity"
        value={Math.round(value.opacity * 100)}
        unit="%"
        min={Math.round(opacityRange[0] * 100)}
        max={Math.round(opacityRange[1] * 100)}
        onChange={(v) => onChange({ ...value, opacity: v / 100 })}
      />
      <NumberField label="Size" value={value.size} unit="pt" min={sizeRange[0]} max={sizeRange[1]} onChange={(size) => onChange({ ...value, size })} />
    </div>
  );
}

function EditInkSheet({
  item,
  onColorChange,
  onSizeChange,
  onOpacityChange,
  onDuplicate,
  onDelete,
  onClose,
}: {
  item: InkAnnotation;
  onColorChange: (c: string) => void;
  onSizeChange: (s: number) => void;
  onOpacityChange: (o: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isHighlighter = item.tool === "highlighter";
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{isHighlighter ? "Edit highlight" : "Edit stroke"}</div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "2px 2px 0" }}>
        <InkPreview color={item.color} size={item.size} opacity={item.opacity} points={item.points} />
        <div style={{ flex: 1 }}>
          <ColorGrid value={item.color} onChange={onColorChange} />
        </div>
      </div>
      <NumberField
        label="Opacity"
        value={Math.round(item.opacity * 100)}
        unit="%"
        min={isHighlighter ? 10 : 30}
        max={100}
        onChange={(v) => onOpacityChange(v / 100)}
      />
      <NumberField label="Size" value={item.size} unit="pt" min={1} max={isHighlighter ? 34 : 14} onChange={onSizeChange} />
      <button className="btn btn-block" onClick={onClose}>
        Done
      </button>
      <div className="btn-row">
        <button className="btn" onClick={onDuplicate}>
          <Icon name="duplicate" size={15} strokeWidth={1.8} /> Duplicate
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          <Icon name="trash" size={15} strokeWidth={1.8} /> Delete
        </button>
      </div>
    </Sheet>
  );
}

function EditMarkSheet({
  item,
  onColorChange,
  onSizeChange,
  onTextChange,
  onDuplicate,
  onDelete,
  onClose,
}: {
  item: MarkAnnotation;
  onColorChange: (c: string) => void;
  onSizeChange: (s: number) => void;
  onTextChange?: (t: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isFreeText = item.kind === "text" && !item.symbolId;
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{item.kind === "shape" ? "Edit shape" : isFreeText ? "Edit text" : "Edit mark"}</div>
      {isFreeText && onTextChange && (
        <input
          autoFocus
          value={(item as TextAnnotation).text}
          onChange={(e) => onTextChange(e.target.value)}
          style={{ height: 38, borderRadius: 8, border: "1px solid var(--line)", padding: "0 10px", fontSize: 14, background: "var(--bg)", color: "var(--fg)" }}
        />
      )}
      <ColorGrid value={item.color} onChange={onColorChange} />
      <NumberField label="Size" value={item.size} unit="pt" min={10} max={64} onChange={onSizeChange} />
      <button className="btn btn-block" onClick={onClose}>
        Done
      </button>
      <div className="btn-row">
        <button className="btn" onClick={onDuplicate}>
          <Icon name="duplicate" size={15} strokeWidth={1.8} /> Duplicate
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          <Icon name="trash" size={15} strokeWidth={1.8} /> Delete
        </button>
      </div>
    </Sheet>
  );
}
