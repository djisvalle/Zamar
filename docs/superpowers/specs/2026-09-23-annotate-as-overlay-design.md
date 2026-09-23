# Annotate as a Live Stage overlay, not a separate screen

## Context

`2026-09-20-song-notes-and-annotations-design.md` deliberately made `AnnotateScreen`
"full-screen, replaces the old `AnnotateMode`" — `LiveStage.tsx` early-returns
`<AnnotateScreen .../>` whenever `stage.drawer === "annotate"`, swapping out the entire
screen (header, title, progress bar, `MusicToolbar`) for Annotate's own header/dock, and
building a second, separate instance of the chart content wrapped in `AnnotateCanvas`.

That full-screen swap turned out to have a real cost: Live Stage's *normal* chord/sheet
view never renders `song.annotations` at all — only `AnnotateScreen`'s own copy of the
content does. So the moment you tap Done and the screen swaps back, whatever you just
drew visually disappears, even though it's correctly persisted (confirmed by reopening
Annotate — the marks are still there). This reads as data loss but isn't; it's a missing
render path. A second, smaller tell: `LiveStage.tsx` already passes
`disableZoom={musicxmlAnnotated}` to the *normal* view's `MxlScore` — freezing zoom
whenever a view has annotations only makes sense if annotations were meant to be visible
there too.

This spec revises the "Screen changes" section of the 2026-09-20 spec: Annotate becomes
an overlay on the persistent Live Stage screen — conceptually the same idea as the
transpose/capo toolbar or the Chords/Sheet view toggle, which layer controls over one
continuous screen rather than navigating away from it — instead of a distinct
full-screen route. Nothing about the data model, persistence, canvas drawing mechanics,
or the locking rules changes; only how the feature is composed onto the screen.

## Goals

- Annotations render on top of the chart at all times the song is on stage — reading a
  chart on stage shows prior markup, the same way it shows the current transpose or
  capo setting — not only while the Annotate dock happens to be open.
- Opening Annotate (tapping the icon in Stage Tools) no longer navigates to a different
  screen. The song title, progress bar, and chart stay exactly where they are; only the
  header and bottom-bar controls swap to Annotate's own, the same way they already swap
  for other Live Stage states.
- Closing Annotate (Done) is a pure state change — no visual discontinuity, since the
  chart underneath never moved or remounted.

## Non-goals

- No change to the annotation data model (`Song.annotations`, `AnnotationObject`
  variants), persistence, locking rules, or per-view (`chords`/`image`/`pdf`/`musicxml`)
  scoping — all covered by the 2026-09-20 and 2026-09-22 specs and unaffected here.
- No change to the actual drawing/select/erase mechanics in `AnnotateCanvas.tsx` — pen,
  highlighter, shapes, notation stamps, pins, undo/redo all behave exactly as they do
  today while the dock is open.
- No change to the Cues (song notes) textarea's content or persistence — only to where
  it's composed on screen.

## Architecture

### `AnnotateCanvas` gains an `interactive` prop

Today `AnnotateCanvas` always captures pointer input for whichever `tool` is active. Add
an `interactive: boolean` prop:

- **`interactive={true}`** (today's only mode): unchanged — full pen/select/erase/pin/
  text/shape/notation handling, exactly as implemented now.
- **`interactive={false}`**: the canvas and the transparent overlay layer both force
  `pointerEvents: "none"` regardless of `tool`, `PinEditor`/`ShapeHandles` never mount,
  and `MarkBadge`/`PinBadge` are given `pointerEvents: "none"` unconditionally instead of
  depending on `tool`. Strokes, marks, and pins still *draw* (the canvas paint effect and
  the mark/pin badge rendering are untouched) — only interactivity is suppressed. This is
  what lets annotations sit on top of the normal chart without stealing swipe-to-next-song
  or pinch/pan gestures.

`tool`/style/eraser props become irrelevant (but harmless) when `interactive={false}`;
callers pass `tool="select"` as a placeholder in that case.

### One content instance, not two

`LiveStage.tsx` currently builds the chord/sheet content twice: once in its own return
(lines ~226–264 today), and again inside `AnnotateScreen` via a near-duplicate `content`
expression. This spec collapses that to one:

- `LiveStage` builds `content` (the `stage.view === "chords" ? <ChordChart/> : ...`
  block) exactly once, as it does today.
- `content` is always wrapped in `AnnotateCanvas`, passing `annotations`, `interactive`,
  and the rest of the drawing-related props as described below. There is no longer a
  separate content render living inside `AnnotateScreen`.

This also fixes a latent cost of the old design: opening Annotate mounted a second,
independent `MxlScore`/`PdfPages` instance (discarding whatever scroll/zoom state the
normal view had), then discarded it again on Done. With one shared instance, that
duplication goes away.

### `AnnotateScreen` becomes `AnnotateOverlay`: chrome only, not a screen

`AnnotateScreen.tsx` is restructured into a component that no longer renders `<div
className="screen">` or builds its own content — it renders only:

- The header bar (Undo / Redo / Draw↔Cues segmented / Clear / Done) — unchanged
  visually, now understood as *replacing* Live Stage's title/progress header while
  mounted, rather than being the only header on a different screen.
- The Cues `<textarea>`, shown instead of `children` when `mode === "cues"` — same as
  today's `mode === "cues"` branch.
- The `AnnotateDock` tool row/panel — replaces `MusicToolbar` while mounted, same as
  today.
- The edit sheets (`EditInkSheet`, `EditMarkSheet`) and the Clear confirmation `Sheet` —
  unchanged.

It receives the shared chart content as `children` (already wrapped in the interactive
`AnnotateCanvas` by the time it reaches `AnnotateOverlay` — see "Composition in
`LiveStage`" below) instead of building its own.

All of `AnnotateScreen`'s existing local state — `mode`, `tool`, `history`,
`annotations` (staged copy), `cuesText`, style state, `editingId`/`selectedId`,
`clearOpen`/`allViewsCleared` — moves over unchanged. It still mounts fresh each time
`stage.drawer` becomes `"annotate"` and unmounts on Done/close, which is what gives
Undo/Redo and "cancel by navigating away" their current reset-on-reopen behavior; only
its *container* changes, not its lifecycle or internal logic.

### Composition in `LiveStage`

Remove the `if (stage.drawer === "annotate") return <AnnotateScreen .../>` early return.
`LiveStage`'s single return now looks like:

```tsx
const dockOpen = stage.drawer === "annotate";
const annotationView = stage.view === "chords" ? "chords" : activeKind ?? "chords";
const persistedAnnotations = song.annotations[annotationView] ?? [];

const wrappedContent = (
  <AnnotateCanvas
    annotations={dockOpen ? undefined /* AnnotateOverlay supplies its own */ : persistedAnnotations}
    interactive={false}
    tool="select"
    /* ...eraser/style props omitted, irrelevant when interactive=false... */
  >
    {content}
  </AnnotateCanvas>
);

return (
  <div className="screen" onClick={onScreenClick}>
    {dockOpen ? (
      <AnnotateOverlay song={song} view={stage.view} activeKind={activeKind} activeVersion={activeVersion}
        semitones={semitones} hiddenParts={hiddenParts} fontScale={stage.zoom / 100}
        onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })}>
        {/* AnnotateOverlay renders its OWN interactive AnnotateCanvas wrapping `content`
            for the Draw tab, per "One content instance" above — see note below */}
      </AnnotateOverlay>
    ) : (
      <>
        <div className={"hdr" + (setlist ? " tinted" : "")} />
        {/* ...title, progress bar, chart area (wrappedContent), MusicToolbar... */}
      </>
    )}
  </div>
);
```

The pseudocode above shows the shape, not final code — the exact prop-threading between
`LiveStage` and `AnnotateOverlay` (who owns the `AnnotateCanvas` instance while the dock
is open) is an implementation-plan detail, but the governing rule is: **exactly one
`AnnotateCanvas` wrapping exactly one instance of `content` is mounted at a time** —
`interactive={false}` reading straight from `song.annotations` while the dock is closed,
`interactive={true}` reading from `AnnotateOverlay`'s staged/undo-tracked array while
it's open. The two never coexist and content never remounts between them (same `content`
value threads through both branches without key changes forcing a fresh mount).

### What stays exactly as-is

- Idle chrome auto-hide suppression while `stage.drawer === "annotate"`
  (`LiveStage.tsx`'s `resetIdle`) — unchanged condition, just now also correctly
  described as "while the dock is open" rather than "while on a different screen."
- `disableZoom`/locked-instrument-visibility logic driven by `chordsAnnotated`/
  `musicxmlAnnotated` — unchanged.
- Gesture precedence while actively drawing (a pen/shape/etc. gesture still consumes the
  pointer before swipe-to-next-song can) — unchanged, since that's governed by
  `interactive={true}`'s existing pointer handling in `AnnotateCanvas`, not by this
  spec's changes.
- The per-view annotation storage model, undo/redo, edit sheets, Clear/Clear-all,
  locking rules — all untouched.

## Testing / verification

No automated test framework exists in this repo (per CLAUDE.md); `npm run build` clean
is the correctness bar, plus manual click-through:

1. `npm run build` is clean.
2. Draw a pen stroke over the chords view, tap Done — confirm the stroke is still
   visible on the normal (non-annotate) Live Stage view, without navigating anywhere.
3. With that stroke visible, swipe left/right to change songs (in a setlist) and confirm
   the swipe still works — the read-only overlay must not swallow the gesture.
4. Reopen Annotate on that song — confirm the stroke is there, editable, and Undo/Redo
   work as before.
5. Repeat steps 2–4 against an attached PDF, image, and MusicXML score.
6. Confirm the title/progress-bar header and `MusicToolbar` are fully replaced by
   Annotate's header/dock while open, and fully restored (with annotations still
   visible on the chart) after Done — no flash of an empty/different screen either way.
7. Confirm capo/zoom/lyrics-only/transpose/instrument-visibility locking still engages
   correctly once a view has annotations, both while the dock is open and while it's
   closed and the marks are just being displayed.
8. Force-reload — confirm annotations still render on the normal view after reload
   (this exercises the `interactive={false}` path reading straight from persisted
   `song.annotations`, independent of ever having opened the dock this session).

## Post-implementation note

A final whole-branch review (2026-09-23) found that this spec's "content never
remounts between them" framing doesn't hold as written: React remounts the chart
content on every dock toggle, because `LiveStage.tsx` renders `AnnotateOverlay` and the
normal chrome as different element types at the same JSX child slot, not because of
anything about `content`'s own identity. The *other* half of the governing invariant —
exactly one `AnnotateCanvas` wrapping one `content` instance at a time — does hold, and
is what actually delivers this spec's goal (no divergent duplicate content, no
dock-open/dock-closed drift). The same review also found and fixed a real
coordinate-space bug this remount masked: the two `AnnotateCanvas` mounts measured
different wrapper widths (dock-open had no side padding, dock-closed had 14px), so a
mark drawn in one dock state landed in a different relative position in the other.
Annotations now agree between dock states. See `docs/annotate-mode-roadmap.md` for the
follow-up to actually eliminate the remount.
