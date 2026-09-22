# Annotate as a Live Stage overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Annotate an overlay on the persistent Live Stage screen instead of a
full-screen replacement, and make drawn annotations always visible on the normal
chord/sheet view (not only while the Annotate dock is open).

**Architecture:** `AnnotateCanvas` gains an `interactive` flag so it can render strokes/
marks/pins as static visuals (read-only, pointer-events off) as well as its existing
fully interactive drawing mode. `LiveStage.tsx` builds its chart content exactly once
and wraps it in a read-only `AnnotateCanvas` at all times; `AnnotateScreen.tsx` is
restructured into `AnnotateOverlay.tsx`, which no longer builds its own copy of the
content — it receives it as `children` and wraps it in an interactive `AnnotateCanvas`,
rendering only its header/dock/edit-sheet chrome as an overlay on top of the same
persistent `.screen` Live Stage already renders.

**Tech Stack:** React 18 + TypeScript, no test framework (per CLAUDE.md, `npm run build`
is the correctness bar).

**Spec:** `docs/superpowers/specs/2026-09-23-annotate-as-overlay-design.md`

## Global Constraints

- No automated test framework exists in this repo — `npm run build` (`tsc -b && vite
  build`) clean is the verification bar for every task, plus the manual checks each
  task specifies.
- No change to the annotation data model, persistence, or drawing/select/erase
  mechanics inside `AnnotateCanvas.tsx` beyond the `interactive` gate itself (spec
  non-goals).
- Never add Claude as a commit co-author or mention Claude in code comments (CLAUDE.md).
- Commit messages state what changed and why, no conventional-commit prefixes.

---

## Task 1: Make Annotate an overlay in Live Stage

**Files:**
- Modify: `src/components/AnnotateCanvas.tsx`
- Rename: `src/screens/live-stage/AnnotateScreen.tsx` → `src/screens/live-stage/AnnotateOverlay.tsx`
- Modify: `src/screens/live-stage/LiveStage.tsx`

**Interfaces:**
- Produces: `AnnotateCanvas`'s prop type gains `interactive: boolean` (required) and
  makes `tool`, `scrollMode`, `penStyle`, `highlighterStyle`, `markStyle`, `shapeStyle`,
  `armedSymbol`, `armedShape`, `eraserSize` optional with defaults. `MarkBadge`/
  `PinBadge` gain a required `canvasInteractive: boolean` prop.
- Produces: `AnnotateOverlay(props: { song: Song; view: ChartView; activeKind?:
  AttachmentKind; scoreRef: RefObject<MxlScoreHandle | null>; reprojectTick: number;
  onClose: () => void; children: ReactNode })` — renders only header/dock/edit-sheet
  chrome, wraps `children` in an interactive `AnnotateCanvas` internally.

This is one task, not three, because the pieces only compile together:
`AnnotateCanvas`'s new required `interactive` prop must exist before anything can pass
it, and `AnnotateOverlay` no longer building its own content means `LiveStage.tsx` must
supply `children` in the same change. Splitting these across separate commits would
leave the build red in between.

- [ ] **Step 1: Add `PALETTE_PAGES` to `AnnotateCanvas.tsx`'s existing `utils/annotations` import**

In `src/components/AnnotateCanvas.tsx`, find:

```ts
import {
  hitTestAnnotation,
  isLineShape,
  isMark,
  isPin,
  isStroke,
  resolveAccentColor,
  resolveSelectionColor,
  rotateAround,
  shapeHalfExtents,
  SHAPE_ASPECT,
  snapRotation,
  STROKE_WIDTH,
  topStrokeHit,
} from "../utils/annotations";
```

Add `PALETTE_PAGES`:

```ts
import {
  hitTestAnnotation,
  isLineShape,
  isMark,
  isPin,
  isStroke,
  PALETTE_PAGES,
  resolveAccentColor,
  resolveSelectionColor,
  rotateAround,
  shapeHalfExtents,
  SHAPE_ASPECT,
  snapRotation,
  STROKE_WIDTH,
  topStrokeHit,
} from "../utils/annotations";
```

- [ ] **Step 2: Add `interactive` and default values to `AnnotateCanvas`'s props**

