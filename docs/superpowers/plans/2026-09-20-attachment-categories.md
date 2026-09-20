# Multi-Category, Multi-Version Song Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a song carry a Sheet Music (MusicXML), a PDF, and a Photo attachment simultaneously — each holding multiple named versions (e.g. a Violin PDF and a Viola PDF) — instead of today's single `attachment` slot that gets silently overwritten.

**Architecture:** `Song.attachment?: Attachment` (one slot) becomes `Song.attachments: Partial<Record<AttachmentKind, AttachmentBucket>>` (up to three slots, each an ordered list of versions plus a "default" `selectedVersionId`). A new `src/utils/attachments.ts` centralizes the bucket operations (add/remove/rename/select a version) so Import, Add/Edit Song, and Live Stage don't each reimplement them. The SQLite persistence layer collapses its four flat `attachment_*` columns into one `attachments_json` column.

**Tech Stack:** Vite + React 18 + TypeScript, plain CSS (`src/theme.css`), `@capacitor-community/sqlite` for persistence. No test framework exists in this repo — `npm run build` (`tsc -b && vite build`) is the correctness bar, backed by manual click-through in `npm run dev`, per CLAUDE.md's documented gotcha. Every task below is verified that way, not with an automated test suite.

**Spec:** [docs/superpowers/specs/2026-09-20-attachment-categories-design.md](../specs/2026-09-20-attachment-categories-design.md)

## Global Constraints

- No new npm dependencies.
- No automated test framework — verify each task with `npm run build` (must be clean, or clean modulo the specific interim errors a task calls out) plus a manual click-through in `npm run dev`.
- Follow this codebase's existing UI conventions exactly rather than inventing new ones:
  - Row actions ("..." menu) open a `Sheet` (from `src/components/Overlays.tsx`) listing plain-text `sheet-row` buttons; a destructive one is styled `style={{ color: "#8c3b3b", fontWeight: 600 }}`. See `src/screens/setlists/SetlistDetail.tsx`'s `sectionSheetFor` Sheet.
  - Renaming something opens a `Dialog` with a labeled `input` and a Cancel/Save `btn-row` (Save disabled until the field is non-empty). See the same file's `renameSectionFor` Dialog.
  - Deleting something opens a confirm `Dialog` ("Delete/Remove '{name}'?" + "This can't be undone." body + Keep/Delete `btn-row`, Delete styled `btn btn-danger`). See the same file's `confirmDeleteSection` Dialog.
  - Removal buttons elsewhere in this screen are plain danger-colored `btn`s (`style={{ color: "#8c3b3b" }}`), not icon buttons — there is no trash/delete icon in `src/components/Icon.tsx`'s set. Match this (e.g. today's "Remove attachment" button in `AddEditSong.tsx`).
- Every commit message ends with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` per this repo's current attribution convention.
- Commit messages in this repo are short, imperative, present-tense, with no `feat:`/`fix:` prefix (see `git log`: "Fix toggle-knob color, add backdrop blur to overlays", "Render real MusicXML scores via OpenSheetMusicDisplay"). Match that style.

---

## Task 1: Data model, shared helpers, seed data, and persistence

**Files:**
- Modify: `src/state/types.ts`
- Create: `src/utils/attachments.ts`
- Modify: `src/state/mockData.ts`
- Modify: `src/state/store.ts` (`defaultView` helper only — the reducer itself needs no change, it already just replaces the whole `Song` object on `ADD_SONG`/`UPDATE_SONG`)
- Modify: `src/data/db.ts`
- Modify: `src/data/songsRepo.ts`

**Interfaces:**
- Produces (used by every later task):
  - `AttachmentKind = "image" | "pdf" | "musicxml"` (unchanged values, from `src/state/types.ts`)
  - `AttachmentVersion { id: string; label: string; dataUrl: string; name: string }`
  - `AttachmentBucket { versions: AttachmentVersion[]; selectedVersionId: string }`
  - `Attachments = Partial<Record<AttachmentKind, AttachmentBucket>>`
  - `Song.attachments: Attachments` (replaces `Song.attachment?: Attachment`)
  - From `src/utils/attachments.ts`: `ATTACHMENT_LABEL`, `CATEGORY_PRIORITY`, `firstAvailableCategory(attachments)`, `selectedVersion(bucket)`, `addVersion(attachments, kind, version)`, `removeVersion(attachments, kind, versionId)`, `renameVersion(attachments, kind, versionId, label)`, `selectVersion(attachments, kind, versionId)`

This task alone will **not** leave `npm run build` fully clean — `ImportSong.tsx`, `AddEditSong.tsx`, and `LiveStage.tsx` still reference the old `Attachment`/`AttachmentRole` types and `song.attachment` until Tasks 2–4. This is expected; the verification step below tells you exactly what to check for.

- [ ] **Step 1: Replace the attachment types in `src/state/types.ts`**

Find:

```ts
export type SongSource = "typed" | "chordpro" | "musicxml" | "imported-pdf";
export type ChartFormat = "chordpro" | "chords-over-lyrics";
export type AttachmentKind = "image" | "pdf" | "musicxml";
/** Which of the two non-chords views this attachment represents — real
 * engraved notation vs. any other unconverted reference (a photo of a
 * handwritten chart, a scanned bulletin insert, etc). Drives which tab label
 * ("Sheet Music" vs "Static File") the attachment shows under. */
export type AttachmentRole = "sheet-music" | "static-file";

export interface Attachment {
  kind: AttachmentKind;
  role: AttachmentRole;
  dataUrl: string; // in-memory only, like everything else in this mockup
  name: string; // original filename, for display
}
```

Replace with:

```ts
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
```

Find (inside `Song`):

```ts
  chordpro: string; // raw chart, used for the chord/lyric render below — "" if this song has no chords/lyrics view
  chartFormat: ChartFormat; // which syntax the chart was authored in
  /** An optional second view alongside (or instead of) the chords/lyrics
   * text — a real sheet-music scan or any other unconverted reference file.
   * A song can have chordpro, attachment, both, or (rarely) neither. */
  attachment?: Attachment;
}
```

Replace with:

```ts
  chordpro: string; // raw chart, used for the chord/lyric render below — "" if this song has no chords/lyrics view
  chartFormat: ChartFormat; // which syntax the chart was authored in
  /** Zero or more categorized, versioned attachments alongside (or instead
   * of) the chords/lyrics text — a category per file kind, each holding one
   * or more versions (e.g. a Violin PDF and a Viola PDF for the same song).
   * A song can have chords, attachments, both, or neither. */
  attachments: Attachments;
}
```

- [ ] **Step 2: Create `src/utils/attachments.ts`**

```ts
import type { AttachmentBucket, AttachmentKind, AttachmentVersion, Attachments } from "../state/types";

export const ATTACHMENT_LABEL: Record<AttachmentKind, string> = {
  musicxml: "Sheet Music",
  pdf: "PDF",
  image: "Photo",
};

// A real engraved score is the most authoritative view, then a PDF, then a
// photo — used to pick a default category when a song has more than one and
// nothing else has been chosen yet.
export const CATEGORY_PRIORITY: AttachmentKind[] = ["musicxml", "pdf", "image"];

