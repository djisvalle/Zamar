# iOS Tab-Bar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Zamar's hamburger-drawer + floating-action-button navigation with an iOS-conventional bottom tab bar (per-tab back-stacks), and fix the two leftover native-shell mockup artifacts (fake in-app status bar, missing safe-area insets) flagged in the same design review.

**Architecture:** `Navigator.tsx` changes from one flat `Frame[]` stack to a stack per tab (`live-stage` / `library` / `setlists` / `tuner` / `settings`), with a new `switchTab`/`resetTab` API that preserves each tab's drill-down state when switching, matching `UITabBarController`'s real iOS behavior. A new `TabBar` component renders alongside the existing `ScreenHost`. The hamburger drawer (`MenuDrawer`) and both FAB stacks (Library, Live Stage) are deleted; their actions move to a header trailing action (Library) and into the existing `MusicToolbar` (Live Stage). Native-shell work (status bar, safe-area) is a separate, final task since it touches different files (`package.json`, `index.html`, native-only CSS) and has its own verification path (`npm run cap:android`).

**Tech Stack:** React 18 + TypeScript, Capacitor 8 (`@capacitor/status-bar` added by this plan), plain CSS with custom properties (`src/theme.css`) — no new UI/state libraries.

**Spec:** `docs/superpowers/specs/2026-09-21-ios-tab-navigation-design.md`

## Global Constraints

- **No lint/test tooling exists in this repo.** `npm run build` (`tsc -b && vite build`) is the correctness bar for every task. There is no automated test runner, so every task's "verification" is (a) a clean build and (b) explicit manual click-through steps in `npm run dev` — this plan does not invent a test framework that doesn't exist.
- **Never add Claude/Anthropic as a commit co-author or code-comment reference** — every commit message and comment in this plan already complies; keep it that way in any adjustments.
- **Commit messages describe the change and why, no `fix:`/`feat:` conventional-commit prefixes.**
- **Preserve existing comments that are still correct** — several files below have comments explaining non-obvious behavior (e.g. `LiveStage.tsx`'s idle-hide effect, `main.tsx`'s first-run detection); do not delete or rewrite them unless the surrounding code they describe is what's changing.
- Only Android has been built and run to date; iOS on-device verification is out of scope for this plan (no Mac/Xcode available) — Task 4's native verification uses `npm run cap:android`.

---

### Task 1: Per-tab Navigator core + boot flag

**Files:**
- Modify: `src/navigation/Navigator.tsx` (full rewrite)
- Modify: `src/screens/onboarding/Splash.tsx`
- Modify: `src/App.tsx`
- Modify: `src/screens/library/Library.tsx:65`
- Modify: `src/screens/setlists/Setlists.tsx:129`
- Modify: `src/screens/setlists/SetlistDetail.tsx:45`
- Modify: `src/screens/live-stage/LiveStage.tsx:137`

**Interfaces:**
- Produces: `useNavigator()` returning `{ booted, activeTab, stack, top, canPop, push, pop, replace, reset, switchTab, resetTab, finishBoot }`; `TabName = "live-stage" | "library" | "setlists" | "tuner" | "settings"`; `MODAL_SCREENS: Set<ScreenName>` (used by Task 2). `ScreenName` no longer includes `"splash"`.
- Consumes: nothing new — this task only touches navigation plumbing and its existing call sites.

