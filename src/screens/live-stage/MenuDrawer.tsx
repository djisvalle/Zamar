import { SideDrawer } from "../../components/Overlays";
import { Icon, type IconName } from "../../components/Icon";
import { useNavigator, type ScreenName } from "../../navigation/Navigator";

const PROFILE_NAME = "Sunday Team";
const PROFILE_ROLE = "Worship leader";

export function MenuDrawer({ onClose }: { onClose: () => void }) {
  const nav = useNavigator();

  const go = (screen: ScreenName, params?: Record<string, unknown>) => {
    onClose();
    nav.push(screen, params);
  };

  return (
    <SideDrawer onClose={onClose} side="left">
      <div className="drawer-profile">
        <span className="drawer-avatar">{PROFILE_NAME[0]}</span>
        <div>
          <div className="drawer-profile-name">{PROFILE_NAME}</div>
          <div className="drawer-profile-role">{PROFILE_ROLE}</div>
        </div>
      </div>
      <div className="drawer-section-label">Zamar</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <MenuItem icon="music" label="Library" onClick={() => go("library")} />
        <MenuItem icon="list" label="Setlists" onClick={() => go("setlists")} />
        <MenuItem icon="tuner" label="Tuner" onClick={() => go("tuner")} />
        <MenuItem icon="settings" label="Settings" onClick={() => go("settings")} />
      </div>
    </SideDrawer>
  );
}

function MenuItem({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return (
    <button className="drawer-menu-item" onClick={onClick}>
      <span className="drawer-menu-icon">
        <Icon name={icon} size={16} strokeWidth={1.9} />
      </span>
      {label}
    </button>
  );
}
