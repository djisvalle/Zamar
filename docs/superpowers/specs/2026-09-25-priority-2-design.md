# Priority 2: symbol library, favorites, annotation and MusicXML export, small text

## Context

The "Priority 2" group from the progress checklist's open list: feature gaps a user would
notice, after the release blockers (iOS build, Tuner on a device, score respelling).

- The Annotate notation palette had 23 symbols against a target of about 50–60, and no
  favorites.
- Annotate marks never left the device: no export format carried them.
- The MusicXML export sent scores out in their written key, even when the set key differed.
- Some surrounding UI text was still set inline at 10–12px.

Decisions made in chat before building:

- **Annotation export:** into the PDF only, with the content width a view was marked at
  recorded from now on (like `chordsTextScale` for text size), and an "Include
  annotations" switch. ChordPro and MusicXML can't carry ink.
- **Favorites:** press and hold a symbol to star it, and starred symbols show in a
  Favorites row between Recent and the grid, saved across launches.
- **Text floor:** snap to iOS text styles, 11pt minimum. 10 goes up to 11, while 11, 12
  and 13 stay where they're used as Caption 2, Caption 1 and Footnote. Descriptive copy
  (hints, descriptions, status lines) set at 11–12 goes up to 13.

## 1. Notation symbol library

`src/utils/notation.ts` now lists 59 symbols in kind order, which is also the order the
popover pages through them (18 per page, 4 pages):

| Kind | Symbols |
|---|---|
| Dynamics | ppp, pp, p, mp, mf, f, ff, fff, fp, sf, sfz, rfz |
| Articulation | accent, staccato, tenuto, marcato, staccatissimo, accent-staccato, louré |
| Fermatas and breaths | fermata, short fermata, breath mark, caesura |
| Accidentals | flat, sharp, natural, double sharp, double flat |
| Ornaments | trill, mordent, upper mordent, turn, inverted turn |
| Repeats and navigation | segno, coda, start/end repeat, repeat last bar, D.C., D.S. |
| Clefs and time | treble, bass, alto clef, common time, cut time |
| Notes and rests | whole, half, quarter, eighth notes and rests |
| Strings, pedal, octave | up bow, down bow, pedal down/up, 8va, 8vb |

Every codepoint comes from SMuFL's `glyphnames.json` and was rendered from the bundled
Bravura font to check it. The ids of all 23 earlier symbols are unchanged, since placed
marks store them.

`SmuflGlyph`'s svg now takes no pointer events. Its ink paints outside the viewBox
(`overflow: visible`), and a tall glyph's overhang was taking taps meant for the cell
above it in the grid.

## 2. Favorites

- `Settings.notationFavorites: string[]`, the starred symbol ids in the order they were
  starred, persisted as `settings.notationFavorites_json` (schema v10, default `[]`),
  toggled by the `TOGGLE_NOTATION_FAVORITE` action.
- In the Notation popover, a Favorites row sits between Recent and the grid. Until
  something is starred it shows "Press and hold a symbol to star it."
- Holding a symbol for 450ms (in the grid or in the row) stars or unstars it, with a
  haptic tick on native. The click that ends the hold doesn't also select the symbol.
  Starred symbols carry a small accent star in the grid.

## 3. Annotation export (PDF)

**Recorded width.** Marks are saved as CSS-px positions in the Live Stage content box,
whose layout depends on its width. `Song.annotationWidths` records that width per view
(schema v10 `songs.annotationWidths_json`). `syncAnnotationWidths` (utils/annotations.ts)
keeps it in step:
- Annotate's Done records the width for any marked view that has none.
- A view whose marks are all cleared drops its width.
- Live Stage backfills a width for marks saved before this existed, the first time it
  shows them. That's the device they're used on, so it's the best available guess.
- An export that still finds no width assumes the phone layout (402px).

**Painting.** `utils/annotationExport.ts` draws marks on a canvas the way Live Stage
stacks them: ink strokes first, then pins, text, notation stamps and shapes. It prints in
the light theme's colors whatever the current appearance. Pins print their note in a tag
beside the badge, since a printed badge can't be tapped open.

**Per view,** behind the "Include annotations" switch (PDF only, shown when an included
song has marks on its exported view):
- **Photo:** marks are drawn onto the JPEG, mapped from the photo's place in the stage
  layout (14px sides, 24px top, 1px border).
- **PDF:** the source pages are still copied as vectors. Each page that has marks gets a
  transparent PNG overlay, mapped from the stacked-pages layout on stage (content width,
  8px gaps). Rotated pages are skipped.
- **Score:** marks follow their measure anchor on the export's own engraving and line
  breaks, page by page. Unanchored marks are left out. Sizes assume the score was marked
  at its default on-stage zoom.
- **Chord chart:** the export's own text layout differs from the stage's, so a marked
  chart is laid out offscreen with `ChordChart` at the recorded width and text size, then
  copied onto a canvas glyph by glyph with the marks on top. It prints as images, split
  between lines to fill each page. If chords are switched off, the chart prints as normal
  text without its marks (they sit over the chord rows), and the done screen says so.

## 4. MusicXML export in the set key

`utils/musicxmlTranspose.ts` rewrites a `.musicxml`/`.xml` file or a compressed `.mxl`
(fflate, keeping `mimetype` first and stored) with the same rules as the on-screen
`KeyAwareTransposeCalculator`:
- Key signatures take the picked spelling.
- Notes and chord symbols keep their letter relative to the key, with strict spelling.
- Printed accidentals are recomputed per measure, staff and octave, and tied-over notes
  don't reprint theirs.

Checked against the on-screen engraving of `As_The_Deer.mxl` in five keys: all 173 notes
match. The only differences are two explicit naturals the file now prints.

The export screen offers the per-slot keys switch, and for a single song the key picker
and Up/Down, for MusicXML as well. A score that can't be read (score-timewise, or
unparseable) goes out as written, and the done screen names it.

## 5. Small text

- **Raised to 13:** inline copy at 11–12px that reads as a description or status line:
  - Stage Tools' "Clear marks…" hints
  - Import's review notes and file row
  - the pin editor's text and Delete/Done buttons
  - the score and PDF loading and error lines
  - the Live Stage artist line
  - popover row descriptions
- **Raised to 12:** Live Stage's "Next:" line and the attachment caption.
- **Raised to 11:** 10px labels: Stage Tools' icon labels, the export file tile, and the
  dev frame's control labels.

Left as they are:
- **Tab bar labels at 10:** iOS's own tab bar labels are 10pt. This goes against the 11pt
  floor, and iOS wins here, as CLAUDE.md asks.
- **Caption-level text at 11–12:** badges, key chips, the minor-key row, the A–Z index
  rail, the Annotate bar's subtitle and the splash tagline.
