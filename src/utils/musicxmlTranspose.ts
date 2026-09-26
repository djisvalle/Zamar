import { keyFifths, keyFromFifths, letterSteps, parseNote, spellInKey } from "./keys";

/** Re-keys a MusicXML file for export, the way `KeyAwareTransposeCalculator`
 * re-keys a score on screen: key signatures take the picked spelling, and
 * every note and chord symbol keeps its letter relative to the key (strict
 * spelling, so nothing prints with a stray accidental against the new
 * signature). Printed accidentals are recomputed per measure. */

const STEPS = "CDEFGAB";
const NATURALS = [0, 2, 4, 5, 7, 9, 11];
/** Key signature (in fifths) for each tonic pitch when the picked key doesn't
 * name it: Db, F# and B for the three enharmonic pairs, as OSMD does. */
const DEFAULT_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const ACCIDENTAL_NAMES: Record<number, string> = { [-2]: "flat-flat", [-1]: "flat", 0: "natural", 1: "sharp", 2: "double-sharp" };

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** The key signature a score written in `fifths` gets after `halftones`. With
 * no pitch change it only takes the picked spelling of the same key (Db →
 * C#); any other key stays as written. */
function transposedFifths(fifths: number, halftones: number, targetKey: string): number {
  const pitch = mod(fifths * 7 + halftones, 12);
  const picked = keyFifths(targetKey);
  if (picked !== null && mod(picked * 7, 12) === pitch) return picked;
  return halftones % 12 === 0 ? fifths : DEFAULT_FIFTHS[pitch];
}

interface Spelled {
  step: number; // index into STEPS
  alter: number;
  octave: number;
}

function transposeSpelled(p: Spelled, fifths: number, halftones: number, targetKey: string): Spelled {
  const fromKey = keyFromFifths(fifths);
  const toKey = keyFromFifths(transposedFifths(fifths, halftones, targetKey));
  if (halftones === 0 && fromKey === toKey) return p;
  const steps = letterSteps(parseNote(fromKey)!, parseNote(toKey)!);
  // Letter steps are 0–6 upward; take the octave that moves the same way as
  // the pitch (C → Cb down a semitone is 0 steps, up eleven is 7).
  const target = (halftones * 7) / 12;
  const signed = [steps - 7, steps, steps + 7].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  const abs = p.octave * 12 + NATURALS[p.step] + p.alter + halftones;
  const out = spellInKey(mod(p.step + signed, 7), mod(abs, 12), toKey, true);
  return { step: out.letter, alter: out.accidental, octave: (abs - NATURALS[out.letter] - out.accidental) / 12 };
}

/** Alteration each letter carries under a key signature. */
function signatureAlters(fifths: number): number[] {
  const alters = [0, 0, 0, 0, 0, 0, 0];
  const sharps = "FCGDAEB";
  for (let i = 0; i < Math.abs(fifths) && i < 7; i++) {
    const letter = fifths > 0 ? sharps[i] : sharps[6 - i];
    alters[STEPS.indexOf(letter)] = fifths > 0 ? 1 : -1;
  }
  return alters;
}

function child(el: Element, name: string): Element | null {
  for (const c of Array.from(el.children)) if (c.localName === name) return c;
  return null;
}

function setChildText(el: Element, name: string, value: string, before?: string) {
  let c = child(el, name);
  if (!c) {
    c = el.ownerDocument.createElementNS(el.namespaceURI, name);
    const ref = before ? child(el, before) : null;
    el.insertBefore(c, ref);
  }
  c.textContent = value;
}

function readSpelled(el: Element, stepTag: string, alterTag: string, octaveTag?: string): Spelled | null {
  const step = STEPS.indexOf((child(el, stepTag)?.textContent ?? "").trim().toUpperCase());
  if (step < 0) return null;
  const alter = Math.round(Number(child(el, alterTag)?.textContent ?? 0)) || 0;
  const octave = octaveTag ? Number(child(el, octaveTag)?.textContent ?? 4) : 4;
  return { step, alter, octave };
}

function writeSpelled(el: Element, p: Spelled, stepTag: string, alterTag: string, octaveTag?: string) {
  setChildText(el, stepTag, STEPS[p.step]);
  const alter = child(el, alterTag);
  if (p.alter === 0) alter?.remove();
  else setChildText(el, alterTag, String(p.alter), octaveTag);
  if (octaveTag) setChildText(el, octaveTag, String(p.octave));
}

/** Where MusicXML wants `<accidental>` inside `<note>`: after `<type>`/`<dot>`,
 * before `<time-modification>`, `<stem>` and the rest. */
const AFTER_ACCIDENTAL = ["time-modification", "stem", "notehead", "notehead-text", "staff", "beam", "notations", "lyric", "play", "listen"];

function setAccidental(note: Element, alter: number | null) {
  const existing = child(note, "accidental");
  if (alter === null) {
    existing?.remove();
    return;
  }
  const name = ACCIDENTAL_NAMES[alter];
  if (!name) return;
  if (existing) {
    existing.textContent = name;
    return;
  }
  const acc = note.ownerDocument.createElementNS(note.namespaceURI, "accidental");
  acc.textContent = name;
  const ref = Array.from(note.children).find((c) => AFTER_ACCIDENTAL.includes(c.localName)) ?? null;
  note.insertBefore(acc, ref);
}

/** Re-keys one score-partwise document in place. */
function transposeDocument(doc: Document, halftones: number, targetKey: string) {
  for (const part of Array.from(doc.getElementsByTagName("part"))) {
    let fifths = 0; // the written key in force
    let alters = signatureAlters(0); // the new key's signature
    for (const measure of Array.from(part.children).filter((m) => m.localName === "measure")) {
      // Accidentals carried through the measure, per staff+letter+octave.
      const carried = new Map<string, number>();
      for (const el of Array.from(measure.children)) {
        if (el.localName === "attributes") {
          for (const key of Array.from(el.children).filter((k) => k.localName === "key")) {
            const f = child(key, "fifths");
            if (!f) continue; // non-traditional key: left alone
            fifths = Number(f.textContent) || 0;
            const out = transposedFifths(fifths, halftones, targetKey);
            f.textContent = String(out);
            alters = signatureAlters(out);
          }
        } else if (el.localName === "note") {
          const pitch = child(el, "pitch");
          if (!pitch) continue;
          const written = readSpelled(pitch, "step", "alter", "octave");
          if (!written) continue;
          const p = transposeSpelled(written, fifths, halftones, targetKey);
          writeSpelled(pitch, p, "step", "alter", "octave");
          // A tied-over note never reprints its accidental.
          const tiedOver = Array.from(el.children).some((c) => c.localName === "tie" && c.getAttribute("type") === "stop");
          const slot = `${child(el, "staff")?.textContent ?? "1"}:${p.step}:${p.octave}`;
          const expected = carried.get(slot) ?? alters[p.step];
          setAccidental(el, p.alter !== expected && !tiedOver ? p.alter : null);
          carried.set(slot, p.alter);
        } else if (el.localName === "harmony") {
          for (const [wrap, stepTag, alterTag] of [
            ["root", "root-step", "root-alter"],
            ["bass", "bass-step", "bass-alter"],
          ] as const) {
            const node = child(el, wrap);
            const spelled = node && readSpelled(node, stepTag, alterTag);
            if (!node || !spelled) continue;
            const p = transposeSpelled(spelled, fifths, halftones, targetKey);
            writeSpelled(node, p, stepTag, alterTag);
          }
        }
      }
    }
  }
}

function transposeXmlText(xml: string, halftones: number, targetKey: string): string | null {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement.localName !== "score-partwise") return null;
  transposeDocument(doc, halftones, targetKey);
  let out = new XMLSerializer().serializeToString(doc);
  // XMLSerializer drops the XML declaration; MusicXML readers expect it.
  if (!out.startsWith("<?xml")) out = `<?xml version="1.0" encoding="UTF-8"?>\n` + out;
  return out;
}

