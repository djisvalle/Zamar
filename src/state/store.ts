import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode, createElement } from "react";
import type { Setlist, SetlistItem, Settings, Song, StageState, ThemeMode, Viewport } from "./types";
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

/** A song with no chords/lyrics text but at least one attachment should
 * open on the attachment view, not an empty chart. */
function defaultView(song: Song | undefined): StageState["view"] {
  if (song && !song.chordpro.trim() && Object.keys(song.attachments).length > 0) return "sheet";
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
 * never opens to a truly empty screen. `zoom` starts from the persisted
 * `settings.textScale` (set in Settings > Appearance) so that setting
 * actually determines the size a chart opens at; the toolbar's live +/-
 * buttons then adjust `stage.zoom` for the rest of that session only,
 * same as the rest of `stage` (see "Single global reducer" in CLAUDE.md). */
export function makeEmptyStage(textScale: number): StageState {
  return {
    songId: defaultSong ? DEFAULT_SONG_ID : null,
    setlistId: null,
    setlistIndex: 0,
    dispKey: defaultSong?.defaultKey ?? null,
    capo: 0,
    view: defaultView(defaultSong),
    toolbarExpanded: false,
    drawer: null,
    chromeHidden: false,
    ended: false,
    lyricsOnly: false,
    zoom: textScale,
  };
}

const DEFAULT_TEXT_SCALE = 100;

export function initialState(): AppState {
  return {
    songs: seedSongs,
    setlists: seedSetlists,
    settings: {
      theme: "light",
      textScale: DEFAULT_TEXT_SCALE,
      hasSeeded: false,
      micPermissionAsked: false,
    },
    stage: makeEmptyStage(DEFAULT_TEXT_SCALE),
    viewport: "phone",
  };
}

export function hydrateState(songs: Song[], setlists: Setlist[], settings: Settings): AppState {
  return { songs, setlists, settings, stage: makeEmptyStage(settings.textScale), viewport: "phone" };
}

export type Action =
  | { type: "START_EMPTY" }
  | { type: "SET_THEME"; theme: ThemeMode }
  | { type: "SET_VIEWPORT"; viewport: Viewport }
  | { type: "SET_TEXT_SCALE"; value: number }
  | { type: "SET_MIC_ASKED" }
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
  | { type: "MOVE_ITEM"; setlistId: string; itemId: string; toSectionId: string }
  | { type: "STAGE_LOAD"; songId: string; setlistId?: string | null; setlistIndex?: number }
  | { type: "STAGE_SET_VIEW"; view: StageState["view"] }
  | { type: "STAGE_SET_KEY"; key: string }
  | { type: "STAGE_SET_CAPO"; capo: number }
  | { type: "STAGE_TOGGLE_TOOLBAR" }
  | { type: "STAGE_OPEN_DRAWER"; drawer: StageState["drawer"] }
  | { type: "STAGE_TOGGLE_LYRICS_ONLY" }
  | { type: "STAGE_SET_ZOOM"; zoom: number }
  | { type: "STAGE_SET_CHROME_HIDDEN"; hidden: boolean }
  | { type: "STAGE_ADVANCE" }
  | { type: "STAGE_REPLAY" }
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
      return { ...state, settings: { ...state.settings, textScale: action.value } };
    case "SET_MIC_ASKED":
      return { ...state, settings: { ...state.settings, micPermissionAsked: true } };
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
        stage: state.stage.setlistId === action.setlistId ? makeEmptyStage(state.settings.textScale) : state.stage,
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
      return {
        ...state,
        setlists: state.setlists.map((sl) => {
          if (sl.id !== action.setlistId) return sl;
          let moved: SetlistItem | undefined;
          const withoutItem = sl.sections.map((sec) => {
            const idx = sec.items.findIndex((i) => i.id === action.itemId);
            if (idx === -1) return sec;
            moved = sec.items[idx];
            return { ...sec, items: sec.items.filter((i) => i.id !== action.itemId) };
          });
          if (!moved) return sl;
          return {
            ...sl,
            sections: withoutItem.map((sec) => (sec.id === action.toSectionId ? { ...sec, items: [...sec.items, moved!] } : sec)),
          };
        }),
      };
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
          ...makeEmptyStage(state.settings.textScale),
          songId: action.songId,
          setlistId: action.setlistId ?? null,
          setlistIndex: action.setlistIndex ?? 0,
          dispKey,
          view: defaultView(song),
        },
      };
    }
    case "STAGE_SET_VIEW":
      return { ...state, stage: { ...state.stage, view: action.view } };
    case "STAGE_SET_KEY":
      return { ...state, stage: { ...state.stage, dispKey: action.key } };
    case "STAGE_SET_CAPO":
      return { ...state, stage: { ...state.stage, capo: Math.max(0, action.capo) } };
    case "STAGE_TOGGLE_TOOLBAR":
      return { ...state, stage: { ...state.stage, toolbarExpanded: !state.stage.toolbarExpanded } };
    case "STAGE_OPEN_DRAWER":
      return { ...state, stage: { ...state.stage, drawer: action.drawer } };
    case "STAGE_TOGGLE_LYRICS_ONLY":
      return { ...state, stage: { ...state.stage, lyricsOnly: !state.stage.lyricsOnly } };
    case "STAGE_SET_ZOOM":
      return { ...state, stage: { ...state.stage, zoom: Math.min(160, Math.max(70, action.zoom)) } };
    case "STAGE_SET_CHROME_HIDDEN":
      return { ...state, stage: { ...state.stage, chromeHidden: action.hidden } };
    case "STAGE_ADVANCE": {
      const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);
      if (!setlist) return state;
      const ids = flattenSongIds(setlist);
      const nextIndex = state.stage.setlistIndex + 1;
      if (nextIndex >= ids.length) {
        return { ...state, stage: { ...state.stage, ended: true, chromeHidden: false } };
      }
      const nextId = ids[nextIndex];
      const song = state.songs.find((s) => s.id === nextId);
      let dispKey = song?.defaultKey ?? null;
      for (const sec of setlist.sections) {
        const item = sec.items.find((i) => i.kind === "song" && i.songId === nextId);
        if (item?.keyOverride) dispKey = item.keyOverride;
      }
      return {
        ...state,
        stage: { ...state.stage, songId: nextId, setlistIndex: nextIndex, dispKey, ended: false, view: defaultView(song) },
      };
    }
    case "STAGE_REPLAY": {
      const setlist = state.setlists.find((sl) => sl.id === state.stage.setlistId);
      if (!setlist) return state;
      const ids = flattenSongIds(setlist);
      const song = state.songs.find((s) => s.id === ids[0]);
      return {
        ...state,
        stage: { ...state.stage, songId: ids[0], setlistIndex: 0, dispKey: song?.defaultKey ?? null, ended: false, view: defaultView(song) },
      };
    }
    case "STAGE_EXIT":
      return { ...state, stage: makeEmptyStage(state.settings.textScale) };
    default:
      return state;
  }
}

interface StoreContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
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
        }
        if (persistGen.current !== mine) return;
        try {
          await persist();
        } catch (err) {
          console.warn("Zamar: failed to flush persisted state to web store", err);
        }
      })();
    }, 250);
    return () => clearTimeout(t);
  }, [state.songs, state.setlists, state.settings, persistEnabled]);

  return createElement(StoreContext.Provider, { value: { state, dispatch } }, children);
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
