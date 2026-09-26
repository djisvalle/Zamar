import type { Setlist, Song } from "./types";
import { putAttachmentData } from "../data/attachmentData";

// A fresh install ships with exactly one song — the built-in default — not a
// bundle of sample content. See src/state/store.ts's makeEmptyStage for how
// this becomes what Live Stage shows on first boot.
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
    attachments: {
      musicxml: {
        versions: [{ id: "att-seed-1", label: "As_The_Deer.mxl", name: "As_The_Deer.mxl" }],
        selectedVersionId: "att-seed-1",
      },
    },
    notes: "",
    annotations: {},
  },
];

// The seed score's file, written with the seed song on a fresh install's
// first save. Where it's already on disk this is only an in-memory copy.
putAttachmentData("att-seed-1", "/assets/As_The_Deer.mxl");

export const setlists: Setlist[] = [];

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
