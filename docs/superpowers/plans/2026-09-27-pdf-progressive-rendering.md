# Progressive PDF Rendering Implementation Plan

**Goal:** PDF pages appear as they're drawn, at screen density, with sharper redraws after a
zoom and far-off pages released; pinch and pan stop re-rendering React on every move.

**Architecture:** `PdfPages` reads every page's size after the document loads and renders one
sized slot per page (React), so layout is final from the start. A scheduler inside the
component owns all drawing: one pdf.js render at a time, nearest pages first, fed by two
`IntersectionObserver`s (near: ±1 screen; far: beyond ±2 screens). Canvases are created and
swapped imperatively inside slots. `usePanZoom` keeps scale/translate in refs, writes the
transform per animation frame, and reports a committed scale when a zoom gesture ends, which
queues sharp renders for visible pages.

**Spec:** `docs/superpowers/specs/2026-09-27-pdf-progressive-rendering-design.md`

## Global constraints

- No test framework: `npm run build` clean, plus the spec's manual checks.
- Commit as Israel Valle, no co-author trailer, no mention of AI authorship (CLAUDE.md).
- New fixed styles go in `theme.css` under purpose-named classes; only runtime values
  (aspect ratio, transform) stay inline.
- Keep existing comments that are still correct.

## Part 1: gestures (`usePanZoom` in `src/components/PdfPages.tsx`)

- `scale`/`translate` become refs. `apply()` schedules one `requestAnimationFrame` that writes
  `transform` on `hostRef`.
- React state: `zoomed` (set only when it flips) and `committedScale` (set when a pinch ends,
  when a ctrl-wheel burst is idle for 150 ms, and on reset).
- On gesture start (pinch begins, zoomed pan begins, first wheel event of a burst), find the
  scroll container once; `clampY` reads only its rect.
- Double-tap, reset chip, `disableZoom` clearing and song-swipe pass-through behave as today.
- Remove `transform` from the container's JSX style.

## Part 2: slots and scheduler (`PdfPages`)

- After `getDocument`, read `getViewport({ scale: 1 })` for every page into `pages` state.
- Render `.pdf-page` slots (`theme.css`: relative, 8px radius, `var(--tint)` background, 8px
  gap between slots via `.pdf-page + .pdf-page`) with inline `aspect-ratio`; the canvas class
  `.pdf-page-canvas` fills the slot.
- Scheduler (refs, not state): per page `{ base?, sharp?, want: "none" | "base" | "sharp" }`,
  `near`/`visible` sets from the observers, one in-flight task.
  `pump()` picks the next job: visible pages missing a base, then near pages missing a base
  (top to bottom), then visible pages needing sharp at the committed scale.
- Base width `min(slotWidth × dpr, 2600)`; sharp width
  `min(slotWidth × dpr × min(scale, 2.5), 2600)`, skipped when the current canvas is at least
  that wide.
- Sharp canvas swaps in when done; on committed scale 1, sharp canvases are released and base
  goes back.
- Far observer: leaving the ±2 screen band releases canvases (remove, size 0×0) and cancels
  that page's in-flight render.
- Cleanup on unmount/`src` change: cancel, disconnect, release all, destroy loading task.
- "Loading pages…" only while sizes aren't known; no `visibility: hidden` on the stack.

## Part 3: docs

- `docs/review-findings.md`: drop finding 1 and the PdfPages bullet of 11, renumber.
- `CLAUDE.md` pdfjs-dist line.

One commit for Parts 1–2 (they share the file and the commit point), one for Part 3.

## Verification

`npm run build`, then the spec's manual list in browser dev. On-device checks (Android) are
left for Israel.
