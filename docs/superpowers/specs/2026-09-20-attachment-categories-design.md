# Multi-category, multi-version song attachments

## Context

Today `Song` carries a single optional `attachment` slot
(`{ kind: "image" | "pdf" | "musicxml"; role: "sheet-music" | "static-file"; dataUrl;
name }`). Two problems were raised against this:

1. **Ambiguous when more than one file type is relevant to the same song.** If a song
   has a PDF chart, a photo of a handwritten chart, and a MusicXML score all uploaded at
   different times, only the most recently attached one survives — the single slot gets
   overwritten. There's no way to keep, say, a real engraved MusicXML score *and* a PDF
   of a specific arrangement side by side.
2. **No support for multiple versions of the same kind.** A worship team often needs
   several PDFs for the same song (a Violin part, a Viola part, ...) or several MusicXML
   arrangements (classical, gospel, jazz). Today that forces creating duplicate songs
   ("Song — Violin", "Song — Viola") purely to hold different files, which then have to
   be kept in sync by hand for everything else (title, chords, key, tempo).

Decisions made during brainstorming (see chat history for the full design discussion):

- **Category = file kind**, not a user-declared role. The existing `role`
  (`sheet-music`/`static-file`) field is retired. Three fixed categories:
  `musicxml` → "Sheet Music", `pdf` → "PDF", `image` → "Photo". This directly resolves
  problem 1 — a song can carry all three simultaneously, each as its own bucket, instead
  of competing for one slot.
- **Each category holds an ordered list of versions**, each with an optional
  user-supplied label (defaults to the original filename if left blank, renameable
  later). This resolves problem 2.

## Goals

- A song can have zero or more of: a Sheet Music (MusicXML) bucket, a PDF bucket, a
  Photo bucket — independently, at the same time.
- Each bucket can hold multiple versions; the person viewing/editing the song can name
  them, switch between them, and delete individual versions without losing the others.
- Live Stage lets the person on stage pick which category and which version to view,
  without needing a separate duplicate song per version.
- No behavior change to chord/lyric charts, transpose/capo, or anything outside the
  attachment system.

## Out of scope

- Drag-and-drop reordering of versions within a bucket (matches the existing "no
  drag-and-drop" posture for setlist run-sheet items).
- Bulk rename or bulk delete across versions.
- Copying/sharing a version between two different songs.
- Any real content-based detection of what a version contains — declaring what a file
  is remains a manual choice at import time, unchanged from today.
- Changing how MusicXML is rendered (`MxlScore`) or how ChordPro charts render
  (`ChordChart`) — this spec only changes how attachments are organized and selected,
  not how any individual file is displayed.

## Data model (`src/state/types.ts`)

```ts
export type AttachmentKind = "image" | "pdf" | "musicxml"; // unchanged values; now
                                                             // also the category key

export interface AttachmentVersion {
  id: string;
  label: string;   // user-facing name, e.g. "Violin", "Jazz arrangement"; defaults to
                    // the original filename when not explicitly set
  dataUrl: string;  // in-memory only, like everything else in this mockup
  name: string;     // original filename, always preserved regardless of label
}

export interface AttachmentBucket {
  versions: AttachmentVersion[]; // non-empty whenever the bucket key is present
  selectedVersionId: string;     // must reference a version in `versions`; this is the
                                  // bucket's "default" version — what Live Stage and the
                                  // Add/Edit Song preview show unless the person switches
                                  // in-session
}

export interface Song {
  // ... unchanged fields ...
  attachments: Partial<Record<AttachmentKind, AttachmentBucket>>; // {} when the song has
                                                                    // no attachments at all
  // `attachment?: Attachment` and the `Attachment`/`AttachmentRole` types are removed.
}
```

Removing `attachment?`/`Attachment`/`AttachmentRole` is a breaking change to every
place that reads or writes `song.attachment` — see "Screen changes" and "Persistence"
below for the full list of call sites.

## Shared helpers (`src/utils/attachments.ts`, new file)

Every screen that touches attachments needs the same handful of operations. Centralizing
them avoids three slightly-different reimplementations:

```ts
export const ATTACHMENT_LABEL: Record<AttachmentKind, string> = {
  musicxml: "Sheet Music",
  pdf: "PDF",
  image: "Photo",
};

// Preference order used to pick a default category to display when a song has more
// than one and nothing else has been chosen yet (a real engraved score is the most
// authoritative view, then a PDF, then a photo).
export const CATEGORY_PRIORITY: AttachmentKind[] = ["musicxml", "pdf", "image"];

export function firstAvailableCategory(
  attachments: Partial<Record<AttachmentKind, AttachmentBucket>>
): AttachmentKind | undefined;

export function selectedVersion(bucket: AttachmentBucket): AttachmentVersion;

// Appends `version` to `attachments[kind]` (creating the bucket if absent) and makes it
// the bucket's `selectedVersionId`. Returns a new `attachments` object (never mutates).
export function addVersion(
  attachments: Partial<Record<AttachmentKind, AttachmentBucket>>,
  kind: AttachmentKind,
  version: AttachmentVersion
): Partial<Record<AttachmentKind, AttachmentBucket>>;

// Removes one version. If it was the bucket's selected version, selects the version at
// the same array index (or the new last one, if it was last). If the bucket becomes
// empty, the kind key is deleted from `attachments` entirely. Returns a new object.
export function removeVersion(
  attachments: Partial<Record<AttachmentKind, AttachmentBucket>>,
  kind: AttachmentKind,
  versionId: string
): Partial<Record<AttachmentKind, AttachmentBucket>>;

export function renameVersion(
  attachments: Partial<Record<AttachmentKind, AttachmentBucket>>,
  kind: AttachmentKind,
  versionId: string,
  label: string
): Partial<Record<AttachmentKind, AttachmentBucket>>;

// Sets `attachments[kind].selectedVersionId` — used by Add/Edit Song's "Use this
// version" action to change the bucket's persisted default.
export function selectVersion(
  attachments: Partial<Record<AttachmentKind, AttachmentBucket>>,
  kind: AttachmentKind,
  versionId: string
): Partial<Record<AttachmentKind, AttachmentBucket>>;
```

## Screen changes

### Import (`src/screens/import/ImportSong.tsx`)

- `attachmentKind` is unchanged (still derived from `method`: pdf→"pdf",
  photo→"image", musicxml→"musicxml").
- The "attach to existing song" path (`isExisting`) drops the `Segmented`
  sheet-music/static-file picker (today's lines ~351–365) — the category is now implied
  by the file's kind, so there's nothing to choose. In its place, an optional **"Name
  this version"** text input appears on the file-picked step (all three targets:
  new/existing/form, whenever `willAttach`), placeholder text like "e.g. Violin, Jazz
  arrangement, Handwritten copy". Left blank, the version's `label` falls back to the
  file's name.
- `finishNew`, `finishExisting`, and `finishForm` all build their attachment via
  `addVersion(existingAttachments, attachmentKind, { id, label, dataUrl, name })`
  instead of constructing a single `Attachment` object — this makes every import path
  additive (a second PDF never replaces the first).
  - `finishNew` starts from `{}` (a brand-new song).
  - `finishExisting` starts from `existingSong.attachments`.
  - `finishForm` starts from `formDraft.attachments` (renamed from
    `formDraft.attachment`).
- Review-screen copy for the existing-song path changes from "...as {sheet music /
  static file}" to "...as {ATTACHMENT_LABEL[attachmentKind]}" (e.g. "as PDF").
