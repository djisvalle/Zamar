# Sticky notes and direct text entry in Annotate

## Context

On-device testing on an Android tablet turned up two Annotate complaints:

- **The Pin tool isn't a sticky note.** A pin is a 24px badge (`PinBadge`,
  `AnnotateCanvas.tsx`) whose text is hidden until you tap it open. On stage you can't
  read a cue without touching the chart. Users coming from OnSong and paper charts expect a
  note that shows its text on the page.
- **The Text tool drops a placeholder.** Tapping places a `TextMark` whose text is the
  literal word `"Note"` (`AnnotateCanvas.tsx`, the `tool === "text"` branch of
  `onPointerUp`), which then has to be selected and edited in `EditMarkSheet` before it
  says anything useful. Every text mark takes three steps when it should take one.

Design decisions confirmed with the user before writing this spec:

- A sticky note **always shows its text** on the page. It never collapses to a badge.
- Notes can be **moved and resized**.
- Notes **print in PDF exports**, looking as they do on stage.
- Colours are the **classic set**: yellow (default), pink, blue, green.
- Notes are **fully solid**: they hide whatever is underneath, like paper.
- *(Recommended, awaiting confirmation)* When the keyboard opens for a note or text near
  the bottom of the view, the view scrolls so the field stays above the keyboard.

## Goals

- Tapping with the Sticky note tool places a readable note and puts the cursor in it, in
  one step.
- Tapping with the Text tool puts an empty text field with a cursor where you tapped, in
  one step. No placeholder word.
- Existing pins become sticky notes with no migration step and no data loss.
- Notes print in the PDF export the way they look on stage.

## Out of scope

- Rich text (bold, lists) inside notes or text marks.
- Rotating notes.
- Automatic note growth to fit text. The note's size is what the user set; text that
  doesn't fit is clipped with a fade, and the user resizes.
- Any change to notation stamps (`TextMark` with `symbolId`), shapes or ink.
- Carrying notes into ChordPro or MusicXML exports (neither format can hold them; same
  rule as all annotations, see CLAUDE.md "Annotations only export to PDF").

## Data model (`src/state/types.ts`)

`Pin` stays the stored type (`kind: "pin"`) so every persisted pin keeps working. It
gains three optional fields:

```ts
export interface Pin {
  id: string;
  kind: "pin";
  /** Top-left corner of the note, in content CSS px. Same reprojection role as
   * Stroke.points. */
  position: { x: number; y: number };
  text: string;
  anchor?: MusicalAnchor;
  /** Note size in content CSS px. Undefined (every pin saved before sticky
   * notes) means the default NOTE_WIDTH × NOTE_HEIGHT. */
  width?: number;
  height?: number;
  /** One of STICKY_COLORS' ids. Undefined means "yellow". */
  color?: StickyColor;
}

export type StickyColor = "yellow" | "pink" | "blue" | "green";
```

- Defaults: `NOTE_WIDTH = 160`, `NOTE_HEIGHT = 120`; minimum size `96 × 64`.
- Old pins stored their badge's anchor point, which sat 6px inside the badge's top-left.
  Using `position` as the note's top-left puts the note where the badge was, so no
  coordinate conversion is needed.
- The rename is UI-only: the toolbar label, icon and accessible name become "Sticky
  note". The `"pin"` tool id and `kind` stay so persisted data and recents don't need
  migrating.

Colours (in `utils/annotations.ts`), chosen to read on white paper in both themes and to
keep black text above 7:1 contrast:

| id | fill | edge |
|---|---|---|
| yellow | `#FFE680` | `#E6C84A` |
| pink | `#FFC2D6` | `#E89AB4` |
| blue | `#BFE0FF` | `#8DBFEA` |
| green | `#C8F0B8` | `#98CF84` |

Note text is always black (`#1c1c1e`) at 15px Barlow, 1.3 line height, 10px padding.
Notes don't re-theme in Stage Dark, for the same reason the score's page stays white:
they sit on the paper.

## Sticky note interaction

**Placing.** With the Sticky note tool active, a tap (not a drag) places a new note with
its top-left at the tap point, clamped so the whole note stays inside the content area.
The note appears in edit mode: a borderless `<textarea>` fills it, focused, keyboard up.
Replaces today's `editingPin` bubble editor.

