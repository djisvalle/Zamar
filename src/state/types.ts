export type SongSource = "typed" | "chordpro" | "musicxml" | "imported-pdf";
export type ChartFormat = "chordpro" | "chords-over-lyrics";
export type AttachmentKind = "image" | "pdf";

export interface Attachment {
  kind: AttachmentKind;
  dataUrl: string; // in-memory only, like everything else in this mockup
  name: string; // original filename, for display
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  defaultKey: string;
  tempo: number;
  timeSig: string;
  durationSec: number;
  favourite: boolean;
  source: SongSource;
  chordpro: string; // raw chart, used for the chord/lyric render below
  chartFormat: ChartFormat; // which syntax the chart was authored in
  /** "original" means this song is a static image/PDF reference, not a parsed
   * chart — Live Stage renders `attachment` directly instead of ChordChart.
   * Undefined behaves the same as "chart" for every existing/typed song. */
  displayMode?: "chart" | "original";
  attachment?: Attachment;
}

export interface SetlistItem {
  id: string;
  kind: "song" | "note";
  songId?: string; // present when kind === "song"
  label?: string; // present when kind === "note" (e.g. "Welcome & announcements")
  keyOverride?: string;
  capo?: number;
  note?: string;
}

export interface SetlistSection {
  id: string;
  label: string;
  items: SetlistItem[];
}

export interface Setlist {
  id: string;
  name: string;
  date: string;
  time: string;
  description: string;
  status: "upcoming" | "past" | "template";
  sections: SetlistSection[];
}

export type ChartView = "chords" | "sheet";
export type Drawer = "add-song" | "quick-edit" | "add-to-set" | null;

export interface StageState {
  songId: string | null;
  setlistId: string | null;
  setlistIndex: number; // index of the current song within the flattened song list of the active setlist
  dispKey: string | null;
  capo: number;
  view: ChartView;
  toolbarExpanded: boolean;
  drawer: Drawer;
  annotate: boolean;
  chromeHidden: boolean;
  ended: boolean;
  lyricsOnly: boolean;
  zoom: number;
}

export type ThemeMode = "light" | "dark";
export type Viewport = "phone" | "tablet";

export interface Settings {
  keepAwake: boolean;
  autoscroll: boolean;
  theme: ThemeMode;
  textScale: number; // percent, 100 = default
  hasSeeded: boolean;
  micPermissionAsked: boolean;
}