Replace the `AnnotateCanvas` function's destructured params and type block with:

```ts
export function AnnotateCanvas({
  annotations,
  interactive,
  tool = "select",
  onCommit,
  onReproject,
  onEditRequest,
  onSelectRequest,
  selectedId,
  scrollMode = false,
  scoreRef,
  reprojectSignal,
  penStyle = { color: PALETTE_PAGES[0][0], size: STROKE_WIDTH, opacity: 1 },
  highlighterStyle = { color: PALETTE_PAGES[0][2], size: 16, opacity: 0.3 },
  markStyle = { color: PALETTE_PAGES[0][3], size: 20 },
  shapeStyle = { color: PALETTE_PAGES[0][0], size: 22 },
  armedSymbol = { id: "" },
  armedShape = "line",
  eraserSize = 16,
  children,
}: {
  annotations: AnnotationObject[];
  /** false renders every stroke/mark/pin purely as static visuals — no
   * pointer capture, no drag/select/erase, no edit-sheet triggers — so the
   * chart underneath stays fully scrollable/swipeable/pinch-zoomable. Used
   * for Live Stage's persistent "annotations are always visible" overlay
   * (see the annotate-as-overlay design spec); `true` is today's full
   * drawing/editing behavior, used while the Annotate dock is open. */
  interactive: boolean;
  tool?: AnnotateTool;
  /** Called with the full next array whenever a draw/erase/place/move gesture
   * changes it — the caller owns undo history; this component only reports
   * finished user mutations. */
  onCommit: (next: AnnotationObject[]) => void;
  /** Called instead of `onCommit` when positions are being silently synced
   * to a re-rendered score (see `reprojectSignal`) rather than changed by
   * the person — this is not a user edit, so it must not push an undo-history
   * entry the way `onCommit` does. */
  onReproject: (next: AnnotationObject[]) => void;
  /** Fires when the `select` tool taps a stroke, or a text/shape mark is
   * tapped while `select` is active — the caller (AnnotateOverlay) owns the
   * style/edit-sheet UI, this component only knows a gesture happened. */
  onEditRequest?: (id: string) => void;
  /** Fires when the `select` tool's first tap lands on a `ShapeMark` that
   * isn't selected yet — selects it (so `ShapeHandles` renders and its
   * resize/rotate handles become reachable) WITHOUT opening its edit sheet.
   * Distinct from `onEditRequest`: tapping an already-selected shape (or any
   * non-shape mark) still goes straight through `onEditRequest` as before.
   * The caller is expected to keep its own selected-id state in sync with
   * both this and `onEditRequest` (see AnnotateOverlay). Also fires with
   * `null` when the `select` tool taps empty canvas — the caller should
   * clear its selected-id state in that case. */
  onSelectRequest?: (id: string | null) => void;
  /** Id of the currently selected stroke or mark (mirrors the caller's
   * open-edit-sheet state) — when set, that object is drawn/rendered with
   * a highlight so the Select tool's target is visible on the canvas, not
   * just in the edit sheet. */
  selectedId?: string | null;
  /** true pauses drawing so the wrapped content can be scrolled with a
   * normal single-finger drag instead — a single finger can't both draw
   * and scroll, so Annotate mode's tool row offers this as an explicit
   * toggle. */
  scrollMode?: boolean;
  /** Only meaningful for the `musicxml` view — lets pin/stroke/mark placement
   * anchor to the score's nearest measure, and lets `reprojectSignal`
   * reposition existing anchored annotations after a transpose. Omitted on
   * every other view (chords/image/pdf), which have no measures to anchor
   * to. */
  scoreRef?: RefObject<MxlScoreHandle | null>;
  /** Changes value whenever the score behind `scoreRef` just re-rendered
   * from a transpose — triggers a reprojection pass via `onReproject`. */
  reprojectSignal?: number;
  /** Style newly drawn pen/square strokes pick up. */
  penStyle?: InkStyle;
  highlighterStyle?: InkStyle;
  /** Style newly placed text/notation marks pick up. */
  markStyle?: MarkStyle;
  /** Style newly placed shape marks pick up. */
  shapeStyle?: MarkStyle;
  /** Which notation stamp the Notation tool places next. */
  armedSymbol?: ArmedSymbol;
  /** Which shape the Shapes tool places next. */
  armedShape?: ShapeId;
  eraserSize?: number;
  children: ReactNode;
}) {
```