This task is purely internal: nothing in the app is visibly different afterward (no tab bar yet — that's Task 2). It exists as its own task because it's the foundation everything else builds on, and it's independently reviewable: does the app still behave exactly as it does today, with the Navigator's internals now correctly modeling "one stack per tab" instead of one global stack?

- [ ] **Step 1: Rewrite `src/navigation/Navigator.tsx`**

Replace the entire file with:

```tsx
import { createContext, useContext, useMemo, useState, type ReactNode, createElement } from "react";

export type ScreenName =
  | "live-stage"
  | "library"
  | "setlists"
  | "setlist-detail"
  | "add-edit-song"
  | "import-song"
  | "tuner"
  | "settings"
  | "appearance"
  | "export";

export type TabName = "live-stage" | "library" | "setlists" | "tuner" | "settings";

export interface Frame {
  screen: ScreenName;
  params?: Record<string, unknown>;
}

/** Screens presented as modal form sheets (their own Cancel/Title/Save header,
 * not the shared back-chevron Header) — the tab bar hides while one of these
 * is on top of the active tab's stack, matching iOS's convention that
 * modally-presented view controllers cover the tab bar. */
export const MODAL_SCREENS = new Set<ScreenName>(["add-edit-song", "import-song"]);

const TAB_NAMES: TabName[] = ["live-stage", "library", "setlists", "tuner", "settings"];

const TAB_ROOT: Record<TabName, ScreenName> = {
  "live-stage": "live-stage",
  library: "library",
  setlists: "setlists",
  tuner: "tuner",
  settings: "settings",
};

function initialStacks(): Record<TabName, Frame[]> {
  const stacks = {} as Record<TabName, Frame[]>;
  for (const tab of TAB_NAMES) stacks[tab] = [{ screen: TAB_ROOT[tab] }];
  return stacks;
}

interface NavigatorValue {
  /** False until Splash's boot delay finishes; App.tsx renders Splash
   * full-screen (no tabs, no tab bar) while this is false. */
  booted: boolean;
  activeTab: TabName;
  /** The active tab's own back-stack. */
  stack: Frame[];
  top: Frame;
  canPop: boolean;
  push: (screen: ScreenName, params?: Record<string, unknown>) => void;
  pop: () => void;
  replace: (screen: ScreenName, params?: Record<string, unknown>) => void;
  /** Collapses the ACTIVE tab's stack back to a single frame. Does not
   * change which tab is active or touch any other tab's stack. */
  reset: (screen: ScreenName, params?: Record<string, unknown>) => void;
  /** Switches which tab is active without touching any stack — this is what
   * gives each tab its own preserved drill-down state across switches. */
  switchTab: (tab: TabName) => void;
  /** Switches to `tab` AND collapses that tab's stack back to its root
   * screen. Used by "load a song and jump to Live Stage" actions (Library,
   * Setlists, Setlist Detail), which must always land on a clean Live Stage
   * root rather than whatever happened to be pushed onto that tab's stack
   * the last time it was visited. */
  resetTab: (tab: TabName) => void;
  /** Called once by Splash when its boot delay finishes. */
  finishBoot: () => void;
}

interface InternalState {
  booted: boolean;
  activeTab: TabName;
  stacks: Record<TabName, Frame[]>;
}

const NavigatorContext = createContext<NavigatorValue | null>(null);

export function NavigatorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>({
    booted: false,
    activeTab: "live-stage",
    stacks: initialStacks(),
  });

  const value = useMemo<NavigatorValue>(() => {
    const stack = state.stacks[state.activeTab];
    return {
      booted: state.booted,
      activeTab: state.activeTab,
      stack,
      top: stack[stack.length - 1],
      canPop: stack.length > 1,
      push: (screen, params) =>
        setState((s) => ({
          ...s,
          stacks: { ...s.stacks, [s.activeTab]: [...s.stacks[s.activeTab], { screen, params }] },
        })),
      pop: () =>
        setState((s) => {
          const current = s.stacks[s.activeTab];
          if (current.length <= 1) return s;
          return { ...s, stacks: { ...s.stacks, [s.activeTab]: current.slice(0, -1) } };
        }),
      replace: (screen, params) =>
        setState((s) => ({
          ...s,
          stacks: { ...s.stacks, [s.activeTab]: [...s.stacks[s.activeTab].slice(0, -1), { screen, params }] },
        })),
      reset: (screen, params) =>
        setState((s) => ({ ...s, stacks: { ...s.stacks, [s.activeTab]: [{ screen, params }] } })),
      switchTab: (tab) => setState((s) => ({ ...s, activeTab: tab })),
      resetTab: (tab) =>
        setState((s) => ({
          ...s,
          activeTab: tab,
          stacks: { ...s.stacks, [tab]: [{ screen: TAB_ROOT[tab] }] },
        })),
      finishBoot: () => setState((s) => (s.booted ? s : { ...s, booted: true })),
    };
  }, [state]);

  return createElement(NavigatorContext.Provider, { value }, children);
}

export function useNavigator(): NavigatorValue {
  const ctx = useContext(NavigatorContext);
  if (!ctx) throw new Error("useNavigator must be used within NavigatorProvider");
  return ctx;
}
```

- [ ] **Step 2: Update `Splash` to call `finishBoot()` instead of navigating**

In `src/screens/onboarding/Splash.tsx`, change the `useEffect`:

```tsx
useEffect(() => {
  const t = setTimeout(() => {
    nav.finishBoot();
  }, 650);
  return () => clearTimeout(t);
}, []);
```

(This replaces the previous `nav.replace("live-stage")` call. No other change to `Splash.tsx`.)

- [ ] **Step 3: Gate `App.tsx` on `nav.booted` instead of a `"splash"` screen case**

In `src/App.tsx`:

1. Remove the `case "splash": return <Splash />;` branch from `ScreenHost`'s switch entirely (it's now unreachable — `"splash"` no longer exists on `ScreenName`, so leaving the case in would fail to type-check).
2. Add `const nav = useNavigator();` at the top of `App()` (import `useNavigator` from `./navigation/Navigator`).
3. In both the native and dev-preview branches, render `<Splash />` in place of `<ScreenHost />` whenever `!nav.booted`:

```tsx
if (Capacitor.isNativePlatform()) {
  return (
    <div
      className="device device--native"
      data-theme={state.settings.theme}
      style={{ "--status-h": vp.statusH } as React.CSSProperties}
    >
      <StatusBar />
      {nav.booted ? <ScreenHost /> : <Splash />}
    </div>
  );
}
```

