# Pins and stave spacing for Annotate

## Context

`docs/superpowers/specs/2026-09-20-song-notes-and-annotations-design.md` built real
canvas annotation (freehand pen strokes, rectangle outlines, a whole-song typed notes
field) into `AnnotateScreen.tsx`, backed by `Stroke[]` per `AnnotationView`. It also
established the "freeze on annotate" rule: once a view's stroke layer is non-empty, any
control that would reflow that view's content (transpose, chord-chart zoom, MusicXML's
engraving zoom/instrument-visibility) disables until Clear is used.

This pass extends that same system with one new kind of point-anchored markup (sticky
notes, called **pins** in code) and a stave-spacing control for MusicXML rendering,
following brainstorming decisions made in chat:

- A pin is point-anchored (a single position), unlike freehand ink (an arbitrary
  polyline). Both kinds fold into the same freeze rule ink already used for zoom — one
  consistent lock/unlock mechanism, not a mixed model.
- **Transpose is exempted from the freeze rule, via real reprojection, not by loosening
  the lock.** Initial direction was to keep locking transpose on a musicxml view with
  ink (reprojecting arbitrary ink seemed impractical) — reversed after two things: a
  reference to **Newzik**, a shipped sheet-music app that keeps annotations aligned
  across a transposed `.mxl` render, and confirming OpenSheetMusicDisplay 2.1.2 (already
  the app's pinned version) exposes exactly what reprojection needs:
  `GraphicalMusicSheet.MeasureList: GraphicalMeasure[][]` (stable `[measureIndex]
  [staffIndex]` indexing across a re-render — transpose changes pitches/accidentals,
  never adds/removes measures or staves), `GetNearestNote(point, maxDist)` for
  placement-time hit-testing, and each graphical object's `PositionAndShape`
  (`BoundingBox` with `AbsolutePosition`/`Size` in OSMD units, convertible to pixels via
  the exported `unitInPixels` constant × `osmd.Zoom`). See "Reprojection" below. Engraving
  **zoom stays frozen** on an annotated musicxml view, same as before — confirmed against
  Newzik's own behavior (it locks zoom too) rather than assumed.
- Stave spacing is a single global Settings control, not per-song — this sidesteps the
  freeze question entirely, since a global setting never changes after a song is
  annotated; it's just part of the layout a view's freeze locks in.
- The existing whole-song "Notes" text field (`song.notes`, the Draw/Notes tab in
  `AnnotateScreen.tsx`, the Notes tab in `AddEditSong.tsx`) is relabeled **Cues** in the
  UI only, to free up "Notes"/"sticky notes" for the new spatial feature without the two
  colliding in the product's vocabulary. The underlying field name, SQLite column, and
  internal variable names stay `notes` — this is a copy change, not a data-model rename,
  since renaming a persisted column buys nothing user-visible and adds migration risk.
- **Stickers (arrow/star/dot stamps) are cut from this pass entirely**, per explicit
  direction after the mockup — pins alone are being built now; stickers move to Future
  work below rather than shipping half of a two-part feature. The mockup still exists
  only as a pin-placement/persistence/sheet-music demo, not a sticker demo.
- **Capo is unrelated to this feature but has already been removed from the app**
  (done directly during this brainstorming pass, ahead of the implementation plan below,
  since it was a small, self-contained, low-risk cut) — per explicit direction to drop
  it rather than keep reasoning about it in the freeze rule. `stage.capo`/
  `STAGE_SET_CAPO` and `SetlistItem.capo` never actually affected any rendered chart
  (`chordpro.ts` never read `capo`), so it was pure dead UI state — removed the same way
  `keepAwake`/`autoscroll` were previously cut, not half-wired. See
  `docs/progress-checklist.md`'s "Dead Capo control" (done) and "Real Capo
  functionality" (low-priority follow-up) entries. Nothing about Capo remains for the
  implementation plan to do; it's mentioned here only so the freeze-rule table below
  doesn't look like it's silently missing a row.

## Annotations are song-level, not setlist-level

Called out explicitly because it's easy to assume otherwise given the setlist run
sheet's per-slot key/note overrides (`SetlistItem.keyOverride`/`note` in
`state/types.ts`) — those live on the *setlist item*, but annotations never have. `Song.
annotations` (and `Song.notes`/Cues) lives on the `Song` record itself, exactly like
`chordpro` or `attachments`; `Setlist`/`SetlistSection`/`SetlistItem` only ever reference
a song by `songId` and never copy or override any of its fields. That means a pin placed
on a song while running one setlist is visible identically from every other setlist that
includes that song — the existing run sheet, Add-to-set, and a setlist created *after*
the pin was placed — because Live Stage always loads the current slot's song by id and
reads whatever's on that song record, regardless of which setlist got it there.

