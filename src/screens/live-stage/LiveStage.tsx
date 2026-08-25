import { useEffect, useRef, useState } from "react";
import { useStore, activeSetlistSongIds } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { ChordChart } from "../../components/ChordChart";
import { ScorePreview } from "../../components/ScorePreview";
import { keySemitoneShift } from "../../utils/chordpro";
import { MenuDrawer } from "./MenuDrawer";
import { AddSongDrawer } from "./AddSongDrawer";
import { QuickEditSheet } from "./QuickEditSheet";
import { InstrumentFilterModal } from "./InstrumentFilterModal";
import { MusicToolbar } from "./MusicToolbar";

const IDLE_MS = 6000;
const SWIPE_THRESHOLD = 50;

export function LiveStage() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const { stage } = state;
  const [menuOpen, setMenuOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number | null>(null);

  const song = stage.songId ? state.songs.find((s) => s.id === stage.songId) : null;
  const hasChords = Boolean(song && song.chordpro.trim());
  const setlist = stage.setlistId ? state.setlists.find((sl) => sl.id === stage.setlistId) : null;
  const setlistSongIds = activeSetlistSongIds(setlist);

  const resetIdle = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (stage.chromeHidden) dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: false });
    if (song && !stage.ended && !stage.annotate) {
      idleTimer.current = setTimeout(() => dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true }), IDLE_MS);
    }
  };

  useEffect(() => {
    resetIdle();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.ended, stage.annotate]);

  if (stage.annotate && song) {
    return <AnnotateMode song={song} onDone={() => dispatch({ type: "STAGE_TOGGLE_ANNOTATE" })} />;
  }

  if (stage.ended && setlist) {
    const path = setlistSongIds.map((id) => state.songs.find((s) => s.id === id)?.defaultKey).join(" → ");
    return (
      <div className="screen" onClick={resetIdle}>
        <div className="hdr tinted">
          <button className="hdr-btn" onClick={() => setMenuOpen(true)}>
            ☰
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
            ☰
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
          <button className="fab" onClick={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" })}>
            +
          </button>
          <button className="fab-mini" style={{ opacity: 0.4 }} disabled>
            ✎
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
          ☰
        </button>
        <span className={"live-badge" + (setlist ? " active" : "")} onClick={() => setlist && resetIdle()}>
          <span className="dot" />
          LIVE
        </span>
      </div>

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
                  onClick={() => dispatch({ type: "STAGE_SET_VIEW", view: "sheet" })}
                  style={{
                    fontSize: 11,
                    padding: "4px 11px",
                    borderRadius: 5,
                    border: "none",
                    fontWeight: 700,
                    background: stage.view === "sheet" ? "var(--acc)" : "transparent",
                    color: stage.view === "sheet" ? "var(--onacc)" : "var(--mut)",
                  }}
                >
                  {song.attachment?.role === "static-file" ? "File" : "Sheet"}
                </button>
              </div>
              {stage.view === "chords" ? (
                <div className="accent-deep" style={{ fontSize: 10, fontWeight: 700 }}>
                  Key of {stage.dispKey}
                </div>
              ) : song.attachment ? (
                <div className="muted" style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>
                  {song.attachment.role === "sheet-music" ? "SHEET MUSIC" : "STATIC FILE"}
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
        ) : song.attachment ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0" }}>
            {song.attachment.kind === "image" ? (
              <img
                src={song.attachment.dataUrl}
                alt={song.attachment.name}
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : (
              <embed
                src={song.attachment.dataUrl}
                type="application/pdf"
                style={{ width: "100%", height: "100%", minHeight: 400, borderRadius: 8, border: "1px solid var(--line)" }}
              />
            )}
            <span className="muted" style={{ fontSize: 11 }}>
              {song.attachment.name} · saved as-is, no chords detected
            </span>
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "8px 0",
            }}
          >
            <ScorePreview />
            <span className="muted" style={{ fontSize: 11 }}>
              Rendered MusicXML score
            </span>
          </div>
        )}
      </div>

      {!stage.chromeHidden && !stage.toolbarExpanded && (
        <div className="fab-stack">
          <button className="fab" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "add-song" }); }}>
            +
          </button>
          <button className="fab-mini" onClick={(e) => { e.stopPropagation(); dispatch({ type: "STAGE_OPEN_DRAWER", drawer: "quick-edit" }); }}>
            ✎
          </button>
        </div>
      )}

      {!stage.chromeHidden && hasChords && <MusicToolbar onAnnotate={() => dispatch({ type: "STAGE_TOGGLE_ANNOTATE" })} />}

      {menuOpen && <MenuDrawer onClose={() => setMenuOpen(false)} />}
      {stage.drawer === "add-song" && (
        <AddSongDrawer onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {partsOpen && <InstrumentFilterModal onClose={() => setPartsOpen(false)} />}
    </div>
  );
}

function AnnotateMode({ song, onDone }: { song: { chordpro: string }; onDone: () => void }) {
  return (
    <div className="screen">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", background: "var(--tint)", borderBottom: "1px solid var(--acc)" }}>
        <button className="hdr-action" onClick={onDone}>
          Undo
        </button>
        <span className="flex-1 text-center muted" style={{ fontSize: 12 }}>
          Annotating
        </span>
        <button className="hdr-action" onClick={onDone}>
          Done
        </button>
      </div>
      <div className="flex-1" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 11, fontSize: 13, lineHeight: 1.35 }}>
        <ChordChart chordpro={song.chordpro} hideChords />
      </div>
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
        <span style={{ fontSize: 12, color: "var(--acc)" }}>✎</span>
        <span className="muted" style={{ fontSize: 12 }}>
          ▭
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          ⌫
        </span>
      </div>
    </div>
  );
}
