import type { Setlist, SetlistItem, Song } from "../state/types";
import { formatDuration } from "../state/mockData";

export interface FlatEntry {
  item: SetlistItem;
  song: Song | null;
  sectionLabel: string;
  startSec: number;
}

/** Flattens every section's items in order, resolving each song and
 * deriving a running start time from the setlist's start time plus
 * each preceding item's duration — mirrors the source's "times
 * recalculate on drop" run-sheet behaviour. */
export function flattenSetlist(setlist: Setlist, songs: Song[]): FlatEntry[] {
  const bySongId = new Map(songs.map((s) => [s.id, s]));
  let cursor = 0;
  const out: FlatEntry[] = [];
  for (const section of setlist.sections) {
    for (const item of section.items) {
      const song = item.kind === "song" && item.songId ? bySongId.get(item.songId) ?? null : null;
      out.push({ item, song, sectionLabel: section.label, startSec: cursor });
      cursor += song ? song.durationSec : 60;
    }
  }
  return out;
}

export function setlistSongCount(setlist: Setlist): number {
  return setlist.sections.reduce((n, sec) => n + sec.items.filter((i) => i.kind === "song").length, 0);
}

export function setlistItemCount(setlist: Setlist): number {
  return setlist.sections.reduce((n, sec) => n + sec.items.length, 0);
}

export function setlistDurationSec(setlist: Setlist, songs: Song[]): number {
  return flattenSetlist(setlist, songs).reduce((sum, e) => sum + (e.song ? e.song.durationSec : 60), 0);
}

export function setlistKeyPath(setlist: Setlist, songs: Song[]): string {
  return flattenSetlist(setlist, songs)
    .filter((e) => e.song)
    .map((e) => e.item.keyOverride ?? e.song!.defaultKey)
    .join(" → ");
}

export function startClockLabel(baseTime: string, offsetSec: number): string {
  const m = baseTime.match(/(\d+):(\d+)\s*(AM|PM)?/i);
  if (!m) return baseTime;
  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  const isPM = /pm/i.test(m[3] ?? "");
  if (isPM && hour !== 12) hour += 12;
  if (!isPM && hour === 12) hour = 0;
  const total = hour * 3600 + minute * 60 + offsetSec;
  const h24 = Math.floor(total / 3600) % 24;
  const min = Math.floor((total % 3600) / 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")}`;
}

export { formatDuration };
