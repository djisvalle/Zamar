# Live Stage chrome refresh: badge removal, no-op end-of-set, consolidated stage tools, theme scope, persisted default view, iPad Air viewports

## Context

Follow-up design review (chat feedback) on the Live Stage screen after
`2026-09-21-ios-tab-navigation-design.md` landed the bottom tab bar. Started as six
independent-ish complaints, bundled into one spec since they all touch
`LiveStage.tsx`/`MusicToolbar.tsx`/`theme.css`/`App.tsx` and were raised together, then
grew a seventh item once the interactive mockup (built per this repo's mock-up-before-
implementation workflow) prompted two more rounds of feedback:

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
7. *(added after reviewing the mockup)* The Chord/Sheet toggle should also move off
   the song-title row and into the same consolidated tools sheet that items 3 and 5
   resolve into — and separately, songs should be able to remember a chosen "default
   preview" (which view — Chords/Lyrics, Sheet Music, PDF, or Photo — Live Stage opens
   to for that song), settable from Add/Edit Song, rather than Live Stage always
   guessing the same way every time it loads a song.

Decisions made during brainstorming (see chat history for the full discussion):

- All seven items are bundled into one spec and one implementation pass, matching the
  precedent set by the tab-navigation spec.
- Toolbar declutter: **slim bottom bar + a single consolidated "Stage tools" sheet**,
  not "move the whole toolbar to the top." The bottom bar collapses to one row — key-
  transpose chips (the most latency-sensitive control, kept in the thumb zone for
  one-handed reach while performing — a worship leader can call an audible key change
  mid-song) plus one trailing trigger button. That trigger opens a single `Sheet`
  holding everything else Live Stage's toolbar and song-header used to spread across a
  header row, a song-title-row toggle, and an expandable second row:
  - An icon row at the top: Add-song, Quick-edit, Annotate.
  - A view-picker list: Chords/Lyrics plus one row per attachment kind the song has
    (Sheet Music/PDF/Photo), replacing both the old Chord/Sheet 2-way toggle *and* the
    old category/version chip rows in one place (this is items 5 and 7's toggle-move
    combined — see "Stage tools sheet" below for the merged shape).
  - Below that, the existing view-specific row: Capo/Lyrics-only/Zoom (chord view) or
    instrument show/hide chips (sheet view).
  None of Add-song/Quick-edit/Annotate are latency-critical — each already opens a
  drawer/sheet/mode today — and neither is switching which view you're looking at
  (especially now that a song can remember its own default, item 7, making manual
  switching an occasional override rather than a per-song ritual). One consistent
  entry point for all of Live Stage's contextual tools beats splitting them across the
  header, the song-title row, and a separate sheet. The header itself gets no icon
  buttons; it stays exactly what it already is elsewhere in the app — a strip that
  tints when a setlist is active — with the `LIVE` badge simply gone (goal 1). The
  song-title row is left holding just title/artist.
- Explicitly **not** moving the tab bar to the top — bottom tab bars are the fixed
  iOS (`UITabBar`) convention, and this app's primary target users are iOS/OnSong
  switchers (per `CLAUDE.md`'s "Target platform & users"). The toolbar rework above
  already resolves the stacking complaint (down to one bottom row) without touching
  the tab bar, and with only one row left, moving it to the top would trade away
  thumb-reach for a crowding problem that no longer exists.
- Theme scope narrows to: header + toolbar + tab bar (full Light/Stage-Dark), and the
  chords/lyrics view (full Light/Stage-Dark, since dimming the screen while reading
  lyrics on a dark stage is the actual point of "Stage Dark"). The Sheet Music/PDF/
  Photo view's background is no longer theme-driven — always light, matching the
  content it's framing.
- New viewports use **real iPad Air logical-point resolutions** (11″: 820×1180, 13″:
  1024×1366, both portrait — confirmed via device-spec lookup) and **replace** the
  generic "Tablet" toggle rather than sitting alongside it.
- `stage.toolbarExpanded`/`STAGE_TOGGLE_TOOLBAR` are removed from the reducer in favor
  of ordinary local component state for the new "Stage tools" sheet, matching how
  `partsOpen` is already handled in `LiveStage.tsx` — there's no remaining reason for
  expand/collapse to be global reducer state once it's a modal sheet instead of an
  inline row. `versionPickerOpen` is subsumed into the same sheet (see below), so it's
  removed too rather than kept as a second overlapping sheet.
- `stage.ended` and `STAGE_REPLAY` are removed outright (not left as unreachable dead
  code) — `STAGE_REPLAY` has no other caller, and `ended` has no other reader.
- Persisted default view: a new optional `Song.defaultView` field remembers which view
  a song opens to on Live Stage, set from a new picker in Add/Edit Song. It stores
  *which kind* only (`"chords"` or an `AttachmentKind`) — not a version — because each
  attachment bucket's `selectedVersionId` (set via Add/Edit Song's existing "Use this
  version" action) already persists a default version per kind; `defaultView` just
  decides which bucket (or chords) to open, reusing that existing per-kind default
  rather than duplicating it at the song level.

## Goals

- No `LIVE` badge anywhere in Live Stage's header states.
- Reaching the end of a setlist by swiping/advancing past the last song is a no-op:
  the last song stays on screen, no separate screen or dialog appears.
- Live Stage's bottom chrome is a single one-row control surface (key chips + one
  tools trigger) directly above the tab bar. Add-song/Quick-edit/Annotate, switching
  which view is on screen (Chords/Lyrics or an attachment kind/version), and the
  secondary controls (capo/lyrics-only/zoom, instrument visibility) are all reachable
  from that one "Stage tools" sheet — nothing toolbar- or view-picking-related lives
  in the header or the song-title row anymore.
