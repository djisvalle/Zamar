# Kept-alive tabs, one score layout on load, and a faster cold start

## Context

Three findings from the 2026-09-26 performance sweep in `docs/review-findings.md`, packaged
together because they all decide how long the person waits to see a chart:

- **Performance 1.** `ScreenHost` (`src/App.tsx`) renders only the top frame of the active
  tab, so leaving Live Stage unmounts it. Coming back re-fetches, unzips, parses and engraves
  the score in OSMD, or redraws every PDF page, and loses scroll position and zoom. The same
  unmounting loses Library's scroll position and search after Add/Edit Song.
- **Performance 2.** A MusicXML score is laid out four times when it loads. `MxlScore.tsx`'s
  load effect applies transpose, zoom and part visibility and renders; `status` turning
  `"ready"` then fires the transpose, hidden-parts and zoom effects, each with its own
  `updateGraphic()` + `render()`.
- **Performance 4.** `Splash.tsx` holds for 650 ms after the database has loaded, and the
  OSMD chunk (1.3 MB) is only requested once Live Stage mounts after it. Before the splash,
  `#root` is empty while JS and the database load, so native shows a blank WebView between
  the launch screen and the splash.

Decisions made in brainstorming:

- Each tab's **whole stack** stays mounted, not just its top frame. A tab mounts the first
  time it is visited, then stays mounted.
- Inactive frames are hidden with **`visibility: hidden` + `inert`** on absolutely positioned
  layers, not `display: none`.
- The load-time `onRerendered` call **stays**; only the three redundant layouts go.
- The timed React splash is replaced by a **static splash in `index.html`** that shows while
  JS and the database load and is replaced by the first React render.

## Goals

- Switching tabs and coming back leaves every screen exactly as it was: Live Stage's score or
  PDF, its scroll position and zoom; Library's scroll position and search; any drill-down.
- A score is laid out once when it loads.
- Nothing blank between the native launch screen and the app, and no fixed wait after the
  database has loaded.
- The stage song's attachment and renderer start loading as soon as the state is known.

## Out of scope

- Push/pop motion and edge-swipe back (finding 7). Keeping frames mounted makes both easier
  later, but neither is part of this.
- Stopping hidden screens from re-rendering on store changes (finding 11). Every mounted
  screen still re-renders on every store change; that's the same cost as today for the one
  visible screen, multiplied by the screens kept alive. Finding 11's memoization covers it.
- Releasing memory from tabs that haven't been used in a while.

## Part 1: keep tab screens mounted

### Frame identity

`Frame` (`src/navigation/Navigator.tsx`) gains an `id: string` (a counter is enough). It is
the React `key` of the frame's layer, so it decides when a screen remounts:

- `push` creates a new id.
- `pop` drops the top frame (it unmounts).
- `replace` keeps the replaced frame's id **when the screen name is the same**, and makes a
  new one otherwise. Today React reuses the component when the screen type matches, and
  `SetlistDetail` relies on that: it opens its details sheet from an `openDetails` param,
  then `replace`s itself to clear the param. A new id there would remount it and close the
  sheet it just opened. Add/Edit Song → Import → Add/Edit Song changes screen each time, so
  those still remount, as today.
- `reset` and `resetTab` keep the stack's existing root frame (same object, same id) when it
  is already the requested screen with no params, and make a new one otherwise. "Load a song
  and jump to Live Stage" (Library, Setlists, Setlist Detail) calls `resetTab("live-stage")`;
  it must not remount Live Stage, only drop whatever was pushed on top of it.

### Which tabs are mounted

`NavigatorProvider` keeps `visited: Set<TabName>`, starting with the initial tab. `switchTab`
and `resetTab` add to it. Only visited tabs are rendered. This matches `UITabBarController`,
which loads a tab's view the first time it's selected, and keeps first-visit behaviour where
it is today: the Tuner's mic pre-prompt still appears the first time the Tuner is opened, not
at boot.

### ScreenHost

`ScreenHost` renders, for each visited tab, one layer per frame in that tab's stack:

