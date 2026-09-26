import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
import type { MusicalAnchor, StaveSpacing } from "../state/types";
import { KeyAwareTransposeCalculator } from "../utils/scoreTranspose";

const MIN_ENGRAVING_ZOOM = 0.5;
const MAX_ENGRAVING_ZOOM = 2.5;
/** How long the wheel has to rest before a wheel zoom re-lays-out. */
const WHEEL_COMMIT_MS = 180;

/** `osmd.EngravingRules` values for each spacing preset — `StaffDistance` is
 * the vertical gap between staves within one system (e.g. a piano grand
 * staff); `MinimumDistanceBetweenSystems` is the gap between systems (rows
 * of music) — the one that actually creates room to write between lines on
 * a typical single-staff lead sheet. OSMD's own defaults are ~7 for both
 * (checked against the installed 2.1.2 bundle), used here as "default".
 * Applied once at construction (see the load effect below), not reactively:
 * a spacing change in Settings should only affect a score the next time
 * it's freshly loaded, never reflow an already-rendered (possibly
 * annotated) one, so it never interacts with the Annotate freeze rule. */
const STAVE_SPACING_RULES: Record<StaveSpacing, { staffDistance: number; systemDistance: number }> = {
  compact: { staffDistance: 5, systemDistance: 5 },
  default: { staffDistance: 7, systemDistance: 7 },
  roomy: { staffDistance: 10, systemDistance: 13 },
};

/** Finds the measure whose bounding box contains (or is nearest to) a point
 * already converted into OSMD's internal units, and expresses that point as
 * a 0..1 fraction of that measure's own box — see `MusicalAnchor` in
 * state/types.ts for why a fraction survives the measure resizing and an
 * absolute unit offset wouldn't. `osmd`/its graphical objects are typed as
 * `any` here deliberately: `GraphicalMeasure`/`BoundingBox` aren't part of
 * the package's stable/documented surface the way `OpenSheetMusicDisplay`
 * itself is, so this narrows to exactly the handful of fields
 * (`GraphicSheet.MeasureList`, `PositionAndShape.AbsolutePosition`/`.Size`)
 * actually used rather than pulling in their full internal type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findNearestMeasureAnchor(osmd: any, pointInUnits: { x: number; y: number }): MusicalAnchor | null {
  const measureList: any[][] = osmd.GraphicSheet.MeasureList; // eslint-disable-line @typescript-eslint/no-explicit-any
  let best: { mi: number; si: number; measure: any } | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  let bestDist = Infinity;
  let bestInside = false;
  for (let mi = 0; mi < measureList.length; mi++) {
    const row = measureList[mi];
    for (let si = 0; si < row.length; si++) {
      const measure = row[si];
      if (!measure) continue;
      const box = measure.PositionAndShape;
      const pos = box.AbsolutePosition;
      const size = box.Size;
      const inside =
        pointInUnits.x >= pos.x && pointInUnits.x <= pos.x + size.width && pointInUnits.y >= pos.y && pointInUnits.y <= pos.y + size.height;
      const cx = pos.x + size.width / 2;
      const cy = pos.y + size.height / 2;
      const dx = pointInUnits.x - cx;
      const dy = pointInUnits.y - cy;
      const dist = dx * dx + dy * dy;
      if (inside && !bestInside) {
        best = { mi, si, measure };
        bestDist = dist;
        bestInside = true;
      } else if (inside === bestInside && dist < bestDist) {
        best = { mi, si, measure };
        bestDist = dist;
      }
    }
  }
  if (!best) return null;
  const box = best.measure.PositionAndShape;
  const pos = box.AbsolutePosition;
  const size = box.Size;
  return {
    measureIndex: best.mi,
    staffIndex: best.si,
    fx: size.width ? (pointInUnits.x - pos.x) / size.width : 0,
    fy: size.height ? (pointInUnits.y - pos.y) / size.height : 0,
  };
}

export interface MxlScoreHandle {
  /** Anchors a viewport-relative point (a PointerEvent's clientX/clientY) to
   * its nearest rendered measure — null if the score isn't ready yet. */
  anchorAtClientPoint(clientX: number, clientY: number): MusicalAnchor | null;
  /** Re-derives a stored anchor's current viewport-relative position after a
   * re-render (see `onRerendered`) — null if the score isn't ready. Doesn't
   * fail on the anchor's measure/staff having disappeared, since transpose
   * never removes measures or staves; a stale index would only occur from
   * corrupt data. */
  clientPointForAnchor(anchor: MusicalAnchor): { clientX: number; clientY: number } | null;
}

