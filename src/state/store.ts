import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode, createElement } from "react";
import type { AnnotateRecents, Setlist, SetlistItem, Settings, Song, StageState, StaveSpacing, ThemeMode, Viewport } from "./types";
import { setlists as seedSetlists, songs as seedSongs } from "./mockData";
import { getDb, persist } from "../data/db";
import { buildSaveStatements, type PersistedSnapshot } from "../data/persistPlan";
import { settleAttachmentData } from "../data/attachmentData";
import { canonicalKey } from "../utils/keys";

export interface AppState {
  songs: Song[];
  setlists: Setlist[];
  settings: Settings;
  stage: StageState;
  viewport: Viewport;
}

/** A song's Live Stage view: honors a saved `song.defaultView` when it
 * still applies to this song (its chords weren't cleared out, or its
 * chosen attachment kind is still attached); otherwise falls back to the
 * automatic guess — chords if the song has any, else its first available
 * attachment, matching the behavior before per-song defaults existed. */
export function resolveDefaultView(song: Song | undefined): StageState["view"] {
  if (!song) return "chords";
  if (song.defaultView === "chords" && song.chordpro.trim()) return "chords";
  if (song.defaultView && song.defaultView !== "chords" && song.attachments[song.defaultView]) return "sheet";
  if (!song.chordpro.trim() && Object.keys(song.attachments).length > 0) return "sheet";
  return "chords";
}

/** The Live Stage screen's "nothing else going on" resting state — used on
 * first boot and whenever a live setlist is exited. Rather than a stark
 * "no song on stage" blank, it lands on a standing default song so the app
 * never opens to a truly empty screen. */
const DEFAULT_SONG_ID = "s11";
const defaultSong = seedSongs.find((s) => s.id === DEFAULT_SONG_ID);

/** The Live Stage screen's "nothing else going on" resting state — used on
 * first boot and whenever a live setlist is exited. Rather than a stark
 * "no song on stage" blank, it lands on a standing default song so the app
 * never opens to a truly empty screen. Chart text size isn't part of
 * `stage`: it's the persisted `settings.textScale`, which Settings >
 * Appearance and the stage's Zoom +/- buttons both change. */
/** If `before` is live on stage, keep the stage on the same song slot in
 * `after` rather than whatever slot now sits at the old position. */
function keepStageSlot(stage: StageState, before: Setlist, after: Setlist): StageState {
  if (stage.setlistId !== before.id) return stage;
  const songSlots = (sl: Setlist) => sl.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song"));
  const current = songSlots(before)[stage.setlistIndex];
  const newIndex = current ? songSlots(after).findIndex((i) => i.id === current.id) : -1;
  return newIndex >= 0 ? { ...stage, setlistIndex: newIndex } : stage;
}

export function makeEmptyStage(songs: Song[] = seedSongs): StageState {
  const song = songs.find((s) => s.id === DEFAULT_SONG_ID) ?? defaultSong;
  return {
    songId: song ? DEFAULT_SONG_ID : null,
    setlistId: null,
    setlistIndex: 0,
    dispKey: song?.defaultKey ?? null,
    view: resolveDefaultView(song),
    drawer: null,
    chromeHidden: false,
    lyricsOnly: false,
  };
}

const DEFAULT_TEXT_SCALE = 100;
export const MIN_TEXT_SCALE = 70;
export const MAX_TEXT_SCALE = 160;

export function emptyRecents(): AnnotateRecents {
  return { pen: [], highlighter: [], text: [], shapes: [], notation: [] };
}

function clampTextScale(value: number): number {
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_TEXT_SCALE, value));
}

export function initialState(): AppState {
  return {
    songs: seedSongs,
    setlists: seedSetlists,
    settings: {
      theme: "light",
      textScale: DEFAULT_TEXT_SCALE,
      hasSeeded: false,
      micPermissionAsked: false,
      staveSpacing: "default",
      annotateRecents: emptyRecents(),
      annotateSnap: true,
      showKeyOffsets: false,
      strictSpelling: false,
      notationFavorites: [],
    },
    stage: makeEmptyStage(),
    viewport: "ipadAir13",
  };
}

/** Keeps `song.chordsTextScale` in step with its chords marks: pinned to
 * `textScale` (the size the chart is on screen at) when the first mark lands,
 * kept as-is while marks remain, and dropped once they're all cleared. */
function lockChordsTextScale(song: Song, textScale: number): Song {
  const annotated = Boolean(song.annotations.chords?.length);
  if (annotated && song.chordsTextScale == null) return { ...song, chordsTextScale: textScale };
  if (!annotated && song.chordsTextScale != null) {
    const { chordsTextScale: _dropped, ...rest } = song;
    return rest;
  }
  return song;
}

