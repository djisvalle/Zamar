import { useState } from "react";
import { useStore, MIN_TEXT_SCALE, MAX_TEXT_SCALE } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Segmented } from "../../components/Toggle";
import { ChordChart } from "../../components/ChordChart";
import { Section } from "../../components/List";

type Mode = "light" | "dark" | "auto";

export function Appearance() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const [mode, setMode] = useState<Mode>(state.settings.theme === "dark" ? "dark" : "light");

  const choose = (m: Mode) => {
    setMode(m);
    dispatch({ type: "SET_THEME", theme: m === "dark" ? "dark" : "light" });
  };

  const scale = state.settings.textScale;
  const pct = ((scale - MIN_TEXT_SCALE) / (MAX_TEXT_SCALE - MIN_TEXT_SCALE)) * 100;

  return (
    <div className="screen screen--grouped">
      <Header title="Appearance" onBack={nav.pop} />
      <div className="ios-list scroll-under-tabs">
        <Section tight>
          <div className="sheet-row">
            <div style={{ flex: 1 }}>
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
          </div>
        </Section>

        <Section header="Preview">
          <div style={{ padding: "12px 16px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 17 }}>Amazing Grace</div>
            <ChordChart chordpro={"[G]Amazing [D]grace, how [G]sweet the [Em]sound\n[C]That saved a [G]wretch like [D]me"} fontScale={scale / 100} />
          </div>
        </Section>

        <Section
          header="Text size"
          footer="The specimen above is the real stage renderer, so the sample matches the performance view exactly. The Zoom buttons on Live Stage change this same setting. A chord chart with marks on it stays at the size it was marked at."
        >
          <div className="sheet-row" style={{ gap: 12 }}>
            <span aria-hidden style={{ fontSize: 13 }}>
              A
            </span>
            <input
              className="ios-slider"
              type="range"
              min={MIN_TEXT_SCALE}
              max={MAX_TEXT_SCALE}
              value={scale}
              aria-label="Text size"
              onChange={(e) => dispatch({ type: "SET_TEXT_SCALE", value: Number(e.target.value) })}
              style={{ flex: 1, ["--fill-pct" as string]: `${pct}%` }}
            />
            <span aria-hidden style={{ fontSize: 22 }}>
              A
            </span>
            <span className="row-detail" style={{ minWidth: 48, justifyContent: "flex-end" }}>
              {scale}%
            </span>
          </div>
        </Section>
      </div>
    </div>
  );
}