- MusicXML stays convert-only (no "what's in this file" declaration) — unaffected
  beyond using the shared `addVersion` helper.
- `ImportFormDraft.attachment` is renamed to
  `attachments: Partial<Record<AttachmentKind, AttachmentBucket>>`.

### Add/Edit Song (`src/screens/add-edit-song/AddEditSong.tsx`)

- `attachment`/`setAttachment` state is replaced with
  `attachments`/`setAttachments`, seeded the same way `chordpro` is (prefill-if-present,
  else `existing?.attachments ?? {}`).
- The tab chip row currently renders one "attachment" chip when `attachment` is set. It
  now renders one chip per kind present in `attachments`, in `CATEGORY_PRIORITY` order,
  labeled via `ATTACHMENT_LABEL` (e.g. "Sheet Music", "PDF", "Photo" — only the ones the
  song actually has).
- Tab content for the active kind:
  - Preview of `selectedVersion(attachments[activeKind])`. Today's attachment-tab
    preview only branches on `kind === "image"` vs. PDF, which mishandles a MusicXML
    attachment (it would try to hand raw MusicXML bytes to `PdfPages`, a real bug in the
    current code) — this is fixed as part of this change by branching on
    image/musicxml/pdf the same way `LiveStage.tsx` already does, rendering `MxlScore`
    for `kind === "musicxml"`.
  - A version list, shown only when the bucket has more than one version: each row shows
    the version's label (tap to rename inline via `renameVersion`), a "Use this version"
    action (`selectVersion`) highlighted when it's the bucket's current
    `selectedVersionId`, and a delete action (`removeVersion`).
  - An **"Add another version…"** button that opens the file picker for that exact kind
    directly — i.e. it calls the same `startImport(method)` used today, with `method`
    fixed to whichever one maps to the active kind (`pdf`→"pdf", `image`→"photo",
    `musicxml`→"musicxml"), skipping the "Import a PDF / photo / MusicXML" chooser sheet
    since the kind is already known from which tab you're on.
  - Deleting the last version of a bucket (via `removeVersion`) removes that kind from
    `attachments`, and if it was the active tab, the tab strip falls back to "Chords/Lyrics".
- `dirty` check changes from comparing `attachment?.dataUrl` to a structural comparison
  of `attachments` (e.g. `JSON.stringify` both sides — consistent with this being a
  mockup with no deep-diffing utility elsewhere).
