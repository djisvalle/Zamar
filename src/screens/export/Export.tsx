import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Toggle } from "../../components/Toggle";
import { setlistSongCount } from "../../utils/setlistCalc";

type Format = "pdf" | "chordpro" | "musicxml";
type Phase = "options" | "progress" | "done" | "offline-error";

const TOTAL_PAGES = 6;

export function Export({ setlistId }: { setlistId: string }) {
  const { state } = useStore();
  const nav = useNavigator();
  const setlist = state.setlists.find((sl) => sl.id === setlistId);
  const [format, setFormat] = useState<Format>("pdf");
  const [includeChords, setIncludeChords] = useState(true);
  const [perSlotKeys, setPerSlotKeys] = useState(true);
  const [onePerPage, setOnePerPage] = useState(false);
  const [offline, setOffline] = useState(false);
  const [phase, setPhase] = useState<Phase>("options");
  const [page, setPage] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  if (!setlist) {
    return (
      <div className="screen">
        <Header title="Export set" onBack={nav.pop} />
        <div className="empty">
          <div className="empty-title">Setlist not found</div>
        </div>
      </div>
    );
  }

  const startExport = () => {
    setPage(0);
    setPhase("progress");
    timer.current = setInterval(() => {
      setPage((p) => {
        const next = p + 1;
        const failPage = 5;
        if (offline && next >= failPage) {
          if (timer.current) clearInterval(timer.current);
          setPhase("offline-error");
          return failPage;
        }
        if (next >= TOTAL_PAGES) {
          if (timer.current) clearInterval(timer.current);
          setPhase("done");
          return TOTAL_PAGES;
        }
        return next;
      });
    }, 260);
  };

  if (phase === "progress") {
    return (
      <div className="screen">
        <Header title="Export set" onBack={nav.pop} />
        <div className="empty">
          <div className="empty-title" style={{ fontSize: 16 }}>
            Rendering page {Math.min(page + 1, TOTAL_PAGES)} of {TOTAL_PAGES}
          </div>
          <div style={{ width: "100%", height: 4, background: "var(--line)", borderRadius: 99 }}>
            <div style={{ width: `${(page / TOTAL_PAGES) * 100}%`, height: 4, background: "var(--acc)", borderRadius: 99, transition: "width .2s" }} />
          </div>
          <div className="empty-body">You can keep using the app — this finishes in the background.</div>
          <button
            className="btn"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              if (timer.current) clearInterval(timer.current);
              setPhase("options");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === "offline-error") {
    return (
      <div className="screen">
        <div style={{ background: "var(--fg)", color: "var(--bg)", padding: "7px 14px", fontSize: 11, display: "flex", justifyContent: "space-between" }}>
          <span>Offline — local export only</span>
          <span style={{ opacity: 0.7 }}>Retry</span>
        </div>
        <Header title="Export set" onBack={nav.pop} />
        <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "rgba(140,59,59,.09)", border: "1px solid #8c3b3b", borderRadius: 8, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 13, color: "#8c3b3b" }}>Page 5 couldn't render</div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              A song in this set has no {format === "musicxml" ? "MusicXML part" : "renderable chart"} — only a typed chart. Export the other 5 pages, or switch this set to ChordPro.
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button className="btn btn-primary" onClick={() => setPhase("done")}>
              Export 5 pages
            </button>
            <button className="btn" onClick={() => { setFormat("chordpro"); setPhase("options"); }}>
              Switch to ChordPro
            </button>
            <button className="btn" onClick={startExport}>
              Retry page 5
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: "auto", lineHeight: 1.5 }}>
            Mail and cloud targets are hidden while offline; Files and Print stay available.
          </div>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="screen">
        <Header title="Export set" onBack={() => setPhase("options")} />
        <div style={{ flex: 1 }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "var(--surface)", borderRadius: "14px 14px 0 0", boxShadow: "0 -10px 30px rgba(29,31,32,.3)", padding: 14, display: "flex", flexDirection: "column", gap: 11 }}>
          <div>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 14 }}>
              {setlist.name.replace(/\s/g, "-")}.{format === "pdf" ? "pdf" : format === "chordpro" ? "cho" : "musicxml"}
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
              {page} pages · 1.2 MB · {includeChords ? "chords included" : "lyrics only"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Mail", "Files", "Print", "More"].map((s) => (
              <div key={s} style={{ flex: 1, height: 56, borderRadius: 10, border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                {s}
              </div>
            ))}
          </div>
          <button className="btn btn-primary btn-block" onClick={nav.pop}>
            Open
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <Header title="Export set" onBack={nav.pop} />
      <div className="flex-1 hidden-scroll" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
        <div className="muted" style={{ fontSize: 11 }}>
          {setlist.name} · {setlistSongCount(setlist)} songs
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["pdf", "chordpro", "musicxml"] as Format[]).map((f) => (
            <button key={f} className={"chip" + (format === f ? " active" : "")} onClick={() => setFormat(f)}>
              {f === "pdf" ? "PDF" : f === "chordpro" ? "ChordPro" : "MusicXML"}
            </button>
          ))}
        </div>
        <ExportToggle label="Include chords" on={includeChords} onChange={() => setIncludeChords((v) => !v)} />
        <ExportToggle
          label="Apply per-slot keys"
          body={setlist.sections[0]?.items[0]?.songId ? `Slots export in each song's set key.` : undefined}
          on={perSlotKeys}
          onChange={() => setPerSlotKeys((v) => !v)}
        />
        <ExportToggle label="One song per page" on={onePerPage} onChange={() => setOnePerPage((v) => !v)} />
        <ExportToggle label="Simulate offline" on={offline} onChange={() => setOffline((v) => !v)} />
        <div style={{ flex: 1, border: "1px dashed var(--line)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--mut)" }}>
          Preview · {TOTAL_PAGES} pages
        </div>
        <button className="btn btn-primary" style={{ height: 40 }} onClick={startExport}>
          Generate {format === "pdf" ? "PDF" : format === "chordpro" ? "ChordPro" : "MusicXML"}
        </button>
      </div>
    </div>
  );
}

function ExportToggle({ label, body, on, onChange }: { label: string; body?: string; on: boolean; onChange: () => void }) {
  return (
    <div className="list-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {body && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
            {body}
          </div>
        )}
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}
