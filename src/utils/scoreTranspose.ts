import type { ITransposeCalculator, KeyInstruction, Pitch } from "opensheetmusicdisplay";
import { keyFifths, keyFromFifths, letterSteps, parseNote, spellInKey } from "./keys";

type Osmd = typeof import("opensheetmusicdisplay");

const NATURALS = [0, 2, 4, 5, 7, 9, 11];
/** OSMD's own choice of key signature (in fifths) for each tonic pitch:
 * Db, F# and B for the three enharmonic pairs. */
const DEFAULT_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** What `apply` hands OSMD for a pure respelling: any shift but 0 gets
 * OSMD to call the calculator, and 12 can't be mistaken for a real one,
 * since a key change moves −11…+11. */
const RESPELL_OCTAVE = 12;

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
 * OSMD skips transposing whenever the sheet's transpose is 0, so a pure
 * respelling (C# → Db) would leave the score as written. `apply` works
 * around that: it hands OSMD a full octave instead, and the calculator takes
 * the octave back out, so only the spelling changes. */
export class KeyAwareTransposeCalculator implements ITransposeCalculator {
  /** The key picked on the chips; the key signature follows its spelling
   * whenever the transposed key has the same pitch. */
  targetKey: string | null = null;
  /** True while the sheet carries RESPELL_OCTAVE in place of a 0 shift. */
  private respelling = false;
  private fallback: ITransposeCalculator;

  constructor(private osmd: Osmd) {
    this.fallback = new osmd.TransposeCalculator();
  }

  /** Sets the score's transpose and the picked key together. Call it in
   * place of setting `Sheet.Transpose` directly. */
  apply(sheet: { Transpose: number }, transpose: number, targetKey: string | null): void {
    this.targetKey = targetKey;
    this.respelling = transpose === 0 && targetKey !== null;
    sheet.Transpose = this.respelling ? RESPELL_OCTAVE : transpose;
  }

  private shift(halftones: number): number {
    return this.respelling && halftones === RESPELL_OCTAVE ? 0 : halftones;
  }

  /** With no pitch change, the key signature only changes to take the
   * picked spelling of the same key; any other key stays as written. */
  private transposedFifths(originalFifths: number, halftones: number): number {
    const pitch = mod(originalFifths * 7 + halftones, 12);
    const picked = this.targetKey ? keyFifths(this.targetKey) : null;
    if (picked !== null && mod(picked * 7, 12) === pitch) return picked;
    return halftones % 12 === 0 ? originalFifths : DEFAULT_FIFTHS[pitch];
  }

  transposeKey(keyInstruction: KeyInstruction, transpose: number): void {
    keyInstruction.Key = this.transposedFifths(keyInstruction.keyTypeOriginal, this.shift(transpose));
    // OSMD skips re-keying a score's opening key signature when the shift
    // matches `isTransposedBy`, but the picked spelling can change while the
    // shift stays the same (C# ↔ Db from B is +2 either way). Never marking
    // it transposed makes OSMD ask again on every render.
    keyInstruction.isTransposedBy = NaN;
  }

  transposePitch(pitch: Pitch, currentKeyInstruction: KeyInstruction, transpose: number): Pitch {
    const halftones = this.shift(transpose);
    if (halftones === 0 && !this.respelling) return pitch;
    const { Pitch: PitchClass } = this.osmd;
    const accidental = PitchClass.HalfTonesFromAccidental(pitch.Accidental);
    const letter = NATURALS.indexOf(pitch.FundamentalNote);
    const originalFifths = currentKeyInstruction?.keyTypeOriginal;
    if (!Number.isInteger(accidental) || letter < 0 || typeof originalFifths !== "number") {
      return this.fallback.transposePitch(pitch, currentKeyInstruction, halftones);
    }
    const fromKey = keyFromFifths(originalFifths);
    const toKey = keyFromFifths(this.transposedFifths(originalFifths, halftones));
    if (halftones === 0 && toKey === fromKey) return pitch;
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