Apply the equivalent `{nav.booted ? <ScreenHost /> : <Splash />}` swap inside the dev-preview branch's `.device` div (in place of its current unconditional `<ScreenHost />`), leaving everything else in that branch (the Appearance/Viewport toggle bar, `DeviceNotch`) unchanged.

- [ ] **Step 4: Fix the three "load a song, jump to a clean Live Stage" call sites**

These all currently call `nav.reset("live-stage")`, which under the new per-tab model would only reset whichever tab happens to be active — not necessarily Live Stage. Change each to `nav.resetTab("live-stage")`:

In `src/screens/library/Library.tsx`, `openSong`:
```tsx
const openSong = (id: string) => {
  dispatch({ type: "STAGE_LOAD", songId: id });
  nav.resetTab("live-stage");
};
```

In `src/screens/setlists/Setlists.tsx` (the "Start Set" button handler, ~line 129):
```tsx
if (ids.length) {
  dispatch({ type: "STAGE_LOAD", songId: ids[0], setlistId: sl.id, setlistIndex: 0 });
  nav.resetTab("live-stage");
}
```

In `src/screens/setlists/SetlistDetail.tsx`, `startSong`:
```tsx
const startSong = () => {
  if (songEntries.length === 0) return;
  dispatch({ type: "STAGE_LOAD", songId: songEntries[0].song!.id, setlistId: setlist.id, setlistIndex: 0 });
  nav.resetTab("live-stage");
};
```

- [ ] **Step 5: Fix Live Stage's cross-tab-root push**

In `src/screens/live-stage/LiveStage.tsx`, the empty-state "Browse library" button currently does `nav.push("library")`. Since `"library"` is another tab's root screen, pushing it onto the live-stage tab's stack would be wrong (it should switch to the Library tab, not nest a second copy of Library under Live Stage). Change it to:

```tsx
<button className="btn btn-primary" onClick={() => nav.switchTab("library")}>
  Browse library
</button>
```

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: clean (no TypeScript errors — this confirms every remaining `ScreenName`/`Frame`/navigator call site still type-checks against the new shape).

- [ ] **Step 7: Manual click-through**

In `npm run dev`:
1. Reload the app — confirm Splash still shows briefly, then auto-advances into Live Stage (confirms `finishBoot` wiring).
2. From Live Stage's empty state, tap "Browse library" — confirm Library loads correctly.
3. From Library, tap any song row — confirm it loads onto Live Stage cleanly.
4. From Setlists, tap "Start Set" on the first upcoming setlist card — confirm it jumps cleanly to Live Stage.
5. Open that same setlist's detail screen and use its "Start Set" bottom-bar button — confirm the same clean jump.
6. Confirm the hamburger menu (still present — untouched until Task 2) still opens from Live Stage and still reaches Library/Setlists/Tuner/Settings, and each screen's back-chevron still pops correctly.

- [ ] **Step 8: Commit**

```bash
git add src/navigation/Navigator.tsx src/screens/onboarding/Splash.tsx src/App.tsx src/screens/library/Library.tsx src/screens/setlists/Setlists.tsx src/screens/setlists/SetlistDetail.tsx src/screens/live-stage/LiveStage.tsx
git commit -m "$(cat <<'EOF'
Restructure Navigator into one back-stack per tab

Lays the groundwork for tab-bar navigation: each tab now keeps its own
push/pop history instead of sharing one global stack, matching how
UITabBarController preserves a tab's drill-down state when you switch
away and back. No visible behavior change yet — the tab bar itself
lands in the next commit.
EOF
)"
```

---

### Task 2: `TabBar` replaces the hamburger drawer

**Files:**
- Modify: `src/components/Icon.tsx`
- Create: `src/components/TabBar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/theme.css`
- Modify: `src/components/Header.tsx`
- Modify: `src/screens/library/Library.tsx:78`
- Modify: `src/screens/settings/Settings.tsx:16`
- Modify: `src/screens/setlists/Setlists.tsx:51`
- Modify: `src/screens/tuner/Tuner.tsx` (3 occurrences)
- Delete: `src/screens/live-stage/MenuDrawer.tsx`
- Modify: `src/screens/live-stage/LiveStage.tsx` (remove drawer trigger, 3 occurrences)

**Interfaces:**
- Consumes: `useNavigator()`'s `activeTab`, `switchTab`, `booted`, `top`, `MODAL_SCREENS` (from Task 1); `useStore()`'s `state.stage.chromeHidden`.
- Produces: `<TabBar />` (no props — reads navigator/store context directly), rendered as a sibling of `<ScreenHost />` in `App.tsx`.

This is one task, not split further, because a working tab bar and a still-present hamburger drawer would actively conflict: `MenuDrawer` pushes screens onto whatever tab happens to be active, so leaving it in place after `TabBar` exists would let a screen render while the tab bar highlights the wrong tab. The drawer's removal and the tab bar's introduction have to land together for the app to be correct at every point in this task.

