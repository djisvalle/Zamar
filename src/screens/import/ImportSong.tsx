import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Dialog } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { ChordChart } from "../../components/ChordChart";
import { PdfPages } from "../../components/PdfPages";
import { MxlScore } from "../../components/MxlScore";
import type { AttachmentKind, AttachmentVersion, Attachments, ChartFormat, Song } from "../../state/types";
import { ATTACHMENT_LABEL, addVersion } from "../../utils/attachments";
import { NoChartTextError, convertChartFile, type ConvertedChart } from "../../utils/chartImport";

export type ImportMethod = "pdf" | "photo" | "musicxml";
type Phase = "pick" | "converting" | "review" | "error";
type ContentType = "chords" | "sheet";
/** How a freshly-converted chart should combine with a chart the destination
 * song already has — only reachable for the in-form target, since that's
 * the only path that can silently clobber existing chords (see finishForm). */
type MergeStrategy = "replace" | "append" | "review";

/** Where the finished import goes: a brand-new song (Library's default),
 * an existing song's supplementary sheet-music/static-file view, or back
 * into an in-progress New/Edit Song form via nav.replace. `attachOnly` is
 * set when a "form" target is specifically adding another version to a
 * category the draft already has (Add/Edit Song's "Add another … version"
 * button) — there's no ambiguity about what the file is in that case, so
 * the "what's in this file?" question should never be asked, the same way
 * it's never asked for `kind: "existing"`. */
export type ImportTarget = { kind: "new" } | { kind: "existing"; songId: string } | { kind: "form"; attachOnly?: boolean };

export interface ImportFormDraft {
  title: string;
  artist: string;
  tempo: string;
  timeSig: string;
  manualKey: string;
  songId?: string; // set when this draft is editing an existing song
  chordpro: string; // the form's current chart text, preserved when this import only attaches a file
  chartFormat: ChartFormat;
  attachments: Attachments; // the form's current attachments, preserved when this import only converts chords
}

const METHOD_LABEL: Record<ImportMethod, string> = {
  pdf: "Import PDF",
  photo: "Import photo",
  musicxml: "Import MusicXML",
};

const METHOD_ACCEPT: Record<ImportMethod, string> = {
  pdf: "application/pdf",
  photo: "image/*",
  musicxml: ".mxl,.musicxml,.xml",
};