/** Where a zoom gesture was aimed, so the committed re-layout can scroll
 * the same part of the score back under it. `ratio` is the focus point's
 * position down the score as a 0..1 fraction of its height at gesture start
 * (a re-engrave reflows measures between lines, so an absolute offset
 * wouldn't survive it); `clientY` is where on screen it should land. */
interface ZoomFocus {
  ratio: number;
  clientY: number;
}

/** Pinch/wheel-driven zoom that changes the score's actual engraving size
 * (OSMD's own Zoom factor) rather than magnifying a fixed picture. Zooming
 * out shrinks notation so more measures fit per line at the SAME screen
 * width; zooming in does the opposite — exactly how a real notation app's
 * zoom behaves, as opposed to a photo/PDF viewer's camera zoom (which was
 * what the first version of this did: scale + pan over a fixed layout).
 *
 * A real OSMD re-layout (updateGraphic + render) is far too expensive to
 * run during a pinch: on a tablet it blocks the main thread long enough to
 * drop touch input, and it replaces the score's SVG nodes mid-gesture. So a
 * pinch only moves a CSS transform preview (written straight to the DOM,
 * once per frame, scaled from the point between the fingers) and commits a
 * single re-layout when the fingers lift. Wheel zoom has no "lift", so it
 * commits after the wheel has been idle for WHEEL_COMMIT_MS.
 *
 * Owns its own callback ref rather than taking a plain useRef: the container
 * <div> doesn't exist yet while the score is still loading, so a normal
 * useRef + useEffect(..., [ref]) would fire once against a null node and
 * never re-attach once the real element showed up (a ref object's identity
 * never changes, so it can't be an effect dependency that triggers a rerun). */
function useEngravingZoom(onCommit: (zoom: number, focus: ZoomFocus | null) => void, disableZoom: boolean) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const committedZoom = useRef(1);
  const previewScale = useRef(1);
  const focus = useRef<ZoomFocus | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number } | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frame = useRef<number | null>(null);
  const lastTap = useRef(0);
  // Whether the gesture now in progress has become a two-finger pinch.
  // Only a pinch is kept from the stage: a one-finger horizontal drag has to
  // reach Live Stage's song-to-song swipe, which listens on an ancestor.
  const pinched = useRef(false);

  const clampZoom = (z: number) => Math.min(MAX_ENGRAVING_ZOOM, Math.max(MIN_ENGRAVING_ZOOM, z));

  const paintPreview = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = previewRef.current;
      if (node) node.style.transform = previewScale.current !== 1 ? `scale(${previewScale.current})` : "";
    });
  };

  /** Pins the preview's transform origin to a screen point and remembers
   * where in the score that point falls, before any scaling is applied. */
  const beginPreview = (clientX: number, clientY: number) => {
    const node = previewRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.transformOrigin = `${clientX - rect.left}px ${clientY - rect.top}px`;
    focus.current = { ratio: rect.height ? (clientY - rect.top) / rect.height : 0, clientY };
  };

  const setPreview = (zoom: number) => {
    previewScale.current = clampZoom(zoom) / committedZoom.current;
    paintPreview();
  };

  const commit = () => {
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = null;
    const zoom = clampZoom(committedZoom.current * previewScale.current);
    const f = focus.current;
    focus.current = null;
    // The preview transform is cleared by the caller's re-render effect via
    // `clearPreview`, in the same frame the new layout lands, so the score
    // never flashes back to its old size in between.
    if (Math.abs(zoom - committedZoom.current) < 0.001) {
      clearPreview();
      return;
    }
    committedZoom.current = zoom;
    onCommit(zoom, f);
  };

  const clearPreview = () => {
    previewScale.current = 1;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (previewRef.current) previewRef.current.style.transform = "";
  };

  const reset = () => {
    previewScale.current = 1 / committedZoom.current;
    focus.current = null;
    commit();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // A primary pointer starts a brand-new touch sequence, so anything still
    // tracked is a finger whose up/cancel never arrived. Left in place it
    // would pair with the next single finger as a phantom pinch.
    if (e.isPrimary) {
      pointers.current.clear();
      pinchStart.current = null;
      pinched.current = false;
    }
    try {
      // Captured on the container, which survives re-renders; capturing on
      // e.target (an SVG node inside the score) lost the up/cancel event
      // whenever OSMD replaced that node.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Capture is a nice-to-have (keeps tracking a finger dragged off the
      // element) — its failure shouldn't stop gesture tracking itself.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      pinched.current = true;
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      beginPreview((a.x + b.x) / 2, (a.y + b.y) / 2);
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 320) {
        reset();
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    if (pinched.current) e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setPreview(committedZoom.current * (dist / pinchStart.current.dist));
      if (focus.current) focus.current.clientY = (a.y + b.y) / 2;
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    // A pinch's fingers lifting mustn't read as a swipe to the next song.
    if (pinched.current) e.stopPropagation();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) pinched.current = false;
    // The pinch is over as soon as it's no longer two fingers — commit the
    // one real re-layout now rather than waiting for the last finger.
    if (pinchStart.current && pointers.current.size < 2) {
      pinchStart.current = null;
      commit();
    }
  };

  // Attached natively (not via React's onWheel) because React's synthetic
  // wheel listener is registered passive — calling preventDefault() inside
  // it throws instead of stopping the page from scrolling/zooming. Keyed on
  // `el` (state, set by the callback ref below) rather than a plain ref, so
  // this actually re-runs once the container mounts after the score loads.
  useEffect(() => {
    if (!el || disableZoom) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      e.stopPropagation();
      if (!wheelTimer.current) beginPreview(e.clientX, e.clientY);
      setPreview(committedZoom.current * previewScale.current * Math.exp(-e.deltaY * 0.01));
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      wheelTimer.current = setTimeout(commit, WHEEL_COMMIT_MS);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, disableZoom]);

  // If a pinch/pan gesture is physically mid-flight when disableZoom flips
  // to true, the pointer handlers below get dropped from the container's
  // JSX on this same render — so the in-flight pointer's onPointerUp/
  // onPointerCancel never fires and these refs would otherwise be left with
  // stale entries until unmount. Clear them here instead of relying on
  // handlers that are no longer attached.
  useEffect(() => {
    if (!disableZoom) return;
    pointers.current.clear();
    pinchStart.current = null;
    pinched.current = false;
    focus.current = null;
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = null;
    clearPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disableZoom]);

  useEffect(
    () => () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  return {
    el,
    containerRef: setEl,
    previewRef,
    clearPreview,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onDoubleClick: reset,
    reset,
  };
}

