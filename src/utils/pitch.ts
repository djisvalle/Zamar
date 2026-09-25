/** Monophonic pitch detection for the Tuner, using the McLeod Pitch Method
 * (normalized square difference function + "key maxima" peak picking).
 * It's the same family of autocorrelation detectors most instrument tuners
 * use: accurate to well under a cent on a sustained string, cheap enough to
 * run on every animation frame in plain JS, and far less prone to octave
 * errors than raw autocorrelation because the peak threshold is relative to
 * the strongest peak rather than absolute. */

export interface PitchReading {
  freq: number;
  /** 0..1 — the NSDF value at the chosen peak. Near 1 for a clean periodic
   * tone, lower for noise, voices and chords. */
  clarity: number;
}

/** Signal below this RMS (on a -1..1 float buffer) is treated as silence, so
 * room noise doesn't produce jittery readings between notes. */
const SILENCE_RMS = 0.01;
/** Fraction of the strongest NSDF peak an earlier peak must reach to be
 * picked — MPM's "k" constant. Lower values favor the first (fundamental)
 * period over stronger harmonics. */
const PEAK_THRESHOLD = 0.9;
const MIN_CLARITY = 0.8;

export function detectPitch(input: Float32Array, sampleRate: number, minFreq = 30, maxFreq = 1500): PitchReading | null {
  // The detector is O(n × lag), so at 44.1/48 kHz the buffer is first halved
  // by averaging sample pairs (a crude low-pass, plenty for a ≤1.5 kHz
  // fundamental). That's ~4× less work per pass on a phone.
  let buf = input;
  if (sampleRate > 30000) {
    buf = new Float32Array(input.length >> 1);
    for (let i = 0; i < buf.length; i++) buf[i] = 0.5 * (input[2 * i] + input[2 * i + 1]);
    sampleRate /= 2;
  }
  const n = buf.length;
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i];
  if (Math.sqrt(sumSq / n) < SILENCE_RMS) return null;

  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxLag = Math.min(Math.floor(n / 2), Math.ceil(sampleRate / minFreq));
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0;
    let m = 0;
    const end = n - tau;
    for (let i = 0; i < end; i++) {
      const a = buf[i];
      const b = buf[i + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // Key maxima: the highest point of each positive lobe, after the first
  // negative-going zero crossing (lag 0 is always a trivial maximum of 1).
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++;
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau < maxLag && nsdf[tau] > 0) {
      if (tau >= minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return null;

  let highest = 0;
  for (const p of peaks) highest = Math.max(highest, nsdf[p]);
  const chosen = peaks.find((p) => nsdf[p] >= PEAK_THRESHOLD * highest)!;

  // Parabolic interpolation around the chosen lag for sub-sample accuracy.
  const y0 = nsdf[chosen - 1];
  const y1 = nsdf[chosen];
  const y2 = nsdf[chosen + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const period = chosen + shift;
  const clarity = y1 - 0.25 * (y0 - y2) * shift;
  if (clarity < MIN_CLARITY || period <= 0) return null;
  return { freq: sampleRate / period, clarity };
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Cents from `ref` to `freq` (positive = sharp). */
export function centsBetween(freq: number, ref: number): number {
  return 1200 * Math.log2(freq / ref);
}

/** The equal-tempered note nearest to `freq` (A4 = 440 Hz), with its exact
 * frequency and how far `freq` is from it. */
export function nearestNote(freq: number, a4 = 440): { name: string; octave: number; freq: number; cents: number } {
  const midi = Math.round(69 + 12 * Math.log2(freq / a4));
  const noteFreq = a4 * Math.pow(2, (midi - 69) / 12);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    freq: noteFreq,
    cents: centsBetween(freq, noteFreq),
  };
}