export function firstAvailableCategory(attachments: Attachments): AttachmentKind | undefined {
  return CATEGORY_PRIORITY.find((kind) => attachments[kind]);
}

export function selectedVersion(bucket: AttachmentBucket): AttachmentVersion {
  return bucket.versions.find((v) => v.id === bucket.selectedVersionId) ?? bucket.versions[0];
}

/** Appends `version` to `attachments[kind]` (creating the bucket if it
 * doesn't exist yet) and makes it the bucket's new default. Never mutates
 * its input — every import path stays additive: a second PDF never
 * replaces the first. */
export function addVersion(attachments: Attachments, kind: AttachmentKind, version: AttachmentVersion): Attachments {
  const existing = attachments[kind]?.versions ?? [];
  return {
    ...attachments,
    [kind]: { versions: [...existing, version], selectedVersionId: version.id },
  };
}

/** Removes one version. If it was the bucket's default, a neighboring
 * version becomes the new default. If the bucket becomes empty, the whole
 * kind key is dropped from `attachments`. */
export function removeVersion(attachments: Attachments, kind: AttachmentKind, versionId: string): Attachments {
  const bucket = attachments[kind];
  if (!bucket) return attachments;
  const index = bucket.versions.findIndex((v) => v.id === versionId);
  if (index === -1) return attachments;
  const versions = bucket.versions.filter((v) => v.id !== versionId);
  if (versions.length === 0) {
    const next = { ...attachments };
    delete next[kind];
    return next;
  }
  const selectedVersionId =
    bucket.selectedVersionId === versionId ? versions[Math.min(index, versions.length - 1)].id : bucket.selectedVersionId;
  return { ...attachments, [kind]: { versions, selectedVersionId } };
}

export function renameVersion(attachments: Attachments, kind: AttachmentKind, versionId: string, label: string): Attachments {
  const bucket = attachments[kind];
  if (!bucket) return attachments;
  return {
    ...attachments,
    [kind]: { ...bucket, versions: bucket.versions.map((v) => (v.id === versionId ? { ...v, label } : v)) },
  };
}

/** Changes which version is the bucket's default — used by Add/Edit Song's
 * "Use this version" action. Live Stage's in-session version switch does
 * NOT call this; it's local view state, not a change to the song. */
export function selectVersion(attachments: Attachments, kind: AttachmentKind, versionId: string): Attachments {
  const bucket = attachments[kind];
  if (!bucket || !bucket.versions.some((v) => v.id === versionId)) return attachments;
  return { ...attachments, [kind]: { ...bucket, selectedVersionId: versionId } };
}
```

- [ ] **Step 3: Migrate the seeded song in `src/state/mockData.ts`**

Find:

```ts
    chartFormat: "chordpro",
    // Chords/lyrics not transcribed yet — this song leans on its attachment
    // (the real piano score below) until a ChordPro chart is added.
    chordpro: "",
    attachment: {
      kind: "musicxml",
      role: "sheet-music",
      dataUrl: "/assets/As_The_Deer.mxl",
      name: "As_The_Deer.mxl",
    },
  },
];
```

Replace with:

```ts
    chartFormat: "chordpro",
    // Chords/lyrics not transcribed yet — this song leans on its attachment
    // (the real piano score below) until a ChordPro chart is added.
    chordpro: "",
    attachments: {
      musicxml: {
        versions: [{ id: "att-seed-1", label: "As_The_Deer.mxl", dataUrl: "/assets/As_The_Deer.mxl", name: "As_The_Deer.mxl" }],
        selectedVersionId: "att-seed-1",
      },
    },
  },
];
```

- [ ] **Step 4: Fix `defaultView` in `src/state/store.ts`**

Find:

```ts
/** A song with no chords/lyrics text but a sheet-music/static-file
 * attachment should open on the attachment view, not an empty chart. */
function defaultView(song: Song | undefined): StageState["view"] {
  if (song && !song.chordpro.trim() && song.attachment) return "sheet";
  return "chords";
}
```

Replace with:

```ts
/** A song with no chords/lyrics text but at least one attachment should
 * open on the attachment view, not an empty chart. */
function defaultView(song: Song | undefined): StageState["view"] {
  if (song && !song.chordpro.trim() && Object.keys(song.attachments).length > 0) return "sheet";
  return "chords";
}
```

- [ ] **Step 5: Collapse the SQLite `songs` schema in `src/data/db.ts`**

Find:

```ts
const DB_NAME = "zamar";
const DB_VERSION = 1;

const CREATE_SONGS = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL,
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachment_kind TEXT,
  attachment_role TEXT,
  attachment_dataUrl TEXT,
  attachment_name TEXT
);`;
```

Replace with:

```ts
const DB_NAME = "zamar";
const DB_VERSION = 2;

// v1 shape — kept only so `addUpgradeStatement`'s v1 step still creates the
// original schema for a from-scratch install running the full upgrade
// chain (0 -> 1 -> 2); v2 below immediately replaces it.
const CREATE_SONGS_V1 = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL,
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachment_kind TEXT,
  attachment_role TEXT,
  attachment_dataUrl TEXT,
  attachment_name TEXT
);`;

// v2 — the single-slot attachment_* columns become one JSON column holding
// the new multi-category, multi-version shape (see
// docs/superpowers/specs/2026-09-20-attachment-categories-design.md).
const CREATE_SONGS = `CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  defaultKey TEXT NOT NULL,
  tempo INTEGER NOT NULL,
  timeSig TEXT NOT NULL,
  durationSec INTEGER NOT NULL,
  favourite INTEGER NOT NULL,
  source TEXT NOT NULL,
  chordpro TEXT NOT NULL,
  chartFormat TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '{}'
);`;
```

Find:

```ts
  await sqlite.addUpgradeStatement(DB_NAME, [
    {
      toVersion: DB_VERSION,
      statements: [CREATE_SONGS, CREATE_SETLISTS, CREATE_SECTIONS, CREATE_ITEMS, CREATE_SETTINGS],
    },
  ]);
```

Replace with:

```ts
  await sqlite.addUpgradeStatement(DB_NAME, [
    {
      toVersion: 1,
      statements: [CREATE_SONGS_V1, CREATE_SETLISTS, CREATE_SECTIONS, CREATE_ITEMS, CREATE_SETTINGS],
    },
    {
      // No shipped install carries real data yet, so this drops and
      // recreates rather than migrating the old columns' contents — see the
      // comment above CREATE_SONGS.
      toVersion: 2,
      statements: ["DROP TABLE IF EXISTS songs;", CREATE_SONGS],
    },
  ]);
```

- [ ] **Step 6: Update `src/data/songsRepo.ts` for the new column**

Find:

```ts
import { getDb } from "./db";
import type { AttachmentKind, AttachmentRole, Song } from "../state/types";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  defaultKey: string;
  tempo: number;
  timeSig: string;
  durationSec: number;
  favourite: number;
  source: string;
  chordpro: string;
  chartFormat: string;
  attachment_kind: string | null;
  attachment_role: string | null;
  attachment_dataUrl: string | null;
  attachment_name: string | null;
}

