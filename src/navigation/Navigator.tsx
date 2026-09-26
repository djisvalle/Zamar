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
  /** Stable for as long as this screen stays on its stack. It keys the
   * screen's layer in ScreenHost, so it decides when a screen remounts. */
  id: string;
  screen: ScreenName;
  params?: Record<string, unknown>;
}

let frameCounter = 0;
function newFrame(screen: ScreenName, params?: Record<string, unknown>): Frame {
  frameCounter += 1;
  return { id: `f${frameCounter}`, screen, params };
}

/** Screens presented as modal form sheets (their own Cancel/Title/Save header,
 * not the shared back-chevron Header) — the tab bar hides while one of these
 * is on top of the active tab's stack, matching iOS's convention that
 * modally-presented view controllers cover the tab bar. */
export const MODAL_SCREENS = new Set<ScreenName>(["add-edit-song", "import-song"]);

export const TAB_NAMES: TabName[] = ["live-stage", "library", "setlists", "tuner", "settings"];

const TAB_ROOT: Record<TabName, ScreenName> = {
  "live-stage": "live-stage",
  library: "library",
  setlists: "setlists",
  tuner: "tuner",
  settings: "settings",
};

function initialStacks(): Record<TabName, Frame[]> {
  const stacks = {} as Record<TabName, Frame[]>;
  for (const tab of TAB_NAMES) stacks[tab] = [newFrame(TAB_ROOT[tab])];
  return stacks;
}

interface NavigatorValue {
  activeTab: TabName;
  /** Every tab's back-stack. ScreenHost keeps all of them mounted. */
  stacks: Record<TabName, Frame[]>;
  /** Tabs visited so far, in the order first visited. A tab's screens
   * mount on its first visit and then stay mounted, like
   * UITabBarController loading a tab's view the first time it's selected. */
  visited: TabName[];
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
}

interface InternalState {
  activeTab: TabName;
  stacks: Record<TabName, Frame[]>;
  visited: TabName[];
}

/** A stack collapsed to `screen`, keeping its current root frame (and so its
 * mounted screen) when that root already is `screen` with no params. */
function collapsed(stack: Frame[], screen: ScreenName, params?: Record<string, unknown>): Frame[] {
  const root = stack[0];
  if (root.screen === screen && !root.params && !params) return stack.length === 1 ? stack : [root];
  return [newFrame(screen, params)];
}

function withVisited(visited: TabName[], tab: TabName): TabName[] {
  return visited.includes(tab) ? visited : [...visited, tab];
}

const NavigatorContext = createContext<NavigatorValue | null>(null);

export function NavigatorProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<InternalState>(() => ({
    activeTab: "live-stage",
    stacks: initialStacks(),
    visited: ["live-stage"],
  }));

  const value = useMemo<NavigatorValue>(() => {
    const stack = state.stacks[state.activeTab];
    return {
      activeTab: state.activeTab,
      stacks: state.stacks,
      visited: state.visited,
      stack,
      top: stack[stack.length - 1],
      canPop: stack.length > 1,
      push: (screen, params) =>
        setState((s) => ({
          ...s,
          stacks: { ...s.stacks, [s.activeTab]: [...s.stacks[s.activeTab], newFrame(screen, params)] },
        })),
      pop: () =>
        setState((s) => {
          const current = s.stacks[s.activeTab];
          if (current.length <= 1) return s;
          return { ...s, stacks: { ...s.stacks, [s.activeTab]: current.slice(0, -1) } };
        }),
      // Replacing a screen with the same screen keeps its id, so it updates in
      // place rather than remounting (SetlistDetail replaces itself to clear
      // its one-shot `openDetails` param without closing the sheet it opened).
      replace: (screen, params) =>
        setState((s) => {
          const current = s.stacks[s.activeTab];
          const top = current[current.length - 1];
          const next = top.screen === screen ? { id: top.id, screen, params } : newFrame(screen, params);
          return { ...s, stacks: { ...s.stacks, [s.activeTab]: [...current.slice(0, -1), next] } };
        }),
      reset: (screen, params) =>
        setState((s) => ({ ...s, stacks: { ...s.stacks, [s.activeTab]: collapsed(s.stacks[s.activeTab], screen, params) } })),
      switchTab: (tab) => setState((s) => ({ ...s, activeTab: tab, visited: withVisited(s.visited, tab) })),
      resetTab: (tab) =>
        setState((s) => ({
          ...s,
          activeTab: tab,
          visited: withVisited(s.visited, tab),
          stacks: { ...s.stacks, [tab]: collapsed(s.stacks[tab], TAB_ROOT[tab]) },
        })),
    };
  }, [state]);

  return createElement(NavigatorContext.Provider, { value }, children);
}

export function useNavigator(): NavigatorValue {
  const ctx = useContext(NavigatorContext);
  if (!ctx) throw new Error("useNavigator must be used within NavigatorProvider");
  return ctx;
}

export interface FrameValue {
  /** This screen's own frame, whichever tab is active. */
  frame: Frame;
  /** Whether this screen has a frame under it in its own stack. */
  canPop: boolean;
  /** The frame under this one, if any. */
  previous?: Frame;
  /** Whether this screen is the one on display: the active tab's top frame.
   * Every other mounted screen is hidden and inert, and anything that runs on
   * a timer or holds a device resource should pause while this is false. */
  showing: boolean;
}

export const FrameContext = createContext<FrameValue | null>(null);

/** The frame a screen was mounted for. Screens read their params and back
 * state here rather than from `useNavigator().top`, which describes the
 * active tab and so is wrong for a screen kept mounted behind another. */
export function useFrame(): FrameValue {
  const ctx = useContext(FrameContext);
  if (!ctx) throw new Error("useFrame must be used within a screen layer");
  return ctx;
}
