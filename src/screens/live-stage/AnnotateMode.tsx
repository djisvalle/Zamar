import { useRef, useState } from "react";
import { useStore } from "../../state/store";
import { ChordChart } from "../../components/ChordChart";
import { Icon, type IconName } from "../../components/Icon";
import { Sheet } from "../../components/Overlays";
import type { AnnotationItem, AnnotationTool, InkAnnotation, TextAnnotation } from "../../state/types";

interface Point {
  x: number;
  y: number;
}

interface NotationSymbol {
  id: string;
  label: string;
  glyph?: string;
  icon?: IconName;
}

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

const PEN_COLORS = ["#1a1a1a", "#c0392b", "#2a6fdb", "#2a9d5c", "#e08e0b"];
const HL_COLORS = ["#ffe14d", "#7be08e", "#7ec8ff", "#ffb0d6", "#ffb066"];
const TEXT_COLORS = ["#2a6fdb", "#1a1a1a", "#c0392b", "#2a9d5c", "#8a4fd6"];
const PEN_SIZES = [2, 4, 7];
const HL_SIZES = [10, 16, 24];
const MARK_SIZES = [13, 17, 22];
const TAP_THRESHOLD = 6;

function pointsToPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.01} ${p.y + 0.01}`;
  }
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

/** Rough hit-test radius for an ink stroke, and a rough bounding box for a
 * text/notation mark — good enough for an eraser gesture in a mockup, not
 * pixel-exact glyph metrics. */
function eraserHits(pt: Point, items: AnnotationItem[], radius: number): Set<string> {
  const hits = new Set<string>();
  for (const item of items) {
    if (item.kind === "ink") {
      const hitR = radius + item.size / 2;
      if (item.points.some((p) => Math.hypot(p.x - pt.x, p.y - pt.y) <= hitR)) hits.add(item.id);
    } else {
      const halfW = Math.max(radius, (item.text.length || 1) * item.size * 0.32);
      const halfH = Math.max(radius, item.size * 0.9);
      if (Math.abs(pt.x - item.x) <= halfW && Math.abs(pt.y - item.y) <= halfH) hits.add(item.id);
    }
  }
  return hits;
}

export function AnnotateMode({ song, onDone }: { song: { id: string; chordpro: string }; onDone: () => void }) {
  const { state, dispatch } = useStore();
  const items = state.annotations[song.id] ?? [];
  const history = state.annotationHistory[song.id] ?? { past: [], future: [] };
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const [tool, setTool] = useState<AnnotationTool>("select");
  const [pen, setPen] = useState({ color: PEN_COLORS[0], size: PEN_SIZES[1], opacity: 1 });
  const [highlighter, setHighlighter] = useState({ color: HL_COLORS[0], size: HL_SIZES[1], opacity: 0.35 });
  const [markStyle, setMarkStyle] = useState({ color: TEXT_COLORS[0], size: MARK_SIZES[1] });
  const [eraserSize, setEraserSize] = useState(16);
  const [armedSymbol, setArmedSymbol] = useState<NotationSymbol>(NOTATION_SYMBOLS[0]);
  const [clearOpen, setClearOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [liveStroke, setLiveStroke] = useState<{ tool: "pen" | "highlighter"; points: Point[] } | null>(null);
  const [eraseTouched, setEraseTouched] = useState<Set<string>>(new Set());

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
    if (tool === "select") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const pt = contentPoint(e);
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
    if (tool === "pen" || tool === "highlighter") {
      setLiveStroke((s) => (s ? { ...s, points: [...s.points, pt] } : s));
    } else if (tool === "eraser") {
      const hits = eraserHits(pt, items, eraserSize);
      if (hits.size > 0) setEraseTouched((prev) => new Set([...prev, ...hits]));
    }
  };

  const finishGesture = (e: React.PointerEvent) => {
    if (!pointerActive.current) {
      gestureStart.current = null;
      return;
    }
    pointerActive.current = false;
    const pt = contentPoint(e);
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
    if ((tool === "text" || tool === "notation") && start) {
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
      } else {
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
      }
    }
  };

  const onPointerCancel = () => {
    pointerActive.current = false;
    gestureStart.current = null;
    setLiveStroke(null);
    setEraseTouched(new Set());
  };

  const commitMove = (id: string, x: number, y: number) => {
    commit(items.map((i) => (i.id === id ? { ...i, x, y } : i)));
  };

  const editingItem = items.find((i) => i.id === editingId && i.kind === "text") as TextAnnotation | undefined;
  const visibleItems = eraseTouched.size > 0 ? items.filter((i) => !eraseTouched.has(i.id)) : items;
  const inkItems = visibleItems.filter((i): i is InkAnnotation => i.kind === "ink");
  const markItems = visibleItems.filter((i): i is TextAnnotation => i.kind === "text");

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
            {inkItems.map((item) => (
              <path
                key={item.id}
                d={pointsToPath(item.points)}
                stroke={item.color}
                strokeOpacity={item.opacity}
                strokeWidth={item.size}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={item.tool === "highlighter" ? { mixBlendMode: "multiply" } : undefined}
              />
            ))}
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
        eraserSize={eraserSize}
        onEraserSizeChange={setEraserSize}
        armedSymbol={armedSymbol}
        onArmSymbol={setArmedSymbol}
      />

      {editingItem && (
        <EditMarkSheet
          item={editingItem}
          onChange={(patch) => commit(items.map((i) => (i.id === editingItem.id && i.kind === "text" ? { ...i, ...patch } : i)))}
          onDelete={() => {
            commit(items.filter((i) => i.id !== editingItem.id));
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

function AnnotationMark({
  item,
  tool,
  onMoveEnd,
  onTap,
}: {
  item: TextAnnotation;
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
        fontSize: item.size,
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
      {item.iconGlyph ? <Icon name={item.iconGlyph} size={item.size} strokeWidth={2} /> : item.text}
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
  eraserSize,
  onEraserSizeChange,
  armedSymbol,
  onArmSymbol,
}: {
  tool: AnnotationTool;
  onSelectTool: (t: AnnotationTool) => void;
  pen: { color: string; size: number; opacity: number };
  onPenChange: (v: { color: string; size: number; opacity: number }) => void;
  highlighter: { color: string; size: number; opacity: number };
  onHighlighterChange: (v: { color: string; size: number; opacity: number }) => void;
  markStyle: { color: string; size: number };
  onMarkStyleChange: (v: { color: string; size: number }) => void;
  eraserSize: number;
  onEraserSizeChange: (v: number) => void;
  armedSymbol: NotationSymbol;
  onArmSymbol: (s: NotationSymbol) => void;
}) {
  return (
    <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface)" }}>
      {tool === "pen" && (
        <InkControls value={pen} onChange={onPenChange} colors={PEN_COLORS} sizes={PEN_SIZES} opacityRange={[0.4, 1]} />
      )}
      {tool === "highlighter" && (
        <InkControls value={highlighter} onChange={onHighlighterChange} colors={HL_COLORS} sizes={HL_SIZES} opacityRange={[0.15, 0.6]} />
      )}
      {(tool === "text" || tool === "notation") && (
        <div style={{ padding: "9px 14px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
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
          <SwatchRow colors={TEXT_COLORS} active={markStyle.color} onPick={(color) => onMarkStyleChange({ ...markStyle, color })} />
          <SizeRow sizes={MARK_SIZES} active={markStyle.size} onPick={(size) => onMarkStyleChange({ ...markStyle, size })} />
        </div>
      )}
      {tool === "eraser" && (
        <div style={{ padding: "10px 14px 4px", display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Eraser size
          </span>
          <input
            type="range"
            min={8}
            max={40}
            value={eraserSize}
            onChange={(e) => onEraserSizeChange(Number(e.target.value))}
            style={{ flex: 1, accentColor: "var(--acc)" }}
          />
        </div>
      )}
      {tool === "select" && (
        <div className="muted" style={{ padding: "10px 14px 2px", fontSize: 11 }}>
          Tap a mark to edit it, drag to move it.
        </div>
      )}

      <div style={{ padding: "8px 6px 10px", display: "flex", alignItems: "center" }}>
        <ToolButton icon="cursor" label="Select" active={tool === "select"} onClick={() => onSelectTool("select")} />
        <ToolButton icon="edit" label="Pen" active={tool === "pen"} onClick={() => onSelectTool("pen")} />
        <ToolButton icon="highlighter" label="Highlight" active={tool === "highlighter"} onClick={() => onSelectTool("highlighter")} />
        <ToolButton icon="text" label="Text" active={tool === "text"} onClick={() => onSelectTool("text")} />
        <ToolButton icon="music" label="Notation" active={tool === "notation"} onClick={() => onSelectTool("notation")} />
        <ToolButton icon="eraser" label="Eraser" active={tool === "eraser"} onClick={() => onSelectTool("eraser")} />
      </div>
    </div>
  );
}

function InkControls({
  value,
  onChange,
  colors,
  sizes,
  opacityRange,
}: {
  value: { color: string; size: number; opacity: number };
  onChange: (v: { color: string; size: number; opacity: number }) => void;
  colors: string[];
  sizes: number[];
  opacityRange: [number, number];
}) {
  return (
    <div style={{ padding: "9px 14px 4px", display: "flex", flexDirection: "column", gap: 8 }}>
      <SwatchRow colors={colors} active={value.color} onPick={(color) => onChange({ ...value, color })} />
      <SizeRow sizes={sizes} active={value.size} onPick={(size) => onChange({ ...value, size })} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="muted" style={{ fontSize: 11 }}>
          Opacity
        </span>
        <input
          type="range"
          min={Math.round(opacityRange[0] * 100)}
          max={Math.round(opacityRange[1] * 100)}
          value={Math.round(value.opacity * 100)}
          onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) / 100 })}
          style={{ flex: 1, accentColor: "var(--acc)" }}
        />
        <span className="accent-deep" style={{ fontSize: 11, fontWeight: 600, minWidth: 30, textAlign: "right" }}>
          {Math.round(value.opacity * 100)}%
        </span>
      </div>
    </div>
  );
}

function SwatchRow({ colors, active, onPick }: { colors: string[]; active: string; onPick: (c: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          aria-label={`Color ${c}`}
          style={{
            width: 24,
            height: 24,
            borderRadius: 99,
            background: c,
            border: active === c ? "2.5px solid var(--acc-deep)" : "1.5px solid var(--line)",
            boxShadow: active === c ? "0 0 0 2px var(--surface) inset" : undefined,
          }}
        />
      ))}
    </div>
  );
}

function SizeRow({ sizes, active, onPick }: { sizes: number[]; active: number; onPick: (s: number) => void }) {
  const labels = ["S", "M", "L"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>
        Size
      </span>
      {sizes.map((s, i) => (
        <button key={s} className={"chip" + (active === s ? " active" : "")} onClick={() => onPick(s)}>
          {labels[i] ?? s}
        </button>
      ))}
    </div>
  );
}

function ToolButton({ icon, label, active, onClick }: { icon: IconName; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: 1, background: "none", border: "none" }}
    >
      <span style={{ fontSize: 19, lineHeight: 1, display: "flex", color: active ? "var(--acc-deep)" : "var(--mut)" }}>
        <Icon name={icon} size={19} strokeWidth={1.8} />
      </span>
      <span className="muted" style={{ fontSize: 9.5, fontWeight: 600, color: active ? "var(--acc-deep)" : "var(--mut)" }}>
        {label}
      </span>
    </button>
  );
}

function EditMarkSheet({
  item,
  onChange,
  onDelete,
  onClose,
}: {
  item: TextAnnotation;
  onChange: (patch: Partial<TextAnnotation>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isStamp = Boolean(item.symbolId);
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{isStamp ? "Edit mark" : "Edit text"}</div>
      {!isStamp && (
        <input
          autoFocus
          value={item.text}
          onChange={(e) => onChange({ text: e.target.value })}
          style={{
            height: 38,
            borderRadius: 8,
            border: "1px solid var(--line)",
            padding: "0 10px",
            fontSize: 14,
            background: "var(--bg)",
            color: "var(--fg)",
          }}
        />
      )}
      <div style={{ padding: "2px 2px 0" }}>
        <SwatchRow colors={TEXT_COLORS} active={item.color} onPick={(color) => onChange({ color })} />
      </div>
      <div style={{ padding: "2px 2px 0" }}>
        <SizeRow sizes={MARK_SIZES} active={item.size} onPick={(size) => onChange({ size })} />
      </div>
      <div className="btn-row">
        <button className="btn" onClick={onClose}>
          Done
        </button>
        <button className="btn btn-danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </Sheet>
  );
}
