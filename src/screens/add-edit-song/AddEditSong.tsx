import { useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Dialog } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { ChordChart } from "../../components/ChordChart";
import { extractBracketChords, extractChordLineChords } from "../../utils/chordpro";
import type { ChartFormat, Song, SongSource } from "../../state/types";

const KEY_RE = /^[A-G](#|b)?$/;
const KEY_DIRECTIVE_RE = /\{key:\s*([^}]+)\}/i;
const CHORDPRO_DIRECTIVES = ["title", "artist", "key", "capo", "tempo", "comment"];

export function AddEditSong({ songId }: { songId?: string }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const existing = songId ? state.songs.find((s) => s.id === songId) : undefined;
  const prefillTitle = (nav.top.params as any)?.prefillTitle as string | undefined;

  const [title, setTitle] = useState(existing?.title ?? prefillTitle ?? "");
  const [artist, setArtist] = useState(existing?.artist ?? "");
  const [tempo, setTempo] = useState(existing ? String(existing.tempo) : "");
  const [manualKey, setManualKey] = useState(existing?.defaultKey ?? "");
  const [chordpro, setChordpro] = useState(existing?.chordpro ?? "");
  const [chartFormat, setChartFormat] = useState<ChartFormat>(existing?.chartFormat ?? "chords-over-lyrics");
  const [tab, setTab] = useState<"source" | "preview">("source");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const chartRef = useRef<HTMLTextAreaElement>(null);

  const insertAtCursor = (snippet: string, cursorOffset?: number) => {
    const el = chartRef.current;
    const start = el?.selectionStart ?? chordpro.length;
    const end = el?.selectionEnd ?? chordpro.length;
    const next = chordpro.slice(0, start) + snippet + chordpro.slice(end);
    setChordpro(next);
    const pos = start + (cursorOffset ?? snippet.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const usedChords = useMemo(
    () => (chartFormat === "chordpro" ? extractBracketChords(chordpro) : extractChordLineChords(chordpro)),
    [chordpro, chartFormat]
  );

  const detectedKey = useMemo(() => {
    const m = chordpro.match(KEY_DIRECTIVE_RE);
    return m ? m[1].trim() : null;
  }, [chordpro]);

  const effectiveKey = detectedKey ?? manualKey;
  const keyValid = !effectiveKey || KEY_RE.test(effectiveKey);
  const titleValid = title.trim().length > 0;
  const dirty =
    title !== (existing?.title ?? prefillTitle ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics");

  const attemptClose = () => {
    if (dirty) setConfirmDiscard(true);
    else nav.pop();
  };

  const save = () => {
    if (!titleValid || !keyValid) {
      setShowErrors(true);
      return;
    }
    const song: Song = {
      id: existing?.id ?? `song-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || "Unknown",
      defaultKey: effectiveKey || "C",
      tempo: Number(tempo) || 80,
      timeSig: existing?.timeSig ?? "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
    };
    dispatch({ type: existing ? "UPDATE_SONG" : "ADD_SONG", song } as any);
    nav.pop();
  };

  return (
    <div className="screen">
      <div className="hdr">
        <button className="hdr-action" onClick={attemptClose}>
          Cancel
        </button>
        <span className="hdr-title text-center">{existing ? existing.title : "New song"}</span>
        <button className="hdr-action" onClick={save} style={{ opacity: titleValid && keyValid ? 1 : 0.4 }}>
          Save
        </button>
      </div>

      {existing && (
        <div style={{ padding: "10px 14px 6px", display: "flex", gap: 6 }}>
          <button className={"chip" + (tab === "source" ? " active" : "")} onClick={() => setTab("source")}>
            Source
          </button>
          <button className={"chip" + (tab === "preview" ? " active" : "")} onClick={() => setTab("preview")}>
            Preview
          </button>
        </div>
      )}

      {(!existing || tab === "source") && (
        <div className="flex-1 hidden-scroll" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {showErrors && (!titleValid || !keyValid) && (
            <div style={{ background: "rgba(140,59,59,.1)", border: "1px solid #8c3b3b", borderRadius: 8, padding: "10px 11px", fontSize: 12, fontWeight: 600, color: "#8c3b3b" }}>
              {(() => {
                const n = [!titleValid, !keyValid].filter(Boolean).length;
                return `${n} field${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
              })()}
            </div>
          )}
          {!existing && (
            <>
              <div className={"field" + (showErrors && !titleValid ? " invalid" : "")}>
                <label>Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" />
                {showErrors && !titleValid && <div className="field-error">Required — this is how the song is found.</div>}
              </div>
              <div className="field">
                <label>Artist</label>
                <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist or Traditional" />
              </div>
              <div style={{ display: "flex", gap: 9 }}>
                <div className={"field" + (showErrors && !keyValid ? " invalid" : "")} style={{ flex: 1 }}>
                  <label>Key {!detectedKey && "*"}</label>
                  {detectedKey ? (
                    <div style={{ height: 36, borderRadius: 8, background: "var(--line)", opacity: 0.6, display: "flex", alignItems: "center", padding: "0 10px", fontSize: 13, color: "var(--mut)" }}>
                      Detected from chart
                    </div>
                  ) : (
                    <input value={manualKey} onChange={(e) => setManualKey(e.target.value)} placeholder="e.g. G" />
                  )}
                  {showErrors && !keyValid && <div className="field-error">Not a key. Use A–G with ♯ or ♭.</div>}
                  {!detectedKey && !showErrors && <div className="field-hint">Tap to set a key override</div>}
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Tempo</label>
                  <input value={tempo} onChange={(e) => setTempo(e.target.value)} placeholder="BPM" inputMode="numeric" />
                </div>
              </div>
            </>
          )}
          <div className="field">
            <label>Chart format</label>
            <div style={{ display: "flex" }}>
              <Segmented
                options={[
                  { value: "chords-over-lyrics", label: "Chords over Lyrics" },
                  { value: "chordpro", label: "ChordPro" },
                ]}
                value={chartFormat}
                onChange={setChartFormat}
              />
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {chartFormat === "chordpro" &&
              CHORDPRO_DIRECTIVES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="chip"
                  onClick={() => insertAtCursor(`{${name}: }`, `{${name}: `.length)}
                >
                  {`{${name}: …}`}
                </button>
              ))}
            {chartFormat === "chords-over-lyrics" && (
              <button type="button" className="chip" onClick={() => insertAtCursor("    ")}>
                ␣ Space ×4
              </button>
            )}
            {usedChords.map((c) => (
              <button
                key={c}
                type="button"
                className="chip"
                onClick={() => insertAtCursor(chartFormat === "chordpro" ? `[${c}]` : `${c} `)}
              >
                {chartFormat === "chordpro" ? `[${c}]` : c}
              </button>
            ))}
          </div>
          <textarea
            ref={chartRef}
            value={chordpro}
            onChange={(e) => setChordpro(e.target.value)}
            placeholder={
              chartFormat === "chordpro"
                ? "Type or paste the chart here —\ne.g. [G]Amazing grace, how [D]sweet the sound"
                : "Type or paste the chart here —\ne.g.  G          D\n      Amazing grace how sweet the sound"
            }
            style={{
              flex: 1,
              minHeight: 160,
              border: existing ? "1px solid var(--acc-deep)" : "1px dashed var(--line)",
              borderRadius: 8,
              padding: "9px 10px",
              fontFamily: "ui-monospace, monospace",
              fontSize: 11,
              lineHeight: 1.75,
              background: "var(--surface)",
              color: "var(--fg)",
              resize: "vertical",
            }}
          />
        </div>
      )}

      {existing && tab === "preview" && (
        <div className="flex-1 hidden-scroll" style={{ margin: "0 14px 12px", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
          <ChordChart chordpro={chordpro} />
          <div className="muted" style={{ fontSize: 11, marginTop: "auto" }}>
            Renders with the stage engine at stage text size.
          </div>
        </div>
      )}

      {confirmDiscard && (
        <Dialog>
          <div className="dialog-title">Discard edits?</div>
          <div className="dialog-body">Unsaved changes to this song will be lost.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button className="btn btn-primary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button className="btn" onClick={() => nav.pop()}>
              Discard changes
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