- [ ] **Step 3: Gate the three pointer handlers on `interactive`**

Change `onPointerDown`'s first line from `if (scrollMode) return;` to:

```ts
    if (!interactive || scrollMode) return;
```

Change `onPointerMove`'s first line from `if (scrollMode || activePointer.current !== e.pointerId) return;` to:

```ts
    if (!interactive || scrollMode || activePointer.current !== e.pointerId) return;
```

Change `onPointerUp`'s first line from `if (activePointer.current !== e.pointerId) return;` to:

```ts
    if (!interactive || activePointer.current !== e.pointerId) return;
```

- [ ] **Step 4: Gate the canvas's pointer-events/touch-action and the overlay-tool div**

In the `<canvas ... />` element's `style` prop, change:

```ts
          touchAction: scrollMode ? "pan-y" : "none",
          pointerEvents: scrollMode || overlayTool ? "none" : "auto",
```

to:

```ts
          touchAction: interactive && !scrollMode ? "none" : "auto",
          pointerEvents: interactive && !scrollMode && !overlayTool ? "auto" : "none",
```

In the block right after `<canvas>`, change the condition from `{overlayTool &&
!scrollMode && (` to:

```tsx
      {interactive && overlayTool && !scrollMode && (
```

- [ ] **Step 5: Thread `canvasInteractive` into `PinBadge`/`MarkBadge`, gate `ShapeHandles`**

In the marks/pins DOM layer, add `canvasInteractive={interactive}` to the `<PinBadge
.../>` call:

```tsx
          <PinBadge
            key={pin.id}
            pin={pin}
            tool={tool}
            canvasInteractive={interactive}
            onErase={() => onCommit(annotations.filter((a) => a.id !== pin.id))}
            onOpen={() => setEditingPin({ id: pin.id, x: pin.position.x, y: pin.position.y, text: pin.text, anchor: pin.anchor, isNew: false })}
            onDrag={(x, y, clientX, clientY) => {
              const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
              onCommit(annotations.map((a) => (isPin(a) && a.id === pin.id ? { ...a, position: { x, y }, anchor } : a)));
              if (editingPin?.id === pin.id) setEditingPin(null);
            }}
          />
```

and to the `<MarkBadge .../>` call plus its `selected` prop and the `ShapeHandles`
condition:

```tsx
              <MarkBadge
                mark={displayMark}
                tool={tool}
                canvasInteractive={interactive}
                selected={interactive && tool === "select" && mark.id === selectedId}
                onErase={() => onCommit(annotations.filter((a) => a.id !== mark.id))}
                onEdit={() => onEditRequest?.(mark.id)}
                onSelect={() => onSelectRequest?.(mark.id)}
                onDrag={(x, y, clientX, clientY) => {
                  const anchor = scoreRef?.current?.anchorAtClientPoint(clientX, clientY) ?? undefined;
                  onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, position: { x, y }, anchor } : a)));
                }}
              />
              {interactive && tool === "select" && selectedId === mark.id && mark.kind === "shape" && (
                <ShapeHandles
                  mark={displayMark as ShapeMark}
                  toContent={toContent}
                  onPreview={(p) => setShapePreview(p ? { id: mark.id, ...p } : null)}
                  onResize={(width, size) => onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, width, size } : a)))}
                  onRotate={(rotation) => onCommit(annotations.map((a) => (a.id === mark.id ? { ...a, rotation } : a)))}
                />
              )}
```

- [ ] **Step 6: Add `canvasInteractive` to `MarkBadge`**

Change `MarkBadge`'s signature from:

```ts
function MarkBadge({
  mark,
  tool,
  selected,
  onErase,
  onEdit,
  onSelect,
  onDrag,
}: {
  mark: TextMark | ShapeMark;
  tool: AnnotateTool;
  selected: boolean;
  onErase: () => void;
  onEdit: () => void;
  onSelect: () => void;
  onDrag: (x: number, y: number, clientX: number, clientY: number) => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const interactive = tool === "select" || tool === "eraser";
```

