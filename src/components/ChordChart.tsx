import type { ReactNode } from "react";
import { parseChordPro, type ChordPosition } from "../utils/chordpro";

export function ChordChart({
  chordpro,
  semitones = 0,
  fontScale = 1,
  hideChords = false,
}: {
  chordpro: string;
  semitones?: number;
  fontScale?: number;
  hideChords?: boolean;
}) {
  const lines = parseChordPro(chordpro, semitones).filter((l) => !l.isDirective);
  return (
    <>
      {lines.map((l, i) => (
        <div key={i}>
          {!hideChords && l.chords.length > 0 && (
            <div className="chord-line" style={{ fontSize: 12 * fontScale }}>
              {renderChordRow(l.chords)}
            </div>
          )}
          <div className="lyric-line" style={{ fontSize: 14.5 * fontScale }}>
            {l.lyric}
          </div>
        </div>
      ))}
    </>
  );
}

/** Chords render as individual chip badges, each positioned at its real
 * bracket column via literal spacer text — the chip's negative margin
 * (see .chord-chip) keeps that column math accurate despite the chip's
 * own padding. */
function renderChordRow(chords: ChordPosition[]): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  chords.forEach((c, i) => {
    if (c.col > cursor) nodes.push(" ".repeat(c.col - cursor));
    nodes.push(
      <span key={i} className="chord-chip">
        {c.sym}
      </span>
    );
    cursor = c.col + c.sym.length;
  });
  return nodes;
}