function rowToSong(row: SongRow): Song {
  const song: Song = {
    id: row.id,
    title: row.title,
    artist: row.artist,
    defaultKey: row.defaultKey,
    tempo: row.tempo,
    timeSig: row.timeSig,
    durationSec: row.durationSec,
    favourite: row.favourite === 1,
    source: row.source as Song["source"],
    chordpro: row.chordpro,
    chartFormat: row.chartFormat as Song["chartFormat"],
  };
  if (row.attachment_kind) {
    song.attachment = {
      kind: row.attachment_kind as AttachmentKind,
      role: row.attachment_role as AttachmentRole,
      dataUrl: row.attachment_dataUrl ?? "",
      name: row.attachment_name ?? "",
    };
  }
  return song;
}

export function buildDeleteStatement(): { statement: string; values: unknown[] } {
  return { statement: "DELETE FROM songs", values: [] };
}

export function buildInsertStatements(songs: Song[]): { statement: string; values: unknown[] }[] {
  return songs.map((s) => ({
    statement: `INSERT INTO songs
      (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachment_kind, attachment_role, attachment_dataUrl, attachment_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
      s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
      s.attachment?.kind ?? null, s.attachment?.role ?? null, s.attachment?.dataUrl ?? null, s.attachment?.name ?? null,
    ],
  }));
}
```

Replace with:

```ts
import { getDb } from "./db";
import type { Attachments, Song } from "../state/types";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  defaultKey: string;
  tempo: number;
  timeSig: string;
  durationSec: number;
  favourite: number;
  source: string;
  chordpro: string;
  chartFormat: string;
  attachments_json: string;
}

function rowToSong(row: SongRow): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    defaultKey: row.defaultKey,
    tempo: row.tempo,
    timeSig: row.timeSig,
    durationSec: row.durationSec,
    favourite: row.favourite === 1,
    source: row.source as Song["source"],
    chordpro: row.chordpro,
    chartFormat: row.chartFormat as Song["chartFormat"],
    attachments: JSON.parse(row.attachments_json || "{}") as Attachments,
  };
}

export function buildDeleteStatement(): { statement: string; values: unknown[] } {
  return { statement: "DELETE FROM songs", values: [] };
}

export function buildInsertStatements(songs: Song[]): { statement: string; values: unknown[] }[] {
  return songs.map((s) => ({
    statement: `INSERT INTO songs
      (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachments_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
      s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
      JSON.stringify(s.attachments),
    ],
  }));
}
```

(`loadAll`/`replaceAll` at the bottom of the file are unchanged.)

- [ ] **Step 7: Verify the interim build state**

Run: `npm run build`

Expected: **not** clean yet. Confirm the errors are confined to exactly these three files — `src/screens/import/ImportSong.tsx`, `src/screens/add-edit-song/AddEditSong.tsx`, `src/screens/live-stage/LiveStage.tsx` — and that every error references `attachment`, `Attachment`, or `AttachmentRole`. If any error appears in `types.ts`, `utils/attachments.ts`, `mockData.ts`, `store.ts`, `db.ts`, or `songsRepo.ts`, or any error in the three screen files is about something *other* than attachments, stop and fix it before continuing — that's a real regression, not the expected interim state.

- [ ] **Step 8: Commit**

```bash
git add src/state/types.ts src/utils/attachments.ts src/state/mockData.ts src/state/store.ts src/data/db.ts src/data/songsRepo.ts
git commit -m "$(cat <<'EOF'
Model song attachments as categorized, versioned buckets

Replaces the single attachment slot with one bucket per file kind (Sheet
Music/PDF/Photo), each holding multiple named versions, so a song no
longer loses a PDF the moment a MusicXML score is attached. Screens still
referencing the old single-attachment shape are updated in the next
commits.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Import flow (`src/screens/import/ImportSong.tsx`)

**Files:**
- Modify: `src/screens/import/ImportSong.tsx`

**Interfaces:**
- Consumes: `AttachmentKind`, `AttachmentVersion`, `Attachments` (Task 1's `src/state/types.ts`); `ATTACHMENT_LABEL`, `addVersion` (Task 1's `src/utils/attachments.ts`)
- Produces: `ImportFormDraft.attachments: Attachments` (renamed from `attachment?: Attachment`) — Task 3 (`AddEditSong.tsx`) reads and writes this field via the `prefillAttachments` nav param.

This task will leave `AddEditSong.tsx` newly broken at the `formDraft: { ..., attachment }` call site and the `prefillAttachment` param name (both still using the old singular names) — expected, fixed in Task 3.

- [ ] **Step 1: Swap the type imports and add the attachment helpers**

Find:

```ts
import type { Attachment, AttachmentRole, ChartFormat, Song } from "../../state/types";
```

Replace with:

```ts
import type { AttachmentKind, AttachmentVersion, Attachments, ChartFormat, Song } from "../../state/types";
import { ATTACHMENT_LABEL, addVersion } from "../../utils/attachments";
```

- [ ] **Step 2: Rename `ImportFormDraft.attachment` to `attachments`**

Find:

```ts
export interface ImportFormDraft {
  title: string;
  artist: string;
  tempo: string;
  timeSig: string;
  manualKey: string;
  songId?: string; // set when this draft is editing an existing song
  chordpro: string; // the form's current chart text, preserved when this import only attaches a file
  chartFormat: ChartFormat;
  attachment?: Attachment; // the form's current attachment, preserved when this import only converts chords
}
```

Replace with:

```ts
export interface ImportFormDraft {
  title: string;
  artist: string;
  tempo: string;
  timeSig: string;
  manualKey: string;
  songId?: string; // set when this draft is editing an existing song
  chordpro: string; // the form's current chart text, preserved when this import only attaches a file
  chartFormat: ChartFormat;
  attachments: Attachments; // the form's current attachments, preserved when this import only converts chords
}
```

- [ ] **Step 3: Add a version-label field, fix the MusicXML kind bug, and drop the role picker**

Find:

```ts
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<{ dataUrl: string; name: string } | null>(null);
  const [contentType, setContentType] = useState<ContentType>("chords");
  const [existingRole, setExistingRole] = useState<AttachmentRole>("sheet-music");
  const [progress, setProgress] = useState(0);
```

Replace with:

```ts
  const [phase, setPhase] = useState<Phase>("pick");
  const [file, setFile] = useState<{ dataUrl: string; name: string } | null>(null);
  const [contentType, setContentType] = useState<ContentType>("chords");
  const [versionLabel, setVersionLabel] = useState("");
  const [progress, setProgress] = useState(0);
```

Find:

```ts
  const label = METHOD_LABEL[method];
  const canDeclareContent = method !== "musicxml";
  const attachmentKind: Attachment["kind"] = method === "pdf" ? "pdf" : "image";
  const willAttach = isExisting || (contentType === "sheet" && !!file);
```

Replace with:

