import { useEffect, useRef, useState } from "react";
import { useStore } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { Header } from "../../components/Header";
import { Dialog } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { ChordChart } from "../../components/ChordChart";
import type { Attachment, AttachmentRole, ChartFormat, Song } from "../../state/types";

export type ImportMethod = "pdf" | "photo" | "musicxml";
type Phase = "pick" | "converting" | "review" | "error";
type ContentType = "chords" | "sheet";

/** Where the finished import goes: a brand-new song (Library's default),
 * an existing song's supplementary sheet-music/static-file view, or back
 * into an in-progress New/Edit Song form via nav.replace. */
export type ImportTarget = { kind: "new" } | { kind: "existing"; songId: string } | { kind: "form" };

export interface ImportFormDraft {
  title: string;
  artist: string;
  tempo: string;
  timeSig: string;
  manualKey: string;
  songId?: string; // set when this draft is editing an existing song
  chordpro: string; // the form's current chart text, preserved when this import only attaches a file
  chartFormat: ChartFormat;
  attachment?: Attachment; // the form's current attachment, preserved when this import only converts chords
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

const CONVERT_STEPS: Record<ImportMethod, string[]> = {
  pdf: ["Reading pages…", "Detecting chords…", "Finishing up…"],
  photo: ["Reading photo…", "Detecting chords…", "Finishing up…"],
  musicxml: ["Reading score…", "Detecting chords…", "Building sheet view…"],
};

const MOCK_CHORDPRO = `{key: G}

[G]Verse line goes [D]here, edit as [Em]needed to [C]match
[G]Second line of the [D]imported [Em]chart [C]appears`;

export function ImportSong({ method, target, formDraft }: { method: ImportMethod; target?: ImportTarget; formDraft?: ImportFormDraft }) {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const isExisting = target?.kind === "existing";
  const isForm = target?.kind === "form";
  const existingSong = isExisting ? state.songs.find((s) => s.id === target.songId) : undefined;

  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<{ dataUrl: string; name: string } | null>(null);
  const [contentType, setContentType] = useState<ContentType>("chords");
  const [existingRole, setExistingRole] = useState<AttachmentRole>("sheet-music");
  const [progress, setProgress] = useState(0);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const label = METHOD_LABEL[method];
  const canDeclareContent = method !== "musicxml";
  const attachmentKind: Attachment["kind"] = method === "pdf" ? "pdf" : "image";
  const willAttach = isExisting || (contentType === "sheet" && !!file);

  const onFilePicked: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    const reader = new FileReader();
    reader.onload = () => setFile({ dataUrl: String(reader.result), name: picked.name });
    reader.readAsDataURL(picked);
  };

  const startConvert = (forceFail: boolean) => {
    setProgress(0);
    setPhase("converting");
    const steps = CONVERT_STEPS[method];
    timer.current = setInterval(() => {
      setProgress((p) => {
        const next = p + 1;
        if (forceFail && next >= 2) {
          if (timer.current) clearInterval(timer.current);
          setPhase("error");
          return next;
        }
        if (next >= steps.length) {
          if (timer.current) clearInterval(timer.current);
          setTitle(method === "musicxml" ? "Imported Score" : method === "pdf" ? "Imported Chart" : "Scanned Chart");
          setPhase("review");
          return next;
        }
        return next;
      });
    }, 500);
  };

  const goToReview = () => {
    if (!isExisting) setTitle(file?.name.replace(/\.[^.]+$/, "") || "Untitled import");
    setPhase("review");
  };

  const finishNew = () => {
    const attachment: Attachment | undefined = willAttach
      ? { kind: attachmentKind, role: "sheet-music", dataUrl: file!.dataUrl, name: file!.name }
      : undefined;
    const song: Song = {
      id: `song-${Date.now()}`,
      title: title.trim() || "Untitled import",
      artist: artist.trim() || "Unknown",
      defaultKey: willAttach ? "—" : "G",
      tempo: 80,
      timeSig: "4/4",
      durationSec: 240,
      favourite: false,
      source: method === "musicxml" ? "musicxml" : "imported-pdf",
      chordpro: willAttach ? "" : MOCK_CHORDPRO,
      chartFormat: "chordpro",
      attachment,
    };
    dispatch({ type: "ADD_SONG", song });
    nav.pop();
  };

  const finishExisting = () => {
    if (!existingSong || !file) {
      nav.pop();
      return;
    }
    const attachment: Attachment = { kind: attachmentKind, role: existingRole, dataUrl: file.dataUrl, name: file.name };
    dispatch({ type: "UPDATE_SONG", song: { ...existingSong, attachment } });
    nav.pop();
  };

