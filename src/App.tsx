import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { StatusBar as CapacitorStatusBar, Style } from "@capacitor/status-bar";
import { useStore } from "./state/store";
import { FrameContext, useNavigator, type Frame, type FrameValue, type TabName } from "./navigation/Navigator";
import { StatusBar } from "./components/StatusBar";
import { DeviceNotch } from "./components/DeviceNotch";
import { TabBar, useTabBarClasses } from "./components/TabBar";
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

function renderScreen(frame: Frame) {
  const params = frame.params as any;
  switch (frame.screen) {
    case "live-stage":
      return <LiveStage />;
    case "library":
      return <Library />;
    case "setlists":
      return <Setlists />;
    case "setlist-detail":
      return <SetlistDetail setlistId={params?.setlistId as string} />;
    case "add-edit-song":
      return <AddEditSong songId={params?.songId as string | undefined} />;
    case "import-song":
      return (
        <ImportSong
          method={(params?.method as ImportMethod) ?? "pdf"}
          target={params?.target as ImportTarget | undefined}
          formDraft={params?.formDraft as ImportFormDraft | undefined}
        />
      );
    case "tuner":
      return <Tuner />;
    case "settings":
      return <Settings />;
    case "appearance":
      return <Appearance />;
    case "export":
      return <Export setlistId={params?.setlistId as string | undefined} songId={params?.songId as string | undefined} />;
    default:
      return null;
  }
}

/** One screen, kept mounted for as long as its frame is on its stack. Only
 * the active tab's top frame shows; the rest are hidden with `visibility`
 * (not `display: none`, which would collapse them to zero width and make the
 * score, PDF and annotation layers lay themselves out again) and made inert. */
function FrameLayer({ frame, previous, canPop, showing }: FrameValue) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // React 18 doesn't know the `inert` attribute, so it's set directly.
    if (ref.current) ref.current.inert = !showing;
  }, [showing]);
  const value = useMemo<FrameValue>(() => ({ frame, previous, canPop, showing }), [frame, previous, canPop, showing]);
  return (
    <div ref={ref} className="screen-layer" data-showing={showing}>
      <FrameContext.Provider value={value}>{renderScreen(frame)}</FrameContext.Provider>
    </div>
  );
}

/** Every frame of every visited tab stays mounted, so leaving a tab and
 * coming back finds it exactly as it was (Live Stage's score, scroll and
 * zoom; Library's search), the way UITabBarController keeps each tab. */
function ScreenHost() {
  const nav = useNavigator();
  return (
    <div className="screen-host">
      {nav.visited.flatMap((tab: TabName) => {
        const stack = nav.stacks[tab];
        return stack.map((frame, i) => (
          <FrameLayer
            key={frame.id}
            frame={frame}
            previous={stack[i - 1]}
            canPop={i > 0}
            showing={tab === nav.activeTab && i === stack.length - 1}
          />
        ));
      })}
    </div>
  );
}

/** Tells the person when their edits aren't being saved: once when the boot read failed (the
 * app is running in memory only), and again whenever a save attempt fails. Without this the
 * only trace is a console warning and a whole session of edits can vanish on relaunch. */
function StorageAlert() {
  const { storageProblem } = useStore();
  const [dismissed, setDismissed] = useState<typeof storageProblem>(null);
  useEffect(() => {
    if (storageProblem === null) setDismissed(null);
  }, [storageProblem]);
  if (storageProblem === null || dismissed === storageProblem) return null;
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
  const vp = VIEWPORT_VARS[state.viewport];
  const tabBarClasses = useTabBarClasses();

  // index.html's boot splash can't read settings before the library loads,
  // so it takes its theme from here. Only a convenience: without it the
  // splash follows the system setting.
  useEffect(() => {
    try {
      localStorage.setItem("zamar.theme", state.settings.theme);
    } catch {
      // Storage unavailable (private mode, blocked site data).
    }
  }, [state.settings.theme]);

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
        <ScreenHost />
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
          <ScreenHost />
          <TabBar />
          <StorageAlert />
          <DeviceNotch viewport={state.viewport} />
        </div>
      </div>
    </div>
  );
}
