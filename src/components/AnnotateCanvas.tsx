import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { AnnotationObject, Pin, Stroke } from "../state/types";
import { STROKE_WIDTH, hitTestAnnotation, isPin, resolveAccentColor } from "../utils/annotations";
import type { MxlScoreHandle } from "./MxlScore";
import { Icon } from "./Icon";

export type AnnotateTool = "pen" | "square" | "pin" | "eraser";

function strokesOf(annotations: AnnotationObject[]): Stroke[] {
  return annotations.filter((a): a is Stroke => !isPin(a));
}

/** Wraps `children` (the real chart/attachment content) in a canvas overlay
 * that turns pointer drags into `Stroke`s, plus a sibling DOM layer of pin
 * badges — the canvas is sized to the wrapped content's natural height and
 * lives inside the same scrollable ancestor as that content, so native
 * scroll carries everything together with no extra wiring — see the spec's
 * "Canvas mechanics" section. */
export function AnnotateCanvas({
  annotations,
  tool,
  onCommit,
  onReproject,
  scrollMode,
  scoreRef,
  reprojectSignal,
  children,
}: {
  annotations: AnnotationObject[];
  tool: AnnotateTool;
  /** Called with the full next array whenever a draw/erase/pin gesture
   * changes it — the caller owns undo history; this component only reports
   * finished user mutations. */
  onCommit: (next: AnnotationObject[]) => void;
  /** Called instead of `onCommit` when positions are being silently synced
   * to a re-rendered score (see `reprojectSignal`) rather than changed by
   * the person — this is not a user edit, so it must not push an undo-history
   * entry the way `onCommit` does. */
  onReproject: (next: AnnotationObject[]) => void;
  /** true pauses drawing so the wrapped content can be scrolled with a
   * normal single-finger drag instead — a single finger can't both draw
   * and scroll, so Annotate mode's tool row offers this as an explicit
   * toggle. */
  scrollMode: boolean;
  /** Only meaningful for the `musicxml` view — lets pin/stroke placement
   * anchor to the score's nearest measure, and lets `reprojectSignal`
   * reposition existing anchored annotations after a transpose. Omitted on
   * every other view (chords/image/pdf), which have no measures to anchor
   * to. */
  scoreRef?: RefObject<MxlScoreHandle | null>;
  /** Changes value whenever the score behind `scoreRef` just re-rendered
   * from a transpose — triggers a reprojection pass via `onReproject`. */
  reprojectSignal?: number;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draft = useRef<Stroke | null>(null);
  const activePointer = useRef<number | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number; text: string; anchor: Pin["anchor"]; isNew: boolean } | null>(
    null
  );

  // Re-measures the wrapped content's natural size, but only while nothing
  // has been placed yet on this view — once an annotation exists, the size
  // freezes so redrawn marks never silently drift out of place. The controls
  // that could otherwise change this content's layout (chord-chart zoom,
  // lyrics-only, MusicXML engraving zoom, instrument visibility) are
  // disabled elsewhere for the same reason once a view has annotations.
  // Transpose is deliberately NOT one of those controls — see the spec's
  // "Freeze rule (revised)": it reprojects instead of locking.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.scrollHeight });
    measure();
    if (annotations.length > 0) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [annotations.length]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = resolveAccentColor(canvas);
    ctx.lineWidth = STROKE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const all = draft.current ? [...strokesOf(annotations), draft.current] : strokesOf(annotations);
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
    // re-runs whenever `annotations` or `size` change, and the handlers call
    // the canvas's 2D context directly for the in-progress preview in between.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotations, size]);

  // Reprojection: silently re-derives every anchored pin/stroke's on-screen
  // position from the score's current layout after a transpose-triggered
  // re-render — see MxlScoreHandle.clientPointForAnchor. Not a user edit, so
  // it goes through `onReproject`, not `onCommit` (no undo-history entry).
  useEffect(() => {
    const handle = scoreRef?.current;
    const wrapperEl = wrapperRef.current;
    if (!handle || !wrapperEl || reprojectSignal === undefined) return;
    const rect = wrapperEl.getBoundingClientRect();
    const toContent = (client: { clientX: number; clientY: number }) => ({ x: client.clientX - rect.left, y: client.clientY - rect.top });
    let changed = false;
    const next = annotations.map((a) => {
      if (isPin(a)) {
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

  const eraseAt = (p: { x: number; y: number }) => {
    const kept = annotations.filter((a) => !hitTestAnnotation(a, p));
    if (kept.length !== annotations.length) onCommit(kept);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scrollMode) return;
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
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Nice-to-have only.
    }
    activePointer.current = e.pointerId;
    // All-or-nothing per stroke: if the very first point can't anchor (the
    // score isn't ready yet), the whole stroke stays pixel-only rather than
    // a partially-anchored array — mixing anchored and unanchored points
    // within one stroke isn't a state reprojection needs to handle.
    const firstAnchor = scoreRef?.current?.anchorAtClientPoint(e.clientX, e.clientY);
    draft.current = {
      id: `stroke-${Date.now()}`,
      tool,
      points: [p],
      anchors: firstAnchor ? [firstAnchor] : undefined,
    };
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
      ctx.strokeStyle = resolveAccentColor(canvas);
      ctx.lineWidth = STROKE_WIDTH;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of [...strokesOf(annotations), draft.current]) {
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
      onCommit([...annotations, draft.current]);
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
          pointerEvents: scrollMode || tool === "pin" ? "none" : "auto",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {/* Pin tool still needs to know where on the chart was tapped, even
          though the canvas itself ignores pointer events while it's active
          (so it doesn't also try to start a stroke) — this transparent
          layer catches the tap instead. */}
      {tool === "pin" && !scrollMode && (
        <div
          style={{ position: "absolute", inset: 0, touchAction: "none" }}
          onPointerDown={onPointerDown}
        />
      )}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {annotations.filter(isPin).map((pin) => (
          <PinBadge
            key={pin.id}
            pin={pin}
            tool={tool}
            onErase={() => onCommit(annotations.filter((a) => a.id !== pin.id))}
            onOpen={() => setEditingPin({ id: pin.id, x: pin.position.x, y: pin.position.y, text: pin.text, anchor: pin.anchor, isNew: false })}
            onDrag={(x, y, clientX, clientY) => {
              const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
              onCommit(annotations.map((a) => (isPin(a) && a.id === pin.id ? { ...a, position: { x, y }, anchor } : a)));
              if (editingPin?.id === pin.id) setEditingPin(null);
            }}
          />
        ))}
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

function PinBadge({
  pin,
  tool,
  onErase,
  onOpen,
  onDrag,
}: {
  pin: Pin;
  tool: AnnotateTool;
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
        pointerEvents: "auto",
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
          fontSize: 12,
          color: "var(--fg)",
          outline: "none",
        }}
      />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 4 }}>
        <button onClick={onDelete} style={{ fontSize: 10, fontWeight: 700, border: "none", background: "none", color: "var(--acc-deep)", padding: "2px 4px" }}>
          Delete
        </button>
        <button onClick={onDone} style={{ fontSize: 10, fontWeight: 700, border: "none", background: "none", color: "var(--acc-deep)", padding: "2px 4px" }}>
          Done
        </button>
      </div>
    </div>
  );
}
