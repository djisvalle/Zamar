import { transposeNote, type KeyChange } from "./keys";

export { keySemitoneShift, noteIndex, type KeyChange } from "./keys";

/** Transposes a chord symbol's root and, for slash chords, its bass note
 * ("G/B" from G to A is "A/C#"), keeping each note on the right letter for
 * the new key (see transposeNote). Anything it can't read is returned
 * unchanged; findChordProIssues reports those in the editor so they don't
 * get skipped silently. */
export function transposeChord(chord: string, change: KeyChange): string {
  const m = chord.match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return chord;
  const root = transposeNote(m[1], change);
  if (root === null) return chord;
  const bass = m[3] ? transposeNote(m[3], change) : null;
  return root + m[2] + (m[3] ? "/" + (bass ?? m[3]) : "");
}

/** Whether transposeChord can actually move this chord symbol. */
export function isTransposableChord(chord: string): boolean {
  return transposeChord(chord, { from: "C", to: "D", strict: false }) !== chord;
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
export function isChordLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return trimmed.split(/\s+/).every((tok) => CHORD_TOKEN_RE.test(tok));
}

/** A standalone structural keyword line — "Verse", "Verse 1", "Chorus",
 * "Tag", etc. — the plain-text equivalent of a ChordPro section directive. */
function isSectionLabel(line: string): boolean {
  return SECTION_LABEL_RE.test(line.trim());
}

const COMMENT_DIRECTIVE_RE = /^\{\s*(?:comment|c|comment_italic|ci|comment_box|cb|highlight)\s*:\s*(.*?)\s*\}$/i;
const START_SECTION_RE = /^\{\s*(?:start_of_(verse|chorus|bridge|tab|grid)|(sov|soc|sob|sot|sog))\s*(?::\s*(.*?))?\s*\}$/i;
const SECTION_SHORTHAND: Record<string, string> = { sov: "verse", soc: "chorus", sob: "bridge", sot: "tab", sog: "grid" };

/** The section label a ChordPro directive stands for, or null for directives
 * that aren't one (metadata, `{end_of_chorus}` and the like). A comment
 * (`{comment: Verse 1}`, `{c: ...}`) shows its text; `{start_of_chorus}` /
 * `{soc}` shows its own label if it has one, else the section's name. */
function directiveSectionLabel(directive: string): string | null {
  const comment = directive.match(COMMENT_DIRECTIVE_RE);
  if (comment) return comment[1] || null;
  const start = directive.match(START_SECTION_RE);
  if (!start) return null;
  if (start[3]) return start[3];
  const kind = (start[1] ?? SECTION_SHORTHAND[start[2].toLowerCase()]).toLowerCase();
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** Merges a standalone chord line with the lyric line beneath it (or an
 * empty lyric, for a floating instrumental chord line), preserving each
 * chord's real column offset the same way bracket notation does. */
function mergeChordAndLyricLine(chordLine: string, lyricLine: string, change: KeyChange | null): ChordProLine {
  const chords: ChordPosition[] = [];
  const tokenRe = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(chordLine))) {
    chords.push({ col: match.index, sym: change ? transposeChord(match[0], change) : match[0] });
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
export function parseChordProLine(raw: string, change: KeyChange | null = null): ChordProLine {
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
    chords.push({ col: lyric.length, sym: change ? transposeChord(match[1], change) : match[1] });
    lastIndex = CHORD_RE.lastIndex;
  }
  lyric += raw.slice(lastIndex);
  return { lyric, chords, isDirective: false, isSection: false };
}

/** Parses full ChordPro-or-plain-text input into rendered lines. Supports
 * both `[Chord]lyric` bracket notation and the traditional "chords over
 * lyrics" two-line format (a chord-only line followed by its lyric line),
 * so pasted charts don't have to be in ChordPro already. */
/** `change` is the key change to spell chords into (see activeKeyChange);
 * null leaves them as written. */
