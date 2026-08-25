import { useState } from "react";
import { useNavigator } from "../../navigation/Navigator";
import { useStore } from "../../state/store";
import { Header } from "../../components/Header";
import { MicPermissionSheet } from "./MicPermissionSheet";

type Reading = "flat" | "in-tune";

export function Tuner() {
  const nav = useNavigator();
  const { state } = useStore();
  const [micOn, setMicOn] = useState(true);
  const [reading, setReading] = useState<Reading>("flat");
  const [permissionResolved, setPermissionResolved] = useState(state.settings.micPermissionAsked);

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

  const inTune = reading === "in-tune";
  const needlePct = inTune ? 50 : 31;

  return (
    <div className="screen">
      <Header title="Tuner" tinted right={<button className="hdr-action" onClick={nav.pop}>Close</button>} onBack={nav.pop} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "0 20px" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 64, lineHeight: 1, color: inTune ? "var(--acc)" : "var(--fg)" }}>
          A
        </div>
        <div className="muted" style={{ fontSize: 12 }}>
          {inTune ? "440.0 Hz · 0 cents" : "438.2 Hz · −18 cents"}
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
        <span>A = 440 Hz</span>
        <span className="accent-deep">Chromatic</span>
      </div>
    </div>
  );
}
