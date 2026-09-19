import type { Setlist, Song } from "./types";

// A fresh install ships with exactly one song — the built-in default — not a
// bundle of sample content. See src/state/store.ts's emptyStage for how this
// becomes what Live Stage shows on first boot.
export const songs: Song[] = [
  {
    id: "s11",
    title: "As The Deer",
    artist: "Martin Nystrom",
    defaultKey: "C",
    tempo: 74,
    timeSig: "4/4",
    durationSec: 240,
    favourite: false,
    source: "musicxml",
    chartFormat: "chordpro",
    // Chords/lyrics not transcribed yet — this song leans on its attachment
    // (the real piano score below) until a ChordPro chart is added.
    chordpro: "",
    attachment: {
      kind: "musicxml",
      role: "sheet-music",
      dataUrl: "/assets/As_The_Deer.mxl",
      name: "As_The_Deer.mxl",
    },
  },
];

export const setlists: Setlist[] = [];

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
