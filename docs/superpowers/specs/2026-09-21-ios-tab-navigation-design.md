# iOS tab-bar navigation, FAB removal, and native shell fixes

## Context

A UI/UX design review against modern iOS Human Interface Guidelines conventions
(prompted by CLAUDE.md's newly stated intent — OS-agnostic implementation, but
iOS-centric design, since the initial target users are iOS users migrating from
OnSong) surfaced three high-priority structural findings, all addressed together here
since they were raised from the same review and touch overlapping files
(`App.tsx`, `theme.css`):

1. **All primary navigation is buried in a hamburger side-drawer.**
   `src/screens/live-stage/MenuDrawer.tsx` is the *only* way to reach Library, Setlists,
   Tuner, or Settings — there is no persistent tab bar anywhere in the app. A hamburger
   drawer is a pattern HIG doesn't really have; it reads as ported from Android/Material,
   and it fights the tab-bar muscle memory iOS users bring from apps like OnSong.
2. **Floating action buttons (FABs) are used for primary actions** — Library's
   add-song/import FAB stack (`Library.tsx`, `.fab-stack`) and Live Stage's
   Add-song/Quick-edit/Annotate FAB stack (`LiveStage.tsx`). Circular floating buttons
   are Material Design's signature, not an iOS convention.
3. **The native shell has two leftover mockup artifacts that will visibly break on a
   real device**: `App.tsx`'s `Capacitor.isNativePlatform()` branch still renders the
   hardcoded `<StatusBar/>` component (always "9:41", fake battery/signal glyphs) *on
   top of* the real OS status bar, and no code anywhere uses
   `env(safe-area-inset-*)`/`viewport-fit=cover`, so header/toolbar/tab-bar content will
   likely collide with the notch/Dynamic Island/home indicator on a real iPhone. Only
   Android has actually been built and run so far (per CLAUDE.md), so this hasn't been
   caught yet.

Decisions made during brainstorming (see chat history for the full discussion):

- Bundle all three findings into one spec rather than splitting them, since they share
  files and a single implementation pass.
- Live Stage becomes a tab itself (not a separate "now playing"-bar pattern layered over
  the other four tabs) — simpler, no new UI concept to build.
- The hamburger drawer is removed entirely, including its static "Sunday Team / Worship
  leader" profile block — there's no account system backing that data, so displaying it
  was misleading; nothing else in the app depends on it being shown.
- Library's FAB stack becomes a single nav-bar trailing `+` that opens a `Sheet` with
  "New song" / "Import a chart".
- Live Stage's FAB stack folds into its existing expandable bottom toolbar rather than
  moving to the header, since those actions (Quick-edit, Annotate, Add-song) are
  contextual to the current song and the toolbar is already Live Stage's control
  surface.
