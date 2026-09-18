import { XMLParser } from "fast-xml-parser";
import { attrsOf, childrenOf, find, findAll, findText, tagOf, textOf, type XNode } from "./xmlNav";

/** Real (non-simulated) MusicXML parsing: walks a <score-partwise> document
 * in true document order and produces a timeline of notes/lyrics and chord
 * symbols, in quarter-note units so multiple parts with different
 * <divisions> settings line up correctly. This is the one stage of the OMR
 * pipeline that needs no machine learning — it's genuine chord/lyric
 * extraction, not a stand-in. */

export interface Syllable {
  text: string;
  /** "begin" | "middle" | "end" | "single" — governs whether the next
   * syllable joins this word or starts a new one. */
  syllabic?: string;
}

export interface NoteEvent {
  measureIndex: number;
  timeQ: number; // quarter notes since piece start
  durationQ: number;
  isRest: boolean;
  syllables: Syllable[];
}

export interface HarmonyEvent {
  measureIndex: number;
  timeQ: number;
  symbol: string;
}

export interface SectionMark {
  measureIndex: number;
  timeQ: number;
  label: string;
}

export interface PartResult {
  id: string;
  name: string;
  notes: NoteEvent[];
  harmonies: HarmonyEvent[];
  sectionMarks: SectionMark[];
}

export interface ParsedScore {
  parts: PartResult[];
  keyFifths?: number;
  keyMode?: string;
  tempoBpm?: number;
}

const KIND_TO_SUFFIX: Record<string, string> = {
  major: "",
  minor: "m",
  dominant: "7",
  "major-seventh": "maj7",
  "minor-seventh": "m7",
  augmented: "aug",
  diminished: "dim",
  "diminished-seventh": "dim7",
  "half-diminished": "m7b5",
  "suspended-second": "sus2",
  "suspended-fourth": "sus4",
  "major-sixth": "6",
  "minor-sixth": "m6",
  "major-ninth": "maj9",
  "minor-ninth": "m9",
  "dominant-ninth": "9",
  power: "5",
  "major-minor": "mMaj7",
};

function alterToAccidental(alter: number): string {
  if (alter > 0) return "#".repeat(alter);
  if (alter < 0) return "b".repeat(-alter);
  return "";
}

function harmonyToSymbol(harmony: XNode): string {
  const root = find(harmony, "root");
  const step = root ? findText(root, "root-step") ?? "" : "";
  const rootAlterNode = root ? find(root, "root-alter") : undefined;
  const rootAlter = rootAlterNode ? Number(textOf(rootAlterNode)) : 0;
  const rootSym = step + alterToAccidental(rootAlter);

  const kindNode = find(harmony, "kind");
  const kindText = kindNode ? attrsOf(kindNode)["@_text"] || textOf(kindNode) : "major";
  const suffix = KIND_TO_SUFFIX[kindText] ?? "";

  const bass = find(harmony, "bass");
  const bassStep = bass ? findText(bass, "bass-step") : undefined;
  const bassAlterNode = bass ? find(bass, "bass-alter") : undefined;
  const bassAlter = bassAlterNode ? Number(textOf(bassAlterNode)) : 0;
  const bassSym = bassStep ? bassStep + alterToAccidental(bassAlter) : "";

  return rootSym + suffix + (bassSym ? `/${bassSym}` : "");
}

