# Inline styles to CSS classes

## Context

The progress checklist's last open code-quality item: `src/` has 235 inline
`style={{...}}` objects across 26 files, down from 373 at first count. They make it hard
to see where a screen gets its look, the same patterns get retyped (a centered muted
"nothing here" line, a text-link button, one bordered box four times in Import), and
nothing theme-level can reach them. The item was held back from earlier cleanup passes
because it touches almost every screen, which risks visual regressions, so it gets its own
spec.

A count on `main` at `ac1c341` splits them into:

- **About 176 with only fixed values.** Most are in ImportSong (29), AddEditSong (27),
  Export (15), LiveStage (12), Library (11) and AnnotateOverlay (11).
- **About 59 that depend on runtime values.** Positions and sizes in the annotation
  canvas and overlay, `fontScale` in `ChordChart`, pinch and preview `scale()` transforms,
  the import progress width, the segmented control's thumb, `--status-h`.

Decisions made in chat before writing this:

- **Runtime values stay inline.** Inline is the right tool for a value computed at
  render time. Moving them into CSS custom properties would bring the count near zero
  but adds a class-plus-variable pair per use, with no visual gain.
- **Classes are named by purpose**, like the rest of `theme.css` (`.row-title`,
  `.chip-row`, `.error-banner`), not generic helpers like `.flex` or `.mt-12`.
  Generic helpers would amount to a hand-rolled Tailwind, which the stack avoids.
- **Everything goes in `theme.css`**, in one headed section per screen. How styles load
  doesn't change.
- **Screenshot diff, one PR.** Screenshots of every reachable screen and sheet, taken
  before and after, must match pixel for pixel. It lands as one PR with one commit per
  screen area.

## 1. What moves and what stays

A `style` object moves to a class when every value in it is a literal (a number, a
string, or a `var(--token)`).

When an object mixes literals with runtime values, the literal properties move to a
class and only the runtime ones stay inline. For example, the import progress fill
becomes `className="import-progress-fill" style={{ width: ... }}`. The object only stays
whole if moving its literal part would leave a class used once that just restates two or
three properties. If a case like that comes up, it gets noted in the PR rather than
forced.

These always stay inline:

- anything computed from props, state or measurement (positions, sizes, transforms,
  `fontScale` multiples, `opacity` from a flag, the segmented thumb);
- custom properties set per element (`--status-h`);
- attributes on `<svg>` that describe the drawing itself (`width`, `height`,
  `viewBox`). An svg's plain `display: block` still moves to a class.

## 2. Class naming and shared classes

Classes are named for what the element is, prefixed by screen when they belong to one
screen: `.import-progress`, `.import-progress-fill`, `.edit-meta-row`, `.export-song-list`,
`.stage-next-label`, `.tuner-readout`. Existing class names are reused where one already
covers the case, instead of adding a near-copy.

Repeated patterns that aren't tied to one screen's layout become shared classes in the utility section of
`theme.css`, next to the existing `.muted` and `.accent-deep`:

| Class | Replaces | Seen in |
|---|---|---|
| `.empty-note` | `fontSize: 13, padding: "20px 0", textAlign: "center"` with `.muted` | MxlScore, PdfPages (×2 each) |
| `.text-btn` | the borderless 13/700 tint-colored button (`color: var(--acc-deep)`) | AnnotateCanvas pin editor (×2) |

Anything else that turns up in two or more places while the work is done gets added to
this list in the PR description, not invented up front.

Small one-off spacing nudges (`marginTop: 2`, `marginTop: 12`, `paddingTop: 48`) go on
the element's purpose class, for example `.library-empty { padding-top: 48px }`. They
don't become spacing helpers.

## 3. Keeping the look identical

Inline styles override any class, and a class rule doesn't. Where an element already has
a class that sets the same property (for example `.muted` or `.empty` setting a
`font-size` or `padding`), the new rule has to win the same way the inline style did.
So:

- new screen sections go **after** the shared primitives in `theme.css`, so they win ties
  on order;
- where a tie-break on order isn't enough, the selector is combined with the existing
  class (`.empty.library-empty`) rather than using `!important`;
- `px` units are written out (`13px`) because React added them to bare numbers.
  Unitless properties (`flex`, `opacity`, `fontWeight`, `lineHeight`, `zIndex`) stay
  unitless.

The screenshot diff is what proves it. Section 5 covers it.

## 4. Work order

One commit per area, each building cleanly on its own:

1. Shared classes (`.empty-note`, `.text-btn`) and their current users.
2. Import (`ImportSong.tsx`), including its four copies of the small bordered surface
   box, which become one Import class.
3. Add/Edit Song (`AddEditSong.tsx`, `QuickEditSheet.tsx`).
4. Live Stage (`LiveStage.tsx`, `StageToolsSheet.tsx`, `MusicToolbar.tsx`).
5. Annotate (`AnnotateOverlay.tsx`, `AnnotateCanvas.tsx`).
6. Export (`Export.tsx`).
7. Library, Setlists and their sheets (`Library.tsx`, `Setlists.tsx`,
   `SetlistDetail.tsx`, `SlotDetailSheet.tsx`, `SongPickerSheet.tsx`).
8. Everything else (`Tuner.tsx`, `Settings.tsx`, `Appearance.tsx`, `Splash.tsx`,
   `MxlScore.tsx`, `PdfPages.tsx`, `ChordChart.tsx`, `Icon.tsx`, `SmuflGlyph.tsx`,
   `StatusBar.tsx`, `Toggle.tsx`, `App.tsx`).

A last commit updates `docs/progress-checklist.md`: the inline-styles item is ticked,
with the count left (the runtime-value styles) and a note that they stay inline on
purpose. It also drops that item from the short list.

## 5. Verification

- `npm run build` is clean after every commit (the repo's only check).
- **Screenshot diff.** A Playwright script drives `npm run dev` through a fixed list of
  states, taking each one in Light and Stage Dark, at Phone (402×874) and iPad Air 13″
  (1024×1366):
  - Live Stage: chords, sheet music, PDF, photo, Stage Tools, Quick edit, the Annotate
    overlay and its popovers, setlist mode with the next-song header;
  - Library: list, search with no results, select mode, row sheet, empty state;
  - Setlists: each tab, run-sheet detail, slot sheet, set details, Add to set;
  - Add/Edit Song: each tab, including an attachment tab;
  - Import: the file-kind choice and the preview after picking a MusicXML file;
  - Export: each format tab;
  - Tuner (the mic pre-prompt and the denied state), Settings and Appearance.

  It runs against `main` first for the baseline and then after each commit. Any
  pixel difference is a bug to fix unless it's explained in the PR. The script is a
  throwaway working tool and isn't committed, since the repo has no test tooling.
- States the script can't reach reliably (OCR progress, the import error banner, the
  Replace/Append/Compare dialog, native-only chrome) get checked by comparing the diff
  against the old inline values line by line, and are listed in the PR as reviewed by
  reading, not by screenshot.

## Out of scope

- Moving runtime-value styles into CSS custom properties.
- Splitting `theme.css` into per-screen files.
- Any visual change, including fixing inconsistencies the audit finds (such as two
  near-identical paddings). Those get listed in the PR for a later pass instead of
  being fixed here, so the diff stays pixel-neutral.
