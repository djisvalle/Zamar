import { useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Toggle } from "../../components/Toggle";
import { Dialog } from "../../components/Overlays";

export function Settings() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [erasing, setErasing] = useState(false);
  const [eraseText, setEraseText] = useState("");

  return (
    <div className="screen">
      <Header title="Settings" onBack={nav.pop} />
      <div className="flex-1 hidden-scroll" style={{ padding: "8px 14px", display: "flex", flexDirection: "column", gap: 7 }}>
        <SectionLabel>Stage</SectionLabel>
        <SettingRow
          title="Keep screen awake"
          body="The display never dims while a song is open."
          on={state.settings.keepAwake}
          onChange={() => dispatch({ type: "UPDATE_SETTINGS", patch: { keepAwake: !state.settings.keepAwake } })}
        />
        <SettingRow
          title="Autoscroll on load"
          body="Starts scrolling as soon as a song opens."
          on={state.settings.autoscroll}
          onChange={() => dispatch({ type: "UPDATE_SETTINGS", patch: { autoscroll: !state.settings.autoscroll } })}
        />

        <SectionLabel>Appearance</SectionLabel>
        <button className="list-row" onClick={() => nav.push("appearance")}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Stage Dark</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
              Dark chart on stage, light everywhere else.
            </div>
          </div>
          <span className="accent-deep" style={{ fontSize: 12 }}>
            {state.settings.theme === "dark" ? "On" : "Off"} ›
          </span>
        </button>

        <SectionLabel>Data</SectionLabel>
        <div className="list-row">
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Export all songs</div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
              {state.songs.length} songs and {state.setlists.length} setlists as a .zip.
            </div>
          </div>
          <span className="muted">›</span>
        </div>
        <button className="list-row" onClick={() => setErasing(true)}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Reset app data</div>
          </div>
          <span style={{ color: "#8c3b3b", fontWeight: 600 }}>›</span>
        </button>
        <div className="muted text-center" style={{ fontSize: 11, marginTop: "auto", padding: "10px 0" }}>
          Zamar 2.0 · everything stored on this device
        </div>
      </div>

      {erasing && (
        <Dialog>
          <div className="dialog-title">
            Erase {state.songs.length} songs and {state.setlists.length} setlists?
          </div>
          <div className="dialog-body">Everything is stored on this device only — there is no cloud copy. Export first if you need one.</div>
          <input
            className="field"
            style={{ height: 36, borderRadius: 8, border: "1px solid var(--line)", padding: "0 10px", fontSize: 13, background: "var(--surface)", color: "var(--fg)" }}
            placeholder="Type ERASE to confirm"
            value={eraseText}
            onChange={(e) => setEraseText(e.target.value)}
          />
          <div className="btn-row">
            <button
              className="btn"
              onClick={() => {
                setErasing(false);
                setEraseText("");
              }}
            >
              Cancel
            </button>
            <button
              className={"btn btn-danger" + (eraseText !== "ERASE" ? " is-disabled" : "")}
              disabled={eraseText !== "ERASE"}
              onClick={() => {
                dispatch({ type: "DELETE_SONGS", ids: state.songs.map((s) => s.id) });
                setErasing(false);
                setEraseText("");
              }}
            >
              Erase
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--mut)", padding: "6px 2px 0" }}>
      {children}
    </div>
  );
}

function SettingRow({ title, body, on, onChange }: { title: string; body: string; on: boolean; onChange: () => void }) {
  return (
    <div className="list-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
          {body}
        </div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}
