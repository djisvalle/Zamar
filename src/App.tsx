import { useStore } from "./state/store";
import { useNavigator } from "./navigation/Navigator";
import { StatusBar } from "./components/StatusBar";
import { DeviceNotch } from "./components/DeviceNotch";
import { Splash } from "./screens/onboarding/Splash";
import { FirstRun } from "./screens/onboarding/FirstRun";
import { LiveStage } from "./screens/live-stage/LiveStage";
import { Library } from "./screens/library/Library";
import { Setlists } from "./screens/setlists/Setlists";
import { SetlistDetail } from "./screens/setlists/SetlistDetail";
import { AddEditSong } from "./screens/add-edit-song/AddEditSong";
import { ImportSong, type ImportMethod, type ImportTarget, type ImportFormDraft } from "./screens/import/ImportSong";
import { Tuner } from "./screens/tuner/Tuner";
import { Settings } from "./screens/settings/Settings";
import { Appearance } from "./screens/settings/Appearance";
import { Export } from "./screens/export/Export";

const VIEWPORT_VARS = {
  phone: { fw: "402px", fh: "874px", statusH: "48px" },
  tablet: { fw: "512.5px", fh: "737.5px", statusH: "24px" },
};

function ScreenHost() {
  const nav = useNavigator();
  switch (nav.top.screen) {
    case "splash":
      return <Splash />;
    case "firstrun":
      return <FirstRun />;
    case "live-stage":
      return <LiveStage />;
    case "library":
      return <Library />;
    case "setlists":
      return <Setlists />;
    case "setlist-detail":
      return <SetlistDetail setlistId={nav.top.params?.setlistId as string} />;
    case "add-edit-song":
      return <AddEditSong songId={nav.top.params?.songId as string | undefined} />;
    case "import-song": {
      const p = nav.top.params as any;
      return (
        <ImportSong
          method={(p?.method as ImportMethod) ?? "pdf"}
          target={p?.target as ImportTarget | undefined}
          formDraft={p?.formDraft as ImportFormDraft | undefined}
        />
      );
    }
    case "tuner":
      return <Tuner />;
    case "settings":
      return <Settings />;
    case "appearance":
      return <Appearance />;
    case "export":
      return <Export setlistId={nav.top.params?.setlistId as string} />;
    default:
      return null;
  }
}

export default function App() {
  const { state, dispatch } = useStore();
  const vp = VIEWPORT_VARS[state.viewport];

  return (
    <div className="stage">
      <div className="brand-mark">Zamar — interactive mockup</div>
      <div className="controls">
        <div className="group">
          <span className="group-label">Appearance</span>
          <div className="seg-btn-row">
            <button
              className={"seg-btn" + (state.settings.theme === "light" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_THEME", theme: "light" })}
            >
              Light
            </button>
            <button
              className={"seg-btn" + (state.settings.theme === "dark" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_THEME", theme: "dark" })}
            >
              Stage dark
            </button>
          </div>
        </div>
        <div className="group">
          <span className="group-label">Viewport</span>
          <div className="seg-btn-row">
            <button
              className={"seg-btn" + (state.viewport === "phone" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "phone" })}
            >
              Phone
            </button>
            <button
              className={"seg-btn" + (state.viewport === "tablet" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "tablet" })}
            >
              Tablet
            </button>
          </div>
        </div>
      </div>

      <div className="device-shell">
        <div
          className="device"
          data-theme={state.settings.theme}
          data-viewport={state.viewport}
          style={
            {
              "--fw": vp.fw,
              "--fh": vp.fh,
              "--status-h": vp.statusH,
            } as React.CSSProperties
          }
        >
          <StatusBar />
          <ScreenHost />
          <DeviceNotch viewport={state.viewport} />
        </div>
      </div>
    </div>
  );
}