export function parseChordPro(text: string, change: KeyChange | null = null): ChordProLine[] {
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
      const label = directiveSectionLabel(line.trim());
      result.push(
        label ? { lyric: label, chords: [], isDirective: false, isSection: true } : { lyric: line, chords: [], isDirective: true, isSection: false }
      );
      i++;
      continue;
    }
    if (HAS_BRACKET_CHORD_RE.test(line)) {
      result.push(parseChordProLine(line, change));
      i++;
      continue;
    }
    if (isSectionLabel(line)) {
      result.push({ lyric: line.trim().replace(/\s*:$/, ""), chords: [], isDirective: false, isSection: true });
      i++;
      continue;
    }
    if (isChordLine(line)) {
      const next = rawLines[i + 1];
      const nextIsLyric =
        next !== undefined && next.trim().length > 0 && !isChordLine(next) && !DIRECTIVE_RE.test(next.trim()) && !isSectionLabel(next);
      if (nextIsLyric) {
        result.push(mergeChordAndLyricLine(line, next, change));
        i += 2;
      } else {
        result.push(mergeChordAndLyricLine(line, "", change));
        i++;
      }
      continue;
    }
    result.push({ lyric: line, chords: [], isDirective: false, isSection: false });
    i++;
  }
  return result;
}

export interface ChordProIssue {
  line: number; // 1-indexed
  message: string;
}

/** Scans raw ChordPro text for unbalanced `[`/`]` bracket chords and unclosed
 * `{directive}` braces — syntax the regex-driven parser above never rejects,
 * it just silently folds the stray bracket/brace into plain lyric text. Also
 * flags `[chords]` whose root isn't a note name (a typo like `[H]` or a lowercase
 * `[am]`), which transposition would otherwise leave behind
 * without a word. This surfaces those cases instead of leaving them invisible
 * in the editor. */
export function findChordProIssues(text: string): ChordProIssue[] {
  const issues: ChordProIssue[] = [];
  text.split("\n").forEach((raw, i) => {
    const lineNo = i + 1;
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      const opens = (trimmed.match(/\{/g) ?? []).length;
      const closes = (trimmed.match(/\}/g) ?? []).length;
      if (!trimmed.endsWith("}") || opens !== closes) {
        issues.push({ line: lineNo, message: `Unclosed "{" — directive is missing its closing "}"` });
        return;
      }
      return; // a well-formed directive has no chords to check
    }
    let depth = 0;
    for (const ch of raw) {
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth < 0) {
          issues.push({ line: lineNo, message: `Unmatched "]" with no opening "[" before it` });
          depth = 0;
        }
      }
    }
    if (depth > 0) {
      issues.push({ line: lineNo, message: `Unmatched "[" — missing its closing "]"` });
      return;
    }
    const re = /\[([^\]]+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const sym = m[1].trim();
      // "N.C." (no chord) and similar non-chord markers are fine to leave alone.
      if (/^(n\.?c\.?|x|%|\|)$/i.test(sym)) continue;
      if (!isTransposableChord(sym)) {
        issues.push({ line: lineNo, message: `"${sym}" isn't a chord Zamar can transpose, so it won't change key` });
      }
    }
  });
  return issues;
}

/** Song fields a chart can carry as ChordPro metadata directives. */
export type ChartMetaField = "title" | "artist" | "key" | "tempo" | "timeSig";

const META_DIRECTIVE_NAMES: Record<ChartMetaField, string[]> = {
  title: ["title", "t"],
  artist: ["artist"],
  key: ["key"],
  tempo: ["tempo"],
  timeSig: ["time"],
};

function metaDirectiveRe(field: ChartMetaField): RegExp {
  return new RegExp(`^([ \\t]*\\{[ \\t]*(?:${META_DIRECTIVE_NAMES[field].join("|")})[ \\t]*:)([^}\\n]*)(\\}[ \\t]*)$`, "im");
}

/** The metadata directives (`{title: ...}`, `{artist: ...}`, `{key: ...}`,
 * `{tempo: ...}`, `{time: ...}`) a chart carries, first occurrence of each.
 * A directive with an empty value is left out, so inserting a bare
 * `{title: }` doesn't blank the song's title. */
export function readChartMeta(text: string): Partial<Record<ChartMetaField, string>> {
  const meta: Partial<Record<ChartMetaField, string>> = {};
  (Object.keys(META_DIRECTIVE_NAMES) as ChartMetaField[]).forEach((field) => {
    const m = text.match(metaDirectiveRe(field));
    const value = m?.[2].trim();
    if (!value) return;
    meta[field] = field === "tempo" ? value.match(/\d+/)?.[0] ?? value : value;
  });
  return meta;
}

/** Rewrites the value of a metadata directive the chart already has, so an
 * edit to the song's field and the chart's header stay the same. A chart
 * without that directive is returned unchanged; one isn't added. */
export function writeChartMeta(text: string, field: ChartMetaField, value: string): string {
  return text.replace(metaDirectiveRe(field), (_all, open: string, _old: string, close: string) => `${open} ${value.trim()}${close}`);
}
