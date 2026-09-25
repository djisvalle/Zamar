import { useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Dialog } from "../../components/Overlays";
import { Segmented, Toggle } from "../../components/Toggle";
import { LargeTitle, Section, Chevron } from "../../components/List";
import type { StaveSpacing } from "../../state/types";

export function Settings() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [erasing, setErasing] = useState(false);
  const [eraseText, setEraseText] = useState("");

  return (
    <div className="screen screen--grouped">
      <Header title="Settings" large />
      <div className="ios-list scroll-under-tabs">
        <LargeTitle>Settings</LargeTitle>

        <Section header="Appearance" footer="One theme for the whole device, applied everywhere at once." tight>
          <button className="sheet-row" onClick={() => nav.push("appearance")}>
            <span>Stage Dark</span>
            <span className="row-detail">
              {state.settings.theme === "dark" ? "On" : "Off"}
              <Chevron />
            </span>
          </button>
        </Section>

        <Section
          header="Notation"
          footer="Room between staves in rendered sheet music — extra space for writing bowings, chord names, or cues by hand."
        >
          <div className="sheet-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 10, paddingBottom: 12 }}>
            <span>Stave spacing</span>
            <Segmented<StaveSpacing>
              options={[
                { value: "compact", label: "Compact" },
                { value: "default", label: "Default" },
                { value: "roomy", label: "Roomy" },
              ]}
              value={state.settings.staveSpacing}
              onChange={(spacing) => dispatch({ type: "SET_STAVE_SPACING", spacing })}
            />
          </div>
        </Section>

        <Section
          header="Keys"
          footer={
            state.settings.strictSpelling
              ? "Transposed chords keep every note of the key's scale, so C♯ shows E♯m and B♯°."
              : "Transposed chords avoid E♯, B♯, F♭ and C♭ unless the key itself is spelled that way. Turn on Strict spelling to keep them wherever they're in the key."
          }
        >
          <div className="sheet-row">
            <span>Show key offsets</span>
            <Toggle
              on={state.settings.showKeyOffsets}
              onChange={() => dispatch({ type: "SET_SHOW_KEY_OFFSETS", value: !state.settings.showKeyOffsets })}
              label="Show key offsets"
            />
          </div>
          <div className="sheet-row">
            <span>Strict spelling</span>
            <Toggle
              on={state.settings.strictSpelling}
              onChange={() => dispatch({ type: "SET_STRICT_SPELLING", value: !state.settings.strictSpelling })}
              label="Strict spelling"
            />
          </div>
        </Section>

        <Section header="Data" footer={`${state.songs.length} songs and ${state.setlists.length} setlists as a .zip.`}>
          <div className="sheet-row">
            <span>Export all songs</span>
            <Chevron />
          </div>
        </Section>

        <Section footer="Zamar 2.0 · everything stored on this device">
          <button className="sheet-row destructive" onClick={() => setErasing(true)}>
            <span>Reset app data</span>
          </button>
        </Section>
      </div>

      {erasing && (
        <Dialog>
          <div className="dialog-title">
            Erase {state.songs.length} songs and {state.setlists.length} setlists?
          </div>
          <div className="dialog-body">Everything is stored on this device only — there is no cloud copy. Export first if you need one.</div>
          <input
            className="alert-input"
            placeholder="Type ERASE to confirm"
            aria-label="Type ERASE to confirm"
            value={eraseText}
            onChange={(e) => setEraseText(e.target.value)}
            autoCapitalize="characters"
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
                dispatch({ type: "START_EMPTY" });
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