- Live Stage's base background is `#ffffff` in light mode (matching `--surface`), and
  the Sheet Music/PDF/Photo view no longer changes appearance between Light and Stage
  Dark.
- When a song has more than one attachment kind and/or version, picking which one to
  view is one tap into the Stage tools sheet's view-picker list, not stacked chip rows
  or a separate toggle.
- The dev-preview viewport toggle offers Phone, iPad Air 11″, and iPad Air 13″, sized
  to each device's real logical-point (CSS px) resolution.
- A song can be given a default Live Stage view (Chords/Lyrics, or a specific
  attachment kind) from Add/Edit Song, and Live Stage honors it — a song with no
  default set keeps today's automatic behavior unchanged.

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
- No per-song *default version* field — that's already covered by each attachment
  bucket's existing `selectedVersionId` (see decisions above). `defaultView` only adds
  a per-song default *kind*.
- No migration of existing songs' data — `defaultView` is optional and undefined for
  every song that existed before this change; Live Stage's existing automatic
  chords-vs-sheet/`firstAvailableCategory` logic becomes the fallback for exactly that
  case, not something replaced outright.
- No change to `CATEGORY_PRIORITY` or `firstAvailableCategory` themselves — they
  remain the fallback path, just no longer the *only* path.

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
- The top `.hdr` band keeps exactly the role it already has elsewhere in the app — a
  strip that tints when a setlist is active — with nothing rendered inside it beyond
  that (the `LIVE` badge was the only content it ever held, and that's gone per above).
  It gains no icon buttons; all of Live Stage's contextual actions live in the bottom
  tools sheet instead (see next section).

## Toolbar declutter and Stage tools sheet (`MusicToolbar.tsx`, `LiveStage.tsx`)

- **Bottom bar** (`MusicToolbar.tsx`) becomes one row: the existing `KeyChips`
  transpose control, plus a single trailing trigger button (e.g. a "…"/sliders icon)
  that opens the sheet described below. Unlike today's expand/collapse row, this
  trigger is **always rendered** whenever the toolbar itself renders (i.e. whenever
  `hasChords || hasScore`, `LiveStage.tsx:385`) — Add-song/Quick-edit/Annotate and the
  view picker need a way in even for a song with nothing else to configure, which
  `showSecondRow`'s old chords/instruments-only condition didn't account for.
- **Song-title row** (`LiveStage.tsx:237-299`) drops the Chord/Sheet `view-toggle` and
  the `key-of`/`kind-label` meta block entirely, leaving just title/artist. The
  category-chip row (`LiveStage.tsx:301-317`) and version-chip row
  (`LiveStage.tsx:318-331`) below it are removed too — all three are replaced by the
  sheet's view-picker list below.
- **"Stage tools" sheet**: tapping the trigger opens a `Sheet` (new local
  `stageToolsOpen` state in `LiveStage.tsx`, alongside `partsOpen`; `versionPickerOpen`
  is retired — its job is absorbed into this sheet) with three parts, top to bottom:
  1. **Icon row** — Add-song, Quick-edit, Annotate — reusing the existing `Icon`
     glyphs from `MusicToolbar`'s current icon row (`plus`, `edit`, `annotate`) and
     their existing handlers (`STAGE_OPEN_DRAWER` with `"add-song"`/`"quick-edit"`/
     `"annotate"`), each closing the sheet on tap before the target drawer/mode opens.
  2. **View picker** — one row for "Chords/Lyrics" (shown whenever `hasChords`) plus
     one row per attachment kind the song has (`CATEGORY_PRIORITY.filter((k) =>
     song.attachments[k])`, same source `availableKinds` already uses today). A kind's
     row shows its active version's label when that bucket has more than one version
     (e.g. "PDF · Lead sheet"), tapping into a nested version list the same way the
     old `versionPickerOpen` sheet did; a kind with exactly one version is a plain row.
     Tapping a row sets `stage.view` (via `STAGE_SET_VIEW`) and, for an attachment
     row, `activeKind`/`activeVersionId` together — the same state this sheet
     replaces, just one list instead of a toggle plus two chip rows. The active
     row is checked/highlighted, mirroring `versionPickerOpen`'s existing checkmark
     styling. This row is omitted entirely when there's only one possible view (no
     attachments and always-chords, or vice versa) — nothing to pick between.
  3. **View-specific row** — whatever today's expanded second row held, gated by the
     same `showSecondRow` condition as today (`view === "chords" ? hasChords :
     instruments.length > 1`) so it's omitted when there's nothing to configure — only
     rows 1 and 2 are unconditional (subject to their own per-item conditions above):
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
  `chordsLocked`, `instrumentsLocked`, `onAddSong`, `onQuickEdit`, `onAnnotate`) plus
  whatever the view-picker list needs (`availableKinds`, `activeKind`,
  `activeVersionId`, and setters) — exact prop boundary between `LiveStage.tsx` (which
  already owns `activeKind`/`activeVersionId` state) and `MusicToolbar.tsx` is left to
  the implementation plan.

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

