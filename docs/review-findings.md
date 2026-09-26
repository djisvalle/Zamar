# Zamar — Senior Review Findings

Originally reviewed: 2026-09-12 (branch `mockup-to-implementation`)
Last re-checked against `main`: 2026-09-26
Performance and feel sweep: 2026-09-26
Progressive PDF rendering landed: 2026-09-27

Scope: full codebase (architecture, persistence, navigation) + UI/UX design review, benchmarked against modern iOS conventions.

This list only carries what is still open or only partly fixed. Findings that are fully done on `main` have been removed; git history has the original list and the notes on how each was resolved. Items tagged **(Partial)** say what was fixed and what is left.

---

## 🟠 Smoothness and feel

1. **Chrome appears and disappears with no transition.** The tab bar (`TabBar.tsx`) and
   `MusicToolbar` unmount when Live Stage's chrome hides (idle timer or tap), so they pop instead of
   fading or sliding as iOS chrome does. Keeping them mounted and animating `opacity`/`transform`
   with `pointer-events: none` when hidden would make this feel native.

2. **Sheets slide in but vanish on close, and can't be swiped down.** `.sheet` has a `sheet-in`
   animation, but `Sheet` (`components/Overlays.tsx`) unmounts at once on close, with no exit
   animation and no drag-to-dismiss on the grabber. iOS users will expect to pull a sheet down.

3. **Navigation has no push/pop motion, no edge-swipe back, and Android Back isn't handled.** Screens
   swap instantly in `ScreenHost`. There's no swipe-from-left-edge to go back (a core iOS habit).
   On Android, the only platform actually run so far, `@capacitor/app` isn't installed, so the
   hardware/gesture Back leaves the app from any depth instead of popping the stack or closing a
   sheet.

4. **Song-to-song swipes jump with no motion.** `LiveStage`'s swipe acts only on pointer-up
   (`SWIPE_THRESHOLD`), with no page following the finger and no slide into the next song, and
   the next song's PDF/score starts loading only once it's on screen. A page that tracks the finger
   and a preloaded next setlist song would make changing songs between numbers feel instant.

5. **Chart text can be selected on stage.** Nothing sets `user-select: none` or
    `-webkit-touch-callout: none` on `.chord-chart` or the stage image, so a resting finger or long
    press during a set starts text selection (with the loupe) or shows the Save Image callout.
    Related: `-webkit-tap-highlight-color` isn't set anywhere, so Android's WebView flashes its
    default highlight on every tap.

6. **Native iPads get the phone layout for lists, sheets and key buttons.** The iPad rules in
    `theme.css` (`.ios-list` insets, centered 540px `.sheet`, `.sheet--large`, `.key-row-btn`) key
    off `[data-viewport="ipadAir…"]`, which only the browser dev frame sets. On a real iPad only the
    tab bar adapts (by width, in `useTabPlacement`), so sheets stretch edge to edge. A width-based
    class or media query on the native device would carry these over.

7. **Every store change re-renders the whole app.** One context holds all state and few components
    are memoized, so the 6 s idle-hide, each Zoom +/- tap or a favourite toggle re-renders Live
    Stage, and `ChordChart` re-parses the whole ChordPro chart every time (no `useMemo`). Memoizing
    the parse in `ChordChart`, and wrapping `ChordChart`/`MxlScore`/`PdfPages` in `React.memo`,
    removes most of it without changing the store's shape. Since tabs stay mounted, this now covers every
    visited tab's screens too, not just the one on display.

8. **Drag-to-reorder re-renders and re-measures on every move, and can't scroll.**
    `useDragReorder.ts` queries every row and reads its rect, then sets a new `target` object, on
    each `pointermove`, re-rendering all of Setlist Detail even when the drop spot hasn't changed. The
    dragged row stays put (it only dims), with no lifted row following the finger, and there's no
    auto-scroll near the edges, so a slot can't be dragged past what's on screen in a long set.

9. **Two page-sized canvases stay allocated whether or not anyone is drawing.** `AnnotateCanvas`
    always mounts the committed and live canvases at `devicePixelRatio × screenScale`, and caps only
    each edge (16384px), not the area. A long chart in landscape on an iPad reaches well over
    iOS's ~16.7 MP per-canvas limit (the canvas then renders blank) and uses 100+ MB for two
    layers. Mounting the live layer only while drawing, and capping by area, bounds this.

10. **Smaller per-frame costs in gestures.**
    - Dragging a text mark with snap on calls `snapTargets`, which queries and measures every
      `.chart-line`, on every move (`AnnotateCanvas.tsx`). Measuring once at gesture start is enough.
    - `MxlScore` keeps `will-change: transform` on the whole score permanently, which holds a
      score-sized compositing layer in memory. Setting it only during a pinch avoids that.
    - The Tuner needle animates `left` (layout) 20 times a second (`Tuner.tsx`); `transform:
      translateX` stays on the compositor.

## 🟡 Low priority / polish

1. **Heavy use of ad-hoc inline `style={{...}}` objects** instead of shared CSS classes (about 235 left across `src/`). This makes theming and spacing changes harder than they need to be. A spec for the cleanup is written (`docs/superpowers/specs/2026-09-26-inline-styles-to-css-design.md`); the work itself hasn't started.

2. **Library search copy promises lyrics.** The result footer and empty state say "titles, artists
   and lyrics", but the filter in `Library.tsx` only matches title and artist. Either search
   `chordpro` too or change the copy. "Recent" is the last five songs in storage order, not
   recently opened or edited ones.

3. **Nothing keeps the screen awake on stage.** `keepAwake` was removed because it had no mechanism
   behind it (see `progress-checklist.md`), but the screen can still dim or lock mid-set.
   Open decision: a keep-awake plugin while Live Stage is showing, or leave it to the device setting.

4. **pdf.js may not run on older WebViews (needs checking on device).** `pdfjs-dist` 6.3 calls
   `Map.prototype.getOrInsertComputed`, a very recent JavaScript addition. In a Chromium 141
   test browser every PDF fails with "Couldn't read this PDF." (`PdfPages.tsx` swallows the
   `TypeError`), and PDF import conversion would fail the same way. If the Android WebView on
   the test devices shows PDFs, it's new enough; if not, a small polyfill before pdf.js loads, or
   pinning an older `pdfjs-dist`, fixes it.

---

## UI/UX design notes (vs. modern iOS conventions)

Context for this pass: users are coming from OnSong on iOS; Zamar's differentiator is sheet-music flexibility. These are stylistic departures rather than bugs.

No open items: text sizes now follow iOS text styles (see
`docs/superpowers/specs/2026-09-25-priority-2-design.md`).
