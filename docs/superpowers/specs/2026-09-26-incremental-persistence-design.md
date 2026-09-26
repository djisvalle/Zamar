# Incremental persistence and attachment storage

## Context

`StoreProvider`'s persist effect (`src/state/store.ts`) rewrites the whole
database on every change to `songs`, `setlists` or `settings`: it deletes
every setlist row and every song, then inserts all of them again, in one
`executeSet`. Each song row carries its attachments as base64 data URLs inside
`attachments_json`, so a text-size tap, a favourite toggle, an Annotate
recents update or a transpose reprojection re-serializes and re-writes every
PDF, photo and score in the library. On native that payload also crosses the
Capacitor bridge on every save. Boot has the mirror cost: `songsRepo.loadAll`
runs `SELECT *`, decoding every attachment into memory before the first frame.

This is finding 1 in `docs/review-findings.md`. It is harmless with the seeded
songs and grows with the library, which is exactly the OnSong-migrant case.

Decisions made in brainstorming:

- One spec, two parts, implemented in order: **A** (write only what changed)
  then **B** (move attachment bytes out of the song row).
- Attachment bytes live in a **SQLite table** in the same database, not in
  files, so they stay inside the one atomic transaction and behave the same
  on native and web.
- Attachment data is **loaded lazily, with prefetch** of the song on stage and
  the next song in the active setlist.

## Goals

- A save writes only the rows that changed. Settings-only changes touch only
  the settings row.
- A save never re-sends attachment bytes unless a version was actually added.
- Boot reads song metadata only, no attachment bytes.
- All writes of one save stay in one atomic `executeSet`, as today.
- No visible behaviour change, apart from a possible brief "Loading…" the first
  time an attachment is opened in a session when prefetch hasn't reached it.

## Out of scope