```ts
  const label = METHOD_LABEL[method];
  const canDeclareContent = method !== "musicxml";
  const attachmentKind: AttachmentKind = method === "pdf" ? "pdf" : method === "musicxml" ? "musicxml" : "image";
  const willAttach = isExisting || (contentType === "sheet" && !!file);

  const buildVersion = (): AttachmentVersion => ({
    id: `att-${Date.now()}`,
    label: versionLabel.trim() || file!.name,
    dataUrl: file!.dataUrl,
    name: file!.name,
  });
```

(This also fixes a latent bug: `attachmentKind` previously fell through to `"image"` for `method === "musicxml"` — unreachable today since Library's "attach to existing song" menu only offers PDF/photo, but wrong regardless and now exercised correctly by the category system.)

- [ ] **Step 4: Rebuild `finishNew`/`finishExisting`/`finishForm`/`restoreDraft` around `attachments`**

Find:

```ts
  const finishNew = () => {
    const attachment: Attachment | undefined = willAttach
      ? { kind: attachmentKind, role: "sheet-music", dataUrl: file!.dataUrl, name: file!.name }
      : undefined;
    const song: Song = {
      id: `song-${Date.now()}`,
      title: title.trim() || "Untitled import",
      artist: artist.trim() || "Unknown",
      defaultKey: willAttach ? "—" : "G",
      tempo: 80,
      timeSig: "4/4",
      durationSec: 240,
      favourite: false,
      source: method === "musicxml" ? "musicxml" : "imported-pdf",
      chordpro: willAttach ? "" : MOCK_CHORDPRO,
      chartFormat: "chordpro",
      attachment,
    };
    dispatch({ type: "ADD_SONG", song });
    nav.pop();
  };

  const finishExisting = () => {
    if (!existingSong || !file) {
      nav.pop();
      return;
    }
    const attachment: Attachment = { kind: attachmentKind, role: existingRole, dataUrl: file.dataUrl, name: file.name };
    dispatch({ type: "UPDATE_SONG", song: { ...existingSong, attachment } });
    nav.pop();
  };

  const finishForm = () => {
    // Each import touches only the view it produced — converting chords never
    // clears a prior attachment, and attaching a file never clears prior chords.
    const attachment: Attachment | undefined = willAttach
      ? { kind: attachmentKind, role: "sheet-music", dataUrl: file!.dataUrl, name: file!.name }
      : formDraft?.attachment;
    const chordpro = willAttach ? formDraft?.chordpro ?? "" : MOCK_CHORDPRO;
    const chartFormat = willAttach ? formDraft?.chartFormat ?? "chords-over-lyrics" : ("chordpro" as ChartFormat);
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      prefillTitle: formDraft?.title,
      prefillArtist: formDraft?.artist,
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: chordpro,
      prefillChartFormat: chartFormat,
      prefillAttachment: attachment,
    });
  };

  /** Returns to the New/Edit Song form with its draft exactly as it was
   * before this import started — used when backing out without saving. */
  const restoreDraft = () =>
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      prefillTitle: formDraft?.title,
      prefillArtist: formDraft?.artist,
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: formDraft?.chordpro,
      prefillChartFormat: formDraft?.chartFormat,
      prefillAttachment: formDraft?.attachment,
    });
```

Replace with:

```ts
  const finishNew = () => {
    const attachments: Attachments = willAttach ? addVersion({}, attachmentKind, buildVersion()) : {};
    const song: Song = {
      id: `song-${Date.now()}`,
      title: title.trim() || "Untitled import",
      artist: artist.trim() || "Unknown",
      defaultKey: willAttach ? "—" : "G",
      tempo: 80,
      timeSig: "4/4",
      durationSec: 240,
      favourite: false,
      source: method === "musicxml" ? "musicxml" : "imported-pdf",
      chordpro: willAttach ? "" : MOCK_CHORDPRO,
      chartFormat: "chordpro",
      attachments,
    };
    dispatch({ type: "ADD_SONG", song });
    nav.pop();
  };

  const finishExisting = () => {
    if (!existingSong || !file) {
      nav.pop();
      return;
    }
    const attachments = addVersion(existingSong.attachments, attachmentKind, buildVersion());
    dispatch({ type: "UPDATE_SONG", song: { ...existingSong, attachments } });
    nav.pop();
  };

  const finishForm = () => {
    // Each import touches only the view it produced — converting chords never
    // clears prior attachments, and attaching a file only adds a version to
    // its own category, never disturbing the others.
    const attachments = willAttach ? addVersion(formDraft?.attachments ?? {}, attachmentKind, buildVersion()) : formDraft?.attachments ?? {};
    const chordpro = willAttach ? formDraft?.chordpro ?? "" : MOCK_CHORDPRO;
    const chartFormat = willAttach ? formDraft?.chartFormat ?? "chords-over-lyrics" : ("chordpro" as ChartFormat);
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      prefillTitle: formDraft?.title,
      prefillArtist: formDraft?.artist,
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: chordpro,
      prefillChartFormat: chartFormat,
      prefillAttachments: attachments,
    });
  };

  /** Returns to the New/Edit Song form with its draft exactly as it was
   * before this import started — used when backing out without saving. */
  const restoreDraft = () =>
    nav.replace("add-edit-song", {
      songId: formDraft?.songId,
      prefillTitle: formDraft?.title,
      prefillArtist: formDraft?.artist,
      prefillTempo: formDraft?.tempo,
      prefillTimeSig: formDraft?.timeSig,
      prefillManualKey: formDraft?.manualKey,
      prefillChordpro: formDraft?.chordpro,
      prefillChartFormat: formDraft?.chartFormat,
      prefillAttachments: formDraft?.attachments,
    });
```

- [ ] **Step 5: Update the review screen's "attach to existing" caption**

Find:

```tsx
          {isExisting ? (
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              Attaching {file?.name} to <strong style={{ color: "var(--fg)" }}>{existingSong?.title}</strong> as{" "}
              {existingRole === "sheet-music" ? "sheet music" : "a static file"} — its existing chart won't change.
            </div>
          ) : (
```

Replace with:

```tsx
          {isExisting ? (
            <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
              Attaching {file?.name} to <strong style={{ color: "var(--fg)" }}>{existingSong?.title}</strong> as{" "}
              {ATTACHMENT_LABEL[attachmentKind]} — its existing chart won't change.
            </div>
          ) : (
```

- [ ] **Step 6: Drop the "Save as" role picker; add the version-name field**

Find:

```tsx
        {file && isExisting && (
          <div style={{ width: "100%", textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>Save as</div>
            <div style={{ display: "flex" }}>
              <Segmented
                options={[
                  { value: "sheet-music", label: "Sheet music" },
                  { value: "static-file", label: "Static file" },
                ]}
                value={existingRole}
                onChange={setExistingRole}
              />
            </div>
          </div>
        )}
        {file && !isExisting && canDeclareContent && (
```

Replace with:

```tsx
        {file && willAttach && (
          <div className="field" style={{ width: "100%" }}>
            <label>Name this version (optional)</label>
            <input
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="e.g. Violin, Jazz arrangement, Handwritten copy"
            />
          </div>
        )}
        {file && !isExisting && canDeclareContent && (
```

(For the `!isExisting` targets, `willAttach` only becomes true once `contentType === "sheet"` is chosen below, so this field naturally appears after that choice for new/in-form imports, and immediately for `isExisting` imports — matching where the old role picker used to sit.)

- [ ] **Step 7: Run the build and confirm the expected interim errors**

Run: `npm run build`

Expected: errors now confined to `src/screens/add-edit-song/AddEditSong.tsx` and `src/screens/live-stage/LiveStage.tsx` only (no errors in `ImportSong.tsx` — if there are, fix them before continuing). The `AddEditSong.tsx` errors should be about `attachment`/`Attachment`/`prefillAttachment`, plus a new one about passing `attachment` where `formDraft` now expects `attachments` — expected, fixed in Task 3.

- [ ] **Step 8: Manual check**

Run `npm run dev`. Go to Library → the "+" FAB (new song) → the small import FAB → Import a PDF → pick any PDF file → the "Name this version" field appears once you're on the review step → leave it blank → Save. Confirm the song is created (this exercises `finishNew`'s `addVersion` path even though `AddEditSong.tsx` isn't finished yet — you're only confirming Library shows the new song and doesn't crash).

- [ ] **Step 9: Commit**

```bash
git add src/screens/import/ImportSong.tsx
git commit -m "$(cat <<'EOF'
Make chart import additive across attachment categories

Every import target (new song, attach-to-existing, in-form) now appends a
version to the file's kind-based bucket instead of overwriting a single
slot, and picks up an optional per-version name. Drops the old manual
sheet-music/static-file role picker, which the category system replaces.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add/Edit Song attachment tabs and version management

**Files:**
- Modify: `src/screens/add-edit-song/AddEditSong.tsx`

**Interfaces:**
- Consumes: `AttachmentKind`, `Attachments` (Task 1 types); `ATTACHMENT_LABEL`, `CATEGORY_PRIORITY`, `selectedVersion`, `removeVersion`, `renameVersion`, `selectVersion` (Task 1 helpers); `ImportFormDraft.attachments`, `prefillAttachments` nav param (Task 2)
- Produces: nothing new consumed elsewhere — this screen is a leaf for the attachment system (Live Stage in Task 4 reads `Song.attachments` directly, not anything from this file)

After this task, `npm run build` should be fully clean except for `LiveStage.tsx` (fixed in Task 4).

- [ ] **Step 1: Swap imports**

Find:

```tsx
import { PdfPages } from "../../components/PdfPages";
import { Icon } from "../../components/Icon";
import { extractBracketChords, extractChordLineChords } from "../../utils/chordpro";
import type { ImportMethod } from "../import/ImportSong";
import type { Attachment, ChartFormat, Song, SongSource } from "../../state/types";
```

Replace with:

```tsx
import { PdfPages } from "../../components/PdfPages";
import { MxlScore } from "../../components/MxlScore";
import { Icon } from "../../components/Icon";
import { extractBracketChords, extractChordLineChords } from "../../utils/chordpro";
import { ATTACHMENT_LABEL, CATEGORY_PRIORITY, removeVersion, renameVersion, selectVersion, selectedVersion } from "../../utils/attachments";
import type { ImportMethod } from "../import/ImportSong";
import type { AttachmentKind, Attachments, ChartFormat, Song, SongSource } from "../../state/types";
```

- [ ] **Step 2: Replace the single-attachment state with `attachments`, and add the version-management dialogs' state**

Find:

```tsx
  const prefillChordpro = params?.prefillChordpro as string | undefined;
  const prefillChartFormat = params?.prefillChartFormat as ChartFormat | undefined;
  const prefillAttachment = params?.prefillAttachment as Attachment | undefined;
  const hadPrefillAttachment = "prefillAttachment" in (params ?? {});

  const [title, setTitle] = useState(prefillTitle ?? existing?.title ?? "");
  const [artist, setArtist] = useState(prefillArtist ?? existing?.artist ?? "");
  const [tempo, setTempo] = useState(prefillTempo ?? (existing ? String(existing.tempo) : ""));
  const [timeSig, setTimeSig] = useState(prefillTimeSig ?? existing?.timeSig ?? "4/4");
  const [manualKey, setManualKey] = useState(prefillManualKey ?? existing?.defaultKey ?? "");
  const [chordpro, setChordpro] = useState(prefillChordpro ?? existing?.chordpro ?? "");
  const [chartFormat, setChartFormat] = useState<ChartFormat>(prefillChartFormat ?? existing?.chartFormat ?? "chords-over-lyrics");
  const [attachment, setAttachment] = useState<Attachment | undefined>(hadPrefillAttachment ? prefillAttachment : existing?.attachment);
  const [tab, setTab] = useState<"source" | "preview" | "attachment">("source");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [importMethodOpen, setImportMethodOpen] = useState(false);
  const chartRef = useRef<HTMLTextAreaElement>(null);
```

Replace with:

```tsx
  const prefillChordpro = params?.prefillChordpro as string | undefined;
  const prefillChartFormat = params?.prefillChartFormat as ChartFormat | undefined;
  const prefillAttachments = params?.prefillAttachments as Attachments | undefined;
  const hadPrefillAttachments = "prefillAttachments" in (params ?? {});

  const [title, setTitle] = useState(prefillTitle ?? existing?.title ?? "");
  const [artist, setArtist] = useState(prefillArtist ?? existing?.artist ?? "");
  const [tempo, setTempo] = useState(prefillTempo ?? (existing ? String(existing.tempo) : ""));
  const [timeSig, setTimeSig] = useState(prefillTimeSig ?? existing?.timeSig ?? "4/4");
  const [manualKey, setManualKey] = useState(prefillManualKey ?? existing?.defaultKey ?? "");
  const [chordpro, setChordpro] = useState(prefillChordpro ?? existing?.chordpro ?? "");
  const [chartFormat, setChartFormat] = useState<ChartFormat>(prefillChartFormat ?? existing?.chartFormat ?? "chords-over-lyrics");
  const [attachments, setAttachments] = useState<Attachments>(hadPrefillAttachments ? prefillAttachments ?? {} : existing?.attachments ?? {});
  const [tab, setTab] = useState<"source" | "preview" | AttachmentKind>("source");
  const [showErrors, setShowErrors] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [importMethodOpen, setImportMethodOpen] = useState(false);
  const [versionSheetFor, setVersionSheetFor] = useState<{ kind: AttachmentKind; id: string; label: string } | null>(null);
  const [renameVersionFor, setRenameVersionFor] = useState<{ kind: AttachmentKind; id: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteVersion, setConfirmDeleteVersion] = useState<{ kind: AttachmentKind; id: string; label: string } | null>(null);
  const chartRef = useRef<HTMLTextAreaElement>(null);
```

- [ ] **Step 3: Compute the active tab's bucket/version, update `dirty`, `save`, and `startImport`**

Find:

```tsx
  const effectiveKey = detectedKey ?? manualKey;
  const keyValid = !effectiveKey || KEY_RE.test(effectiveKey);
  const titleValid = title.trim().length > 0;
  const dirty =
    title !== (existing?.title ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics") ||
    timeSig !== (existing?.timeSig ?? "4/4") ||
    (attachment?.dataUrl ?? null) !== (existing?.attachment?.dataUrl ?? null);
```

Replace with:

```tsx
  const effectiveKey = detectedKey ?? manualKey;
  const keyValid = !effectiveKey || KEY_RE.test(effectiveKey);
  const titleValid = title.trim().length > 0;
  const dirty =
    title !== (existing?.title ?? "") ||
    artist !== (existing?.artist ?? "") ||
    chordpro !== (existing?.chordpro ?? "") ||
    chartFormat !== (existing?.chartFormat ?? "chords-over-lyrics") ||
    timeSig !== (existing?.timeSig ?? "4/4") ||
    JSON.stringify(attachments) !== JSON.stringify(existing?.attachments ?? {});

  const activeKind: AttachmentKind | null = tab === "musicxml" || tab === "pdf" || tab === "image" ? tab : null;
  const activeBucket = activeKind ? attachments[activeKind] : undefined;
  const activeVersion = activeBucket ? selectedVersion(activeBucket) : undefined;
```

Find:

```tsx
    const song: Song = {
      id: existing?.id ?? `song-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || "Unknown",
      defaultKey: effectiveKey || "C",
      tempo: Number(tempo) || 80,
      timeSig: timeSig.trim() || "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
      attachment,
    };
    dispatch({ type: existing ? "UPDATE_SONG" : "ADD_SONG", song } as any);
    nav.pop();
  };

  const startImport = (method: ImportMethod) => {
    setImportMethodOpen(false);
    nav.replace("import-song", {
      method,
      target: { kind: "form" },
      formDraft: { title, artist, tempo, timeSig, manualKey, songId: existing?.id, chordpro, chartFormat, attachment },
    });
  };

  const removeAttachment = () => {
    setAttachment(undefined);
    setTab("source");
  };
```

Replace with:

```tsx
    const song: Song = {
      id: existing?.id ?? `song-${Date.now()}`,
      title: title.trim(),
      artist: artist.trim() || "Unknown",
      defaultKey: effectiveKey || "C",
      tempo: Number(tempo) || 80,
      timeSig: timeSig.trim() || "4/4",
      durationSec: existing?.durationSec ?? 240,
      favourite: existing?.favourite ?? false,
      source: (existing?.source ?? "typed") as SongSource,
      chordpro,
      chartFormat,
      attachments,
    };
    dispatch({ type: existing ? "UPDATE_SONG" : "ADD_SONG", song } as any);
    nav.pop();
  };

  const startImport = (method: ImportMethod) => {
    setImportMethodOpen(false);
    nav.replace("import-song", {
      method,
      target: { kind: "form" },
      formDraft: { title, artist, tempo, timeSig, manualKey, songId: existing?.id, chordpro, chartFormat, attachments },
    });
  };

  // "Add another version" inside a category tab already knows its kind, so
  // it skips the "Import a PDF/photo/MusicXML" chooser sheet and imports
  // that exact kind directly.
  const KIND_TO_METHOD: Record<AttachmentKind, ImportMethod> = { pdf: "pdf", image: "photo", musicxml: "musicxml" };
  const addVersionFor = (kind: AttachmentKind) => startImport(KIND_TO_METHOD[kind]);
```

- [ ] **Step 4: Replace the single "attachment" tab chip with one chip per present category**

Find:

```tsx
        {attachment && (
          <button className={"chip" + (tab === "attachment" ? " active" : "")} onClick={() => setTab("attachment")}>
            {attachment.role === "sheet-music" ? "Sheet Music" : "Static File"}
          </button>
        )}
```

Replace with:

```tsx
        {CATEGORY_PRIORITY.filter((kind) => attachments[kind]).map((kind) => (
          <button key={kind} className={"chip" + (tab === kind ? " active" : "")} onClick={() => setTab(kind)}>
            {ATTACHMENT_LABEL[kind]}
          </button>
        ))}
```

- [ ] **Step 5: Replace the attachment tab's content with the version-aware preview + list**

Find:

```tsx
      {tab === "attachment" && attachment && (
        <div className="flex-1 hidden-scroll" style={{ margin: "0 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {attachment.kind === "image" ? (
            <img src={attachment.dataUrl} alt={attachment.name} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
          ) : (
            <div style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
              <PdfPages src={attachment.dataUrl} />
            </div>
          )}
          <div className="muted" style={{ fontSize: 11 }}>
            {attachment.name} · {attachment.role === "sheet-music" ? "Sheet music" : "Static file"}
          </div>
          <button className="btn" style={{ color: "#8c3b3b" }} onClick={removeAttachment}>
            Remove attachment
          </button>
        </div>
      )}
```

Replace with:

```tsx
      {activeKind && activeBucket && activeVersion && (
        <div className="flex-1 hidden-scroll" style={{ margin: "0 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {activeKind === "image" ? (
            <img src={activeVersion.dataUrl} alt={activeVersion.name} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }} />
          ) : activeKind === "musicxml" ? (
            <div style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden", padding: 8 }}>
              <MxlScore src={activeVersion.dataUrl} />
            </div>
          ) : (
            <div style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)", overflow: "hidden" }}>
              <PdfPages src={activeVersion.dataUrl} />
            </div>
          )}
          <div className="muted" style={{ fontSize: 11 }}>
            {activeVersion.name} · {ATTACHMENT_LABEL[activeKind]}
          </div>

          {activeBucket.versions.length > 1 && (
            <>
              <div style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--mut)" }}>
                Versions
              </div>
              {activeBucket.versions.map((v) => (
                <button
                  key={v.id}
                  className="list-row"
                  style={v.id === activeBucket.selectedVersionId ? { borderColor: "var(--acc-deep)" } : undefined}
                  onClick={() => setVersionSheetFor({ kind: activeKind, id: v.id, label: v.label })}
                >
                  <span
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 99,
                      flex: "none",
                      border: "2px solid var(--acc-deep)",
                      background: v.id === activeBucket.selectedVersionId ? "var(--acc)" : "transparent",
                    }}
                  />
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{v.label}</div>
                    <div className="muted" style={{ fontSize: 10.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {v.name}
                    </div>
                  </span>
                </button>
              ))}
            </>
          )}

          <button className="btn" onClick={() => addVersionFor(activeKind)}>
            <Icon name="plus" size={14} strokeWidth={2} />
            Add another {ATTACHMENT_LABEL[activeKind].toLowerCase()} version
          </button>
          <button
            className="btn"
            style={{ color: "#8c3b3b" }}
            onClick={() => setConfirmDeleteVersion({ kind: activeKind, id: activeVersion.id, label: activeVersion.label })}
          >
            Remove this version
          </button>
        </div>
      )}

      {versionSheetFor && (
        <Sheet onClose={() => setVersionSheetFor(null)}>
          <div className="sheet-title">{versionSheetFor.label}</div>
          {attachments[versionSheetFor.kind]?.selectedVersionId !== versionSheetFor.id && (
            <button
              className="sheet-row"
              onClick={() => {
                const target = versionSheetFor;
                setVersionSheetFor(null);
                setAttachments((prev) => selectVersion(prev, target.kind, target.id));
              }}
            >
              <span>Use this version</span>
            </button>
          )}
          <button
            className="sheet-row"
            onClick={() => {
              const target = versionSheetFor;
              setVersionSheetFor(null);
              setRenameValue(target.label);
              setRenameVersionFor(target);
            }}
          >
            <span>Rename version</span>
          </button>
          <button
            className="sheet-row"
            style={{ color: "#8c3b3b", fontWeight: 600 }}
            onClick={() => {
              const target = versionSheetFor;
              setVersionSheetFor(null);
              setConfirmDeleteVersion(target);
            }}
          >
            <span>Remove version</span>
          </button>
        </Sheet>
      )}

      {renameVersionFor && (
        <Dialog>
          <div className="dialog-title">Rename version</div>
          <div className="field">
            <label>Version name</label>
            <input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setRenameVersionFor(null)}>
              Cancel
            </button>
            <button
              className={"btn btn-primary" + (!renameValue.trim() ? " is-disabled" : "")}
              disabled={!renameValue.trim()}
              onClick={() => {
                const target = renameVersionFor;
                setRenameVersionFor(null);
                setAttachments((prev) => renameVersion(prev, target.kind, target.id, renameValue.trim()));
              }}
            >
              Save
            </button>
          </div>
        </Dialog>
      )}

      {confirmDeleteVersion && (
        <Dialog>
          <div className="dialog-title">Remove "{confirmDeleteVersion.label}"?</div>
          <div className="dialog-body">This can't be undone.</div>
          <div className="btn-row" style={{ marginTop: 2 }}>
            <button className="btn" onClick={() => setConfirmDeleteVersion(null)}>
              Keep
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                const target = confirmDeleteVersion;
                setConfirmDeleteVersion(null);
                setAttachments((prev) => {
                  const next = removeVersion(prev, target.kind, target.id);
                  if (!next[target.kind] && tab === target.kind) setTab("source");
                  return next;
                });
              }}
            >
              Remove
            </button>
          </div>
        </Dialog>
      )}
```

- [ ] **Step 6: Run the build**

Run: `npm run build`

Expected: errors confined to `src/screens/live-stage/LiveStage.tsx` only (fixed in Task 4). If anything in `AddEditSong.tsx` still errors, fix it now — common culprits are a stale `Attachment`/`attachment` reference left behind, or `Dialog`/`Sheet` not already imported at the top of the file (they already are, from `../../components/Overlays` — confirm that import line still reads `import { Dialog, Sheet } from "../../components/Overlays";` unchanged).

- [ ] **Step 7: Manual check**

Run `npm run dev`. Open the seeded "As The Deer" song for editing (Library → its row → Edit chart, or however this repo's row-context sheet reaches Edit). Confirm:
1. A "Sheet Music" tab chip appears; opening it shows the real rendered MusicXML score.
2. Tap "Add another sheet music version", pick any `.mxl`/`.musicxml` file (or cancel back out) — confirm the round trip back into this form doesn't lose the title/artist you had typed.
3. Create a new song, use "Import" → "Import a photo" → declare "Sheet music" → save the draft back into the form. Confirm a "Photo" tab chip now appears alongside "Sheet Music" (two separate categories on one song, not one overwriting the other).
4. With 2+ versions in one bucket (import a second version into the same category), confirm the version list appears, "Use this version" / "Rename version" / "Remove version" all work, and removing the last version makes that tab disappear.

- [ ] **Step 8: Commit**

```bash
git add src/screens/add-edit-song/AddEditSong.tsx
git commit -m "$(cat <<'EOF'
Add per-category version management to the song editor

Sheet Music/PDF/Photo each get their own tab (only for categories the song
actually has), with a version list, rename/delete/use-as-default actions,
and a same-kind "add another version" shortcut. Also fixes this screen's
attachment preview mishandling a MusicXML attachment (it previously handed
raw MusicXML bytes to the PDF renderer).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Live Stage category and version viewing

**Files:**
- Modify: `src/screens/live-stage/LiveStage.tsx`

**Interfaces:**
- Consumes: `AttachmentKind` (Task 1 types); `ATTACHMENT_LABEL`, `CATEGORY_PRIORITY`, `firstAvailableCategory`, `selectedVersion` (Task 1 helpers); `Song.attachments` (unchanged since Task 1)

After this task, `npm run build` is fully clean.

- [ ] **Step 1: Add imports**

Find:

```tsx
import { MxlScore, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { Icon } from "../../components/Icon";
import { keySemitoneShift } from "../../utils/chordpro";
```

Replace with:

```tsx
import { MxlScore, type ScoreInstrument } from "../../components/MxlScore";
import { PdfPages } from "../../components/PdfPages";
import { Icon } from "../../components/Icon";
import { Sheet } from "../../components/Overlays";
import { keySemitoneShift } from "../../utils/chordpro";
import { ATTACHMENT_LABEL, CATEGORY_PRIORITY, firstAvailableCategory, selectedVersion } from "../../utils/attachments";
import type { AttachmentKind } from "../../state/types";
```

- [ ] **Step 2: Track the active category/version and fix `hasScore`**

Find:

```tsx
  const [menuOpen, setMenuOpen] = useState(false);
  const [partsOpen, setPartsOpen] = useState(false);
  const [scoreInstruments, setScoreInstruments] = useState<ScoreInstrument[]>([]);
  const [hiddenParts, setHiddenParts] = useState<Set<string>>(new Set());
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeStartX = useRef<number | null>(null);

  const song = stage.songId ? state.songs.find((s) => s.id === stage.songId) : null;
  const hasChords = Boolean(song && song.chordpro.trim());
  const hasScore = song?.attachment?.kind === "musicxml";
  const setlist = stage.setlistId ? state.setlists.find((sl) => sl.id === stage.setlistId) : null;
  const setlistSongIds = activeSetlistSongIds(setlist);

  // A song's instrument list (and any hidden parts) belongs to that song —
  // clear it when the song on stage changes so a leftover "Violin hidden"
  // selection from the last song can't silently carry over.
  useEffect(() => {
    setScoreInstruments([]);
    setHiddenParts(new Set());
  }, [song?.id]);
```

Replace with:

```tsx
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
```

- [ ] **Step 3: Compute the active bucket/version after the early returns**

Find:

```tsx
  const semitones = keySemitoneShift(song.defaultKey, stage.dispKey ?? song.defaultKey);
  const songIndex = setlistSongIds.indexOf(song.id);
```

Replace with:

```tsx
  const semitones = keySemitoneShift(song.defaultKey, stage.dispKey ?? song.defaultKey);
  const songIndex = setlistSongIds.indexOf(song.id);
  const availableKinds = CATEGORY_PRIORITY.filter((k) => song.attachments[k]);
  const activeBucket = activeKind ? song.attachments[activeKind] : undefined;
  const activeVersion = activeBucket ? activeBucket.versions.find((v) => v.id === activeVersionId) ?? selectedVersion(activeBucket) : undefined;
```

- [ ] **Step 4: Relabel the toggle button and caption**

Find:

```tsx
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
```

Replace with:

```tsx
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
```

- [ ] **Step 5: Add the category chip row and version chip below the header**

Find:

```tsx
            </div>
      </div>

      <div
        className="flex-1 hidden-scroll"
        style={{
          padding: "16px 14px 150px",
```

Replace with:

```tsx
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
```

- [ ] **Step 6: Swap the content branch to read from the active version**

Find:

```tsx
        ) : song.attachment ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0" }}>
            {song.attachment.kind === "image" ? (
              <img
                src={song.attachment.dataUrl}
                alt={song.attachment.name}
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : song.attachment.kind === "musicxml" ? (
              <MxlScore src={song.attachment.dataUrl} transpose={semitones} hiddenParts={hiddenParts} onInstrumentsChange={setScoreInstruments} />
            ) : (
              <PdfPages src={song.attachment.dataUrl} />
            )}
            <span className="muted" style={{ fontSize: 11 }}>
              {song.attachment.kind === "musicxml"
                ? `${song.attachment.name} · engraved from the score, no chords detected`
                : `${song.attachment.name} · saved as-is, no chords detected`}
            </span>
          </div>
        ) : (
```

Replace with:

```tsx
        ) : activeKind && activeVersion ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "8px 0" }}>
            {activeKind === "image" ? (
              <img
                src={activeVersion.dataUrl}
                alt={activeVersion.name}
                style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line)" }}
              />
            ) : activeKind === "musicxml" ? (
              <MxlScore src={activeVersion.dataUrl} transpose={semitones} hiddenParts={hiddenParts} onInstrumentsChange={setScoreInstruments} />
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
```

- [ ] **Step 7: Add the version-picker Sheet**

Find:

```tsx
      {partsOpen && <InstrumentFilterModal onClose={() => setPartsOpen(false)} />}
    </div>
  );
}
```

Replace with:

```tsx
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
```

- [ ] **Step 8: Run the full build**

Run: `npm run build`

Expected: **clean** — this is the first fully clean build since Task 1. If anything still errors, resolve it before moving on; do not proceed to Task 5 with a red build.

- [ ] **Step 9: Manual check**

Run `npm run dev`. Open the seeded "As The Deer" song on Live Stage and switch to the Sheet toggle — confirm the MusicXML score still renders exactly as it did before this change (single-category songs must look identical to today). Then, using the song you built up across Tasks 2–3 with 2+ categories and a 2+-version bucket:
1. Confirm the category chip row appears and switching it changes both the toggle's second-button label and the rendered content.
2. Confirm the version chip appears only when the active bucket has 2+ versions, and the version-picker Sheet's checkmark tracks the current selection.
3. Switch versions on Live Stage, then reopen the song in Add/Edit Song — confirm the editor's "selected"/default version is unchanged (the Live Stage switch was session-only).

- [ ] **Step 10: Commit**

```bash
git add src/screens/live-stage/LiveStage.tsx
git commit -m "$(cat <<'EOF'
Let Live Stage switch between attachment categories and versions

Adds a category chip row (only when a song has more than one) and a
version-switcher sheet (only when the active category has more than one
version) below the Chord/Sheet toggle. Switching versions here is
session-only — it doesn't change which version Add/Edit Song treats as
the category's default.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: End-to-end verification pass

**Files:** none (verification only — no code changes expected; if this task finds a bug, fix it in the relevant file from Tasks 1–4 and fold that fix into this task's own small commit)

- [ ] **Step 1: Clean build**

Run: `npm run build`

Expected: clean, no errors, no warnings about unused `Attachment`/`AttachmentRole` symbols (they no longer exist anywhere in `src/`).

- [ ] **Step 2: Cross-category import walkthrough**

Run `npm run dev`. **Note:** a Sheet Music (MusicXML) category can only exist on a song via the seeded mock data — Library's "attach to existing song" menu offers only PDF/Photo (never MusicXML), and MusicXML import is convert-only everywhere else (`canDeclareContent = method !== "musicxml"` in `ImportSong.tsx`, unconditionally, regardless of target), so a brand-new song can never gain a Sheet Music tab through any UI path. This is a pre-existing limitation from before this plan, not something Tasks 1-4 introduced or are meant to fix — work around it here by duplicating the seeded song instead of starting fresh:
1. Library → the seeded "As The Deer" row → its "..." menu → Duplicate. This leaves the original seed untouched for Step 6 below and gives you a copy that already has a Sheet Music tab.
2. Edit the copy; via "Import" inside the editor, import a PDF and declare "Sheet music" content (so it attaches as-is instead of converting to chords). Confirm a new "PDF" tab appears **alongside** the existing "Sheet Music" tab, not replacing it.
3. Still editing, tap "Add another PDF version" inside the PDF tab, import a second PDF, and name it "Viola" (leave the first version's name defaulted to its filename). Confirm the PDF tab lists two versions and both preview correctly.
4. Import a photo via "Import" → declare "Sheet music" content → confirm a third "Photo" tab appears, all three tabs (Sheet Music, PDF, Photo) now coexisting on the one song. Save.

- [ ] **Step 3: Live Stage walkthrough**

Load that same song onto Live Stage:
1. Toggle to "Sheet" — confirm the category chip row shows all three (Sheet Music, PDF, Photo) and switching between them updates the toggle's second-button label and the rendered content each time.
2. On the PDF category (2 versions), confirm the version chip appears and the picker sheet correctly switches between "Viola" and the other version.
3. Confirm the Sheet Music and Photo categories (1 version each) show no version chip.

- [ ] **Step 4: Deletion walkthrough**

Back in Add/Edit Song for that song, delete every version of the Photo bucket one at a time. Confirm: after the last one, the Photo tab disappears from the editor, and reopening Live Stage no longer shows a Photo chip in the category row (down to two categories).

- [ ] **Step 5: Persistence walkthrough**

With the dev server still running (browser tab), reload the page (`Ctrl+R`/`Cmd+R`). Per the existing Capacitor/SQLite persistence layer, this now round-trips through IndexedDB rather than reseeding from `mockData.ts`. Confirm the song from Steps 2–4 still has its remaining categories/versions exactly as left, and the seeded "As The Deer" song's single Sheet Music version still renders correctly.

- [ ] **Step 6: Regression check on the untouched default song**

Confirm the seeded "As The Deer" song (never touched by this feature's UI) still behaves exactly as before: Add/Edit Song shows a single "Sheet Music" tab with no version list (only one version, so the list stays hidden per Task 3's `versions.length > 1` guard), and Live Stage shows no category chip row (only one category) and no version chip (only one version).

If every step above passes, this plan is complete. If Step 2–6 surfaces a bug, fix it in the owning file, re-run the relevant step, then commit:

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix <short description of what verification caught>

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