to:

```ts
function MarkBadge({
  mark,
  tool,
  canvasInteractive,
  selected,
  onErase,
  onEdit,
  onSelect,
  onDrag,
}: {
  mark: TextMark | ShapeMark;
  tool: AnnotateTool;
  /** Mirrors the wrapping AnnotateCanvas's `interactive` prop — `false`
   * disables every pointer handler below regardless of `tool`, so a mark
   * shown by the read-only overlay can't be dragged/tapped. */
  canvasInteractive: boolean;
  selected: boolean;
  onErase: () => void;
  onEdit: () => void;
  onSelect: () => void;
  onDrag: (x: number, y: number, clientX: number, clientY: number) => void;
}) {
  const dragState = useRef<{ startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const interactive = canvasInteractive && (tool === "select" || tool === "eraser");
```

(The rest of `MarkBadge` already uses this local `interactive` const for
`pointerEvents`/`cursor` — `pointerEvents: "none"` is enough to stop its pointer
handlers from ever firing, so their bodies need no extra guard.)

- [ ] **Step 7: Add `canvasInteractive` to `PinBadge`**

Change `PinBadge`'s signature and its root `<div>`'s `pointerEvents` style from:

```ts
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
```

to:

```ts
function PinBadge({
  pin,
  tool,
  canvasInteractive,
  onErase,
  onOpen,
  onDrag,
}: {
  pin: Pin;
  tool: AnnotateTool;
  /** Same role as MarkBadge's `canvasInteractive` — `false` makes the pin a
   * static badge with no drag/tap handling, for the read-only overlay. */
  canvasInteractive: boolean;
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
        pointerEvents: canvasInteractive ? "auto" : "none",
        transform: "translate(-6px, -6px)",
        boxShadow: "0 2px 5px rgba(29,31,32,0.18)",
        touchAction: "none",
      }}
```

- [ ] **Step 8: Rename `AnnotateScreen.tsx` to `AnnotateOverlay.tsx`**

```bash
git mv src/screens/live-stage/AnnotateScreen.tsx src/screens/live-stage/AnnotateOverlay.tsx
```

- [ ] **Step 9: Update `AnnotateOverlay.tsx`'s imports**

Replace:

```ts
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
```

with:

```ts
import { useRef, useState, type ReactNode, type RefObject } from "react";
import { useStore } from "../../state/store";
import type { MxlScoreHandle } from "../../components/MxlScore";
import { Icon, type IconName } from "../../components/Icon";
import { Sheet } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { AnnotateCanvas, ShapeGlyph, type AnnotateTool, type ArmedSymbol } from "../../components/AnnotateCanvas";
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
```

(`ChordChart`/`MxlScore`/`PdfPages` are no longer imported here — content rendering
moved to `LiveStage.tsx`. `MxlScoreHandle` is still needed, but only as a type.)

- [ ] **Step 10: Rename the component and change its props**

Replace:

```ts
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
```

with:

```ts
export function AnnotateOverlay({
  song,
  view,
  activeKind,
  scoreRef,
  reprojectTick,
  onClose,
  children,
}: {
  song: Song;
  view: ChartView;
  activeKind?: AttachmentKind;
  /** The same ref Live Stage's shared content wires into its `MxlScore` —
   * lets pin/stroke/mark placement anchor to the score's nearest measure.
   * Only meaningful when the active view is `musicxml`. */
  scoreRef: RefObject<MxlScoreHandle | null>;
  /** Bumped by Live Stage whenever the shared content's `MxlScore` just
   * re-rendered from a transpose — triggers reprojection here. */
  reprojectTick: number;
  onClose: () => void;
  /** The chart/attachment content itself — built once by Live Stage and
   * shared with its own read-only annotation overlay, so this component no
   * longer builds a second copy (see the annotate-as-overlay design spec). */
  children: ReactNode;
}) {
```

- [ ] **Step 11: Remove the local `mxlScoreRef`/`reprojectTick` state**

Delete these two lines from the component body (now the `scoreRef`/`reprojectTick`
props instead):

```ts
  const mxlScoreRef = useRef<MxlScoreHandle>(null);
  const [reprojectTick, setReprojectTick] = useState(0);
```

