import { getDb } from "./db";
import type { Song } from "../state/types";

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
      kind: row.attachment_kind as "image" | "pdf",
      role: row.attachment_role as "sheet-music" | "static-file",
      dataUrl: row.attachment_dataUrl ?? "",
      name: row.attachment_name ?? "",
    };
  }
  return song;
}

export async function loadAll(): Promise<Song[]> {
  const db = await getDb();
  const result = await db.query("SELECT * FROM songs");
  return ((result.values ?? []) as SongRow[]).map(rowToSong);
}

export async function replaceAll(songs: Song[]): Promise<void> {
  const db = await getDb();
  const statements: { statement: string; values: unknown[] }[] = [{ statement: "DELETE FROM songs", values: [] }];
  for (const s of songs) {
    statements.push({
      statement: `INSERT INTO songs
        (id, title, artist, defaultKey, tempo, timeSig, durationSec, favourite, source, chordpro, chartFormat, attachment_kind, attachment_role, attachment_dataUrl, attachment_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values: [
        s.id,
        s.title,
        s.artist,
        s.defaultKey,
        s.tempo,
        s.timeSig,
        s.durationSec,
        s.favourite ? 1 : 0,
        s.source,
        s.chordpro,
        s.chartFormat,
        s.attachment?.kind ?? null,
        s.attachment?.role ?? null,
        s.attachment?.dataUrl ?? null,
        s.attachment?.name ?? null,
      ],
    });
  }
  await db.executeSet(statements);
}