This isn't new plumbing this pass needs to build — it already falls out of `annotations`
living on `Song` rather than `SetlistItem`, the same way it already does for strokes
today. The requirement here is to **not** accidentally break that invariant while adding
pins (e.g. by scoping a pin to the setlist context it was drawn from) — pins use the
exact same `Song.annotations` field strokes already use, so there's no separate code
path that could regress this.

## Goals

- A song's chart (chords, image, PDF, or MusicXML view) can carry pins — a short typed
  note pinned to a point — alongside the existing pen/rectangle ink.
- Pins persist together with ink, per view, through the same `annotations_json` column
  that already exists — no schema change for this part.
- Placing/editing/moving/deleting a pin uses the same tool-row interaction model as ink
  (pick a tool, tap the chart, Eraser removes), so Annotate mode gains a new capability
  without gaining a new interaction paradigm.
- Pins remain visible identically across every setlist a song appears in, including ones
  created after the pin was placed — see "Annotations are song-level" above.
- **Transposing a song whose Sheet Music view already has ink (pen, rectangle, or pins)
  does not lock the Key control, and the existing marks stay correctly positioned
  against the re-engraved notation** — anchored to their nearest measure and reprojected
  after every re-render, not just left in place at stale pixel coordinates. Engraving
  zoom and instrument show/hide remain locked, unchanged from the original spec.
- A global Settings control adjusts the vertical spacing between staves/systems in
  rendered MusicXML scores, for people who want room to write in-app or on a printout.
- The existing whole-song text field reads as "Cues" everywhere it appears in the UI.

## Out of scope

- **Stickers.** See Future work below — deferred, not designed further here beyond the
  rough shape already captured there.
- **Reprojecting across an engraving-zoom or stave-spacing change.** Transpose gets real
  reprojection (see below); zoom stays frozen on an annotated musicxml view, and global
  stave spacing never changes after a song is annotated, so neither needs it.
- Reprojecting ink/pins on views other than `musicxml` (chords/image/pdf) — those views
  either don't reflow on any control they have (image/pdf) or never needed reprojection
  in the first place (chords' transpose is a label swap, not a reflow — see Freeze rule).
- Per-song stave spacing. Global only.
- A color picker for pins, or per-pin styling — one fixed visual treatment, same "ship
  the small set, revisit if asked" call the original spec made for stroke color.
- Dragging ink strokes after they're drawn (only pins are repositionable — ink stays
  "committed the moment the gesture ends," same as today).
- Renaming `song.notes`, its SQLite column, or internal variable names — UI label only.
- Capo. Removed from the app outright, not part of this spec's scope — see Context above.

## Data model (`src/state/types.ts`)

```ts
export type AnnotationView = "chords" | "image" | "pdf" | "musicxml"; // unchanged

/** Anchors a point to a spot on the rendered score that survives a transpose-triggered
 * re-render, in place of a raw pixel coordinate. `measureIndex`/`staffIndex` index
 * directly into `osmd.GraphicSheet.MeasureList[measureIndex][staffIndex]`, which keeps
 * the same shape across a re-render (transpose never adds/removes measures or staves).
 * `fx`/`fy` are the point's position as a 0..1 fraction of that measure's own
 * bounding-box width/height at anchor time, not an absolute offset — a fraction survives
 * the measure changing width (more accidentals needing more room) the way an absolute
 * unit offset wouldn't. Only ever set for points/pins placed on the `musicxml` view. */
export interface MusicalAnchor {
  measureIndex: number;
  staffIndex: number;
  fx: number;
  fy: number;
}

export interface Stroke {
  id: string;
  tool: "pen" | "square";
  /** Current on-screen pixel position — for a musicxml-view stroke with `anchors` set,
   * this is kept in sync by reprojection after every re-render; it's the only
   * representation for chords/image/pdf, which have no measures to anchor to. */
  points: { x: number; y: number }[];
  /** One anchor per point, parallel to `points`, present only for strokes drawn on the
   * `musicxml` view. Absent — including for strokes persisted before this feature —
   * means "not reprojectable"; `points` is then used as-is with no repositioning. */
  anchors?: MusicalAnchor[];
}

export interface Pin {
  id: string;
  kind: "pin";
  position: { x: number; y: number }; // same role as Stroke.points — kept in sync by reprojection
  text: string;
  /** Present only when placed on the `musicxml` view; see MusicalAnchor. */
  anchor?: MusicalAnchor;
}

export type AnnotationObject = Stroke | Pin;

export interface Song {
  // ...unchanged fields...
  notes: string; // unchanged name/shape — UI label becomes "Cues"
  annotations: Partial<Record<AnnotationView, AnnotationObject[]>>;
}
```

