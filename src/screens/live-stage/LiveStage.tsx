import { useEffect, useRef, useState } from "react";
import { useStore, activeSetlistSongIds } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Overlays";
import { keySemitoneShift } from "../../utils/chordpro";
import { ATTACHMENT_LABEL, CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
import type { AttachmentKind } from "../../state/types";
import { MenuDrawer } from "./MenuDrawer";
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { InstrumentFilterModal } from "./InstrumentFilterModal";
import { MusicToolbar } from "./MusicToolbar";
import { AnnotateScreen } from "./AnnotateScreen";

const IDLE_MS = 6000;
const SWIPE_THRESHOLD = 50;

export function LiveStage() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const { stage } = state;
  const [menuOpen, setMenuOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [versionPickerOpen, setVersionPickerOpen] = useState(false);
  const [scoreInstruments, setScoreInstruments] = useState<ScoreInstrument[]>([]);
  const [hiddenParts, setHiddenParts] = useState<Set<string>>(new Set());
  const [activeKind, setActiveKind] = useState<AttachmentKind | undefined>(undefined);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number | null>(null);

  const song = stage.songId ? state.songs.find((s) => s.id === stage.songId) : null;
  const hasChords = Boolean(song && song.chordpro.trim());
  const hasScore = Boolean(song?.attachments.musicxml);
  const setlist = stage.setlistId ? state.setlists.find((sl) => sl.id === stage.setlistId) : null;
  const setlistSongIds = activeSetlistSongIds(setlist);

  // Which category/version is on screen belongs to the song currently on
  // stage — reset to that song's default (highest-priority category, its
  // bucket's default version) whenever the song changes.
  useEffect(() => {
    const attachments = song?.attachments ?? {};
    const kind = firstAvailableCategory(attachments);
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
    if (song && !stage.ended && stage.drawer !== "annotate") {
      idleTimer.current = setTimeout(() => dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true }), IDLE_MS);
    }
  };

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.ended, stage.drawer]);

  if (stage.ended && setlist) {
    const path = setlistSongIds.map((id) => state.songs.find((s) => s.id === id)?.defaultKey).join(" → ");
    return (
      <div className="screen" onClick={resetIdle}>
        <div className="hdr tinted">
          <button className="hdr-btn" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" size={20} strokeWidth={2} />
          </button>
          <span className="live-badge active">
            <span className="dot" />
            LIVE
          </span>
        </div>
        <div className="empty">
          <div className="empty-title">Set complete</div>
          <div className="empty-body">
            {path} · {setlistSongIds.length} songs
          </div>
          <div className="btn-row" style={{ flexDirection: "column" }}>
            <button className="btn btn-primary" onClick={() => nav.push("setlist-detail", { setlistId: setlist.id })}>
              Back to setlist
            </button>
            <button className="btn" onClick={() => dispatch({ type: "STAGE_REPLAY" })}>
              Replay from song 1
            </button>
          </div>
        </div>
        {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
      </div>
    );
  }

  if (!song) {
    return (
      <div className="screen">
        <div className="hdr">
          <button className="hdr-btn" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" size={20} strokeWidth={2} />
          </button>
          <span className="live-badge">
            <span className="dot" />
            LIVE
          </span>
        </div>
        <div className="empty">
          <div className="empty-title">No song on stage</div>
          <div className="empty-body">
            {state.setlists.find((sl) => sl.id === "sunday")
              ? "Pick from your library, or start the Sunday AM set."
              : "Pick a song from your library to get started."}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7, width: "100%", marginTop: 4 }}>
            <button className="btn btn-primary" onClick={() => nav.push("library")}>
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
          </div>
        </div>
        <div className="fab-stack">
          <button className="fab" onClick={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })} aria-label="Add song to stage">
            <Icon name="plus" size={24} strokeWidth={2} />
          </button>
          <button className="fab-mini" style={{ opacity: 0.4 }} disabled aria-label="Quick edit">
            <Icon name="edit" size={17} strokeWidth={1.9} />
          </button>
        </div>
        {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
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
    if (stage.toolbarExpanded) dispatch({ type: "STAGE_TOGGLE_TOOLBAR" });
  };

  return (
    <div className="screen" onClick={onScreenClick}>
      <div className={"hdr" + (setlist ? " tinted" : "")}>
        <button className="hdr-btn" onClick={() => setMenuOpen(true)}>
          <Icon name="menu" size={20} strokeWidth={2} />
        </button>
        <span className={"live-badge" + (setlist ? " active" : "")} onClick={() => setlist && resetIdle()}>
          <span className="dot" />
          LIVE
        </span>
      </div>

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

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "10px 14px 8px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 19 }}>{song.title}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                {song.artist}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flex: "none" }}>
              <div style={{ display: "flex", gap: 2, background: "var(--line)", borderRadius: 8, padding: 3 }}>
                <button
                  disabled={!hasChords}
                  onClick={() => dispatch({ type: "STAGE_SET_VIEW", view: "chords" })}
                  style={{
                    fontSize: 11,
                    padding: "4px 11px",
                    borderRadius: 5,
                    border: "none",
                    fontWeight: 700,
                    opacity: hasChords ? 1 : 0.35,
                    background: stage.view === "chords" ? "var(--acc)" : "transparent",
                    color: stage.view === "chords" ? "var(--onacc)" : "var(--mut)",
                  }}
                >
                  Chord
                </button>
                <button
                  disabled={availableKinds.length === 0}
                  onClick={() => dispatch({ type: "STAGE_SET_VIEW", view: "sheet" })}
                  style={{
                    fontSize: 11,
                    padding: "4px 11px",
                    borderRadius: 5,
                    border: "none",
                    fontWeight: 700,
                    opacity: availableKinds.length === 0 ? 0.35 : 1,
                    background: stage.view === "sheet" ? "var(--acc)" : "transparent",
                    color: stage.view === "sheet" ? "var(--onacc)" : "var(--mut)",
                  }}
                >
                  {activeKind ? ATTACHMENT_LABEL[activeKind] : "Sheet"}
                </button>
              </div>
              {stage.view === "chords" ? (
                <div className="accent-deep" style={{ fontSize: 10, fontWeight: 700 }}>
                  Key of {stage.dispKey}
                </div>
              ) : activeKind ? (
                <div className="muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>
                  {ATTACHMENT_LABEL[activeKind].toUpperCase()}
                </div>
              ) : (
                <button
                  className="chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPartsOpen(true);
                  }}
                >
                  Parts · 2/3
                </button>
              )}
            </div>
      </div>

      {stage.view === "sheet" && availableKinds.length > 1 && (
        <div style={{ display: "flex", gap: 6, padding: "0 14px 8px" }}>
          {availableKinds.map((k) => (
            <button
              key={k}
              className={"chip" + (activeKind === k ? " active" : "")}
              onClick={(e) => {
                e.stopPropagation();
                setActiveKind(k);
                setActiveVersionId(selectedVersion(song.attachments[k]!).id);
              }}
            >
              {ATTACHMENT_LABEL[k]}
            </button>
          ))}
        </div>
      )}
      {stage.view === "sheet" && activeBucket && activeVersion && activeBucket.versions.length > 1 && (
        <div style={{ padding: "0 14px 8px" }}>
          <button
            className="chip"
            style={{ borderColor: "var(--acc-deep)", color: "var(--acc-deep)" }}
            onClick={(e) => {
              e.stopPropagation();
              setVersionPickerOpen(true);
            }}
          >
            ▾ {activeVersion.label}
          </button>
        </div>
      )}

      <div
        className="flex-1 hidden-scroll"
        style={{
          padding: "16px 14px 150px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          touchAction: "pan-y",
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
            <span className="muted" style={{ fontSize: 11 }}>
              {activeKind === "musicxml"
                ? `${activeVersion.name} · engraved from the score, no chords detected`
                : `${activeVersion.name} · saved as-is, no chords detected`}
            </span>
          </div>
        ) : (
          <div className="empty">
            <div className="empty-title">No sheet music attached</div>
            <div className="empty-body">Attach a PDF, photo, or MusicXML score from Add/Edit Song to see it here.</div>
          </div>
        )}
      </div>

      {!stage.chromeHidden && !stage.toolbarExpanded && (
        <div className="fab-stack">
          <button className="fab" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" }); }} aria-label="Add song to stage">
            <Icon name="plus" size={24} strokeWidth={2} />
          </button>
          <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" }); }} aria-label="Quick edit">
            <Icon name="edit" size={17} strokeWidth={1.9} />
          </button>
          <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "annotate" }); }} aria-label="Annotate">
            <Icon name="annotate" size={17} strokeWidth={1.9} />
          </button>
        </div>
      )}

      {!stage.chromeHidden && (hasChords || hasScore) && (
        <MusicToolbar
          view={stage.view}
          hasChords={hasChords}
          instruments={scoreInstruments}
          hiddenParts={hiddenParts}
          onToggleInstrument={toggleInstrument}
          transposeLocked={transposeLocked}
          chordsLocked={chordsAnnotated}
          instrumentsLocked={musicxmlAnnotated}
        />
      )}

      {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
      {stage.drawer === "add-song" && (
        <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {partsOpen && <InstrumentFilterModal onClose={() => setPartsOpen(false)} />}
      {versionPickerOpen && activeKind && activeBucket && (
        <Sheet onClose={() => setVersionPickerOpen(false)}>
          <div className="sheet-title">{ATTACHMENT_LABEL[activeKind]} versions</div>
          {activeBucket.versions.map((v) => (
            <button
              key={v.id}
              className="sheet-row"
              onClick={() => {
                setActiveVersionId(v.id);
                setVersionPickerOpen(false);
              }}
            >
              <span>
                {v.label} <span className="muted">· {v.name}</span>
              </span>
              <span className="accent-deep" style={{ opacity: v.id === activeVersionId ? 1 : 0, display: "flex" }}>
                <Icon name="check" size={14} strokeWidth={2.2} />
              </span>
            </button>
          ))}
        </Sheet>
      )}
    </div>
  );
}

