export const CHROMATIC = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const FLAT_TO_SHARP: Record<string, string> = {
  Db: "C#",
  Eb: "D#",
  Gb: "F#",
  Ab: "G#",
  Bb: "A#",
};

function normalizeRoot(root: string): string {
  return FLAT_TO_SHARP[root] ?? root;
}

export function keySemitoneShift(fromKey: string, toKey: string): number {
  const a = CHROMATIC.indexOf(normalizeRoot(fromKey));
  const b = CHROMATIC.indexOf(normalizeRoot(toKey));
  if (a < 0 || b < 0) return 0;
  return b - a;
}

export function transposeChord(chord: string, semitones: number): string {
  const m = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return chord;
  const root = normalizeRoot(m[1]);
  const idx = CHROMATIC.indexOf(root);
  if (idx < 0) return chord;
  const newIdx = ((idx + semitones) % 12 + 12) % 12;
  return CHROMATIC[newIdx] + m[2];
}

export interface ChordPosition {
  col: number;
  sym: string;
}

export interface ChordProLine {
  lyric: string;
  chords: ChordPosition[];
  isDirective: boolean;
  /** A structural section label — "Verse 1", "Chorus", "Tag", etc. ChordPro
   * has its own provisions for this (e.g. `{start_of_verse}`/{soc}` or a
   * `{comment: ...}` directive); plain "chords over lyrics" text has no such
   * syntax, so a standalone line matching a known section keyword is
   * recognized the same way. Rendered as a header, unlike isDirective lines
   * (which are hidden). */
  isSection: boolean;
}

const DIRECTIVE_RE = /^\{.*\}$/;
const CHORD_RE = /\[([^\]]+)\]/g;
const HAS_BRACKET_CHORD_RE = /\[[^\]]+\]/;
const CHORD_TOKEN_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m)?\d{0,2}(?:[#b]\d{1,2})?(?:\/[A-G][#b]?)?$/;
const SECTION_LABEL_RE =
  /^(verse|chorus|pre-?chorus|bridge|tag|intro|outro|interlude|refrain|ending|coda|vamp|instrumental|breakdown)\s*\d*:?\s*$/i;

/** A "chords over lyrics" chord line: every whitespace-separated token
 * looks like a chord symbol (e.g. "G       D       Em"), as opposed to a
 * bracketed ChordPro line or a plain lyric line. */
function isChordLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.split(/\s+/).every((tok) => CHORD_TOKEN_RE.test(tok));
}

/** A standalone structural keyword line — "Verse", "Verse 1", "Chorus",
 * "Tag", etc. — the plain-text equivalent of a ChordPro section directive. */
function isSectionLabel(line: string): boolean {
  return SECTION_LABEL_RE.test(line.trim());
}

/** Merges a standalone chord line with the lyric line beneath it (or an
 * empty lyric, for a floating instrumental chord line), preserving each
 * chord's real column offset the same way bracket notation does. */
function mergeChordAndLyricLine(chordLine: string, lyricLine: string, semitones: number): ChordProLine {
  const chords: ChordPosition[] = [];
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(chordLine))) {
    chords.push({ col: match.index, sym: semitones ? transposeChord(match[0], semitones) : match[0] });
  }
  return { lyric: lyricLine, chords, isDirective: false, isSection: false };
}

/** Unique chord symbols already used in `[Chord]`-bracket text, in order of
 * first appearance — powers the "chords used so far" quick-insert chips. */
export function extractBracketChords(text: string): string[] {
  const seen: string[] = [];
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/** Unique chord symbols already used on "chords over lyrics" chord lines,
 * in order of first appearance — same purpose as extractBracketChords but
 * for the two-line format. */
export function extractChordLineChords(text: string): string[] {
  const seen: string[] = [];
  text.split("\n").forEach((line) => {
    if (!isChordLine(line)) return;
    line
      .trim()
      .split(/\s+/)
      .forEach((tok) => {
        if (!seen.includes(tok)) seen.push(tok);
      });
  });
  return seen;
}

/** Parses one line of ChordPro text into a plain lyric string plus each
 * chord's column offset in that lyric — mirrors the source design's
 * chord-chip-over-lyric layout, computed from real bracket offsets rather
 * than hand-placed spacing. */
export function parseChordProLine(raw: string, semitones = 0): ChordProLine {
  if (DIRECTIVE_RE.test(raw.trim())) {
    return { lyric: raw, chords: [], isDirective: true, isSection: false };
  }
  let lyric = "";
  const chords: ChordPosition[] = [];
  let lastIndex = 0;
  CHORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHORD_RE.exec(raw))) {
    lyric += raw.slice(lastIndex, match.index);
    chords.push({ col: lyric.length, sym: semitones ? transposeChord(match[1], semitones) : match[1] });
    lastIndex = CHORD_RE.lastIndex;
  }
  lyric += raw.slice(lastIndex);
  return { lyric, chords, isDirective: false, isSection: false };
}

/** Parses full ChordPro-or-plain-text input into rendered lines. Supports
 * both `[Chord]lyric` bracket notation and the traditional "chords over
 * lyrics" two-line format (a chord-only line followed by its lyric line),
 * so pasted charts don't have to be in ChordPro already. */
export function parseChordPro(text: string, semitones = 0): ChordProLine[] {
  const rawLines = text.split("\n");
  const result: ChordProLine[] = [];
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (line.trim().length === 0) {
      i++;
      continue;
    }
    if (DIRECTIVE_RE.test(line.trim())) {
      result.push({ lyric: line, chords: [], isDirective: true, isSection: false });
      i++;
      continue;
    }
    if (HAS_BRACKET_CHORD_RE.test(line)) {
      result.push(parseChordProLine(line, semitones));
      i++;
      continue;
    }
    if (isSectionLabel(line)) {
      result.push({ lyric: line.trim(), chords: [], isDirective: false, isSection: true });
      i++;
      continue;
    }
    if (isChordLine(line)) {
      const next = rawLines[i + 1];
      const nextIsLyric =
        next !== undefined && next.trim().length > 0 && !isChordLine(next) && !DIRECTIVE_RE.test(next.trim()) && !isSectionLabel(next);
      if (nextIsLyric) {
        result.push(mergeChordAndLyricLine(line, next, semitones));
        i += 2;
      } else {
        result.push(mergeChordAndLyricLine(line, "", semitones));
        i++;
      }
      continue;
    }
    result.push({ lyric: line, chords: [], isDirective: false, isSection: false });
    i++;
  }
  return result;
}
