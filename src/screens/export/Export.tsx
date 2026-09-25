import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Toggle, Segmented } from "../../components/Toggle";
import { Sheet } from "../../components/Overlays";
import { Section } from "../../components/List";
import { Icon } from "../../components/Icon";
import { setlistSongCount } from "../../utils/setlistCalc";

type Format = "pdf" | "chordpro" | "musicxml";
type Phase = "options" | "progress" | "done" | "offline-error";

const TOTAL_PAGES = 6;
const FORMAT_LABEL: Record<Format, string> = { pdf: "PDF", chordpro: "ChordPro", musicxml: "MusicXML" };

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
          <div className="empty-title">
            Rendering page {Math.min(page + 1, TOTAL_PAGES)} of {TOTAL_PAGES}
          </div>
          <div style={{ width: "100%", height: 4, background: "var(--fill)", borderRadius: 99, overflow: "hidden" }}>
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
      <div className="screen screen--grouped">
        <div
          style={{
            background: "var(--fg)",
            color: "var(--bg)",
            padding: "8px 16px",
            fontSize: 13,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>Offline — local export only</span>
          <span style={{ opacity: 0.7 }}>Retry</span>
        </div>
        <Header title="Export set" onBack={nav.pop} />
        <div className="ios-list">
          <div className="error-banner" style={{ marginTop: 12 }}>
            <div className="error-banner-title">Page 5 couldn't render</div>
            <div>
              A song in this set has no {format === "musicxml" ? "MusicXML part" : "renderable chart"} — only a typed chart. Export the other 5 pages, or switch this set to ChordPro.
            </div>
          </div>
          <Section footer="Mail and cloud targets are hidden while offline; Files and Print stay available.">
            <button className="sheet-row action" onClick={() => setPhase("done")}>
              Export 5 pages
            </button>
            <button
              className="sheet-row action"
              onClick={() => {
                setFormat("chordpro");
                setPhase("options");
              }}
            >
              Switch to ChordPro
            </button>
            <button className="sheet-row action" onClick={startExport}>
              Retry page 5
            </button>
          </Section>
        </div>
      </div>
    );
  }

  if (phase === "done") {
    const ext = format === "pdf" ? "pdf" : format === "chordpro" ? "cho" : "musicxml";
    return (
      <div className="screen screen--grouped">
        <Header title="Export set" onBack={() => setPhase("options")} backLabel="Export set" />
        <div style={{ flex: 1 }} />
        <Sheet onClose={() => setPhase("options")}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              aria-hidden
              style={{
                width: 44,
                height: 52,
                flex: "none",
                borderRadius: 8,
                background: "var(--list-cell)",
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "center",
                paddingBottom: 6,
                fontSize: 10,
                fontWeight: 700,
                color: "var(--acc-deep)",
                textTransform: "uppercase",
              }}
            >
              {ext}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {setlist.name.replace(/\s/g, "-")}.{ext}
              </div>
              <div className="row-sub">
                {page} pages · 1.2 MB · {includeChords ? "chords included" : "lyrics only"}
              </div>
            </div>
            <button className="row-icon-btn" style={{ background: "var(--fill)", color: "var(--mut)" }} onClick={() => setPhase("options")} aria-label="Close">
              <Icon name="close" size={14} strokeWidth={2.6} />
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
            {["Mail", "Files", "Print", "More"].map((s) => (
              <div key={s} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 12 }}>
                <div style={{ width: 60, height: 60, borderRadius: 14, background: "var(--list-cell)" }} />
                {s}
              </div>
            ))}
          </div>
          <div className="list-group">
            <button className="sheet-row" onClick={nav.pop}>
              <span>Open</span>
            </button>
          </div>
        </Sheet>
      </div>
    );
  }

  return (
    <div className="screen screen--grouped">
      <Header title="Export set" onBack={nav.pop} />
      <div className="ios-list scroll-under-tabs">
        <div className="row-sub" style={{ padding: "0 16px" }}>
          {setlist.name} · {setlistSongCount(setlist)} songs
        </div>
        <div style={{ marginTop: 12 }}>
          <Segmented<Format>
            options={(["pdf", "chordpro", "musicxml"] as Format[]).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
            value={format}
            onChange={setFormat}
          />
        </div>
        <Section
          footer={setlist.sections[0]?.items[0]?.songId ? "Slots export in each song's set key." : undefined}
        >
          <ExportToggle label="Include chords" on={includeChords} onChange={() => setIncludeChords((v) => !v)} />
          <ExportToggle label="Apply per-slot keys" on={perSlotKeys} onChange={() => setPerSlotKeys((v) => !v)} />
          <ExportToggle label="One song per page" on={onePerPage} onChange={() => setOnePerPage((v) => !v)} />
        </Section>
        <Section>
          <ExportToggle label="Simulate offline" on={offline} onChange={() => setOffline((v) => !v)} />
        </Section>
        <div
          style={{
            flex: 1,
            minHeight: 120,
            marginTop: 24,
            borderRadius: 12,
            background: "var(--list-cell)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 15,
            color: "var(--mut)",
          }}
        >
          Preview · {TOTAL_PAGES} pages
        </div>
        <button className="btn btn-primary" style={{ marginTop: 16, flex: "none" }} onClick={startExport}>
          Generate {FORMAT_LABEL[format]}
        </button>
      </div>
    </div>
  );
}

function ExportToggle({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <div className="sheet-row">
      <span>{label}</span>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}
