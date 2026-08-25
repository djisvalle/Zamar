import { useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Segmented } from "../../components/Toggle";
import { ChordChart } from "../../components/ChordChart";

type Mode = "light" | "dark" | "auto";

export function Appearance() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [mode, setMode] = useState<Mode>(state.settings.theme === "dark" ? "dark" : "light");

  const choose = (m: Mode) => {
    setMode(m);
    dispatch({ type: "SET_THEME", theme: m === "dark" ? "dark" : "light" });
  };

  return (
    <div className="screen">
      <Header title="Appearance" onBack={nav.pop} />
      <div style={{ padding: "12px 14px 8px", display: "flex", gap: 6 }}>
        <Segmented
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Stage Dark" },
            { value: "auto", label: "Auto" },
          ]}
          value={mode}
          onChange={choose}
        />
      </div>
      <div style={{ margin: "0 14px", borderRadius: 10, background: "var(--bg)", padding: 13, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 15 }}>Amazing Grace</div>
        <ChordChart chordpro={"[G]Amazing [D]grace, how [G]sweet the [Em]sound\n[C]That saved a [G]wretch like [D]me"} fontScale={state.settings.textScale / 100} />
      </div>
      <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 9 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            Text size
          </span>
          <input
            type="range"
            min={70}
            max={160}
            value={state.settings.textScale}
            onChange={(e) => dispatch({ type: "SET_TEXT_SCALE", value: Number(e.target.value) })}
            style={{ flex: 1, accentColor: "var(--acc)" }}
          />
          <span className="accent-deep" style={{ fontSize: 11, fontWeight: 600 }}>
            {state.settings.textScale}%
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
          The specimen above is the real stage renderer, so the sample matches the performance view exactly.
        </div>
      </div>
    </div>
  );
}