- The tab bar uses **per-tab back-stacks**, matching `UITabBarController`'s real iOS
  behavior (switching tabs preserves each tab's drill-down state) rather than resetting
  to each tab's root screen on every switch.
- Tablet gets the same tab bar as phone — no iPad sidebar idiom in this pass.
- Safe-area/status-bar work is done properly (new `@capacitor/status-bar` dependency,
  real `env()` insets), not just deleting the fake bar and leaving status-bar styling
  unaddressed.

## Goals

- Library, Setlists, Tuner, Settings, and Live Stage are all reachable from a persistent
  bottom tab bar, with no destination hidden behind a drawer.
- Switching tabs never discards in-progress navigation state in the tab being left.
- No floating circular action buttons remain anywhere in the app.
- Live Stage's existing idle auto-hide immersive behavior (6s → chrome hidden) is
  unchanged in spirit — chrome (including the tab bar) still disappears for stage
  reading and reappears on tap.
- A native build (Android today, iOS once buildable) never renders a fake in-app status
  bar; the real OS status bar is used, styled appropriately for the active theme.
- Native content respects real safe-area insets instead of fixed pixel assumptions.

## Out of scope

Called out explicitly so none of these are assumed to be covered by this pass:

- Edge-swipe-to-go-back gesture.
- Swipe-to-delete/favorite list-row actions.
- A tablet/iPad sidebar navigation idiom (HIG's preferred large-screen pattern) — the
  tab bar is reused as-is on the tablet viewport; a sidebar redesign is a separate,
  larger effort if iPad becomes a real target rather than a dev-preview aspect ratio.
- Bottom-sheet drag-to-dismiss (the `Sheet` component's grip stays decorative-only).
- Dynamic Type / OS-level text scaling beyond the existing Appearance text-size slider.
- Any change to the `Sheet`/`Dialog`/`SideDrawer` primitives themselves — `SideDrawer`
  keeps its two existing callers (`AddToSetDrawer.tsx`, `AddSongDrawer.tsx`), which are
  unrelated to top-level navigation and untouched by this spec.
- iOS on-device verification — no Mac/Xcode is available; see "Testing / verification."

## Navigator architecture (`src/navigation/Navigator.tsx`)

Today `Navigator.tsx` (57 lines) holds one flat `stack: Frame[]`, seeded with
`[{screen:"splash"}]`, with `push`/`pop`/`replace`/`reset` operating on that single
array.

This becomes a stack **per tab**:

```ts
export type TabName = "live-stage" | "library" | "setlists" | "tuner" | "settings";

const TAB_ROOT: Record<TabName, ScreenName> = {
  "live-stage": "live-stage",
  library: "library",
  setlists: "setlists",
  tuner: "tuner",
  settings: "settings",
};

interface NavigatorState {
  booted: boolean;               // false = still on splash
  activeTab: TabName;
  stacks: Record<TabName, Frame[]>;
}
```

- `NavigatorProvider` seeds `booted: false` and `stacks` with each tab's root frame
  (`[{ screen: TAB_ROOT[tab] }]`). While `booted` is false, `App.tsx` renders `Splash`
  full-screen with no tab bar, exactly as today. Splash's existing auto-advance
  (~650ms) now sets `booted: true` instead of pushing `"live-stage"` onto a shared
  stack — it lands on whichever tab is already the default (`live-stage`).
- `push(screen, params)` / `replace(screen, params)` / `pop()` are unchanged in
  signature and unchanged at every existing call site — they now implicitly operate on
  `stacks[activeTab]`. No screen's navigation code needs to change to account for tabs.
- New: `switchTab(tab: TabName)` sets `activeTab`. It never mutates any stack — this is
  the entire mechanism that gives each tab its own preserved drill-down state.
- `reset()` keeps its current meaning (collapse the *active* tab's stack back to its
  root) — used today by flows like finishing a setlist or resetting app data, and that
  meaning is unaffected by tabs existing.
- `nav.top` (today: the last frame of the single stack) becomes the last frame of
  `stacks[activeTab]`.

### Modal-style screens hide the tab bar

Add/Edit Song and Import already look and behave like modal form sheets — a bespoke
Cancel/Title/Save header (`AddEditSong.tsx`), not the shared back-chevron `Header`. Add
a `MODAL_SCREENS: Set<ScreenName>` constant (`add-edit-song`, `import-song`) in
`Navigator.tsx`, and `App.tsx` hides the tab bar whenever
`MODAL_SCREENS.has(stacks[activeTab].at(-1).screen)` — matching iOS's convention that
modally-presented view controllers cover the tab bar. Every other pushed screen
(`setlist-detail`, `appearance`, `export`) keeps the tab bar visible, matching normal
iOS push behavior within a tab.

This is a boolean derived from existing navigation state, not a new flag threaded
through individual screens.

## Tab bar (`src/components/TabBar.tsx`, new file)

A new shared component, sibling to `ScreenHost` in `App.tsx` (not per-screen):

- Five items, fixed order: Live Stage, Library, Setlists, Tuner, Settings — matching
  CLAUDE.md's stated screen-map priority order.
- Icons reuse the existing hand-drawn set in `Icon.tsx` (`music` for Library, `list` for
  Setlists, `tuner` for Tuner, `settings` for Settings — all already used today inside
  `MenuDrawer`'s rows). Live Stage needs a new icon name added to `IconName`
  (`IconName` union, `Icon.tsx:1-24`) since it's never had one before — a simple glyph
  (e.g. a stylized note or "now playing" mark) consistent with the existing 24×24,
  round-cap/join, `strokeWidth=1.75` outline style.
- Active tab: `--acc` color on both icon and label. Inactive: muted `--fg`/secondary
  color. No filled/outline icon-pair swap (the existing icon set doesn't have one, and
  adding one is out of scope).
- Height reserves `env(safe-area-inset-bottom)` (see "Safe-area and native status bar"
  below) plus a fixed content height for the icon+label row.
- Visibility: hidden when (a) the active tab is Live Stage and `stage.chromeHidden` is
  true (ties into Live Stage's existing idle-hide, below), or (b) the active tab's top
  frame is a modal screen (`add-edit-song`/`import-song`). Visible in every other case.
- Tapping an already-active tab is a no-op in this pass (no "tap Library again to pop to
  root" behavior) — not called for by the review, and adding it would reintroduce a
  reset-on-tap wrinkle to the per-tab-stack model that isn't otherwise needed.

## Screen changes

### `App.tsx`

- Native branch (`Capacitor.isNativePlatform()`): stops rendering `<StatusBar/>`
  entirely. Renders `TabBar` below `ScreenHost` (or above, per final CSS stacking —
  functionally: `ScreenHost` fills the remaining height, `TabBar` docks to the bottom)
  when `booted` and the visibility rule above allows it.
- Dev-preview branch (non-native mockup harness): **unchanged** — keeps rendering
  `<StatusBar/>` and `<DeviceNotch/>` exactly as today, since that's a deliberate
  frame-mockup affordance for previewing device chrome inside a desktop browser tab,
  not a native-shell concern this spec touches. It also gains `TabBar` in the same
  position as the native branch, so the dev-preview accurately reflects the real app
  structure.
- `ScreenHost`'s `switch` is unchanged — it still renders whatever `nav.top.screen` is;
  it doesn't need to know about tabs at all, since `nav.top` already resolves through
  the active tab's stack.

### `src/screens/live-stage/MenuDrawer.tsx` — deleted

Along with its trigger (the `menu` icon `hdr-btn` in Live Stage's header states,
`LiveStage.tsx` lines ~90-92, 121-123, 225-227) and the `setMenuOpen` state driving it.
`SideDrawer` (in `Overlays.tsx`) is **not** removed or otherwise touched — it also backs
`AddToSetDrawer.tsx` and `AddSongDrawer.tsx`, both unrelated to top-level navigation and
both out of scope for this spec, so the primitive stays exactly as-is with two remaining
callers after `MenuDrawer` is deleted.

### Live Stage (`src/screens/live-stage/LiveStage.tsx`, `MusicToolbar.tsx`)

- The idle-hide effect (`resetIdle`, `IDLE_MS = 6000`) is unchanged in *mechanism* — it
  still dispatches `STAGE_SET_CHROME_HIDDEN` after 6s idle and clears it on any tap. The
  only change is that `TabBar`'s visibility (in `App.tsx`) now also reads
  `stage.chromeHidden` while Live Stage is the active tab, so it hides/reappears in
  lockstep with Live Stage's own header/toolbar rather than needing its own idle timer.
- The FAB stack (`.fab-stack`, `LiveStage.tsx` lines ~403-415: Add-song, Quick-edit,
  Annotate) is removed. Its three actions move into `MusicToolbar.tsx`'s existing
  expanded row (the same row that today holds Capo/Lyrics-only/Zoom in chord view, or
  instrument chips in sheet view) as additional icon-button entries. Exact
  layout/grouping within that row (e.g. a new sub-row vs. appending to the existing one)
  is left to the implementation plan, since it depends on how crowded that row is once
  built — the requirement here is one bottom control surface for Live Stage, not two.
- No change to the chart-swipe or pinch-zoom gesture handling — out of scope.

### Library (`src/screens/library/Library.tsx`)

- The `.fab-stack` (primary add-song FAB + import mini-FAB, lines ~276-285) is removed.
- `Header`'s `right` slot (already used for the "Select"/"Cancel" action, lines ~85-89)
  gains a `+` icon button, shown whenever not in select mode. Tapping it opens a new
  top-level `Sheet` with two rows: "New song" (→ today's `fab` behavior,
  `nav.push("add-edit-song")`) and "Import a chart". Tapping "Import a chart" closes
  this sheet and opens the **existing** `importSheetOpen` sheet unchanged (lines
  ~374-401: "Import a PDF" / "Import a photo" / "Import MusicXML", each already calling
  `nav.push("import-song", { method })`) — today's mini-FAB (`fab-mini`, line 281) is the
  only thing being replaced; the sheet it opens is reused as-is, just reached one level
  deeper than before.
- No change to search, filters, multi-select, or the row "•••" sheet.

### Settings, Setlists, Tuner

No structural changes beyond gaining the tab bar as a sibling and losing their
drawer-only reachability. Setlists' own trailing "•••" header action, Tuner's
permission-gate sheet, and Settings' grouped list are all unaffected.

## Safe-area and native status bar

- **New dependency:** `@capacitor/status-bar`, added alongside the existing
  `@capacitor/core`/`@capacitor/android`/`@capacitor/ios` set in `package.json`.
- On native boot (`main.tsx` or `App.tsx`'s native branch, whichever already owns
  platform-conditional setup), call `StatusBar.setStyle({ style: Style.Light })` for
  Stage Dark and `Style.Dark` for Light theme (Capacitor's naming is inverted from
  intuition: `Style.Light` = light-colored *content*, for use on dark backgrounds) —
  driven off the same `state.settings.theme` value that already drives `data-theme` at
  the root, so it updates whenever the person changes theme.
- `index.html`'s viewport meta tag gains `viewport-fit=cover`.
- `theme.css` adds `env(safe-area-inset-top)` padding to the native container's header
  area and `env(safe-area-inset-bottom)` padding to `TabBar` (and to Live Stage's bottom
  toolbar when the tab bar is hidden during idle). This is scoped to `.device--native`
  only — the dev-preview `.device` frame keeps its existing fixed `--status-h` values,
  since it's simulating a fixed device frame size, not running behind a real notch.

## Testing / verification

No automated test framework exists in this repo (per CLAUDE.md's documented gotcha);
`npm run build` (`tsc -b && vite build`) is the correctness bar, plus manual
click-through per this repo's established practice:

1. `npm run build` is clean (verifies the `Navigator.tsx` restructure and every
   `ScreenName`/`Frame` reference still type-checks).
2. In `npm run dev`: drill two levels deep into Setlists (a setlist → Set details
   sheet), switch to the Tuner tab, switch back to Setlists — confirm you land exactly
   where you left off, not back at the Setlists root.
3. Confirm Live Stage's idle-hide (wait 6s with no interaction) hides the tab bar along
   with its own header/toolbar, and tapping the screen brings both back together.
4. Confirm opening Add/Edit Song or Import (from any tab) hides the tab bar, and
   returning from either (Save/Cancel, or the import flow's completion) restores it.
5. From Library, confirm the new header `+` opens the New-song/Import-a-chart sheet and
   both destinations still work end-to-end.
6. From Live Stage, confirm Quick-edit, Annotate, and Add-song (now inside
   `MusicToolbar`'s expanded row) still perform the same actions they did as FABs.
7. Confirm `MenuDrawer` is fully gone — no lingering hamburger icon — and that
   `AddToSetDrawer`/`AddSongDrawer` (the other two `SideDrawer` callers) still work
   unaffected.
8. `npm run cap:android`: confirm the real Android status bar renders (no fake "9:41"
   bar drawn inside the app), and safe-area padding doesn't introduce unwanted gaps or
   overlaps on a real device/emulator.
9. iOS on-device verification is **not** part of this pass's testing — no Mac/Xcode is
   available. This is a known, stated gap, not an oversight; revisit once iOS hardware
   or Xcode access exists.
