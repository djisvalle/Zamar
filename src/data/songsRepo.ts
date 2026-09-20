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
  };
}

export function buildDeleteStatement(): { statement: string; values: unknown[] } {
  return { statement: "DELETE FROM songs", values: [] };
}

export function buildInsertStatements(songs: Song[]): { statement: string; values: unknown[] }[] {
  return songs.map((s) => ({
    statement: `INSERT INTO songs
      (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachments_json, notes, annotations_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    values: [
      s.id, s.title, s.artist, s.defaultKey, s.tempo, s.timeSig, s.durationSec,
      s.favourite ? 1 : 0, s.source, s.chordpro, s.chartFormat,
      JSON.stringify(s.attachments), s.notes, JSON.stringify(s.annotations),
    ],
  }));
}

export async function loadAll(): Promise<Song[]> {
  const db = await getDb();
  const result = await db.query("SELECT * FROM songs");
  return ((result.values ?? []) as SongRow[]).map(rowToSong);
}

export async function replaceAll(songs: Song[]): Promise<void> {
  const db = await getDb();
  await db.executeSet([buildDeleteStatement(), ...buildInsertStatements(songs)]);
}
