# Song Notes and Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Live Stage's decorative Annotate shell with a real feature: typed
freeform notes on any song, plus real canvas-drawn strokes (pen/rectangle/eraser) over
whichever chart type is currently on screen (chords, image, PDF, or MusicXML),
persisted through SQLite like every other song field.

**Architecture:** One new `Song.notes: string` field and one new
`Song.annotations: Partial<Record<AnnotationView, Stroke[]>>` field, both persisted via
`songsRepo`'s existing full-replace pattern. A new reusable `AnnotateCanvas` component
overlays a plain 2D-canvas drawing surface on top of whatever content it wraps; a new
full-screen `AnnotateScreen` composes it with the real chart/attachment content and a
Draw/Notes tab switch, replacing `LiveStage.tsx`'s old `AnnotateMode`. Controls that
would reflow a view's content (transpose, capo, chord-chart zoom, lyrics-only,
instrument visibility, MusicXML's own pinch-zoom) are disabled once that view's stroke
layer is non-empty, so persisted strokes never silently drift.

**Tech Stack:** React 18 + TypeScript, plain `<canvas>` 2D context (no drawing library),
existing SQLite persistence layer (`@capacitor-community/sqlite` / `sql.js` fallback).

**Spec:** `docs/superpowers/specs/2026-09-20-song-notes-and-annotations-design.md`

## Global Constraints