- [ ] **Step 1: Add a "Live Stage" tab icon**

In `src/components/Icon.tsx`, add `"home"` to the `IconName` union (after `"grip"` is fine, alphabetical order isn't enforced elsewhere in the file) and add its path to `ICON_PATHS`, matching the set's existing Feather-style outline convention:

```tsx
export type IconName =
  | "menu"
  | "chevron-left"
  | "chevron-right"
  | "close"
  | "search"
  | "star"
  | "check"
  | "more"
  | "import"
  | "share"
  | "edit"
  | "annotate"
  | "music"
  | "list"
  | "tuner"
  | "settings"
  | "note"
  | "grip"
  | "home"
  | "play"
  | "stop"
  | "eraser"
  | "square"
  | "plus";
```

```tsx
home: (
  <>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
  </>
),
```

- [ ] **Step 2: Create `src/components/TabBar.tsx`**

```tsx
import { useStore } from "../state/store";
import { useNavigator, MODAL_SCREENS, type TabName } from "../navigation/Navigator";
import { Icon, type IconName } from "./Icon";

const TABS: { tab: TabName; label: string; icon: IconName }[] = [
  { tab: "live-stage", label: "Live Stage", icon: "home" },
  { tab: "library", label: "Library", icon: "music" },
  { tab: "setlists", label: "Setlists", icon: "list" },
  { tab: "tuner", label: "Tuner", icon: "tuner" },
  { tab: "settings", label: "Settings", icon: "settings" },
];

export function TabBar() {
  const { state } = useStore();
  const nav = useNavigator();

  if (!nav.booted) return null;
  if (MODAL_SCREENS.has(nav.top.screen)) return null;
  if (nav.activeTab === "live-stage" && state.stage.chromeHidden) return null;

  return (
    <div className="tab-bar">
      {TABS.map(({ tab, label, icon }) => (
        <button
          key={tab}
          className={"tab-bar-item" + (nav.activeTab === tab ? " active" : "")}
          onClick={() => nav.switchTab(tab)}
          aria-label={label}
          aria-current={nav.activeTab === tab ? "page" : undefined}
        >
          <Icon name={icon} size={22} strokeWidth={1.75} />
          <span className="tab-bar-label">{label}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add tab bar styles to `src/theme.css`**

Append after the `.fab-mini` rule (end of the "fabs" section, before "cards / rows"):

```css
/* ---- bottom tab bar ---- */
.tab-bar {
  flex: none;
  display: flex;
  border-top: 1px solid var(--line);
  background: var(--surface);
  /* Harmless everywhere (resolves to 0 with no safe area, e.g. the
     dev-preview frame or a browser tab) — not gated to .device--native
     the way the header's top inset is, since there's no fixed mock value
     to conflict with here. */
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.tab-bar-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 7px 0 6px;
  border: none;
  background: none;
  color: var(--mut);
}
.tab-bar-item.active {
  color: var(--acc);
}
.tab-bar-label {
  font-size: 10px;
  font-weight: 600;
}
```

- [ ] **Step 4: Wire `TabBar` into `App.tsx`**

Import `TabBar` from `./components/TabBar`. In both the native and dev-preview branches, render `<TabBar />` as a sibling immediately after `<ScreenHost />` (only meaningful once `nav.booted`, which `TabBar` itself already checks internally — no need to duplicate that condition in `App.tsx`):

```tsx
{nav.booted ? <ScreenHost /> : <Splash />}
<TabBar />
```

(`.device`'s existing `display:flex; flex-direction:column` means `.screen` — which is `flex:1` — shrinks to make room for `.tab-bar` — which is `flex:none` — automatically; no extra layout wiring needed.)

- [ ] **Step 5: Hide `Header`'s back button at tab roots**

In `src/components/Header.tsx`, only render the back button when there's actually somewhere to go back to (an explicit `onBack` override, or `nav.canPop`). Replace the file's body with:

```tsx
import type { ReactNode } from "react";
import { useNavigator } from "../navigation/Navigator";
import { Icon } from "./Icon";

export function Header({
  title,
  tinted,
  right,
  onBack,
  large,
}: {
  title: string;
  tinted?: boolean;
  right?: ReactNode;
  onBack?: () => void;
  /** iOS-style Large Title: the small bar carries only the back/action
   * controls, and `title` renders as a big bold line beneath it. */
  large?: boolean;
}) {
  const nav = useNavigator();
  const showBack = Boolean(onBack) || nav.canPop;
  const backButton = showBack ? (
    <button className="hdr-btn" onClick={onBack ?? nav.pop} aria-label="Back">
      <Icon name="chevron-left" size={20} strokeWidth={2} />
    </button>
  ) : (
    // Reserves the same box the back button would occupy, so tab-root
    // screens (no back target) don't shift title/action alignment.
    <div className="hdr-btn" aria-hidden="true" />
  );

  if (large) {
    return (
      <div className={"hdr-large-wrap" + (tinted ? " tinted" : "")}>
        <div className="hdr">
          {backButton}
          <div className="flex-1" />
          {right}
        </div>
        <div className="hdr-large-title">{title}</div>
      </div>
    );
  }
  return (
    <div className={"hdr" + (tinted ? " tinted" : "")}>
      {backButton}
      <div className="hdr-title">{title}</div>
      {right}
    </div>
  );
}
```

- [ ] **Step 6: Stop forcing the back button on tab-root screens**

Remove the now-redundant (and, after Step 5, actively wrong — it would force the button to show) `onBack={nav.pop}` prop from the three tab-root screens that pass it explicitly:

- `src/screens/library/Library.tsx:78` — delete the `onBack={nav.pop}` line from the `<Header>` call.
- `src/screens/settings/Settings.tsx:16` — change `<Header title="Settings" large onBack={nav.pop} />` to `<Header title="Settings" large />`.
- `src/screens/setlists/Setlists.tsx:51` — remove `onBack={nav.pop}` from that `<Header>` call, keeping `title`, `large`, and `right`.

Do **not** touch `Appearance.tsx`, `SetlistDetail.tsx`, or `Export.tsx`'s `Header` calls — those screens are pushed onto a tab's stack (not tab roots), so `nav.canPop` is genuinely true there and the default back behavior is already correct.

- [ ] **Step 7: Remove Tuner's now-meaningless "Close" button**

`src/screens/tuner/Tuner.tsx` has three identical `<Header>` calls (the permission-gate state, the mic-off state, and the main tuner state), each passing both `onBack={nav.pop}` and a `right={<button ... onClick={nav.pop}>Close</button>}`. Once Tuner is a tab root, `nav.pop()` is a no-op (nothing to pop to) — the same reasoning as Step 6, plus there is no "close back to" concept at a tab root. Replace all three occurrences of:

```tsx
<Header title="Tuner" tinted right={<button className="hdr-action" onClick={nav.pop}>Close</button>} onBack={nav.pop} />
```

with:

```tsx
<Header title="Tuner" tinted />
```

- [ ] **Step 8: Delete `MenuDrawer` and its trigger**

Delete `src/screens/live-stage/MenuDrawer.tsx`.

In `src/screens/live-stage/LiveStage.tsx`:
1. Remove the import: `import { MenuDrawer } from "./MenuDrawer";`
2. Remove the state: `const [menuOpen, setMenuOpen] = useState(false);`
3. Remove the hamburger button in all three header states (the "ended" state, the "no song" empty state, and the main loaded-song state) — each currently looks like:
   ```tsx
   <button className="hdr-btn" onClick={() => setMenuOpen(true)}>
     <Icon name="menu" size={20} strokeWidth={2} />
   </button>
   ```
   Delete this button entirely in each of the three places (the `.live-badge` span that follows it is unaffected — it's absolutely positioned and doesn't depend on a preceding sibling).
4. Remove the three `{menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}` render blocks (one per state).

- [ ] **Step 9: Build check**

Run: `npm run build`
Expected: clean.

- [ ] **Step 10: Manual click-through**

In `npm run dev`:
1. Confirm a tab bar renders at the bottom with 5 items (Live Stage, Library, Setlists, Tuner, Settings), and the active tab is visually distinct.
2. Tap each tab in turn — confirm the corresponding screen loads and no back-chevron appears on any of them (Library, Setlists, Tuner, Settings, Live Stage).
3. From Library, tap a song's "•••" → "Edit chart" (pushes `add-edit-song`) — confirm the tab bar disappears while that screen is open (modal), and confirm a back-chevron is **not** relevant here since Add/Edit Song uses its own Cancel/Save header, not `Header`. Tap Cancel — confirm you land back on Library with the tab bar visible again.
4. From Setlists, tap into a setlist (pushes `setlist-detail`) — confirm the tab bar stays visible (non-modal push) and a back-chevron appears and correctly pops back to Setlists.
5. Drill two levels deep in Setlists (a setlist → its "•••" → Export, or Set details), switch to the Tuner tab, then switch back to Setlists — confirm you land exactly where you left off, not back at the Setlists root.
6. On Live Stage with a song loaded, wait ~6s idle — confirm the tab bar hides along with Live Stage's own header/toolbar, and tapping the screen brings all of it back together.
7. Confirm there is no longer any hamburger icon anywhere in the app.

- [ ] **Step 11: Commit**

```bash
git add src/components/Icon.tsx src/components/TabBar.tsx src/components/Header.tsx src/App.tsx src/theme.css src/screens/library/Library.tsx src/screens/settings/Settings.tsx src/screens/setlists/Setlists.tsx src/screens/tuner/Tuner.tsx src/screens/live-stage/LiveStage.tsx
git rm src/screens/live-stage/MenuDrawer.tsx
git commit -m "$(cat <<'EOF'
Replace the hamburger drawer with a bottom tab bar

All five top-level destinations (Live Stage, Library, Setlists, Tuner,
Settings) are now reachable from a persistent tab bar instead of being
buried behind a menu icon only Live Stage exposed. Tab roots no longer
show a dead back button, and the tab bar hides for modal screens
(Add/Edit Song, Import) and during Live Stage's existing idle-hide,
matching how a real iOS tab bar behaves.
EOF
)"
```

---

### Task 3: Remove floating action buttons

**Files:**
- Modify: `src/screens/library/Library.tsx`
- Modify: `src/screens/live-stage/LiveStage.tsx`
- Modify: `src/screens/live-stage/MusicToolbar.tsx`

**Interfaces:**
- Consumes: `MusicToolbar`'s existing props (`view`, `hasChords`, `instruments`, `hiddenParts`, `onToggleInstrument`, `transposeLocked`, `chordsLocked`, `instrumentsLocked`).
- Produces: `MusicToolbar` gains three new required props: `onAddSong: () => void`, `onQuickEdit: () => void`, `onAnnotate: () => void`.

- [ ] **Step 1: Replace Library's FAB stack with a header "+" action**

In `src/screens/library/Library.tsx`:

1. Add a new state variable near the other `useState` calls: `const [addMenuOpen, setAddMenuOpen] = useState(false);`
2. Change the `Header`'s `right` prop to show both "Select" and a new "+" button when not in select mode (select mode keeps just "Cancel", unchanged):

```tsx
right={
  selectMode ? (
    <button className="hdr-action" onClick={exitSelectMode}>
      Cancel
    </button>
  ) : (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button className="hdr-action" onClick={() => setSelectMode(true)} disabled={state.songs.length === 0}>
        Select
      </button>
      <button className="hdr-btn" onClick={() => setAddMenuOpen(true)} aria-label="Add or import a song">
        <Icon name="plus" size={20} strokeWidth={2.2} />
      </button>
    </div>
  )
}
```

3. Delete the entire `.fab-stack` block:
```tsx
{!selectMode && (
  <div className="fab-stack" style={{ bottom: 18 }}>
    <button className="fab" onClick={() => nav.push("add-edit-song")} aria-label="Add a song">
      <Icon name="plus" size={24} strokeWidth={2} />
    </button>
    <button className="fab-mini" onClick={() => setImportSheetOpen(true)} aria-label="Import a chart">
      <Icon name="import" size={18} strokeWidth={1.9} />
    </button>
  </div>
)}
```

4. Add a new `Sheet` (anywhere among the other sheet render blocks, e.g. right before the existing `{importSheetOpen && ...}` block) that the new "+" button opens:

```tsx
{addMenuOpen && (
  <Sheet onClose={() => setAddMenuOpen(false)}>
    <div className="sheet-title">Add to Library</div>
    <button
      className="sheet-row"
      onClick={() => {
        setAddMenuOpen(false);
        nav.push("add-edit-song");
      }}
    >
      <span>New song</span>
    </button>
    <button
      className="sheet-row"
      onClick={() => {
        setAddMenuOpen(false);
        setImportSheetOpen(true);
      }}
    >
      <span>Import a chart</span>
    </button>
  </Sheet>
)}
```

The existing `importSheetOpen` sheet (PDF/Photo/MusicXML rows) is unchanged — it's now reached one tap deeper (`+` → "Import a chart" → format choice) instead of directly from a mini-FAB, but its own code doesn't change at all.

- [ ] **Step 2: Add the folded actions to `MusicToolbar`**

In `src/screens/live-stage/MusicToolbar.tsx`, add the three new props and a new, always-visible top row (rendered regardless of `stage.toolbarExpanded`, so these three actions stay exactly as reachable as the FABs were):

```tsx
export function MusicToolbar({
  view,
  hasChords,
  instruments,
  hiddenParts,
  onToggleInstrument,
  transposeLocked,
  chordsLocked,
  instrumentsLocked,
  onAddSong,
  onQuickEdit,
  onAnnotate,
}: {
  view: ChartView;
  hasChords: boolean;
  instruments: ScoreInstrument[];
  hiddenParts: ReadonlySet<string>;
  onToggleInstrument: (id: string) => void;
  transposeLocked: boolean;
  chordsLocked: boolean;
  instrumentsLocked: boolean;
  onAddSong: () => void;
  onQuickEdit: () => void;
  onAnnotate: () => void;
}) {
  const { state, dispatch } = useStore();
  const { stage } = state;
  const key = stage.dispKey ?? "C";
  const showSecondRow = view === "chords" ? hasChords : instruments.length > 1;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: "1px solid var(--line)",
        background: "var(--surface)",
        zIndex: 6,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
        <ToolbarIcon icon="plus" label="Add song" onClick={onAddSong} />
        <ToolbarIcon icon="edit" label="Quick edit" onClick={onQuickEdit} />
        <ToolbarIcon icon="annotate" label="Annotate" onClick={onAnnotate} />
      </div>

      {showSecondRow && (
        <button
          onClick={() => dispatch({ type: "STAGE_TOGGLE_TOOLBAR" })}
          style={{
            width: "100%",
            border: "none",
            background: "none",
            padding: "4px 0 2px",
            fontSize: 16,
            color: stage.toolbarExpanded ? "var(--acc)" : "var(--mut)",
          }}
        >
          {stage.toolbarExpanded ? "﹀" : "︿"}
        </button>
      )}

      {/* ... everything from here down (the key-transpose row, the
          chords/sheet expanded second row, and both ToolbarStepper/
          ToolbarIcon helper components at the bottom of the file) is
          unchanged. ... */}
```

(Only the top of the returned JSX and the prop list change; the key-chip row, the chords/sheet expanded second row, and the `ToolbarStepper`/`ToolbarIcon` helper functions at the bottom of the file are untouched.)

- [ ] **Step 3: Remove Live Stage's two FAB stacks and pass the new handlers**

In `src/screens/live-stage/LiveStage.tsx`:

1. In the "no song on stage" empty state, delete the FAB stack:
```tsx
<div className="fab-stack">
  <button className="fab" onClick={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })} aria-label="Add song to stage">
    <Icon name="plus" size={24} strokeWidth={2} />
  </button>
  <button className="fab-mini" style={{ opacity: 0.4 }} disabled aria-label="Quick edit">
    <Icon name="edit" size={17} strokeWidth={1.9} />
  </button>
