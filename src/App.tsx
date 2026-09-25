import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar as CapacitorStatusBar, Style } from "@capacitor/status-bar";
import { useStore } from "./state/store";
import { useNavigator } from "./navigation/Navigator";
import { StatusBar } from "./components/StatusBar";
import { DeviceNotch } from "./components/DeviceNotch";
import { TabBar, useTabBarClasses } from "./components/TabBar";
import { Splash } from "./screens/onboarding/Splash";
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
import { Dialog } from "./components/Overlays";

const VIEWPORT_VARS = {
  phone: { fw: "402px", fh: "874px", statusH: "48px" },
  ipadAir11: { fw: "820px", fh: "1180px", statusH: "24px" },
  ipadAir13: { fw: "1024px", fh: "1366px", statusH: "24px" },
};

function ScreenHost() {
  const nav = useNavigator();
  switch (nav.top.screen) {
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

/** Tells the person when their edits aren't being saved: once when the boot read failed (the
 * app is running in memory only), and again whenever a save attempt fails. Without this the
 * only trace is a console warning and a whole session of edits can vanish on relaunch. */
function StorageAlert() {
  const { storageProblem } = useStore();
  const nav = useNavigator();
  const [dismissed, setDismissed] = useState<typeof storageProblem>(null);
  useEffect(() => {
    if (storageProblem === null) setDismissed(null);
  }, [storageProblem]);
  if (!nav.booted || storageProblem === null || dismissed === storageProblem) return null;
  return (
    <Dialog>
      <div className="dialog-title">{storageProblem === "load" ? "Storage Unavailable" : "Couldn't Save Changes"}</div>
      <div className="dialog-body">
        {storageProblem === "load"
          ? "Zamar couldn't open its library on this device. You can keep using the app, but changes you make now won't be saved. Close and reopen Zamar to try again."
          : "Your latest changes couldn't be written to this device. Zamar will keep trying as you edit, but anything unsaved will be lost if you close the app."}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={() => setDismissed(storageProblem)}>
          OK
        </button>
      </div>
    </Dialog>
  );
}

export default function App() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const vp = VIEWPORT_VARS[state.viewport];
  const tabBarClasses = useTabBarClasses();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    CapacitorStatusBar.setStyle({ style: state.settings.theme === "dark" ? Style.Light : Style.Dark }).catch(() => {});
  }, [state.settings.theme]);

  if (Capacitor.isNativePlatform()) {
    return (
      <div
        className={"device device--native" + tabBarClasses}
        data-theme={state.settings.theme}
        data-platform={Capacitor.getPlatform()}
        style={{ "--status-h": vp.statusH } as React.CSSProperties}
      >
        {nav.booted ? <ScreenHost /> : <Splash />}
        <TabBar />
        <StorageAlert />
      </div>
    );
  }

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
              className={"seg-btn" + (state.viewport === "ipadAir11" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "ipadAir11" })}
            >
              iPad Air 11″
            </button>
            <button
              className={"seg-btn" + (state.viewport === "ipadAir13" ? " active" : "")}
              onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: "ipadAir13" })}
            >
              iPad Air 13″
            </button>
          </div>
        </div>
      </div>

      <div className="device-shell">
        <div
          className={"device" + tabBarClasses}
          data-theme={state.settings.theme}
          data-platform={Capacitor.getPlatform()}
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
          {nav.booted ? <ScreenHost /> : <Splash />}
          <TabBar />
          <StorageAlert />
          <DeviceNotch viewport={state.viewport} />
        </div>
      </div>
    </div>
  );
}