```tsx
<div className="screen-host">
  {visitedTabs.map((tab) =>
    stacks[tab].map((frame, i) => (
      <FrameLayer key={frame.id} frame={frame} tab={tab} index={i}
                  showing={tab === activeTab && i === stacks[tab].length - 1} />
    ))
  )}
</div>
```

`FrameLayer` wraps the screen that `ScreenHost`'s `switch` renders today (the switch moves
into a `renderScreen(frame)` helper) in a `FrameContext` provider, and a
`<div className="screen-layer">`.

### Hiding

In `theme.css`:

```css
.screen-host   { flex: 1; position: relative; min-height: 0; display: flex; }
.screen-layer  { position: absolute; inset: 0; display: flex; flex-direction: column; }
.screen-layer[data-showing="false"] { visibility: hidden; }
```

`.screen-host` takes the place `.screen` has in `.device`'s column today (below the dev
frame's status bar). Each `.screen` keeps `flex: 1` inside its layer, and stays the
containing block for its sheets and dialogs (`.backdrop` is positioned against `.screen`).

A hidden layer also gets `inert`, so it can't take focus, keyboard input or screen-reader
focus, and a stray tap can't reach it. React 18 doesn't know the attribute, so `FrameLayer`
sets `el.inert` in a layout effect.

Why not `display: none`: it shrinks the hidden box to zero width, and three observers react to
that. `MxlScore`'s resize observer would lay the score out again at width 0 and once more on
return, which is exactly the cost this removes. `AnnotateCanvas` would resize, which clears
its canvases, and `usePortraitWidth` would measure a zero-width pane. With `visibility` the
hidden layer keeps its layout, so none of these fire. A hidden Live Stage also keeps up with a
rotation or a dev-frame viewport change while it's away.

### Per-frame context

Screens read the navigator as if they were the only screen mounted: `nav.top.params`,
`nav.canPop`, `nav.stack`. With several screens mounted, those describe the **active** tab,
not the screen reading them. A new `useFrame()` hook (from `FrameContext`) returns:

- `frame`: the screen's own frame (screen, params, id),
- `canPop`: whether the screen has a frame under it in its own stack,
- `previous`: the frame under it, if any,
- `showing`: whether it is the visible frame.

Changes:

- `Header` uses `useFrame().canPop` and `.previous` for its back button and label.
- `SetlistDetail` and `AddEditSong` read their params from `useFrame().frame.params`, and
  `ScreenHost`'s props come from each layer's frame rather than `nav.top`.
- Navigation *actions* (`push`, `pop`, `replace`, `switchTab`, …) are unchanged. They act on
  the active tab, and only the showing screen can be interacted with.

`nav.top`, `nav.stack` and `nav.canPop` stay for `TabBar` and `App`, which do mean the
active tab.

### Screens that must pause while hidden

- **Live Stage's idle timer.** `resetIdle` also runs when `showing` turns true (so chrome
  shows on return, as the remount does today) and the timer is cleared when it turns false,
  so chrome can't hide itself on a tab nobody is looking at.
- **Tuner's microphone.** `useMicPitch(enabled && showing)`, so the mic is released when the
  Tuner tab is left, as unmounting does today. The OS mic indicator must never outlive the
  Tuner.

Nothing else in `src/screens` holds a timer, listener or device resource that outlives a
gesture (checked: `Header`'s scroll listener is on its own screen, `AnnotateOverlay`'s resize
listener only exists while Annotate is open, and the tab bar is hidden during Annotate and on
modal screens, so neither can be left behind a tab switch).

### Behaviour that changes on purpose

- A sheet left open on a tab is still open when you come back, as on iOS.
- Library keeps its search text, filter chips and scroll position across tab switches and
  after Add/Edit Song.
- Live Stage comes back on the same page of the score or PDF, at the same zoom.

## Part 2: lay a score out once on load

`MxlScore` keeps a ref of what the last layout applied:

```ts
const applied = useRef<{ transpose: number; targetKey: string | null; hidden: string; zoom: number } | null>(null);
```

(`hidden` is the hidden part ids, sorted and joined, so a new `Set` with the same contents
compares equal.)

- The load effect sets `applied` after its `render()`.
- The transpose, hidden-parts and zoom effects each compare their value with `applied` and
  return early when it matches; otherwise they update `applied` and lay out as today.
