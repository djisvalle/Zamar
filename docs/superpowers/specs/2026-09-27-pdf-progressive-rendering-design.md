# PDF pages that show as they're drawn

## Context

Finding 1 in `docs/review-findings.md` (the only 🔴 item), plus the `PdfPages` bullet of
finding 11:

- **Finding 1.** `PdfPages.tsx` draws pages one after another and keeps the page container
  `visibility: hidden` until the last one is done, so a 6-page chart shows "Loading pages…"
  for the whole run. Every page is drawn at `devicePixelRatio × 2.5` (capped at 2600px wide):
  about 9 MP and 35 MB of canvas per page, several times the work and memory of a sharp 1×
  page.
- **Finding 11 (PdfPages bullet).** Pinch and pan call `setScale`/`setTranslate` on every
  `pointermove`, re-rendering the component each time, and `clampY` walks ancestors with
  `getComputedStyle` on every move.

Decisions made in brainstorming:

- Zoomed-in sharpness is **capped at today's level** (`devicePixelRatio × 2.5`, at most 2600px
  wide). Matching the zoom level all the way to 4× on a large iPad would pass iOS's ~16.7 MP
  per-canvas limit and need tiled drawing; not worth it for this pass.
- The finding 11 gesture fix is **part of this change**, since sharpening on zoom needs a
  "gesture ended" point in the same code.
- Pages far off screen **release their canvases**.

## Goals

- The first page is on screen as soon as it is drawn, not after the whole document.
- Page slots have their final size from the start, so nothing below them jumps as pages fill
  in, and existing Annotate marks on PDFs stay where they are.
- At 1× zoom, each page's canvas is drawn at screen density.
- After a zoom ends above 1×, the pages on screen are as sharp as they are today.
- Pinch and pan don't re-render React on every move.
- Memory is bounded by how many pages are near the screen, not by the length of the PDF.

## Out of scope

- The pdf.js compatibility question on older WebViews (low-priority finding 4). Checked on
  device separately.
- Tiled or region-only drawing for sharper-than-today zoom.
- Song-to-song swipe motion and preloading the next song's pages (finding 5).
- `React.memo` on `PdfPages` (finding 8).

## Layout: sized slots from the start

This is the constraint the rest works around: Annotate marks on a PDF are saved as pixel
positions over the page stack, and `exportSet.ts` (`overlayPdfMarks`) replays that layout
(pages at the content width, `STAGE_PDF_GAP` = 8px between them). Page sizes and gaps must not
change.

