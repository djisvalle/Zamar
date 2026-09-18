import { fifthsToKey, type ParsedScore, type PartResult } from "./parseMusicXml";

/** Converts a parsed MusicXML timeline into ChordPro text — real chord
 * placement derived from each note's actual beat position, not a canned
 * sample. Section-labeled instrumental measures fall back to a chord-only
 * line (e.g. "[G] [D] [Em]"), matching how ChordPro represents intros/turns
 * with no lyric underneath. */

const KNOWN_SECTION_WORDS =
  /^(verse|chorus|pre-?chorus|bridge|tag|intro|outro|interlude|refrain|ending|coda|vamp|instrumental|breakdown)\b/i;

function pickLyricPart(parts: PartResult[]): PartResult | undefined {
  let best: PartResult | undefined;
  let bestCount = 0;
  for (const part of parts) {
    const count = part.notes.reduce((sum, n) => sum + n.syllables.length, 0);
    if (count > bestCount) {
      best = part;
      bestCount = count;
    }
  }
  return best;
}

export interface ChordProResult {
  text: string;
  detectedKey?: string;
  warnings: string[];
}

export function toChordPro(score: ParsedScore): ChordProResult {
  const warnings: string[] = [];
  const lyricPart = pickLyricPart(score.parts);
  const measureCount = Math.max(0, ...score.parts.map((p) => 1 + Math.max(-1, ...p.notes.map((n) => n.measureIndex))));

  const allHarmonies = score.parts
    .flatMap((p) => p.harmonies)
    .sort((a, b) => a.measureIndex - b.measureIndex || a.timeQ - b.timeQ);
  const allSectionMarks = score.parts
    .flatMap((p) => p.sectionMarks)
    .sort((a, b) => a.measureIndex - b.measureIndex || a.timeQ - b.timeQ);

  if (allHarmonies.length === 0) {
    warnings.push("No <harmony> (chord symbol) elements found in this score — the chart will have lyrics but no chords.");
  }
  if (!lyricPart || lyricPart.notes.every((n) => n.syllables.length === 0)) {
    warnings.push("No lyrics found in this score — the chart will show chord-only lines.");
  }

  const lines: string[] = [];
  const detectedKey = score.keyFifths !== undefined ? fifthsToKey(score.keyFifths, score.keyMode) : undefined;
  if (detectedKey) lines.push(`{key: ${detectedKey}}`, "");

  let lastPlacedHarmonyIdx = -1;

  for (let m = 0; m < measureCount; m++) {
    const sectionAtMeasure = allSectionMarks.find((s) => s.measureIndex === m);
    if (sectionAtMeasure && KNOWN_SECTION_WORDS.test(sectionAtMeasure.label)) {
      lines.push(sectionAtMeasure.label);
    }

    const notesInMeasure = lyricPart ? lyricPart.notes.filter((n) => n.measureIndex === m && !n.isRest) : [];
    const harmoniesInMeasure = allHarmonies.filter((h) => h.measureIndex === m);
    const hasLyrics = notesInMeasure.some((n) => n.syllables.length > 0);

    if (hasLyrics) {
      let line = "";
      let pendingJoin = false; // true when the previous syllable was begin/middle (this one continues the same word)
      for (const note of notesInMeasure) {
        for (const syllable of note.syllables) {
          if (!pendingJoin && line.length > 0) line += " ";
          const harmonyIdx = allHarmonies.findIndex(
            (h, i) => i > lastPlacedHarmonyIdx && (h.measureIndex < m || (h.measureIndex === m && h.timeQ <= note.timeQ))
          );
          if (harmonyIdx !== -1) {
            line += `[${allHarmonies[harmonyIdx].symbol}]`;
            lastPlacedHarmonyIdx = harmonyIdx;
          }
          line += syllable.text;
          pendingJoin = syllable.syllabic === "begin" || syllable.syllabic === "middle";
        }
      }
      lines.push(line.trim());
    } else if (harmoniesInMeasure.length > 0) {
      lines.push(harmoniesInMeasure.map((h) => `[${h.symbol}]`).join(" "));
      lastPlacedHarmonyIdx = Math.max(lastPlacedHarmonyIdx, allHarmonies.indexOf(harmoniesInMeasure[harmoniesInMeasure.length - 1]));
    }
  }

  return { text: lines.join("\n").trim(), detectedKey, warnings };
}