## Persisted default view (`state/types.ts`, `data/db.ts`, `data/songsRepo.ts`, `state/store.ts`, `screens/live-stage/LiveStage.tsx`, `screens/add-edit-song/AddEditSong.tsx`)

- **New field**: `Song.defaultView?: "chords" | AttachmentKind` (`state/types.ts`).
  Undefined means "no preference saved" — every song that exists today implicitly
  starts in this state, so no data migration is needed for existing rows beyond the
  schema change below.
- **Persistence** (`data/db.ts`): additive column, following the same pattern already
  used for `notes`/`annotations_json` (v3, `db.ts:129-138`) rather than the drop-and-
  recreate pattern used for structural changes — this is a single nullable column on
  an existing table with real local data worth preserving. `DB_VERSION` bumps from 4
  to 5, with a new upgrade step: `ALTER TABLE songs ADD COLUMN defaultView TEXT;` (no
  `NOT NULL`/`DEFAULT` — `NULL` is the meaningful "unset" state, read back as
  `undefined`).
- **`data/songsRepo.ts`**: `SongRow` gains `defaultView: string | null`; `rowToSong`
  maps `row.defaultView ?? undefined` to `Song["defaultView"]`;
  `buildInsertStatements`'s column list and `VALUES` gain `defaultView` /
  `s.defaultView ?? null`.
- **`state/store.ts`**: `defaultView(song)` (`store.ts:19-22`, the function that today
  picks `"chords"` vs `"sheet"` for `StageState["view"]`) checks `song.defaultView`
  first:
  - `"chords"` → `"chords"`, but only if `song.chordpro.trim()` is non-empty (a saved
    default that no longer makes sense — e.g. chords were since deleted — falls back
    rather than opening an empty chart).
  - An `AttachmentKind` → `"sheet"`, but only if `song.attachments[kind]` still exists
    (same reasoning — an attachment removed after the default was set falls back
    rather than opening nothing).
  - Unset, or set to something no longer valid → today's existing logic (chords if
    present, else sheet) is the fallback, unchanged.
  This function only decides the chords/sheet split (`StageState["view"]`); it doesn't
  carry the specific attachment kind on its own (see next bullet).