After `getDocument` resolves, `PdfPages` calls `getPage(n)` for every page and reads
`getViewport({ scale: 1 })` (no drawing; pdf.js already applies the page's rotation here). It
then renders one slot per page:

- a `div` with `width: 100%` and `aspect-ratio: <viewport.width> / <viewport.height>`,
- `border-radius: 8px`, an 8px bottom margin on every slot but the last,
- a faint `var(--tint)` background until its page is drawn,
- the page's canvas inside it, filling the slot (`position: absolute; inset: 0; width: 100%;
  height: 100%`).

Today a page's height comes from its canvas's rounded pixel size (`Math.ceil`), which can
differ from the exact aspect by a fraction of a CSS pixel per page. The slot uses the exact
aspect, which is what `overlayPdfMarks` already assumes, so stage and export line up slightly
better than before. Existing marks move by well under a pixel.

The slots are React elements (a `pages` state array of `{ width, height }`), replacing today's
`innerHTML = ""` plus `appendChild`. Canvases are still created and swapped imperatively
inside each slot, so drawing doesn't go through React.

The "Loading pages…" line shows only until the page sizes are known (usually a few
milliseconds after the bytes arrive). The container is no longer `visibility: hidden` while
pages draw; the error state is unchanged.

## Drawing: one queue, nearest pages first

A small scheduler inside `PdfPages` owns all drawing:

- **One render at a time.** pdf.js renders on one worker anyway; running tasks in parallel only
  splits it. The in-flight `RenderTask` is kept so it can be cancelled.
- **Which pages want drawing** comes from an `IntersectionObserver` on the slots (root: the
  viewport, which accounts for scrolled ancestors, Live Stage's magnify transform and the zoom
  transform). A slot within one screen height of the visible area (`rootMargin: "100% 0px"`)
  is *near*.
- **Order:** near pages that aren't drawn yet, visible ones first, then top to bottom. Page 1
  is visible on open, so it draws first.
- **Hidden tabs.** The observer still reports geometry for a screen kept mounted behind
  another tab (see CLAUDE.md, "Tabs stay mounted"), so a PDF in a hidden Live Stage keeps
  drawing what's near its own scroll position. That is the same work it would do on screen,
  and it means switching back shows drawn pages.

### Base resolution

Each page is drawn at `pixelWidth = min(slotWidth × devicePixelRatio, 2600)`, where
`slotWidth` is the container's `clientWidth` (layout pixels, like today). On a 3× phone that is
about 1200px wide instead of 2600px: a sixth of the pixels.

### Sharpening after a zoom

When a zoom gesture ends (pinch fingers lift, or a ctrl-wheel burst goes idle for 150 ms, the
same debounce `MxlScore` uses) with `scale > 1`, each page visible at that moment is queued for
a sharp render at

`pixelWidth = min(slotWidth × devicePixelRatio × min(scale, 2.5), 2600)`,

skipping pages whose current canvas is already at least that wide. The sharp canvas is drawn
off-DOM and swapped into the slot when done, so the page never blanks. The page's base canvas
is kept (it's small) so a later zoom-out can fall back without redrawing.

Pages that scroll into view while zoomed get their base render first, then a sharp one.

When zoom returns to 1× (double-tap, "Reset zoom", or pinching back out), each sharp canvas is
dropped and the base canvas goes back into its slot.

Swapping a canvas mid-gesture is already safe: pointer capture is on the container, not the
canvas (existing comment in `onPointerDown`).

### Releasing far-off pages

A slot more than two screen heights from the visible area (a second observer with
`rootMargin: "200% 0px"`) releases its canvases: they're removed and shrunk to `0 × 0` (which
frees the backing store on iOS WebKit and Chrome), and the slot shows its tint again. It is
redrawn when it comes back within one screen. The gap between the two thresholds keeps a page
near the edge from flipping between drawn and released while scrolling.

For a typical 2–6 page chart on a phone, most pages stay drawn; this matters for long PDFs.

### Cleanup

On unmount or a `src` change: cancel the in-flight render, disconnect the observers, release
every canvas, and destroy the loading task (today's pattern, kept).

## Gestures: transform per frame, not React state per move

`usePanZoom` keeps `scale` and `translate` in refs and writes the container's `transform` in a
`requestAnimationFrame`, as `MxlScore`'s pinch preview does. React state holds only what
changes the rendered output:

- `zoomed` (`scale` more than 0.02 from 1), which drives `touch-action` and the "Reset zoom"
  chip, set when it flips rather than on every move;
- a committed `scale`, set when a zoom gesture ends, which the scheduler reads to sharpen.

The transform stays on the same element, so the existing `style.transform` in JSX is removed
and the hook owns it (set once on mount at identity).

`clampY`'s ancestor walk (`getComputedStyle` on each parent until a scroll container) runs
once when a gesture starts, finding the scroll container; the rest of that gesture reuses it
and reads only its `getBoundingClientRect()` (one layout read, no style walk) per frame, so a
pane that drifts at the start of a pinch at 1× is still clamped correctly.

Behavior that stays the same: double-tap resets, one-finger drag at 1× reaches Live Stage's
song-to-song swipe, plain wheel scrolls, ctrl-wheel zooms, `disableZoom` clears in-flight
pointers.

## Callers

No prop changes. `LiveStage.tsx`, `AddEditSong.tsx` and `ImportSong.tsx` keep passing `src`
(and `disableZoom` on stage). The previews in Add/Edit Song and Import get the same
progressive drawing.

## Docs to update when this lands

- `docs/review-findings.md`: remove finding 1 and the `PdfPages` bullet of finding 11, and
  renumber.
- `CLAUDE.md` tech stack line for `pdfjs-dist`: "renders PDFs page by page, nearest pages
  first, with pinch-zoom/pan".

## Verification

`npm run build` is the only automated check. By hand, in browser dev and on the Android test
device:

- A multi-page PDF on Live Stage shows page 1 before later pages finish; page slots don't move
  as pages fill in.
- Existing marks on a PDF (Annotate) sit where they did before the change, on the first and
  last page.
- Export a marked PDF song; marks land in the same places as on stage.
- Pinch in and hold still: pages on screen sharpen within a moment and match today's detail.
  Double-tap: back to 1×.
- Pan while zoomed stays inside the page stack at the top and bottom, as today.
- One-finger swipe at 1× still changes songs; a pinch or zoomed pan doesn't.
- Scroll a long PDF (20+ pages) top to bottom and back: pages draw as they come near, far
  pages release (check memory in Chrome DevTools on the device), nothing stays blank once on
  screen.
- Switch PDF versions/categories quickly on stage: no errors, no stale pages.
- Add/Edit Song and Import previews still show the PDF.
