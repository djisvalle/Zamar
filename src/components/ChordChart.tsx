import type { ReactNode } from "react";
import { parseChordPro, type ChordPosition, type KeyChange } from "../utils/chordpro";

export function ChordChart({
  chordpro,
  keyChange = null,
  fontScale = 1,
  hideChords = false,
}: {
  chordpro: string;
  /** The key change to spell chords into; null shows them as written. */
  keyChange?: KeyChange | null;
  fontScale?: number;
  hideChords?: boolean;
}) {
  const lines = parseChordPro(chordpro, keyChange).filter((l) => !l.isDirective);
  const lyricSize = 17 * fontScale;
  return (
    <div className="chord-chart">
      {lines.map((l, i) =>
        l.isSection ? (
          <div key={i} className="chord-section-label" style={{ fontSize: lyricSize }}>
            {l.lyric}
          </div>
        ) : !hideChords && l.chords.length > 0 ? (
          <div key={i} className={"chart-line chart-line--chorded" + (l.lyric.trim() ? "" : " chart-line--chords-only")} style={{ fontSize: lyricSize }}>
            {renderChordedLine(l.lyric, l.chords, 14 * fontScale)}
          </div>
        ) : (
          <div key={i} className="chart-line lyric-line" style={{ fontSize: lyricSize }}>
            {l.lyric}
          </div>
        )
      )}
    </div>
  );
}

interface Piece {
  text: string;
  chords: string[];
}

/** Splits a lyric into pieces at every chord column and every word start,
 * grouped into words. A chord column past the end of the lyric (a chord-only
 * line, or a trailing chord) pads the lyric with spaces so it still gets a
 * piece. */
function chordedWords(lyric: string, chords: ChordPosition[]): Piece[][] {
  const lastCol = chords.reduce((max, c) => Math.max(max, c.col), 0);
  const text = lyric.length < lastCol + 1 ? lyric.padEnd(lastCol + 1, " ") : lyric;
  const breaks = new Set<number>([0]);
  chords.forEach((c) => breaks.add(c.col));
  for (let i = 1; i < text.length; i++) if (/\s/.test(text[i - 1]) && !/\s/.test(text[i])) breaks.add(i);
  const starts = [...breaks].sort((a, b) => a - b);
  const words: Piece[][] = [];
  starts.forEach((start, n) => {
    const piece = {
      text: text.slice(start, starts[n + 1] ?? text.length),
      chords: chords.filter((c) => c.col === start).map((c) => c.sym),
    };
    if (start === 0 || /\s/.test(text[start - 1])) words.push([piece]);
    else words[words.length - 1].push(piece);
  });
  return words;
}

/** Chords render as chip badges, each stacked over the lyric text it starts
 * on. A piece is as wide as the wider of its chord and its text, so a chord
 * longer than its syllable spreads the lyric apart instead of running into
 * the next chord. Lines wrap between words, never inside one, so a chord
 * stays over its syllable when a long line wraps. */
function renderChordedLine(lyric: string, chords: ChordPosition[], chordSize: number): ReactNode[] {
  return chordedWords(lyric, chords).map((word, w) => (
    <span key={w} className="chord-word">
      {word.map((p, i) => (
        <span key={i} className="chord-seg">
          <span className="chord-seg-chords" style={{ fontSize: chordSize }}>
            {p.chords.map((sym, j) => (
              <span key={j} className="chord-chip">
                {sym}
              </span>
            ))}
          </span>
          <span className="chord-seg-text">{p.text}</span>
        </span>
      ))}
    </span>
  ));
}
