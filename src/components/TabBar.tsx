import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
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

/** iPad-width layouts (iPadOS 18+) put the tab bar at the top as a
 * text-only capsule; iPhone-width ones keep it at the bottom. The dev frame
 * decides by its Viewport control; native decides by the window's width, so
 * iPad Split View at a narrow width falls back to the bottom bar. */
export function useTabPlacement(): "top" | "bottom" {
  const { state } = useStore();
  const native = Capacitor.isNativePlatform();
  const [wide, setWide] = useState(() => window.innerWidth >= 700);
  useEffect(() => {
    if (!native) return;
    const onResize = () => setWide(window.innerWidth >= 700);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [native]);
  if (native) return wide ? "top" : "bottom";
  return state.viewport === "phone" ? "bottom" : "top";
}

/** Whether the floating tab bar is showing. App.tsx also reads this to mark
 * the device with `has-tab-bar`, which reserves room for the bar at the
 * bottom of every screen (see `--tab-clear` in theme.css). */
export function useTabBarVisible() {
  const { state } = useStore();
  const nav = useNavigator();
  if (MODAL_SCREENS.has(nav.top.screen)) return false;
  if (nav.activeTab === "live-stage") {
    if (state.stage.chromeHidden) return false;
    // Annotate is a full-screen editing mode with its own floating bars at
    // the bottom edge, the way iOS hides the tab bar while editing.
    if (state.stage.drawer === "annotate") return false;
  }
  return true;
}

/** Classes App.tsx puts on the device so screens leave room for the bar.
 * Bottom: `has-tab-bar` while it shows (content scrolls under it). Top:
 * `tabs-top` on every non-modal screen, whether or not the bar is showing,
 * so Live Stage's chart doesn't jump when its chrome auto-hides or Annotate
 * opens. */
export function useTabBarClasses() {
  const nav = useNavigator();
  const visible = useTabBarVisible();
  const placement = useTabPlacement();
  if (placement === "top") {
    return !MODAL_SCREENS.has(nav.top.screen) ? " tabs-top" : "";
  }
  return visible ? " has-tab-bar" : "";
}

export function TabBar() {
  const nav = useNavigator();
  const visible = useTabBarVisible();
  const placement = useTabPlacement();

  if (!visible) return null;

  return (
    <nav className="tab-bar glass" aria-label="Tabs">
      {TABS.map(({ tab, label, icon }) => (
        <button
          key={tab}
          className={"tab-bar-item" + (nav.activeTab === tab ? " active" : "")}
          onClick={() => nav.switchTab(tab)}
          aria-label={label}
          aria-current={nav.activeTab === tab ? "page" : undefined}
        >
          {placement === "bottom" && <Icon name={icon} size={25} strokeWidth={nav.activeTab === tab ? 2.1 : 1.8} />}
          <span className="tab-bar-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
