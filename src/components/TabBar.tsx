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
