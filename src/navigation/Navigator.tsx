import { createContext, useContext, useMemo, useState, type ReactNode, createElement } from "react";

export type ScreenName =
  | "splash"
  | "firstrun"
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

export interface Frame {
  screen: ScreenName;
  params?: Record<string, unknown>;
}

interface NavigatorValue {
  stack: Frame[];
  top: Frame;
  canPop: boolean;
  push: (screen: ScreenName, params?: Record<string, unknown>) => void;
  pop: () => void;
  replace: (screen: ScreenName, params?: Record<string, unknown>) => void;
  reset: (screen: ScreenName, params?: Record<string, unknown>) => void;
}

const NavigatorContext = createContext<NavigatorValue | null>(null);

export function NavigatorProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Frame[]>([{ screen: "splash" }]);

  const value = useMemo<NavigatorValue>(
    () => ({
      stack,
      top: stack[stack.length - 1],
      canPop: stack.length > 1,
      push: (screen, params) => setStack((s) => [...s, { screen, params }]),
      pop: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
      replace: (screen, params) => setStack((s) => [...s.slice(0, -1), { screen, params }]),
      reset: (screen, params) => setStack([{ screen, params }]),
    }),
    [stack]
  );

  return createElement(NavigatorContext.Provider, { value }, children);
}

export function useNavigator(): NavigatorValue {
  const ctx = useContext(NavigatorContext);
  if (!ctx) throw new Error("useNavigator must be used within NavigatorProvider");
  return ctx;
}
