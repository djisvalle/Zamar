import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useStore } from "../../state/store";
import { Header } from "../../components/Header";
import { MicPermissionSheet } from "./MicPermissionSheet";
import { LargeTitle, Section } from "../../components/List";
import { Segmented } from "../../components/Toggle";
import { centsBetween, nearestNote } from "../../utils/pitch";
import { useMicPitch } from "./useMicPitch";

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

/** Within this many cents of the target counts as in tune — about what a
 * good clip-on tuner treats as "green". */
const IN_TUNE_CENTS = 5;

export function Tuner() {
  const { state } = useStore();
  const [micOn, setMicOn] = useState(true);
  const [permissionResolved, setPermissionResolved] = useState(state.settings.micPermissionAsked);
  const [instrumentId, setInstrumentId] = useState<InstrumentId>("chromatic");
  /** A string the person tapped to tune against, or null to follow whichever
   * string is nearest the note being played. */
  const [lockedString, setLockedString] = useState<number | null>(null);
  const mic = useMicPitch(permissionResolved && micOn);

  if (!permissionResolved) {
    return (
      <div className="screen">
        <Header title="Tuner" />
        <div style={{ flex: 1 }} />
        <MicPermissionSheet
          onDone={(allowed) => {
            setMicOn(allowed);
            setPermissionResolved(true);
          }}
        />
      </div>
    );
  }

  if (!micOn || mic.status === "denied" || mic.status === "unavailable") {
    const denied = mic.status === "denied";
    const platform = Capacitor.getPlatform();
    return (
      <div className="screen">
        <Header title="Tuner" />
        <div className="empty">
          <div className="empty-title">{mic.status === "unavailable" ? "No microphone found" : "Microphone is off"}</div>
          <div className="empty-body">
            {denied
              ? platform === "android"
                ? "Allow microphone access for Zamar in Settings › Apps › Zamar › Permissions, then try again."
                : platform === "ios"
                ? "Allow microphone access in Settings › Zamar › Microphone, then try again."
                : "Allow microphone access for this page in your browser, then try again."
              : mic.status === "unavailable"
              ? "Zamar couldn't open a microphone on this device."
              : "Zamar needs the mic to hear a note. Nothing is recorded or sent anywhere."}
          </div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 4 }}
            onClick={() => {
              setMicOn(true);
              mic.retry();
            }}
          >
            {micOn ? "Try again" : "Turn on microphone"}
          </button>
        </div>
      </div>
    );
  }

  const instrument = INSTRUMENTS.find((i) => i.id === instrumentId)!;
  const heard = mic.freq;

  // What the needle measures against: the nearest chromatic note, or on an
  // instrument preset the locked string / the string nearest to what's heard.
  let targetName = "–";
  let targetFreq: number | null = null;
  let activeString: number | null = lockedString;
  if (heard) {
    if (instrument.strings) {
      if (activeString === null) {
        let best = 0;
        instrument.strings.forEach((st, idx) => {
          if (Math.abs(centsBetween(heard, st.freq)) < Math.abs(centsBetween(heard, instrument.strings![best].freq))) best = idx;
        });
        activeString = best;
      }
      const st = instrument.strings[activeString];
      targetName = st.name.replace(/\d+$/, "");
      targetFreq = st.freq;
    } else {
      const n = nearestNote(heard);
      targetName = n.name;
      targetFreq = n.freq;
    }
  } else if (instrument.strings && lockedString !== null) {
    targetName = instrument.strings[lockedString].name.replace(/\d+$/, "");
  }

  const cents = heard && targetFreq ? centsBetween(heard, targetFreq) : null;
  const inTune = cents !== null && Math.abs(cents) <= IN_TUNE_CENTS;
  const needlePct = cents === null ? 50 : 50 + Math.max(-50, Math.min(50, cents));
  const verdict =
    cents === null
      ? mic.status === "listening"
        ? "Listening for a note…"
        : "Starting microphone…"
      : inTune
      ? "In tune"
      : cents < 0
      ? instrument.strings
        ? "Flat — tighten"
        : "Flat"
      : instrument.strings
      ? "Sharp — loosen"
      : "Sharp";

  const selectInstrument = (id: InstrumentId) => {
    setInstrumentId(id);
    setLockedString(null);
  };

  const referenceString = instrument.strings ? instrument.strings[activeString ?? 0] : null;

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
              options={[{ value: "auto", label: "Auto" }, ...instrument.strings.map((st, idx) => ({ value: String(idx), label: st.name }))]}
              value={lockedString === null ? "auto" : String(lockedString)}
              onChange={(v) => setLockedString(v === "auto" ? null : Number(v))}
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
              color: inTune ? "var(--switch-on)" : heard ? "var(--fg)" : "var(--tertiary)",
              transition: "color 0.3s ease",
            }}
          >
            {targetName}
          </div>
          <div className="row-sub" style={{ fontVariantNumeric: "tabular-nums" }}>
            {heard && cents !== null ? `${heard.toFixed(1)} Hz · ${cents > 0 ? "+" : ""}${Math.round(cents)} cents` : "\u00a0"}
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
                background: inTune ? "var(--switch-on)" : heard ? "var(--acc)" : "var(--tertiary)",
                boxShadow: "0 1px 4px rgba(0, 0, 0, 0.2)",
                transition: "left 0.12s linear, background 0.3s ease",
              }}
            />
          </div>
          <div style={{ fontWeight: 600, fontSize: 17, color: inTune ? "var(--switch-on)" : heard ? "var(--acc-deep)" : "var(--mut)" }}>
            {verdict}
          </div>
        </div>

        <Section>
          <div className="sheet-row">
            <span>
              {referenceString ? `${referenceString.name} = ${referenceString.freq.toFixed(2)} Hz` : "A4 = 440.00 Hz"}
            </span>
            <span className="row-detail">{instrument.label}</span>
          </div>
        </Section>
      </div>
    </div>
  );
}
