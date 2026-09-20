export type SongSource = "typed" | "chordpro" | "musicxml" | "imported-pdf";
export type ChartFormat = "chordpro" | "chords-over-lyrics";
/** Also doubles as the attachment "category" key — a song can carry one
 * bucket per kind (a real engraved score, a PDF, a photo) at the same time,
 * instead of competing for a single slot. */
export type AttachmentKind = "image" | "pdf" | "musicxml";

export interface AttachmentVersion {
  id: string;
  /** User-facing name, e.g. "Violin", "Jazz arrangement". Defaults to the
   * original filename when the person doesn't type one at import time. */
  label: string;
  dataUrl: string; // in-memory only, like everything else in this mockup
  name: string; // original filename, always preserved regardless of label
}

export interface AttachmentBucket {
  versions: AttachmentVersion[]; // non-empty whenever this bucket exists
  /** Which version is this bucket's default — what Live Stage and the
   * Add/Edit Song preview show unless the person switches in-session. */
  selectedVersionId: string;
}

export type Attachments = Partial<Record<AttachmentKind, AttachmentBucket>>;

export type AnnotationView = "chords" | "image" | "pdf" | "musicxml";

export interface Stroke {
  id: string;
  tool: "pen" | "square";
  /** "pen": every point on the drawn polyline, in order. "square": exactly
   * two points — the drag's start and end corners. Coordinates are in CSS
   * pixels relative to the top-left of the view's content area, at that
   * content's natural (unzoomed) size. */
  points: { x: number; y: number }[];
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
  chordpro: string; // raw chart, used for the chord/lyric render below — "" if this song has no chords/lyrics view
  chartFormat: ChartFormat; // which syntax the chart was authored in
  /** Zero or more categorized, versioned attachments alongside (or instead
   * of) the chords/lyrics text — a category per file kind, each holding one
   * or more versions (e.g. a Violin PDF and a Viola PDF for the same song).
   * A song can have chords, attachments, both, or neither. */
  attachments: Attachments;
  /** Freeform text notes for this song — reminders, cues, anything worth
   * having on hand regardless of chart type. "" when empty. */
  notes: string;
  /** Hand-drawn markup, one stroke layer per view type this song can show.
   * {} when nothing has been drawn yet. */
  annotations: Partial<Record<AnnotationView, Stroke[]>>;
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
export type Drawer = "add-song" | "quick-edit" | "add-to-set" | "annotate" | null;

export interface StageState {
  songId: string | null;
  setlistId: string | null;
  setlistIndex: number; // index of the current song within the flattened song list of the active setlist
  dispKey: string | null;
  capo: number;
  view: ChartView;
  toolbarExpanded: boolean;
  drawer: Drawer;
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