- [ ] **Step 12: Delete the `content` construction**

Delete the entire `const content = ... ;` expression (the ternary that builds
`<ChordChart>`/`<img>`/`<MxlScore>`/`<PdfPages>`/the "Nothing to annotate yet"
fallback). `children` (the prop) replaces every use of `content` below.

- [ ] **Step 13: Wrap the outer `<div className="screen">` in a Fragment**

Change the component's `return (` from:

```tsx
  return (
    <div className="screen">
```

to:

```tsx
  return (
    <>
```

and change the matching closing tag at the very end of the `return` from `</div>` to
`</>`. (Live Stage's own `.screen` div — already `display: flex; flex-direction:
column; position: relative` — becomes the flex container for `AnnotateOverlay`'s header/
content/dock, the same way it already is for `AnnotateOverlay`'s edit sheets and the
Clear confirmation sheet, which are unaffected by this change.)

- [ ] **Step 14: Wire `children` and `interactive` into the internal `AnnotateCanvas`**

Replace:

```tsx
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
```

with:

```tsx
          <AnnotateCanvas
            annotations={annotations}
            interactive
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
            scoreRef={annotationView === "musicxml" ? scoreRef : undefined}
            reprojectSignal={annotationView === "musicxml" ? reprojectTick : undefined}
            penStyle={penStyle}
            highlighterStyle={highlighterStyle}
            markStyle={markStyle}
            shapeStyle={shapeStyle}
            armedSymbol={armed}
            armedShape={armedShape}
            eraserSize={eraserSize}
          >
            {children}
          </AnnotateCanvas>
```

(`scoreRef` here refers to the prop now, not the deleted local `mxlScoreRef`.)

- [ ] **Step 15: Update `LiveStage.tsx`'s imports**

Replace:

```ts
import { useEffect, useRef, useState } from "react";
import { useStore, activeSetlistSongIds } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { keySemitoneShift } from "../../utils/chordpro";
import { CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
import type { AttachmentKind } from "../../state/types";
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { MusicToolbar } from "./MusicToolbar";
import { StageToolsSheet } from "./StageToolsSheet";
import { AnnotateScreen } from "./AnnotateScreen";
```

with:

```ts
import { useEffect, useRef, useState } from "react";
import { useStore, activeSetlistSongIds } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type MxlScoreHandle, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { AnnotateCanvas } from "../../components/AnnotateCanvas";
import { keySemitoneShift } from "../../utils/chordpro";
import { CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
import type { AnnotationObject, AnnotationView, AttachmentKind } from "../../state/types";
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { MusicToolbar } from "./MusicToolbar";
import { StageToolsSheet } from "./StageToolsSheet";
import { AnnotateOverlay } from "./AnnotateOverlay";
```

- [ ] **Step 16: Add `mxlScoreRef`/`reprojectTick` state to `LiveStage`**

Find:

```ts
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

and insert a new state pair between them:

```ts
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>(undefined);
  const mxlScoreRef = useRef<MxlScoreHandle>(null);
  const [reprojectTick, setReprojectTick] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 17: Remove the early-return and add the derived overlay values**

Find:

```ts
  const chordsAnnotated = Boolean(song.annotations.chords?.length);
  const musicxmlAnnotated = Boolean(song.annotations.musicxml?.length);

  if (stage.drawer === "annotate") {
    return (
      <AnnotateScreen
        song={song}
        view={stage.view}
        activeKind={activeKind}
        activeVersion={activeVersion}
        semitones={semitones}
        hiddenParts={hiddenParts}
        fontScale={stage.zoom / 100}
        onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })}
      />
    );
  }
```

Replace it with:

```ts
  const chordsAnnotated = Boolean(song.annotations.chords?.length);
  const musicxmlAnnotated = Boolean(song.annotations.musicxml?.length);
  const dockOpen = stage.drawer === "annotate";
  const annotationView: AnnotationView = stage.view === "chords" ? "chords" : activeKind ?? "chords";
  const persistedAnnotations: AnnotationObject[] = song.annotations[annotationView] ?? [];
  // Reprojection (see AnnotateCanvas's onReproject doc) keeps anchored
  // MusicXML annotations aligned after a transpose even while the Annotate
  // dock is closed — the read-only overlay below is the only thing that can
  // persist that silently-corrected position back to the store when nobody
  // has the dock open to do it via Done.
  const onReprojectPersisted = (next: AnnotationObject[]) => {
    dispatch({ type: "UPDATE_SONG", song: { ...song, annotations: { ...song.annotations, [annotationView]: next } } });
  };