function parsePart(part: XNode, partList: XNode | undefined): PartResult {
  const id = attrsOf(part)["@_id"];
  const scorePart = partList ? findAll(partList, "score-part").find((sp) => attrsOf(sp)["@_id"] === id) : undefined;
  const name = (scorePart && findText(scorePart, "part-name")) || id;

  let divisions = 1;
  let cursorQ = 0;
  const notes: NoteEvent[] = [];
  const harmonies: HarmonyEvent[] = [];
  const sectionMarks: SectionMark[] = [];

  const measures = findAll(part, "measure");
  measures.forEach((measure, measureIndex) => {
    for (const el of childrenOf(measure)) {
      const tag = tagOf(el);
      if (tag === "attributes") {
        const divisionsNode = find(el, "divisions");
        if (divisionsNode) divisions = Number(textOf(divisionsNode)) || divisions;
      } else if (tag === "harmony") {
        harmonies.push({ measureIndex, timeQ: cursorQ, symbol: harmonyToSymbol(el) });
      } else if (tag === "direction") {
        const directionType = find(el, "direction-type");
        const rehearsal = directionType ? find(directionType, "rehearsal") : undefined;
        if (rehearsal) sectionMarks.push({ measureIndex, timeQ: cursorQ, label: textOf(rehearsal).trim() });
      } else if (tag === "backup") {
        const durationNode = find(el, "duration");
        cursorQ -= durationNode ? Number(textOf(durationNode)) / divisions : 0;
      } else if (tag === "forward") {
        const durationNode = find(el, "duration");
        cursorQ += durationNode ? Number(textOf(durationNode)) / divisions : 0;
      } else if (tag === "note") {
        const isChordTone = !!find(el, "chord");
        const isRest = !!find(el, "rest");
        const durationNode = find(el, "duration");
        const durationQ = durationNode ? Number(textOf(durationNode)) / divisions : 0;
        if (!isChordTone) {
          const syllables: Syllable[] = findAll(el, "lyric")
            .map((lyric) => ({ text: (findText(lyric, "text") ?? "").trim(), syllabic: findText(lyric, "syllabic") }))
            .filter((s) => s.text.length > 0);
          notes.push({ measureIndex, timeQ: cursorQ, durationQ, isRest, syllables });
          cursorQ += durationQ;
        }
        // Stacked chord-tone notes share the previous note's onset/duration —
        // they don't get their own timeline entry or advance the cursor.
      }
    }
  });

  return { id, name, notes, harmonies, sectionMarks };
}

const MAJOR_BY_FIFTHS: Record<number, string> = {
  "-7": "Cb", "-6": "Gb", "-5": "Db", "-4": "Ab", "-3": "Eb", "-2": "Bb", "-1": "F",
  "0": "C", "1": "G", "2": "D", "3": "A", "4": "E", "5": "B", "6": "F#", "7": "C#",
};

export function fifthsToKey(fifths: number, mode?: string): string {
  const root = MAJOR_BY_FIFTHS[fifths] ?? "C";
  if (mode !== "minor") return root;
  // Relative minor: three semitones below the major tonic, expressed via the
  // circle-of-fifths table shifted by +3 positions (each fifth = 7 semitones
  // mod 12, and 3 fifths up from a major root lands on its relative minor).
  const minorFifths = fifths + 3;
  return `${MAJOR_BY_FIFTHS[Math.max(-7, Math.min(7, minorFifths))] ?? "A"}m`;
}

export function parseMusicXml(xml: string): ParsedScore {
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml) as XNode[];
  const root = doc.find((n) => tagOf(n) === "score-partwise");
  if (!root) {
    throw new Error("Only <score-partwise> MusicXML is supported (score-timewise is not handled).");
  }

  const partList = find(root, "part-list");
  const parts = findAll(root, "part").map((part) => parsePart(part, partList));

  let keyFifths: number | undefined;
  let keyMode: string | undefined;
  let tempoBpm: number | undefined;
  outer: for (const part of findAll(root, "part")) {
    for (const measure of findAll(part, "measure")) {
      for (const el of childrenOf(measure)) {
        const tag = tagOf(el);
        if (tag === "attributes" && keyFifths === undefined) {
          const keyNode = find(el, "key");
          if (keyNode) {
            const fifthsText = findText(keyNode, "fifths");
            if (fifthsText !== undefined) {
              keyFifths = Number(fifthsText);
              keyMode = findText(keyNode, "mode");
            }
          }
        }
        if (tag === "direction" && tempoBpm === undefined) {
          const sound = find(el, "sound");
          const tempoAttr = sound ? attrsOf(sound)["@_tempo"] : undefined;
          if (tempoAttr) tempoBpm = Math.round(Number(tempoAttr));
        }
        if (keyFifths !== undefined && tempoBpm !== undefined) break outer;
      }
    }
  }

  return { parts, keyFifths, keyMode, tempoBpm };
}
