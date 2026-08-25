import { useState } from "react";
import { Sheet } from "../../components/Overlays";

const ALL_PARTS = ["Piano", "Vocal", "Bass", "Drums", "Guitar"];
const IN_FILE = new Set(["Piano", "Vocal", "Guitar"]);

export function InstrumentFilterModal({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["Piano", "Vocal"]));

  const toggle = (p: string) => {
    if (!IN_FILE.has(p)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  return (
    <Sheet onClose={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="sheet-title">Instruments</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--mut)", fontSize: 15 }}>
          ✕
        </button>
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        <button className="chip" onClick={() => setSelected(new Set(IN_FILE))}>
          Select all
        </button>
        <button className="chip" onClick={() => setSelected(new Set())}>
          Deselect all
        </button>
      </div>
      <div style={{ height: 1, background: "var(--line)" }} />
      {ALL_PARTS.map((p) => {
        const inFile = IN_FILE.has(p);
        const active = selected.has(p);
        return (
          <button
            key={p}
            onClick={() => toggle(p)}
            disabled={!inFile}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              background: "none",
              border: "none",
              color: inFile ? "var(--fg)" : "var(--mut)",
              padding: "2px 0",
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 3,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                background: active ? "var(--acc)" : "none",
                color: active ? "var(--onacc)" : "none",
                border: active ? "none" : "1px dashed var(--line)",
              }}
            >
              {active ? "✓" : ""}
            </span>
            {p}
            {!inFile && <span style={{ fontSize: 10 }}>(not in file)</span>}
          </button>
        );
      })}
    </Sheet>
  );
}
