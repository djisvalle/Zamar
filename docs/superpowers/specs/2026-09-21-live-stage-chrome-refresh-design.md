# Live Stage chrome refresh: badge removal, no-op end-of-set, toolbar declutter, theme scope, sheet selector, iPad Air viewports

## Context

Follow-up design review (chat feedback) on the Live Stage screen after
`2026-09-21-ios-tab-navigation-design.md` landed the bottom tab bar. Six
independent-ish complaints, bundled into one spec since they all touch
`LiveStage.tsx`/`MusicToolbar.tsx`/`theme.css`/`App.tsx` and were raised together:

1. The `LIVE` badge in the header is redundant now that an active setlist already
   shows a progress bar directly below it.
2. The "Set complete" end-of-setlist screen is an unwanted dead-end; swiping past the
   last song should simply do nothing.
3. `MusicToolbar` (icon row + key-transpose row + an expandable capo/lyrics/zoom-or-
   instrument row) stacks up to three rows directly above the tab bar — the two bottom
   bars compound into a cramped 4-5-row block at the bottom of a phone screen.
4. Live Stage's base background uses `--bg` (`#f2f2f3`, light gray in light mode),
   which reads as a mismatched "second white" next to `--surface` (`#ffffff`, true
   white) used by cards and by the sheet-music/PDF/photo rendering. Separately,
   Stage Dark darkening the area around a rendered PDF/photo/engraving (which is
   always a light page, since we don't restyle third-party content) looks wrong.
5. The Sheet-view selector can stack a Chord/Sheet toggle + a category-chip row
   (Sheet Music/PDF/Photo) + a version-chip row — three rows for what should be one
   pick.
6. The dev-preview viewport toggle only has one generic "Tablet" size
   (512.5×737.5, not tied to any real device); the ask is real iPad Air sizing.

Decisions made during brainstorming (see chat history for the full discussion):

- All six are bundled into one spec and one implementation pass, matching the
  precedent set by the tab-navigation spec.
- Toolbar declutter: **slim bottom bar + header icons**, not "move the whole toolbar
  to the top." The key-transpose row (most-used control) stays pinned above the tab
  bar for one-handed reach while performing; Add-song/Quick-edit/Annotate move into
  the header as icon buttons; Capo/Lyrics-only/Zoom/instrument-visibility move behind
  a single "More controls" `Sheet` instead of an inline expand/collapse row.
- Explicitly **not** moving the tab bar to the top — bottom tab bars are the fixed
  iOS (`UITabBar`) convention, and this app's primary target users are iOS/OnSong
  switchers (per `CLAUDE.md`'s "Target platform & users"). The toolbar rework above
  already resolves the stacking complaint without touching the tab bar.
- Theme scope narrows to: header + toolbar + tab bar (full Light/Stage-Dark), and the
  chords/lyrics view (full Light/Stage-Dark, since dimming the screen while reading
  lyrics on a dark stage is the actual point of "Stage Dark"). The Sheet Music/PDF/
  Photo view's background is no longer theme-driven — always light, matching the
  content it's framing.
- Sheet selector: category + version chip rows collapse into one tappable label that
  opens a `Sheet` (reusing the existing version-picker `Sheet` pattern already in
  `LiveStage.tsx`), leaving Chord/Sheet as a standalone 2-way toggle row.
- New viewports use **real iPad Air logical-point resolutions** (11″: 820×1180, 13″:
  1024×1366, both portrait — confirmed via device-spec lookup) and **replace** the
  generic "Tablet" toggle rather than sitting alongside it.
- `stage.toolbarExpanded`/`STAGE_TOGGLE_TOOLBAR` are removed from the reducer in favor
  of ordinary local component state for the new "More controls" sheet, matching how
  `partsOpen`/`versionPickerOpen` are already handled in `LiveStage.tsx` — there's no
  remaining reason for expand/collapse to be global reducer state once it's a modal
  sheet instead of an inline row.
- `stage.ended` and `STAGE_REPLAY` are removed outright (not left as unreachable dead
  code) — `STAGE_REPLAY` has no other caller, and `ended` has no other reader.

## Goals

- No `LIVE` badge anywhere in Live Stage's header states.
- Reaching the end of a setlist by swiping/advancing past the last song is a no-op:
  the last song stays on screen, no separate screen or dialog appears.
- Live Stage's bottom chrome is a single one-row control surface (key chips) directly
  above the tab bar, with Add-song/Quick-edit/Annotate reachable from the header and
  secondary controls (capo/lyrics-only/zoom, instrument visibility) reachable from a
  "More controls" sheet.
- Live Stage's base background is `#ffffff` in light mode (matching `--surface`), and
  the Sheet Music/PDF/Photo view no longer changes appearance between Light and Stage
  Dark.
- When a song has more than one attachment kind and/or version, picking which one to
  view on Sheet is one tap into one sheet, not two stacked chip rows.
- The dev-preview viewport toggle offers Phone, iPad Air 11″, and iPad Air 13″, sized
  to each device's real logical-point (CSS px) resolution.

## Out of scope

- No change to the idle auto-hide mechanism itself (`IDLE_MS = 6000`,
  `STAGE_SET_CHROME_HIDDEN`) — the toolbar/header still hide together on idle exactly
  as today, just with different contents.
- No change to swipe-to-navigate gesture handling beyond the no-op-past-last-song
  behavior in goal 2 (swipe-to-previous, the swipe threshold, and pointer handling are
  untouched).
- No change to `AnnotateScreen`, `QuickEditSheet`, `AddSongDrawer`, or
  `InstrumentFilterModal` internals — only how they're triggered (icon location).
- No change to Stage Dark's effect on any other screen (Library, Setlists, Tuner,
  Settings, Export) — this spec only narrows theming scope on the Live Stage sheet
  view specifically.
- No new Android/iOS-specific device frame beyond the two new dev-preview iPad Air
  viewports — native builds already render full-screen with no frame (`App.tsx`'s
  `Capacitor.isNativePlatform()` branch), so this is dev-preview-only.
- Native on-device verification of the new viewport sizes isn't applicable — they only
  exist in the desktop-browser dev-preview frame.

## Header, badge, and end-of-set (`LiveStage.tsx`, `store.ts`, `types.ts`)

- All three `.live-badge` render sites (`ended` branch, no-song branch, main branch)
  lose the badge markup. The `.live-badge`/`.live-badge .dot` CSS in `theme.css` is
  deleted since nothing references it afterward.
- `STAGE_ADVANCE` (`store.ts:308`): when `nextIndex >= ids.length`, return `state`
  unchanged instead of setting `ended: true`. The existing "Last song" label
  (`LiveStage.tsx:221`, derived from `songIndex + 1 < setlistSongIds.length`) already
  communicates end-of-set; no replacement UI is added.
- Remove `stage.ended` (`types.ts:102`), the `STAGE_REPLAY` action and its reducer
  case, and the `if (stage.ended && setlist)` render branch (`LiveStage.tsx:83-109`)
  entirely.
- The top `.hdr` band (previously just tint + badge) now also hosts the relocated
  Add-song/Quick-edit/Annotate icon buttons (see next section) — it stops being
  almost-empty.

## Toolbar declutter (`MusicToolbar.tsx`, `LiveStage.tsx`)

- **Header icons**: Add-song, Quick-edit, Annotate render as icon buttons in Live
  Stage's top `.hdr` band, right-aligned, reusing the existing `Icon` glyphs already
  used inside `MusicToolbar`'s current icon row (`plus`, `edit`, `annotate`). Each
  keeps its existing handler (`STAGE_OPEN_DRAWER` with `"add-song"`/`"quick-edit"`/
  `"annotate"`).
- **Bottom bar** (`MusicToolbar.tsx`) becomes one row: the existing `KeyChips`
  transpose control, plus a single small trailing control (e.g. a "…"/sliders icon
  button) that's only rendered when `showSecondRow` is true (same condition as today:
  `view === "chords" ? hasChords : instruments.length > 1`) — a song with nothing to
  configure beyond transpose shows no trailing control at all.