/** Re-keys a `.musicxml`/`.xml` file or a compressed `.mxl` by `halftones`
 * towards `targetKey`. Null when the file isn't a score this can read
 * (score-timewise, or unparseable), so it can go out as written instead. */
export async function transposeMusicXmlFile(bytes: Uint8Array, halftones: number, targetKey: string): Promise<Uint8Array | null> {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    const out = transposeXmlText(new TextDecoder().decode(bytes), halftones, targetKey);
    return out === null ? null : new TextEncoder().encode(out);
  }
  const { unzipSync, zipSync } = await import("fflate");
  const files = unzipSync(bytes);
  const container = files["META-INF/container.xml"];
  const rootPath = container && new TextDecoder().decode(container).match(/full-path="([^"]+)"/)?.[1];
  const scorePath =
    rootPath && files[rootPath]
      ? rootPath
      : Object.keys(files).find((n) => !n.startsWith("META-INF/") && /\.(musicxml|xml)$/i.test(n));
  if (!scorePath) return null;
  const out = transposeXmlText(new TextDecoder().decode(files[scorePath]), halftones, targetKey);
  if (out === null) return null;
  files[scorePath] = new TextEncoder().encode(out);
  // The `mimetype` entry must come first and be stored uncompressed.
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  if (files.mimetype) entries.mimetype = [files.mimetype, { level: 0 }];
  for (const [name, data] of Object.entries(files)) if (name !== "mimetype") entries[name] = data;
  return zipSync(entries, { level: 6 });
}