`Stroke` keeps its own `tool` discriminant (`"pen" | "square"`) rather than gaining a
`kind` field, so existing persisted `Stroke[]` JSON parses as valid `AnnotationObject[]`
with no migration: a plain `if ("tool" in obj)` / `if ("kind" in obj)` check (or a
`"kind" in obj ? obj.kind : "stroke"` normalization at read time) distinguishes old ink
from new objects wherever the array is iterated. `anchors`/`anchor` being optional means
pre-existing musicxml-view strokes (drawn before this feature, with no anchors) keep
rendering at their last pixel position with no reprojection attempted — a silent,
harmless fallback, not an error state.

```ts
export type StaveSpacing = "compact" | "default" | "roomy";

export interface Settings {
  // ...unchanged fields...
  staveSpacing: StaveSpacing;
}
```

## Pin mechanics

Rendered as a new sibling layer of absolutely-positioned DOM elements — not canvas
pixels — inside the same frozen wrapper `AnnotateCanvas` already provides, so pins scroll
with the content for free exactly like the ink canvas does, but stay individually
tappable/draggable after placement (canvas ink is deliberately just pixels once
committed; a pin needs to stay a live element since its text stays editable).

- **Pin tool:** tap the chart → a small text box opens inline, anchored at the tap
  point → type → tap outside the box to commit (empty text discards instead of creating
  an empty pin). Tapping an existing pin re-opens it for editing text or dragging to a
  new position within the same view. On the `musicxml` view, committing a placement or a
  drag also (re)computes that pin's `MusicalAnchor` — see Reprojection below.
- **Eraser tool:** extended from hit-testing stroke segments (`hitTestStroke` in
  `utils/annotations.ts`) to also hit-test pins by simple distance-to-position (within
  the same `ERASE_RADIUS` used for ink), so Eraser stays the one tool that removes
  anything regardless of kind.
- **Undo:** the existing in-memory history stack (`AnnotateScreen.tsx`'s `history`/
  `commit`) already operates on "the full next array" regardless of element type, so
  placing, editing, moving, or erasing a pin pushes onto the same stack ink mutations
  do — no separate undo path needed. Anchors travel with their pin/stroke in these
  snapshots, since they're just additional fields on the same objects.

## Reprojection (Sheet Music transpose)

Applies only to the `musicxml` view, only to points/pins that carry a `MusicalAnchor`.

