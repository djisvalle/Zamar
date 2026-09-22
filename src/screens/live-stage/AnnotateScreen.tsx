import { useRef, useState } from "react";
import { useStore } from "../../state/store";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type MxlScoreHandle } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { Icon, type IconName } from "../../components/Icon";
import { Dialog } from "../../components/Overlays";
import { Segmented } from "../../components/Toggle";
import { AnnotateCanvas, type AnnotateTool } from "../../components/AnnotateCanvas";
import type { AnnotationObject, AnnotationView, AttachmentKind, AttachmentVersion, ChartView, Song } from "../../state/types";

export function AnnotateScreen({
  song,
  view,
  activeKind,
  activeVersion,
  semitones,
  hiddenParts,
  fontScale,
  onClose,
}: {
  song: Song;
  view: ChartView;
  activeKind?: AttachmentKind;
  activeVersion?: AttachmentVersion;
  semitones: number;
  hiddenParts: ReadonlySet<string>;
  fontScale: number;
  onClose: () => void;
}) {
  const { state, dispatch } = useStore();
  const annotationView: AnnotationView = view === "chords" ? "chords" : activeKind ?? "chords";
  // Matches the exact condition that produces the "Nothing to annotate yet"
  // fallback in `content` below — there's no real chart to attribute marks
  // to, so `done()` must not write to `annotations` at all in this case.
  const noAnnotationTarget = view === "sheet" && activeKind === undefined;

  const [mode, setMode] = useState<"draw" | "cues">("draw");
  const [tool, setTool] = useState<AnnotateTool>("pen");
  const [scrollMode, setScrollMode] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationObject[]>(() => song.annotations[annotationView] ?? []);
  // Captures the exact array reference `annotations` started from, so
  // `done()` can tell "never drew/erased/pinned this session" (still the
  // same reference) from "drew, then cleared back to []" (a new, different
  // empty array).
  const initialAnnotationsRef = useRef(annotations);
  const [history, setHistory] = useState<AnnotationObject[][]>([]);
  const [cuesText, setCuesText] = useState(song.notes);
  const [confirmClear, setConfirmClear] = useState(false);
  const mxlScoreRef = useRef<MxlScoreHandle>(null);
  const [reprojectTick, setReprojectTick] = useState(0);

  const commit = (next: AnnotationObject[]) => {
    setHistory((h) => [...h, annotations]);
    setAnnotations(next);
  };

  // Silently syncs positions after a transpose re-render — not a user edit,
  // so it bypasses history (see AnnotateCanvas's onReproject doc).
  const reproject = (next: AnnotationObject[]) => setAnnotations(next);

  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      setAnnotations(h[h.length - 1]);
      return h.slice(0, -1);
    });
  };

  const done = () => {
    const cuesChanged = cuesText !== song.notes;
    const annotationsChanged = annotations !== initialAnnotationsRef.current;
    if (!cuesChanged && !annotationsChanged) {
      onClose();
      return;
    }
    dispatch({
      type: "UPDATE_SONG",
      song: {
        ...song,
        notes: cuesText,
        annotations: noAnnotationTarget ? song.annotations : { ...song.annotations, [annotationView]: annotations },
      },
    });
    onClose();
  };

  const content =
    view === "chords" ? (
      <div style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 13, lineHeight: 1.35 }}>
        <ChordChart chordpro={song.chordpro} semitones={semitones} fontScale={fontScale} />
      </div>
    ) : activeKind === "image" && activeVersion ? (
      <img src={activeVersion.dataUrl} alt={activeVersion.name} style={{ width: "100%", display: "block" }} />
    ) : activeKind === "musicxml" && activeVersion ? (
      <div style={{ padding: 8 }}>
        <MxlScore
          ref={mxlScoreRef}
          src={activeVersion.dataUrl}
          transpose={semitones}
          hiddenParts={hiddenParts}
          disableZoom
          staveSpacing={state.settings.staveSpacing}
          onRerendered={() => setReprojectTick((t) => t + 1)}
        />
      </div>
    ) : activeKind === "pdf" && activeVersion ? (
      <PdfPages src={activeVersion.dataUrl} disableZoom />
    ) : (
      <div className="muted" style={{ padding: 20, fontSize: 12, textAlign: "center" }}>
        Nothing to annotate yet.
      </div>
    );

  return (
    <div className="screen">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "12px 14px",
          background: "var(--tint)",
          borderBottom: "1px solid var(--acc)",
        }}
      >
        <button className="hdr-action" onClick={undo} disabled={history.length === 0}>
          Undo
        </button>
        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <Segmented
            options={[
              { value: "draw", label: "Draw" },
              { value: "cues", label: "Cues" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <button className="hdr-action" onClick={done}>
          Done
        </button>
      </div>

      <div className="flex-1 hidden-scroll" style={{ position: "relative" }}>
        {mode === "draw" ? (
          <AnnotateCanvas
            annotations={annotations}
            tool={tool}
            onCommit={commit}
            onReproject={reproject}
            scrollMode={scrollMode}
            scoreRef={annotationView === "musicxml" ? mxlScoreRef : undefined}
            reprojectSignal={annotationView === "musicxml" ? reprojectTick : undefined}
          >
            {content}
          </AnnotateCanvas>
        ) : (
          <textarea
            value={cuesText}
            onChange={(e) => setCuesText(e.target.value)}
            placeholder="Cues for this song — reminders, anything you want on hand while you're on stage."
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              padding: "16px 14px",
              fontFamily: "inherit",
              fontSize: 14,
              lineHeight: 1.5,
              background: "var(--bg)",
              color: "var(--fg)",
              resize: "none",
            }}
          />
        )}
      </div>

      {mode === "draw" && (
        <div
          style={{
            position: "absolute",
            top: 64,
            right: 10,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "8px 6px",
            borderRadius: 14,
            background: "var(--surface)",
            border: "1px solid var(--line)",
            alignItems: "center",
          }}
        >
          <span style={{ width: 18, height: 18, borderRadius: 99, background: "var(--acc)", border: "2px solid var(--surface)" }} />
          <span style={{ width: 20, height: 1, background: "var(--line)" }} />
          <ToolButton icon="edit" active={tool === "pen"} onClick={() => { setTool("pen"); setScrollMode(false); }} label="Pen" />
          <ToolButton icon="square" active={tool === "square"} onClick={() => { setTool("square"); setScrollMode(false); }} label="Rectangle" />
          <ToolButton icon="note" active={tool === "pin"} onClick={() => { setTool("pin"); setScrollMode(false); }} label="Pin" />
          <ToolButton icon="eraser" active={tool === "eraser"} onClick={() => { setTool("eraser"); setScrollMode(false); }} label="Eraser" />
          <span style={{ width: 20, height: 1, background: "var(--line)" }} />
          <ToolButton icon="grip" active={scrollMode} onClick={() => setScrollMode((s) => !s)} label="Scroll" />
          <button
            onClick={() => setConfirmClear(true)}
            disabled={annotations.length === 0}
            style={{
              background: "none",
              border: "none",
              color: "#8c3b3b",
              fontSize: 10,
              fontWeight: 600,
              opacity: annotations.length === 0 ? 0.35 : 1,
            }}
          >
            Clear
          </button>
        </div>
      )}

      {confirmClear && (
        <Dialog>
          <div className="dialog-title">Clear marks on this view?</div>
          <div className="dialog-body">This can't be undone once you leave Annotate.</div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmClear(false)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setConfirmClear(false);
                commit([]);
              }}
            >
              Clear
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function ToolButton({
  icon,
  active,
  onClick,
  label,
}: {
  icon: IconName;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{ background: "none", border: "none", color: active ? "var(--acc)" : "var(--mut)", display: "flex" }}
    >
      <Icon name={icon} size={15} strokeWidth={1.9} />
    </button>
  );
}
