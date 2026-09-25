import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Toggle, Segmented } from "../../components/Toggle";
import { Sheet } from "../../components/Overlays";
import { Section } from "../../components/List";
import { Icon } from "../../components/Icon";
import { setlistSongCount } from "../../utils/setlistCalc";
import { ATTACHMENT_LABEL } from "../../utils/attachments";
import {
  buildChordPro,
  buildMusicXml,
  buildPdf,
  planExport,
  type ExportFormat,
  type ExportedFile,
  type PlannedSong,
} from "../../utils/exportSet";
import { downloadFile, shareFile } from "../../utils/shareFile";

type Phase = "options" | "progress" | "done" | "error";

const FORMAT_LABEL: Record<ExportFormat, string> = { pdf: "PDF", chordpro: "ChordPro", musicxml: "MusicXML" };

const SKIP_REASON: Record<ExportFormat, string> = {
  pdf: "Songs with no chart or attachment are left out.",
  chordpro: "Only songs with a typed chart can go in a ChordPro file.",
  musicxml: "Only songs with sheet music (MusicXML) can go in a MusicXML export.",
};

function viewLabel(p: PlannedSong): string {
  if (!p.view) return "Not included";
  if (p.view === "chords") return "Chart";
  return ATTACHMENT_LABEL[p.view];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Export({ setlistId }: { setlistId: string }) {
  const { state } = useStore();
  const nav = useNavigator();
  const setlist = state.setlists.find((sl) => sl.id === setlistId);
  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [includeChords, setIncludeChords] = useState(true);
  const [perSlotKeys, setPerSlotKeys] = useState(true);
  const [onePerPage, setOnePerPage] = useState(false);
  const [phase, setPhase] = useState<Phase>("options");
  const [progress, setProgress] = useState<{ label: string; fraction: number }>({ label: "", fraction: 0 });
  const [result, setResult] = useState<ExportedFile | null>(null);
  const [shareError, setShareError] = useState(false);
  /** Bumped to abandon an in-flight export (Cancel, leaving the screen). */
  const run = useRef(0);

  useEffect(() => () => { run.current++; }, []);

  const opts = { includeChords, perSlotKeys, onePerPage };
  const plan = useMemo(
    () => (setlist ? planExport(setlist, state.songs, format, opts) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setlist, state.songs, format, includeChords, perSlotKeys, onePerPage]
  );
  const included = plan.filter((p) => p.view);
  const skipped = plan.length - included.length;

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
    const id = ++run.current;
    setResult(null);
    setShareError(false);
    setProgress({ label: "Preparing", fraction: 0 });
    setPhase("progress");
    const onProgress = (label: string, fraction: number) => {
      if (id === run.current) setProgress({ label, fraction });
    };
    (async () => {
      // Let the progress screen paint before the (synchronous-heavy) build.
      await new Promise((r) => setTimeout(r, 30));
      if (format === "pdf") return buildPdf(setlist, plan, opts, onProgress);
      if (format === "musicxml") return buildMusicXml(setlist, plan, onProgress);
      return buildChordPro(setlist, plan, opts);
    })()
      .then((file) => {
        if (id !== run.current) return;
        setResult(file);
        setPhase("done");
      })
      .catch((err) => {
        if (id !== run.current) return;
        console.error("Export failed", err);
        setPhase("error");
      });
  };

  const share = async () => {
    if (!result) return;
    setShareError(false);
    try {
      await shareFile(result);
    } catch (err) {
      console.error("Share failed", err);
      setShareError(true);
    }
  };

  if (phase === "progress") {
    return (
      <div className="screen">
        <Header title="Export set" onBack={nav.pop} />
        <div className="empty">
          <div className="empty-title">{progress.label}…</div>
          <div style={{ width: "100%", height: 4, background: "var(--fill)", borderRadius: 99, overflow: "hidden" }}>
            <div
              style={{ width: `${Math.round(progress.fraction * 100)}%`, height: 4, background: "var(--acc)", borderRadius: 99, transition: "width .2s" }}
            />
          </div>
          <button
            className="btn"
            style={{ width: "100%", marginTop: 4 }}
            onClick={() => {
              run.current++;
              setPhase("options");
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="screen screen--grouped">
        <Header title="Export set" onBack={() => setPhase("options")} backLabel="Export set" />
        <div className="ios-list">
          <div className="error-banner" style={{ marginTop: 12 }}>
            <div className="error-banner-title">Couldn't create the {FORMAT_LABEL[format]}</div>
            <div>One of the files in this set may be damaged or in a format Zamar can't read. Try again, or switch to another format.</div>
          </div>
          <Section>
            <button className="sheet-row action" onClick={startExport}>
              Try again
            </button>
            <button className="sheet-row action" onClick={() => setPhase("options")}>
              Change export options
            </button>
          </Section>
        </div>
      </div>
    );
  }

  if (phase === "done" && result) {
    const ext = result.name.split(".").pop() ?? "";
    const facts = [
      result.pages ? `${result.pages} page${result.pages === 1 ? "" : "s"}` : `${included.length} song${included.length === 1 ? "" : "s"}`,
      formatSize(result.bytes.length),
      format === "musicxml" ? "" : includeChords ? "chords included" : "lyrics only",
    ].filter(Boolean);
    const notes = [
      skipped ? `${skipped} song${skipped === 1 ? "" : "s"} left out. ${SKIP_REASON[format]}` : "",
      result.untransposed?.length
        ? `${result.untransposed.join(", ")} ${result.untransposed.length === 1 ? "is" : "are"} in the score's written key. MusicXML files can't be re-keyed on export.`
        : "",
    ].filter(Boolean);
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
              <div style={{ fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{result.name}</div>
              <div className="row-sub">{facts.join(" · ")}</div>
            </div>
            <button className="row-icon-btn" style={{ background: "var(--fill)", color: "var(--mut)" }} onClick={() => setPhase("options")} aria-label="Close">
              <Icon name="close" size={14} strokeWidth={2.6} />
            </button>
          </div>
          {notes.length > 0 && (
            <div className="row-sub" style={{ lineHeight: 1.4 }}>
              {notes.map((n) => (
                <div key={n}>{n}</div>
              ))}
            </div>
          )}
          {shareError && (
            <div className="error-banner">
              <div>Couldn't open the share sheet. Try again.</div>
            </div>
          )}
          <button className="btn btn-primary" onClick={share}>
            {Capacitor.isNativePlatform() ? "Share or save…" : "Share…"}
          </button>
          {!Capacitor.isNativePlatform() && (
            <div className="list-group">
              <button className="sheet-row" onClick={() => downloadFile(result.name, new Blob([result.bytes as BlobPart], { type: result.mime }))}>
                <span>Download</span>
              </button>
            </div>
          )}
        </Sheet>
      </div>
    );
  }

  const canExport = included.length > 0;
  return (
    <div className="screen screen--grouped">
      <Header title="Export set" onBack={nav.pop} />
      <div className="ios-list scroll-under-tabs">
        <div className="row-sub" style={{ padding: "0 16px" }}>
          {setlist.name} · {setlistSongCount(setlist)} songs
        </div>
        <div style={{ marginTop: 12 }}>
          <Segmented<ExportFormat>
            options={(["pdf", "chordpro", "musicxml"] as ExportFormat[]).map((f) => ({ value: f, label: FORMAT_LABEL[f] }))}
            value={format}
            onChange={setFormat}
          />
        </div>
        <Section
          footer={
            format === "musicxml"
              ? "Scores are exported as they were imported. Set keys can't be applied inside a MusicXML file."
              : perSlotKeys
              ? "Slots export in each song's set key."
              : "Songs export in their library key."
          }
        >
          {format !== "musicxml" && <ExportToggle label="Include chords" on={includeChords} onChange={() => setIncludeChords((v) => !v)} />}
          {format !== "musicxml" && <ExportToggle label="Apply per-slot keys" on={perSlotKeys} onChange={() => setPerSlotKeys((v) => !v)} />}
          {format === "pdf" && <ExportToggle label="One song per page" on={onePerPage} onChange={() => setOnePerPage((v) => !v)} />}
        </Section>
        <Section header="In this export" footer={skipped ? SKIP_REASON[format] : undefined}>
          {plan.length === 0 ? (
            <div className="sheet-row">
              <span className="muted">This set has no songs yet.</span>
            </div>
          ) : (
            plan.map((p, i) => (
              <div key={`${p.song.id}-${i}`} className="sheet-row" style={{ opacity: p.view ? 1 : 0.5 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.song.title}
                  {p.view && p.view !== "musicxml" && p.key && p.key !== "—" ? <span className="row-detail"> · {p.key}</span> : null}
                </span>
                <span className="row-detail">{viewLabel(p)}</span>
              </div>
            ))
          )}
        </Section>
        <button className="btn btn-primary" style={{ marginTop: 16, flex: "none", opacity: canExport ? 1 : 0.4 }} disabled={!canExport} onClick={startExport}>
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
