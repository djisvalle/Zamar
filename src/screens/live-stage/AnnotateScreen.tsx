import { useRef, useState } from "react";
import { useStore } from "../../state/store";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type MxlScoreHandle } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { Icon, type IconName } from "../../components/Icon";
import { Sheet } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { AnnotateCanvas, ShapeGlyph, type AnnotateTool, type ArmedSymbol } from "../../components/AnnotateCanvas";
import { isMark, isStroke, PALETTE_PAGES, STROKE_WIDTH } from "../../utils/annotations";
import type {
  AnnotationObject,
  AnnotationView,
  AttachmentKind,
  AttachmentVersion,
  ChartView,
  ShapeId,
  ShapeMark,
  Song,
  Stroke,
  TextMark,
} from "../../state/types";

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

interface History {
  past: AnnotationObject[][];
  future: AnnotationObject[][];
}

export function AnnotateScreen({
  song,
  view,
  activeKind,
  activeVersion,
  semitones,
  hiddenParts,
  fontScale,
  onClose,
}: {
  song: Song;
  view: ChartView;
  activeKind?: AttachmentKind;
  activeVersion?: AttachmentVersion;
  semitones: number;
  hiddenParts: ReadonlySet<string>;
  fontScale: number;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const annotationView: AnnotationView = view === "chords" ? "chords" : activeKind ?? "chords";
  // Matches the exact condition that produces the "Nothing to annotate yet"
  // fallback in `content` below — there's no real chart to attribute marks
  // to, so `done()` must not write to `annotations` at all in this case.
  const noAnnotationTarget = view === "sheet" && activeKind === undefined;

  const [mode, setMode] = useState<"draw" | "cues">("draw");
  const [tool, setTool] = useState<AnnotateTool>("select");
  const [scrollMode, setScrollMode] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationObject[]>(() => song.annotations[annotationView] ?? []);
  // Captures the exact array reference `annotations` started from, so
  // `done()` can tell "never drew/erased/pinned this session" (still the
  // same reference) from "drew, then cleared back to []" (a new, different
  // empty array).
  const initialAnnotationsRef = useRef(annotations);
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [cuesText, setCuesText] = useState(song.notes);
  const [clearOpen, setClearOpen] = useState(false);
  // Set by "Clear all views on this song" — deferred to Done (see `done()`)
  // rather than dispatched immediately, since an immediate UPDATE_SONG here
  // would go stale the instant this screen's own `song` prop stopped
  // matching the store (Done's own dispatch would then silently resurrect
  // every other view from that stale snapshot).
  const [allViewsCleared, setAllViewsCleared] = useState(false);
  const mxlScoreRef = useRef<MxlScoreHandle>(null);
  const [reprojectTick, setReprojectTick] = useState(0);

  const [penStyle, setPenStyle] = useState({ color: PALETTE_PAGES[0][0], size: STROKE_WIDTH, opacity: 1 });
  const [highlighterStyle, setHighlighterStyle] = useState({ color: PALETTE_PAGES[0][2], size: 16, opacity: 0.3 });
  const [markStyle, setMarkStyle] = useState({ color: PALETTE_PAGES[0][3], size: 20 });
  const [shapeStyle, setShapeStyle] = useState({ color: PALETTE_PAGES[0][0], size: 22 });
  const [eraserSize, setEraserSize] = useState(16);
  const [armedSymbol, setArmedSymbol] = useState<NotationSymbol>(NOTATION_SYMBOLS[0]);
  const [armedShape, setArmedShape] = useState<ShapeId>("hairpin-cresc");
  const [editingId, setEditingId] = useState<string | null>(null);
  // Decoupled from editingId so the Select tool's first tap on a ShapeMark
  // can select it (showing AnnotateCanvas's resize/rotate handles) without
  // also opening its edit sheet — see onEditRequest/onSelectRequest below.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Selection (and its resize/rotate handles) only makes sense while the
  // Select tool is active — switching to any other tool drops it, so a
  // shape doesn't stay visibly "selected" under Pen/Eraser/etc. with no way
  // to reach it.
  const handleSelectTool = (t: AnnotateTool) => {
    setTool(t);
    if (t !== "select") setSelectedId(null);
  };

  const commit = (next: AnnotationObject[]) => {
    setHistory((h) => ({ past: [...h.past, annotations], future: [] }));
    setAnnotations(next);
  };

  // Silently syncs positions after a transpose re-render — not a user edit,
  // so it bypasses history (see AnnotateCanvas's onReproject doc).
  const reproject = (next: AnnotationObject[]) => setAnnotations(next);

  const undo = () => {
    if (history.past.length === 0) return;
    const restored = history.past[history.past.length - 1];
    setHistory((h) => ({ past: h.past.slice(0, -1), future: [annotations, ...h.future] }));
    setAnnotations(restored);
  };

  const redo = () => {
    if (history.future.length === 0) return;
    const restored = history.future[0];
    setHistory((h) => ({ past: [...h.past, annotations], future: h.future.slice(1) }));
    setAnnotations(restored);
  };

  const done = () => {
    const cuesChanged = cuesText !== song.notes;
    const annotationsChanged = annotations !== initialAnnotationsRef.current;
    if (!cuesChanged && !annotationsChanged && !allViewsCleared) {
      onClose();
      return;
    }
    dispatch({
      type: "UPDATE_SONG",
      song: {
        ...song,
        notes: cuesText,
        annotations: allViewsCleared
          ? noAnnotationTarget
            ? {}
            : { [annotationView]: annotations }
          : noAnnotationTarget
            ? song.annotations
            : { ...song.annotations, [annotationView]: annotations },
      },
    });
    onClose();
  };

  const editingStroke = annotations.find((a): a is Stroke => a.id === editingId && isStroke(a));
  const editingMark = annotations.find((a): a is TextMark | ShapeMark => a.id === editingId && isMark(a));

  const duplicateStroke = (item: Stroke) => {
    const copy: Stroke = { ...item, id: `stroke-${Date.now()}`, points: item.points.map((p) => ({ x: p.x + 14, y: p.y + 14 })), anchors: undefined };
    commit([...annotations, copy]);
    setSelectedId(copy.id);
    setEditingId(copy.id);
  };

  const duplicateMark = (item: TextMark | ShapeMark) => {
    const copy = { ...item, id: `mark-${Date.now()}`, position: { x: item.position.x + 16, y: item.position.y + 16 }, anchor: undefined };
    commit([...annotations, copy]);
    setSelectedId(copy.id);
    setEditingId(copy.id);
  };

  const armed: ArmedSymbol = tool === "notation" ? { id: armedSymbol.id, glyph: armedSymbol.glyph, icon: armedSymbol.icon } : { id: "" };

  const content =
    view === "chords" ? (
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.35 }}>
        <ChordChart chordpro={song.chordpro} semitones={semitones} fontScale={fontScale} />
      </div>
    ) : activeKind === "image" && activeVersion ? (
      <img src={activeVersion.dataUrl} alt={activeVersion.name} style={{ width: "100%", display: "block" }} />
    ) : activeKind === "musicxml" && activeVersion ? (
      <div style={{ padding: 8 }}>
        <MxlScore
          ref={mxlScoreRef}
          src={activeVersion.dataUrl}
          transpose={semitones}
          hiddenParts={hiddenParts}
          disableZoom
          staveSpacing={state.settings.staveSpacing}
          onRerendered={() => setReprojectTick((t) => t + 1)}
        />
      </div>
    ) : activeKind === "pdf" && activeVersion ? (
      <PdfPages src={activeVersion.dataUrl} disableZoom />
    ) : (
      <div className="muted" style={{ padding: 20, fontSize: 12, textAlign: "center" }}>
        Nothing to annotate yet.
      </div>
    );

  return (
    <div className="screen">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          background: "var(--tint)",
          borderBottom: "1px solid var(--acc)",
        }}
      >
        <button className="hdr-action" onClick={undo} disabled={history.past.length === 0}>
          Undo
        </button>
        <button className="hdr-action" onClick={redo} disabled={history.future.length === 0}>
          Redo
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <Segmented
            options={[
              { value: "draw", label: "Draw" },
              { value: "cues", label: "Cues" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <button className="hdr-action" onClick={() => setClearOpen(true)}>
          Clear
        </button>
        <button className="hdr-action" onClick={done}>
          Done
        </button>
      </div>

      <div className="flex-1 hidden-scroll" style={{ position: "relative" }}>
        {mode === "draw" ? (
          <AnnotateCanvas
            annotations={annotations}
            tool={tool}
            onCommit={commit}
            onReproject={reproject}
            onEditRequest={(id) => {
              setSelectedId(id);
              setEditingId(id);
            }}
            onSelectRequest={setSelectedId}
            selectedId={selectedId}
            scrollMode={scrollMode}
            scoreRef={annotationView === "musicxml" ? mxlScoreRef : undefined}
            reprojectSignal={annotationView === "musicxml" ? reprojectTick : undefined}
            penStyle={penStyle}
            highlighterStyle={highlighterStyle}
            markStyle={markStyle}
            shapeStyle={shapeStyle}
            armedSymbol={armed}
            armedShape={armedShape}
            eraserSize={eraserSize}
          >
            {content}
          </AnnotateCanvas>
        ) : (
          <textarea
            value={cuesText}
            onChange={(e) => setCuesText(e.target.value)}
            placeholder="Cues for this song — reminders, anything you want on hand while you're on stage."
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              padding: "16px 14px",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: 1.5,
              background: "var(--bg)",
              color: "var(--fg)",
              resize: "none",
            }}
          />
        )}
      </div>

      {mode === "draw" && (
        <AnnotateDock
          tool={tool}
          onSelectTool={handleSelectTool}
          scrollMode={scrollMode}
          onToggleScroll={() => setScrollMode((s) => !s)}
          penStyle={penStyle}
          onPenStyleChange={setPenStyle}
          highlighterStyle={highlighterStyle}
          onHighlighterStyleChange={setHighlighterStyle}
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
      )}

      {editingStroke && (
        <EditInkSheet
          item={editingStroke}
          onColorChange={(color) => commit(annotations.map((a) => (a.id === editingStroke.id ? { ...a, color } : a)))}
          onSizeChange={(size) => commit(annotations.map((a) => (a.id === editingStroke.id ? { ...a, size } : a)))}
          onOpacityChange={(opacity) => commit(annotations.map((a) => (a.id === editingStroke.id ? { ...a, opacity } : a)))}
          onDuplicate={() => duplicateStroke(editingStroke)}
          onDelete={() => {
            commit(annotations.filter((a) => a.id !== editingStroke.id));
            setEditingId(null);
            setSelectedId(null);
          }}
          onClose={() => {
            setEditingId(null);
            setSelectedId(null);
          }}
        />
      )}

      {editingMark && (
        <EditMarkSheet
          item={editingMark}
          onColorChange={(color) => commit(annotations.map((a) => (a.id === editingMark.id ? { ...a, color } : a)))}
          onSizeChange={(size) => commit(annotations.map((a) => (a.id === editingMark.id ? { ...a, size } : a)))}
          onTextChange={
            editingMark.kind === "text" && !editingMark.symbolId
              ? (text) => commit(annotations.map((a) => (a.id === editingMark.id ? { ...a, text } : a)))
              : undefined
          }
          onDuplicate={() => duplicateMark(editingMark)}
          onDelete={() => {
            commit(annotations.filter((a) => a.id !== editingMark.id));
            setEditingId(null);
            setSelectedId(null);
          }}
          onClose={() => {
            setEditingId(null);
            setSelectedId(null);
          }}
        />
      )}

      {clearOpen && (
        <Sheet onClose={() => setClearOpen(false)}>
          <div className="sheet-title">Clear annotations</div>
          <button
            className="sheet-row"
            onClick={() => {
              commit([]);
              setClearOpen(false);
            }}
          >
            <span>Clear this view</span>
          </button>
          <button
            className="sheet-row"
            style={{
              color: "var(--danger-fg)",
              fontWeight: 700,
              justifyContent: "flex-start",
              gap: 8,
              padding: "9px 8px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--danger) 10%, transparent)",
            }}
            onClick={() => {
              commit([]);
              setAllViewsCleared(true);
              setClearOpen(false);
            }}
          >
            <Icon name="trash" size={15} strokeWidth={1.8} />
            <span>Clear all views on this song</span>
          </button>
          <button className="sheet-row" onClick={() => setClearOpen(false)}>
            <span>Cancel</span>
          </button>
        </Sheet>
      )}
    </div>
  );
}

