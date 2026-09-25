import type { ITransposeCalculator, KeyInstruction, Pitch } from "opensheetmusicdisplay";
import { keyFifths, keyFromFifths, letterSteps, parseNote, spellInKey } from "./keys";

type Osmd = typeof import("opensheetmusicdisplay");

const NATURALS = [0, 2, 4, 5, 7, 9, 11];
/** OSMD's own choice of key signature (in fifths) for each tonic pitch:
 * Db, F# and B for the three enharmonic pairs. */
const DEFAULT_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Replaces OSMD's TransposeCalculator so a transposed score matches the key
 * picked on the chips: the key signature takes the picked spelling (C# is
 * seven sharps, not Db's five flats), and each note keeps its letter
 * relative to the key, the way the chord chart does. Scores always use the
 * strict spelling rule, since a note spelled outside the key signature
 * would print with a stray accidental against it.
 *
 * OSMD skips transposing at 0 semitones, so a pure respelling (C# → Db)
 * leaves the score as written. */
export class KeyAwareTransposeCalculator implements ITransposeCalculator {
  /** The key picked on the chips; the key signature follows its spelling
   * whenever the transposed key has the same pitch. */
  targetKey: string | null = null;
  private fallback: ITransposeCalculator;

  constructor(private osmd: Osmd) {
    this.fallback = new osmd.TransposeCalculator();
  }

  private transposedFifths(originalFifths: number, halftones: number): number {
    const pitch = mod(originalFifths * 7 + halftones, 12);
    const picked = this.targetKey ? keyFifths(this.targetKey) : null;
    if (picked !== null && mod(picked * 7, 12) === pitch) return picked;
    return DEFAULT_FIFTHS[pitch];
  }

  transposeKey(keyInstruction: KeyInstruction, transpose: number): void {
    keyInstruction.Key = transpose % 12 === 0 ? keyInstruction.keyTypeOriginal : this.transposedFifths(keyInstruction.keyTypeOriginal, transpose);
    keyInstruction.isTransposedBy = transpose;
  }

  transposePitch(pitch: Pitch, currentKeyInstruction: KeyInstruction, halftones: number): Pitch {
    if (halftones === 0) return pitch;
    const { Pitch: PitchClass } = this.osmd;
    const accidental = PitchClass.HalfTonesFromAccidental(pitch.Accidental);
    const letter = NATURALS.indexOf(pitch.FundamentalNote);
    const originalFifths = currentKeyInstruction?.keyTypeOriginal;
    if (!Number.isInteger(accidental) || letter < 0 || typeof originalFifths !== "number") {
      return this.fallback.transposePitch(pitch, currentKeyInstruction, halftones);
    }
    const fromKey = keyFromFifths(originalFifths);
    const toKey = keyFromFifths(this.transposedFifths(originalFifths, halftones));
    const steps = letterSteps(parseNote(fromKey)!, parseNote(toKey)!);
    // Letter steps are 0–6 upward; pick the octave that goes the same way
    // as the pitch (C → Cb down a semitone is 0 steps, up eleven is 7).
    const target = (halftones * 7) / 12;
    const signed = [steps - 7, steps, steps + 7].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const abs = pitch.Octave * 12 + pitch.FundamentalNote + accidental + halftones;
    const out = spellInKey(mod(letter + signed, 7), mod(abs, 12), toKey, true);
    const octave = (abs - NATURALS[out.letter] - out.accidental) / 12;
    return new PitchClass(NATURALS[out.letter], octave, PitchClass.AccidentalFromHalfTones(out.accidental));
  }
}
