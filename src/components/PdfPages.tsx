import { useEffect, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

/** Pinch/ctrl-wheel-driven camera zoom + drag-to-pan over the rendered page
 * stack — appropriate here in a way it wasn't for `MxlScore`'s notation:
 * these pages are already-fixed raster images (real vector re-layout isn't
 * possible), so magnifying the picture *is* the correct zoom, not a
 * fallback. Plain (non-ctrl) wheel is left alone so it keeps scrolling
 * through pages instead of being hijacked into zooming. */
function usePanZoom(hostRef: React.RefObject<HTMLDivElement | null>, disableZoom: boolean) {
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const lastTap = useRef(0);

  const clampScale = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
  // Only the horizontal axis is bounded — vertical pan is left free (the
  // page stack can be arbitrarily tall) since native scroll is disabled
  // while zoomed in; "Reset zoom" always gets you back.
  const clampX = (x: number, s: number) => {
    const width = hostRef.current?.clientWidth ?? 0;
    const max = (width * (s - 1)) / 2;
    return Math.min(max, Math.max(-max, x));
  };

  const reset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // Nice-to-have only.
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale };
      panStart.current = null;
    } else if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 320) {
        reset();
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      if (scale > 1) panStart.current = { x: e.clientX, y: e.clientY, tx: translate.x, ty: translate.y };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    e.stopPropagation();
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const next = clampScale(pinchStart.current.scale * (dist / pinchStart.current.dist));
      setScale(next);
      setTranslate((t) => ({ x: clampX(t.x, next), y: t.y }));
    } else if (pointers.current.size === 1 && panStart.current) {
      const next = { x: panStart.current.tx + (e.clientX - panStart.current.x), y: panStart.current.ty + (e.clientY - panStart.current.y) };
      setTranslate({ x: clampX(next.x, scale), y: next.y });
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    e.stopPropagation();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) panStart.current = null;
  };

  // Native, not React's onWheel: the synthetic wheel listener is passive,
  // so preventDefault() inside it throws instead of stopping page scroll.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || disableZoom) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const next = clampScale(scale * Math.exp(-e.deltaY * 0.01));
      setScale(next);
      setTranslate((t) => ({ x: clampX(t.x, next), y: t.y }));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, disableZoom]);

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
    panStart.current = null;
  }, [disableZoom]);

  return { scale, translate, onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer, onDoubleClick: reset, reset };
}

/** Renders a PDF's actual pages as a plain vertical stack of canvases, via
 * pdf.js — not the browser's native PDF plugin (`<embed type="application/
 * pdf">`), which brings its own chrome (page-thumbnail rail, toolbar,
 * page-count/zoom/print/download controls, its own scrollbar) that can't be
 * styled or removed and, on top of that, isn't even available inside a
 * Capacitor WebView on Android/iOS. This draws only the page content, so it
 * behaves the same in-app as it does in a desktop browser during `npm run
 * dev`. */
export function PdfPages({ src, disableZoom = false }: { src: string; disableZoom?: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const pz = usePanZoom(containerRef, disableZoom);
  const zoomed = Math.abs(pz.scale - 1) > 0.02;

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
    let currentRenderTask: any = null;
    setStatus("loading");

    (async () => {
      const container = containerRef.current;
      if (!container) return;
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

      try {
        loadingTask = pdfjsLib.getDocument({ url: src });
        const doc = await loadingTask.promise;
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        const width = containerRef.current.clientWidth || 360;
        // Oversample well past the CSS display width/DPR: the canvas is
        // displayed at `width` CSS px (via style.width below) but rendered
        // at higher backing-pixel resolution, so pinch-zooming or a
        // high-res screenshot doesn't immediately show raster blur — a
        // fixed-resolution canvas otherwise looks noticeably softer than
        // the source PDF's actual vector detail (fine print like note
        // names inside noteheads) the moment you zoom past 1:1.
        const dpr = Math.max(window.devicePixelRatio || 1, 1) * 2.5;
        const MAX_PAGE_PX = 2600;

        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          if (cancelled || !containerRef.current) return;
          const unscaled = page.getViewport({ scale: 1 });
          const pixelWidth = Math.min(width * dpr, MAX_PAGE_PX);
          const viewport = page.getViewport({ scale: pixelWidth / unscaled.width });

          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.style.borderRadius = "8px";
          if (n < doc.numPages) canvas.style.marginBottom = "8px";

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const task = page.render({ canvasContext: ctx, viewport, canvas });
          currentRenderTask = task;
          await task.promise;
          currentRenderTask = null;
          if (cancelled || !containerRef.current) return;
          containerRef.current.appendChild(canvas);
        }

        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      currentRenderTask?.cancel();
      loadingTask?.destroy();
    };
  }, [src]);

  return (
    <div style={{ width: "100%" }}>
      {status === "loading" && (
        <div className="muted" style={{ fontSize: 12, padding: "20px 0", textAlign: "center" }}>
          Loading pages…
        </div>
      )}
      {status === "error" && (
        <div className="muted" style={{ fontSize: 12, padding: "20px 0", textAlign: "center" }}>
          Couldn't read this PDF.
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          // visibility, not display: pdf.js needs to measure a real non-zero
          // width to size pages correctly while the first page is loading —
          // display:none collapses the box to zero width.
          visibility: status === "ready" ? "visible" : "hidden",
          width: "100%",
          // Native vertical scroll handles paging through the document at
          // 1x; once zoomed in, our own pointer handlers take over panning
          // (in both axes) instead.
          touchAction: zoomed ? "none" : "pan-y",
          transform: `translate(${pz.translate.x}px, ${pz.translate.y}px) scale(${pz.scale})`,
          transformOrigin: "50% 0",
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
      />
      {status === "ready" && zoomed && (
        <button className="chip" onClick={pz.reset} style={{ display: "block", margin: "8px auto 0" }}>
          Reset zoom
        </button>
      )}
    </div>
  );
}