- The zoom effect still clears the pinch preview and restores the focus point when it
  returns early (a pinch that ends at the zoom it started from).

The transpose effect still calls `onRerendered` once when the score first becomes ready,
even though it skips the layout. The finding called that call wasted, but it isn't: a song can
open in a key other than the one its marks were placed in (a setlist slot's key override, or
switching to another version of the score while a key chip is picked), and that call is what
moves anchored marks onto the new layout. Reprojection is cheap next to a layout.

## Part 3: cold start

### Static splash

`index.html`'s `#root` holds the splash as plain markup: the "Z" mark, the ZAMAR wordmark and
the tagline, the same layout `Splash.tsx` draws today. It is styled by a small `<style>`
block in `index.html` itself, because `theme.css` is only applied once the JS bundle runs.
`createRoot(...).render` replaces it with the app on the first render, so there is no timer
and no handover code.

- **Theme.** The splash can't read settings from the database before it has loaded. `App`
  writes the resolved theme (`light`/`dark`) to `localStorage` whenever it changes, and a
  one-line inline script in `index.html` puts it on the splash before first paint, falling
  back to `prefers-color-scheme`. `localStorage` is only a convenience here: if it is empty
  or throws, the splash just follows the system setting.
- **Fonts.** The wordmark's Barlow Condensed may not have loaded yet, so the splash uses
  the same font stack with its system fallbacks. A slight font swap on the wordmark in the
  first frames is acceptable; the splash is on screen for a fraction of a second.
- **Browser dev.** The static splash fills the browser window rather than sitting in the
  device frame. That's dev-only and brief.

`Splash.tsx` is removed, along with the navigator's `booted`/`finishBoot`: the app is booted
the moment it renders. `TabBar` and `StorageAlert` drop their `booted` checks.

### Starting the stage song's content early

`LiveStage.tsx`'s private `openingVersionId(song)` moves to `utils/attachments.ts`, next to
`selectedVersion`, and a new `preloadStage(state)` (in `src/data/attachmentData.ts`, beside
`prefetchAttachmentData`) is called in `main.tsx` right after `loadInitial()` resolves, before
the first render:

- `prefetchAttachmentData([openingVersionId(stageSong)])`,
- and, by that version's kind, `import("opensheetmusicdisplay")` for `musicxml` or
  `import("pdfjs-dist")` for `pdf`, without awaiting either.

The dynamic imports share the module cache, so `MxlScore`'s and `PdfPages`' own `import()`
calls pick up the request already in flight. A song opening to chords or a photo preloads
nothing.

## Docs to update when this lands

- `CLAUDE.md`: the `onboarding/` row ("Splash only; auto-advances (650ms)"), the navigator
  paragraph (kept-alive tabs, frame ids, `useFrame`), and a gotcha: screens read their own
  frame through `useFrame()`, not `nav.top`, and anything that runs on a timer or holds a
  device resource pauses when `showing` is false.
- `docs/review-findings.md`: remove Performance 1, 2 and 4 and renumber.

## Verification

`npm run build` clean, then in `npm run dev` and on Android:

- Open As The Deer (score), scroll halfway and pinch-zoom; switch to Library and back: same
  page, same zoom, no "Loading score…".
- Same with a PDF song.
- Library: search, scroll, open a song in Add/Edit, cancel: search and scroll are still there.
  Switch tabs and back: same.
- Setlists → "New setlist" still opens the new set's details sheet (the `openDetails` param).
- Load a song from Library and from a setlist: Live Stage shows it, not the previous song,
  and the Live Stage tab isn't left on a pushed screen.
- Tuner: grant the mic, switch tabs: the OS mic indicator goes off; come back: it listens
  again.
- Live Stage chrome: leave while it's showing, wait more than 6 s, come back: chrome is
  showing, then hides after 6 s.
- A hidden tab can't be reached with the keyboard (browser dev, Tab key).
- A score with marks, opened in a different key from a setlist slot: marks sit on the right
  measures. Loading a score logs one `render()` (temporary counter while testing).
- Cold start on Android: launch screen, then the static splash, then Live Stage, with no
  blank frame; the score appears sooner than before.
