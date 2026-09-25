import { useState } from "react";
import { useNavigator } from "../../navigation/Navigator";
import { useStore } from "../../state/store";
import { Header } from "../../components/Header";
import { MicPermissionSheet } from "./MicPermissionSheet";
import { LargeTitle, Section } from "../../components/List";
import { Segmented } from "../../components/Toggle";

type Reading = "flat" | "in-tune";
type InstrumentId = "chromatic" | "guitar" | "bass" | "ukulele" | "violin" | "viola" | "cello";

interface StringPreset {
  name: string;
  freq: number;
}

interface InstrumentPreset {
  id: InstrumentId;
  label: string;
  strings?: StringPreset[];
}

const INSTRUMENTS: InstrumentPreset[] = [
  { id: "chromatic", label: "Chromatic" },
  {
    id: "guitar",
    label: "Guitar",
    strings: [
      { name: "E2", freq: 82.41 },
      { name: "A2", freq: 110.0 },
      { name: "D3", freq: 146.83 },
      { name: "G3", freq: 196.0 },
      { name: "B3", freq: 246.94 },
      { name: "E4", freq: 329.63 },
    ],
  },
  {
    id: "bass",
    label: "Bass",
    strings: [
      { name: "E1", freq: 41.2 },
      { name: "A1", freq: 55.0 },
      { name: "D2", freq: 73.42 },
      { name: "G2", freq: 98.0 },
    ],
  },
  {
    id: "ukulele",
    label: "Ukulele",
    strings: [
      { name: "G4", freq: 392.0 },
      { name: "C4", freq: 261.63 },
      { name: "E4", freq: 329.63 },
      { name: "A4", freq: 440.0 },
    ],
  },
  {
    id: "violin",
    label: "Violin",
    strings: [
      { name: "G3", freq: 196.0 },
      { name: "D4", freq: 293.66 },
      { name: "A4", freq: 440.0 },
      { name: "E5", freq: 659.25 },
    ],
  },
  {
    id: "viola",
    label: "Viola",
    strings: [
      { name: "C3", freq: 130.81 },
      { name: "G3", freq: 196.0 },
      { name: "D4", freq: 293.66 },
      { name: "A4", freq: 440.0 },
    ],
  },
  {
    id: "cello",
    label: "Cello",
    strings: [
      { name: "C2", freq: 65.41 },
      { name: "G2", freq: 98.0 },
      { name: "D3", freq: 146.83 },
      { name: "A3", freq: 220.0 },
    ],
  },
];

const FLAT_CENTS = -18;

export function Tuner() {
  const nav = useNavigator();
  const { state } = useStore();
  const [micOn, setMicOn] = useState(true);
  const [reading, setReading] = useState<Reading>("flat");
  const [permissionResolved, setPermissionResolved] = useState(state.settings.micPermissionAsked);
  const [instrumentId, setInstrumentId] = useState<InstrumentId>("chromatic");
  const [stringIndex, setStringIndex] = useState(0);

  if (!permissionResolved) {
    return (
      <div className="screen">
        <Header title="Tuner" />
        <div style={{ flex: 1 }} />
        <MicPermissionSheet onDone={() => setPermissionResolved(true)} />
      </div>
    );
  }

  if (!micOn) {
    return (
      <div className="screen">
        <Header title="Tuner" />
        <div className="empty">
          <div className="empty-title">Microphone is off</div>
          <div className="empty-body">Zamar needs the mic to hear a note. Nothing is recorded or sent anywhere.</div>
          <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => setMicOn(true)}>
            Open settings
          </button>
          <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>
            Silence for 4 s shows this same board reading "Listening for a note…".
          </div>
        </div>
      </div>
    );
  }

  const instrument = INSTRUMENTS.find((i) => i.id === instrumentId)!;
  const current: StringPreset = instrument.strings ? instrument.strings[stringIndex] : { name: "A4", freq: 440.0 };
  const noteLetter = current.name.replace(/\d+$/, "");

  const inTune = reading === "in-tune";
  const needlePct = inTune ? 50 : 31;
  const displayFreq = inTune ? current.freq : current.freq * Math.pow(2, FLAT_CENTS / 1200);

  const selectInstrument = (id: InstrumentId) => {
    setInstrumentId(id);
    setStringIndex(0);
    setReading("flat");
  };

  const selectString = (idx: number) => {
    setStringIndex(idx);
    setReading("flat");
  };

  return (
    <div className="screen screen--grouped">
      <Header title="Tuner" large />
      <div className="ios-list scroll-under-tabs">
        <LargeTitle>Tuner</LargeTitle>
        <div className="chip-row">
          {INSTRUMENTS.map((i) => (
            <button key={i.id} className={"chip" + (i.id === instrumentId ? " active" : "")} onClick={() => selectInstrument(i.id)}>
              {i.label}
            </button>
          ))}
        </div>

        {instrument.strings && (
          <div style={{ marginTop: 12 }}>
            <Segmented
              options={instrument.strings.map((st, idx) => ({ value: String(idx), label: st.name }))}
              value={String(stringIndex)}
              onChange={(v) => selectString(Number(v))}
            />
          </div>
        )}

        <div
          style={{
            flex: 1,
            minHeight: 320,
            marginTop: 24,
            borderRadius: 26,
            background: "var(--list-cell)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: "28px 20px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontWeight: 700,
              fontSize: 96,
              lineHeight: 1,
              color: inTune ? "var(--switch-on)" : "var(--fg)",
              transition: "color 0.3s ease",
            }}
          >
            {noteLetter}
          </div>
          <div className="row-sub" style={{ fontVariantNumeric: "tabular-nums" }}>
            {inTune ? `${displayFreq.toFixed(1)} Hz · 0 cents` : `${displayFreq.toFixed(1)} Hz · ${FLAT_CENTS} cents`}
          </div>
          <div style={{ width: "100%", height: 56, position: "relative", marginTop: 6 }} aria-hidden>
            {[0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
              <span
                key={p}
                style={{
                  position: "absolute",
                  left: `${p}%`,
                  top: p === 50 ? 4 : p % 20 === 10 ? 20 : 14,
                  width: 2,
                  marginLeft: -1,
                  height: p === 50 ? 48 : p % 20 === 10 ? 16 : 28,
                  borderRadius: 1,
                  background: p === 50 ? "var(--mut)" : "var(--tertiary)",
                }}
              />
            ))}
            <span
              style={{
                position: "absolute",
                left: `${needlePct}%`,
                top: 0,
                width: 6,
                height: 56,
                marginLeft: -3,
                borderRadius: 3,
                background: inTune ? "var(--switch-on)" : "var(--acc)",
                boxShadow: "0 1px 4px rgba(0, 0, 0, 0.2)",
                transition: "left 0.4s ease, background 0.3s ease",
              }}
            />
          </div>
          <div style={{ fontWeight: 600, fontSize: 17, color: inTune ? "var(--switch-on)" : "var(--acc-deep)" }}>
            {inTune ? "In tune" : "Flat — tighten"}
          </div>
          <button className="btn btn-tinted btn-sm" onClick={() => setReading(inTune ? "flat" : "in-tune")}>
            Simulate: tap to {inTune ? "go flat" : "tune up"}
          </button>
        </div>

        <Section>
          <div className="sheet-row">
            <span>
              {current.name} = {current.freq.toFixed(2)} Hz
            </span>
            <span className="row-detail">{instrument.label}</span>
          </div>
        </Section>
      </div>
    </div>
  );
}