export function hydrateState(songs: Song[], setlists: Setlist[], settings: Settings): AppState {
  // Charts marked before the lock existed have no recorded size; the saved
  // text size is what they're on screen at now, so they're pinned to that.
  // Keys saved before the enharmonic picker may be sharps with no chip
  // (A#, D#, G#); they load as the chip for the same pitch (Bb, Eb, Ab).
  // Songs saved with no artist used to get the placeholder "Unknown"; a
  // missing artist is blank now, so the placeholder loads as blank too.
  // Each song or setlist keeps its identity unless something here changed
  // it, so the first save after boot (see buildSaveStatements) writes only
  // the ones that actually differ from what was loaded.
  const locked = songs.map((s) => {
    const defaultKey = canonicalKey(s.defaultKey);
    const artist = s.artist === "Unknown" ? "" : s.artist;
    const fixed = defaultKey === s.defaultKey && artist === s.artist ? s : { ...s, defaultKey, artist };
    return lockChordsTextScale(fixed, settings.textScale);
  });
  const canonicalOverride = (it: SetlistItem) =>
    "keyOverride" in it && it.keyOverride && canonicalKey(it.keyOverride) !== it.keyOverride
      ? { ...it, keyOverride: canonicalKey(it.keyOverride) }
      : it;
  const keyed = setlists.map((sl) =>
    sl.sections.some((sec) => sec.items.some((it) => canonicalOverride(it) !== it))
      ? { ...sl, sections: sl.sections.map((sec) => ({ ...sec, items: sec.items.map(canonicalOverride) })) }
      : sl
  );
  return { songs: locked, setlists: keyed, settings, stage: makeEmptyStage(locked), viewport: "ipadAir13" };
}

export type Action =
  | { type: "START_EMPTY" }
  | { type: "SET_THEME"; theme: ThemeMode }
  | { type: "SET_VIEWPORT"; viewport: Viewport }
  | { type: "SET_TEXT_SCALE"; value: number }
  | { type: "SET_ANNOTATE_RECENTS"; recents: AnnotateRecents }
  | { type: "SET_ANNOTATE_SNAP"; value: boolean }
  | { type: "TOGGLE_NOTATION_FAVORITE"; symbolId: string }
  | { type: "SET_SHOW_KEY_OFFSETS"; value: boolean }
  | { type: "SET_STRICT_SPELLING"; value: boolean }
  | { type: "SET_MIC_ASKED" }
  | { type: "SET_STAVE_SPACING"; spacing: StaveSpacing }
  | { type: "TOGGLE_FAVOURITE"; songId: string }
  | { type: "ADD_SONG"; song: Song }
  | { type: "UPDATE_SONG"; song: Song }
  | { type: "DUPLICATE_SONG"; songId: string }
  | { type: "DELETE_SONGS"; ids: string[] }
  | { type: "ADD_SETLIST"; setlist: Setlist }
  | { type: "UPDATE_SETLIST_META"; setlistId: string; patch: Partial<Setlist> }
  | { type: "DELETE_SETLIST"; setlistId: string }
  | { type: "ADD_SECTION"; setlistId: string; label: string }
  | { type: "UPDATE_SECTION"; setlistId: string; sectionId: string; label: string }
  | { type: "REMOVE_SECTION"; setlistId: string; sectionId: string }
  | { type: "ADD_ITEM"; setlistId: string; sectionId: string; item: SetlistItem }
  | { type: "REMOVE_ITEM"; setlistId: string; itemId: string }
  | { type: "UPDATE_ITEM"; setlistId: string; itemId: string; patch: Partial<SetlistItem> }
  | { type: "DUPLICATE_ITEM"; setlistId: string; itemId: string }
  /** Moves an item to another section (appended) or, with `toIndex`, to that
   * position in `toSectionId` counted without the item itself — drag-to-reorder. */
  | { type: "MOVE_ITEM"; setlistId: string; itemId: string; toSectionId: string; toIndex?: number }
  | { type: "MOVE_SECTION"; setlistId: string; sectionId: string; toIndex: number }
  | { type: "STAGE_LOAD"; songId: string; setlistId?: string | null; setlistIndex?: number }
  | { type: "STAGE_SET_VIEW"; view: StageState["view"] }
  | { type: "STAGE_SET_KEY"; key: string }
  | { type: "STAGE_OPEN_DRAWER"; drawer: StageState["drawer"] }
  | { type: "STAGE_TOGGLE_LYRICS_ONLY" }
  | { type: "STAGE_SET_CHROME_HIDDEN"; hidden: boolean }
  | { type: "STAGE_ADVANCE" }
  | { type: "STAGE_EXIT" };