</div>
```
and instead add a third button to that state's existing button column (the one with "Browse library" / "Start Sunday AM..."):
```tsx
<div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%", marginTop: 4 }}>
  <button className="btn btn-primary" onClick={() => nav.switchTab("library")}>
    Browse library
  </button>
  {state.setlists.find((sl) => sl.id === "sunday") && (
    <button
      className="btn"
      onClick={() => {
        const ids = activeSetlistSongIds(state.setlists.find((sl) => sl.id === "sunday"));
        dispatch({ type: "STAGE_LOAD", songId: ids[0], setlistId: "sunday", setlistIndex: 0 });
      }}
    >
      Start Sunday AM — Aug 23
    </button>
  )}
  <button className="btn" onClick={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}>
    Add a song to stage
  </button>
</div>
```
(The disabled "Quick edit" mini-FAB in this state did nothing — there's no song loaded yet to quick-edit — so it's dropped rather than replaced with anything.)

2. In the main loaded-song state, delete the FAB stack:
```tsx
{!stage.chromeHidden && !stage.toolbarExpanded && (
  <div className="fab-stack">
    <button className="fab" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" }); }} aria-label="Add song to stage">
      <Icon name="plus" size={24} strokeWidth={2} />
    </button>
    <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" }); }} aria-label="Quick edit">
      <Icon name="edit" size={17} strokeWidth={1.9} />
    </button>
    <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" }); }} aria-label="Annotate">
      <Icon name="annotate" size={17} strokeWidth={1.9} />
    </button>
  </div>
)}
```
and pass the three actions into `MusicToolbar` instead:
```tsx
{!stage.chromeHidden && (hasChords || hasScore) && (
  <MusicToolbar
    view={stage.view}
    hasChords={hasChords}
    instruments={scoreInstruments}
    hiddenParts={hiddenParts}
    onToggleInstrument={toggleInstrument}
    transposeLocked={transposeLocked}
    chordsLocked={chordsAnnotated}
    instrumentsLocked={musicxmlAnnotated}
    onAddSong={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}
    onQuickEdit={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" })}
    onAnnotate={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" })}
  />
)}
```

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: clean (confirms `MusicToolbar`'s new required props are supplied at its one call site, and no `.fab`/`.fab-stack` JSX references remain dangling).

- [ ] **Step 5: Manual click-through**

In `npm run dev`:
1. Confirm no floating circular buttons remain anywhere in the app (Library, Live Stage empty state, Live Stage loaded state).
2. From Library's header, tap "+" — confirm the "New song" / "Import a chart" sheet opens, "New song" reaches Add/Edit Song, and "Import a chart" reveals the existing PDF/Photo/MusicXML choice sheet, each of which still reaches Import correctly.
3. From Live Stage's empty state, confirm "Add a song to stage" opens the Add-Song drawer exactly as the old FAB did.
4. Load a song onto the stage with chords or an attachment (so `MusicToolbar` renders) — confirm the toolbar's new top row's Add-song, Quick-edit, and Annotate icons each perform the same action the removed FABs used to.
5. Expand the toolbar (tap the chevron) — confirm the Add-song/Quick-edit/Annotate row stays visible and usable (unlike the old FABs, which hid while the toolbar was expanded).

- [ ] **Step 6: Commit**

```bash
git add src/screens/library/Library.tsx src/screens/live-stage/LiveStage.tsx src/screens/live-stage/MusicToolbar.tsx
git commit -m "$(cat <<'EOF'
Remove floating action buttons in favor of header and toolbar actions

Library's add/import FABs move into a single header '+' menu; Live
Stage's add-song/quick-edit/annotate FABs fold into MusicToolbar's
existing bottom control surface. Floating circular buttons are a
Material Design pattern, not an iOS one — no FAB remains anywhere in
the app after this change.
EOF
)"
```

---

### Task 4: Native status bar and safe-area insets

**Files:**
- Modify: `package.json`
- Modify: `src/App.tsx`
- Modify: `index.html`
- Modify: `src/theme.css`

**Interfaces:**
- Consumes: `state.settings.theme` (existing), `Capacitor.isNativePlatform()` (existing).
- Produces: nothing new consumed by other tasks — this is the last task in the plan.

- [ ] **Step 1: Add the `@capacitor/status-bar` dependency**

In `package.json`, add to `dependencies` (matching the version pattern of the sibling Capacitor packages already listed):

```json
"@capacitor/status-bar": "^8.5.0",
```

Run: `npm install`
Expected: installs cleanly, `package-lock.json` updates, no `overrides`-style conflict (this package has no relation to the pinned `sql.js` override).

- [ ] **Step 2: Remove the fake status bar from the native render path and control the real one**

In `src/App.tsx`:

1. `./components/StatusBar` (the hardcoded mockup component, still used by the dev-preview branch) and `@capacitor/status-bar` (the real plugin) both export something named `StatusBar` — add the plugin import under an alias to avoid the collision:
```tsx
import { useEffect } from "react";
import { StatusBar as CapacitorStatusBar, Style } from "@capacitor/status-bar";
```
2. Inside `App()`, add an effect that sets the real status bar's style on native platforms whenever the theme changes:
```tsx
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return;
  CapacitorStatusBar.setStyle({ style: state.settings.theme === "dark" ? Style.Light : Style.Dark }).catch(() => {});
}, [state.settings.theme]);
```
(Capacitor's naming is inverted from intuition: `Style.Light` means light-colored *content*, for use on a dark background — i.e. Stage Dark theme gets `Style.Light`, Light theme gets `Style.Dark`. The `.catch(() => {})` is there because this plugin call can reject on a platform/version that doesn't support it; failing silently is correct here since it's a cosmetic status-bar-color preference, not something the rest of the app depends on.)
3. In the native branch's JSX, delete the `<StatusBar />` line (the existing import of the mockup component from `./components/StatusBar` stays exactly as it was — it's untouched and still used by the dev-preview branch below this one):
```tsx
if (Capacitor.isNativePlatform()) {
  return (
    <div
      className="device device--native"
      data-theme={state.settings.theme}
      style={{ "--status-h": vp.statusH } as React.CSSProperties}
    >
      {nav.booted ? <ScreenHost /> : <Splash />}
      <TabBar />
    </div>
  );
}
```

- [ ] **Step 3: Add `viewport-fit=cover`**

In `index.html`, change the viewport meta tag:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
```

