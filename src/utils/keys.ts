/** Keys, note spelling and letter-aware transposition. Stored values use
 * ASCII `#`/`b`; `prettyAccidentals` turns them into ♯/♭ for display. */

const LETTERS = "CDEFGAB";
/** Semitone (0 = C) of each natural in LETTERS order. */
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

export interface KeyInfo {
  name: string;
  minor: string;
}

/** Every major key with a key signature, in pitch order. Within an
 * enharmonic pair the sharp (or natural) name comes first: C#/Db, F#/Gb,
 * B/Cb. */
export const KEYS: KeyInfo[] = [
  { name: "C", minor: "Am" },
  { name: "C#", minor: "A#m" },
  { name: "Db", minor: "Bbm" },
  { name: "D", minor: "Bm" },
  { name: "Eb", minor: "Cm" },
  { name: "E", minor: "C#m" },
  { name: "F", minor: "Dm" },
  { name: "F#", minor: "D#m" },
  { name: "Gb", minor: "Ebm" },
  { name: "G", minor: "Em" },
  { name: "Ab", minor: "Fm" },
  { name: "A", minor: "F#m" },
  { name: "Bb", minor: "Gm" },
  { name: "B", minor: "G#m" },
  { name: "Cb", minor: "Abm" },
];

/** Keys whose signature has flats. Everything else spells with sharps. */
const FLAT_KEYS = new Set(["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb"]);

/** Root spellings that have no chip, mapped to the chip for the same pitch.
 * Applied when state loads and when a key is saved, so older sharps-only
 * keys (A#, D#, G#) show up on the picker. */
const KEY_RENAMES: Record<string, string> = {
  "A#": "Bb",
  "D#": "Eb",
  "G#": "Ab",
  "E#": "F",
  "B#": "C",
  Fb: "E",
};

export function canonicalKey(key: string): string {
  return KEY_RENAMES[key] ?? key;
}

export function prettyAccidentals(text: string): string {
  return text.replace(/([A-G])(#+|b+)/g, (_, letter: string, acc: string) => letter + acc.replace(/#/g, "♯").replace(/b/g, "♭"));
}

export interface ParsedNote {
  /** 0–6, index into C D E F G A B. */
  letter: number;
  /** Semitone offset from the natural: −1 flat, +1 sharp, and so on. */
  accidental: number;
}

/** Reads a note name like "C", "F#", "Bb" or "Ebb". */
export function parseNote(note: string): ParsedNote | null {
  const m = note.match(/^([A-G])(#{1,2}|b{1,2})?$/);
  if (!m) return null;
  const acc = m[2] ?? "";
  return { letter: LETTERS.indexOf(m[1]), accidental: acc.startsWith("#") ? acc.length : -acc.length };
}

export function noteName(letter: number, accidental: number): string {
  return LETTERS[letter] + (accidental > 0 ? "#".repeat(accidental) : "b".repeat(-accidental));
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function pitchOf(n: ParsedNote): number {
  return mod(NATURALS[n.letter] + n.accidental, 12);
}

/** Semitone index (0 = C) of a note name like "Eb" or "F#", or -1 when it isn't one. */
export function noteIndex(note: string): number {
  const n = parseNote(note);
  return n ? pitchOf(n) : -1;
}

/** The nearest move from one key to another, in −5…+6 semitones (a tritone
 * goes up), so sheet music never shifts more than half an octave. 0 when
 * either isn't a note. */
export function keySemitoneShift(fromKey: string, toKey: string): number {
  const a = noteIndex(fromKey);
  const b = noteIndex(toKey);
  if (a < 0 || b < 0) return 0;
  const up = mod(b - a, 12);
  return up > 6 ? up - 12 : up;
}

/** The seven note names of a major key, e.g. Gb → Gb Ab Bb Cb Db Eb F. */
function majorScale(key: ParsedNote): string[] {
  const tonic = pitchOf(key);
  return MAJOR_STEPS.map((step, i) => {
    const letter = (key.letter + i) % 7;
    return noteName(letter, mod(tonic + step - NATURALS[letter] + 6, 12) - 6);
  });
}

function isOdd(letter: number, accidental: number): boolean {
  if (Math.abs(accidental) >= 2) return true;
  const name = noteName(letter, accidental);
  return name === "E#" || name === "B#" || name === "Fb" || name === "Cb";
}

/** Letter + accidental for `pitch` placed on `letter`, simplified per the
 * spelling rule when that lands on an odd name (a double accidental, or
 * E#/B#/Fb/Cb). Rule (a), the default, keeps an odd name only when it's
 * the key's own name; rule (b), `strict`, keeps any note of the key's major
 * scale. Otherwise the pitch becomes its natural, or failing that the
 * key's side: flats in flat keys, sharps elsewhere. */
export function spellInKey(letter: number, pitch: number, key: string, strict: boolean): ParsedNote {
  const accidental = mod(pitch - NATURALS[letter] + 6, 12) - 6;
  if (!isOdd(letter, accidental)) return { letter, accidental };
  const name = noteName(letter, accidental);
  const k = parseNote(key);
  if (k && (strict ? majorScale(k).includes(name) : name === key)) return { letter, accidental };
  const natural = NATURALS.indexOf(pitch);
  if (natural >= 0) return { letter: natural, accidental: 0 };
  const flat = FLAT_KEYS.has(key);
  const l = NATURALS.indexOf(mod(pitch + (flat ? 1 : -1), 12));
  return { letter: l, accidental: flat ? -1 : 1 };
}

export interface KeyChange {
  from: string;
  to: string;
  strict: boolean;
}

/** A key change worth applying: both ends are notes, and they're spelled
 * differently (C# → Db respells even though the pitch doesn't move). */
export function activeKeyChange(from: string, to: string, strict: boolean): KeyChange | null {
  if (from === to || !parseNote(from) || !parseNote(to)) return null;
  return { from, to, strict };
}

/** Letter steps (0–6) from one key's tonic to another's. */
export function letterSteps(from: ParsedNote, to: ParsedNote): number {
  return mod(to.letter - from.letter, 7);
}

/** Moves one note name by a key change, keeping it on the matching letter
 * (F in G → C gives Bb, not A#). Null when `note` isn't a note. */
export function transposeNote(note: string, change: KeyChange): string | null {
  const n = parseNote(note);
  const from = parseNote(change.from);
  const to = parseNote(change.to);
  if (!n || !from || !to) return null;
  const letter = (n.letter + letterSteps(from, to)) % 7;
  const pitch = mod(pitchOf(n) + pitchOf(to) - pitchOf(from), 12);
  const out = spellInKey(letter, pitch, change.to, change.strict);
  return noteName(out.letter, out.accidental);
}

/** Circle-of-fifths position of a major key (C = 0, G = 1, F = −1, C# = 7,
 * Cb = −7), as MusicXML and OSMD count key signatures. */
export function keyFifths(key: string): number | null {
  const n = parseNote(key);
  if (!n) return null;
  // Each natural's fifths position (C0 D2 E4 F-1 G1 A3 B5); a sharp adds 7.
  return [0, 2, 4, -1, 1, 3, 5][n.letter] + 7 * n.accidental;
}

/** The major key name for a circle-of-fifths position (inverse of keyFifths). */
export function keyFromFifths(fifths: number): string {
  const letter = mod(fifths * 4, 7);
  const base = [0, 2, 4, -1, 1, 3, 5][letter];
  return noteName(letter, (fifths - base) / 7);
}
