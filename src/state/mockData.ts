import type { Setlist, Song } from "./types";

export const songs: Song[] = [
  {
    id: "s1",
    title: "Amazing Grace",
    artist: "Traditional",
    defaultKey: "G",
    tempo: 66,
    timeSig: "3/4",
    durationSec: 210,
    favourite: true,
    source: "typed",
    chartFormat: "chordpro",
    chordpro: `{title: Amazing Grace}
{artist: Traditional}
{key: G}

[G]Amazing [D]grace, how [G]sweet the [Em]sound
[C]That saved a [G]wretch like [D]me
[G]I once was [C]lost, but [G]now am [D]found
Was [G]blind but [Em]now I [D]see`,
  },
  {
    id: "s2",
    title: "This Is Amazing Grace",
    artist: "Phil Wickham",
    defaultKey: "G",
    tempo: 122,
    timeSig: "4/4",
    durationSec: 285,
    favourite: false,
    source: "chordpro",
    chartFormat: "chordpro",
    chordpro: `{title: This Is Amazing Grace}
{artist: Phil Wickham}
{key: G}

Who [G]breaks the power of sin and darkness
Whose [D]love is mighty and so much stronger
[Em]This is amazing grace, this is unfailing [C]love`,
  },
  {
    id: "s3",
    title: "Blessed Assurance",
    artist: "Traditional",
    defaultKey: "D",
    tempo: 84,
    timeSig: "4/4",
    durationSec: 240,
    favourite: false,
    source: "typed",
    chartFormat: "chordpro",
    chordpro: `{title: Blessed Assurance}
{artist: Traditional}
{key: D}

[D]Blessed assurance, [G]Jesus is [D]mine
Oh what a [A]foretaste of [D]glory divine`,
  },
  {
    id: "s4",
    title: "Goodness of God",
    artist: "Bethel Music",
    defaultKey: "A",
    tempo: 63,
    timeSig: "4/4",
    durationSec: 305,
    favourite: false,
    source: "chordpro",
    chartFormat: "chordpro",
    chordpro: `{title: Goodness of God}
{artist: Bethel Music}
{key: A}

[A]I love You Lord, oh Your [E]mercy never fails me
[F#m]All my days I've been [D]held in Your hands`,
  },
  {
    id: "s5",
    title: "Great Are You Lord",
    artist: "All Sons & Daughters",
    defaultKey: "A",
    tempo: 72,
    timeSig: "4/4",
    durationSec: 250,
    favourite: false,
    source: "musicxml",
    chartFormat: "chordpro",
    chordpro: `{title: Great Are You Lord}
{artist: All Sons & Daughters}
{key: A}

You give [A]life, You are [E]love
You bring [F#m]light to the [D]darkness`,
  },
  {
    id: "s6",
    title: "Way Maker",
    artist: "Sinach",
    defaultKey: "B",
    tempo: 68,
    timeSig: "4/4",
    durationSec: 320,
    favourite: false,
    source: "typed",
    chartFormat: "chordpro",
    chordpro: `{title: Way Maker}
{artist: Sinach}
{key: B}

[B]You are here, [G#m]moving in our midst
[E]Way maker, [F#]miracle worker, [B]promise keeper`,
  },
  {
    id: "s7",
    title: "O Come to the Altar",
    artist: "Elevation Worship",
    defaultKey: "C",
    tempo: 74,
    timeSig: "4/4",
    durationSec: 270,
    favourite: false,
    source: "imported-pdf",
    chartFormat: "chordpro",
    chordpro: `{title: O Come to the Altar}
{artist: Elevation Worship}
{key: C}

[C]Are you hurting and broken within
[Am]Overwhelmed by the weight of your sin`,
  },
  {
    id: "s8",
    title: "10,000 Reasons",
    artist: "Matt Redman",
    defaultKey: "G",
    tempo: 74,
    timeSig: "4/4",
    durationSec: 270,
    favourite: false,
    source: "typed",
    chartFormat: "chordpro",
    chordpro: `{title: 10,000 Reasons}
{artist: Matt Redman}
{key: G}

[G]Bless the Lord O my [D]soul, O my [Em]soul
[C]Worship His holy [G]name`,
  },
  {
    id: "s9",
    title: "Build My Life",
    artist: "Housefires",
    defaultKey: "D",
    tempo: 68,
    timeSig: "4/4",
    durationSec: 260,
    favourite: false,
    source: "chordpro",
    chartFormat: "chordpro",
    chordpro: `{title: Build My Life}
{artist: Housefires}
{key: D}

[D]Worthy of every [A]song we could ever [Bm]sing
[G]Worthy of all the [D]praise we could ever [A]bring`,
  },
  {
    id: "s10",
    title: "Living Hope",
    artist: "Phil Wickham",
    defaultKey: "C",
    tempo: 68,
    timeSig: "4/4",
    durationSec: 300,
    favourite: false,
    source: "typed",
    chartFormat: "chordpro",
    chordpro: `{title: Living Hope}
{artist: Phil Wickham}
{key: C}

[C]How great the [G]chasm that lay between us
[Am]How high the [F]mountain I could not climb`,
  },
];

export const setlists: Setlist[] = [
  {
    id: "sunday",
    name: "Sunday AM — Aug 23",
    date: "Sun, Aug 23 2026",
    time: "9:00 AM",
    description: "Main auditorium",
    status: "upcoming",
    sections: [
      {
        id: "worship-set",
        label: "Worship Set",
        items: [
          {
            id: "i1",
            kind: "song",
            songId: "s5",
            keyOverride: "A",
            note: "Start a cappella, band in at verse 2",
          },
          { id: "i2", kind: "song", songId: "s2", keyOverride: "G" },
          {
            id: "i3",
            kind: "song",
            songId: "s6",
            keyOverride: "C",
            capo: 2,
            note: "Capo 2 · repeat bridge ×3",
          },
        ],
      },
      {
        id: "response",
        label: "Response",
        items: [
          {
            id: "i4",
            kind: "song",
            songId: "s1",
            keyOverride: "E",
            note: "Free worship after chorus 2",
          },
        ],
      },
    ],
  },
  {
    id: "youth",
    name: "Youth Night — Aug 27",
    date: "Wed, Aug 27 2026",
    time: "6:30 PM",
    description: "Youth hall",
    status: "upcoming",
    sections: [
      {
        id: "set",
        label: "Set",
        items: [
          { id: "y1", kind: "song", songId: "s10" },
          { id: "y2", kind: "song", songId: "s9" },
          { id: "y3", kind: "song", songId: "s8" },
        ],
      },
    ],
  },
];

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
