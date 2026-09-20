# Song notes and real on-stage annotation

## Context

`docs/progress-checklist.md`'s high-priority "Annotate / custom notes on a song" item
flagged this as missing across the board: Live Stage's `AnnotateMode` (in
`LiveStage.tsx`) is a decorative shell — a chord chart with chords hidden and a floating
pen/square/eraser/color palette with no click handlers, no canvas, nothing persisted.
The Annotate icon only ever renders in `MusicToolbar.tsx` when `view === "chords"`, so
there's no path to annotate a PDF/image or a rendered `.mxl` score at all. `Song` also
has no freeform notes field.

Decisions made during brainstorming (see chat history for the full discussion):

- Build **both** typed freeform notes and real canvas-drawn strokes in this pass — not
  phased, per explicit direction after the initial proposal (which had deferred
  drawing).
- One unified entry point (a single "Annotate" icon, always visible regardless of
  view/attachment state) opens a full-screen mode with **Draw** and **Notes** tabs,
  rather than two separate entry points or a bottom sheet — drawing needs to sit
  directly over the real, visible content at full screen, so typed notes live alongside
  it on the same surface instead of a separate small sheet.
- Strokes are saved **per song + view type** (chords / image / pdf / musicxml), not
  further split by attachment version — marking up the chord chart shouldn't clutter a
  PDF's marks and vice versa, but different versions within one attachment bucket (e.g.
  a Violin vs. Viola PDF) share one stroke layer.
- Whenever a view's stroke layer is non-empty, the controls that would reflow that
  view's content are **locked** (visibly disabled, not hidden) rather than letting
  strokes silently drift out of alignment or auto-clearing them on every layout change.
  A "Clear" action wipes that view's strokes and re-enables the controls.

## Goals

- A song can carry freeform typed notes, independent of chart type.
- A song can carry hand-drawn markup (pen strokes, rectangle outlines) directly over its
  chords chart, its attached image, its attached PDF, or its rendered MusicXML score —
  covering every chart type the checklist called out, not just chords.
- Both persist through `songsRepo`/SQLite like every other song field.
- Drawn marks never silently drift out of alignment with the content they were drawn
  against.

## Out of scope

- A color picker or multiple stroke colors — one fixed accent color, matching the
  existing color-dot swatch already in the decorative shell.
- Pixel-level erasing — the eraser removes whole strokes it touches (an "object"
  eraser), not partial pixel regions.
- Per-attachment-version stroke layers (see Context above — deliberately per view
  *type*, not per version).
- Any change to how `ChordChart`/`MxlScore`/`PdfPages` render their underlying content —
  this spec only adds an overlay and a locking mechanism, not new rendering logic for
  the content itself.

## Data model (`src/state/types.ts`)

```ts
export type AnnotationView = "chords" | "image" | "pdf" | "musicxml";

export interface Stroke {
  id: string;
  tool: "pen" | "square";
  // "pen": every point on the drawn polyline, in order.
  // "square": exactly two points — the drag's start and end corners.
  points: { x: number; y: number }[];
}

export interface Song {
  // ... unchanged fields ...
  notes: string; // "" when the song has no notes
  annotations: Partial<Record<AnnotationView, Stroke[]>>; // {} when nothing drawn yet
}
```

Coordinates are relative to the top-left of the scrollable content area for that view
(not the viewport), in CSS pixels at the content's natural (unzoomed) size — see
"Canvas mechanics" below for why this doesn't need to account for scroll position.

`StageState.annotate: boolean` (`src/state/types.ts`) and the
`STAGE_TOGGLE_ANNOTATE` action (`src/state/store.ts`) are removed; replaced by adding
`"annotate"` to the existing `Drawer` union (`"add-song" | "quick-edit" | "add-to-set" |
"annotate" | null`) and reusing `STAGE_OPEN_DRAWER`, so opening/closing Annotate mode
works exactly like the existing `quick-edit`/`add-to-set` drawers rather than needing
its own action pair.

## Canvas mechanics

Each view's canvas is an absolutely-positioned `<canvas>` placed *inside* the same
scrollable/transformed container the content itself renders into:

- **Chords / image / musicxml default (no pinch container today):** canvas sized to the
  container's `scrollHeight` (via `ResizeObserver`, only actively re-measured while that
  view's stroke layer is empty — see locking below), positioned `top: 0; left: 0`.
  Because it's a normal child of the same `overflow-y: auto` container the chart
  renders into, native scroll carries the canvas and the content together with no extra
  wiring.
