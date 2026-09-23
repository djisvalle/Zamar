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
  dataUrl: string;
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

/** Anchors a point to a spot on a rendered MusicXML score that survives a
 * transpose-triggered re-render, in place of a raw pixel coordinate.
 * `measureIndex`/`staffIndex` index directly into
 * `osmd.GraphicSheet.MeasureList[measureIndex][staffIndex]`, which keeps the
 * same shape across a re-render (transpose never adds/removes measures or
 * staves). `fx`/`fy` are the point's position as a 0..1 fraction of that
 * measure's own bounding-box width/height at anchor time, not an absolute
 * offset — a fraction survives the measure changing width (more accidentals
 * needing more room) the way an absolute unit offset wouldn't. Only ever set
 * for points/pins placed on the `musicxml` view — see `MxlScore.tsx`'s
 * `anchorAtClientPoint`/`clientPointForAnchor`. */
export interface MusicalAnchor {
  measureIndex: number;
  staffIndex: number;
  fx: number;
  fy: number;
}

export interface Stroke {
  id: string;
  tool: "pen" | "square" | "highlighter";
  /** "pen"/"highlighter": every point on the drawn polyline, in order.
   * "square": exactly two points — the drag's start and end corners.
   * Coordinates are in CSS pixels relative to the top-left of the view's
   * content area, at that content's natural (unzoomed) size. Current
   * on-screen position — for a musicxml-view stroke with `anchors` set,
   * this is kept in sync by reprojection after every re-render; it's the
   * only representation for chords/image/pdf, which have no measures to
   * anchor to. */
  points: { x: number; y: number }[];
  /** One anchor per point, parallel to `points`, present only for strokes
   * drawn on the `musicxml` view. Absent — including for strokes persisted
   * before this feature — means "not reprojectable"; `points` is then used
   * as-is with no repositioning. */
  anchors?: MusicalAnchor[];
  /** Per-stroke color/width/opacity. Undefined on every stroke drawn before
   * per-object styling existed — that (and any stroke drawn without
   * touching the style controls) falls back to the original fixed
   * accent-color / `STROKE_WIDTH` / opacity-1 rendering, so old persisted
   * data needs no migration. */
  color?: string;
  size?: number;
  opacity?: number;
}

export interface Pin {
  id: string;
  kind: "pin";
  /** Same role as Stroke.points — kept in sync by reprojection. */
  position: { x: number; y: number };
  text: string;
  /** Present only when placed on the `musicxml` view. */
  anchor?: MusicalAnchor;
}

export type ShapeId =
  | "slur"
  | "hairpin-cresc"
  | "hairpin-dim"
  | "arrow"
  | "line"
  | "bracket"
  | "rect-outline"
  | "rect-fill"
  | "ellipse-outline"
  | "ellipse-fill";

/** A draggable text/symbol stamp placed with the Text or Notation tool —
 * distinct from `Pin`, which is a sticky note with its own tap-to-open
 * textarea editor. `TextMark`/`ShapeMark` render and drag directly on the
 * chart like a `Stroke`, share one edit sheet (see AnnotateOverlay.tsx's
 * `EditMarkSheet`), and share `Pin`'s reprojection model: a single
 * `position` + optional single `anchor`, not the parallel `points`/`anchors`
 * arrays a multi-point `Stroke` needs. */
export interface TextMark {
  id: string;
  kind: "text";
  position: { x: number; y: number };
  text: string;
  color: string;
  size: number;
  /** Set for a notation-stamp mark placed via the Notation tool in place of
   * typed text — names one of the notation icons (fermata, up/down bow).
   * Glyph-only stamps (pp, f, >, ♭, …) are stored directly in `text`. */
  iconGlyph?: string;
  /** Which notation stamp produced this mark, so re-editing shows it can't
   * be mistaken for free text even though both are `kind: "text"`. */
  symbolId?: string;
  anchor?: MusicalAnchor;
}

export interface ShapeMark {
  id: string;
  kind: "shape";
  position: { x: number; y: number };
  shapeId: ShapeId;
  color: string;
  size: number;
  /** Length/horizontal extent in px, at rotation 0. Undefined means "never
   * resized" — falls back to `size * SHAPE_ASPECT`, i.e. the original
   * fixed-aspect behavior. Old persisted marks parse with this undefined
   * and render identically to before. */
  width?: number;
  /** Degrees clockwise from the shape's default horizontal orientation.
   * Undefined means 0 — old persisted marks render unrotated, same as
   * today. Ignored for rect-outline/rect-fill/ellipse-outline/
   * ellipse-fill — only line-type shapes rotate (see `isLineShape` in
   * `utils/annotations.ts`). */
  rotation?: number;
  anchor?: MusicalAnchor;
}

/** `Stroke` keeps its own `tool` discriminant rather than gaining a `kind`
 * field, so persisted `Stroke[]` JSON from before pins existed parses as
 * valid `AnnotationObject[]` with no migration — see `utils/annotations.ts`'s
 * `isPin`. */
export type AnnotationObject = Stroke | Pin | TextMark | ShapeMark;

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
  /** Which view Live Stage should open this song to — a specific attachment
   * kind, or `"chords"` for the chords/lyrics view. `undefined` means no
   * preference has been saved: Live Stage falls back to its automatic guess
   * (chords if the song has any, else its first available attachment). Set
   * from Add/Edit Song's "Default on Live Stage" picker. */
  defaultView?: "chords" | AttachmentKind;
  /** Freeform text notes for this song — reminders, cues, anything worth
   * having on hand regardless of chart type. "" when empty. UI label is
   * "Cues" (see AnnotateOverlay.tsx/AddEditSong.tsx); field name is unchanged
   * to avoid an unnecessary SQLite column rename. */
  notes: string;
  /** Hand-drawn ink and pins, one layer per view type this song can show.
   * {} when nothing's been placed yet. */
  annotations: Partial<Record<AnnotationView, AnnotationObject[]>>;
}

export interface SetlistItem {
  id: string;
  kind: "song" | "note";
  songId?: string; // present when kind === "song"
  label?: string; // present when kind === "note" (e.g. "Welcome & announcements")
  keyOverride?: string;
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
  view: ChartView;
  drawer: Drawer;
  chromeHidden: boolean;
  lyricsOnly: boolean;
  zoom: number;
}

export type ThemeMode = "light" | "dark";
export type Viewport = "phone" | "ipadAir11" | "ipadAir13";
export type StaveSpacing = "compact" | "default" | "roomy";

export interface Settings {
  theme: ThemeMode;
  textScale: number; // percent, 100 = default
  hasSeeded: boolean;
  micPermissionAsked: boolean;
  /** Vertical spacing between staves/systems in rendered MusicXML scores —
   * global and static (never per-song, never adjustable mid-session on a
   * given chart), so it never interacts with the Annotate freeze rule. */
  staveSpacing: StaveSpacing;
}
