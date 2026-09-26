# Sticky Notes and Direct Text Entry Implementation Plan

**Goal:** Pins become always-visible, movable, resizable sticky notes in four colours
that print in PDF exports, and the Text tool opens an empty field at the tap point
instead of dropping a "Note" placeholder.

**Architecture:** `Pin` keeps its stored shape (`kind: "pin"`) and gains optional
`width`/`height`/`color`, so every saved pin renders as a default-size yellow note with
no migration. Notes join the Select tool's hit testing (`hitsAt`, box select, drag) the
same way marks do, get a bottom-right resize handle modelled on `ShapeHandles`, and are
edited in place with a textarea inside the note. The Text tool's inline field is a
`contentEditable` element in the marks layer. Both fields commit on blur, which fires
before any other tap's click, so Done, Undo and tool switches always see the committed
value.

**Spec:** `docs/superpowers/specs/2026-09-26-sticky-notes-and-text-entry-design.md`

## Global constraints

- No test framework: `npm run build` clean after every task, plus the manual checks at
  the end, in the browser dev frame and on the Android tablet.
- Saved pins, text marks, notation stamps, shapes and ink must render and behave as
  before except where the spec changes them.
- Commit as Israel Valle, no co-author trailer, no mention of AI authorship
  (CLAUDE.md).

## Task 1: Data model and geometry (`types.ts`, `utils/annotations.ts`)

- `Pin.width?`, `Pin.height?`, `Pin.color?: StickyColor`; export `StickyColor`.
- `STICKY_COLORS` (fill/edge/label per colour), `NOTE_WIDTH` 160, `NOTE_HEIGHT` 120,
  `NOTE_MIN_WIDTH` 96, `NOTE_MIN_HEIGHT` 64, `noteBox(pin)` returning the note's
  left/top/width/height, `stickyColor(pin)`.
- `hitTestPin` tests the note rectangle (grown by the eraser/select radius).
- `hitsAt` includes pins; `objectBounds` returns the note rectangle.

## Task 2: Sticky note rendering and Select behaviour (`AnnotateCanvas.tsx`)

- `StickyNote` replaces `PinBadge`: solid fill, edge, radius, shadow, wrapped text with
  a bottom fade. Drawn after marks so notes sit on top. No pointer events of its own
  (the overlay hit-tests it), except while being edited.
- Select tool: a tap on an unselected note or plain text mark only selects it; a tap on
  the selected one starts inline editing. Box select includes notes. Dragging a note
  previews via `dragPreview` and re-anchors it on scores at drop.
- `NoteHandle` (bottom-right, 44px touch target) resizes with a live preview, clamped to
  the minimum size and the content width, committing on release.

## Task 3: Placing and editing notes (`AnnotateCanvas.tsx`)

- Sticky note tool: a tap creates a draft note (top-left at the tap, clamped inside the
  content) in the session's note colour, rendered with a focused textarea.
- Editing an existing note swaps its text for the same textarea.
- Commit on blur (and on tool change or leaving draw mode): empty new note is dropped;
  an existing note emptied is deleted; otherwise one `onCommit`.
- While a field is open, a tap on the chart only closes it (overlay `pointerdown`
  commits and returns; `mousedown` is prevented so the field keeps focus on the tap
  that opened it). A blur within 350ms of opening re-focuses instead of committing.

## Task 4: Inline text field (`AnnotateCanvas.tsx`)

- Text tool: a tap opens an empty single-line `contentEditable` field, left edge at the
  tap, vertically centred on the snapped y, in the current text colour and size.
- Editing an existing free-text mark opens the same field centred on the mark, with the
  mark hidden meanwhile.
- Enter or blur commits. The mark's centre is taken from the field's rendered box, so
  it lands exactly where the field was. Empty text adds nothing (or deletes an existing
  mark). The press-and-drag ghost stays for notation stamps only.
- Spec adjustment: text marks stay single-line (they render `nowrap` and hit-test by
  text length today), so Enter finishes instead of inserting a line break.

## Task 5: Keyboard avoidance (`AnnotateCanvas.tsx`)

- While a note or text field is focused, watch `window.visualViewport`; if the field's
  bottom is within 16px of the visible bottom, scroll its nearest scrolling ancestor up
  by the difference. No-op where `visualViewport` is missing.

## Task 6: Toolbar and sheets (`AnnotateOverlay.tsx`, `Icon.tsx`)

- Tool renamed "Sticky note" with a new `sticky` icon; its popover shows the four
  colour swatches (session `noteColor`, passed to the canvas as `noteColor`).
- Toolbar swatch dot shows the note colour.
- `EditNoteSheet` for a selected note (from the selection menu's Edit): colour swatches,
  Done, Duplicate, Delete.
- `EditMarkSheet` drops its text input (text is edited in place now).

## Task 7: PDF export (`utils/annotationExport.ts`)

- `paintStickyNote` replaces `paintPin`: rounded box in the note colour, 1px edge,
  wrapped 15px text clipped to the box with an ellipsis on the last visible line.

## Task 8: CSS and docs

- `theme.css`: `.sticky-note`, `.sticky-note-fade`, `.sticky-note textarea`,
  `.note-handle`, `.text-field`.
- Update `docs/annotate-mode-roadmap.md` and `docs/progress-checklist.md`.

## Manual verification

The eight checks in the spec's Testing section, plus: an old pin (saved before this
change) shows as a yellow note at its old spot and can be moved, resized and recoloured.
