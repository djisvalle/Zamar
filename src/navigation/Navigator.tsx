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
