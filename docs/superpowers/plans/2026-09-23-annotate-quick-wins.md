# Annotate Mode Quick Wins (Roadmap Items 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three "quick win" items from the Annotate Mode roadmap: a collapsible
tool panel, a selection highlight on the canvas, and a visually stronger Clear-all
option in the Clear sheet.

**Architecture:** All three changes are localized, additive edits to the existing
Annotate mode components — no new files, no new state shapes, no persistence changes.
Task 1 adds a local `expanded` boolean to `AnnotateDock` (mirroring the existing
`QuickEditSheet.tsx` collapse pattern). Task 2 threads a `selectedId` prop from
`AnnotateScreen`'s existing `editingId` state into `AnnotateCanvas`, which already knows
how to draw strokes and render mark badges — it just gains a highlighted-state branch.
Task 3 is a pure styling change to one button in `AnnotateScreen.tsx`'s Clear sheet.

**Tech Stack:** React 18 + TypeScript, plain CSS custom properties (`src/theme.css`),
hand-drawn `Icon` component. No test framework is configured in this repo — see Global
Constraints.

**Spec:** `docs/annotate-mode-roadmap.md` (section "Quick wins — small, worth doing
regardless of what else gets picked up", items 1–3).

## Global Constraints

- **No lint/test tooling is configured in this repo.** `npm run build` (`tsc -b && vite
  build`) is the only automated verification available — every task's "verify" step is
  a clean build, not a test run. Treat a clean build as the correctness bar (per
  `CLAUDE.md`'s Gotchas section).
- **For UI changes, verify in the browser before calling a task done.** Run `npm run
  dev` and exercise the actual interaction (per `CLAUDE.md`'s "Doing tasks" section) —
  a clean `tsc` build proves the code compiles, not that the feature works.
- **Reuse existing tokens and patterns.** Colors come from `src/theme.css` custom
  properties (`var(--danger)`, `var(--acc-deep)`, `var(--line)`, `var(--surface)`,
  `var(--mut)`), never new hardcoded hex values where a token already exists. Tinted
  backgrounds use the `color-mix(in srgb, var(--X) N%, transparent)` pattern already
  established in `theme.css:775`.
- **All three tasks touch overlapping files** (`AnnotateScreen.tsx`, one also touches
  `AnnotateCanvas.tsx`). Execute the tasks **in order (1 → 2 → 3), not in parallel** —
  even under subagent-driven-development, don't dispatch two of these tasks
  concurrently, or their edits will conflict.
- **Never mention Claude in code comments** and **no commit co-author trailer beyond
  what this session's system reminder specifies** — per `CLAUDE.md`.

---

## Task 1: Collapsible tool panel

**Files:**
- Modify: `src/screens/live-stage/AnnotateScreen.tsx` (the `AnnotateDock` function,
  currently lines 421–556)

**Interfaces:**
- Consumes: nothing new — `AnnotateDock`'s existing props are unchanged.
- Produces: nothing consumed by other tasks. Purely local UI state inside `AnnotateDock`.

**Context:** `AnnotateDock` renders a per-tool control panel (color grid, size/opacity
sliders, notation/shape chip rows, or a one-line hint) followed by a fixed row of tool
buttons + the Scroll toggle. The control panel can eat up to ~40% of screen height
(`maxHeight: "58%"` on the outer wrapper), which is a lot of the chart hidden while
actively drawing. `src/screens/live-stage/QuickEditSheet.tsx:8,27-40` already has the
exact interaction this item asks for — a boolean `expanded` state, a centered button
showing `﹀` when expanded (tap to collapse) or `︿` when collapsed (tap to expand), with
an `aria-label` that flips to match. Task 1 ports that same pattern into `AnnotateDock`.

- [ ] **Step 1: Add the `expanded` state and toggle button to `AnnotateDock`**

  In `src/screens/live-stage/AnnotateScreen.tsx`, find the start of the `AnnotateDock`
  function body (right after its prop destructuring closes, before `return (`) and add:

  ```tsx
  const [expanded, setExpanded] = useState(true);
  ```

  Then find this block (the function's `return`):

  ```tsx
  return (
    <div style={{ borderTop: "1px solid var(--line)", background: "var(--surface)", maxHeight: "58%", overflowY: "auto" }}>
      {(tool === "pen" || tool === "square") && (
  ```

  Replace it with:

  ```tsx
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
  ```

- [ ] **Step 2: Close the new wrapping fragment before the tool-button row**

  Find this block later in the same function (the blank line before the fixed
  tool-button row):

  ```tsx
      {tool === "pin" && (
        <div className="muted" style={{ padding: "10px 14px 2px", fontSize: 11 }}>
          Tap the chart to drop a pin.
        </div>
      )}

      <div style={{ padding: "8px 4px 10px", display: "flex", alignItems: "center", gap: 2 }}>
  ```

  Replace it with:

  ```tsx
      {tool === "pin" && (
        <div className="muted" style={{ padding: "10px 14px 2px", fontSize: 11 }}>
          Tap the chart to drop a pin.
        </div>
      )}
      </>
      )}

      <div style={{ padding: "8px 4px 10px", display: "flex", alignItems: "center", gap: 2 }}>
  ```

  This keeps the tool-button row (Select/Pen/Highlight/.../Eraser + Scroll) always
  visible — only the per-tool color/size/chip panel above it collapses.

- [ ] **Step 3: Verify the build compiles**

  Run: `npm run build`
  Expected: exits 0, no TypeScript errors in `AnnotateScreen.tsx`.

- [ ] **Step 4: Manually verify in the browser**

  Run `npm run dev`, open the app, navigate to a song with a chart on Live Stage, open
  Stage Tools → Annotate, and select the Pen tool. Confirm: the `﹀` toggle appears above
  the color grid; tapping it collapses the panel down to just the tool-button row (more
  of the chart becomes visible above the dock); the button now reads `︿`; tapping again
  re-expands it. Switch tools (e.g. to Shapes) while collapsed and confirm it stays
  collapsed.

- [ ] **Step 5: Commit**

  ```bash
  git add src/screens/live-stage/AnnotateScreen.tsx
  git commit -m "Add a collapsible tool panel to Annotate mode's dock, reusing the Quick Edit sheet's expand/collapse pattern"
  ```

---

## Task 2: Selection highlight on the canvas

**Files:**
- Modify: `src/components/AnnotateCanvas.tsx`
- Modify: `src/screens/live-stage/AnnotateScreen.tsx` (one prop added to the
  `<AnnotateCanvas>` call, around line 292)

**Interfaces:**
- Consumes: `AnnotateScreen`'s existing `editingId: string | null` state (already
  defined at `AnnotateScreen.tsx:161`) — this is the id of whichever stroke or mark
  currently has its edit sheet open, and doubles as "the selected object" for this task.
- Produces: a new optional prop `selectedId?: string | null` on `AnnotateCanvas`, and a
  new optional prop `selected?: boolean` on the internal `MarkBadge` component. Nothing
  outside these two files consumes either.

**Context:** In `AnnotateCanvas.tsx`, tapping a stroke with the Select tool calls
`onEditRequest(hitId)`, and tapping a text/shape mark badge calls `onEdit()` →
`onEditRequest?.(mark.id)`. `AnnotateScreen.tsx` stores that id in `editingId` and uses
it to decide which edit sheet (`EditInkSheet` / `EditMarkSheet`) to show — but nothing
on the canvas itself indicates which object is currently selected. Strokes are painted
on a `<canvas>` (imperative 2D context draws in `AnnotateCanvas.tsx`'s draw effect, ~line
156); marks are DOM nodes (`MarkBadge`, ~line 516). The two need different highlight
mechanisms: a wider "halo" stroke drawn underneath the selected stroke on the canvas,
and a CSS outline on the selected mark's `<div>`.

- [ ] **Step 1: Add a `drawSelectionHalo` helper next to `drawStroke`**

  In `src/components/AnnotateCanvas.tsx`, find `drawStroke` (currently lines 37–56).
  Immediately after its closing `}`, add:

  ```tsx
  /** Draws a wide, translucent halo underneath a selected stroke so the
   * Select tool's current target is visible on the canvas itself — see the
   * annotate-mode roadmap's "Selection highlight on the canvas" item. Uses
   * the same path-building logic as `drawStroke` (including the `square`
   * tool's rect special-case) so the halo always matches the real shape. */
  function drawSelectionHalo(ctx: CanvasRenderingContext2D, s: Stroke, canvas: HTMLCanvasElement, offset?: { x: number; y: number }) {
    ctx.save();
    ctx.strokeStyle = resolveSelectionColor(canvas);
    ctx.lineWidth = (s.size ?? STROKE_WIDTH) + 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.35;
    const pts = offset ? s.points.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })) : s.points;
    if (s.tool === "square" && pts.length === 2) {
      const [a, b] = pts;
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    } else if (pts.length > 0) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.restore();
  }
  ```

- [ ] **Step 2: Add a `resolveSelectionColor` helper in `src/utils/annotations.ts`**

  Find `resolveAccentColor` in `src/utils/annotations.ts` (lines 131–134). Immediately
  after its closing `}`, add:

  ```ts
  /** Resolves the app's "selected/active" indicator color from the live
   * theme's `--acc-deep` custom property — the same token `ColorGrid`'s
   * selected-swatch ring and `ToolButton`'s active state already use — so
   * the Select tool's canvas halo (see AnnotateCanvas.tsx) matches every
   * other "this is the selected one" indicator in Annotate mode. */
  export function resolveSelectionColor(el: Element): string {
    const value = getComputedStyle(el).getPropertyValue("--acc-deep").trim();
    return value || "#3a6a94";
  }
  ```

  Then, in `src/components/AnnotateCanvas.tsx`, update the existing import line:

  ```ts
  import { hitTestAnnotation, isMark, isPin, isStroke, resolveAccentColor, SHAPE_ASPECT, STROKE_WIDTH, topStrokeHit } from "../utils/annotations";
  ```

  to:

  ```ts
  import { hitTestAnnotation, isMark, isPin, isStroke, resolveAccentColor, resolveSelectionColor, SHAPE_ASPECT, STROKE_WIDTH, topStrokeHit } from "../utils/annotations";
  ```

- [ ] **Step 3: Thread `selectedId` through `AnnotateCanvas`'s props**

  In `src/components/AnnotateCanvas.tsx`, find the component's prop destructuring:

  ```tsx
  export function AnnotateCanvas({
    annotations,
    tool,
    onCommit,
    onReproject,
    onEditRequest,
    scrollMode,
  ```

  Replace with:

  ```tsx
  export function AnnotateCanvas({
    annotations,
    tool,
    onCommit,
    onReproject,
    onEditRequest,
    selectedId,
    scrollMode,
  ```

  Then find the matching type block:

  ```tsx
    onEditRequest?: (id: string) => void;
    /** true pauses drawing so the wrapped content can be scrolled with a
  ```

  Replace with:

  ```tsx
    onEditRequest?: (id: string) => void;
    /** Id of the currently selected stroke or mark (mirrors the caller's
     * open-edit-sheet state) — when set, that object is drawn/rendered with
     * a highlight so the Select tool's target is visible on the canvas, not
     * just in the edit sheet. */
    selectedId?: string | null;
    /** true pauses drawing so the wrapped content can be scrolled with a
  ```

- [ ] **Step 4: Draw the halo in the canvas paint effect**

  In `src/components/AnnotateCanvas.tsx`, find the draw effect:

  ```tsx
    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of strokesOf(annotations)) {
        const offset = dragPreview && dragPreview.id === s.id ? { x: dragPreview.dx, y: dragPreview.dy } : undefined;
        drawStroke(ctx, s, canvas, offset);
      }
      if (draft.current) drawStroke(ctx, draft.current, canvas);
      // draft.current is a ref (mutated imperatively by the pointer handlers
      // below, not React state) so it isn't itself a dependency — this effect
      // re-runs whenever `annotations`/`size`/`dragPreview` change, and the
      // handlers call the canvas's 2D context directly for the in-progress
      // preview in between.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [annotations, size, dragPreview]);
  ```

  Replace with:

  ```tsx
    useEffect(() => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const selectedStroke = selectedId ? strokesOf(annotations).find((s) => s.id === selectedId) : undefined;
      if (selectedStroke) {
        const haloOffset = dragPreview && dragPreview.id === selectedStroke.id ? { x: dragPreview.dx, y: dragPreview.dy } : undefined;
        drawSelectionHalo(ctx, selectedStroke, canvas, haloOffset);
      }
      for (const s of strokesOf(annotations)) {
        const offset = dragPreview && dragPreview.id === s.id ? { x: dragPreview.dx, y: dragPreview.dy } : undefined;
        drawStroke(ctx, s, canvas, offset);
      }
      if (draft.current) drawStroke(ctx, draft.current, canvas);
      // draft.current is a ref (mutated imperatively by the pointer handlers
      // below, not React state) so it isn't itself a dependency — this effect
      // re-runs whenever `annotations`/`size`/`dragPreview`/`selectedId` change,
      // and the handlers call the canvas's 2D context directly for the
      // in-progress preview in between.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [annotations, size, dragPreview, selectedId]);
  ```

- [ ] **Step 5: Highlight the selected mark badge**

  In `src/components/AnnotateCanvas.tsx`, find the `marksOf` render call:

  ```tsx
          {marksOf(annotations).map((mark) => (
            <MarkBadge
              key={mark.id}
              mark={mark}
              tool={tool}
              onErase={() => onCommit(annotations.filter((a) => a.id !== mark.id))}
              onEdit={() => onEditRequest?.(mark.id)}
              onDrag={(x, y, clientX, clientY) => {
                const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
                onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, position: { x, y }, anchor } : a)));
              }}
            />
          ))}
  ```

  Replace with:

  ```tsx
          {marksOf(annotations).map((mark) => (
            <MarkBadge
              key={mark.id}
              mark={mark}
              tool={tool}
              selected={mark.id === selectedId}
              onErase={() => onCommit(annotations.filter((a) => a.id !== mark.id))}
              onEdit={() => onEditRequest?.(mark.id)}
              onDrag={(x, y, clientX, clientY) => {
                const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
                onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, position: { x, y }, anchor } : a)));
              }}
            />
          ))}
  ```

  Then find `MarkBadge`'s definition:

  ```tsx
  function MarkBadge({
    mark,
    tool,
    onErase,
    onEdit,
    onDrag,
  }: {
    mark: TextMark | ShapeMark;
    tool: AnnotateTool;
    onErase: () => void;
    onEdit: () => void;
    onDrag: (x: number, y: number, clientX: number, clientY: number) => void;
  }) {
    const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
    const interactive = tool === "select" || tool === "eraser";

    return (
      <div
        style={{
          position: "absolute",
          left: mark.position.x,
          top: mark.position.y,
          transform: "translate(-50%, -50%)",
          color: mark.color,
          fontSize: mark.kind === "text" ? mark.size : undefined,
          fontWeight: 700,
          fontFamily: "var(--font-heading)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: interactive ? "auto" : "none",
          cursor: tool === "select" ? "grab" : "default",
          userSelect: "none",
          touchAction: "none",
          whiteSpace: "nowrap",
        }}
  ```

  Replace with:

  ```tsx
  function MarkBadge({
    mark,
    tool,
    selected,
    onErase,
    onEdit,
    onDrag,
  }: {
    mark: TextMark | ShapeMark;
    tool: AnnotateTool;
    selected: boolean;
    onErase: () => void;
    onEdit: () => void;
    onDrag: (x: number, y: number, clientX: number, clientY: number) => void;
  }) {
    const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
    const interactive = tool === "select" || tool === "eraser";

    return (
      <div
        style={{
          position: "absolute",
          left: mark.position.x,
          top: mark.position.y,
          transform: "translate(-50%, -50%)",
          color: mark.color,
          fontSize: mark.kind === "text" ? mark.size : undefined,
          fontWeight: 700,
          fontFamily: "var(--font-heading)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: interactive ? "auto" : "none",
          cursor: tool === "select" ? "grab" : "default",
          userSelect: "none",
          touchAction: "none",
          whiteSpace: "nowrap",
          outline: selected ? "2px solid var(--acc-deep)" : "none",
          outlineOffset: selected ? 4 : 0,
          borderRadius: selected ? 6 : 0,
        }}
  ```

- [ ] **Step 6: Pass `editingId` into `AnnotateCanvas` from `AnnotateScreen`**

  In `src/screens/live-stage/AnnotateScreen.tsx`, find the `<AnnotateCanvas>` call:

  ```tsx
            <AnnotateCanvas
              annotations={annotations}
              tool={tool}
              onCommit={commit}
              onReproject={reproject}
              onEditRequest={setEditingId}
              scrollMode={scrollMode}
  ```

  Replace with:

  ```tsx
            <AnnotateCanvas
              annotations={annotations}
              tool={tool}
              onCommit={commit}
              onReproject={reproject}
              onEditRequest={setEditingId}
              selectedId={editingId}
              scrollMode={scrollMode}
  ```

- [ ] **Step 7: Verify the build compiles**

  Run: `npm run build`
  Expected: exits 0, no TypeScript errors in `AnnotateCanvas.tsx`, `AnnotateScreen.tsx`,
  or `utils/annotations.ts`.

- [ ] **Step 8: Manually verify in the browser**

  Run `npm run dev`, open a song's chart in Annotate mode, draw a pen stroke, switch to
  the Select tool, and tap that stroke. Confirm a soft halo appears around the stroke on
  the canvas while its edit sheet is open, in the same accent color the color grid's
  selected-swatch ring uses. Close the sheet (halo should disappear) or drag the stroke
  (halo should track the drag preview). Then place a text or notation mark, tap it with
  Select, and confirm it gets a dashed-looking outline ring instead of a halo. Confirm
  neither highlight appears when no edit sheet is open.

- [ ] **Step 9: Commit**

  ```bash
  git add src/components/AnnotateCanvas.tsx src/screens/live-stage/AnnotateScreen.tsx src/utils/annotations.ts
  git commit -m "Highlight the selected stroke or mark on the Annotate canvas instead of only in its edit sheet"
  ```

---

## Task 3: Stronger Clear-page vs. Clear-all visual distinction

**Files:**
- Modify: `src/screens/live-stage/AnnotateScreen.tsx` (the Clear sheet, currently lines
  389–416)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by other tasks. Pure styling change to one button.

**Context:** The Clear sheet currently has two destructive-ish options — "Clear this
view" (plain) and "Clear all views on this song" (currently distinguished only by a
hardcoded `color: "#8c3b3b"` + `fontWeight: 600`). `src/theme.css` already defines that
exact color as the `--danger` token (`--danger: #8c3b3b`, used by `.btn-danger`
elsewhere in this same file's `EditInkSheet`/`EditMarkSheet` Delete buttons, which also
use the `trash` icon already imported here). This task swaps the hardcoded hex for the
token, adds that same trash icon, and adds a tinted background so the more destructive
option reads as visually heavier, not just differently colored text.

- [ ] **Step 1: Restyle the "Clear all views on this song" button**

  In `src/screens/live-stage/AnnotateScreen.tsx`, find:

  ```tsx
            <button
              className="sheet-row"
              style={{ color: "#8c3b3b", fontWeight: 600 }}
              onClick={() => {
                commit([]);
                setAllViewsCleared(true);
                setClearOpen(false);
              }}
            >
              <span>Clear all views on this song</span>
            </button>
  ```

  Replace with:

  ```tsx
            <button
              className="sheet-row"
              style={{
                color: "var(--danger)",
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
  ```

  `Icon` is already imported at the top of this file
  (`import { Icon, type IconName } from "../../components/Icon";`), so no import change
  is needed. `justifyContent: "flex-start"` overrides `.sheet-row`'s CSS
  `justify-content: space-between` (see `theme.css:678-692`) — without it, the icon and
  label would be pushed to opposite ends of the row instead of sitting together.

- [ ] **Step 2: Verify the build compiles**

  Run: `npm run build`
  Expected: exits 0, no TypeScript errors in `AnnotateScreen.tsx`.

- [ ] **Step 3: Manually verify in the browser**

  Run `npm run dev`, open a song's chart in Annotate mode, tap Clear. Confirm "Clear
  this view" still renders as a plain row, and "Clear all views on this song" now shows
  a trash icon, bold `--danger`-colored text, and a faint red-tinted background band —
  visually heavier than the plain row above it, not just differently colored text.
  Confirm both options and Cancel still work (each closes the sheet; the two Clear
  options still clear as before).

- [ ] **Step 4: Commit**

  ```bash
  git add src/screens/live-stage/AnnotateScreen.tsx
  git commit -m "Give Annotate mode's Clear-all option more visual weight than Clear-this-view, not just a different text color"
  ```

---

## Self-Review Notes

- **Spec coverage:** Roadmap items 1 (Task 1), 2 (Task 2), 3 (Task 3) are each covered
  by one task. Items 4–5 (persistence, rotate/resize handles) and the "nice-to-have"
  items 6–10 are explicitly out of scope per the user's request to do items 1–3 only.
- **Placeholder scan:** No TBD/"add appropriate"/"similar to Task N" placeholders — every
  step has the literal code to write.
- **Type consistency:** `selectedId?: string | null` (Task 2, `AnnotateCanvas` prop) is
  fed directly from `editingId: string | null` (already defined in `AnnotateScreen.tsx`)
  with no transformation, so the types line up. `MarkBadge`'s new `selected: boolean`
  prop is always passed (`mark.id === selectedId`), never left optional/undefined at the
  call site, so no `undefined`-vs-`boolean` mismatch inside the component.