- No automated test framework exists in this repo (CLAUDE.md's documented gotcha) —
  `npm run build` (`tsc -b && vite build`) clean, plus the manual verification steps
  described in each task, is the correctness bar. Every task ends with a clean build.
- One fixed accent color for all strokes (resolved from the live `--acc` CSS custom
  property) — no color picker.
- Eraser removes whole strokes it touches (object eraser), never partial pixel regions.
- Strokes are saved per song + view type (`"chords" | "image" | "pdf" | "musicxml"`),
  never split further by attachment version.
- Never add Claude as a commit co-author beyond the exact trailer this repo's system
  reminder specifies; never mention Claude in code comments (CLAUDE.md ground rules).
- Commit messages describe the change, not generic `feat:`/`fix:` tags (CLAUDE.md
  ground rules).

---

## Task 1: Data model and persistence

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/store.ts`
- Modify: `src/state/mockData.ts`
- Modify: `src/data/db.ts`
- Modify: `src/data/songsRepo.ts`

**Interfaces:**
- Produces: `AnnotationView` (`"chords" | "image" | "pdf" | "musicxml"`), `Stroke`
  (`{ id: string; tool: "pen" | "square"; points: { x: number; y: number }[] }`),
  `Song.notes: string`, `Song.annotations: Partial<Record<AnnotationView, Stroke[]>>`.
  Every later task reads/writes these exact names.
- Consumes: nothing (foundational task).

- [ ] **Step 1: Add the new types to `src/state/types.ts`**

Add after `export type Attachments = ...` (around line 24):

```ts
export type AnnotationView = "chords" | "image" | "pdf" | "musicxml";

export interface Stroke {
  id: string;
  tool: "pen" | "square";
  /** "pen": every point on the drawn polyline, in order. "square": exactly
   * two points — the drag's start and end corners. Coordinates are in CSS
   * pixels relative to the top-left of the view's content area, at that
   * content's natural (unzoomed) size. */
  points: { x: number; y: number }[];
}
```

Add two fields to the `Song` interface (after `attachments: Attachments;`):

```ts
  /** Freeform text notes for this song — reminders, cues, anything worth
   * having on hand regardless of chart type. "" when empty. */
  notes: string;
  /** Hand-drawn markup, one stroke layer per view type this song can show.
   * {} when nothing has been drawn yet. */
  annotations: Partial<Record<AnnotationView, Stroke[]>>;
```

Remove `annotate: boolean;` from `StageState` (it's replaced by
`Drawer === "annotate"`). Add `"annotate"` to the `Drawer` union:

```ts
export type Drawer = "add-song" | "quick-edit" | "add-to-set" | "annotate" | null;
```

- [ ] **Step 2: Remove the old annotate action from `src/state/store.ts`**

In `emptyStage` (around line 40), delete the `annotate: false,` line.

In the `Action` union (around line 97), delete `| { type: "STAGE_TOGGLE_ANNOTATE" }`.

In the `reducer` switch (around line 297-298), delete:

```ts
    case "STAGE_TOGGLE_ANNOTATE":
      return { ...state, stage: { ...state.stage, annotate: !state.stage.annotate } };
```

- [ ] **Step 3: Seed the new fields in `src/state/mockData.ts`**

Add `notes: "",` and `annotations: {},` to the one seeded song object (the `"As The
Deer"` entry), after its `attachments` field.

- [ ] **Step 4: Add the two new columns to `src/data/db.ts`**

Bump `DB_VERSION` from `2` to `3` (line 5).

Add the two columns to `CREATE_SONGS` (around line 43), so a fresh install already has
them:

```ts
const CREATE_SONGS = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL,
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT NOT NULL DEFAULT '',
  annotations_json TEXT NOT NULL DEFAULT '{}'
);`;
```

Add a `toVersion: 3` upgrade step to the `addUpgradeStatement` call (after the existing
`toVersion: 2` entry, around line 111):

```ts
    {
      // Additive columns on an existing table — unlike the v1->v2 change,
      // there's real local data worth preserving by this point, so this
      // uses ALTER TABLE instead of dropping and recreating the table.
      toVersion: 3,
      statements: [
        "ALTER TABLE songs ADD COLUMN notes TEXT NOT NULL DEFAULT '';",
        "ALTER TABLE songs ADD COLUMN annotations_json TEXT NOT NULL DEFAULT '{}';",
      ],
    },
```

- [ ] **Step 5: Read/write the two new columns in `src/data/songsRepo.ts`**

Add to `SongRow` (after `attachments_json: string;`):

```ts
  notes: string;
  annotations_json: string;
```

Add to `rowToSong` (after `attachments: JSON.parse(...)`):

```ts
    notes: row.notes,
    annotations: JSON.parse(row.annotations_json || "{}") as Song["annotations"],
```

Update `buildInsertStatements` — the statement and values need the two new columns:

```ts
export function buildInsertStatements(songs: Song[]): { statement: string; values: unknown[] }[] {
  return songs.map((s) => ({
    statement: `INSERT INTO songs
      (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachments_json, notes, annotations_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
      s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
      JSON.stringify(s.attachments), s.notes, JSON.stringify(s.annotations),
    ],
  }));
}
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: clean (`tsc -b && vite build` exits 0). If it fails, the error will point at a
call site still constructing a `Song` without `notes`/`annotations` — every such call
site is fixed by the end of this plan (Task 9 covers `AddEditSong.tsx`'s `save()`); it's
fine for `npm run build` to still fail on `AddEditSong.tsx` specifically until Task 9 —
confirm the *only* remaining error is there before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/state/types.ts src/state/store.ts src/state/mockData.ts src/data/db.ts src/data/songsRepo.ts
git commit -m "Add notes and annotations fields to the song data model and persistence"
```

---

## Task 2: Stroke geometry and color helpers

**Files:**
- Create: `src/utils/annotations.ts`

**Interfaces:**
- Consumes: `Stroke` (from Task 1, `src/state/types.ts`).
- Produces: `STROKE_WIDTH: number`, `ERASE_RADIUS: number`,
  `hitTestStroke(stroke: Stroke, point: {x:number;y:number}, radius?: number): boolean`,
  `resolveAccentColor(el: Element): string`. Task 6 (`AnnotateCanvas`) imports all four.

- [ ] **Step 1: Write `src/utils/annotations.ts`**

```ts
import type { Stroke } from "../state/types";

export const STROKE_WIDTH = 3;
export const ERASE_RADIUS = 14;

interface Point {
  x: number;
  y: number;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function strokeSegments(stroke: Stroke): [Point, Point][] {
  if (stroke.tool === "square" && stroke.points.length === 2) {
    const [a, b] = stroke.points;
    const corners: Point[] = [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ];
    return corners.map((c, i) => [c, corners[(i + 1) % corners.length]] as [Point, Point]);
  }
  const segments: [Point, Point][] = [];
  for (let i = 0; i < stroke.points.length - 1; i++) {
    segments.push([stroke.points[i], stroke.points[i + 1]]);
  }
  if (segments.length === 0 && stroke.points.length === 1) {
    segments.push([stroke.points[0], stroke.points[0]]);
  }
  return segments;
}

/** True if `point` lands within `radius` of any part of `stroke`'s drawn
 * path. Used by the eraser tool, which removes whole strokes rather than
 * partial pixel regions — see the spec's "object eraser" decision. */
export function hitTestStroke(stroke: Stroke, point: Point, radius: number = ERASE_RADIUS): boolean {
  return strokeSegments(stroke).some(([a, b]) => distanceToSegment(point, a, b) <= radius);
}

/** Resolves the app's single fixed annotation color from the live theme's
 * `--acc` custom property (read off `el`'s computed style), so drawn marks
 * track the accent color in both Light and Stage Dark without hardcoding a
 * hex value that could drift out of sync with theme.css. */
export function resolveAccentColor(el: Element): string {
  const value = getComputedStyle(el).getPropertyValue("--acc").trim();
  return value || "#5980a6";
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: same pre-existing `AddEditSong.tsx` error as Task 1 left it at, nothing new
from this file (it isn't imported anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add src/utils/annotations.ts
git commit -m "Add stroke hit-testing and accent-color helpers for canvas annotation"
```

---

## Task 3: `disableZoom` escape hatch on the score and PDF renderers

**Files:**
- Modify: `src/components/MxlScore.tsx`
- Modify: `src/components/PdfPages.tsx`

**Interfaces:**
- Produces: `MxlScore`'s and `PdfPages`' props both gain an optional
  `disableZoom?: boolean` (default `false`, existing call sites unaffected). Task 7
  (`AnnotateScreen`) passes `disableZoom` (always `true`) when rendering either inside
  Annotate mode, because a stable, unzoomed coordinate space is required for strokes to
  land in the right place — pinch-zooming while drawing would mean converting every
  pointer event through the live zoom transform for no real benefit, since Annotate
  mode already lets you scroll to whatever part of the content you want to mark up.
  Task 8 (`LiveStage.tsx`) separately passes `disableZoom={musicxmlAnnotated}` to the
  *normal* (non-Annotate) `MxlScore` render, per the spec's locking table — MusicXML's
  pinch/wheel zoom is a real re-engrave (`osmd.Zoom` + `updateGraphic()`), not a camera
  transform, so it must lock once that view has strokes, same as transpose.

- [ ] **Step 1: Add `disableZoom` to `MxlScore.tsx`**

Add the parameter (in the destructured props, after `onInstrumentsChange`):

```ts
  disableZoom = false,
}: {
  src: string;
  transpose?: number;
  hiddenParts?: ReadonlySet<string>;
  onInstrumentsChange?: (instruments: ScoreInstrument[]) => void;
  /** Disables the internal pinch/wheel engraving-zoom gesture entirely —
   * see Task 3 of the annotations plan for why. */
  disableZoom?: boolean;
}) {
```

Change the rendered container (around line 286-306) to only attach the gesture
handlers when zoom isn't disabled:

```tsx
      <div
        ref={ez.containerRef}
        style={{
          visibility: status === "ready" ? "visible" : "hidden",
          width: "100%",
          touchAction: "pan-y",
          borderRadius: 8,
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
```

Guard the native wheel-listener effect (around line 109-122) the same way:

```ts
  useEffect(() => {
    if (!el || disableZoom) return;
    const handler = (e: WheelEvent) => {
      // ... unchanged body ...
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, disableZoom]);
```

(This effect lives inside `useEngravingZoom` — thread `disableZoom` through as an
argument to that hook: `useEngravingZoom(onCommit: (zoom: number) => void, disableZoom:
boolean)`, and pass it from the component: `useEngravingZoom(setEngravingZoom,
disableZoom)`.)

- [ ] **Step 2: Add `disableZoom` to `PdfPages.tsx`**

Add the parameter:

```ts
export function PdfPages({ src, disableZoom = false }: { src: string; disableZoom?: boolean }) {
```

Change the rendered container (around line 205-225) to only attach `usePanZoom`'s
handlers when zoom isn't disabled:

```tsx
      <div
        ref={containerRef}
        style={{
          visibility: status === "ready" ? "visible" : "hidden",
          width: "100%",
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
```

Guard the native wheel-listener effect (around line 85-98) inside `usePanZoom` the same
way — thread a `disableZoom: boolean` argument into `usePanZoom(hostRef, disableZoom)`
and change the effect to `if (!el || disableZoom) return;` with `disableZoom` added to
its dependency array. Call it from the component as `usePanZoom(containerRef,
disableZoom)`.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: same pre-existing `AddEditSong.tsx` error only. Manually smoke-test in `npm
run dev`: open the seeded "As The Deer" song's sheet view, confirm pinch/wheel zoom
still works exactly as before (default `disableZoom={false}` at every existing call
site means zero behavior change there).

- [ ] **Step 4: Commit**

```bash
git add src/components/MxlScore.tsx src/components/PdfPages.tsx
git commit -m "Add a disableZoom escape hatch to the score and PDF renderers"
```

---

## Task 4: Lockable `KeyChips`

**Files:**
- Modify: `src/components/KeyChips.tsx`
- Modify: `src/theme.css`

**Interfaces:**
- Produces: `KeyChips` gains an optional `disabled?: boolean` prop (default `false`).
  Task 8 (`MusicToolbar.tsx`) passes `disabled={transposeLocked}`.

- [ ] **Step 1: Add `disabled` to `KeyChips.tsx`**

```tsx
export function KeyChips({
  active,
  onSelect,
  disabled = false,
}: {
  active: string | null;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  return (
    <div className="key-row">
      {CHROMATIC.map((k) => {
        const isActive = k === active;
        return (
          <button
            key={k}
            ref={isActive ? activeRef : undefined}
            className={"key-row-btn" + (isActive ? " active" : "")}
            disabled={disabled}
            onClick={() => onSelect(k)}
          >
            {k}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Add the disabled style to `src/theme.css`**

Add right after the existing `.key-row-btn.active` rule (around line 442-447):

```css
.key-row-btn:disabled {
  opacity: 0.4;
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: same pre-existing `AddEditSong.tsx` error only.

- [ ] **Step 4: Commit**

```bash
git add src/components/KeyChips.tsx src/theme.css
git commit -m "Let KeyChips render disabled, for locking transpose once a view has annotations"
```

---

## Task 5: `AnnotateCanvas` — the reusable drawing overlay

**Files:**
- Create: `src/components/AnnotateCanvas.tsx`

**Interfaces:**
- Consumes: `Stroke` (Task 1), `STROKE_WIDTH`/`ERASE_RADIUS`/`hitTestStroke`/
  `resolveAccentColor` (Task 2).
- Produces: `AnnotateTool` (`"pen" | "square" | "eraser"`), and
  `AnnotateCanvas({ strokes, tool, onCommit, scrollMode, children })` — a component that
  renders `children` unmodified, sized to their natural content height, with a
  transparent canvas overlaid on top that turns pointer drags into `Stroke`s. Task 7
  (`AnnotateScreen`) is the only consumer.

- [ ] **Step 1: Write `src/components/AnnotateCanvas.tsx`**

```tsx
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
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: same pre-existing `AddEditSong.tsx` error only (this file isn't imported
anywhere yet).

- [ ] **Step 3: Commit**

```bash
git add src/components/AnnotateCanvas.tsx
git commit -m "Add AnnotateCanvas, a reusable pen/rectangle/eraser drawing overlay"
```

---

## Task 6: `AnnotateScreen` — the full-screen Draw/Notes surface

**Files:**
- Create: `src/screens/live-stage/AnnotateScreen.tsx`

**Interfaces:**
- Consumes: `AnnotateCanvas`/`AnnotateTool` (Task 5), `AnnotationView`/`Stroke`/`Song`/
  `AttachmentKind`/`AttachmentVersion`/`ChartView` (Task 1), `useStore` (existing),
  `ChordChart`/`MxlScore`/`PdfPages`/`Icon`/`Dialog`/`Segmented` (existing).
- Produces: `AnnotateScreen({ song, view, activeKind, activeVersion, semitones,
  hiddenParts, fontScale, onClose })`. Task 8 (`LiveStage.tsx`) is the only consumer,
  and supplies every prop from state it already computes today.

- [ ] **Step 1: Write `src/screens/live-stage/AnnotateScreen.tsx`**

```tsx
import { useState } from "react";
import { useStore } from "../../state/store";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { Icon, type IconName } from "../../components/Icon";
import { Dialog } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { AnnotateCanvas, type AnnotateTool } from "../../components/AnnotateCanvas";
import type { AnnotationView, AttachmentKind, AttachmentVersion, ChartView, Song, Stroke } from "../../state/types";

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
  const { dispatch } = useStore();
  const annotationView: AnnotationView = view === "chords" ? "chords" : activeKind ?? "chords";

  const [mode, setMode] = useState<"draw" | "notes">("draw");
  const [tool, setTool] = useState<AnnotateTool>("pen");
  const [scrollMode, setScrollMode] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>(song.annotations[annotationView] ?? []);
  const [history, setHistory] = useState<Stroke[][]>([]);
  const [notesText, setNotesText] = useState(song.notes);
  const [confirmClear, setConfirmClear] = useState(false);

  const commit = (next: Stroke[]) => {
    setHistory((h) => [...h, strokes]);
    setStrokes(next);
  };

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setStrokes(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const done = () => {
    dispatch({
      type: "UPDATE_SONG",
      song: { ...song, notes: notesText, annotations: { ...song.annotations, [annotationView]: strokes } },
    });
    onClose();
  };

  const content =
    view === "chords" ? (
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.35 }}>
        <ChordChart chordpro={song.chordpro} semitones={semitones} fontScale={fontScale} />
      </div>
    ) : activeKind === "image" && activeVersion ? (
      <img src={activeVersion.dataUrl} alt={activeVersion.name} style={{ width: "100%", display: "block" }} />
    ) : activeKind === "musicxml" && activeVersion ? (
      <div style={{ padding: 8 }}>
        <MxlScore src={activeVersion.dataUrl} transpose={semitones} hiddenParts={hiddenParts} disableZoom />
      </div>
    ) : activeKind === "pdf" && activeVersion ? (
      <PdfPages src={activeVersion.dataUrl} disableZoom />
    ) : (
      <div className="muted" style={{ padding: 20, fontSize: 12, textAlign: "center" }}>
        Nothing to annotate yet.
      </div>
    );

  return (
    <div className="screen">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          background: "var(--tint)",
          borderBottom: "1px solid var(--acc)",
        }}
      >
        <button className="hdr-action" onClick={undo} disabled={history.length === 0}>
          Undo
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <Segmented
            options={[
              { value: "draw", label: "Draw" },
              { value: "notes", label: "Notes" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <button className="hdr-action" onClick={done}>
          Done
        </button>
      </div>

      <div className="flex-1 hidden-scroll" style={{ position: "relative" }}>
        {mode === "draw" ? (
          <AnnotateCanvas strokes={strokes} tool={tool} onCommit={commit} scrollMode={scrollMode}>
            {content}
          </AnnotateCanvas>
        ) : (
          <textarea
            value={notesText}
            onChange={(e) => setNotesText(e.target.value)}
            placeholder="Notes for this song — reminders, cues, anything you want on hand while you're on stage."
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              padding: "16px 14px",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: 1.5,
              background: "var(--bg)",
              color: "var(--fg)",
              resize: "none",
            }}
          />
        )}
      </div>

      {mode === "draw" && (
        <div
          style={{
            position: "absolute",
            top: 64,
            right: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "8px 6px",
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <span style={{ width: 18, height: 18, borderRadius: 99, background: "var(--acc)", border: "2px solid var(--surface)" }} />
          <span style={{ width: 20, height: 1, background: "var(--line)" }} />
          <ToolButton icon="edit" active={tool === "pen"} onClick={() => { setTool("pen"); setScrollMode(false); }} label="Pen" />
          <ToolButton icon="square" active={tool === "square"} onClick={() => { setTool("square"); setScrollMode(false); }} label="Rectangle" />
          <ToolButton icon="eraser" active={tool === "eraser"} onClick={() => { setTool("eraser"); setScrollMode(false); }} label="Eraser" />
          <span style={{ width: 20, height: 1, background: "var(--line)" }} />
          <ToolButton icon="grip" active={scrollMode} onClick={() => setScrollMode((s) => !s)} label="Scroll" />
          <button
            onClick={() => setConfirmClear(true)}
            disabled={strokes.length === 0}
            style={{
              background: "none",
              border: "none",
              color: "#8c3b3b",
              fontSize: 10,
              fontWeight: 600,
              opacity: strokes.length === 0 ? 0.35 : 1,
            }}
          >
            Clear
          </button>
        </div>
      )}

      {confirmClear && (
        <Dialog>
          <div className="dialog-title">Clear marks on this view?</div>
          <div className="dialog-body">This can't be undone once you leave Annotate.</div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmClear(false)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmClear(false);
                commit([]);
              }}
            >
              Clear
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  active,
  onClick,
  label,
}: {
  icon: IconName;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{ background: "none", border: "none", color: active ? "var(--acc)" : "var(--mut)", display: "flex" }}
    >
      <Icon name={icon} size={15} strokeWidth={1.9} />
    </button>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: same pre-existing `AddEditSong.tsx` error only (this file isn't wired into
`LiveStage.tsx` yet).

- [ ] **Step 3: Commit**

```bash
git add src/screens/live-stage/AnnotateScreen.tsx
git commit -m "Add AnnotateScreen, replacing the old decorative Annotate shell's design"
```

---

## Task 7: Lockable `MusicToolbar`

**Files:**
- Modify: `src/screens/live-stage/MusicToolbar.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MusicToolbar` drops its `onAnnotate` prop (the Annotate icon moves to
  Live Stage's `fab-stack` in Task 8) and gains `transposeLocked`, `chordsLocked`, and
  `instrumentsLocked` (all `boolean`, all required — Task 8 always computes and passes
  them).

- [ ] **Step 1: Update the props and `KeyChips` call**

Change the prop signature (remove `onAnnotate`, add the three lock flags):

```tsx
export function MusicToolbar({
  view,
  hasChords,
  instruments,
  hiddenParts,
  onToggleInstrument,
  transposeLocked,
  chordsLocked,
  instrumentsLocked,
}: {
  view: ChartView;
  hasChords: boolean;
  instruments: ScoreInstrument[];
  hiddenParts: ReadonlySet<string>;
  onToggleInstrument: (id: string) => void;
  /** Disables the key-transpose row — locked once either the "chords" or
   * "musicxml" annotation layer has strokes, since both views share the
   * same `stage.dispKey`. */
  transposeLocked: boolean;
  /** Disables capo/lyrics-only/zoom — locked once the "chords" annotation
   * layer has strokes. */
  chordsLocked: boolean;
  /** Disables the instrument show/hide chips — locked once the "musicxml"
   * annotation layer has strokes. */
  instrumentsLocked: boolean;
}) {
```

Update the `KeyChips` call (around line 63):

```tsx
        <KeyChips active={key} onSelect={(k) => dispatch({ type: "STAGE_SET_KEY", key: k })} disabled={transposeLocked} />
```

- [ ] **Step 2: Lock the capo/lyrics/zoom row, remove the Annotate icon**

Replace the chords-view second row (around lines 66-92):

```tsx
      {showSecondRow && stage.toolbarExpanded && view === "chords" && (
        <div
          style={{
            padding: "9px 10px 12px",
            display: "flex",
            alignItems: "center",
            borderTop: "1px solid var(--line)",
            gap: 2,
            opacity: chordsLocked ? 0.4 : 1,
          }}
        >
          <ToolbarStepper
            label="Capo"
            value={stage.capo}
            disabled={chordsLocked}
            onDec={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo - 1 })}
            onInc={() => dispatch({ type: "STAGE_SET_CAPO", capo: stage.capo + 1 })}
          />
          <ToolbarIcon
            glyph="Aa"
            label="Lyrics"
            active={stage.lyricsOnly}
            disabled={chordsLocked}
            onClick={() => dispatch({ type: "STAGE_TOGGLE_LYRICS_ONLY" })}
          />
          <ToolbarIcon
            glyph="－"
            label="Zoom−"
            disabled={chordsLocked}
            onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom - 10 })}
          />
          <ToolbarIcon
            glyph="＋"
            label="Zoom+"
            disabled={chordsLocked}
            onClick={() => dispatch({ type: "STAGE_SET_ZOOM", zoom: stage.zoom + 10 })}
          />
        </div>
      )}
```

(Note the `annotate` `ToolbarIcon` line is gone — that entry point moved to Live
Stage's `fab-stack` in Task 8.)

- [ ] **Step 3: Lock the instrument-visibility row**

Replace the sheet-view second row (around lines 94-114):

```tsx
      {showSecondRow && stage.toolbarExpanded && view === "sheet" && (
        <div
          style={{
            padding: "9px 14px 12px",
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            borderTop: "1px solid var(--line)",
          }}
        >
          {instruments.map((inst) => (
            <button
              key={inst.id}
              className={"chip" + (hiddenParts.has(inst.id) ? "" : " active")}
              disabled={instrumentsLocked}
              style={{ opacity: instrumentsLocked ? 0.4 : 1 }}
              onClick={() => onToggleInstrument(inst.id)}
            >
              {inst.name}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Add `disabled` support to `ToolbarStepper` and `ToolbarIcon`**

```tsx
function ToolbarStepper({
  label,
  value,
  onDec,
  onInc,
  disabled = false,
}: {
  label: string;
  value: number;
  onDec: () => void;
  onInc: () => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button
          onClick={onDec}
          disabled={disabled}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1.5px solid var(--acc)",
            color: "var(--acc)",
            background: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          −
        </button>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--acc)", minWidth: 16, textAlign: "center" }}>{value}</span>
        <button
          onClick={onInc}
          disabled={disabled}
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "1.5px solid var(--acc)",
            color: "var(--acc)",
            background: "none",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          +
        </button>
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </div>
  );
}

function ToolbarIcon({
  glyph,
  icon,
  label,
  onClick,
  active,
  disabled = false,
}: {
  glyph?: string;
  icon?: IconName;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 3,
        flex: 1,
        background: "none",
        border: "none",
      }}
    >
      <span style={{ fontSize: 19, lineHeight: 1, display: "flex", color: active ? "var(--acc-deep)" : "var(--acc)" }}>
        {icon ? <Icon name={icon} size={19} strokeWidth={1.8} /> : glyph}
      </span>
      <span style={{ fontSize: 10, fontWeight: 600, color: "var(--mut)" }}>{label}</span>
    </button>
  );
}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: a *new* error at `LiveStage.tsx`'s `<MusicToolbar>` call site (missing the
three new required props, still passing the now-removed `onAnnotate`) — Task 8 fixes
this. Confirm no other new errors appeared.

- [ ] **Step 6: Commit**

```bash
git add src/screens/live-stage/MusicToolbar.tsx
git commit -m "Let MusicToolbar disable transpose/capo/zoom/lyrics/instrument controls when locked"
```

---

## Task 8: Wire it all into Live Stage

**Files:**
- Modify: `src/screens/live-stage/LiveStage.tsx`

**Interfaces:**
- Consumes: `AnnotateScreen` (Task 6), `MusicToolbar`'s new props (Task 7),
  `MxlScore`'s `disableZoom` (Task 3).
- Produces: nothing new for later tasks — this is the integration point.

- [ ] **Step 1: Remove the old annotate state and shell**

In the imports (top of file), add:

```ts
import { AnnotateScreen } from "./AnnotateScreen";
```

Change the idle-timer effect (around lines 69-83) — `stage.annotate` no longer exists,
replace both references with a check against `stage.drawer`:

```tsx
  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (stage.chromeHidden) dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: false });
    if (song && !stage.ended && stage.drawer !== "annotate") {
      idleTimer.current = setTimeout(() => dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true }), IDLE_MS);
    }
  };

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.ended, stage.drawer]);
```

Delete the old early return (around lines 85-87):

```tsx
  if (stage.annotate && song) {
    return <AnnotateMode song={song} onDone={() => dispatch({ type: "STAGE_TOGGLE_ANNOTATE" })} />;
  }
```

Delete the entire `AnnotateMode` function at the bottom of the file (the ~45-line block
starting with `function AnnotateMode({ song, onDone }: ...)`).

- [ ] **Step 2: Compute the lock flags and render `AnnotateScreen`**

After `activeVersion` is computed (right after the line `const activeVersion =
activeBucket ? ... : undefined;`, around line 177), add:

```tsx
  const chordsAnnotated = Boolean(song.annotations.chords?.length);
  const musicxmlAnnotated = Boolean(song.annotations.musicxml?.length);
  const transposeLocked = chordsAnnotated || musicxmlAnnotated;

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

- [ ] **Step 3: Pass `disableZoom` to the normal `MxlScore` render**

Update the existing `<MxlScore>` call in the sheet-view render branch (around line 362):

```tsx
              <MxlScore
                src={activeVersion.dataUrl}
                transpose={semitones}
                hiddenParts={hiddenParts}
                onInstrumentsChange={setScoreInstruments}
                disableZoom={musicxmlAnnotated}
              />
```

- [ ] **Step 4: Add the Annotate `fab-mini` and update the `MusicToolbar` call**

In the `fab-stack` block that's shown when chrome isn't hidden (around lines 392-401),
add a third button:

```tsx
      {!stage.chromeHidden && !stage.toolbarExpanded && (
        <div className="fab-stack">
          <button className="fab" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" }); }} aria-label="Add song to stage">
            <Icon name="plus" size={24} strokeWidth={2} />
          </button>
          <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" }); }} aria-label="Quick edit">
            <Icon name="edit" size={17} strokeWidth={1.9} />
          </button>
          <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" }); }} aria-label="Annotate">
            <Icon name="annotate" size={17} strokeWidth={1.9} />
          </button>
        </div>
      )}
```

Update the `<MusicToolbar>` call (around lines 403-411) — drop `onAnnotate`, add the
three lock flags, and drop the `hasChords || hasScore` gate's dependency on the removed
prop (the gate itself is unchanged, just the props passed down):

```tsx
      {!stage.chromeHidden && (hasChords || hasScore) && (
        <MusicToolbar
          view={stage.view}
          hasChords={hasChords}
          instruments={scoreInstruments}
          hiddenParts={hiddenParts}
          onToggleInstrument={toggleInstrument}
          transposeLocked={transposeLocked}
          chordsLocked={chordsAnnotated}
          instrumentsLocked={musicxmlAnnotated}
        />
      )}
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: clean, *except* for the still-pending `AddEditSong.tsx` error from Task 1
(fixed in Task 9) — confirm that's the only remaining error.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, open the seeded "As The Deer" song on Live Stage:
1. Tap the new Annotate icon in the `fab-stack` — confirm it opens a full-screen view
   showing the song's real sheet music (not hidden/decorative), with a Draw/Notes
   segmented control and a tool palette (pen/square/eraser/scroll/Clear) on the right.
2. Draw a pen stroke and a rectangle over the score; confirm they render and persist
   visually while you keep drawing.
3. Switch to the Eraser tool and tap one of the strokes; confirm it disappears; tap
   Undo; confirm it comes back.
4. Switch to the Notes tab, type something, switch back to Draw — confirm the drawn
   strokes are still there (Notes and Draw don't clobber each other before Done).
5. Tap Done — back on the normal Live Stage sheet view, confirm the Sheet Music
   view's instrument-visibility row (if it has one) and pinch-zoom are now disabled,
   since `musicxmlAnnotated` is now true for this song.
6. Reopen Annotate, tap Clear, confirm the strokes are gone; tap Done; confirm the
   sheet view's zoom/instrument controls are enabled again.

- [ ] **Step 7: Commit**

```bash
git add src/screens/live-stage/LiveStage.tsx
git commit -m "Wire AnnotateScreen into Live Stage, replacing the old decorative Annotate mode"
```

---

## Task 9: Notes tab in Add/Edit Song

**Files:**
- Modify: `src/screens/add-edit-song/AddEditSong.tsx`

**Interfaces:**
- Consumes: `Song.notes` (Task 1).
- Produces: nothing new for later tasks — this is also where the `npm run build` error
  left dangling since Task 1 finally gets fixed (this is the last remaining call site
  that constructs a `Song` object).

- [ ] **Step 1: Add `notes` state**

Add alongside the other `useState` calls (around line 41, after `attachments`):

```tsx
  const [notes, setNotes] = useState(existing?.notes ?? "");
```

- [ ] **Step 2: Add the "Notes" tab to the tab strip**

Update the tab type (line 42) and the tab strip (around lines 145-157):

```tsx
  const [tab, setTab] = useState<"source" | "preview" | "notes" | AttachmentKind>("source");
```

```tsx
      <div style={{ padding: "10px 14px 6px", display: "flex", gap: 6 }}>
        <button className={"chip" + (tab === "source" ? " active" : "")} onClick={() => setTab("source")}>
          Chords/Lyrics
        </button>
        <button className={"chip" + (tab === "preview" ? " active" : "")} onClick={() => setTab("preview")}>
          Preview
        </button>
        <button className={"chip" + (tab === "notes" ? " active" : "")} onClick={() => setTab("notes")}>
          Notes
        </button>
        {CATEGORY_PRIORITY.filter((kind) => attachments[kind]).map((kind) => (
          <button key={kind} className={"chip" + (tab === kind ? " active" : "")} onClick={() => setTab(kind)}>
            {ATTACHMENT_LABEL[kind]}
          </button>
        ))}
      </div>
```

- [ ] **Step 3: Add the Notes tab's content**

Add right after the `{tab === "preview" && (...)}` block (around line 283, before the
`{activeKind && activeBucket && activeVersion && (...)}` block):

```tsx
      {tab === "notes" && (
        <div className="flex-1 hidden-scroll" style={{ padding: "0 14px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reminders, cues, anything worth having on hand for this song — works the same whether it's a chord chart, a PDF, or sheet music."
            style={{
              flex: 1,
              minHeight: 160,
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: "9px 10px",
              fontSize: 13,
              lineHeight: 1.5,
              background: "var(--surface)",
              color: "var(--fg)",
              resize: "vertical",
            }}
          />
        </div>
      )}
```

- [ ] **Step 4: Include `notes` in the dirty check and `save()`**

Update `dirty` (around lines 78-84):

```tsx
  const dirty =
    title !== (existing?.title ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics") ||
    timeSig !== (existing?.timeSig ?? "4/4") ||
    notes !== (existing?.notes ?? "") ||
    JSON.stringify(attachments) !== JSON.stringify(existing?.attachments ?? {});
```

Update `save()`'s constructed `Song` object (around lines 100-113) — add `notes` and
carry forward `annotations` unchanged (Add/Edit Song never touches drawn strokes, per
the spec's "no changes needed for drawn strokes here"):

```tsx
    const song: Song = {
      id: existing?.id ?? `song-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || "Unknown",
      defaultKey: effectiveKey || "C",
      tempo: Number(tempo) || 80,
      timeSig: timeSig.trim() || "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
      attachments,
      notes,
      annotations: existing?.annotations ?? {},
    };
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: clean — this was the last remaining error from Task 1.

- [ ] **Step 6: Manual verification**

Run `npm run dev`:
1. Edit the seeded "As The Deer" song, open the new Notes tab, type some text, Save.
2. Reopen the song's editor — confirm the Notes tab shows the saved text.
3. Open Live Stage for that song, open Annotate, switch to its Notes tab — confirm it
   shows the same text; edit it there, tap Done.
4. Reopen the song in Add/Edit Song — confirm the Notes tab reflects the edit made from
   Live Stage.
5. Reload the browser (`npm run dev`'s page) — confirm the notes text survived
   (SQLite/IndexedDB round-trip).

- [ ] **Step 7: Commit**

```bash
git add src/screens/add-edit-song/AddEditSong.tsx
git commit -m "Add a Notes tab to Add/Edit Song, sharing the song.notes field with Live Stage"
```

---

## Task 10: Update the progress checklist

**Files:**
- Modify: `docs/progress-checklist.md`

- [ ] **Step 1: Move the Annotate item from "high priority" (unchecked) to done, with an accurate description**

Replace the existing unchecked "Annotate / custom notes on a song" bullet (in the "Core
functionality — high priority" section) with a checked entry in the same section (it's
still core functionality, now delivered):

```markdown
- [x] **Annotate / custom notes on a song.** Two real capabilities, not the old
      decorative shell: freeform typed notes (`Song.notes`, editable from both
      Add/Edit Song's Notes tab and Live Stage's Annotate screen) and real canvas-drawn
      strokes (`Song.annotations`, pen/rectangle/eraser via `AnnotateCanvas.tsx`) over
      whichever chart type is on screen — chords, image, PDF, or MusicXML — not just
      the chords view the old shell was stuck on. Controls that would reflow a view's
      content (transpose, capo, chord-chart zoom, lyrics-only, MusicXML instrument
      visibility, MusicXML's own pinch-zoom) disable once that view has strokes, so
      marks never silently drift out of alignment. See
      `docs/superpowers/specs/2026-09-20-song-notes-and-annotations-design.md` for the
      full design, including its "Future work / TODO" section (color picker,
      pixel-precision eraser, per-attachment-version stroke layers, per-view transpose
      lock, and a known dev-only viewport-toggle drift edge case — all deliberately
      deferred, not gaps in this pass).
```

- [ ] **Step 2: Update the snapshot date line at the top of the file**

Change the first line's date to today's date (the date this task is actually
completed) so the "Snapshot date" stays meaningful — do not hardcode a specific date in
this step; use whatever the actual completion date is.

- [ ] **Step 3: Commit**

```bash
git add docs/progress-checklist.md
git commit -m "Mark Annotate/custom-notes as done in the progress checklist"
```

---

## Self-Review Notes

- **Spec coverage:** typed notes (Task 1, 6, 9) — covered; canvas strokes (Task 1, 2, 5,
  6) — covered; all four view types (Task 6's `content` branch) — covered; per-song +
  view-type granularity (Task 1's `AnnotationView`) — covered; locking table (Task 3, 4,
  7, 8) — covered; unified Draw/Notes entry point (Task 6, 8) — covered; persistence
  (Task 1) — covered; progress-checklist update (Task 10) — covered.
- **Placeholder scan:** none — every step has real code or a concrete manual-check
  list.
- **Type consistency:** `Stroke`/`AnnotationView` (Task 1) match their use in Task 2
  (`hitTestStroke(stroke: Stroke, ...)`), Task 5 (`AnnotateCanvas`'s `strokes: Stroke[]`),
  Task 6 (`AnnotateScreen`'s `annotationView`/`strokes` state), and Task 9
  (`annotations: existing?.annotations ?? {}`). `disableZoom` is named identically in
  Task 3 (`MxlScore`/`PdfPages`), Task 6 (`AnnotateScreen`'s always-true usage), and
  Task 8 (`LiveStage.tsx`'s `musicxmlAnnotated`-driven usage) — no drift.