- [ ] **Step 4: Add real safe-area padding, scoped to the native shell**

In `src/theme.css`, add (near the `.device--native` rule):

```css
.device--native .hdr,
.device--native .hdr-large-wrap {
  padding-top: env(safe-area-inset-top, 0px);
}
```

(The dev-preview `.device` frame is untouched — it keeps reserving space via its fixed `--status-h` variable and the mock `<StatusBar/>`/`<DeviceNotch/>` components, since it's simulating a fixed device size on a desktop browser tab, not running behind a real notch. `.tab-bar`'s own `padding-bottom: env(safe-area-inset-bottom, 0px)` was already added in Task 2 and needs no change here — it's harmless in both contexts.)

- [ ] **Step 5: Build check**

Run: `npm run build`
Expected: clean.

- [ ] **Step 6: Native verification**

Run: `npm run cap:android`
Expected/manual checks on the emulator or device:
1. No fake "9:41" bar renders anywhere — only the real Android status bar (time, battery, signal) at the very top of the screen.
2. Toggle between Light and Stage Dark in Settings → Appearance — confirm the Android status bar's icon color changes appropriately for each theme (light icons on dark theme, dark icons on light theme).
3. Confirm the header content and the tab bar don't visually collide with the real status bar or the device's on-screen/gesture navigation area.

(iOS on-device verification is not part of this task — no Mac/Xcode is available, per this plan's Global Constraints. Revisit once iOS hardware or Xcode access exists.)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/App.tsx index.html src/theme.css
git commit -m "$(cat <<'EOF'
Use the real native status bar and real safe-area insets

Removes the hardcoded "9:41" mockup status bar from native builds
(it was rendering on top of the real OS status bar) in favor of
@capacitor/status-bar controlling the real one's style per theme, and
adds env(safe-area-inset-*) padding so header/tab-bar content clears
the notch/Dynamic Island and home indicator on a real device. The
dev-preview frame's own mock status bar is untouched.
EOF
)"
```