**Finishing.** Tapping anywhere outside the note, switching tools or pressing Done
commits it. A new note whose trimmed text is empty is discarded (no empty notes). One
commit = one undo step.

**On the page.** A note always renders its full box: fill colour, 1px edge, 10px
radius, soft shadow (`0 2px 6px rgba(0,0,0,0.18)`), wrapped text. Text that overflows
the box is clipped, with the bottom 16px fading to the note colour so it's clear there's
more. Notes draw above ink and marks.

**Selecting, moving, resizing** (Select tool, following the ShapeMark handle model in
`2026-09-23-shape-rotate-resize-design.md`):

- Tap a note to select it: accent outline plus one bottom-right resize handle
  (44×44pt touch target, 14px visible dot).
- Drag the note body to move it. On MusicXML views, the anchor is re-derived at drop,
  as pins do today.
- Drag the handle to resize, clamped to the minimum size and the content area.
- Tap an already-selected note to edit its text in place (same textarea as placing).
- Box-select and multi-select include notes (today pins are excluded from
  `hitsAt`/box select).

**Colour.** The Sticky note tool's style popover shows the four colour swatches instead
of the ink palette. The chosen colour applies to new notes. When a note is selected, the
existing edit sheet shows the swatches to recolour it, plus Delete.

**Eraser.** Tapping anywhere inside a note erases it (today the hit radius is only
around the badge point).

## Text tool interaction

**Placing.** With the Text tool active, a tap puts an empty single-line-growing text
field at the tap point, in the tool's current colour and size, cursor blinking, keyboard
up. The existing lyric-line snap still applies to where the field lands. The
press-and-drag "ghost" placement for text is dropped (it stays for notation stamps).

**Typing.** The field auto-grows horizontally as you type and wraps at the content
width. Return inserts a new line.

**Finishing.** Tap outside, switch tools or press Done. If the trimmed text is empty,
nothing is added. Otherwise one `TextMark` is committed (one undo step).

**Editing later.** In the Select tool, tapping an already-selected text mark opens the
same inline field over it. Colour and size stay in `EditMarkSheet`, whose text input is
removed for plain text marks (still shown for notation stamps, where it isn't used
anyway).

## Keyboard handling

On native, while a note or text field is focused, the view containing the chart scrolls
so the field's bottom edge sits at least 16px above the keyboard. The keyboard height
comes from `window.visualViewport` (`resize` event), which Android and iOS WebViews
both report. No new Capacitor plugin. In the browser dev frame this is a no-op.

## PDF export (`utils/annotationExport.ts`)

`paintPin` is replaced by `paintStickyNote`, which draws what the stage shows:
rounded box in the note's fill, 1px edge, the same wrapped text, clipped to the box
(no fade on paper; the last visible line gets an ellipsis instead). No shadow.

## Files touched

- `src/state/types.ts`: `Pin` fields and `StickyColor`.
- `src/utils/annotations.ts`: colours, default/min sizes, note hit testing and bounds,
  include notes in `hitsAt` and box select.
- `src/components/AnnotateCanvas.tsx`: `StickyNote` component replacing `PinBadge`,
  inline textarea editor replacing the `editingPin` bubble, resize handle, inline text
  field for the Text tool.
- `src/screens/live-stage/AnnotateOverlay.tsx`: toolbar label/icon, colour swatches in
  the Sticky note popover and edit sheet, `EditMarkSheet` text field rule.
- `src/components/Icon.tsx`: sticky-note icon.
- `src/utils/annotationExport.ts`: `paintStickyNote`.
- `src/theme.css`: note and inline-field classes.
- `docs/annotate-mode-roadmap.md`, `docs/progress-checklist.md`: status.

## Testing

`npm run build` is the repo's only automated check. Manual, in the browser dev frame at
iPad size and on the Android tablet:

1. Place a note, type, tap outside: note stays, text visible. Undo removes it in one step.
2. Place a note, type nothing, tap outside: nothing is added.
3. Move, resize and recolour a note; reopen the song: all three persisted.
4. A pin saved before this change shows as a yellow 160×120 note in the same spot.
5. On MusicXML, place a note on a measure, transpose: the note follows the measure.
6. Text tool: tap, type, tap outside: text appears with no "Note" placeholder. Empty tap
   adds nothing.
7. Place a note near the bottom on the tablet: it stays visible above the keyboard.
8. Export a song with notes to PDF: notes print in colour with their text.
