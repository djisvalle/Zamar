import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Stroke } from "../state/types";
import { STROKE_WIDTH, hitTestStroke, resolveAccentColor } from "../utils/annotations";

export type AnnotateTool = "pen" | "square" | "eraser";

/** Wraps `children` (the real chart/attachment content) in a canvas overlay
 * that turns pointer drags into `Stroke`s. The canvas is sized to the
 * wrapped content's natural height and lives inside the same scrollable
 * ancestor as that content, so native scroll carries both together with no
 * extra wiring — see the spec's "Canvas mechanics" section. */
export function AnnotateCanvas({
  strokes,
  tool,
  onCommit,
  scrollMode,
  children,
}: {
  strokes: Stroke[];
  tool: AnnotateTool;
  /** Called with the full next strokes array whenever a draw or erase
   * gesture changes it — the caller owns undo history; this component only
   * reports finished mutations. */
  onCommit: (next: Stroke[]) => void;
  /** true pauses drawing so the wrapped content can be scrolled with a
   * normal single-finger drag instead — a single finger can't both draw
   * and scroll, so Annotate mode's tool row offers this as an explicit
   * toggle. */
  scrollMode: boolean;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draft = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Re-measures the wrapped content's natural size, but only while nothing
  // has been drawn yet on this view — once strokes exist, the size freezes
  // so redrawn strokes never silently drift out of place. The controls that
  // could otherwise change this content's layout (transpose, capo, zoom,
  // lyrics-only, instrument visibility) are disabled elsewhere for the same
  // reason once a view has strokes.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.scrollHeight });
    measure();
    if (strokes.length > 0) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [strokes.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = resolveAccentColor(canvas);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = draft.current ? [...strokes, draft.current] : strokes;
    for (const s of all) {
      if (s.points.length === 0) continue;
      if (s.tool === "square" && s.points.length === 2) {
        const [a, b] = s.points;
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      } else {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
    // draft.current is a ref (mutated imperatively by the pointer handlers
    // below, not React state) so it isn't itself a dependency — this effect
    // re-runs whenever `strokes` or `size` change, and the handlers call the
    // canvas's 2D context directly for the in-progress preview in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, size]);

  const toContentPoint = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const eraseAt = (p: { x: number; y: number }) => {
    const kept = strokes.filter((s) => !hitTestStroke(s, p));
    if (kept.length !== strokes.length) onCommit(kept);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scrollMode) return;
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Nice-to-have only.
    }
    activePointer.current = e.pointerId;
    const p = toContentPoint(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    draft.current = { id: `stroke-${Date.now()}`, tool, points: [p] };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (scrollMode || activePointer.current !== e.pointerId) return;
    e.stopPropagation();
    const p = toContentPoint(e);
    if (tool === "eraser") {
      eraseAt(p);
      return;
    }
    if (!draft.current) return;
    draft.current =
      tool === "square"
        ? { ...draft.current, points: [draft.current.points[0], p] }
        : { ...draft.current, points: [...draft.current.points, p] };
    // Repaint immediately for a live preview of the in-progress stroke —
    // `strokes`/`size` haven't changed, so the effect above won't re-run on
    // its own until the gesture finishes.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx && draft.current) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = resolveAccentColor(canvas);
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of [...strokes, draft.current]) {
        if (s.tool === "square" && s.points.length === 2) {
          const [a, b] = s.points;
          ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        } else if (s.points.length > 0) {
          ctx.beginPath();
          ctx.moveTo(s.points[0].x, s.points[0].y);
          for (const pt of s.points.slice(1)) ctx.lineTo(pt.x, pt.y);
          ctx.stroke();
        }
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    if (draft.current && draft.current.points.length > 0) {
      onCommit([...strokes, draft.current]);
    }
    draft.current = null;
  };

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
          touchAction: scrollMode ? "pan-y" : "none",
          pointerEvents: scrollMode ? "none" : "auto",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
