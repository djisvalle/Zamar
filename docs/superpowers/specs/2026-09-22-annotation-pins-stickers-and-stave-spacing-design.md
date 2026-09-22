# Pins, stickers, and stave spacing for Annotate

## Context

`docs/superpowers/specs/2026-09-20-song-notes-and-annotations-design.md` built real
canvas annotation (freehand pen strokes, rectangle outlines, a whole-song typed notes
field) into `AnnotateScreen.tsx`, backed by `Stroke[]` per `AnnotationView`. It also
established the "freeze on annotate" rule: once a view's stroke layer is non-empty, any
control that would reflow that view's content (transpose, capo, chord-chart zoom,
MusicXML's engraving zoom/instrument-visibility) disables until Clear is used.

This pass extends that same system with two new kinds of point-anchored markup (sticky
notes and stickers) and a stave-spacing control for MusicXML rendering, following
brainstorming decisions made in chat:

- Sticky notes and stickers are point-anchored (a single position), unlike freehand ink
  (an arbitrary polyline) — architecturally that makes them *more* portable across a
  re-layout than ink, but this pass deliberately does not build reprojection for them.
  They fold into the exact same freeze rule ink already uses, for one consistent rule
  rather than a mixed "these survive zoom, ink doesn't" model.
- Stave spacing is a single global Settings control, not per-song — this sidesteps the
  freeze question entirely, since a global setting never changes after a song is
  annotated; it's just part of the layout a view's freeze locks in.
- The existing whole-song "Notes" text field (`song.notes`, the Draw/Notes tab in
  `AnnotateScreen.tsx`, the Notes tab in `AddEditSong.tsx`) is relabeled **Cues** in the
  UI only, to free up "Notes"/"sticky notes" for the new spatial feature without the two
  colliding in the product's vocabulary. The underlying field name, SQLite column, and
  internal variable names stay `notes` — this is a copy change, not a data-model rename,
  since renaming a persisted column buys nothing user-visible and adds migration risk.

## Goals

- A song's chart (chords, image, PDF, or MusicXML view) can carry sticky notes (a short
  typed note pinned to a point) and stickers (a small preset graphic — arrow, star, dot
  — pinned to a point, with the arrow also rotatable) alongside the existing pen/
  rectangle ink.
- All three annotation kinds persist together, per view, through the same
  `annotations_json` column that already exists — no schema change for this part.
- Placing/editing/moving/deleting sticky notes and stickers uses the same tool-row
  interaction model as ink (pick a tool, tap the chart, Eraser removes), so Annotate
  mode gains new capabilities without gaining a new interaction paradigm.
- A global Settings control adjusts the vertical spacing between staves/systems in
  rendered MusicXML scores, for people who want room to write in-app or on a printout.
- The existing whole-song text field reads as "Cues" everywhere it appears in the UI.

## Out of scope

- Reprojecting any annotation (ink, pin, or sticker) across a zoom/transpose/spacing
  change. The freeze rule from the original Annotate spec is extended to cover pins and
  stickers, not replaced with something smarter.
- Per-song stave spacing. Global only.
- A color picker for pins/stickers, or additional sticker artwork beyond arrow/star/dot
  — same "ship the small set, revisit if asked" call the original spec made for stroke
  color.
- Dragging ink strokes after they're drawn (only pins/stickers are repositionable —
  ink stays "committed the moment the gesture ends," same as today).
- Renaming `song.notes`, its SQLite column, or internal variable names — UI label only.

## Data model (`src/state/types.ts`)

```ts
export type AnnotationView = "chords" | "image" | "pdf" | "musicxml"; // unchanged

export interface Stroke {
  id: string;
  tool: "pen" | "square";
  points: { x: number; y: number }[];
}

export interface Pin {
  id: string;
  kind: "pin";
  position: { x: number; y: number }; // same coordinate space as Stroke.points
  text: string;
}

export type StickerType = "arrow" | "star" | "dot";

export interface Sticker {
  id: string;
  kind: "sticker";
  position: { x: number; y: number };
  type: StickerType;
  rotation?: number; // degrees; only meaningful for "arrow", omitted/0 otherwise
}

export type AnnotationObject = Stroke | Pin | Sticker;

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
from new objects wherever the array is iterated.

```ts
export type StaveSpacing = "compact" | "default" | "roomy";