- The web dev store: `persist()` (`jeep-sqlite`'s `saveToStore`) still exports
  the whole sql.js database to IndexedDB after each save. That's the browser-dev
  fallback only and is left as is.
- Storing attachments as files on disk (`@capacitor/filesystem`). Possible
  later; this design keeps the data access behind one module so that swap
  stays local.
- Persisting `stage` or `viewport` (still session UI state).

## Part A: write only what changed

### Snapshot of what's on disk

`StoreProvider` keeps a ref holding the `songs`, `setlists` and `settings`
objects of the last **successful** save (on boot, the hydrated initial
state; when the first-run seed is written, nothing, see below). The reducer
never mutates in place, so an unchanged song or setlist keeps its object
identity, and identity is enough to detect change.

A new `src/data/diff.ts` (or a function in `store.ts`) builds the statements
for one save from `(persisted, current)`:

- **Songs.** Index both lists by id.
  - Removed ids (in persisted, not current): `DELETE FROM setlist_items WHERE
    song_id = ?` then `DELETE FROM songs WHERE id = ?`. The item delete comes
    first because `DELETE_SONGS` doesn't remove a song's setlist slots from
    state (today's full rewrite filters them out on save; see "Removed
    songs' slots" below).
  - New or changed ids (object not `===` the persisted one): an `UPDATE songs
    SET … WHERE id = ?` followed by `INSERT OR IGNORE INTO songs (…) VALUES
    (…)`. The pair works on every SQLite the app runs on (`ON CONFLICT … DO
    UPDATE` needs 3.24+) and, unlike `INSERT OR REPLACE`, never deletes the
    row, so `setlist_items.song_id` references stay valid with foreign keys on.
- **Setlists.** Same indexing.
  - Removed: delete its items (by section), its sections, then the setlist.
  - New or changed: delete its items and sections, upsert the setlist row
    (same UPDATE + INSERT OR IGNORE pair), reinsert its sections and items.
    Setlists are small; rebuilding one is cheaper to get right than diffing
    positions.
  - Items whose `songId` isn't in the current songs are skipped on insert, as
    `safeSetlists` does today.
- **Settings.** Upsert only when `current.settings !== persisted.settings`.

Statement order inside the one `executeSet` keeps it FK-safe: setlist
deletions and rebuild-deletes, then removed songs' items and rows, then song
upserts, then setlist inserts, then settings.

If the statement list comes out empty, the save is skipped (no `executeSet`,
no `persist()`).

### Removed songs' slots

Today a deleted song's slots vanish from disk but stay in state until reload.
With diffing, a setlist whose object didn't change isn't rewritten, so its
dangling item rows are removed by the per-song `DELETE FROM setlist_items
WHERE song_id = ?` above. State and disk then disagree only in the way they
already do today (state still holds the slot until reload), so nothing new is
introduced. Cleaning the slot out of state in `DELETE_SONGS` would be a
behaviour change and stays out of scope.

### Failure handling

The snapshot only advances when `executeSet` succeeds. After a failed save,
the next save diffs against the last good snapshot, so nothing is lost: every
change since then is still "changed". `persistGen` keeps today's role
(dropping a stale save's result). Because an in-flight save can finish after a
newer one is scheduled, the snapshot a save advances to is the state it
wrote, not the latest state.

### First run and recovery

`main.tsx`'s `loadInitial` returns seeded state when nothing is stored. That
case starts with an **empty** snapshot, so the first save inserts everything,
the same as today. The "songs/setlists but no settings row" recovery path
starts with a snapshot holding the loaded songs and setlists but no settings,
so the first save writes the missing settings row. `loadInitial` returns the
snapshot alongside the state; `StoreProvider` takes it as a prop.

## Part B: attachment bytes in their own table

### Schema (DB version 11)

```sql
CREATE TABLE IF NOT EXISTS attachment_data (
  version_id TEXT PRIMARY KEY,
  data TEXT NOT NULL
);
```

`data` holds what `AttachmentVersion.dataUrl` holds today: a data URL, or a
plain URL for the bundled seed score (`/assets/As_The_Deer.mxl`).

`AttachmentVersion` loses `dataUrl`. Song rows' `attachments_json` keeps only
`id`, `label`, `name` per version plus each bucket's `selectedVersionId`.

### Moving existing data (one time)

The v11 upgrade statement only creates the table. The data move runs in code
on the first boot after the upgrade, inside `songsRepo.loadAll`: any row
whose parsed attachments still carry `dataUrl` fields is rewritten in one
`executeSet` that inserts each version's bytes (`INSERT OR IGNORE INTO
attachment_data`) and updates the row's `attachments_json` without them. It
runs again harmlessly if interrupted: rows already moved have no `dataUrl`
left, and `OR IGNORE` skips bytes already copied. It's done in code because
unpacking the JSON in SQL depends on the JSON1 extension being present in
every engine.

### The attachment data module

A new `src/data/attachmentData.ts` owns the bytes in memory and on disk:

- `getAttachmentData(versionId): Promise<string>` returns the cached data or
  reads the row (`SELECT data FROM attachment_data WHERE version_id = ?`).
  Concurrent calls for one id share one read.
- `putAttachmentData(versionId, data)` puts newly imported bytes in the cache,
  marked **pending** (not yet on disk).
- `prefetchAttachmentData(versionIds)` starts reads without awaiting them.
- `useAttachmentData(versionId)` is a hook returning `{ data, status }`
  (`loading` / `ready` / `error`), for the renderers.
- The cache keeps pending entries until they're written, and keeps a small
  number of written ones (most recently used, about 8), dropping older ones.
  A PDF data URL is several MB, so the cache is bounded by count, not unbounded.

### Writing bytes: reconciled on save

The save builds blob statements from which version ids are **referenced** by
the current songs versus those referenced by the persisted snapshot's songs:

- Referenced now, not before: `INSERT OR IGNORE INTO attachment_data` with the
  cached bytes. Missing bytes (shouldn't happen) skips that id and logs a
  warning, rather than failing the whole save.
- Referenced before, not now: `DELETE FROM attachment_data WHERE version_id = ?`.

These go in the same `executeSet` as the row changes. After success, written
ids stop being pending.

Reconciling by reference, rather than on every Add/Remove action, handles
both awkward cases without special code:

- **Unsaved imports.** An import inside Add/Edit Song only puts bytes in the
  cache. Nothing is written until Save puts a song referencing the version
  into state. A cancelled draft leaves only a pending cache entry, dropped when
  the draft is discarded (or at worst at the end of the session).
- **Duplicated songs.** `DUPLICATE_SONG` copies attachments with the same
  version ids, so two songs share one row. It's deleted only when neither
  references it.

### Readers

- **Live Stage** (`LiveStage.tsx`): the image, `MxlScore` and `PdfPages`
  branches take their `src` from `useAttachmentData(activeVersion.id)` and
  show the existing "Loading score…" / "Loading pages…" wording while it's
  `loading`.
- **Prefetch:** when the stage song changes, Live Stage prefetches the version
  its default view will show, and, in a setlist, the next song's.
- **Add/Edit Song preview** and **Import** previews: the same hook. Import
  already holds the picked file's data URL in local state for its own
  preview and conversion; `buildVersion` calls `putAttachmentData` instead of
  copying the data URL into the version.
- **Export** (`utils/exportSet.ts`): its three reads of
  `selectedVersion(…).dataUrl` become `await getAttachmentData(…id)`. Export
  is already async.

### Seed data

`mockData.ts`'s seeded version keeps its id; seeding also puts
`/assets/As_The_Deer.mxl` into the cache as pending for that id, so the first
save writes it like any other new version.

## Verification

No test tooling exists, so `npm run build` stays the bar, plus manual checks
in `npm run dev` and on Android:

- Fresh install: seed songs appear, the score renders, relaunch keeps them.
- Existing install (data from before this change): first boot moves the
  bytes; songs, attachments and annotations are intact after relaunch.
- Change text size, toggle a favourite, edit a setlist: relaunch shows each
  change; in dev, logging the statement count per save shows 1–3 statements,
  not the whole library.
- Import a PDF into a new song, into an existing song, and inside Add/Edit
  Song then Cancel: only the saved ones survive a relaunch.
- Duplicate a song with a PDF, delete the original: the copy still opens its
  PDF after relaunch.
- Delete a song that's in a setlist: relaunch, the setlist loads without it.
- Export a set containing a PDF, a photo and a score.
