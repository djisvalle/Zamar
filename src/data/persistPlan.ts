import type { Setlist, Settings, Song } from "../state/types";
import * as songsRepo from "./songsRepo";
import * as setlistsRepo from "./setlistsRepo";
import * as settingsRepo from "./settingsRepo";
import type { Statement } from "./songsRepo";

/** What's on disk as of the last successful save. `settings` is null when
 * there's no settings row yet (first run, or data recovered without one). */
export interface PersistedSnapshot {
  songs: Song[];
  setlists: Setlist[];
  settings: Settings | null;
}

export const EMPTY_SNAPSHOT: PersistedSnapshot = { songs: [], setlists: [], settings: null };

/** The statements that bring disk from `persisted` to `current`, in one
 * FK-safe order: removed setlists, removed songs (with any slots still
 * pointing at them), song upserts, rewritten setlists, then settings. The
 * reducer never mutates in place, so an object that's still `===` its
 * persisted copy hasn't changed and isn't written. */
export function buildSaveStatements(persisted: PersistedSnapshot, current: PersistedSnapshot): Statement[] {
  const statements: Statement[] = [];

  const currentSetlistIds = new Set(current.setlists.map((sl) => sl.id));
  for (const sl of persisted.setlists) {
    if (!currentSetlistIds.has(sl.id)) statements.push(...setlistsRepo.buildDeleteStatements(sl.id));
  }

  const currentSongIds = new Set(current.songs.map((s) => s.id));
  for (const s of persisted.songs) {
    if (!currentSongIds.has(s.id)) statements.push(...songsRepo.buildDeleteStatements(s.id));
  }

  const persistedSongs = new Map(persisted.songs.map((s) => [s.id, s]));
  for (const s of current.songs) {
    if (persistedSongs.get(s.id) !== s) statements.push(songsRepo.buildUpsertStatement(s));
  }

  const persistedSetlists = new Map(persisted.setlists.map((sl) => [sl.id, sl]));
  for (const sl of current.setlists) {
    if (persistedSetlists.get(sl.id) !== sl) statements.push(...setlistsRepo.buildWriteStatements(sl, currentSongIds));
  }

  if (current.settings && current.settings !== persisted.settings) {
    statements.push(settingsRepo.buildUpsertStatement(current.settings));
  }

  return statements;
}
