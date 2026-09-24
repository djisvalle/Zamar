/** A notation stamp the Annotate toolbar's Notation tool can place. Drawn
 * from the bundled Bravura font by its SMuFL codepoint — the Standard Music
 * Font Layout that MuseScore, Dorico, Finale and Newzik all engrave with — so
 * a "pp" stamp reads as an engraved dynamic, not the letters p-p typeset in
 * the UI font. `text` is a plain-text stand-in (stored on the mark as its
 * `text`, for anything that can't draw the glyph). */
export interface NotationSymbol {
  id: string;
  label: string;
  smufl: string;
  text: string;
}

// Curated starter set — the full multi-page notation library (ornaments,
// clefs, noteheads, rests, etc.) is a separate follow-up pass. Codepoints are
// from the SMuFL spec's glyphnames.json (w3c/smufl).
export const NOTATION_SYMBOLS: NotationSymbol[] = [
  { id: "pp", label: "Pianissimo", smufl: "", text: "pp" }, // dynamicPP
  { id: "p", label: "Piano", smufl: "", text: "p" }, // dynamicPiano
  { id: "mp", label: "Mezzo-piano", smufl: "", text: "mp" }, // dynamicMP
  { id: "mf", label: "Mezzo-forte", smufl: "", text: "mf" }, // dynamicMF
  { id: "f", label: "Forte", smufl: "", text: "f" }, // dynamicForte
  { id: "ff", label: "Fortissimo", smufl: "", text: "ff" }, // dynamicFF
  { id: "fp", label: "Fortepiano", smufl: "", text: "fp" }, // dynamicFortePiano
  { id: "sfz", label: "Sforzando", smufl: "", text: "sfz" }, // dynamicSforzato
  { id: "accent", label: "Accent", smufl: "", text: ">" }, // articAccentAbove
  { id: "staccato", label: "Staccato", smufl: "", text: "•" }, // articStaccatoAbove
  { id: "tenuto", label: "Tenuto", smufl: "", text: "–" }, // articTenutoAbove
  { id: "marcato", label: "Marcato", smufl: "", text: "^" }, // articMarcatoAbove
  { id: "fermata", label: "Fermata", smufl: "", text: "𝄐" }, // fermataAbove
  { id: "breath", label: "Breath mark", smufl: "", text: "," }, // breathMarkComma
  { id: "caesura", label: "Caesura", smufl: "", text: "//" }, // caesura
  { id: "flat", label: "Flat", smufl: "", text: "♭" }, // accidentalFlat
  { id: "sharp", label: "Sharp", smufl: "", text: "♯" }, // accidentalSharp
  { id: "natural", label: "Natural", smufl: "", text: "♮" }, // accidentalNatural
  { id: "trill", label: "Trill", smufl: "", text: "tr" }, // ornamentTrill
  { id: "up-bow", label: "Up bow", smufl: "", text: "V" }, // stringsUpBow
  { id: "down-bow", label: "Down bow", smufl: "", text: "⊓" }, // stringsDownBow
  { id: "segno", label: "Segno", smufl: "", text: "𝄋" }, // segno
  { id: "coda", label: "Coda", smufl: "", text: "𝄌" }, // coda
];

const BY_ID = new Map(NOTATION_SYMBOLS.map((s) => [s.id, s]));

/** Looks a stamp up by the `symbolId` stored on its mark. Marks placed before
 * stamps switched to SMuFL keep their old `symbolId`s (same ids), so they
 * render as real glyphs too, with no migration. */
export function notationSymbol(id: string | undefined): NotationSymbol | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** SMuFL glyphs are drawn on a 4-staff-space em, so a dynamic at font-size N
 * looks noticeably smaller than UI text at N — scaled up so a stamp's Size
 * reads about the same as a text note's. */
export const SMUFL_SIZE_SCALE = 1.8;
