import { useEffect, useState } from "react";
import { getDb } from "./db";
import type { Song } from "../state/types";
import type { Statement } from "./songsRepo";
import { openingAttachment } from "../utils/attachments";

/** Attachment bytes (a data URL, or a plain URL for the bundled seed score),
 * kept out of the song rows so saving a song or loading the library doesn't
 * carry every file with it. Songs hold only version metadata; the bytes live
 * in the `attachment_data` table, keyed by version id, and are read on
 * demand through this module. See
 * docs/superpowers/specs/2026-09-26-incremental-persistence-design.md. */

/** Written entries kept in memory. A PDF's data URL is several MB, so the
 * cache is bounded by count: enough for the song on stage, the next one in
 * the set and a few recently opened. */
const MAX_CACHED = 8;

/** Most recently used last. */
const cache = new Map<string, string>();
/** Bytes not on disk yet (a fresh import, or the seed), kept regardless of
 * MAX_CACHED until a save writes them. */
const pending = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

function remember(id: string, data: string) {
  cache.delete(id);
  cache.set(id, data);
  while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
}

/** The bytes if they're in memory, without reading the database. */
export function peekAttachmentData(versionId: string): string | undefined {
  return pending.get(versionId) ?? cache.get(versionId);
}

export function getAttachmentData(versionId: string): Promise<string> {
  const known = peekAttachmentData(versionId);
  if (known !== undefined) {
    if (cache.has(versionId)) remember(versionId, known);
    return Promise.resolve(known);
  }
  const running = inFlight.get(versionId);
  if (running) return running;
  const read = (async () => {
    try {
      const db = await getDb();
      const result = await db.query("SELECT data FROM attachment_data WHERE version_id = ?", [versionId]);
      const row = (result.values ?? [])[0] as { data: string } | undefined;
      if (!row) throw new Error(`No stored data for attachment version ${versionId}`);
      remember(versionId, row.data);
      return row.data;
    } finally {
      inFlight.delete(versionId);
    }
  })();
  inFlight.set(versionId, read);
  return read;
}

/** Newly imported bytes, held until a save writes them for a song that
 * references `versionId`. An import that's never saved (a cancelled Add/Edit
 * Song draft) stays here for the rest of the session and is never written. */
export function putAttachmentData(versionId: string, data: string) {
  pending.set(versionId, data);
}

/** Starts reading these versions so they're in memory when shown. */
export function prefetchAttachmentData(versionIds: (string | undefined)[]) {
  for (const id of versionIds) if (id) getAttachmentData(id).catch(() => {});
}

/** Starts loading what the song on stage opens to, as soon as the state is
 * known and before the first render: its attachment's bytes, and the renderer
 * for its kind. The dynamic imports share the module cache, so MxlScore's and
 * PdfPages' own `import()` pick up the request already in flight. Nothing is
 * awaited; a failure here just leaves the screen to load as usual. */
export function preloadStageSong(song: Song | undefined, view: "chords" | "sheet") {
  const opening = openingAttachment(song, view);
  if (!opening) return;
  prefetchAttachmentData([opening.version.id]);
  if (opening.kind === "musicxml") import("opensheetmusicdisplay").catch(() => {});
  else if (opening.kind === "pdf") import("pdfjs-dist").catch(() => {});
}

export type AttachmentDataStatus = "loading" | "ready" | "error";

/** A version's bytes for a renderer; nothing is read while `versionId` is
 * undefined. */
export function useAttachmentData(versionId: string | undefined): { data: string | undefined; status: AttachmentDataStatus } {
  const [loaded, setLoaded] = useState<{ id: string; data?: string; failed?: boolean } | null>(null);
  useEffect(() => {
    if (!versionId) return;
    let cancelled = false;
    getAttachmentData(versionId).then(
      (data) => !cancelled && setLoaded({ id: versionId, data }),
      (err) => {
        console.warn("Zamar: couldn't read attachment data", err);
        if (!cancelled) setLoaded({ id: versionId, failed: true });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [versionId]);
  if (!versionId) return { data: undefined, status: "loading" };
  // Straight from memory when it's there, so a cached version renders on the
  // first pass instead of flashing a loading state.
  const known = peekAttachmentData(versionId) ?? (loaded?.id === versionId ? loaded.data : undefined);
  if (known !== undefined) return { data: known, status: "ready" };
  return { data: undefined, status: loaded?.id === versionId && loaded.failed ? "error" : "loading" };
}

function referencedIds(songs: Song[]): Set<string> {
  const ids = new Set<string>();
  for (const song of songs) {
    for (const bucket of Object.values(song.attachments)) for (const v of bucket?.versions ?? []) ids.add(v.id);
  }
  return ids;
}

/** Brings `attachment_data` in line with which versions the songs reference:
 * inserts the pending bytes of versions newly referenced, deletes rows no
 * song references any more. Going by reference rather than by action covers
 * an import that's never saved (never referenced, never written) and a
 * duplicated song (both copies share version ids; the row goes only when
 * neither references it). Returns the statements and the ids they insert
 * and delete, for `settleAttachmentData` once the save commits. */
export function buildAttachmentStatements(persistedSongs: Song[], currentSongs: Song[]) {
  const before = referencedIds(persistedSongs);
  const now = referencedIds(currentSongs);
  const statements: Statement[] = [];
  const inserted: string[] = [];
  const deleted: string[] = [];
  for (const id of now) {
    if (before.has(id)) continue;
    const data = pending.get(id);
    if (data === undefined) {
      // Already on disk under a snapshot that didn't list it, or lost: either
      // way there's nothing to write, and failing the save would lose more.
      if (!cache.has(id)) console.warn(`Zamar: no data to save for attachment version ${id}`);
      continue;
    }
    statements.push({ statement: "INSERT OR IGNORE INTO attachment_data (version_id, data) VALUES (?, ?)", values: [id, data] });
    inserted.push(id);
  }
  for (const id of before) {
    if (now.has(id)) continue;
    statements.push({ statement: "DELETE FROM attachment_data WHERE version_id = ?", values: [id] });
    deleted.push(id);
  }
  return { statements, inserted, deleted };
}

/** After a save commits: written bytes move from pending to the bounded
 * cache, deleted ones leave memory. */
export function settleAttachmentData(inserted: string[], deleted: string[]) {
  for (const id of inserted) {
    const data = pending.get(id);
    pending.delete(id);
    if (data !== undefined) remember(id, data);
  }
  for (const id of deleted) {
    pending.delete(id);
    cache.delete(id);
  }
}