- `save()` builds `Song.attachments` directly from state (no `Attachment` object).

### Live Stage (`src/screens/live-stage/LiveStage.tsx`)

- `hasScore` becomes `Boolean(song?.attachments.musicxml)`.
- The Chord/Sheet toggle's second button relabels from the current "Sheet"/"File" swap
  to the active category's `ATTACHMENT_LABEL` (e.g. "Sheet Music", "PDF", "Photo"). When
  the song has no attachments at all, it keeps today's fallback behavior (disabled/empty
  state prompting to attach a chart).
- New: when the song has attachments in **more than one** kind, a chip row appears
  beneath the toggle (only for the kinds actually present) to switch categories, e.g.
  `[Sheet Music] [PDF]`. Which category is active is local component state
  (`activeKind`), defaulting via `firstAvailableCategory` — the same
  `CATEGORY_PRIORITY` order used elsewhere — and reset via `useEffect` whenever
  `song.id` changes (mirroring the existing `scoreInstruments`/`hiddenParts` reset
  effect at the top of the component).
- New: when the active bucket has **more than one version**, a chip (e.g. "▾ Violin",
  showing `selectedVersion(bucket).label`) opens a `Sheet` listing every version in that
  bucket by label; tapping one sets local `activeVersionId` state for the current
  viewing session. This is intentionally **not** written back to the song (no
  `dispatch`) — it's a transient "what am I looking at right now" choice. Changing the
  bucket's persisted default happens only from Add/Edit Song's "Use this version".
  `activeVersionId` resets to the bucket's `selectedVersionId` whenever `activeKind` or
  `song.id` changes.
- The sheet/chart render branch (`song.attachment.kind === "image" ? ... : ...`) becomes
  keyed off `activeKind` and reads `dataUrl`/`name` from the active version rather than
  a single attachment.
- `InstrumentFilterModal`'s "Parts" button (MusicXML instrument-visibility filter) is
  unaffected in behavior, but its reset effect gains `activeVersionId` to its dependency
  list so switching MusicXML versions clears any stale hidden-parts selection from a
  previous version of the score.

## Persistence (`src/data/db.ts`, `src/data/songsRepo.ts`)

The SQLite layer (added in the [capacitor-persistence
phase](2026-08-26-capacitor-persistence-design.md)) has flat
`attachment_kind`/`attachment_role`/`attachment_dataUrl`/`attachment_name` columns on
`songs`, matching the old single-slot model. Since that layer already does a full
delete+reinsert per changed slice (no per-field SQL updates — see that spec's
"Persistence effect" section), the simplest change consistent with the existing pattern
is to collapse those four columns into one:

```sql
attachments_json TEXT NOT NULL DEFAULT '{}'
```

- `rowToSong` parses it: `JSON.parse(row.attachments_json) as Song["attachments"]`.
- `buildInsertStatements` serializes it: `JSON.stringify(s.attachments)`.
- `DB_VERSION` bumps from `1` to `2` with a new upgrade statement that drops and
  recreates the `songs` table with the new column. This is a destructive schema change
  for any existing local dev database — acceptable here since there is no shipped
  install with real user data yet (per the persistence spec's own "no production data"
  framing); a real migration that preserves rows is not justified at this stage.

## Migration / seed data (`src/state/mockData.ts`)

The one seeded attachment (a MusicXML score on the "As The Deer" sample song) becomes:

```ts
attachments: {
  musicxml: {
    versions: [{ id: "att-1", label: "As_The_Deer.mxl", dataUrl: "/assets/As_The_Deer.mxl", name: "As_The_Deer.mxl" }],
    selectedVersionId: "att-1",
  },
},
```

Every other seeded song gets `attachments: {}`.

## Testing / verification

No automated test framework exists in this repo (per CLAUDE.md's documented gotcha);
`npm run build` (`tsc -b && vite build`) is the correctness bar, plus manual click-through
per this repo's established practice:

1. `npm run build` is clean (verifies the `Attachment`/`AttachmentRole` type removal
   didn't leave any stale references).
2. Import a PDF as a new song, then edit that song and import a second PDF as another
   version — confirm both versions appear in the PDF tab's version list and both are
   individually selectable and independently deletable.
3. Import a MusicXML file and a photo onto the *same* existing song (two separate
   "attach to existing song" imports) — confirm Add/Edit Song shows two tabs (Sheet
   Music, Photo) rather than the second import clobbering the first.
4. On Live Stage for that song, confirm the category chip row shows both, switching
   category updates the rendered content, and — for a bucket with 2+ versions — the
   version chip switches the displayed file without changing what Add/Edit Song
   considers the "default" version for that bucket.
5. Delete every version of one bucket from Add/Edit Song — confirm that category's tab
   and Live Stage chip disappear.
6. Force-close/reload (`npm run dev` browser reload, which now round-trips through
   SQLite/IndexedDB) — confirm the multi-category, multi-version state survives.
