import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useStore, activeSetlistSlots, activeSetlistSongIds } from "../../state/store";
import { useNavigator } from "../../navigation/Navigator";
import { ChordChart } from "../../components/ChordChart";
import { MxlScore, type MxlScoreHandle, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { AnnotateCanvas } from "../../components/AnnotateCanvas";
import { Icon } from "../../components/Icon";
import { syncAnnotationWidths } from "../../utils/annotations";
import { activeKeyChange, keySemitoneShift } from "../../utils/keys";
import { CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
import type { AnnotationObject, AnnotationView, AttachmentKind } from "../../state/types";
import { AddSongSheet } from "./AddSongSheet";
import { QuickEditSheet } from "./QuickEditSheet";
import { MusicToolbar } from "./MusicToolbar";
import { StageToolsSheet } from "./StageToolsSheet";
import { AnnotateToolbar, useAnnotateSession } from "./AnnotateOverlay";

const IDLE_MS = 6000;
const SWIPE_THRESHOLD = 50;
// A tap that drifts further than this is a scroll/drag, not a tap.
const TAP_SLOP = 10;
// Matches the double-tap window PdfPages/MxlScore use to reset zoom.
const DOUBLE_TAP_MS = 320;

/** The chart pane's width in portrait, which the chart is laid out at in
 * both orientations, plus the pane's current width, which it's magnified to
 * fill. Marks sit at pixel positions over the chart, and a score or chord
 * chart reflows to its width, so a chart laid out at the screen width would
 * change under its marks on every rotation; magnifying one fixed layout
 * keeps the page and its marks together, like zooming a page. Native reads the physical screen rather than the web view, which shrinks
 * when the on-screen keyboard opens (typing a text mark). */
function usePortraitWidth(scrollRef: React.RefObject<HTMLDivElement | null>, mounted: boolean) {
  const [widths, setWidths] = useState<{ portrait: number; pane: number } | null>(null);
  useLayoutEffect(() => {
    const pane = scrollRef.current;
    if (!pane) return;
    const device = pane.closest<HTMLElement>(".device") ?? document.documentElement;
    const measure = () => {
      const shortSide = Capacitor.isNativePlatform()
        ? Math.min(window.screen.width, window.screen.height)
        : Math.min(device.clientWidth, device.clientHeight);
      const paneWidth = pane.clientWidth;
      const portrait = Math.round(Math.min(shortSide, paneWidth));
      setWidths((prev) =>
        portrait > 0 && (prev?.portrait !== portrait || prev.pane !== paneWidth) ? { portrait, pane: paneWidth } : prev
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(device);
    ro.observe(pane);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);
  return widths;
}

export function LiveStage() {
  const { state, dispatch } = useStore();
  const nav = useNavigator();
  const { stage } = state;
  const [stageToolsOpen, setStageToolsOpen] = useState(false);
  // The slot's band note shows one line until tapped open.
  const [slotNoteExpanded, setSlotNoteExpanded] = useState(false);
  const [scoreInstruments, setScoreInstruments] = useState<ScoreInstrument[]>([]);
  const [hiddenParts, setHiddenParts] = useState<Set<string>>(new Set());
  const [activeKind, setActiveKind] = useState<AttachmentKind | undefined>(undefined);
  const [activeVersionId, setActiveVersionId] = useState<string | undefined>(undefined);
  const mxlScoreRef = useRef<MxlScoreHandle>(null);
  const [reprojectTick, setReprojectTick] = useState(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number | null>(null);
  const tapStart = useRef<{ x: number; y: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const song = stage.songId ? state.songs.find((s) => s.id === stage.songId) : null;
  const hasChords = Boolean(song && song.chordpro.trim());
  const hasAttachment = Boolean(song && Object.keys(song.attachments).length > 0);
  const setlist = stage.setlistId ? state.setlists.find((sl) => sl.id === stage.setlistId) : null;
  const setlistSongIds = activeSetlistSongIds(setlist);
  const setlistSlots = activeSetlistSlots(setlist);

  const dockOpen = stage.drawer === "annotate";
  const annotationView: AnnotationView = stage.view === "chords" ? "chords" : activeKind ?? "chords";
  // The chart's scroll container. The chart inside it is laid out at
  // `layoutWidth`, the content width marks are placed against (see
  // Song.annotationWidths), then magnified by `chartScale` to fill the pane.
  const chartScrollRef = useRef<HTMLDivElement | null>(null);
  const paneWidths = usePortraitWidth(chartScrollRef, Boolean(song));
  // A marked view keeps the width it was marked at (a landscape tablet, or
  // another device), scaled up or down to this pane like any other chart.
  const markedWidth = song?.annotationWidths?.[annotationView];
  const layoutWidth = markedWidth ?? paneWidths?.portrait ?? null;
  const rawScale = paneWidths && layoutWidth ? paneWidths.pane / layoutWidth : 1;
  // Snaps near-1 to exactly 1, so portrait isn't a hair off and blurred.
  const chartScale = Math.abs(rawScale - 1) < 0.005 ? 1 : rawScale;
  // The magnification is a transform, which doesn't change layout, so the
  // pane's scroll height comes from the chart's measured height instead.
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [chartHeight, setChartHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => setChartHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [Boolean(song)]);
  const annotateSession = useAnnotateSession({
    song: song ?? null,
    open: dockOpen,
    annotationView,
    // Matches the condition that produces the "No sheet music attached"
    // fallback in `content` below — there's no real chart to attribute
    // marks to then.
    noAnnotationTarget: stage.view === "sheet" && activeKind === undefined,
    contentWidth: () => layoutWidth,
    onClose: () => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null }),
  });

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

  // Each song opens at the top of its chart. The scroll container stays
  // mounted between songs, so without this the next song showed wherever
  // the previous one had been scrolled to. Layout effect so the old offset
  // never paints against the new chart.
  useLayoutEffect(() => {
    const el = chartScrollRef.current;
    if (el) {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
    // setlistIndex too: a reprise is the same song in a new slot.
  }, [song?.id, stage.setlistIndex]);

  // Each slot's note opens collapsed, like its chart opens at the top.
  useEffect(() => {
    setSlotNoteExpanded(false);
  }, [stage.setlistId, stage.setlistIndex]);

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
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.songId, stage.drawer]);

  // Marks saved before Song.annotationWidths existed have no recorded width.
  // This is the device they're being used on, so the width they show at now
  // is the best guess, recorded once so export can place them.
  useEffect(() => {
    if (!song) return;
    const synced = syncAnnotationWidths(song, layoutWidth);
    if (synced !== song) dispatch({ type: "UPDATE_SONG", song: synced });
  }, [song, layoutWidth, dispatch]);

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
          <AddSongSheet onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
        )}
      </div>
    );
  }

  const displayKey = stage.dispKey ?? song.defaultKey;
  const semitones = keySemitoneShift(song.defaultKey, displayKey);
  const keyChange = activeKeyChange(song.defaultKey, displayKey, state.settings.strictSpelling);
  // The slot on stage, not the song's first slot: a reprise is the same
  // song further down the set.
  const songIndex = setlistSongIds[stage.setlistIndex] === song.id ? stage.setlistIndex : setlistSongIds.indexOf(song.id);
  // Setlist "Note for the band" for this slot and the next one.
  const slotNote = setlistSlots[songIndex]?.note?.trim();
  const nextSlotNote = setlistSlots[songIndex + 1]?.note?.trim();
  const availableKinds = CATEGORY_PRIORITY.filter((k) => song.attachments[k]);
  const activeBucket = activeKind ? song.attachments[activeKind] : undefined;
  const activeVersion = activeBucket ? activeBucket.versions.find((v) => v.id === activeVersionId) ?? selectedVersion(activeBucket) : undefined;

  const chordsAnnotated = Boolean(song.annotations.chords?.length);
  const musicxmlAnnotated = Boolean(song.annotations.musicxml?.length);
  // A marked chord chart stays at the size it was marked at (see
  // Song.chordsTextScale), so a text-size change elsewhere can't reflow the
  // lyrics out from under its marks.
  const chordsTextScale = chordsAnnotated ? song.chordsTextScale ?? state.settings.textScale : state.settings.textScale;
  const persistedAnnotations: AnnotationObject[] = song.annotations[annotationView] ?? [];
  // Reprojection (see AnnotateCanvas's onReproject doc) keeps anchored
  // MusicXML annotations aligned after a transpose even while the Annotate
  // dock is closed — the read-only overlay below is the only thing that can
  // persist that silently-corrected position back to the store when nobody
  // has the dock open to do it via Done.
  const onReprojectPersisted = (next: AnnotationObject[]) => {
    dispatch({ type: "UPDATE_SONG", song: { ...song, annotations: { ...song.annotations, [annotationView]: next } } });
  };

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
    // No song-to-song swipes while annotating — a stroke is a horizontal
    // drag too, and the stage is meant to stay put under the pen.
    if (dockOpen) return;
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

  const hideChromeNow = () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    dispatch({ type: "STAGE_SET_CHROME_HIDDEN", hidden: true });
  };

  // Recorded in the capture phase: PdfPages/MxlScore stop propagation of
  // their own pan/pinch pointer events, and a tap still needs its start.
  const onChartPointerDownCapture = (e: React.PointerEvent) => {
    tapStart.current = { x: e.clientX, y: e.clientY };
  };

  // Tapping empty chart space toggles the chrome (tab bar, music toolbar)
  // right away, like iOS Photos, instead of waiting out IDLE_MS. Any other
  // tap on the screen just wakes it.
  const onScreenClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const start = tapStart.current;
    tapStart.current = null;
    const onChart = chartScrollRef.current?.contains(target) ?? false;
    const onControl = Boolean(target.closest("button, a, input, textarea, select, [role='button']"));
    const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP : false;
    if (!onChart || onControl || dockOpen || moved) {
      resetIdle();
      return;
    }
    const toggle = () => {
      tapTimer.current = null;
      if (stage.chromeHidden) resetIdle();
      else hideChromeNow();
    };
    // A PDF or score resets its zoom on double-tap; wait out that window so
    // a double-tap doesn't also flash the chrome off and on.
    const doubleTapZooms = stage.view === "sheet" && (activeKind === "pdf" || activeKind === "musicxml");
    if (!doubleTapZooms) {
      toggle();
      return;
    }
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
      return;
    }
    tapTimer.current = setTimeout(toggle, DOUBLE_TAP_MS);
  };

  // The one chart instance on Live Stage. It sits at the same place in the
  // tree whether or not Annotate is open (only the AnnotateCanvas around it
  // flips between read-only and interactive), so opening Annotate never
  // remounts it: the score/PDF keeps its current zoom, the chart keeps its
  // scroll position. `disableZoom` then *locks* that zoom while the dock is
  // open — pinch-zoom gestures shouldn't fight with drawing gestures, and a
  // re-layout under fresh ink would misalign it.
  const content = (
    <div
      style={{
        padding: "16px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        background: stage.view === "sheet" ? "var(--sheet-bg)" : undefined,
        color: stage.view === "sheet" ? "var(--sheet-fg)" : undefined,
      }}
    >
      {stage.view === "chords" ? (
        <ChordChart
          chordpro={song.chordpro}
          keyChange={keyChange}
          fontScale={chordsTextScale / 100}
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
              ref={mxlScoreRef}
              src={activeVersion.dataUrl}
              transpose={semitones}
              targetKey={displayKey}
              hiddenParts={hiddenParts}
              onInstrumentsChange={setScoreInstruments}
              disableZoom={musicxmlAnnotated || dockOpen}
              staveSpacing={state.settings.staveSpacing}
              onRerendered={() => setReprojectTick((t) => t + 1)}
            />
          ) : (
            <PdfPages
              // A fresh instance per song/version, so pinch-zoom and pan
              // don't carry over from the previous chart.
              key={`${song.id}:${stage.setlistIndex}:${activeVersion.id}`}
              src={activeVersion.dataUrl}
              disableZoom={dockOpen}
            />
          )}
          <span style={{ fontSize: 12, color: "var(--sheet-mut)" }}>
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
  );

  return (
    <div className="screen" onClick={onScreenClick}>
      {/* Clears the status bar on device (0 in the dev frame, which draws its
          own). No 44pt bar below it: Live Stage has no nav-bar content, and
          the next-song line and progress bar already mark setlist mode. */}
      <div style={{ flex: "none", height: "env(safe-area-inset-top, 0px)" }} />

      {setlist && (
        <div style={{ padding: "8px 14px 0" }}>
          <div className="stage-next muted">
            {songIndex + 1 < setlistSongIds.length ? (
              <>
                Next: {state.songs.find((s) => s.id === setlistSongIds[songIndex + 1])?.title ?? ""}
                {nextSlotNote && <span className="stage-next-note"> · {nextSlotNote}</span>}
              </>
            ) : (
              "Last song"
            )}
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
          {slotNote && (
            <button
              type="button"
              className="stage-slot-note"
              aria-expanded={slotNoteExpanded}
              aria-label={`Note for the band: ${slotNote}`}
              onClick={() => setSlotNoteExpanded((v) => !v)}
            >
              <Icon name="edit" size={12} strokeWidth={2} />
              <span>{slotNote}</span>
            </button>
          )}
        </div>
      )}

      {/* Hidden, not removed, while annotating: the Annotate bar floats over
          this spot and shows the title itself, and keeping the block's space
          means the chart below doesn't shift. */}
      <div style={{ padding: "10px 14px 8px", visibility: dockOpen ? "hidden" : undefined }}>
        <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 19 }}>{song.title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
          {song.artist}
        </div>
      </div>

      {/* Must stay at this exact position/type in both dock states — see
          `content` above. The Annotate toolbar's bars float over this
          viewport rather than taking space from it, so opening it changes
          nothing in here. */}
      <div
        ref={chartScrollRef}
        className="flex-1 hidden-scroll scroll-under-tabs no-tab-spacer"
        style={{ paddingBottom: 150, touchAction: "pan-y" }}
        onPointerDownCapture={onChartPointerDownCapture}
        onPointerDown={onChartPointerDown}
        onPointerUp={onChartPointerUp}
      >
        <div style={chartScale !== 1 && chartHeight !== null ? { height: chartHeight * chartScale, overflow: "hidden" } : undefined}>
          <div
            ref={chartRef}
            style={{
              width: layoutWidth ?? "100%",
              transform: chartScale !== 1 ? `scale(${chartScale})` : undefined,
              transformOrigin: "0 0",
            }}
          >
            <AnnotateCanvas
              {...(dockOpen
                ? annotateSession.canvasProps
                : { annotations: persistedAnnotations, interactive: false, onCommit: () => {}, onReproject: onReprojectPersisted })}
              scoreRef={annotationView === "musicxml" ? mxlScoreRef : undefined}
              reprojectSignal={annotationView === "musicxml" ? reprojectTick : undefined}
              screenScale={chartScale}
            >
              {content}
            </AnnotateCanvas>
          </div>
        </div>
      </div>

      {dockOpen ? (
        <AnnotateToolbar session={annotateSession} title={song.title} />
      ) : (
        !stage.chromeHidden && (hasChords || hasAttachment) && <MusicToolbar onOpenTools={() => setStageToolsOpen(true)} />
      )}

      {stage.drawer === "add-song" && (
        <AddSongSheet onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stage.drawer === "quick-edit" && (
        <QuickEditSheet songId={song.id} onClose={() => dispatch({ type: "STAGE_OPEN_DRAWER", drawer: null })} />
      )}
      {stageToolsOpen && !dockOpen && (
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