**Computing an anchor (at draw-commit time):** convert the committed point from DOM
pixels into OSMD's internal unit space — `(pixel − containerOrigin) / (unitInPixels ×
osmd.Zoom)` — then call `osmd.GraphicSheet.GetNearestNote(pointInUnits, maxClickDist)` to
find the nearest note. Resolve that note's measure/staff via its `sourceNote`'s owning
measure (or, equivalently, scan `MeasureList` for the measure whose `PositionAndShape`
bounding box contains the point — either path lands on the same `(measureIndex,
staffIndex)` pair) and read that measure's current `AbsolutePosition`/`Size` to compute
`fx`/`fy` as the point's position relative to the measure's own box, not the page.

**Reprojecting (after any re-render):** whenever `osmd.Sheet.Transpose` changes and
`updateGraphic()`/`render()` run, walk every `musicxml`-view annotation that has anchors.
For each point, look up `MeasureList[anchor.measureIndex][anchor.staffIndex]`'s *current*
`AbsolutePosition`/`Size`, recompute `measurePos + {fx, fy} × measureSize` in OSMD units,
convert back to pixels the same way anchoring did, and update that point's `x`/`y` (redraw
the ink canvas; move the pin's DOM element). This runs once per transpose, not
continuously — there's no live drag/gesture here, just "the score just re-rendered, sync
positions to it."

**Ink strokes reproject the same way, per point.** A stroke's `anchors` array is computed
once, point-by-point, the moment the stroke is finalized (same place `points` itself is
already finalized) — more points means more lookups, not a different mechanism. A point
that lands outside any measure's bounding box (the margin above/below a system, between
staves) falls back to nearest-measure-by-distance rather than failing to anchor.

**Why zoom still locks and transpose doesn't:** both are real re-engraves
(`updateGraphic()`/`render()`), so both are equally capable of shifting note positions in
principle — the difference is what reprojection is built to run *from*. It runs every
time `osmd.Sheet.Transpose` changes; it does not currently run from
`useEngravingZoom`'s commit path in `MxlScore.tsx`. Wiring zoom through the same
reprojection call is mechanically possible later (same `MeasureList` lookup, different
trigger), but stays out of scope here per Newzik's own behavior, confirmed as a real
reference rather than assumed — see Out of scope.

## Freeze rule (revised: transpose exempted on `musicxml`, zoom still locks)

`AnnotateCanvas`'s freeze condition changes from `strokes.length > 0` to
`annotations.length > 0` — any element of any kind present locks that view's
reflow-capable controls, with transpose now handled differently from the rest:

| View | Locks when it has any annotation | Never locks |
|---|---|---|
| `chords` | chord-chart font zoom, lyrics-only toggle | transpose (label swap only — never reflows the lyric line, so there was never a hazard here) |
| `musicxml` | engraving zoom (pinch/wheel), instrument show/hide | transpose (reprojects instead, see above) |

Transpose was previously shared/coupled state that locked for the *whole song* if either
view had ink (`stage.dispKey` drives both renders). That coupling is gone: it's simply
never a lock condition on either view now, so there's nothing left to couple. A view with
only a pin and no ink still locks/unlocks exactly like one with only pen strokes for
every *other* control — one rule, one code path, no per-kind special-casing for the
controls that do still freeze.

## Stave spacing

`Settings.staveSpacing` (`"compact" | "default" | "roomy"`) maps to a small set of
`osmd.EngravingRules` values (vertical distance between staves within a system, and
between systems) set once in `MxlScore.tsx` right before `osmd.render()`, alongside the
existing `drawingParameters`/`disableCursor` setup. Applies to every MusicXML render in
the app — Live Stage, Add/Edit Song's Sheet Music preview tab, and the Annotate screen's
MusicXML view all read the same global setting, since none of them maintain their own
copy of engraving rules today.

Because this is global and static (not per-song, not user-adjustable mid-session on a
given chart), it never interacts with the freeze rule above — it's simply part of the
layout a view's freeze locks in, same as it would be if it were hardcoded.

### Settings screen (`src/screens/settings/Settings.tsx`)

A new "Notation" section (same `SectionLabel` + `list-row` pattern already used for
"Appearance"/"Data"), holding one inline `Segmented` control (Compact / Default / Roomy)
bound to `state.settings.staveSpacing`, dispatching a settings update the same way the
existing Stage Dark toggle does. No new sub-screen — unlike Appearance (which hosts a
live specimen and a text-size slider, justifying its own push), this is a single
three-way control with nothing else to show alongside it.

## Rename: Notes → Cues (UI copy only)

- `AnnotateScreen.tsx`: the `Segmented` option `{ value: "notes", label: "Notes" }` →
  `label: "Cues"`; the textarea's placeholder copy changes from "Notes for this song —
  reminders, cues, anything you want on hand while you're on stage." to "Cues for this
  song — reminders, anything you want on hand while you're on stage." (drops the
  now-redundant second "cues").
- `AddEditSong.tsx`: the tab chip currently labeled `Notes` → `Cues`.
- No change to `mode` state's string value (`"draw" | "notes"`), `song.notes`,
  `notesText`/`setNotesText`, or the SQLite `notes` column — all internal-only.

## Persistence (`src/data/db.ts`, `src/data/songsRepo.ts`, `src/data/settingsRepo.ts`)

`annotations_json` already stores `Stroke[]`-shaped JSON per view with no fixed schema
enforced by SQLite — widening it to `AnnotationObject[]` (including the new optional
`anchors`/`anchor` fields) needs no `ALTER TABLE` and no `songsRepo.ts` change at all.
It's the same column read/written today regardless of which setlist (if any) is
currently showing the song, which is what makes the song-level/cross-setlist behavior
above free — there's no setlist-scoped table involved anywhere in the annotations path.

`staveSpacing` is new on `Settings`, so it needs a real migration, following the exact
`DB_VERSION` bump + `ALTER TABLE` pattern the `defaultView` column used at v5:

```sql
-- toVersion: 6
ALTER TABLE settings ADD COLUMN staveSpacing TEXT NOT NULL DEFAULT 'default';
```

`DB_VERSION` bumps from `5` to `6`; `CREATE_SETTINGS_V4` stays frozen at its current
shape (same reasoning `db.ts`'s existing comments give for `CREATE_SONGS_V2`/
`CREATE_SETTINGS_V1` staying frozen — a fresh install's v6 step would otherwise try to
add a column v4's create statement already added). `settingsRepo.ts`'s row-mapping and
insert/update statements gain the one field, same pattern every prior settings field
followed.

## Migration / seed data (`src/state/mockData.ts`)

No change needed for `annotations` (already defaults to `{}`, which is valid for either
`Stroke[]` or `AnnotationObject[]`). Seeded settings gain `staveSpacing: "default"`.

## Future work / TODO (deliberately deferred, not part of this pass)

- **Stickers (arrow/star/dot stamps).** Cut from this pass per explicit direction — the
  tool-row slot, palette-picker interaction, and point-anchored placement/drag model were
  prototyped in the mockup and validated as workable (same architecture as pins: a
  `Sticker` variant of `AnnotationObject` with `type`/`rotation` fields, freeze rule
  extended the same way pins extend it), but shipping is deferred rather than building
  half of a two-part feature. When picked back up, this reuses `Pin`'s plumbing
  (including its `MusicalAnchor` reprojection) almost directly:
  ```ts
  export type StickerType = "arrow" | "star" | "dot";
  export interface Sticker {
    id: string;
    kind: "sticker";
    position: { x: number; y: number };
    type: StickerType;
    rotation?: number; // degrees; only meaningful for "arrow"
    anchor?: MusicalAnchor;
  }
  // AnnotationObject widens to Stroke | Pin | Sticker
  ```
  plus a Sticker tool-row button, a small palette popover (arrow/star/dot) shown on tap,
  and a rotate handle for the arrow variant — all already worked out in the mockup.
- **Reprojecting across an engraving-zoom change.** Mechanically the same `MeasureList`
  lookup reprojection already uses for transpose, just triggered from
  `useEngravingZoom`'s commit path in `MxlScore.tsx` instead of from `osmd.Sheet.
  Transpose` changing. Deliberately not built this pass, matching Newzik's own choice to
  keep zoom locked — revisit only if that turns out to be more restrictive in practice
  than it looks on paper.
- **Per-song stave spacing.** Would reopen the freeze question this pass sidesteps by
  going global-only; worth reconsidering together with engraving-zoom reprojection if
  that's ever tackled, since both are the same category of "layout changed, does ink
  still need to freeze or can it follow."
- **A color picker for pins.** Same "one fixed treatment now, expand if asked" call as
  the original spec's stroke-color decision.
- **Real Capo functionality.** Unrelated to this feature; tracked in
  `docs/progress-checklist.md`, not here — see Context above.

## Testing / verification

No automated test framework exists in this repo; `npm run build` clean is the
correctness bar, plus manual click-through:

1. `npm run build` is clean.
2. Place a pin on the chords view; confirm chord-chart zoom/lyrics-only disable, same as
   they do for ink today, but the Key chip stays enabled throughout; Clear re-enables
   zoom/lyrics-only.
3. Edit a pin's text; drag a pin to a new position; confirm it persists correctly after
   Done → reopen.
4. Erase a pin with the Eraser tool; Undo brings back the most recent change regardless
   of whether it was ink or a pin.
5. Place a pin and draw ink against an attached MusicXML score; confirm engraving
   zoom/instrument-visibility lock exactly as they do today, but the Key chip stays
   enabled.
6. Transpose that song to a different key from Live Stage; confirm the score re-engraves
   and the pin/ink end up correctly repositioned against the new layout (still pointing
   at the same notes/measures they were anchored to), not left at stale pixel
   coordinates and not blocked by a lock.
7. Repeat step 6 with a transpose that's large enough to add several accidentals (e.g.
   several steps up or down) so at least one system's line-wrapping actually changes —
   confirms reprojection survives a real line-break shift, not just an in-place
   accidental shift.
8. Force-close/reload; confirm pins on every view survive alongside existing ink, and
   that a song's pre-existing ink-only annotations (persisted before this change, with no
   `anchors`) still render correctly with no migration step and no reprojection attempt.
9. Place a pin on a song while running Setlist A; open the same song from a different
   existing setlist, and from a setlist created after the pin was placed; confirm the
   same pin appears in both — verifies the song-level/cross-setlist behavior above.
10. In Settings, switch stave spacing between all three options; confirm a MusicXML
    score's vertical spacing visibly changes in Live Stage, Add/Edit Song's Sheet Music
    tab, and the Annotate screen's MusicXML view.
11. Confirm "Notes" reads as "Cues" in both `AnnotateScreen.tsx`'s tab and
    `AddEditSong.tsx`'s tab chip, and that text typed in one still shows in the other
    (same shared `song.notes` field as before).
12. Confirm Capo is gone: no stepper in Stage Tools, no per-slot override in the run
    sheet's Slot Detail sheet.