- **"More controls" sheet**: tapping that trailing control opens a `Sheet` (new local
  `moreControlsOpen` state in `LiveStage.tsx`, alongside `partsOpen`/
  `versionPickerOpen`) containing exactly what today's expanded second row held:
  - Chord view: `ToolbarStepper` (Capo), Lyrics-only toggle, Zoom −/+ — same
    `chordsLocked` disabling/messaging as today.
  - Sheet view: the instrument show/hide chips — same `instrumentsLocked`
    disabling/messaging as today.
- `stage.toolbarExpanded` (`types.ts:99`) and the `STAGE_TOGGLE_TOOLBAR` action
  (`store.ts:103,298-299`) are removed; `MusicToolbar.tsx`'s chevron button and
  `LiveStage.tsx`'s `onScreenClick` auto-collapse-on-tap logic (`LiveStage.tsx:202-205`)
  are removed along with them — the sheet closes the same way every other `Sheet` in
  this app closes (backdrop tap), no bespoke collapse behavior needed.
- `MusicToolbar` keeps receiving the same props it needs (`view`, `hasChords`,
  `instruments`, `hiddenParts`, `onToggleInstrument`, `transposeLocked`,
  `chordsLocked`, `instrumentsLocked`) but no longer needs `onAddSong`/`onQuickEdit`/
  `onAnnotate` (moved to the header) — those three props are dropped from its
  interface, and the drawer-open dispatches move to wherever the header icons are
  rendered in `LiveStage.tsx`.

## Theme scope (`theme.css`, `LiveStage.tsx`)

- `.device[data-theme="light"] { --bg: ... }` changes from `#f2f2f3` to `#ffffff`.
  (Dark mode's `--bg` is unaffected — Stage Dark's navy background is the intended
  look for chrome and the chords/lyrics view.)
