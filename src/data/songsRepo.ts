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

export async function loadAll(): Promise<Song[]> {
  const db = await getDb();
  const result = await db.query("SELECT * FROM songs");
  return ((result.values ?? []) as SongRow[]).map(rowToSong);
}
