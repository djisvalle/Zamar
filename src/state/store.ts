import { createContext, useContext, useEffect, useReducer, useRef, useState, type Dispatch, type ReactNode, createElement } from "react";
import type { Setlist, SetlistItem, Settings, Song, StageState, StaveSpacing, ThemeMode, Viewport } from "./types";
import { setlists as seedSetlists, songs as seedSongs } from "./mockData";
import * as songsRepo from "../data/songsRepo";
import * as setlistsRepo from "../data/setlistsRepo";
import * as settingsRepo from "../data/settingsRepo";
import { getDb, persist } from "../data/db";

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
function resolveDefaultView(song: Song | undefined): StageState["view"] {
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
    },
    stage: makeEmptyStage(),
    viewport: "ipadAir13",
  };
}

export function hydrateState(songs: Song[], setlists: Setlist[], settings: Settings): AppState {
  return { songs, setlists, settings, stage: makeEmptyStage(songs), viewport: "ipadAir13" };
}

export type Action =
  | { type: "START_EMPTY" }
  | { type: "SET_THEME"; theme: ThemeMode }
  | { type: "SET_VIEWPORT"; viewport: Viewport }
  | { type: "SET_TEXT_SCALE"; value: number }
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
      return { ...state, songs: [...state.songs, action.song] };
    case "UPDATE_SONG":
      return { ...state, songs: state.songs.map((s) => (s.id === action.song.id ? action.song : s)) };
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
      // If this set is live on stage, keep the stage on the same slot rather
      // than whatever slot now sits at the old position.
      let stage = state.stage;
      if (stage.setlistId === setlist.id) {
        const songSlots = (sl: Setlist) => sl.sections.flatMap((sec) => sec.items.filter((i) => i.kind === "song"));
        const current = songSlots(setlist)[stage.setlistIndex];
        const newIndex = current ? songSlots(next).findIndex((i) => i.id === current.id) : -1;
        if (newIndex >= 0) stage = { ...stage, setlistIndex: newIndex };
      }
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
  persistEnabled = true,
}: {
  children: ReactNode;
  initial: AppState;
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

  useEffect(() => {
    if (!persistEnabled) return;
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const t = setTimeout(() => {
      const mine = ++persistGen.current;
      (async () => {
        const songIds = new Set(state.songs.map((s) => s.id));
        const safeSetlists = state.setlists.map((sl) => ({
          ...sl,
          sections: sl.sections.map((sec) => ({
            ...sec,
            items: sec.items.filter((i) => i.kind !== "song" || (i.songId != null && songIds.has(i.songId))),
          })),
        }));
        // Songs, setlists, and settings all go in ONE atomic transaction. Songs and setlists
        // are FK-coupled (setlist_items.song_id -> songs.id), so they must be written in
        // FK-safe order: clear setlist rows first (removes any reference to a song about to be
        // deleted), then replace songs, then reinsert setlists (safe now, since the songs they
        // reference already exist). Settings rides along in the same executeSet call rather than
        // a separate commit — splitting any of this across multiple separately-committed
        // transactions risks a crash between commits leaving a settings row that disagrees with
        // the songs/setlists actually on disk (see main.tsx's first-run recovery logic, which
        // exists to handle exactly that mismatch from before this was atomic).
        try {
          const db = await getDb();
          if (persistGen.current !== mine) return;
          await db.executeSet([
            ...setlistsRepo.buildDeleteStatements(),
            songsRepo.buildDeleteStatement(),
            ...songsRepo.buildInsertStatements(state.songs),
            ...setlistsRepo.buildInsertStatements(safeSetlists),
            settingsRepo.buildUpsertStatement(state.settings),
          ]);
        } catch (err) {
          console.warn("Zamar: failed to persist songs/setlists/settings", err);
          if (persistGen.current === mine) setStorageProblem("write");
          return;
        }
        if (persistGen.current !== mine) return;
        try {
          await persist();
          setStorageProblem((p) => (p === "write" ? null : p));
        } catch (err) {
          console.warn("Zamar: failed to flush persisted state to web store", err);
          if (persistGen.current === mine) setStorageProblem("write");
        }
      })();
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