export function ImportSong({ method, target, formDraft }: { method: ImportMethod; target?: ImportTarget; formDraft?: ImportFormDraft }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const isExisting = target?.kind === "existing";
  const isForm = target?.kind === "form";
  const existingSong = isExisting ? state.songs.find((s) => s.id === target.songId) : undefined;
  // Skips the "what's in this file?" declaration entirely — true both for
  // attaching to an existing song (never ambiguous) and for adding another
  // version to a category the in-progress draft already has.
  const skipContentDeclaration = isExisting || (target?.kind === "form" && !!target.attachOnly);

  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<{ dataUrl: string; name: string } | null>(null);
  const [contentType, setContentType] = useState<ContentType>("chords");
  const [versionLabel, setVersionLabel] = useState("");
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>("replace");
  const [progress, setProgress] = useState<{ step: string; fraction: number }>({ step: "", fraction: 0 });
  const [converted, setConverted] = useState<ConvertedChart | null>(null);
  const [convertError, setConvertError] = useState<"no-text" | "failed" | null>(null);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Bumped to abandon an in-flight conversion (Back, unmount) — its result
   * is ignored if the run it belongs to is no longer current. */
  const convertRun = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { convertRun.current++; }, []);

  const label = METHOD_LABEL[method];
  const canDeclareContent = method !== "musicxml";
  const attachmentKind: AttachmentKind = method === "pdf" ? "pdf" : method === "musicxml" ? "musicxml" : "image";
  // A format with no sheet/chords fork (MusicXML) is unambiguously real sheet
  // music — treat it the same as an explicit "Sheet music" declaration.
  const isSheetContent = contentType === "sheet" || !canDeclareContent;
  const willAttach = skipContentDeclaration || (isSheetContent && !!file);
  const importedChart = converted?.chordpro ?? "";
  /** True only when converting chords back into a draft that already has a
   * non-empty chart — the one case where a plain "Use this" would silently
   * discard the person's existing chords, so it needs a Replace/Append/
   * Review choice instead of the unconditional overwrite in finishForm. */
  const hasExistingChart = isForm && !willAttach && Boolean(formDraft?.chordpro?.trim());
  const isAppend = hasExistingChart && mergeStrategy === "append";
  const mergedChordpro = isAppend ? `${formDraft!.chordpro.trimEnd()}\n\n${importedChart}` : importedChart;

  const buildVersion = (): AttachmentVersion => ({
    id: `att-${Date.now()}`,
    label: versionLabel.trim() || file!.name,
    dataUrl: file!.dataUrl,
    name: file!.name,
  });

  const onFilePicked: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    const reader = new FileReader();
    reader.onload = () => setFile({ dataUrl: String(reader.result), name: picked.name });
    reader.readAsDataURL(picked);
  };

  const startConvert = () => {
    if (!file || method === "musicxml") return;
    const run = ++convertRun.current;
    setProgress({ step: method === "pdf" ? "Reading pages…" : "Reading photo…", fraction: 0 });
    setConvertError(null);
    setPhase("converting");
    convertChartFile(file.dataUrl, method, (step, fraction) => {
      if (run === convertRun.current) setProgress({ step, fraction });
    })
      .then((chart) => {
        if (run !== convertRun.current) return;
        setConverted(chart);
        setTitle(chart.title || file.name.replace(/\.[^.]+$/, "") || "Untitled import");
        setArtist(chart.artist ?? "");
        setPhase("review");
      })
      .catch((err: unknown) => {
        if (run !== convertRun.current) return;
        setConvertError(err instanceof NoChartTextError ? "no-text" : "failed");
        setPhase("error");
      });
  };

  const goToReview = () => {
    if (!isExisting) setTitle(file?.name.replace(/\.[^.]+$/, "") || "Untitled import");
    setPhase("review");
  };

  const finishNew = () => {
    const attachments: Attachments = willAttach ? addVersion({}, attachmentKind, buildVersion()) : {};
    const song: Song = {
      id: `song-${Date.now()}`,
      title: title.trim() || "Untitled import",
      artist: artist.trim(),
      defaultKey: willAttach ? "—" : converted?.key ?? "C",
      tempo: willAttach ? 0 : converted?.tempo ?? 0,
      timeSig: willAttach ? "4/4" : converted?.timeSig ?? "4/4",
      durationSec: 240,
      favourite: false,
      source: method === "musicxml" ? "musicxml" : "imported-pdf",
      chordpro: willAttach ? "" : importedChart,
      chartFormat: willAttach ? "chordpro" : converted?.chartFormat ?? "chords-over-lyrics",
      attachments,
      notes: "",
      annotations: {},
    };
    dispatch({ type: "ADD_SONG", song });
    nav.pop();
  };

  const finishExisting = () => {
    if (!existingSong || !file) {
      nav.pop();
      return;
    }
    const attachments = addVersion(existingSong.attachments, attachmentKind, buildVersion());
    dispatch({ type: "UPDATE_SONG", song: { ...existingSong, attachments } });
    nav.pop();
  };

  const finishForm = () => {
    // Each import touches only the view it produced — converting chords never
    // clears prior attachments, and attaching a file only adds a version to
    // its own category, never disturbing the others.
    const attachments = willAttach ? addVersion(formDraft?.attachments ?? {}, attachmentKind, buildVersion()) : formDraft?.attachments ?? {};
    const chordpro = willAttach ? formDraft?.chordpro ?? "" : mergedChordpro;
    // Appending keeps the draft's own format (the parser reads both, so a
    // mixed chart still renders); replacing takes the converted chart's.
    const chartFormat: ChartFormat =
      willAttach || isAppend ? formDraft?.chartFormat ?? "chords-over-lyrics" : converted?.chartFormat ?? "chords-over-lyrics";
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      // A converted chart's header fills in a title/artist the form doesn't
      // have yet, but never overwrites what the person already typed.
      prefillTitle: formDraft?.title || (willAttach ? undefined : converted?.title),
      prefillArtist: formDraft?.artist || (willAttach ? undefined : converted?.artist),
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: chordpro,
      prefillChartFormat: chartFormat,
      prefillAttachments: attachments,
    });
  };

  /** Returns to the New/Edit Song form with its draft exactly as it was
   * before this import started — used when backing out without saving. */
  const restoreDraft = () =>
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      prefillTitle: formDraft?.title,
      prefillArtist: formDraft?.artist,
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: formDraft?.chordpro,
      prefillChartFormat: formDraft?.chartFormat,
      prefillAttachments: formDraft?.attachments,
    });

  const handlePrimarySave = () => {
    if (isExisting) return finishExisting();
    if (isForm) return finishForm();
    return finishNew();
  };

  if (phase === "converting") {
    return (
      <div className="screen">
        <Header
          title={label}
          onBack={() => {
            convertRun.current++;
            setPhase("pick");
          }}
          backLabel="Back"
        />
        <div className="empty">
          <div className="empty-title" style={{ fontSize: 16 }}>
            {progress.step}
          </div>
          <div style={{ width: "100%", height: 4, background: "var(--line)", borderRadius: 99 }}>
            <div
              style={{
                width: `${Math.round(progress.fraction * 100)}%`,
                height: 4,
                background: "var(--acc)",
                borderRadius: 99,
                transition: "width .2s",
              }}
            />
          </div>
          <div className="empty-body">{file?.name}</div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="screen">
        <Header title={label} onBack={() => setPhase("pick")} backLabel="Back" />
        <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="error-banner">
            <div className="error-banner-title">{convertError === "no-text" ? "No chords or lyrics found" : "Couldn't read this file"}</div>
            <div>
              {convertError === "no-text"
                ? method === "pdf"
                  ? "This PDF has no readable text. If it's sheet music, keep it as-is instead."
                  : "The photo may be too dark, blurry or angled to read. Try a straight-on, well-lit photo, or keep it as-is."
                : "Something went wrong while reading it. Try again, or keep the file as-is."}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button className="btn btn-primary" onClick={startConvert}>
              Try again
            </button>
            <button
              className="btn"
              onClick={() => {
                setContentType("sheet");
                goToReview();
              }}
            >
              Keep it as {method === "pdf" ? "a PDF" : "a photo"}
            </button>
            <button className="btn" onClick={() => setPhase("pick")}>
              Choose a different file
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "review") {
    const canSave = isExisting || isForm ? !(hasExistingChart && mergeStrategy === "review") : title.trim().length > 0;
    return (
      <div className="screen">
        <div className="hdr">
          <button className="hdr-action" onClick={() => setConfirmDiscard(true)}>
            Cancel
          </button>
          <span className="hdr-title text-center">{isExisting ? "Attach file" : "Review import"}</span>
          <button className="hdr-action hdr-action--done" onClick={handlePrimarySave} style={{ opacity: canSave ? 1 : 0.4 }} disabled={!canSave}>
            {isExisting ? "Attach" : isForm ? "Use this" : "Save"}
          </button>
        </div>
        <div className="flex-1 hidden-scroll" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {isExisting ? (
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
              Attaching {file?.name} to <strong style={{ color: "var(--fg)" }}>{existingSong?.title}</strong> as{" "}
              {ATTACHMENT_LABEL[attachmentKind]} — its existing chart won't change.
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 13 }}>
              {willAttach
                ? `Attached from ${file?.name} — saved as-is, no chords detected.`
                : converted?.fromOcr
                ? `Read from ${file?.name} with text recognition — check the chords and their spacing before saving.`
                : `Converted from ${file?.name} — check the details below before saving.`}
            </div>
          )}

          {!isExisting && !isForm && (
            <>
              <div className="field">
                <label>Title *</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" />
              </div>
              <div className="field">
                <label>Artist</label>
                <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Artist or Traditional" />
              </div>
            </>
          )}

          {willAttach ? (
            attachmentKind === "image" ? (
              <img src={file!.dataUrl} alt={file!.name} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
            ) : attachmentKind === "musicxml" ? (
              <div style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", padding: 8 }}>
                <MxlScore src={file!.dataUrl} staveSpacing={state.settings.staveSpacing} />
              </div>
            ) : (
              <div style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
                <PdfPages src={file!.dataUrl} />
              </div>
            )
          ) : hasExistingChart ? (
            <>
              <div>
                <div className="list-section-header" style={{ padding: "0 2px 6px" }}>This song already has a chart</div>
                <Segmented
                  options={[
                    { value: "replace", label: "Replace" },
                    { value: "append", label: "Append" },
                    { value: "review", label: "Compare" },
                  ]}
                  value={mergeStrategy}
                  onChange={setMergeStrategy}
                />
              </div>
              {mergeStrategy === "review" ? (
                <>
                  <div>
                    <div className="list-section-header" style={{ padding: "0 2px 6px" }}>Current chart</div>
                    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                      <ChordChart chordpro={formDraft?.chordpro ?? ""} />
                    </div>
                  </div>
                  <div>
                    <div className="list-section-header" style={{ padding: "0 2px 6px" }}>Imported chart</div>
                    <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                      <ChordChart chordpro={importedChart} />
                    </div>
                  </div>
                  <div className="list-section-footer" style={{ padding: "0 2px" }}>Choose Replace or Append to continue.</div>
                </>
              ) : (
                <>
                  <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                    <ChordChart chordpro={mergedChordpro} />
                  </div>
                  <div className="list-section-footer" style={{ padding: "0 2px" }}>
                    {mergeStrategy === "append"
                      ? "The imported chart is added after your current one."
                      : "Your current chart is replaced by the imported one."}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                <ChordChart chordpro={importedChart} />
              </div>
              {!isForm && (
                <div className="field-hint">
                  {converted?.key ? `Detected key: ${converted.key}. ` : ""}Fine-tune the chart afterward from the song's Library menu → Edit chart.
                </div>
              )}
            </>
          )}
        </div>

        {confirmDiscard && (
          <Dialog>
            <div className="dialog-title">Discard this import?</div>
            <div className="dialog-body">{willAttach ? "The attached file won't be saved." : "The converted chart won't be saved."}</div>
            <div className="btn-stack">
              <button className="btn btn-primary" onClick={() => setConfirmDiscard(false)}>
                Keep reviewing
              </button>
              <button
                className="btn btn-danger"
                onClick={() => (isForm ? restoreDraft() : nav.pop())}
              >
                Discard
              </button>
            </div>
          </Dialog>
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      <Header
        title={label}
        onBack={() => (isForm ? restoreDraft() : nav.pop())}
        backLabel={isForm ? (formDraft?.songId ? "Edit song" : "New song") : undefined}
      />
      <div className="empty">
        <div className="empty-title">{method === "pdf" ? "Choose a PDF" : method === "photo" ? "Choose a photo" : "Choose a MusicXML file"}</div>
        <div className="empty-body">
          {isExisting && existingSong
            ? `Attaching to ${existingSong.title}.`
            : method === "pdf"
            ? "Pick a scanned or exported chart PDF from your device."
            : method === "photo"
            ? "Pick a photo of a printed or handwritten chart."
            : "Pick a .mxl or .musicxml file exported from notation software."}
        </div>
        {file && (
          <div style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px", display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span>{method === "pdf" ? "📄" : method === "photo" ? "🖼" : "🎼"}</span>
            <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          </div>
        )}
        {file && willAttach && (
          <div className="field" style={{ width: "100%" }}>
            <label>Name this version (optional)</label>
            <input
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="e.g. Violin, Jazz arrangement, Handwritten copy"
            />
          </div>
        )}
        {file && !skipContentDeclaration && canDeclareContent && (
          <div style={{ width: "100%", textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>What's in this file?</div>
            <div style={{ display: "flex" }}>
              <Segmented
                options={[
                  { value: "chords", label: "Chords & lyrics" },
                  { value: "sheet", label: "Sheet music" },
                ]}
                value={contentType}
                onChange={setContentType}
              />
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.4 }}>
              {contentType === "chords"
                ? "We'll detect chords and lyrics and turn this into an editable chart."
                : `We'll keep the ${attachmentKind} as-is — sheet music isn't converted into chords.`}
            </div>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept={METHOD_ACCEPT[method]} onChange={onFilePicked} style={{ display: "none" }} />
        <div className="btn-row" style={{ width: "100%", flexDirection: "column" }}>
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            {file ? "Choose a different file" : method === "pdf" ? "Choose PDF" : method === "photo" ? "Take or choose photo" : "Choose MusicXML file"}
          </button>
          {file && (
            <button
              className="btn"
              onClick={() => {
                if (skipContentDeclaration || isSheetContent) {
                  goToReview();
                } else {
                  startConvert();
                }
              }}
            >
              {skipContentDeclaration || isSheetContent ? "Continue" : "Convert to chart"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
