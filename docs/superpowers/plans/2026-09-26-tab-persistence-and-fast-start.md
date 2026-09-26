# Kept-Alive Tabs and Fast Start Implementation Plan

**Goal:** Tabs keep their screens mounted across switches, a score is laid out once when it
loads, and cold start goes from the native launch screen through a static splash straight
into Live Stage with the stage song's content already loading.

**Architecture:** The navigator gives each frame a stable id and tracks visited tabs.
`ScreenHost` renders every frame of every visited tab in its own absolutely positioned layer,
hiding all but the active tab's top with `visibility: hidden` + `inert`, and hands each
screen its own frame through `FrameContext`/`useFrame()`. `MxlScore` remembers what its last
layout applied and skips effects that would repeat it. `index.html` carries a static splash
that the first React render replaces; `main.tsx` starts the stage song's attachment read and
renderer import as soon as the state is loaded.

**Spec:** `docs/superpowers/specs/2026-09-26-tab-persistence-and-fast-start-design.md`

## Global constraints

- No test framework: `npm run build` clean after every part, plus the spec's manual checks
  in the browser dev frame.
- Commit as Israel Valle, no co-author trailer, no mention of AI authorship (CLAUDE.md).
- New fixed styles go in `theme.css` under purpose-named classes.

## Part 1: kept-alive tabs (one commit)

### Task 1.1: Navigator (`src/navigation/Navigator.tsx`)

- `Frame` gains `id: string`, from a module counter (`newFrame(screen, params)`).
- `push` makes a new frame. `replace` keeps the top frame's id when the screen name matches.
  `reset`/`resetTab` keep the existing root frame when it is already that screen with no
  params.
- `InternalState` gains `visited: TabName[]`; `switchTab`/`resetTab` add to it.
- Drop `booted`/`finishBoot` (Part 3 needs them gone; doing it here keeps the navigator
  edited once).
- Export `stacks` and `visited` on the value for `ScreenHost`.
- Add `FrameContext` + `useFrame()` returning `{ frame, canPop, previous, showing }`.

### Task 1.2: ScreenHost and layers (`src/App.tsx`, `theme.css`)

- `renderScreen(frame)` holds today's switch, reading params from the frame.
- `ScreenHost` renders `.screen-host` with a `FrameLayer` per frame of each visited tab,
  keyed by frame id. `FrameLayer` sets `data-showing` and `el.inert` (layout effect) and
  provides `FrameContext`.
- CSS: `.screen-host`, `.screen-layer`, `.screen-layer[data-showing="false"]`.

### Task 1.3: Screens read their own frame

- `Header`: `useFrame().canPop` / `.previous`.
- `SetlistDetail`, `AddEditSong`: params from `useFrame().frame.params`.
- `LiveStage`: idle timer restarts when `showing` turns true, cleared when false.
- `Tuner`: `useMicPitch(enabled && showing)`.
- `TabBar`, `StorageAlert`: drop `booted` checks.

## Part 2: one score layout on load (one commit)

### Task 2.1: `src/components/MxlScore.tsx`

- `applied` ref `{ transpose, targetKey, hidden, zoom }`, set by the load effect after
  `render()`.
- Transpose effect: when unchanged, skip the layout but still call `onRerendered`.
- Hidden-parts effect: skip when the sorted ids match.
- Zoom effect: when unchanged, clear the preview and drop the pending focus, no layout.
- Each effect that does lay out updates `applied`.

## Part 3: cold start (one commit)

### Task 3.1: Static splash (`index.html`, `src/App.tsx`)

- Splash markup inside `#root`, styled by an inline `<style>`, light/dark by a `data-theme`
  attribute on `<html>` set by an inline script from `localStorage` (`zamar.theme`), falling
  back to `prefers-color-scheme`. All `localStorage` access in try/catch.
- `App` writes the theme to `localStorage` when it changes.
- Delete `src/screens/onboarding/Splash.tsx`; `App` renders `ScreenHost` directly.

### Task 3.2: Preload the stage song (`utils/attachments.ts`, `data/attachmentData.ts`, `main.tsx`, `LiveStage.tsx`)

- Move `openingVersionId(song)` to `utils/attachments.ts` (needs `resolveDefaultView`; take
  the resolved view as an argument if importing the store would create a cycle).
- `preloadStage(state)` in `attachmentData.ts`: prefetch the opening version's data and kick
  off `import("opensheetmusicdisplay")` or `import("pdfjs-dist")` by its kind.
- `main.tsx` calls it after `loadInitial()` resolves, before `render`.

## Part 4: docs (with Part 3's commit)

- `CLAUDE.md`: onboarding row, navigator paragraph, `useFrame` gotcha.
- `docs/review-findings.md`: remove Performance 1, 2, 4; renumber.