function flattenSongIds(setlist: Setlist): string[] {
  return setlist.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song").map((i) => i.songId!));
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "START_EMPTY":
      return { ...state, songs: [], setlists: [], settings: { ...state.settings, hasSeeded: true } };
    case "SET_THEME":
      return { ...state, settings: { ...state.settings, theme: action.theme } };
    case "SET_VIEWPORT":
      return { ...state, viewport: action.viewport };
    case "SET_TEXT_SCALE":
      return { ...state, settings: { ...state.settings, textScale: clampTextScale(action.value) } };
    case "SET_ANNOTATE_RECENTS":
      return { ...state, settings: { ...state.settings, annotateRecents: action.recents } };
    case "SET_ANNOTATE_SNAP":
      return { ...state, settings: { ...state.settings, annotateSnap: action.value } };
    case "TOGGLE_NOTATION_FAVORITE": {
      const favs = state.settings.notationFavorites;
      const next = favs.includes(action.symbolId) ? favs.filter((id) => id !== action.symbolId) : [...favs, action.symbolId];
      return { ...state, settings: { ...state.settings, notationFavorites: next } };
    }
    case "SET_SHOW_KEY_OFFSETS":
      return { ...state, settings: { ...state.settings, showKeyOffsets: action.value } };
    case "SET_STRICT_SPELLING":
      return { ...state, settings: { ...state.settings, strictSpelling: action.value } };
    case "SET_MIC_ASKED":
      return { ...state, settings: { ...state.settings, micPermissionAsked: true } };
    case "SET_STAVE_SPACING":
      return { ...state, settings: { ...state.settings, staveSpacing: action.spacing } };
    case "TOGGLE_FAVOURITE":
      return {
        ...state,
        songs: state.songs.map((s) => (s.id === action.songId ? { ...s, favourite: !s.favourite } : s)),
      };
    case "ADD_SONG":
      return { ...state, songs: [...state.songs, lockChordsTextScale(action.song, state.settings.textScale)] };
    case "UPDATE_SONG": {
      const song = lockChordsTextScale(action.song, state.settings.textScale);
      return { ...state, songs: state.songs.map((s) => (s.id === song.id ? song : s)) };
    }
    case "DUPLICATE_SONG": {
      const song = state.songs.find((s) => s.id === action.songId);
      if (!song) return state;
      const idx = state.songs.findIndex((s) => s.id === action.songId);
      const copy: Song = { ...song, id: `${song.id}-copy-${Date.now()}`, title: `${song.title} (Copy)`, favourite: false };
      const songs = [...state.songs];
      songs.splice(idx + 1, 0, copy);
      return { ...state, songs };
    }
    case "DELETE_SONGS":
      return { ...state, songs: state.songs.filter((s) => !action.ids.includes(s.id)) };
    case "ADD_SETLIST":
      return { ...state, setlists: [...state.setlists, action.setlist] };
    case "UPDATE_SETLIST_META":
      return {
        ...state,
        setlists: state.setlists.map((sl) => (sl.id === action.setlistId ? { ...sl, ...action.patch } : sl)),
      };
    case "DELETE_SETLIST":
      return {
        ...state,
        setlists: state.setlists.filter((sl) => sl.id !== action.setlistId),
        stage: state.stage.setlistId === action.setlistId ? makeEmptyStage(state.songs) : state.stage,
      };
    case "ADD_SECTION":
      return {
        ...state,
        setlists: state.setlists.map((sl) =>
          sl.id !== action.setlistId
            ? sl
            : { ...sl, sections: [...sl.sections, { id: `sec-${Date.now()}`, label: action.label, items: [] }] }
        ),
      };
    case "UPDATE_SECTION":
      return {
        ...state,
        setlists: state.setlists.map((sl) =>
          sl.id !== action.setlistId
            ? sl
            : { ...sl, sections: sl.sections.map((sec) => (sec.id === action.sectionId ? { ...sec, label: action.label } : sec)) }
        ),
      };
    case "REMOVE_SECTION":
      return {
        ...state,
        setlists: state.setlists.map((sl) =>
          sl.id !== action.setlistId
            ? sl
            : { ...sl, sections: sl.sections.filter((sec) => sec.id !== action.sectionId) }
        ),
      };
    case "ADD_ITEM":
      return {
        ...state,
        setlists: state.setlists.map((sl) =>
          sl.id !== action.setlistId
            ? sl
            : {
                ...sl,
                sections: sl.sections.map((sec) =>
                  sec.id !== action.sectionId ? sec : { ...sec, items: [...sec.items, action.item] }
                ),
              }
        ),
      };
    case "REMOVE_ITEM":
      return {
        ...state,
        setlists: state.setlists.map((sl) =>
          sl.id !== action.setlistId
            ? sl
            : {
                ...sl,
                sections: sl.sections.map((sec) => ({
                  ...sec,
                  items: sec.items.filter((i) => i.id !== action.itemId),
                })),
              }
        ),
      };
    case "UPDATE_ITEM":
      return {
        ...state,
        setlists: state.setlists.map((sl) =>
          sl.id !== action.setlistId
            ? sl
            : {
                ...sl,
                sections: sl.sections.map((sec) => ({
                  ...sec,
                  items: sec.items.map((i) => (i.id === action.itemId ? { ...i, ...action.patch } : i)),
                })),
              }
        ),
      };
    case "DUPLICATE_ITEM":
      return {
        ...state,
        setlists: state.setlists.map((sl) => {
          if (sl.id !== action.setlistId) return sl;
          return {
            ...sl,
            sections: sl.sections.map((sec) => {
              const idx = sec.items.findIndex((i) => i.id === action.itemId);
              if (idx === -1) return sec;
              const copy = { ...sec.items[idx], id: `${sec.items[idx].id}-copy-${Date.now()}` };
              const items = [...sec.items];
              items.splice(idx + 1, 0, copy);
              return { ...sec, items };
            }),
          };
        }),
      };
    case "MOVE_ITEM": {
      const setlist = state.setlists.find((sl) => sl.id === action.setlistId);
      if (!setlist) return state;
      let moved: SetlistItem | undefined;
      const withoutItem = setlist.sections.map((sec) => {
        const idx = sec.items.findIndex((i) => i.id === action.itemId);
        if (idx === -1) return sec;
        moved = sec.items[idx];
        return { ...sec, items: sec.items.filter((i) => i.id !== action.itemId) };
      });
      if (!moved) return state;
      const next: Setlist = {
        ...setlist,
        sections: withoutItem.map((sec) => {
          if (sec.id !== action.toSectionId) return sec;
          const items = [...sec.items];
          items.splice(Math.max(0, Math.min(action.toIndex ?? items.length, items.length)), 0, moved!);
          return { ...sec, items };
        }),
      };
      const stage = keepStageSlot(state.stage, setlist, next);
      return { ...state, stage, setlists: state.setlists.map((sl) => (sl.id === setlist.id ? next : sl)) };
    }
    case "MOVE_SECTION": {
      const setlist = state.setlists.find((sl) => sl.id === action.setlistId);
      const moving = setlist?.sections.find((sec) => sec.id === action.sectionId);
      if (!setlist || !moving) return state;
      const sections = setlist.sections.filter((sec) => sec.id !== action.sectionId);
      sections.splice(Math.max(0, Math.min(action.toIndex, sections.length)), 0, moving);
      const next: Setlist = { ...setlist, sections };
      const stage = keepStageSlot(state.stage, setlist, next);
      return { ...state, stage, setlists: state.setlists.map((sl) => (sl.id === setlist.id ? next : sl)) };
    }
    case "STAGE_LOAD": {
      const setlist = action.setlistId ? state.setlists.find((sl) => sl.id === action.setlistId) : null;
      const song = state.songs.find((s) => s.id === action.songId);
      let dispKey = song?.defaultKey ?? null;
      if (setlist) {
        for (const sec of setlist.sections) {
          const item = sec.items.find((i) => i.kind === "song" && i.songId === action.songId);
          if (item?.keyOverride) dispKey = item.keyOverride;
        }
      }
      return {
        ...state,
        stage: {
          ...makeEmptyStage(),
          songId: action.songId,
          setlistId: action.setlistId ?? null,
          setlistIndex: action.setlistIndex ?? 0,
          dispKey,
          view: resolveDefaultView(song),
        },
      };
    }
    case "STAGE_SET_VIEW":
      return { ...state, stage: { ...state.stage, view: action.view } };
    case "STAGE_SET_KEY":
      return { ...state, stage: { ...state.stage, dispKey: action.key } };
    case "STAGE_OPEN_DRAWER":
      return { ...state, stage: { ...state.stage, drawer: action.drawer } };
    case "STAGE_TOGGLE_LYRICS_ONLY":
      return { ...state, stage: { ...state.stage, lyricsOnly: !state.stage.lyricsOnly } };
    case "STAGE_SET_CHROME_HIDDEN":
      return { ...state, stage: { ...state.stage, chromeHidden: action.hidden } };
    case "STAGE_ADVANCE": {
      const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);
      if (!setlist) return state;
      const ids = flattenSongIds(setlist);
      const nextIndex = state.stage.setlistIndex + 1;
      if (nextIndex >= ids.length) return state;
      const nextId = ids[nextIndex];
      const song = state.songs.find((s) => s.id === nextId);
      let dispKey = song?.defaultKey ?? null;
      for (const sec of setlist.sections) {
        const item = sec.items.find((i) => i.kind === "song" && i.songId === nextId);
        if (item?.keyOverride) dispKey = item.keyOverride;
      }
      return {
        ...state,
        stage: { ...state.stage, songId: nextId, setlistIndex: nextIndex, dispKey, view: resolveDefaultView(song) },
      };
    }
    case "STAGE_EXIT":
      return { ...state, stage: makeEmptyStage(state.songs) };
    default:
      return state;
  }
}

