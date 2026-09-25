# Native iOS look across the app

**Status:** approved 2026-09-24 (option 1, all three open questions answered yes).

## Context

Zamar's first users are iOS users leaving OnSong, but nothing in the app currently looks
like iOS. Every piece of UI, including the tab bar, nav headers, sheets and the Annotate
toolbar, is drawn by our own React + CSS inside the Capacitor web view (`TabBar.tsx`,
`Header.tsx`, `Overlays.tsx`, `theme.css`). A web view never inherits system styling, so
installing the app on an iPhone running iOS 26 does not give it Liquid Glass or any other
native look. What you see in the browser dev frame is what ships.

The request (Israel, 2026-09-24) is that the whole app feel like native iOS, with the
Annotate toolbar as the first concrete example: tool settings should appear in a floating
popover anchored to the selected tool, like forScore, instead of a flat panel that
pushes the chart up.

## Approach options considered

1. **iOS 26 styling in our own CSS (recommended).** Keep the Capacitor + React stack and
   restyle the shared primitives to match iOS 26: system font, translucent "glass" bars
   and popovers, grouped inset lists, iOS sheets, iOS switch/segmented/slider controls.
   One codebase, works offline, testable in the browser. Limitation: the web can blur and
   tint what's behind a surface (`backdrop-filter`) but can't reproduce Liquid Glass's
   lens refraction exactly, so it gets close, not identical.
2. **Ionic components.** Replace our primitives with `@ionic/react`, which renders iOS
   styling on iPhone and Material on Android. Rewrites every screen, adds a large
   dependency and its own router conventions; its iOS theme is its own interpretation.
3. **Native SwiftUI chrome.** Real Liquid Glass tab bar and popovers through custom
   Capacitor plugins. Pixel-exact on iOS, but it is iOS-only code in required paths
   (against the OS-agnostic rule), Android would need its own, and it can't be built or
   verified here without a Mac.

The rest of this spec assumes option 1.

## Goals

- A new user coming from OnSong on iOS 26 feels at home: familiar type, controls,
  materials, spacing, and touch targets (44pt minimum).
- The Annotate toolbar becomes a floating glass tool bar with a popover per tool.
- Chart content (chords, PDF, MusicXML, annotations) is unchanged. Only chrome changes.

## Non-goals

- No change to navigation structure, data, persistence, or annotation mechanics.
- No native (Swift/Kotlin) UI code.
- No Material/Android-specific look in this pass (see open questions).

## Design

### Tokens (`theme.css`)

- **Type:** `--font-body` becomes the system stack
  (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, Roboto, sans-serif`), so
  iPhone renders SF Pro. Sizes follow the iOS type ramp: Large Title 34, Title 3 20,
  Headline 17 semibold, Body 17, Subheadline 15, Footnote 13, Caption 12/11.
  This also removes the Google Fonts fetch, which fails offline on stage.
- **Colors:** iOS system backgrounds (`#f2f2f7` grouped / `#ffffff` elevated in light,
  `#000000` / `#1c1c1e` / `#2c2c2e` in dark), iOS separators, and iOS label greys.
  The steel-blue accent stays as the app's tint color, the way native apps set their own
  tint.
- **Glass material:** new `--glass-bg`, `--glass-border`, `--glass-shadow` tokens and a
  `.glass` utility: translucent fill, `backdrop-filter: blur(24px) saturate(180%)`, a 1px
  inner highlight, and a soft shadow. Used for bars, the tab bar, popovers and floating
  toolbars.
- **Radii:** capsule controls, 26px popovers/cards, 10px grouped-list sections.

### Shared chrome

- **Tab bar:** a floating glass capsule inset from the screen edges (iOS 26), SF-style
  icons at 25px with 10pt labels, tint on the active tab.
- **Nav header:** transparent over content with a glass background once content scrolls
  under it; large titles at 34pt on root screens; text buttons at 17pt in tint color;
  back chevron plus previous title.
- **Sheets:** iOS sheet with grabber, 10px top radius on phone, glass background; action
  lists become grouped inset rows with separators; destructive actions in system red.
- **Lists:** Library, Setlists and Settings rows become grouped inset lists (white cells
  on grouped background, hairline separators, chevrons, 44pt rows).
- **Controls:** iOS switch (51×31), segmented control (sliding thumb), slider (thin track,
  white round thumb with shadow), and circular color swatches with a ring for selection.

### Annotate toolbar (first piece built)

- The bottom toolbar becomes a floating glass bar: Undo/Redo on the left, the tool icons
  in the middle (scrolls horizontally on phone), Done on the right. Draw/Cues and Clear
  move into a "⋯" menu to keep the bar to one row.