- **PDF:** `PdfPages.tsx` pans/zooms via a CSS `transform: translate(...) scale(...)` on
  its content container (confirmed by reading the component — it's a camera-style zoom
  over fixed raster pages, not a re-layout). Placing the canvas as a sibling *inside*
  that same transformed container means it pans/zooms together for free.
- **MusicXML:** `MxlScore.tsx`'s pinch/wheel zoom is **not** a CSS transform — it sets
  `osmd.Zoom` and calls `updateGraphic()`/`render()`, a real re-engrave. This is a
  reflow, same category as transpose, and is covered by the locking rule below rather
  than by riding a shared transform.

Drawing itself is plain 2D canvas immediate-mode redraw (clear + redraw every stroke in
the array) on every mutation — stroke counts on a phone-sized chart are small enough
that this needs no optimization. Line width is a single fixed value (no adjustable
thickness), same "one fixed accent color" simplicity as the color decision above.

- **Pen:** pointerdown starts a new point array; pointermove appends points; pointerup
  finalizes and pushes the stroke.
- **Square:** pointerdown records the start corner; pointermove updates a live preview
  rect; pointerup finalizes a 2-point stroke. Renders as an unfilled outlined rectangle
  (a callout box around something on the chart), never filled.
- **Eraser:** pointerdown/pointermove hit-tests existing strokes within a small pixel
  radius of the pointer (point-to-segment distance for "pen", point-in-rect for
  "square") and removes any match immediately.
- **Undo:** an in-memory (unpersisted) history stack pushed before every mutation (add
  or erase); pops the most recent one. Cleared when Annotate mode closes.
- **Done:** commits the current `Stroke[]` back to `song.annotations[view]` via
  `UPDATE_SONG`.

## Locking (which controls disable once a view has strokes)

| View | Locks when its stroke layer is non-empty |
|---|---|
| `chords` | transpose (`stage.dispKey`), capo, font zoom (`stage.zoom`), lyrics-only toggle |
| `musicxml` | transpose (`stage.dispKey`), instrument show/hide (`hiddenParts`), OSMD's own pinch/wheel engraving zoom |
| `image`, `pdf` | nothing — neither view has any control today that reflows its content (PDF's own pinch/zoom is a non-reflowing camera transform, see above) |

Transpose is shared state (`stage.dispKey` drives both the chord chart and MusicXML's
notated pitches) — if *either* the `chords` or `musicxml` layer is non-empty, transpose
locks for the song as a whole. Locking one view's transpose but not the other isn't
coherent since it's one control feeding both renders.

Locked controls stay visible but disabled — same `opacity: 0.35`-and-unclickable
convention `MusicToolbar.tsx` already uses for `hasChords === false` — with a short
inline hint ("Clear notes to change key"). A **Clear** action inside Annotate mode's
Draw tab wipes that view's `Stroke[]` and immediately re-enables the controls it had
locked.

## Screen changes

### Live Stage (`src/screens/live-stage/LiveStage.tsx`, `MusicToolbar.tsx`)

- Remove `stage.annotate`, `STAGE_TOGGLE_ANNOTATE`, and the existing `AnnotateMode`
  function entirely.
- Remove the Annotate `ToolbarIcon` from `MusicToolbar.tsx`'s second row (the chords/
  instrument-specific row) — this was the mechanism that made Annotate chords-only.
- Add a new `fab-mini` "Annotate" button to the `fab-stack`, alongside the existing
  add-song FAB and quick-edit `fab-mini`, shown whenever a song is loaded — no
  `hasChords`/`hasScore` gating, so it's available on every view/attachment state.
  Opens via `dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" })`.
- New `AnnotateScreen.tsx` (full-screen, replaces the old `AnnotateMode`): renders the
  currently-active view's real content (whatever `stage.view`/`activeKind` currently
  shows — chords chart, image, PDF, or MusicXML, chords **visible**, not hidden) with
  the canvas overlay on top, a header (Undo / "Draw"↔"Notes" tab switch / Done), the
  pen/square/eraser tool row (now wired to real handlers instead of being decorative),
  and — on the Notes tab — a plain `<textarea>` bound to `song.notes`.
- Locking (see table above) is read directly off `song.annotations` wherever the
  relevant control renders (`MusicToolbar.tsx` for capo/zoom/lyrics-only/instruments,
  the key-chip control for transpose).

### Add/Edit Song (`src/screens/add-edit-song/AddEditSong.tsx`)