- The Sheet Music/PDF/Photo view's container (`LiveStage.tsx`'s `activeKind &&
  activeVersion` branch, `~line 352-376`) stops inheriting the screen's theme-driven
  background — it's given a fixed light background (e.g. `#ffffff`/`--surface`
  equivalent, not a CSS variable that flips with `data-theme`) so it reads identically
  in Light and Stage Dark. The image/MusicXML/PDF content itself was already
  unaffected by theme (it's rendered third-party content); this only changes the
  container framing it.
- No change to `--bg`'s role for the header/toolbar/tab bar or the chords/lyrics
  (`ChordChart`) view — both keep flipping fully between Light and Stage Dark as
  today.

## Sheet selector collapse (`LiveStage.tsx`)

- The Chord/Sheet 2-way toggle (`LiveStage.tsx:244-278`) is unchanged in behavior and
  stays its own row.
- The category-chip row (`LiveStage.tsx:301-317`, rendered when
  `availableKinds.length > 1`) and the version-chip row (`LiveStage.tsx:318-331`,
  rendered when the active bucket has more than one version) are replaced by one
  tappable label, shown whenever either condition holds (more than one kind, or the
  active kind has more than one version): e.g. `"PDF · Lead Sheet ▾"`, following the
  same "▾ label" chip styling the version picker already uses
  (`LiveStage.tsx:320-329`).
- Tapping it opens a single `Sheet` (replacing/extending the existing
  `versionPickerOpen` sheet at `LiveStage.tsx:408-429`) that lists every available
  kind, and under each kind, its version(s) — picking a row sets both `activeKind` and
  `activeVersionId` together (today's `setActiveKind`/`setActiveVersionId` pair, just
  driven from one sheet instead of two separate chip rows). A song with exactly one
  kind and one version shows no selector row at all, same as today's chip rows being
  conditionally rendered.

## New viewports (`App.tsx`, `theme.css`, `DeviceNotch.tsx`, `state/types.ts`)

- `Viewport` type changes from `"phone" | "tablet"` to `"phone" | "tablet11" |
  "tablet13"` (naming to match implementation's existing conventions — the
  implementation plan can adjust the literal string if a clearer name fits the
  codebase better, e.g. `"ipadAir11"`/`"ipadAir13"`).
- `VIEWPORT_VARS` (`App.tsx:21-24`) gains two entries replacing `tablet`:
  - `tablet11: { fw: "820px", fh: "1180px", statusH: "24px" }`
  - `tablet13: { fw: "1024px", fh: "1366px", statusH: "24px" }`
  (status bar height carried over from today's single tablet value; revisit only if
  visually wrong once built.)
- The dev-preview `Viewport` segmented control (`App.tsx:106-121`) gets a third
  button; labels read "iPad Air 11″" / "iPad Air 13″" instead of "Tablet".
- `DeviceNotch.tsx`'s `viewport === "tablet"` check becomes true for both
  `tablet11`/`tablet13` (both get the same tablet-style notch treatment it already
  renders).
- `theme.css`'s `[data-viewport="tablet"]` selector (key-row full-width behavior,
  `theme.css:492`) becomes `[data-viewport="tablet11"], [data-viewport="tablet13"]`.
- Default viewport (`store.ts:69,74`, `"phone"`) is unchanged.

## Testing / verification

No automated test framework exists in this repo (per `CLAUDE.md`'s documented
gotcha); `npm run build` (`tsc -b && vite build`) is the correctness bar, plus manual
click-through:

1. `npm run build` is clean (verifies the `Viewport` type/union changes propagate
   everywhere they're referenced, and that removing `stage.ended`/
   `stage.toolbarExpanded` doesn't leave a dangling reference).
2. Load a song with no setlist: confirm no `LIVE` badge, header shows Add-
   song/Quick-edit/Annotate icons, and the bottom bar's trailing "more controls"
   button only appears when `showSecondRow` would have been true today (chord view
   with chords present, or sheet view with more than one instrument part).
3. Start a setlist, advance to the last song, try to advance again (swipe/whatever
   today's forward-advance affordance is): confirm the last song stays on screen with
   no dead-end screen.
4. Tap the "more controls" trailing icon in chord view: confirm the sheet shows
   Capo/Lyrics-only/Zoom and matches today's `chordsLocked` disabled/message state
   when annotations exist.
5. Switch to Sheet view on a song with an attached score: confirm the same "more
   controls" sheet shows instrument chips instead, matching `instrumentsLocked`
   behavior.
6. Compare Live Stage's background in Light mode against a sheet-music/PDF preview —
   confirm they're now the same white, and confirm Stage Dark no longer changes the
   Sheet Music/PDF/Photo view's background (only the header/toolbar/tab bar and any
   chords/lyrics view do).
7. On a song with multiple attachment kinds and multiple versions in at least one
   kind, confirm the single "▾" selector opens a sheet listing all kind/version
   combinations, and picking one updates the displayed attachment correctly.
8. In the dev-preview toggle bar, confirm "iPad Air 11″" and "iPad Air 13″" render
   the device frame at the correct portrait aspect ratio, and that the key-row
   (transpose chips) fills the row edge-to-edge on both, same as today's single
   "Tablet" option did.