- Tapping the active tool again (or the first tap on a tool with settings) opens a glass
  **popover** above it, with an arrow pointing at the tool. Tapping the chart or another
  tool closes it. Contents per tool:
  - Pen / Highlighter / Rect: one row of color swatches (paged with dots), Size and
    Opacity sliders with the value shown in tint (`41 pt`), a live ink preview.
  - Notation: the glyph grid (paged with dots, "Favorites / All" tabs later), then colors
    and Size.
  - Text / Shapes: shape or style picker, colors, Size.
  - Eraser: Size only.
- The chart is no longer pushed up while picking a tool, since the popover floats over
  it. Zoom and scroll stay locked exactly as PR #8 leaves them.

## Decisions (were open questions)

1. **Brand font.** Dropping Barlow for SF Pro is what makes it read as iOS. Keep Bebas Neue
   for the splash wordmark only? **Decided: yes.**
2. **Android.** With option 1 nothing is native on either platform, so Android runs the
   same CSS and gets the same iOS-style look (glass bars, popovers, grouped lists). The
   system font stack resolves to Roboto there instead of SF Pro. `backdrop-filter` works in
   Android System WebView 76+; the `.glass` utility falls back to a solid surface where it
   doesn't. A root `data-platform` attribute (from `Capacitor.getPlatform()`) is added now
   so a later pass can adjust Android-only details (hardware back button, no rubber-band
   bounce, Material ripples) without touching iOS. **Decided: same look this pass;
   Android tweaks afterwards.**
3. **Stage Dark.** Map Stage Dark to iOS dark (true black) or keep the navy? **Decided: iOS
   dark (true black).**

## Rollout

1. Annotate toolbar + popover, plus the tokens and `.glass`/control primitives it needs.
   Branched from PR #8, which rewrites the same toolbar.
2. Tab bar, nav headers, sheets.
3. Grouped lists and controls across Library, Setlists, Settings, Tuner, Add/Edit Song.

## Part 2 notes (tab bar, nav headers, sheets)

- The tab bar floats over content. `App.tsx` marks the device `has-tab-bar` while it
  shows, which reserves `--tab-clear` at the bottom of every screen; a screen's main
  scroll area opts into running under the glass with `.scroll-under-tabs`. Live Stage's
  key bar floats just above it as its own glass capsule.
- The tab bar hides while Annotate is open, since Annotate is a full-screen editing mode
  whose own bars sit at the bottom edge.
- The nav bar takes on the bar material and a hairline once the screen's content has
  scrolled. Large titles don't collapse into the bar on scroll: that needs the title to
  live inside each screen's scroll area, which fits better with part 3's list rework.
- Dialogs become iOS alerts (centered text, hairline-divided buttons, destructive in
  red). Sheets group their action rows into inset sections, with destructive actions in
  their own section.
- iPad: iPadOS 18+ puts the tab bar at the top of the screen. This pass keeps it as a
  compact capsule at the bottom on iPad too, for one layout across sizes; moving it to
  the top on iPad is a possible follow-up.


## Part 3 notes (lists, controls, forms)

- Grouped screens (`.screen--grouped`) put their content on the grouped background in
  inset sections (`<Section>` in `components/List.tsx`): uppercase footnote header, a
  rounded group of 44pt `.sheet-row`s with hairlines inset to the text, and a footnote
  footer. Library, Setlists, set detail, Settings, Appearance, Export and Tuner use it.
- Large titles now collapse: the 34pt `<LargeTitle>` is the first thing in the screen's
  scroll area, and `<Header large>` fades in its small centered title and takes on the
  bar material once the large title has scrolled under the bar.
- Controls: a 51×31 switch in system green (UISwitch's default on color, whatever the
  app tint), a capsule segmented control with one sliding thumb, the `.ios-slider` for
  Text size, and filter capsules (`.chip`) that scroll sideways instead of wrapping.
  Setlists' Upcoming/Past/Templates, Export's format and the Tuner's strings became
  segmented controls, since each is one choice among a few.
- Forms: Add/Edit Song's metadata is an inset group of placeholder fields (Title | Key,
  Artist | Tempo | Time Sig.), with "Default on Live Stage" as a menu picker row.
  Set details is a sheet with Cancel/Save in a nav row. Alert text fields replace the
  labelled inputs in the New setlist, section and version dialogs.
- Pull-down menus (`PullDown.tsx`) are portaled to the device so list groups can't clip
  them; Order By uses one.
- "Add to set" and Live Stage's "Add to Setlist" are large-detent sheets sharing
  `SongPickerSheet` (search, Order By, A–Z sections with a section index). Quick edit
  and Export's share sheet use the sheet styling. The side drawer is gone.
- Error banners, "Remove this version" and "Reset app data" use system red
  (`--danger-fg`).
