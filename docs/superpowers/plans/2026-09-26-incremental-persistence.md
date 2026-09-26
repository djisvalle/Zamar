# Incremental Persistence Implementation Plan

**Goal:** A save writes only the rows that changed, and attachment bytes live in their own
table, read on demand, so small edits and boot no longer scale with the size of the
library's files.

**Architecture:** `StoreProvider` keeps a snapshot of the last successfully written
`songs`/`setlists`/`settings` and builds one `executeSet` from the difference, using
object identity (the reducer never mutates). Attachment bytes move to
`attachment_data(version_id, data)`; `src/data/attachmentData.ts` holds a bounded cache
plus pending (unsaved) bytes, and the save reconciles rows by which version ids the songs
reference.

**Spec:** `docs/superpowers/specs/2026-09-26-incremental-persistence-design.md`

## Global constraints

- No test framework: `npm run build` clean after every task, plus the manual checks in the
  spec, in the browser dev frame and on Android.
- All of one save's statements stay in one `executeSet`.
- Commit as Israel Valle, no co-author trailer, no mention of AI authorship (CLAUDE.md).

## Part A (one commit)

### Task A1: Statement builders (`songsRepo.ts`, `setlistsRepo.ts`, `settingsRepo.ts`)

- `songsRepo.buildUpsertStatements(song)`: `UPDATE songs SET … WHERE id = ?` then
  `INSERT OR IGNORE INTO songs …`. `buildDeleteStatements(id)`: the song's
  `setlist_items`, then the row.
- `setlistsRepo.buildDeleteStatements(setlist)`: its items, sections, row.
  `buildWriteStatements(setlist, songIds)`: delete its items/sections, upsert its row,
  reinsert sections and items (skipping slots whose song isn't in `songIds`).
- Settings keeps its existing upsert.

### Task A2: Diff and snapshot (`src/data/persistPlan.ts`, `store.ts`, `main.tsx`)

- `buildSaveStatements(persisted, current)` returns the ordered statement list: setlist
  deletions and rewrite-deletes, removed songs, song upserts, setlist inserts, settings.
- `StoreProvider` takes a `persisted` snapshot prop, keeps it in a ref, skips a save with
  no statements, and advances the ref to the state that save wrote only on success.
- `loadInitial` returns the snapshot: the loaded data, an empty one on first run, or
  songs/setlists without settings for the recovery path.

## Part B (one commit)

### Task B1: Schema and data module (`db.ts`, `attachmentData.ts`, `types.ts`)

- DB v11: `attachment_data`.
- `AttachmentVersion` drops `dataUrl`.
- `attachmentData.ts`: `getAttachmentData`, `putAttachmentData`, `prefetchAttachmentData`,
  `discardPending`, `useAttachmentData`, and `buildAttachmentStatements(persistedSongs,
  currentSongs)` plus `markWritten(ids)` for the save.

### Task B2: Load and migrate (`songsRepo.ts`)

- `loadAll` moves any leftover `dataUrl` into `attachment_data` in one `executeSet` and
  returns metadata-only songs.

### Task B3: Save (`persistPlan.ts`, `store.ts`)

- Attachment inserts/deletes join the save's statements; written ids stop being pending
  after success.

### Task B4: Writers and readers

- Seed (`mockData.ts`): put the bundled score as pending.
- Import (`ImportSong.tsx`): `buildVersion` puts the bytes in the cache.
- Live Stage, Add/Edit preview: `useAttachmentData`; Live Stage prefetches the stage song
  and the next setlist song.
- Export (`exportSet.ts`): `await getAttachmentData(id)`.