function AnnotateDock({
  tool,
  onSelectTool,
  scrollMode,
  onToggleScroll,
  penStyle,
  onPenStyleChange,
  highlighterStyle,
  onHighlighterStyleChange,
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
  tool: AnnotateTool;
  onSelectTool: (t: AnnotateTool) => void;
  scrollMode: boolean;
  onToggleScroll: () => void;
  penStyle: { color: string; size: number; opacity: number };
  onPenStyleChange: (v: { color: string; size: number; opacity: number }) => void;
  highlighterStyle: { color: string; size: number; opacity: number };
  onHighlighterStyleChange: (v: { color: string; size: number; opacity: number }) => void;
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
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface)", maxHeight: "58%", overflowY: "auto" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-label={expanded ? "Collapse tool panel" : "Expand tool panel"}
        style={{
          display: "block",
          width: "100%",
          background: "none",
          border: "none",
          padding: "4px 0 0",
          fontSize: 16,
          color: "var(--mut)",
          textAlign: "center",
        }}
      >
        {expanded ? "﹀" : "︿"}
      </button>
      {expanded && (
      <>
      {(tool === "pen" || tool === "square") && (
        <InkControls value={penStyle} onChange={onPenStyleChange} sizeRange={[1, 14]} opacityRange={[0.3, 1]} />
      )}
      {tool === "highlighter" && <InkControls value={highlighterStyle} onChange={onHighlighterStyleChange} sizeRange={[6, 34]} opacityRange={[0.1, 0.7]} />}
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
          Tap a stroke or mark to edit it, drag to move it. Tap a shape to show its resize/rotate handles; tap again to edit it.
        </div>
      )}
      {tool === "pin" && (
        <div className="muted" style={{ padding: "10px 14px 2px", fontSize: 11 }}>
          Tap the chart to drop a pin.
        </div>
      )}
      </>
      )}

      <div style={{ padding: "8px 4px 10px", display: "flex", alignItems: "center", gap: 2 }}>
        <div style={{ display: "flex", overflowX: "auto", flex: 1 }}>
          <ToolButton icon="cursor" label="Select" active={tool === "select"} onClick={() => onSelectTool("select")} />
          <ToolButton icon="edit" label="Pen" active={tool === "pen"} onClick={() => onSelectTool("pen")} />
          <ToolButton icon="highlighter" label="Highlight" active={tool === "highlighter"} onClick={() => onSelectTool("highlighter")} />
          <ToolButton icon="square" label="Rect" active={tool === "square"} onClick={() => onSelectTool("square")} />
          <ToolButton icon="note" label="Pin" active={tool === "pin"} onClick={() => onSelectTool("pin")} />
          <ToolButton icon="text" label="Text" active={tool === "text"} onClick={() => onSelectTool("text")} />
          <ToolButton icon="music" label="Notation" active={tool === "notation"} onClick={() => onSelectTool("notation")} />
          <ToolButton icon="shapes" label="Shapes" active={tool === "shapes"} onClick={() => onSelectTool("shapes")} />
          <ToolButton icon="eraser" label="Eraser" active={tool === "eraser"} onClick={() => onSelectTool("eraser")} />
        </div>
        <button
          onClick={onToggleScroll}
          aria-label="Scroll mode"
          style={{
            background: "none",
            border: "none",
            color: scrollMode ? "var(--acc-deep)" : "var(--mut)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 3,
            padding: "0 6px",
          }}
        >
          <Icon name="grip" size={18} strokeWidth={1.8} />
          <span className="muted" style={{ fontSize: 9, fontWeight: 600, color: scrollMode ? "var(--acc-deep)" : "var(--mut)" }}>
            Scroll
          </span>
        </button>
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
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: "0 0 44px", background: "none", border: "none" }}
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
  item: Stroke;
  onColorChange: (c: string) => void;
  onSizeChange: (s: number) => void;
  onOpacityChange: (o: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const isHighlighter = item.tool === "highlighter";
  const color = item.color ?? PALETTE_PAGES[0][0];
  const size = item.size ?? STROKE_WIDTH;
  const opacity = item.opacity ?? 1;
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">{isHighlighter ? "Edit highlight" : "Edit stroke"}</div>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "2px 2px 0" }}>
        <InkPreview color={color} size={size} opacity={opacity} points={item.points} />
        <div style={{ flex: 1 }}>
          <ColorGrid value={color} onChange={onColorChange} />
        </div>
      </div>
      <NumberField
        label="Opacity"
        value={Math.round(opacity * 100)}
        unit="%"
        min={isHighlighter ? 10 : 30}
        max={100}
        onChange={(v) => onOpacityChange(v / 100)}
      />
      <NumberField label="Size" value={size} unit="pt" min={1} max={isHighlighter ? 34 : 14} onChange={onSizeChange} />
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
  item: TextMark | ShapeMark;
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
          value={(item as TextMark).text}
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
