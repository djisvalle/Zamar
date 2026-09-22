import { useEffect, useRef, useState } from "react";
import { useStore, activeSetlistSongIds } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { keySemitoneShift } from "../../utils/chordpro";
import { CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
import type { AttachmentKind } from "../../state/types";
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { MusicToolbar } from "./MusicToolbar";
import { StageToolsSheet } from "./StageToolsSheet";
import { AnnotateScreen } from "./AnnotateScreen";

const IDLE_MS = 6000;
const SWIPE_THRESHOLD = 50;

export function LiveStage() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const { stage } = state;
  const [stageToolsOpen, setStageToolsOpen] = useState(false);
  const [scoreInstruments, setScoreInstruments] = useState<ScoreInstrument[]>([]);
  const [hiddenParts, setHiddenParts] = useState<Set<string>>(new Set());
  const [activeKind, setActiveKind] = useState<AttachmentKind | undefined>(undefined);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number | null>(null);

  const song = stage.songId ? state.songs.find((s) => s.id === stage.songId) : null;
  const hasChords = Boolean(song && song.chordpro.trim());
  const hasAttachment = Boolean(song && Object.keys(song.attachments).length > 0);
  const setlist = stage.setlistId ? state.setlists.find((sl) => sl.id === stage.setlistId) : null;
  const setlistSongIds = activeSetlistSongIds(setlist);

  // Which category/version is on screen belongs to the song currently on
  // stage — reset to that song's saved default kind if it has one and it's
  // still attached, else the highest-priority available category, then that
  // bucket's own default version, whenever the song changes.
  useEffect(() => {
    const attachments = song?.attachments ?? {};
    const savedKind = song?.defaultView && song.defaultView !== "chords" ? song.defaultView : undefined;
    const kind = savedKind && attachments[savedKind] ? savedKind : firstAvailableCategory(attachments);
    setActiveKind(kind);
    setActiveVersionId(kind ? selectedVersion(attachments[kind]!).id : undefined);
  }, [song?.id]);

  // A score's instrument list (and any hidden parts) belongs to whichever
  // version is on screen — clear it whenever that changes so a leftover
  // "Violin hidden" selection can't silently carry over from a different
  // song, or a different version of the same song's score.
  useEffect(() => {
    setScoreInstruments([]);
    setHiddenParts(new Set());
  }, [activeKind, activeVersionId]);

  const toggleInstrument = (id: string) => {
    setHiddenParts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (stage.chromeHidden) dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: false });
    if (song && stage.drawer !== "annotate") {
      idleTimer.current = setTimeout(() => dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true }), IDLE_MS);
    }
  };

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.drawer]);

  if (!song) {
    return (
      <div className="screen">
        <div className="hdr" />
        <div className="empty">
          <div className="empty-title">No song on stage</div>
          <div className="empty-body">
            {state.setlists.find((sl) => sl.id === "sunday")
              ? "Pick from your library, or start the Sunday AM set."
              : "Pick a song from your library to get started."}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%", marginTop: 4 }}>
            <button className="btn btn-primary" onClick={() => nav.switchTab("library")}>
              Browse library
            </button>
            {state.setlists.find((sl) => sl.id === "sunday") && (
              <button
                className="btn"
                onClick={() => {
                  const ids = activeSetlistSongIds(state.setlists.find((sl) => sl.id === "sunday"));
                  dispatch({ type: "STAGE_LOAD", songId: ids[0], setlistId: "sunday", setlistIndex: 0 });
                }}
              >
                Start Sunday AM — Aug 23
              </button>
            )}
            <button className="btn" onClick={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}>
              Add a song to stage
            </button>
          </div>
        </div>
        {stage.drawer === "add-song" && (
          <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
        )}
      </div>
    );
  }

  const semitones = keySemitoneShift(song.defaultKey, stage.dispKey ?? song.defaultKey);
  const songIndex = setlistSongIds.indexOf(song.id);
  const availableKinds = CATEGORY_PRIORITY.filter((k) => song.attachments[k]);
  const activeBucket = activeKind ? song.attachments[activeKind] : undefined;
  const activeVersion = activeBucket ? activeBucket.versions.find((v) => v.id === activeVersionId) ?? selectedVersion(activeBucket) : undefined;

  const chordsAnnotated = Boolean(song.annotations.chords?.length);
  const musicxmlAnnotated = Boolean(song.annotations.musicxml?.length);
  const transposeLocked = chordsAnnotated || musicxmlAnnotated;

  if (stage.drawer === "annotate") {
    return (
      <AnnotateScreen
        song={song}
        view={stage.view}
        activeKind={activeKind}
        activeVersion={activeVersion}
        semitones={semitones}
        hiddenParts={hiddenParts}
        fontScale={stage.zoom / 100}
        onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })}
      />
    );
  }

  const goToSongOffset = (delta: 1 | -1) => {
    if (!setlist) return;
    if (delta === 1) {
      dispatch({ type: "STAGE_ADVANCE" });
      return;
    }
    const prevIndex = songIndex - 1;
    if (prevIndex < 0) return;
    dispatch({ type: "STAGE_LOAD", songId: setlistSongIds[prevIndex], setlistId: setlist.id, setlistIndex: prevIndex });
  };

  const selectChordsView = () => {
    dispatch({ type: "STAGE_SET_VIEW", view: "chords" });
  };
  const selectSheetView = (kind: AttachmentKind, versionId?: string) => {
    setActiveKind(kind);
    setActiveVersionId(versionId ?? selectedVersion(song.attachments[kind]!).id);
    dispatch({ type: "STAGE_SET_VIEW", view: "sheet" });
  };

  const onChartPointerDown = (e: React.PointerEvent) => {
    swipeStartX.current = e.clientX;
  };
  const onChartPointerUp = (e: React.PointerEvent) => {
    const startX = swipeStartX.current;
    swipeStartX.current = null;
    if (startX == null || !setlist) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    goToSongOffset(dx < 0 ? 1 : -1);
  };

  const onScreenClick = () => {
    resetIdle();
  };

  return (
    <div className="screen" onClick={onScreenClick}>
      <div className={"hdr" + (setlist ? " tinted" : "")} />

      {setlist && (
        <div style={{ padding: "8px 14px 0" }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
            {songIndex + 1 < setlistSongIds.length
              ? `Next: ${state.songs.find((s) => s.id === setlistSongIds[songIndex + 1])?.title ?? ""}`
              : "Last song"}
          </div>
          <div style={{ width: "100%", height: 4, background: "var(--line)", borderRadius: 99 }}>
            <div
              style={{
                width: `${((songIndex + 1) / setlistSongIds.length) * 100}%`,
                height: 4,
                background: "var(--acc)",
                borderRadius: 99,
                transition: "width .2s",
              }}
            />
          </div>
        </div>
      )}

      <div style={{ padding: "10px 14px 8px" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 19 }}>{song.title}</div>
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
          {song.artist}
        </div>
      </div>

      <div
        className="flex-1 hidden-scroll"
        style={{
          padding: "16px 14px 150px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          touchAction: "pan-y",
          background: stage.view === "sheet" ? "var(--sheet-bg)" : undefined,
          color: stage.view === "sheet" ? "var(--sheet-fg)" : undefined,
        }}
        onPointerDown={onChartPointerDown}
        onPointerUp={onChartPointerUp}
      >
        {stage.view === "chords" ? (
          <ChordChart
            chordpro={song.chordpro}
            semitones={semitones}
            fontScale={stage.zoom / 100}
            hideChords={stage.lyricsOnly}
          />
        ) : activeKind && activeVersion ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0" }}>
            {activeKind === "image" ? (
              <img
                src={activeVersion.dataUrl}
                alt={activeVersion.name}
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : activeKind === "musicxml" ? (
              <MxlScore
                src={activeVersion.dataUrl}
                transpose={semitones}
                hiddenParts={hiddenParts}
                onInstrumentsChange={setScoreInstruments}
                disableZoom={musicxmlAnnotated}
              />
            ) : (
              <PdfPages src={activeVersion.dataUrl} />
            )}
            <span style={{ fontSize: 11, color: "var(--sheet-mut)" }}>
              {activeKind === "musicxml"
                ? `${activeVersion.name} · engraved from the score, no chords detected`
                : `${activeVersion.name} · saved as-is, no chords detected`}
            </span>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-title" style={{ color: "var(--sheet-fg)" }}>No sheet music attached</div>
            <div className="empty-body" style={{ color: "var(--sheet-mut)" }}>Attach a PDF, photo, or MusicXML score from Add/Edit Song to see it here.</div>
          </div>
        )}
      </div>

      {!stage.chromeHidden && (hasChords || hasAttachment) && (
        <MusicToolbar transposeLocked={transposeLocked} onOpenTools={() => setStageToolsOpen(true)} />
      )}

      {stage.drawer === "add-song" && (
        <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stageToolsOpen && (
        <StageToolsSheet
          song={song}
          view={stage.view}
          hasChords={hasChords}
          availableKinds={availableKinds}
          activeKind={activeKind}
          activeVersionId={activeVersionId}
          onSelectChords={selectChordsView}
          onSelectSheet={selectSheetView}
          instruments={scoreInstruments}
          hiddenParts={hiddenParts}
          onToggleInstrument={toggleInstrument}
          chordsLocked={chordsAnnotated}
          instrumentsLocked={musicxmlAnnotated}
          onAddSong={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}
          onQuickEdit={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" })}
          onAnnotate={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" })}
          onClose={() => setStageToolsOpen(false)}
        />
      )}
    </div>
  );
}