/** Why changes aren't reaching disk, if they aren't: `load` when the boot read failed and
 * persistence was switched off for the session, `write` when a save attempt threw. */
export type StorageProblem = "load" | "write" | null;

interface StoreContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
  storageProblem: StorageProblem;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({
  children,
  initial,
  persisted,
  persistEnabled = true,
}: {
  children: ReactNode;
  initial: AppState;
  /** What's already on disk (see main.tsx's loadInitial); each save writes
   * only what differs from it, then advances it. */
  persisted: PersistedSnapshot;
  /** False when the initial load from disk failed (see main.tsx's loadInitial) — we can't tell
   * whether that failure means "nothing was ever persisted" or "real data is on disk but
   * unreadable right now," so persistence stays off for the rest of this session rather than
   * risk the debounced write below silently overwriting real data with fresh seed data. */
  persistEnabled?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [storageProblem, setStorageProblem] = useState<StorageProblem>(persistEnabled ? null : "load");

  const firstRun = useRef(true);
  const persistGen = useRef(0);
  const latest = useRef(state);
  latest.current = state;
  const snapshot = useRef(persisted);
  // Saves run one after another, and each works out its statements only
  // when its turn comes: a save computed before the one ahead of it had
  // committed could miss a row that one wrote (a song added, then deleted).
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!persistEnabled) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      const mine = ++persistGen.current;
      saveChain.current = saveChain.current.then(async () => {
        // A newer save is queued behind this one and will write everything.
        if (persistGen.current !== mine) return;
        const { songs, setlists, settings } = latest.current;
        const current: PersistedSnapshot = { songs, setlists, settings };
        // Songs, setlists, and settings all go in ONE atomic transaction, in the FK-safe order
        // buildSaveStatements lays out. Splitting any of this across multiple
        // separately-committed transactions risks a crash between commits leaving a settings
        // row that disagrees with the songs/setlists actually on disk (see main.tsx's first-run
        // recovery logic, which exists to handle exactly that mismatch from before this was
        // atomic).
        const { statements, inserted, deleted } = buildSaveStatements(snapshot.current, current);
        if (statements.length === 0) return;
        try {
          const db = await getDb();
          await db.executeSet(statements);
        } catch (err) {
          console.warn("Zamar: failed to persist songs/setlists/settings", err);
          if (persistGen.current === mine) setStorageProblem("write");
          return;
        }
        // Only a committed save moves the snapshot, so after a failure the
        // next save still carries every change since the last good one.
        snapshot.current = current;
        settleAttachmentData(inserted, deleted);
        try {
          await persist();
          setStorageProblem((p) => (p === "write" ? null : p));
        } catch (err) {
          console.warn("Zamar: failed to flush persisted state to web store", err);
          if (persistGen.current === mine) setStorageProblem("write");
        }
      });
    }, 250);
    return () => clearTimeout(t);
  }, [state.songs, state.setlists, state.settings, persistEnabled]);

  return createElement(StoreContext.Provider, { value: { state, dispatch, storageProblem } }, children);
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within StoreProvider");
  return ctx;
}

export function activeSetlistSongIds(setlist: Setlist | undefined | null): string[] {
  if (!setlist) return [];
  return flattenSongIds(setlist);
}

/** The set's song slots in stage order, one per `activeSetlistSongIds` entry,
 * so `stage.setlistIndex` indexes both. Live Stage reads each slot's note. */
export function activeSetlistSlots(setlist: Setlist | undefined | null): SetlistItem[] {
  if (!setlist) return [];
  return setlist.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song"));
}
