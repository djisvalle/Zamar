import { useMemo, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Dialog, Sheet } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { ChordChart } from "../../components/ChordChart";
import { PdfPages } from "../../components/PdfPages";
import { MxlScore } from "../../components/MxlScore";
import { Icon } from "../../components/Icon";
import { Section } from "../../components/List";
import { PullDown } from "../../components/PullDown";
import { useDragReorder } from "../../components/useDragReorder";
import { CaretKeys } from "../../components/CaretKeys";
import {
  extractBracketChords,
  extractChordLineChords,
  findChordProIssues,
  readChartMeta,
  writeChartMeta,
  type ChartMetaField,
} from "../../utils/chordpro";
import { ATTACHMENT_LABEL, CATEGORY_PRIORITY, moveVersion, removeVersion, renameVersion, selectVersion, selectedVersion } from "../../utils/attachments";
import type { ImportMethod } from "../import/ImportSong";
import type { AttachmentKind, Attachments, ChartFormat, Song, SongSource } from "../../state/types";
import { canonicalKey } from "../../utils/keys";

const KEY_RE = /^[A-G](#|b)?$/;
type DefaultViewChoice = "auto" | NonNullable<Song["defaultView"]>;
const CHORDPRO_DIRECTIVES = ["title", "artist", "key", "capo", "tempo", "comment"];

export function AddEditSong({ songId }: { songId?: string }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const existing = songId ? state.songs.find((s) => s.id === songId) : undefined;
  const params = nav.top.params as any;
  const prefillTitle = params?.prefillTitle as string | undefined;
  const prefillArtist = params?.prefillArtist as string | undefined;
  const prefillTempo = params?.prefillTempo as string | undefined;
  const prefillTimeSig = params?.prefillTimeSig as string | undefined;
  const prefillManualKey = params?.prefillManualKey as string | undefined;
  const prefillChordpro = params?.prefillChordpro as string | undefined;
  const prefillChartFormat = params?.prefillChartFormat as ChartFormat | undefined;
  const prefillAttachments = params?.prefillAttachments as Attachments | undefined;
  const hadPrefillAttachments = "prefillAttachments" in (params ?? {});

  // Metadata directives in the chart ({title: ...}, {key: ...}, etc.) win
  // over the stored fields, and from then on the two are kept in step (see
  // editChart and editField).
  const initialChordpro = prefillChordpro ?? existing?.chordpro ?? "";
  const initialMeta = readChartMeta(initialChordpro);
  const [title, setTitle] = useState(initialMeta.title ?? prefillTitle ?? existing?.title ?? "");
  const [artist, setArtist] = useState(initialMeta.artist ?? prefillArtist ?? existing?.artist ?? "");
  const [tempo, setTempo] = useState(initialMeta.tempo ?? prefillTempo ?? (existing ? String(existing.tempo) : ""));
  const [timeSig, setTimeSig] = useState(initialMeta.timeSig ?? prefillTimeSig ?? existing?.timeSig ?? "4/4");
  const [manualKey, setManualKey] = useState(initialMeta.key ?? prefillManualKey ?? existing?.defaultKey ?? "");
  const [chordpro, setChordpro] = useState(initialChordpro);
  const [chartFormat, setChartFormat] = useState<ChartFormat>(prefillChartFormat ?? existing?.chartFormat ?? "chords-over-lyrics");
  const [attachments, setAttachments] = useState<Attachments>(hadPrefillAttachments ? prefillAttachments ?? {} : existing?.attachments ?? {});
  const [defaultView, setDefaultView] = useState<Song["defaultView"]>(existing?.defaultView);
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [tab, setTab] = useState<"source" | "preview" | "notes" | AttachmentKind>("source");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [importMethodOpen, setImportMethodOpen] = useState(false);
  const [versionSheetFor, setVersionSheetFor] = useState<{ kind: AttachmentKind; id: string; label: string } | null>(null);
  const [renameVersionFor, setRenameVersionFor] = useState<{ kind: AttachmentKind; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<{ kind: AttachmentKind; id: string; label: string } | null>(null);
  const chartRef = useRef<HTMLTextAreaElement>(null);

  const FIELD_SETTERS: Record<ChartMetaField, (v: string) => void> = {
    title: setTitle,
    artist: setArtist,
    key: setManualKey,
    tempo: setTempo,
    timeSig: setTimeSig,
  };

  /** Chart edits carry their metadata directives into the fields above. */
  const editChart = (next: string) => {
    setChordpro(next);
    const meta = readChartMeta(next);
    (Object.keys(meta) as ChartMetaField[]).forEach((field) => FIELD_SETTERS[field](meta[field]!));
  };

  /** Field edits rewrite the matching directive when the chart has one. */
  const editField = (field: ChartMetaField, value: string) => {
    FIELD_SETTERS[field](value);
    setChordpro((text) => writeChartMeta(text, field, value));
  };

  const insertAtCursor = (snippet: string, cursorOffset?: number) => {
    const el = chartRef.current;
    const start = el?.selectionStart ?? chordpro.length;
    const end = el?.selectionEnd ?? chordpro.length;
    const next = chordpro.slice(0, start) + snippet + chordpro.slice(end);
    editChart(next);
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

  const versionDrag = useDragReorder((versionId, to) =>
    setAttachments((prev) => moveVersion(prev, to.group as AttachmentKind, versionId, to.index))
  );

  const chordProIssues = useMemo(() => findChordProIssues(chordpro), [chordpro]);

  const effectiveKey = manualKey.trim();
  const keyValid = !effectiveKey || KEY_RE.test(effectiveKey);
  const titleValid = title.trim().length > 0;
  const dirty =
    title !== (existing?.title ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics") ||
    timeSig !== (existing?.timeSig ?? "4/4") ||
    notes !== (existing?.notes ?? "") ||
    defaultView !== existing?.defaultView ||
    JSON.stringify(attachments) !== JSON.stringify(existing?.attachments ?? {});

  const activeKind: AttachmentKind | null = tab === "musicxml" || tab === "pdf" || tab === "image" ? tab : null;
  const activeBucket = activeKind ? attachments[activeKind] : undefined;
  const activeVersion = activeBucket ? selectedVersion(activeBucket) : undefined;

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
      defaultKey: canonicalKey(effectiveKey || "C"),
      tempo: Number(tempo) || 80,
      timeSig: timeSig.trim() || "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
      attachments,
      defaultView,
      notes,
      annotations: existing?.annotations ?? {},
      chordsTextScale: existing?.chordsTextScale,
    };
    dispatch({ type: existing ? "UPDATE_SONG" : "ADD_SONG", song } as any);
    nav.pop();
  };

  const startImport = (method: ImportMethod, attachOnly = false) => {
    setImportMethodOpen(false);
    nav.replace("import-song", {
      method,
      target: { kind: "form", attachOnly },
      formDraft: { title, artist, tempo, timeSig, manualKey, songId: existing?.id, chordpro, chartFormat, attachments },
    });
  };

  // "Add another version" inside a category tab already knows its kind, so
  // it skips the "Import a PDF/photo/MusicXML" chooser sheet and imports
  // that exact kind directly.
  const KIND_TO_METHOD: Record<AttachmentKind, ImportMethod> = { pdf: "pdf", image: "photo", musicxml: "musicxml" };
  const addVersionFor = (kind: AttachmentKind) => startImport(KIND_TO_METHOD[kind], true);

  return (
    <div className="screen screen--grouped">
      <div className="hdr">
        <button className="hdr-action" onClick={attemptClose}>
          Cancel
        </button>
        <span className="hdr-title text-center">{existing ? "Edit song" : "New song"}</span>
        <button className="hdr-action hdr-action--done" onClick={save} style={{ opacity: titleValid && keyValid ? 1 : 0.4 }}>
          Save
        </button>
      </div>

      <div className="chip-row" style={{ padding: "6px 16px 10px" }}>
        <button className={"chip" + (tab === "source" ? " active" : "")} onClick={() => setTab("source")}>
          Chords/Lyrics
        </button>
        <button className={"chip" + (tab === "preview" ? " active" : "")} onClick={() => setTab("preview")}>
          Preview
        </button>
        <button className={"chip" + (tab === "notes" ? " active" : "")} onClick={() => setTab("notes")}>
          Cues
        </button>
        {CATEGORY_PRIORITY.filter((kind) => attachments[kind]).map((kind) => (
          <button key={kind} className={"chip" + (tab === kind ? " active" : "")} onClick={() => setTab(kind)}>
            {ATTACHMENT_LABEL[kind]}
          </button>
        ))}
      </div>

      {tab === "source" && (
        <div className="flex-1 hidden-scroll" style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {showErrors && (!titleValid || !keyValid) && (
            <div className="error-banner">
              <div className="error-banner-title">
                {(() => {
                  const n = [!titleValid, !keyValid].filter(Boolean).length;
                  return `${n} field${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} attention`;
                })()}
              </div>
            </div>
          )}
          <div style={{ flex: "none" }}>
            <div className="list-group">
              <div className="form-row">
                <div className={"form-cell" + (showErrors && !titleValid ? " invalid" : "")} style={{ flex: 3 }}>
                  <input value={title} onChange={(e) => editField("title", e.target.value)} placeholder="Title" aria-label="Title" />
                </div>
                <label className={"form-cell" + (showErrors && !keyValid ? " invalid" : "")} style={{ flex: 1.3 }}>
                  <span className="form-label" style={{ color: "var(--mut)" }}>
                    Key
                  </span>
                  <input value={manualKey} onChange={(e) => editField("key", e.target.value)} placeholder="G" style={{ textAlign: "right" }} />
                </label>
              </div>
              <div className="form-row">
                <div className="form-cell" style={{ flex: 2 }}>
                  <input value={artist} onChange={(e) => editField("artist", e.target.value)} placeholder="Artist" aria-label="Artist" />
                </div>
                <label className="form-cell" style={{ flex: 1.1 }}>
                  <input value={tempo} onChange={(e) => editField("tempo", e.target.value)} placeholder="Tempo" aria-label="Tempo" inputMode="numeric" />
                  {tempo && <span className="form-suffix">BPM</span>}
                </label>
                <div className="form-cell" style={{ flex: 0.9 }}>
                  <input value={timeSig} onChange={(e) => editField("timeSig", e.target.value)} placeholder="4/4" aria-label="Time signature" />
                </div>
              </div>
              {(chordpro.trim() || CATEGORY_PRIORITY.some((k) => attachments[k])) && (
                <div className="form-row">
                  <div className="form-cell">
                    <span className="form-label" style={{ flex: 1 }}>
                      Default on Live Stage
                    </span>
                    <PullDown<DefaultViewChoice>
                      value={defaultView ?? "auto"}
                      options={[
                        { value: "auto", label: "Automatic" },
                        ...(chordpro.trim() ? [{ value: "chords" as const, label: "Chords/Lyrics" }] : []),
                        ...CATEGORY_PRIORITY.filter((k) => attachments[k]).map((k) => ({ value: k, label: ATTACHMENT_LABEL[k] })),
                      ]}
                      onChange={(v) => setDefaultView(v === "auto" ? undefined : v)}
                      className="menu-picker"
                    >
                      <span>{!defaultView ? "Automatic" : defaultView === "chords" ? "Chords/Lyrics" : ATTACHMENT_LABEL[defaultView]}</span>
                      <Icon name="chevron-up-down" size={14} strokeWidth={2.2} />
                    </PullDown>
                  </div>
                </div>
              )}
            </div>
            {showErrors && (!titleValid || !keyValid) && (
              <div className="list-section-footer error">
                {[!titleValid && "Title is required.", !keyValid && "Key is invalid; use a note like G, Bb or F#."].filter(Boolean).join(" ")}
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flex: "none" }}>
            <div style={{ flex: 1 }}>
              <Segmented
                options={[
                  { value: "chords-over-lyrics", label: "Chords/Lyrics" },
                  { value: "chordpro", label: "ChordPro" },
                ]}
                value={chartFormat}
                onChange={setChartFormat}
              />
            </div>
            <button className="btn btn-tinted btn-sm" onClick={() => setImportMethodOpen(true)}>
              <Icon name="import" size={15} strokeWidth={2.2} />
              Import
            </button>
          </div>
          <div className="chip-row">
            {chartFormat === "chordpro" &&
              CHORDPRO_DIRECTIVES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="chip chip--small"
                  onClick={() => insertAtCursor(`{${name}: }`, `{${name}: `.length)}
                >
                  {`{${name}: …}`}
                </button>
              ))}
            {chartFormat === "chords-over-lyrics" && (
              <button type="button" className="chip chip--small" onClick={() => insertAtCursor("    ")}>
                ␣ Space ×4
              </button>
            )}
            {usedChords.map((c) => (
              <button
                key={c}
                type="button"
                className="chip chip--small"
                onClick={() => insertAtCursor(chartFormat === "chordpro" ? `[${c}]` : `${c} `)}
              >
                {chartFormat === "chordpro" ? `[${c}]` : c}
              </button>
            ))}
          </div>
          {chordProIssues.length > 0 && (
            <div className="error-banner" role="status" style={{ flex: "none" }}>
              <div className="error-banner-title">
                {chordProIssues.length === 1 ? "1 possible chart problem" : `${chordProIssues.length} possible chart problems`}
              </div>
              <div>
                Line {chordProIssues[0].line}: {chordProIssues[0].message}
                {chordProIssues.length > 1 && ` (and ${chordProIssues.length - 1} more)`}
              </div>
            </div>
          )}
          <textarea
            ref={chartRef}
            className="form-textarea"
            value={chordpro}
            onChange={(e) => editChart(e.target.value)}
            aria-label="Chart"
            placeholder={
              chartFormat === "chordpro"
                ? "Type or paste the chart here —\ne.g. [G]Amazing grace, how [D]sweet the sound"
                : "Type or paste the chart here —\ne.g.  G          D\n      Amazing grace how sweet the sound"
            }
            style={{
              flex: 1,
              minHeight: 160,
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              lineHeight: 1.75,
            }}
          />
          {/* Under the chart so, with the keyboard up, it sits just above it. */}
          <CaretKeys target={chartRef} />
        </div>
      )}

      {tab === "preview" && (
        <div className="flex-1 hidden-scroll" style={{ margin: "0 16px 12px", background: "var(--list-cell)", borderRadius: 12, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          {chordpro.trim() ? (
            <ChordChart chordpro={chordpro} />
          ) : (
            <div className="muted" style={{ fontSize: 15 }}>No chords or lyrics yet.</div>
          )}
          <div className="muted" style={{ fontSize: 13, marginTop: "auto" }}>
            Renders with the stage engine at stage text size.
          </div>
        </div>
      )}

      {tab === "notes" && (
        <div className="flex-1 hidden-scroll" style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
          <textarea
            className="form-textarea"
            aria-label="Cues"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reminders, cues, anything worth having on hand for this song — works the same whether it's a chord chart, a PDF, or sheet music."
            style={{ flex: 1, minHeight: 160 }}
          />
        </div>
      )}

      {activeKind && activeBucket && activeVersion && (
        <div className="flex-1 hidden-scroll" style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ width: "100%", borderRadius: 12, overflow: "hidden", background: "var(--list-cell)", flex: "none" }}>
            {activeKind === "image" ? (
              <img src={activeVersion.dataUrl} alt={activeVersion.name} style={{ display: "block", width: "100%" }} />
            ) : activeKind === "musicxml" ? (
              <div style={{ padding: 8 }}>
                <MxlScore src={activeVersion.dataUrl} staveSpacing={state.settings.staveSpacing} />
              </div>
            ) : (
              <PdfPages src={activeVersion.dataUrl} />
            )}
          </div>
          <div className="list-section-footer" style={{ paddingTop: 0 }}>
            {activeVersion.name} · {ATTACHMENT_LABEL[activeKind]}
          </div>

          {activeBucket.versions.length > 1 && (
            <Section header="Versions" tight>
              {activeBucket.versions.map((v, i) => {
                const dp = versionDrag.rowProps(v.id, activeKind, i, activeBucket.versions.length);
                return (
                <button key={v.id} {...dp} className={"sheet-row " + dp.className} onClick={() => setVersionSheetFor({ kind: activeKind, id: v.id, label: v.label })}>
                  <div className="row-main">
                    <div className="row-title">
                      <span>{v.label}</span>
                    </div>
                    <div className="row-sub">{v.name}</div>
                  </div>
                  {v.id === activeBucket.selectedVersionId && (
                    <span className="accent-deep" style={{ display: "flex" }} aria-label="In use">
                      <Icon name="check" size={18} strokeWidth={2.4} />
                    </span>
                  )}
                  <span {...versionDrag.handleProps(v.id)} style={{ ...versionDrag.handleProps(v.id).style, display: "flex", color: "var(--tertiary)" }} aria-label={`Reorder ${v.label}`}>
                    <Icon name="grip" size={18} strokeWidth={1.8} />
                  </span>
                </button>
                );
              })}
            </Section>
          )}

          <Section tight={activeBucket.versions.length <= 1}>
            <button className="sheet-row action sheet-row--lead" onClick={() => addVersionFor(activeKind)}>
              <span className="row-lead">
                <Icon name="plus" size={18} strokeWidth={2.2} />
              </span>
              <span>Add another {ATTACHMENT_LABEL[activeKind]} version</span>
            </button>
          </Section>
          <Section tight>
            <button
              className="sheet-row destructive"
              onClick={() => setConfirmDeleteVersion({ kind: activeKind, id: activeVersion.id, label: activeVersion.label })}
            >
              Remove this version
            </button>
          </Section>
        </div>
      )}

      {versionSheetFor && (
        <Sheet onClose={() => setVersionSheetFor(null)}>
          <div className="sheet-title">{versionSheetFor.label}</div>
          <div className="sheet-group">
          {attachments[versionSheetFor.kind]?.selectedVersionId !== versionSheetFor.id && (
            <button
              className="sheet-row"
              onClick={() => {
                const target = versionSheetFor;
                setVersionSheetFor(null);
                setAttachments((prev) => selectVersion(prev, target.kind, target.id));
              }}
            >
              <span>Use this version</span>
            </button>
          )}
          <button
            className="sheet-row"
            onClick={() => {
              const target = versionSheetFor;
              setVersionSheetFor(null);
              setRenameValue(target.label);
              setRenameVersionFor(target);
            }}
          >
            <span>Rename version</span>
          </button>
          </div>
          <div className="sheet-group">
          <button
            className="sheet-row destructive"
            onClick={() => {
              const target = versionSheetFor;
              setVersionSheetFor(null);
              setConfirmDeleteVersion(target);
            }}
          >
            <span>Remove version</span>
          </button>
          </div>
        </Sheet>
      )}

      {renameVersionFor && (
        <Dialog>
          <div className="dialog-title">Rename version</div>
          <input
            className="alert-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Version name"
            aria-label="Version name"
            autoFocus
          />
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setRenameVersionFor(null)}>
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!renameValue.trim() ? " is-disabled" : "")}
              disabled={!renameValue.trim()}
              onClick={() => {
                const target = renameVersionFor;
                setRenameVersionFor(null);
                setAttachments((prev) => renameVersion(prev, target.kind, target.id, renameValue.trim()));
              }}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}

      {confirmDeleteVersion && (
        <Dialog>
          <div className="dialog-title">Remove "{confirmDeleteVersion.label}"?</div>
          <div className="dialog-body">This can't be undone.</div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmDeleteVersion(null)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                const target = confirmDeleteVersion;
                setConfirmDeleteVersion(null);
                const willEmptyBucket = (attachments[target.kind]?.versions.length ?? 0) <= 1;
                setAttachments((prev) => removeVersion(prev, target.kind, target.id));
                if (willEmptyBucket && tab === target.kind) setTab("source");
              }}
            >
              Remove
            </button>
          </div>
        </Dialog>
      )}

      {confirmDiscard && (
        <Dialog>
          <div className="dialog-title">Discard edits?</div>
          <div className="dialog-body">Unsaved changes to this song will be lost.</div>
          <div className="btn-stack">
            <button className="btn btn-primary" onClick={() => setConfirmDiscard(false)}>
              Keep editing
            </button>
            <button className="btn btn-danger" onClick={() => nav.pop()}>
              Discard changes
            </button>
          </div>
        </Dialog>
      )}

      {importMethodOpen && (
        <Sheet onClose={() => setImportMethodOpen(false)}>
          <div className="sheet-title">Import a chart</div>
          <div className="sheet-group">
          <button className="sheet-row" onClick={() => startImport("pdf")}>
            <span>Import a PDF</span>
          </button>
          <button className="sheet-row" onClick={() => startImport("photo")}>
            <span>Import a photo</span>
          </button>
          <button className="sheet-row" onClick={() => startImport("musicxml")}>
            <span>Import MusicXML</span>
          </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
