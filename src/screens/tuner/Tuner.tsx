import { useState } from "react";
import { useNavigator } from "../../navigation/Navigator";
import { useStore } from "../../state/store";
import { Header } from "../../components/Header";
import { MicPermissionSheet } from "./MicPermissionSheet";

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
        <Header title="Tuner" tinted right={<button className="hdr-action" onClick={nav.pop}>Close</button>} onBack={nav.pop} />
        <div style={{ flex: 1 }} />
        <MicPermissionSheet onDone={() => setPermissionResolved(true)} />
      </div>
    );
  }

  if (!micOn) {
    return (
      <div className="screen">
        <Header title="Tuner" tinted right={<button className="hdr-action" onClick={nav.pop}>Close</button>} onBack={nav.pop} />
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
    <div className="screen">
      <Header title="Tuner" tinted right={<button className="hdr-action" onClick={nav.pop}>Close</button>} onBack={nav.pop} />

      <div style={{ padding: "10px 14px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
        {INSTRUMENTS.map((i) => (
          <button key={i.id} className={"chip" + (i.id === instrumentId ? " active" : "")} onClick={() => selectInstrument(i.id)}>
            {i.label}
          </button>
        ))}
      </div>

      {instrument.strings && (
        <div style={{ padding: "8px 14px 0", display: "flex", flexWrap: "wrap", gap: 6 }}>
          {instrument.strings.map((s, idx) => (
            <button key={s.name} className={"chip" + (idx === stringIndex ? " active" : "")} onClick={() => selectString(idx)}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 20px" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 64, lineHeight: 1, color: inTune ? "var(--acc)" : "var(--fg)" }}>
          {noteLetter}
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {inTune ? `${displayFreq.toFixed(1)} Hz · 0 cents` : `${displayFreq.toFixed(1)} Hz · ${FLAT_CENTS} cents`}
        </div>
        <div
          style={{
            width: "100%",
            height: 44,
            borderRadius: 8,
            border: `1px solid ${inTune ? "var(--acc)" : "var(--line)"}`,
            background: inTune ? "var(--tint)" : "transparent",
            position: "relative",
          }}
        >
          <span style={{ position: "absolute", left: "50%", top: 6, width: 1, height: 32, background: "var(--line)" }} />
          {[10, 30, 70, 90].map((p) => (
            <span key={p} style={{ position: "absolute", left: `${p}%`, top: 16, width: 1, height: 12, background: "var(--line)" }} />
          ))}
          <span
            style={{
              position: "absolute",
              left: `${needlePct}%`,
              top: 4,
              width: 4,
              height: 36,
              borderRadius: 2,
              background: "var(--acc)",
              transition: "left 0.4s ease",
            }}
          />
        </div>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--acc)" }}>
          {inTune ? "In tune" : "Flat — tighten"}
        </div>
        <button className="chip" onClick={() => setReading(inTune ? "flat" : "in-tune")}>
          Simulate: tap to {inTune ? "go flat" : "tune up"}
        </button>
      </div>
      <div style={{ borderTop: "1px solid var(--line)", padding: "12px 14px", display: "flex", justifyContent: "space-between", fontSize: 12 }} className="muted">
        <span>
          {current.name} = {current.freq.toFixed(2)} Hz
        </span>
        <span className="accent-deep">{instrument.label}</span>
      </div>
    </div>
  );
}