- **`screens/live-stage/LiveStage.tsx`**: the effect that seeds `activeKind`/
  `activeVersionId` on song change (`LiveStage.tsx:43-48`, currently always
  `firstAvailableCategory(attachments)`) checks `song?.defaultView` first: if it's an
  `AttachmentKind` present in `attachments`, that kind is used (with its bucket's own
  `selectedVersionId` via `selectedVersion`, unchanged); otherwise
  `firstAvailableCategory` is the fallback, exactly as today.
- **`screens/add-edit-song/AddEditSong.tsx`**: a new "Default on Live Stage" picker
  near the existing top metadata fields (title/key/artist/tempo/time-signature) — not
  duplicated per-tab. Always includes a leading "Automatic" option (selected when
  `defaultView` is unset) alongside "Chords/Lyrics" when `chordpro` is non-empty, plus
  one row per attachment kind with at least one version — "Automatic" is how a saved
  default gets cleared, setting `defaultView` back to `undefined`, so this is the only
  row always present regardless of how many other options exist. Selecting a row sets
  the draft's `defaultView`; the picker itself doesn't touch version selection (that
  stays exactly the existing per-bucket "Use this version" action within each
  attachment tab). A song with no possible non-automatic view (empty chords, no
  attachments) shows no picker at all, matching how other conditional controls in this
  screen already behave.

## Testing / verification

No automated test framework exists in this repo (per `CLAUDE.md`'s documented
gotcha); `npm run build` (`tsc -b && vite build`) is the correctness bar, plus manual
click-through:

1. `npm run build` is clean (verifies the `Viewport` type/union changes, the new
   `Song.defaultView` field, and the `SongRow` changes all propagate everywhere
   they're referenced, and that removing `stage.ended`/`stage.toolbarExpanded`/
   `versionPickerOpen` doesn't leave a dangling reference).
2. Load a song with no setlist: confirm no `LIVE` badge, no icons in the header (just
   the tint when a setlist is active), the song-title row shows only title/artist, and
   the bottom bar's trailing tools trigger is always present whenever the toolbar
   renders at all.
3. Start a setlist, advance to the last song, try to advance again (swipe/whatever
   today's forward-advance affordance is): confirm the last song stays on screen with
   no dead-end screen.
4. Tap the tools trigger on a song with chords and an attached score with multiple
   versions: confirm the sheet shows, top to bottom, working Add-song/Quick-
   edit/Annotate icons (each closes the sheet and opens its target), a view-picker
   list with a Chords/Lyrics row and a row per attachment kind (the multi-version kind
   showing its active version's label and opening a nested version list), and — in
   chord view — Capo/Lyrics-only/Zoom below that, matching today's `chordsLocked`
   disabled/message state when annotations exist. Picking a different kind/version
   from the list updates the displayed content correctly.
5. Switch to Sheet view (via the view-picker list) on a song with an attached score:
   confirm the icon row and view-picker list are unchanged and the row below them now
   shows instrument chips instead, matching `instrumentsLocked` behavior. On a song
   with only one instrument part, confirm the icon row and view picker still appear
   but the instrument-chip row doesn't.
6. Compare Live Stage's background in Light mode against a sheet-music/PDF preview —
   confirm they're now the same white, and confirm Stage Dark no longer changes the
   Sheet Music/PDF/Photo view's background (only the header/toolbar/tab bar and any
   chords/lyrics view do).
7. In the dev-preview toggle bar, confirm "iPad Air 11″" and "iPad Air 13″" render
   the device frame at the correct portrait aspect ratio, and that the key-row
   (transpose chips) fills the row edge-to-edge on both, same as today's single
   "Tablet" option did.
8. In Add/Edit Song, set a song's default to a specific attachment kind, save, then
   load that song onto Live Stage: confirm it opens directly to that kind (and its
   bucket's default version) instead of the old automatic guess. Clear the default
   (or check a song that never had one) and confirm today's automatic behavior is
   unchanged.
9. Delete or replace a song's only attachment of its saved default kind (via Add/Edit
   Song), then load it onto Live Stage: confirm it falls back to the automatic
   behavior instead of failing to open a view that no longer exists.
10. `npm run cap:android` (or a fresh `npm run dev` browser session with cleared site
    data): confirm the DB migration to version 5 runs cleanly on top of existing
    persisted data — no init error in the console, and previously-saved songs load
    with `defaultView` simply absent.
