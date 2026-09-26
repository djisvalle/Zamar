import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { screenScaleOf } from "../utils/screenScale";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** How long a ctrl-wheel burst has to go quiet before it counts as a
 * finished zoom (same debounce as MxlScore's). */
const WHEEL_COMMIT_MS = 150;
/** Widest a page's canvas is ever drawn, in backing pixels. */
const MAX_PAGE_PX = 2600;
/** Zoomed-in pages are redrawn up to this many times screen density — the
 * detail every page used to be drawn at up front. Going further would pass
 * iOS's per-canvas size limit on a large iPad without tiling. */
const MAX_SHARPEN = 2.5;

/** Pinch/ctrl-wheel-driven camera zoom + drag-to-pan over the rendered page
 * stack — appropriate here in a way it wasn't for `MxlScore`'s notation:
 * these pages are already-fixed raster images (real vector re-layout isn't
 * possible), so magnifying the picture *is* the correct zoom, not a
 * fallback. Plain (non-ctrl) wheel is left alone so it keeps scrolling
 * through pages instead of being hijacked into zooming.
 *
 * Scale and pan live in refs and are written straight to the stack's
 * transform once per frame, so a gesture doesn't re-render React on every
 * move. State changes only when zoom crosses 1× (`zoomed`) and when a zoom
 * gesture ends (`committedScale`, which the page drawing reads to sharpen). */
function usePanZoom(hostRef: React.RefObject<HTMLDivElement | null>, disableZoom: boolean) {
  const scale = useRef(1);
  const translate = useRef({ x: 0, y: 0 });
  const [zoomed, setZoomed] = useState(false);
  const zoomedRef = useRef(false);
  const [committedScale, setCommittedScale] = useState(1);
  const frame = useRef<number | null>(null);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef(0);
  // Whether the gesture in progress is ours: a pinch, or a pan while zoomed
  // in. Anything else (a one-finger drag at normal size) has to reach Live
  // Stage's song-to-song swipe, which listens on an ancestor.
  const claimed = useRef(false);
  /** The pane the stack scrolls in, found once per gesture (walking
   * ancestors with getComputedStyle is too slow to repeat on every move).
   * `null` means none was found and the window bounds the view. */
  const scrollBox = useRef<HTMLElement | null | undefined>(undefined);

  const findScrollBox = () => {
    scrollBox.current = null;
    for (let p = hostRef.current?.parentElement?.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === "auto" || oy === "scroll" || oy === "hidden") {
        scrollBox.current = p;
        return;
      }
    }
  };

  const clampScale = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  const clampX = (x: number, s: number) => {
    const width = hostRef.current?.clientWidth ?? 0;
    const max = (width * (s - 1)) / 2;
    return Math.min(max, Math.max(-max, x));
  };
  /** Keeps the zoomed page stack covering the part of it that's on screen.
   * Vertical pan used to be left unbounded, which let a drag carry the
   * pages off-screen into an endless blank area. Bounds come from the
   * visible slice of the stack (it usually sits in a scrolled pane and is
   * taller than the screen), measured in the stack's own unscaled
   * coordinates: with the transform origin at the top, a content point y
   * lands at ty + s·y. */
  const clampY = (y: number, s: number) => {
    const host = hostRef.current;
    const frameEl = host?.parentElement;
    if (!host || !frameEl) return y;
    if (scrollBox.current === undefined) findScrollBox();
    const height = host.offsetHeight;
    const frameTop = frameEl.getBoundingClientRect().top;
    let viewTop = 0;
    let viewBottom = window.innerHeight;
    if (scrollBox.current) {
      const r = scrollBox.current.getBoundingClientRect();
      viewTop = r.top;
      viewBottom = r.bottom;
    }
    const k = frameScale();
    const top = Math.max(0, (viewTop - frameTop) / k);
    const bottom = Math.min(height, (viewBottom - frameTop) / k);
    const min = bottom - s * height;
    return Math.min(top, Math.max(min, y));
  };
  /** Screen pixels per pixel of the page stack's own layout — more than 1
   * where Live Stage magnifies the chart (see screenScaleOf). Pan and the
   * pane bounds come in screen pixels; `translate` is in layout pixels.
   * Measured on the frame, which the zoom transform doesn't touch. */
  const frameScale = () => screenScaleOf(hostRef.current?.parentElement);
  const clampT = (t: { x: number; y: number }, s: number) => ({ x: clampX(t.x, s), y: clampY(t.y, s) });

  /** Writes the current scale and pan on the next frame. */
  const paint = () => {
    const z = Math.abs(scale.current - 1) > 0.02;
    if (z !== zoomedRef.current) {
      zoomedRef.current = z;
      setZoomed(z);
    }
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = hostRef.current;
      if (!node) return;
      const { x, y } = translate.current;
      const s = scale.current;
      node.style.transform = s === 1 && x === 0 && y === 0 ? "" : `translate(${x}px, ${y}px) scale(${s})`;
    });
  };

  const commit = () => setCommittedScale(scale.current);

  const reset = () => {
    scale.current = 1;
    translate.current = { x: 0, y: 0 };
    paint();
    commit();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // A primary pointer starts a new touch sequence, so anything still
    // tracked is a finger whose up/cancel was lost. Left in place it would
    // turn the next one-finger drag into a phantom pinch.
    if (e.isPrimary) {
      pointers.current.clear();
      pinchStart.current = null;
      panStart.current = null;
      claimed.current = false;
    }
    try {
      // On the container, not e.target: a page canvas can be swapped out
      // mid-gesture, and capture on a removed node loses the up event.
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Nice-to-have only.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: scale.current };
      panStart.current = null;
      claimed.current = true;
      findScrollBox();
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 320) {
        reset();
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      if (scale.current > 1) {
        panStart.current = { x: e.clientX, y: e.clientY, tx: translate.current.x, ty: translate.current.y };
        claimed.current = true;
        findScrollBox();
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    if (claimed.current) e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = clampScale(pinchStart.current.scale * (dist / pinchStart.current.dist));
      scale.current = next;
      translate.current = clampT(translate.current, next);
      paint();
    } else if (pointers.current.size === 1 && panStart.current) {
      const k = frameScale();
      const next = { x: panStart.current.tx + (e.clientX - panStart.current.x) / k, y: panStart.current.ty + (e.clientY - panStart.current.y) / k };
      translate.current = clampT(next, scale.current);
      paint();
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    // A pinch or pan ending mustn't read as a swipe to the next song.
    if (claimed.current) e.stopPropagation();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && pinchStart.current) {
      pinchStart.current = null;
      commit();
    }
    if (pointers.current.size === 0) {
      panStart.current = null;
      claimed.current = false;
    }
  };

  // Native, not React's onWheel: the synthetic wheel listener is passive,
  // so preventDefault() inside it throws instead of stopping page scroll.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || disableZoom) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (wheelTimer.current === null) findScrollBox();
      else clearTimeout(wheelTimer.current);
      const next = clampScale(scale.current * Math.exp(-e.deltaY * 0.01));
      scale.current = next;
      translate.current = clampT(translate.current, next);
      paint();
      wheelTimer.current = setTimeout(() => {
        wheelTimer.current = null;
        commit();
      }, WHEEL_COMMIT_MS);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disableZoom]);

  // If a pinch/pan gesture is physically mid-flight when disableZoom flips
  // to true, the pointer handlers below get dropped from the container's
  // JSX on this same render — so the in-flight pointer's onPointerUp/
  // onPointerCancel never fires and these refs would otherwise be left with
  // stale entries until unmount. Clear them here instead of relying on
  // handlers that are no longer attached.
  useEffect(() => {
    if (!disableZoom) return;
    if (pinchStart.current) commit();
    pointers.current.clear();
    pinchStart.current = null;
    panStart.current = null;
    claimed.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disableZoom]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (wheelTimer.current !== null) clearTimeout(wheelTimer.current);
    },
    []
  );

  return { zoomed, committedScale, onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onDoubleClick: reset, reset };
}