  const finishForm = () => {
    // Each import touches only the view it produced — converting chords never
    // clears a prior attachment, and attaching a file never clears prior chords.
    const attachment: Attachment | undefined = willAttach
      ? { kind: attachmentKind, role: "sheet-music", dataUrl: file!.dataUrl, name: file!.name }
      : formDraft?.attachment;
    const chordpro = willAttach ? formDraft?.chordpro ?? "" : MOCK_CHORDPRO;
    const chartFormat = willAttach ? formDraft?.chartFormat ?? "chords-over-lyrics" : ("chordpro" as ChartFormat);
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      prefillTitle: formDraft?.title,
      prefillArtist: formDraft?.artist,
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: chordpro,
      prefillChartFormat: chartFormat,
      prefillAttachment: attachment,
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
      prefillAttachment: formDraft?.attachment,
    });

  const handlePrimarySave = () => {
    if (isExisting) return finishExisting();
    if (isForm) return finishForm();
    return finishNew();
  };

  if (phase === "converting") {
    const steps = CONVERT_STEPS[method];
    const stepIdx = Math.min(progress, steps.length - 1);
    return (
      <div className="screen">
        <Header
          title={label}
          onBack={() => {
            if (timer.current) clearInterval(timer.current);
            setPhase("pick");
          }}
        />
        <div className="empty">
          <div className="empty-title" style={{ fontSize: 16 }}>
            {steps[stepIdx]}
          </div>
          <div style={{ width: "100%", height: 4, background: "var(--line)", borderRadius: 99 }}>
            <div
              style={{
                width: `${(progress / steps.length) * 100}%`,
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
        <Header title={label} onBack={() => setPhase("pick")} />
        <div style={{ flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "rgba(140,59,59,.09)", border: "1px solid #8c3b3b", borderRadius: 8, padding: 11, display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 13, color: "#8c3b3b" }}>Couldn't read this file</div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              {method === "musicxml"
                ? "The score uses notation this app doesn't recognize yet."
                : method === "pdf"
                ? "The scan was too blurry to detect chords and lyrics reliably."
                : "The photo was too dark or angled to read clearly."}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <button className="btn btn-primary" onClick={() => startConvert(false)}>
              Try again
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
    const canSave = isExisting || isForm ? true : title.trim().length > 0;
    return (
      <div className="screen">
        <div className="hdr">
          <button className="hdr-action" onClick={() => setConfirmDiscard(true)}>
            Cancel
          </button>
          <span className="hdr-title text-center">{isExisting ? "Attach file" : "Review import"}</span>
          <button className="hdr-action" onClick={handlePrimarySave} style={{ opacity: canSave ? 1 : 0.4 }} disabled={!canSave}>
            {isExisting ? "Attach" : isForm ? "Use this" : "Save"}
          </button>
        </div>
        <div className="flex-1 hidden-scroll" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          {isExisting ? (
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              Attaching {file?.name} to <strong style={{ color: "var(--fg)" }}>{existingSong?.title}</strong> as{" "}
              {existingRole === "sheet-music" ? "sheet music" : "a static file"} — its existing chart won't change.
            </div>
          ) : (
            <div className="muted" style={{ fontSize: 11 }}>
              {willAttach ? `Attached from ${file?.name} — saved as-is, no chords detected.` : `Converted from ${file?.name} — check the details below before saving.`}
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
            ) : (
              <embed src={file!.dataUrl} type="application/pdf" style={{ width: "100%", height: 320, borderRadius: 8, border: "1px solid var(--line)" }} />
            )
          ) : (
            <>
              <div style={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, fontSize: 13 }}>
                <ChordChart chordpro={MOCK_CHORDPRO} />
              </div>
              {!isForm && <div className="field-hint">Detected key: G — fine-tune the chart afterward from Library ⋯ → Edit chart.</div>}
            </>
          )}
        </div>

        {confirmDiscard && (
          <Dialog>
            <div className="dialog-title">Discard this import?</div>
            <div className="dialog-body">{willAttach ? "The attached file won't be saved." : "The converted chart won't be saved."}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <button className="btn btn-primary" onClick={() => setConfirmDiscard(false)}>
                Keep reviewing
              </button>
              <button
                className="btn"
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
          <div style={{ width: "100%", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 11px", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span>{method === "pdf" ? "📄" : method === "photo" ? "🖼" : "🎼"}</span>
            <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
          </div>
        )}
        {file && isExisting && (
          <div style={{ width: "100%", textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Save as</div>
            <div style={{ display: "flex" }}>
              <Segmented
                options={[
                  { value: "sheet-music", label: "Sheet music" },
                  { value: "static-file", label: "Static file" },
                ]}
                value={existingRole}
                onChange={setExistingRole}
              />
            </div>
          </div>
        )}
        {file && !isExisting && canDeclareContent && (
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
            <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
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
                if (isExisting || contentType === "sheet") {
                  goToReview();
                } else {
                  startConvert(false);
                }
              }}
            >
              {isExisting || contentType === "sheet" ? "Continue" : "Convert to chart"}
            </button>
          )}
        </div>
        {file && !isExisting && contentType === "chords" && (
          <button
            className="muted"
            style={{ background: "none", border: "none", fontSize: 11, textDecoration: "underline" }}
            onClick={() => startConvert(true)}
          >
            Simulate a failed scan
          </button>
        )}
      </div>
    </div>
  );
}
