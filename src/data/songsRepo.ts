import { getDb, persist } from "./db";
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
  notes: string;
  annotations_json: string;
  defaultView: string | null;
  chordsTextScale: number | null;
  annotationWidths_json: string | null;
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
    notes: row.notes ?? "",
    annotations: JSON.parse(row.annotations_json || "{}") as Song["annotations"],
    defaultView: (row.defaultView ?? undefined) as Song["defaultView"],
    chordsTextScale: row.chordsTextScale ?? undefined,
    annotationWidths: row.annotationWidths_json ? (JSON.parse(row.annotationWidths_json) as Song["annotationWidths"]) : undefined,
  };
}

export type Statement = { statement: string; values: unknown[] };

const SONG_COLUMNS = [
  "id", "title", "artist", "defaultKey", "tempo", "timeSig", "durationSec", "favourite", "source", "chordpro",
  "chartFormat", "attachments_json", "notes", "annotations_json", "defaultView", "chordsTextScale", "annotationWidths_json",
];

function songValues(s: Song): unknown[] {
  return [
    s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
    s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
    JSON.stringify(s.attachments), s.notes, JSON.stringify(s.annotations), s.defaultView ?? null,
    s.chordsTextScale ?? null,
    s.annotationWidths ? JSON.stringify(s.annotationWidths) : null,
  ];
}

/** Inserts the song or updates its row in place. An upsert, not INSERT OR
 * REPLACE: REPLACE deletes the old row first, which the setlist_items
 * foreign key to it would refuse. */
export function buildUpsertStatement(song: Song): Statement {
  const updates = SONG_COLUMNS.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`).join(", ");
  return {
    statement: `INSERT INTO songs (${SONG_COLUMNS.join(", ")})
      VALUES (${SONG_COLUMNS.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET ${updates}`,
    values: songValues(song),
  };
}

/** Removes a song, along with any setlist slots still pointing at it
 * (deleting a song leaves its slots in state; they're dropped on disk). */
export function buildDeleteStatements(songId: string): Statement[] {
  return [
    { statement: "DELETE FROM setlist_items WHERE song_id = ?", values: [songId] },
    { statement: "DELETE FROM songs WHERE id = ?", values: [songId] },
  ];
}

/** Bytes left inside `attachments_json` by a version from before
 * attachment_data existed. */
type LegacyAttachments = Record<string, { versions: { id: string; dataUrl?: string }[] } | undefined>;

/** Reads every song's metadata. The first time it runs after the v11
 * upgrade, it also moves any attachment bytes still inside a row's
 * `attachments_json` into attachment_data, in one transaction. Safe to
 * repeat if interrupted: a moved row has no bytes left in it, and bytes
 * already copied are skipped. */
export async function loadAll(): Promise<Song[]> {
  const db = await getDb();
  const result = await db.query("SELECT * FROM songs");
  const rows = (result.values ?? []) as SongRow[];
  const moves: Statement[] = [];
  for (const row of rows) {
    const attachments = JSON.parse(row.attachments_json || "{}") as LegacyAttachments;
    let moved = false;
    for (const bucket of Object.values(attachments)) {
      for (const version of bucket?.versions ?? []) {
        if (version.dataUrl === undefined) continue;
        moves.push({
          statement: "INSERT OR IGNORE INTO attachment_data (version_id, data) VALUES (?, ?)",
          values: [version.id, version.dataUrl],
        });
        delete version.dataUrl;
        moved = true;
      }
    }
    if (moved) {
      row.attachments_json = JSON.stringify(attachments);
      moves.push({ statement: "UPDATE songs SET attachments_json = ? WHERE id = ?", values: [row.attachments_json, row.id] });
    }
  }
  if (moves.length > 0) {
    await db.executeSet(moves);
    await persist();
  }
  return rows.map(rowToSong);
}