/** One page's drawn canvases. `sharp` is a zoomed-in redraw; when present
 * it's the one in the slot, and `base` waits behind it for a zoom-out. */
interface PageCanvases {
  base: HTMLCanvasElement | null;
  sharp: HTMLCanvasElement | null;
  /** Drawing this page threw (not a cancel); it isn't retried. */
  failed: boolean;
}

interface RenderJob {
  page: number;
  kind: "base" | "sharp";
  pixelWidth: number;
}

/** Shrinking a canvas to 0×0 before dropping it frees its backing store
 * right away on iOS WebKit and Chrome, instead of whenever GC gets to it. */
function releaseCanvas(c: HTMLCanvasElement | null) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
  c.remove();
}

/** Renders a PDF's actual pages as a plain vertical stack of canvases, via
 * pdf.js — not the browser's native PDF plugin (`<embed type="application/
 * pdf">`), which brings its own chrome (page-thumbnail rail, toolbar,
 * page-count/zoom/print/download controls, its own scrollbar) that can't be
 * styled or removed and, on top of that, isn't even available inside a
 * Capacitor WebView on Android/iOS. This draws only the page content, so it
 * behaves the same in-app as it does in a desktop browser during `npm run
 * dev`.
 *
 * Every page gets a slot at its final size as soon as the document opens,
 * so the stack's layout (which Annotate marks and export are measured
 * against) never shifts. Pages are then drawn one at a time, nearest to the
 * screen first, at screen density; pages on screen are redrawn sharper
 * after a zoom, and pages far off screen give their canvases back. See
 * docs/superpowers/specs/2026-09-27-pdf-progressive-rendering-design.md. */