```

- [ ] **Step 18: Extract the chart content into a `content` variable, shared by both branches**

Find the `flex-1 hidden-scroll` div's children (the ternary starting `{stage.view ===
"chords" ? (` and ending just before the `</div>` that closes that content wrapper):

```tsx
        {stage.view === "chords" ? (
          <ChordChart
            chordpro={song.chordpro}
            semitones={semitones}
            fontScale={stage.zoom / 100}
            hideChords={stage.lyricsOnly}
          />
        ) : activeKind && activeVersion ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0" }}>
            {activeKind === "image" ? (
              <img
                src={activeVersion.dataUrl}
                alt={activeVersion.name}
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : activeKind === "musicxml" ? (
              <MxlScore
                src={activeVersion.dataUrl}
                transpose={semitones}
                hiddenParts={hiddenParts}
                onInstrumentsChange={setScoreInstruments}
                disableZoom={musicxmlAnnotated}
                staveSpacing={state.settings.staveSpacing}
              />
            ) : (
              <PdfPages src={activeVersion.dataUrl} />
            )}
            <span style={{ fontSize: 11, color: "var(--sheet-mut)" }}>
              {activeKind === "musicxml"
                ? `${activeVersion.name} · engraved from the score, no chords detected`
                : `${activeVersion.name} · saved as-is, no chords detected`}
            </span>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-title" style={{ color: "var(--sheet-fg)" }}>No sheet music attached</div>
            <div className="empty-body" style={{ color: "var(--sheet-mut)" }}>Attach a PDF, photo, or MusicXML score from Add/Edit Song to see it here.</div>
          </div>
        )}
```

Delete it from that spot and instead define it as a variable **before** the `return`
statement (right after the `onScreenClick` function definition is fine):

```ts
  // Built once and shared by both the read-only overlay (below, always
  // mounted) and AnnotateOverlay's interactive canvas (mounted only while
  // the dock is open) — see the annotate-as-overlay design spec's "One
  // content instance, not two" section. `disableZoom` on MxlScore/PdfPages
  // now also accounts for `dockOpen`, matching what AnnotateOverlay always
  // forced while it built its own separate copy of this content: pinch-zoom
  // gestures shouldn't fight with active drawing gestures.
  const content =
    stage.view === "chords" ? (
      <ChordChart
        chordpro={song.chordpro}
        semitones={semitones}
        fontScale={stage.zoom / 100}
        hideChords={stage.lyricsOnly}
      />
    ) : activeKind && activeVersion ? (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0" }}>
        {activeKind === "image" ? (
          <img
            src={activeVersion.dataUrl}
            alt={activeVersion.name}
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
          />
        ) : activeKind === "musicxml" ? (
          <MxlScore
            ref={mxlScoreRef}
            src={activeVersion.dataUrl}
            transpose={semitones}
            hiddenParts={hiddenParts}
            onInstrumentsChange={setScoreInstruments}
            disableZoom={musicxmlAnnotated || dockOpen}
            staveSpacing={state.settings.staveSpacing}
            onRerendered={() => setReprojectTick((t) => t + 1)}
          />
        ) : (
          <PdfPages src={activeVersion.dataUrl} disableZoom={dockOpen} />
        )}
        <span style={{ fontSize: 11, color: "var(--sheet-mut)" }}>
          {activeKind === "musicxml"
            ? `${activeVersion.name} · engraved from the score, no chords detected`
            : `${activeVersion.name} · saved as-is, no chords detected`}
        </span>
      </div>
    ) : (
      <div className="empty">
        <div className="empty-title" style={{ color: "var(--sheet-fg)" }}>No sheet music attached</div>
        <div className="empty-body" style={{ color: "var(--sheet-mut)" }}>Attach a PDF, photo, or MusicXML score from Add/Edit Song to see it here.</div>
      </div>
    );
```

- [ ] **Step 19: Compose the unified return**

Replace the entire `return (` ... `);` at the end of `LiveStage` with:

```tsx
  return (
    <div className="screen" onClick={onScreenClick}>
      {dockOpen ? (
        <AnnotateOverlay
          song={song}
          view={stage.view}
          activeKind={activeKind}
          scoreRef={mxlScoreRef}
          reprojectTick={reprojectTick}
          onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })}
        >
          {content}
        </AnnotateOverlay>
      ) : (
        <>
          <div className={"hdr" + (setlist ? " tinted" : "")} />

          {setlist && (
            <div style={{ padding: "8px 14px 0" }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                {songIndex + 1 < setlistSongIds.length
                  ? `Next: ${state.songs.find((s) => s.id === setlistSongIds[songIndex + 1])?.title ?? ""}`
                  : "Last song"}
              </div>
              <div style={{ width: "100%", height: 4, background: "var(--line)", borderRadius: 99 }}>
                <div
                  style={{
                    width: `${((songIndex + 1) / setlistSongIds.length) * 100}%`,
                    height: 4,
                    background: "var(--acc)",
                    borderRadius: 99,
                    transition: "width .2s",
                  }}
                />
              </div>
            </div>
          )}

          <div style={{ padding: "10px 14px 8px" }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 19 }}>{song.title}</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {song.artist}
            </div>
          </div>

          <div
            className="flex-1 hidden-scroll"
            style={{
              padding: "16px 14px 150px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              touchAction: "pan-y",
              background: stage.view === "sheet" ? "var(--sheet-bg)" : undefined,
              color: stage.view === "sheet" ? "var(--sheet-fg)" : undefined,
            }}
            onPointerDown={onChartPointerDown}
            onPointerUp={onChartPointerUp}
          >
            <AnnotateCanvas
              annotations={persistedAnnotations}
              interactive={false}
              onCommit={() => {}}
              onReproject={onReprojectPersisted}
              scoreRef={annotationView === "musicxml" ? mxlScoreRef : undefined}
              reprojectSignal={annotationView === "musicxml" ? reprojectTick : undefined}
            >
              {content}
            </AnnotateCanvas>
          </div>

          {!stage.chromeHidden && (hasChords || hasAttachment) && (
            <MusicToolbar onOpenTools={() => setStageToolsOpen(true)} />
          )}
        </>
      )}

      {stage.drawer === "add-song" && (
        <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stageToolsOpen && (
        <StageToolsSheet
          song={song}
          view={stage.view}
          hasChords={hasChords}
          availableKinds={availableKinds}
          activeKind={activeKind}
          activeVersionId={activeVersionId}
          onSelectChords={selectChordsView}
          onSelectSheet={selectSheetView}
          instruments={scoreInstruments}
          hiddenParts={hiddenParts}
          onToggleInstrument={toggleInstrument}
          chordsLocked={chordsAnnotated}
          instrumentsLocked={musicxmlAnnotated}
          onAddSong={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}
          onQuickEdit={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" })}
          onAnnotate={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" })}
          onClose={() => setStageToolsOpen(false)}
        />
      )}
    </div>
  );
}
```

Note the trailing `}` — this closes the `LiveStage` function itself, same as before.

- [ ] **Step 20: Build**

Run: `npm run build`

Expected: clean, no errors. If anything's unresolved (stale `AnnotateScreen` reference,
unused import, etc.), fix it before moving on.

- [ ] **Step 21: Manual smoke check**

Run `npm run dev`, open a song with existing chords on Live Stage:

1. Open Stage Tools → Annotate. Confirm the header swaps to Undo/Redo/Draw-Cues/Clear/
   Done and the bottom swaps to the drawing tool dock — song title/progress bar and
   `MusicToolbar` are gone while this is open, same as before.
2. Draw a pen stroke. Tap Done.
3. Confirm the stroke is now visible on the normal Live Stage view (title, progress bar,
   and `MusicToolbar` all back), without any navigation flash.
4. Reopen Annotate — confirm the stroke is there and editable (tap it, confirm the edit
   sheet opens; Undo removes it).

- [ ] **Step 22: Commit**

```bash
git add src/components/AnnotateCanvas.tsx src/screens/live-stage/AnnotateOverlay.tsx src/screens/live-stage/LiveStage.tsx
git commit -m "Make Annotate an overlay on Live Stage instead of a separate screen"
```

(Step 8's `git mv` already stages the rename; `git status` should show no leftover
`AnnotateScreen.tsx` before you commit.)

---

## Task 2: Full regression pass and docs updates

**Files:**
- Modify: `docs/progress-checklist.md`
- Modify: `docs/annotate-mode-roadmap.md`

**Interfaces:** None — this task is verification and documentation only.

- [ ] **Step 1: Full manual click-through**

Using `npm run dev`, work through every item from the spec's Testing section:

1. `npm run build` is clean.
2. Draw a pen stroke over the chords view, tap Done — confirm the stroke is visible on
   the normal (non-annotate) Live Stage view.
3. With that stroke visible, load a setlist with multiple songs and swipe left/right to
   change songs — confirm the swipe still works (the read-only overlay must not swallow
   the gesture).
4. Reopen Annotate on that song — confirm the stroke is there, editable, and Undo/Redo
   still work.
5. Repeat steps 2–4 against an attached PDF, an attached image, and an attached
   MusicXML score.
6. Confirm the title/progress-bar header and `MusicToolbar` are fully replaced by
   Annotate's header/dock while open, and fully restored (with annotations still
   visible on the chart) after Done — no flash of an empty/different screen either way.
7. Confirm capo/zoom/lyrics-only/transpose/instrument-visibility locking still engages
   once a view has annotations, both while the dock is open and while it's closed and
   the marks are just being displayed (`chordsLocked`/`instrumentsLocked` passed to
   `StageToolsSheet`).
8. Force-reload the browser tab — confirm annotations still render on the normal view
   after reload, without ever having opened Annotate this session (exercises the
   `interactive={false}` path reading straight from persisted `song.annotations`).
9. On a MusicXML score that already has annotations from a previous session, reload and
   confirm the annotations line up correctly with the score on first paint (watch for
   the canvas being sized before OSMD finishes its first engrave — if marks appear
   mispositioned only on a cold load and correct themselves after any transpose, note
   it, but do not attempt to fix `AnnotateCanvas`'s sizing/freeze logic here — that's
   out of this plan's scope per the design spec's non-goals; file it as a follow-up
   instead).
10. With a song on stage that has annotations on its `musicxml` view, transpose the key
    while Annotate is **closed** — confirm the score re-engraves and the annotations
    reproject to follow it (not left behind at stale pixel positions), the same way they
    already do while Annotate is open.

If any step fails, fix the root cause in `AnnotateOverlay.tsx`/`LiveStage.tsx`/
`AnnotateCanvas.tsx` before proceeding — do not defer known-broken behavior.

- [ ] **Step 2: Update `docs/progress-checklist.md`**

Find the "Annotate / custom notes on a song" bullet (search for `**Annotate / custom
notes on a song.**`). It currently says annotations are "drawn and reviewed inside the
dedicated Annotate screen ... not a persistent overlay on the normal Live Stage view
itself" — that sentence is now wrong. Update it (and the "Annotate screen" reference
later in the same bullet, and the one in the "Stave spacing" bullet) to describe the new
architecture: annotations render on the normal Live Stage view at all times; the
Annotate dock is an overlay on the same screen, not a separate one. Keep the rest of the
bullet (the transpose/reprojection explanation, the spec cross-references) as-is — none
of that changed. Add a cross-reference to
`docs/superpowers/specs/2026-09-23-annotate-as-overlay-design.md` alongside the existing
two spec references.

- [ ] **Step 3: Update `docs/annotate-mode-roadmap.md`**

The "Done so far" section's first bullet names `AnnotateScreen.tsx` — update the
filename reference to `AnnotateOverlay.tsx`, and add a short note that Annotate is now
composed as an overlay on Live Stage rather than a full-screen replacement, with a
pointer to the new spec.

- [ ] **Step 4: Commit**

```bash
git add docs/progress-checklist.md docs/annotate-mode-roadmap.md
git commit -m "Update annotate-mode docs to reflect the overlay architecture"
```