- New "Notes" tab in the existing tab chip row (alongside Chords/Lyrics, Preview, and
  the attachment tabs), always present. Holds one `<textarea>` bound to local `notes`
  state (seeded from `existing?.notes ?? ""`), written into the `Song` object in
  `save()`. This is the same `notes` field Live Stage's Annotate/Notes tab edits — notes
  written ahead of a service or jotted live both show up in both places.
- No changes needed for drawn strokes here — canvas annotation is a Live Stage-only
  concept (drawing over a chart mid-service), not something Add/Edit Song previews.

## Persistence (`src/data/db.ts`, `src/data/songsRepo.ts`)

Two new columns on `songs`, following the exact pattern `attachments_json` already
established:

```sql
notes TEXT NOT NULL DEFAULT '',
annotations_json TEXT NOT NULL DEFAULT '{}'
```

Unlike the v1→v2 migration (which dropped and recreated `songs` because that shape
change genuinely had no old data worth preserving), this one uses `ALTER TABLE` — a
`DB_VERSION` bump to `3` with a `toVersion: 3` upgrade statement:

```sql
ALTER TABLE songs ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE songs ADD COLUMN annotations_json TEXT NOT NULL DEFAULT '{}';
```

`CREATE_SONGS` also gains both columns (for a from-scratch install running the full
upgrade chain). `SongRow`/`rowToSong`/`buildInsertStatements` in `songsRepo.ts` gain the
two fields, same as every other column.

## Migration / seed data (`src/state/mockData.ts`)

Every seeded song gets `notes: ""` and `annotations: {}`.

## Future work / TODO (deliberately deferred, not part of this pass)

- **Color picker / multiple stroke colors.** Shipped with one fixed accent color;
  revisit if a real user asks to distinguish mark types (e.g. red for "watch out here"
  vs. accent for general markup).
- **Pixel-precision eraser.** Object (whole-stroke) erasing was chosen for touchscreen
  reliability; a bitmap-layer eraser would need a different persisted representation
  (raster diff instead of a vector stroke list) — worth reconsidering only if whole-
  stroke erasing proves too coarse in practice.
- **Per-attachment-version stroke layers.** Currently one stroke layer per view *type*,
  shared across all versions in that attachment bucket (e.g. Violin and Viola PDFs share
  marks). Splitting by version id is possible later without a data-model rewrite (nest
  `Stroke[]` under version id instead of view type) if this becomes a real complaint.
- **Per-view transpose lock.** Transpose currently locks for the whole song if *either*
  the `chords` or `musicxml` layer has strokes, since both are driven by the single
  shared `stage.dispKey`. Decoupling this would require giving MusicXML its own
  independent transpose state, a bigger change than this pass warrants.
- **Viewport/frame-size drift.** Toggling the dev-only Phone/Tablet frame while a view
  has strokes can shift chord-chart line-wrap width (and thus visually drift existing
  strokes) — this is a dev-only preview affordance (per CLAUDE.md's "Device-frame
  shell" section), not a real-device concern, so it's accepted rather than solved here.
- Cross-reference: `docs/progress-checklist.md`'s existing OMR nice-to-have item is
  unrelated to this spec (that's about *recognizing* notation from a raster scan; this
  spec is about *marking up* whatever's already rendered) but both live in the same
  "future annotation-adjacent work" bucket.

## Testing / verification

No automated test framework exists in this repo (per CLAUDE.md's documented gotcha);
`npm run build` clean is the correctness bar, plus manual click-through:

1. `npm run build` is clean (verifies the `stage.annotate`/`STAGE_TOGGLE_ANNOTATE`/
   `AnnotateMode` removal didn't leave stale references).
2. Type notes in Add/Edit Song, save, reopen the song, confirm notes persisted; open the
   same song's Notes tab from Live Stage's Annotate screen and confirm it shows the same
   text; edit from Live Stage and confirm Add/Edit Song reflects it too.
3. Draw pen strokes and a rectangle over the chords chart; confirm capo/zoom/lyrics-
   only/transpose all become visibly disabled; use Clear; confirm they re-enable.
4. Repeat step 3 against an attached PDF and an attached image — confirm strokes render
   correctly and (for PDF) still track correctly while pinch-zoomed/panned.
5. Repeat against an attached MusicXML score — confirm transpose/instrument-visibility/
   pinch-zoom all lock while strokes exist, and Clear releases them.
6. Use the eraser to remove a stroke; use Undo to bring back the most recent add/erase.
7. Force-close/reload (`npm run dev` browser reload) — confirm notes and every view's
   strokes survive.