/** Nearest ancestor that actually scrolls vertically — Live Stage's chart
 * pane, in practice. */
function scrollParentOf(node: HTMLElement): HTMLElement | null {
  for (let p = node.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export interface ScoreInstrument {
  id: string;
  name: string;
}

/** Renders the song's actual attached score using OpenSheetMusicDisplay (a
 * real MusicXML notation-rendering engine — the same class of tool real
 * notation software is built on, not a from-scratch reimplementation of
 * music engraving). Hand-drawing clefs/noteheads/beams from primitives was
 * tried first and repeatedly fell short of looking like real typeset sheet
 * music — spacing, glyph shapes, and multi-staff layout are exactly the
 * hard parts a dedicated engine already solves. */
export const MxlScore = forwardRef<
  MxlScoreHandle,
  {
    src: string;
    /** Semitones to transpose the actual notated pitches by — the same
     * transpose that shifts the chord chart, applied to real notation instead
     * of chord letters. */
    transpose?: number;
    /** The key picked on the chips. A transposed score's key signature and
     * notes follow its spelling (see KeyAwareTransposeCalculator). */
    targetKey?: string;
    /** Instrument ids to hide (for multi-part scores — a piano-only file like
     * the seeded default song has nothing to hide, but this is ready the
     * moment a multi-instrument score is attached). */
    hiddenParts?: ReadonlySet<string>;
    /** Called once the score's real instrument list is known, so a parent
     * toolbar can offer per-instrument show/hide without re-parsing anything. */
    onInstrumentsChange?: (instruments: ScoreInstrument[]) => void;
    /** Disables the internal pinch/wheel engraving-zoom gesture entirely —
     * disabled while this view carries drawn annotation strokes, since OSMD's
     * zoom is a real re-engrave (`osmd.Zoom` + `updateGraphic()`), not a
     * camera transform that could be applied after the fact on top of marks
     * drawn at a fixed scale. */
    disableZoom?: boolean;
    /** Vertical stave/system spacing preset, applied once at load — see
     * `STAVE_SPACING_RULES` above for why this isn't reactive. */
    staveSpacing?: StaveSpacing;
    /** Called after a transpose-triggered re-render finishes — the signal a
     * parent uses to reproject anchored pins/ink via this component's
     * `clientPointForAnchor`. Deliberately not called from the
     * hiddenParts/zoom effects below: those controls stay locked by the
     * Annotate freeze rule instead of being reprojected. */
    onRerendered?: () => void;
  }
>(function MxlScore({ src, transpose = 0, targetKey, hiddenParts, onInstrumentsChange, disableZoom = false, staveSpacing = "default", onRerendered }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const transposerRef = useRef<KeyAwareTransposeCalculator | null>(null);
  const unitInPixelsRef = useRef(10);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [engravingZoom, setEngravingZoom] = useState(1);
  const pendingFocus = useRef<ZoomFocus | null>(null);
  const ez = useEngravingZoom((zoom, focus) => {
    pendingFocus.current = focus;
    setEngravingZoom(zoom);
  }, disableZoom);

  useImperativeHandle(
    ref,
    () => ({
      anchorAtClientPoint(clientX, clientY) {
        const osmd = osmdRef.current;
        const el = ez.el;
        if (!osmd || !el || status !== "ready") return null;
        const rect = el.getBoundingClientRect();
        const f = unitInPixelsRef.current * osmd.Zoom;
        return findNearestMeasureAnchor(osmd, { x: (clientX - rect.left) / f, y: (clientY - rect.top) / f });
      },
      clientPointForAnchor(anchor) {
        const osmd = osmdRef.current;
        const el = ez.el;
        if (!osmd || !el || status !== "ready") return null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const measureList: any[][] = (osmd as any).GraphicSheet.MeasureList;
        const measure = measureList[anchor.measureIndex]?.[anchor.staffIndex];
        if (!measure) return null;
        const box = measure.PositionAndShape;
        const pos = box.AbsolutePosition;
        const size = box.Size;
        const rect = el.getBoundingClientRect();
        const f = unitInPixelsRef.current * osmd.Zoom;
        return {
          clientX: (pos.x + anchor.fx * size.width) * f + rect.left,
          clientY: (pos.y + anchor.fy * size.height) * f + rect.top,
        };
      },
    }),
    [status, ez.el]
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    (async () => {
      if (!hostRef.current) return;
      const osmdModule = await import("opensheetmusicdisplay");
      const { OpenSheetMusicDisplay: OSMD, unitInPixels } = osmdModule;
      if (cancelled || !hostRef.current) return;
      unitInPixelsRef.current = unitInPixels;
      hostRef.current.innerHTML = "";
      const osmd = new OSMD(hostRef.current, {
        backend: "svg",
        autoResize: false,
        drawTitle: false,
        drawComposer: false,
        drawLyricist: false,
        drawPartNames: false,
        drawingParameters: "compacttight",
        disableCursor: true,
      });
      const transposer = new KeyAwareTransposeCalculator(osmdModule);
      transposerRef.current = transposer;
      osmd.TransposeCalculator = transposer;
      const rules = STAVE_SPACING_RULES[staveSpacing];
      osmd.EngravingRules.StaffDistance = rules.staffDistance;
      osmd.EngravingRules.MinimumDistanceBetweenSystems = rules.systemDistance;
      osmdRef.current = osmd;
      try {
        // osmd.load(string) only recognizes raw XML text, raw zip bytes, or
        // a short URL to fetch itself — a user-imported .mxl's base64 data
        // URL (routinely thousands of characters) matches none of those, so
        // it gets silently rejected as an invalid document. Fetching it into
        // a Blob first hits osmd's Blob branch instead, which unzips a real
        // .mxl correctly regardless of source (data URL or plain URL alike).
        const blob = await (await fetch(src)).blob();
        if (cancelled || !hostRef.current) return;
        await osmd.load(blob);
        if (cancelled || !hostRef.current) return;
        onInstrumentsChange?.(osmd.Sheet.Instruments.map((i) => ({ id: String(i.Id), name: i.Name })));
        transposer.apply(osmd.Sheet, transpose, targetKey ?? null);
        osmd.Zoom = engravingZoom;
        for (const inst of osmd.Sheet.Instruments) inst.Visible = !hiddenParts?.has(String(inst.Id));
        osmd.render();
        if (cancelled || !hostRef.current) return;
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // transpose/hiddenParts/engravingZoom are applied by the effects below
    // once the score is loaded — re-running this whole load/parse/unzip
    // pipeline for a key or zoom change would be needlessly expensive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== "ready") return;
    transposerRef.current?.apply(osmd.Sheet, transpose, targetKey ?? null);
    osmd.updateGraphic();
    osmd.render();
    // The one re-render `onRerendered` fires from — a transpose is the only
    // control here a parent is expected to reproject rather than lock, per
    // the Annotate freeze rule (see the `onRerendered` prop doc above).
    onRerendered?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transpose, targetKey, status]);

  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== "ready") return;
    for (const inst of osmd.Sheet.Instruments) inst.Visible = !hiddenParts?.has(String(inst.Id));
    osmd.updateGraphic();
    osmd.render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenParts, status]);

  // The committed half of pinch/wheel zoom (see useEngravingZoom above) —
  // actually re-lays-out the score at the new engraving size.
  useEffect(() => {
    const osmd = osmdRef.current;
    if (!osmd || status !== "ready") return;
    osmd.Zoom = engravingZoom;
    osmd.updateGraphic();
    osmd.render();
    ez.clearPreview();
    // Scroll so the part of the score the gesture was aimed at lands back
    // under the fingers, instead of wherever the reflow happened to put it.
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    const host = hostRef.current;
    const scroller = host && focus ? scrollParentOf(host) : null;
    if (host && focus && scroller) {
      const rect = host.getBoundingClientRect();
      scroller.scrollTop += rect.top + focus.ratio * rect.height - focus.clientY;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engravingZoom, status]);

  // OSMD lays out line breaks and spacing against the container's width at
  // the moment render() runs — it doesn't watch for the container itself
  // changing size afterward (switching the Phone/Tablet frame, an actual
  // window resize, a device rotation). Re-running updateGraphic()+render()
  // on real width changes is what makes the score actually use the wider
  // frame instead of staying laid out for whatever width it first saw,
  // padded out with blank space. autoResize:true (OSMD's own built-in
  // version of this) only listens for window `resize`, which never fires
  // for an inner frame resize like the Phone/Tablet toggle, so it wouldn't
  // have caught this case either — the container needs its own observer.
  useEffect(() => {
    const el = ez.el;
    const osmd = osmdRef.current;
    if (!el || !osmd || status !== "ready") return;
    let lastWidth = el.clientWidth;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (Math.abs(width - lastWidth) < 2) return;
      lastWidth = width;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        osmd.updateGraphic();
        osmd.render();
      }, 120);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ez.el, status]);

  const zoomedOffDefault = Math.abs(engravingZoom - 1) > 0.02;

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6, alignItems: "center" }}>
      {status === "loading" && (
        <div className="muted" style={{ fontSize: 13, padding: "20px 0", textAlign: "center" }}>
          Loading score…
        </div>
      )}
      {status === "error" && (
        <div className="muted" style={{ fontSize: 13, padding: "20px 0", textAlign: "center" }}>
          Couldn't read this score.
        </div>
      )}
      <div
        ref={ez.containerRef}
        style={{
          // Hidden via visibility, not display: OSMD needs to measure a real
          // non-zero width to lay the score out correctly while it's loading
          // — display:none collapses the box to zero width, which is why
          // this rendered incorrectly the first time.
          visibility: status === "ready" ? "visible" : "hidden",
          width: "100%",
          touchAction: "pan-y",
          borderRadius: 8,
          // Clips the pinch preview, which scales past the container's edges.
          overflow: "hidden",
          // Real sheet music is printed on white paper regardless of the
          // app's theme — like a PDF viewer, the page stays white/black even
          // in Stage Dark, rather than trying to re-theme the engraving.
          background: "#fff",
        }}
        {...(disableZoom
          ? {}
          : {
              onPointerDown: ez.onPointerDown,
              onPointerMove: ez.onPointerMove,
              onPointerUp: ez.onPointerUp,
              onPointerCancel: ez.onPointerCancel,
              onDoubleClick: ez.onDoubleClick,
            })}
      >
        {/* The preview scale is a stand-in for the next real layout, not a
            substitute for it — it stretches the CURRENT (soon-to-be-stale)
            render from the point between the fingers while the gesture is in
            flight, then is cleared the instant the real layout lands. Its
            transform is written directly by useEngravingZoom, not via React
            state, so a pinch doesn't re-render this component every frame. */}
        <div ref={ez.previewRef} style={{ willChange: "transform" }}>
          <div ref={hostRef} />
        </div>
      </div>
      {zoomedOffDefault && !disableZoom && (
        <button className="chip" onClick={ez.reset} style={{ alignSelf: "center" }}>
          Reset zoom
        </button>
      )}
    </div>
  );
});