export function PdfPages({ src, disableZoom = false }: { src: string; disableZoom?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  // Each page's size at scale 1, in PDF points (rotation applied).
  const [pages, setPages] = useState<{ w: number; h: number }[]>([]);
  const pz = usePanZoom(containerRef, disableZoom);

  const doc = useRef<any>(null);
  const slots = useRef<(HTMLDivElement | null)[]>([]);
  const canvases = useRef<PageCanvases[]>([]);
  const near = useRef(new Set<number>());
  const visible = useRef(new Set<number>());
  const inflight = useRef<{ job: RenderJob; task: any; canvas: HTMLCanvasElement } | null>(null);
  const zoomScale = useRef(1);
  // Bumped whenever the document changes, so a render that finishes for an
  // old document is thrown away.
  const generation = useRef(0);

  const dpr = () => Math.max(window.devicePixelRatio || 1, 1);
  const slotWidth = () => containerRef.current?.clientWidth || 360;
  const baseWidth = () => Math.min(slotWidth() * dpr(), MAX_PAGE_PX);
  const sharpWidth = (s: number) => Math.min(slotWidth() * dpr() * Math.min(s, MAX_SHARPEN), MAX_PAGE_PX);

  /** Puts the page's best canvas in its slot (or nothing, showing the
   * slot's tint). */
  const show = (n: number) => {
    const slot = slots.current[n];
    const pc = canvases.current[n];
    if (!slot || !pc) return;
    const c = pc.sharp ?? pc.base;
    if (c) {
      if (slot.firstChild !== c || slot.childNodes.length !== 1) slot.replaceChildren(c);
    } else if (slot.firstChild) slot.replaceChildren();
  };

  const cancelInflightFor = (n: number, kind?: RenderJob["kind"]) => {
    const f = inflight.current;
    if (f && f.job.page === n && (!kind || f.job.kind === kind)) f.task.cancel();
  };

  const releasePage = (n: number) => {
    cancelInflightFor(n);
    const pc = canvases.current[n];
    if (!pc) return;
    releaseCanvas(pc.sharp);
    releaseCanvas(pc.base);
    pc.sharp = null;
    pc.base = null;
    show(n);
  };

  const byPosition = (set: Set<number>) => [...set].sort((a, b) => a - b);

  const nextJob = (): RenderJob | null => {
    const shown = byPosition(visible.current);
    for (const n of shown) {
      const pc = canvases.current[n];
      if (pc && !pc.base && !pc.failed) return { page: n, kind: "base", pixelWidth: baseWidth() };
    }
    for (const n of byPosition(near.current)) {
      const pc = canvases.current[n];
      if (pc && !pc.base && !pc.failed) return { page: n, kind: "base", pixelWidth: baseWidth() };
    }
    const s = zoomScale.current;
    if (s > 1.02) {
      const want = Math.round(sharpWidth(s));
      for (const n of shown) {
        const pc = canvases.current[n];
        if (!pc || pc.failed || !pc.base) continue;
        const have = Math.max(pc.base.width, pc.sharp?.width ?? 0);
        if (have < want) return { page: n, kind: "sharp", pixelWidth: want };
      }
    }
    return null;
  };

  const pump = () => {
    if (inflight.current || !doc.current) return;
    const job = nextJob();
    if (!job) return;
    void draw(job);
  };

  const draw = async (job: RenderJob) => {
    const gen = generation.current;
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    // Holds the queue while getPage resolves, so pump() can't start a
    // second render in the meantime.
    let aborted = false;
    inflight.current = { job, task: { cancel: () => (aborted = true) }, canvas };
    let done = false;
    try {
      const page = await doc.current.getPage(job.page + 1);
      if (aborted || gen !== generation.current || inflight.current?.canvas !== canvas) return;
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: job.pixelWidth / unscaled.width });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const task = page.render({ canvasContext: ctx, viewport, canvas });
      inflight.current = { job, task, canvas };
      await task.promise;
      done = gen === generation.current;
    } catch (err: any) {
      if (gen === generation.current && err?.name !== "RenderingCancelledException") {
        const pc = canvases.current[job.page];
        if (pc) pc.failed = true;
      }
    } finally {
      if (inflight.current?.canvas === canvas) inflight.current = null;
    }

    const pc = canvases.current[job.page];
    // Keep a finished render only if its page is still wanted: near the
    // screen, and for a sharp one, still zoomed in.
    const keep = done && pc && near.current.has(job.page) && (job.kind === "base" || zoomScale.current > 1.02);
    if (keep) {
      if (job.kind === "base") {
        releaseCanvas(pc.base);
        pc.base = canvas;
      } else {
        releaseCanvas(pc.sharp);
        pc.sharp = canvas;
      }
      show(job.page);
    } else {
      releaseCanvas(canvas);
    }
    if (gen === generation.current) pump();
  };

  // Open the document and lay out one slot per page.
  useEffect(() => {
    let cancelled = false;
    // Tracked outside the async body so cleanup can release pdf.js
    // resources on unmount or a `src` change — otherwise switching between
    // PDF categories/versions (now fast and common, via this feature's
    // category chips and version picker) stacks up undestroyed documents
    // and abandoned render tasks on the pdf.js worker. The loading task
    // (not the resolved PDFDocumentProxy, which has no destroy() of its
    // own) is what actually needs destroying — this is pdf.js's documented
    // cleanup pattern, and destroying it internally tears down the loaded
    // document too.
    let loadingTask: any = null;
    const gen = ++generation.current;
    setStatus("loading");
    setPages([]);

    (async () => {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

      try {
        loadingTask = pdfjsLib.getDocument({ url: src });
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        const sizes: { w: number; h: number }[] = [];
        for (let n = 1; n <= loaded.numPages; n++) {
          const page = await loaded.getPage(n);
          if (cancelled) return;
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ w: vp.width, h: vp.height });
        }
        doc.current = loaded;
        canvases.current = sizes.map(() => ({ base: null, sharp: null, failed: false }));
        near.current.clear();
        visible.current.clear();
        setPages(sizes);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (generation.current === gen) generation.current++;
      inflight.current?.task.cancel();
      inflight.current = null;
      for (const pc of canvases.current) {
        releaseCanvas(pc.sharp);
        releaseCanvas(pc.base);
      }
      canvases.current = [];
      doc.current = null;
      loadingTask?.destroy();
    };
  }, [src]);

  // Watch where the slots are relative to the screen: visible, near (within
  // a screen), and far (more than two screens away, which releases them).
  // The gap between near and far keeps a page at the edge from flipping
  // between drawn and released while scrolling. The root is the pane the
  // pages scroll in: with the viewport as root, that pane's clipping would
  // hide everything outside it and the margins would never reach past it.
  // A `hidden` ancestor isn't a root candidate — Live Stage's magnify
  // wrapper is one, and it scrolls along with the pages. Transforms (the
  // magnify and the zoom) are accounted for either way.
  useEffect(() => {
    if (!pages.length) return;
    let root: HTMLElement | null = null;
    for (let p = containerRef.current?.parentElement?.parentElement; p; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (oy === "auto" || oy === "scroll") {
        root = p;
        break;
      }
    }
    const pageOf = (e: IntersectionObserverEntry) => Number((e.target as HTMLElement).dataset.page);
    const watch = (rootMargin: string, onChange: (n: number, inside: boolean) => void) =>
      new IntersectionObserver(
        (entries) => {
          for (const e of entries) onChange(pageOf(e), e.isIntersecting);
          pump();
        },
        { root, rootMargin }
      );
    const observers = [
      watch("0px", (n, inside) => (inside ? visible.current.add(n) : visible.current.delete(n))),
      watch("100% 0px", (n, inside) => {
        if (inside) near.current.add(n);
        else {
          near.current.delete(n);
          cancelInflightFor(n);
        }
      }),
      watch("200% 0px", (n, inside) => {
        if (!inside) releasePage(n);
      }),
    ];
    for (const slot of slots.current.slice(0, pages.length)) {
      if (slot) for (const o of observers) o.observe(slot);
    }
    return () => observers.forEach((o) => o.disconnect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages]);

  // A finished zoom: sharpen what's on screen, or on a return to 1×, drop
  // the sharp redraws and put the base canvases back.
  useEffect(() => {
    zoomScale.current = pz.committedScale;
    if (pz.committedScale <= 1.02) {
      const f = inflight.current;
      if (f?.job.kind === "sharp") f.task.cancel();
      canvases.current.forEach((pc, n) => {
        if (!pc.sharp) return;
        releaseCanvas(pc.sharp);
        pc.sharp = null;
        show(n);
      });
    }
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pz.committedScale]);

  return (
    // Clips the zoomed stack to its own footprint, so its transform can't
    // grow the surrounding pane's scroll area.
    <div className="pdf-pages">
      {status === "loading" && (
        <div className="muted" style={{ fontSize: 13, padding: "20px 0", textAlign: "center" }}>
          Loading pages…
        </div>
      )}
      {status === "error" && (
        <div className="muted" style={{ fontSize: 13, padding: "20px 0", textAlign: "center" }}>
          Couldn't read this PDF.
        </div>
      )}
      <div
        ref={containerRef}
        className="pdf-page-stack"
        style={{
          // Native vertical scroll handles paging through the document at
          // 1x; once zoomed in, our own pointer handlers take over panning
          // (in both axes) instead.
          touchAction: pz.zoomed ? "none" : "pan-y",
        }}
        {...(disableZoom
          ? {}
          : {
              onPointerDown: pz.onPointerDown,
              onPointerMove: pz.onPointerMove,
              onPointerUp: pz.onPointerUp,
              onPointerCancel: pz.onPointerCancel,
              onDoubleClick: pz.onDoubleClick,
            })}
      >
        {pages.map((p, n) => (
          <div
            key={n}
            ref={(el) => {
              slots.current[n] = el;
            }}
            className="pdf-page"
            data-page={n}
            style={{ aspectRatio: `${p.w} / ${p.h}` }}
          />
        ))}
      </div>
      {status === "ready" && pz.zoomed && !disableZoom && (
        <button className="chip" onClick={pz.reset} style={{ display: "block", margin: "8px auto 0" }}>
          Reset zoom
        </button>
      )}
    </div>
  );
}
