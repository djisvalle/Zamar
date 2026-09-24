import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { Icon, type IconName } from "../../components/Icon";
import { SmuflGlyph } from "../../components/SmuflGlyph";
import { NOTATION_SYMBOLS, type NotationSymbol } from "../../utils/notation";
import { Sheet } from "../../components/Overlays";
import { ShapeGlyph, type AnnotateTool, type ArmedSymbol } from "../../components/AnnotateCanvas";
import { isMark, isStroke, PALETTE_PAGES, STROKE_WIDTH } from "../../utils/annotations";
import type {
  AnnotationObject,
  AnnotationView,
  AttachmentKind,
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

export type AnnotateSession = ReturnType<typeof useAnnotateSession>;

/**
 * Everything the Annotate toolbar edits — the draft annotations, undo/redo
 * history, cues text, current tool and tool styles — kept in a hook Live
 * Stage owns, rather than inside a component that wraps the chart.
 *
 * Annotate used to be a component that took over Live Stage and re-parented
 * the chart under its own canvas, so opening it unmounted and remounted the
 * whole chart: a MusicXML score re-engraved at 1x, a PDF re-rasterized at 1x,
 * and the scroll position jumped to the top. Now Live Stage keeps exactly
 * one chart + `AnnotateCanvas` mounted at all times and only flips that
 * canvas between read-only and interactive; opening Annotate just swaps the
 * bottom toolbar. This hook is what the toolbar and the canvas share.
 *
 * The draft is re-seeded from the song every time the dock opens (tracked
 * via `sessionKey` during render, not an effect, so the first open frame
 * never shows a stale draft), and only written back to the song on Done.
 */
export function useAnnotateSession({
  song,
  open,
  annotationView,
  noAnnotationTarget,
  onClose,
}: {
  song: Song | null;
  open: boolean;
  annotationView: AnnotationView;
  /** True when there's no real chart to attribute marks to (sheet view with
   * nothing attached) — `done()` must not write to `annotations` then. */
  noAnnotationTarget: boolean;
  onClose: () => void;
}) {
  const { dispatch } = useStore();

  const [mode, setMode] = useState<"draw" | "cues">("draw");
  const [tool, setTool] = useState<AnnotateTool>("select");
  const [scrollMode, setScrollMode] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationObject[]>([]);
  // Captures the exact array reference `annotations` started from, so
  // `done()` can tell "never drew/erased/pinned this session" (still the
  // same reference) from "drew, then cleared back to []" (a new, different
  // empty array).
  const initialAnnotationsRef = useRef<AnnotationObject[]>(annotations);
  const [history, setHistory] = useState<History>({ past: [], future: [] });
  const [cuesText, setCuesText] = useState("");
  // Set by "Clear all views on this song" — deferred to Done (see `done()`)
  // rather than dispatched immediately, so Done's own dispatch can't
  // silently resurrect every other view from a stale snapshot.
  const [allViewsCleared, setAllViewsCleared] = useState(false);

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
  const [clearOpen, setClearOpen] = useState(false);

  // Re-seed the per-session draft whenever the dock opens (or the song/view
  // it's open on changes). Tool and style choices deliberately carry over
  // between sessions, like a real notation app's last-used pen.
  const sessionKey = open && song ? `${song.id}:${annotationView}` : null;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (sessionKey !== seededKey) {
    setSeededKey(sessionKey);
    if (sessionKey && song) {
      const initial = song.annotations[annotationView] ?? [];
      initialAnnotationsRef.current = initial;
      setAnnotations(initial);
      setHistory({ past: [], future: [] });
      setCuesText(song.notes);
      setAllViewsCleared(false);
      setMode("draw");
      setEditingId(null);
      setSelectedId(null);
      setClearOpen(false);
    }
  }

  // Selection (and its resize/rotate handles) only makes sense while the
  // Select tool is active — switching to any other tool drops it, so a
  // shape doesn't stay visibly "selected" under Pen/Eraser/etc. with no way
  // to reach it.
  const selectTool = (t: AnnotateTool) => {
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
    if (!song) {
      onClose();
      return;
    }
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

  const armed: ArmedSymbol = tool === "notation" ? { id: armedSymbol.id, glyph: armedSymbol.text } : { id: "" };

  /** Props for Live Stage's one `AnnotateCanvas` while the dock is open. */
  const canvasProps = {
    annotations,
    interactive: mode === "draw",
    tool,
    onCommit: commit,
    onReproject: reproject,
    onEditRequest: (id: string) => {
      setSelectedId(id);
      setEditingId(id);
    },
    onSelectRequest: setSelectedId,
    selectedId,
    scrollMode,
    penStyle,
    highlighterStyle,
    markStyle,
    shapeStyle,
    armedSymbol: armed,
    armedShape,
    eraserSize,
  };

  return {
    mode,
    setMode,
    tool,
    selectTool,
    scrollMode,
    setScrollMode,
    annotations,
    history,
    cuesText,
    setCuesText,
    setAllViewsCleared,
    penStyle,
    setPenStyle,
    highlighterStyle,
    setHighlighterStyle,
    markStyle,
    setMarkStyle,
    shapeStyle,
    setShapeStyle,
    eraserSize,
    setEraserSize,
    armedSymbol,
    setArmedSymbol,
    armedShape,
    setArmedShape,
    editingId,
    setEditingId,
    setSelectedId,
    clearOpen,
    setClearOpen,
    commit,
    undo,
    redo,
    done,
    canvasProps,
  };
}

const TOOLS: { id: AnnotateTool; icon: IconName; label: string }[] = [
  { id: "select", icon: "cursor", label: "Select" },
  { id: "pen", icon: "edit", label: "Pen" },
  { id: "highlighter", icon: "highlighter", label: "Highlighter" },
  { id: "square", icon: "square", label: "Rectangle" },
  { id: "pin", icon: "note", label: "Pin" },
  { id: "text", icon: "text", label: "Text" },
  { id: "notation", icon: "music", label: "Notation" },
  { id: "shapes", icon: "shapes", label: "Shapes" },
  { id: "eraser", icon: "eraser", label: "Eraser" },
];

/** Glyphs per notation popover page: 6 columns × 3 rows, like forScore's stamp grid. */
const GLYPHS_PER_PAGE = 18;

interface PanelPlacement {
  left: number;
  width: number;
  /** Distance from the host's bottom edge to the popover's bottom edge. */
  bottom: number;
  /** Arrow center, in host coordinates. */
  arrowX: number;
}

/**
 * The Annotate toolbar, in the iOS 26 idiom: a floating glass bar at the
 * top (Undo, Redo, song title, Done) and one at the bottom holding the tools,
 * with each tool's settings in a glass popover pointing at it. Both bars
 * float over the chart instead of taking space from it, so the chart above is
 * left exactly as it was (same instance, same zoom, same scroll position).
 * Its edit/clear sheets render as siblings so their backdrops cover the whole
 * stage.
 */
export function AnnotateToolbar({ session, title }: { session: AnnotateSession; title: string }) {
  const s = session;
  const { annotations, commit, editingId, setEditingId, setSelectedId } = s;

  // The tool whose settings popover is showing, if any. Cues mode shows its
  // own panel in the same spot instead.
  const [popoverTool, setPopoverTool] = useState<AnnotateTool | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLButtonElement | null>(null);
  const toolRefs = useRef<Partial<Record<AnnotateTool, HTMLButtonElement | null>>>({});
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);

  const panel: AnnotateTool | "cues" | null = s.mode === "cues" ? "cues" : popoverTool;

  // Measured after layout so the popover can center on (and point its arrow
  // at) the tool that opened it, clamped inside the screen.
  useLayoutEffect(() => {
    if (!panel) return;
    const place = () => {
      const bar = barRef.current;
      const host = bar?.offsetParent as HTMLElement | null;
      if (!bar || !host) return;
      const hostRect = host.getBoundingClientRect();
      const barRect = bar.getBoundingClientRect();
      const anchorEl = panel === "cues" ? moreRef.current : toolRefs.current[panel];
      const r = anchorEl?.getBoundingClientRect() ?? barRect;
      const width = Math.min(hostRect.width - 20, 400);
      const cx = r.left + r.width / 2 - hostRect.left;
      const left = Math.max(10, Math.min(cx - width / 2, hostRect.width - width - 10));
      setPlacement({ left, width, bottom: hostRect.bottom - barRect.top + 12, arrowX: cx });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [panel]);

  const hasSettings = (t: AnnotateTool) => t !== "select";

  const onToolTap = (t: AnnotateTool) => {
    setMenuOpen(false);
    if (s.mode === "cues") s.setMode("draw");
    if (s.tool === t) {
      setPopoverTool((open) => (open ? null : hasSettings(t) ? t : null));
      return;
    }
    s.selectTool(t);
    setPopoverTool(hasSettings(t) ? t : null);
  };

  const closeFloating = () => {
    setPopoverTool(null);
    setMenuOpen(false);
  };

  const toolColor = (t: AnnotateTool): string | undefined => {
    if (t === "pen" || t === "square") return s.penStyle.color;
    if (t === "highlighter") return s.highlighterStyle.color;
    if (t === "text" || t === "notation") return s.markStyle.color;
    if (t === "shapes") return s.shapeStyle.color;
    return undefined;
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

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <>
      {/* Tapping outside an open popover or menu only dismisses it, the way
          iOS does — it never also draws on the chart underneath. */}
      {(popoverTool || menuOpen) && (
        <div
          className="popover-dismiss"
          onPointerDown={(e) => {
            e.stopPropagation();
            closeFloating();
          }}
          onClick={stop}
        />
      )}

      <div className="glass glass-bar glass-bar--top" onClick={stop}>
        <button className="bar-btn" onClick={s.undo} disabled={s.history.past.length === 0} aria-label="Undo">
          <Icon name="undo" size={21} strokeWidth={2} />
        </button>
        <button className="bar-btn" onClick={s.redo} disabled={s.history.future.length === 0} aria-label="Redo">
          <Icon name="redo" size={21} strokeWidth={2} />
        </button>
        <div className="glass-bar-title">
          {title}
          <small>{s.mode === "cues" ? "Editing cues" : "Annotating"}</small>
        </div>
        <button className="bar-btn bar-btn--prominent" onClick={s.done}>
          Done
        </button>
      </div>

      {panel && placement && (
        <>
          <div
            className="glass popover"
            style={{ left: placement.left, width: placement.width, bottom: placement.bottom, "--arrow-x": `${placement.arrowX - placement.left}px` } as React.CSSProperties}
            onClick={stop}
            onPointerDown={stop}
          >
            {panel === "cues" ? (
              // Cues edit in the toolbar itself rather than replacing the
              // chart, so the song stays on screen while you write them.
              <textarea
                value={s.cuesText}
                onChange={(e) => s.setCuesText(e.target.value)}
                placeholder="Cues for this song — reminders, anything you want on hand while you're on stage."
                style={{
                  display: "block",
                  width: "100%",
                  height: 150,
                  border: "none",
                  borderRadius: 12,
                  padding: "10px 12px",
                  fontFamily: "inherit",
                  fontSize: 17,
                  lineHeight: 1.4,
                  background: "var(--fill)",
                  color: "var(--fg)",
                  resize: "none",
                }}
              />
            ) : (
              <ToolSettings
                tool={panel}
                penStyle={s.penStyle}
                onPenStyleChange={s.setPenStyle}
                highlighterStyle={s.highlighterStyle}
                onHighlighterStyleChange={s.setHighlighterStyle}
                markStyle={s.markStyle}
                onMarkStyleChange={s.setMarkStyle}
                shapeStyle={s.shapeStyle}
                onShapeStyleChange={s.setShapeStyle}
                eraserSize={s.eraserSize}
                onEraserSizeChange={s.setEraserSize}
                armedSymbol={s.armedSymbol}
                onArmSymbol={s.setArmedSymbol}
                armedShape={s.armedShape}
                onArmShape={s.setArmedShape}
              />
            )}
          </div>
          {panel !== "cues" && <div className="popover-arrow" style={{ left: placement.arrowX, bottom: placement.bottom - 10 }} />}
        </>
      )}

      {menuOpen && (
        <div className="glass ios-menu" style={{ right: 14, bottom: "calc(env(safe-area-inset-bottom, 0px) + 82px)" }} onClick={stop} onPointerDown={stop}>
          <button
            onClick={() => {
              s.setMode("draw");
              setMenuOpen(false);
            }}
          >
            Draw {s.mode === "draw" && <Icon name="check" size={17} strokeWidth={2.2} />}
          </button>
          <button
            onClick={() => {
              s.setMode("cues");
              setPopoverTool(null);
              setMenuOpen(false);
            }}
          >
            Cues {s.mode === "cues" && <Icon name="check" size={17} strokeWidth={2.2} />}
          </button>
          <hr />
          <button
            onClick={() => {
              s.setScrollMode((v) => !v);
              setMenuOpen(false);
            }}
          >
            Scroll mode {s.scrollMode && <Icon name="check" size={17} strokeWidth={2.2} />}
          </button>
          <hr />
          <button
            className="destructive"
            onClick={() => {
              setMenuOpen(false);
              s.setClearOpen(true);
            }}
          >
            Clear… <Icon name="trash" size={17} strokeWidth={1.9} />
          </button>
        </div>
      )}

      <div ref={barRef} className="glass glass-bar glass-bar--bottom" onClick={stop}>
        <div className="bar-tools" onScroll={() => setPopoverTool(null)}>
          {TOOLS.map((t) => {
            const color = toolColor(t.id);
            return (
              <button
                key={t.id}
                ref={(el) => {
                  toolRefs.current[t.id] = el;
                }}
                className={"bar-tool" + (s.mode === "draw" && s.tool === t.id ? " active" : "")}
                onClick={() => onToolTap(t.id)}
                aria-label={t.label}
                aria-pressed={s.mode === "draw" && s.tool === t.id}
                aria-expanded={hasSettings(t.id) ? popoverTool === t.id : undefined}
              >
                <Icon name={t.icon} size={22} strokeWidth={1.8} />
                {color && <span className="bar-tool-swatch" style={{ background: color }} />}
              </button>
            );
          })}
        </div>
        <button
          ref={moreRef}
          className={"bar-tool" + (menuOpen || s.scrollMode ? " active" : "")}
          style={{ width: 36 }}
          onClick={() => {
            setPopoverTool(null);
            setMenuOpen((v) => !v);
          }}
          aria-label="More"
          aria-expanded={menuOpen}
        >
          <Icon name="more" size={22} strokeWidth={1.8} />
        </button>
      </div>

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

      {s.clearOpen && (
        <Sheet onClose={() => s.setClearOpen(false)}>
          <div className="sheet-title">Clear annotations</div>
          <div className="sheet-group">
          <button
            className="sheet-row"
            onClick={() => {
              commit([]);
              s.setClearOpen(false);
            }}
          >
            <span>Clear this view</span>
          </button>
          <button
            className="sheet-row destructive"
            onClick={() => {
              commit([]);
              s.setAllViewsCleared(true);
              s.setClearOpen(false);
            }}
          >
            <span>Clear all views on this song</span>
            <Icon name="trash" size={17} strokeWidth={1.8} />
          </button>
          </div>
          <div className="sheet-group">
            <button className="sheet-row sheet-row--cancel" onClick={() => s.setClearOpen(false)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

/** The settings popover's contents for one tool. */
function ToolSettings({
  tool,
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
  if (tool === "pen" || tool === "square") {
    return <InkControls value={penStyle} onChange={onPenStyleChange} sizeRange={[1, 14]} opacityRange={[0.3, 1]} />;
  }
  if (tool === "highlighter") {
    return <InkControls value={highlighterStyle} onChange={onHighlighterStyleChange} sizeRange={[6, 34]} opacityRange={[0.1, 0.7]} />;
  }
  if (tool === "text" || tool === "notation") {
    return (
      <>
        {tool === "notation" && (
          <Paged
            pages={chunk(NOTATION_SYMBOLS, GLYPHS_PER_PAGE)}
            label="Notation page"
            renderPage={(syms) => (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, alignContent: "start" }}>
                {syms.map((sym) => (
                  <button
                    key={sym.id}
                    className={"glyph-cell" + (armedSymbol.id === sym.id ? " active" : "")}
                    onClick={() => onArmSymbol(sym)}
                    aria-label={sym.label}
                    aria-pressed={armedSymbol.id === sym.id}
                    title={sym.label}
                    style={{ color: markStyle.color }}
                  >
                    <SmuflGlyph glyph={sym.smufl} size={28} />
                  </button>
                ))}
              </div>
            )}
          />
        )}
        <ColorGrid value={markStyle.color} onChange={(color) => onMarkStyleChange({ ...markStyle, color })} />
        <NumberField label="Size" value={markStyle.size} unit="pt" min={10} max={48} onChange={(size) => onMarkStyleChange({ ...markStyle, size })} />
      </>
    );
  }
  if (tool === "shapes") {
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
          {SHAPE_LIST.map((sh) => (
            <button
              key={sh.id}
              className={"glyph-cell" + (armedShape === sh.id ? " active" : "")}
              onClick={() => onArmShape(sh.id)}
              aria-label={sh.label}
              aria-pressed={armedShape === sh.id}
              title={sh.label}
            >
              <ShapeGlyph shapeId={sh.id} color={armedShape === sh.id ? shapeStyle.color : "var(--mut)"} size={15} />
            </button>
          ))}
        </div>
        <ColorGrid value={shapeStyle.color} onChange={(color) => onShapeStyleChange({ ...shapeStyle, color })} />
        <NumberField label="Size" value={shapeStyle.size} unit="pt" min={12} max={48} onChange={(size) => onShapeStyleChange({ ...shapeStyle, size })} />
      </>
    );
  }
  if (tool === "eraser") {
    return <NumberField label="Eraser size" value={eraserSize} unit="pt" min={8} max={40} onChange={onEraserSizeChange} />;
  }
  if (tool === "pin") {
    return <div className="popover-hint">Tap the chart to drop a pin.</div>;
  }
  return null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** Horizontally paged content with iOS page dots, e.g. color swatches or
 * the notation stamp grid. */
function Paged<T>({ pages, label, renderPage }: { pages: T[]; label: string; renderPage: (page: T, index: number) => React.ReactNode }) {
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
      <div ref={scrollRef} onScroll={onScroll} className="paged">
        {pages.map((p, i) => (
          <div key={i}>{renderPage(p, i)}</div>
        ))}
      </div>
      {pages.length > 1 && (
        <div className="page-dots">
          {pages.map((_, i) => (
            <button key={i} className={page === i ? "active" : ""} onClick={() => goTo(i)} aria-label={`${label} ${i + 1}`} />
          ))}
        </div>
      )}
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

/** Swatches per color page: one row of 8, paged with dots. */
const SWATCHES_PER_PAGE = 8;

function ColorGrid({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <Paged
      pages={chunk(PALETTE_PAGES.flat(), SWATCHES_PER_PAGE)}
      label="Color page"
      renderPage={(colors) => (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${SWATCHES_PER_PAGE}, 1fr)`, padding: "6px 2px" }}>
          {colors.map((c) => (
            <button
              key={c}
              className={"swatch" + (value === c ? " active" : "")}
              onClick={() => onChange(c)}
              aria-label={`Color ${c}`}
              aria-pressed={value === c}
              style={{ background: c }}
            />
          ))}
        </div>
      )}
    />
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
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 15 }}>{label}</span>
        <span>
          <span style={{ fontSize: 17, fontWeight: 600, color: "var(--acc-deep)", fontVariantNumeric: "tabular-nums" }}>{value}</span>{" "}
          <span style={{ fontSize: 12, color: "var(--acc-deep)" }}>{unit}</span>
        </span>
      </div>
      <input
        type="range"
        className="ios-slider"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--fill-pct": `${pct}%` } as React.CSSProperties}
      />
    </div>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ColorGrid value={value.color} onChange={(color) => onChange({ ...value, color })} />
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        <InkPreview color={value.color} size={value.size} opacity={value.opacity} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
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
      </div>
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
      <InkPreview color={color} size={size} opacity={opacity} points={item.points} />
      <ColorGrid value={color} onChange={onColorChange} />
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