export interface Settings {
  // ...unchanged fields...
  staveSpacing: StaveSpacing;
}
```

## Pin & sticker mechanics

Rendered as a new sibling layer of absolutely-positioned DOM elements — not canvas
pixels — inside the same frozen wrapper `AnnotateCanvas` already provides, so they scroll
with the content for free exactly like the ink canvas does, but stay individually
tappable/draggable after placement (canvas ink is deliberately just pixels once
committed; these need to stay live elements).

- **Pin tool:** tap the chart → a small text box opens inline, anchored at the tap
  point → type → tap outside the box to commit (empty text discards instead of creating
  an empty pin). Tapping an existing pin re-opens it for editing text or dragging to a
  new position within the same view.
- **Sticker tool:** tap the chart → a small palette (arrow / star / dot) appears → pick
  one → it's placed at the tap point. Tapping an existing sticker allows dragging to
  reposition; the arrow additionally shows a rotate handle (drag around the sticker to
  set `rotation`; star/dot have no rotation control since they're rotationally
  symmetric-in-effect for this use).
- **Eraser tool:** extended from hit-testing stroke segments (`hitTestStroke` in
  `utils/annotations.ts`) to also hit-test pins/stickers by simple distance-to-position
  (within the same `ERASE_RADIUS` used for ink), so Eraser stays the one tool that
  removes anything regardless of kind.
- **Undo:** the existing in-memory history stack (`AnnotateScreen.tsx`'s `history`/
  `commit`) already operates on "the full next array" regardless of element type, so
  placing, editing, moving, or erasing a pin/sticker pushes onto the same stack ink
  mutations do — no separate undo path needed.

## Freeze rule (extended, not changed)

`AnnotateCanvas`'s freeze condition changes from `strokes.length > 0` to
`annotations.length > 0` — any element of any kind present locks that view's
reflow-capable controls (transpose, capo, chord-chart zoom, MusicXML engraving zoom/
instrument-visibility), using the exact locking table the original spec already defined.
A view with only a sticky note and no ink is just as frozen as one with only pen strokes
— one rule, one code path, no per-kind special-casing.

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
enforced by SQLite — widening it to `AnnotationObject[]` needs no `ALTER TABLE` and no
`songsRepo.ts` change at all.

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

- **Reprojecting pins/stickers across zoom/transpose.** Flagged during brainstorming as
  architecturally easier than reprojecting ink (single anchor point vs. an arbitrary
  polyline) but explicitly deferred — revisit only if the freeze rule proves too
  restrictive in practice for point-anchored marks specifically.
- **Per-song stave spacing.** Would reopen the freeze question this pass sidesteps by
  going global-only; worth reconsidering together with per-song annotation reprojection
  if that's ever tackled.
- **More sticker artwork / a color picker for pins.** Same "small fixed set now, expand
  if asked" call as the original spec's stroke-color decision.

## Testing / verification

No automated test framework exists in this repo; `npm run build` clean is the
correctness bar, plus manual click-through:

1. `npm run build` is clean.
2. Place a pin and a sticker (each type) on the chords view; confirm transpose/capo/
   zoom/lyrics-only all disable, same as they do for ink today; Clear re-enables them.
3. Edit a pin's text; drag a pin and a sticker to a new position; rotate the arrow
   sticker; confirm all three persist correctly after Done → reopen.
4. Erase a pin and a sticker with the Eraser tool; Undo brings back the most recent
   change regardless of whether it was ink, a pin, or a sticker.
5. Repeat placement against an attached MusicXML score; confirm engraving zoom/
   instrument-visibility lock exactly as they do for ink.
6. Force-close/reload; confirm pins/stickers on every view survive alongside existing
   ink, and that a song's pre-existing ink-only annotations (persisted before this
   change) still render correctly with no migration step.
7. In Settings, switch stave spacing between all three options; confirm a MusicXML
   score's vertical spacing visibly changes in Live Stage, Add/Edit Song's Sheet Music
   tab, and the Annotate screen's MusicXML view.
8. Confirm "Notes" reads as "Cues" in both `AnnotateScreen.tsx`'s tab and
   `AddEditSong.tsx`'s tab chip, and that text typed in one still shows in the other
   (same shared `song.notes` field as before).
