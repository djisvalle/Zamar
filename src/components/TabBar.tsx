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

/** Whether the floating tab bar is showing. App.tsx also reads this to mark
 * the device with `has-tab-bar`, which reserves room for the bar at the
 * bottom of every screen (see `--tab-clear` in theme.css). */
export function useTabBarVisible() {
  const { state } = useStore();
  const nav = useNavigator();
  if (!nav.booted) return false;
  if (MODAL_SCREENS.has(nav.top.screen)) return false;
  if (nav.activeTab === "live-stage") {
    if (state.stage.chromeHidden) return false;
    // Annotate is a full-screen editing mode with its own floating bars at
    // the bottom edge, the way iOS hides the tab bar while editing.
    if (state.stage.drawer === "annotate") return false;
  }
  return true;
}

export function TabBar() {
  const nav = useNavigator();
  const visible = useTabBarVisible();

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
          <Icon name={icon} size={25} strokeWidth={nav.activeTab === tab ? 2.1 : 1.8} />
          <span className="tab-bar-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
