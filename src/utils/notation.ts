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

// Grouped by kind, in the order the popover pages through them. Ids are
// stored on placed marks, so an existing id must never change. Codepoints
// are from the SMuFL spec's glyphnames.json (w3c/smufl).
export const NOTATION_SYMBOLS: NotationSymbol[] = [
  // Dynamics
  { id: "ppp", label: "Pianississimo", smufl: "\uE52A", text: "ppp" }, // dynamicPPP
  { id: "pp", label: "Pianissimo", smufl: "\uE52B", text: "pp" }, // dynamicPP
  { id: "p", label: "Piano", smufl: "\uE520", text: "p" }, // dynamicPiano
  { id: "mp", label: "Mezzo-piano", smufl: "\uE52C", text: "mp" }, // dynamicMP
  { id: "mf", label: "Mezzo-forte", smufl: "\uE52D", text: "mf" }, // dynamicMF
  { id: "f", label: "Forte", smufl: "\uE522", text: "f" }, // dynamicForte
  { id: "ff", label: "Fortissimo", smufl: "\uE52F", text: "ff" }, // dynamicFF
  { id: "fff", label: "Fortississimo", smufl: "\uE530", text: "fff" }, // dynamicFFF
  { id: "fp", label: "Fortepiano", smufl: "\uE534", text: "fp" }, // dynamicFortePiano
  { id: "sf", label: "Sforzando (sf)", smufl: "\uE536", text: "sf" }, // dynamicSforzando1
  { id: "sfz", label: "Sforzato (sfz)", smufl: "\uE539", text: "sfz" }, // dynamicSforzato
  { id: "rfz", label: "Rinforzando", smufl: "\uE53D", text: "rfz" }, // dynamicRinforzando2
  // Articulation
  { id: "accent", label: "Accent", smufl: "\uE4A0", text: ">" }, // articAccentAbove
  { id: "staccato", label: "Staccato", smufl: "\uE4A2", text: "•" }, // articStaccatoAbove
  { id: "tenuto", label: "Tenuto", smufl: "\uE4A4", text: "–" }, // articTenutoAbove
  { id: "marcato", label: "Marcato", smufl: "\uE4AC", text: "^" }, // articMarcatoAbove
  { id: "staccatissimo", label: "Staccatissimo", smufl: "\uE4A6", text: "▾" }, // articStaccatissimoAbove
  { id: "accent-staccato", label: "Accent-staccato", smufl: "\uE4B0", text: ">•" }, // articAccentStaccatoAbove
  { id: "loure", label: "Louré", smufl: "\uE4B2", text: "–•" }, // articTenutoStaccatoAbove
  // Fermatas and breaths
  { id: "fermata", label: "Fermata", smufl: "\uE4C0", text: "𝄐" }, // fermataAbove
  { id: "fermata-short", label: "Short fermata", smufl: "\uE4C4", text: "𝄐" }, // fermataShortAbove
  { id: "breath", label: "Breath mark", smufl: "\uE4CE", text: "," }, // breathMarkComma
  { id: "caesura", label: "Caesura", smufl: "\uE4D1", text: "//" }, // caesura
  // Accidentals
  { id: "flat", label: "Flat", smufl: "\uE260", text: "♭" }, // accidentalFlat
  { id: "sharp", label: "Sharp", smufl: "\uE262", text: "♯" }, // accidentalSharp
  { id: "natural", label: "Natural", smufl: "\uE261", text: "♮" }, // accidentalNatural
  { id: "double-sharp", label: "Double sharp", smufl: "\uE263", text: "𝄪" }, // accidentalDoubleSharp
  { id: "double-flat", label: "Double flat", smufl: "\uE264", text: "𝄫" }, // accidentalDoubleFlat
  // Ornaments
  { id: "trill", label: "Trill", smufl: "\uE566", text: "tr" }, // ornamentTrill
  { id: "mordent", label: "Mordent", smufl: "\uE56D", text: "mord." }, // ornamentMordent
  { id: "upper-mordent", label: "Upper mordent", smufl: "\uE56C", text: "tr~" }, // ornamentShortTrill
  { id: "turn", label: "Turn", smufl: "\uE567", text: "∽" }, // ornamentTurn
  { id: "inverted-turn", label: "Inverted turn", smufl: "\uE568", text: "∽" }, // ornamentTurnInverted
  // Repeats and navigation
  { id: "segno", label: "Segno", smufl: "\uE047", text: "𝄋" }, // segno
  { id: "coda", label: "Coda", smufl: "\uE048", text: "𝄌" }, // coda
  { id: "repeat-start", label: "Start repeat", smufl: "\uE040", text: "𝄆" }, // repeatLeft
  { id: "repeat-end", label: "End repeat", smufl: "\uE041", text: "𝄇" }, // repeatRight
  { id: "repeat-bar", label: "Repeat last bar", smufl: "\uE500", text: "𝄎" }, // repeat1Bar
  { id: "da-capo", label: "Da capo", smufl: "\uE046", text: "D.C." }, // daCapo
  { id: "dal-segno", label: "Dal segno", smufl: "\uE045", text: "D.S." }, // dalSegno
  // Clefs and time
  { id: "treble-clef", label: "Treble clef", smufl: "\uE050", text: "𝄞" }, // gClef
  { id: "bass-clef", label: "Bass clef", smufl: "\uE062", text: "𝄢" }, // fClef
  { id: "alto-clef", label: "Alto clef", smufl: "\uE05C", text: "𝄡" }, // cClef
  { id: "common-time", label: "Common time", smufl: "\uE08A", text: "𝄴" }, // timeSigCommon
  { id: "cut-time", label: "Cut time", smufl: "\uE08B", text: "𝄵" }, // timeSigCutCommon
  // Notes and rests
  { id: "whole-note", label: "Whole note", smufl: "\uE1D2", text: "𝅝" }, // noteWhole
  { id: "half-note", label: "Half note", smufl: "\uE1D3", text: "𝅗𝅥" }, // noteHalfUp
  { id: "quarter-note", label: "Quarter note", smufl: "\uE1D5", text: "𝅘𝅥" }, // noteQuarterUp
  { id: "eighth-note", label: "Eighth note", smufl: "\uE1D7", text: "𝅘𝅥𝅮" }, // note8thUp
  { id: "whole-rest", label: "Whole rest", smufl: "\uE4E3", text: "𝄻" }, // restWhole
  { id: "half-rest", label: "Half rest", smufl: "\uE4E4", text: "𝄼" }, // restHalf
  { id: "quarter-rest", label: "Quarter rest", smufl: "\uE4E5", text: "𝄽" }, // restQuarter
  { id: "eighth-rest", label: "Eighth rest", smufl: "\uE4E6", text: "𝄾" }, // rest8th
  // Strings, pedal and octave lines
  { id: "up-bow", label: "Up bow", smufl: "\uE612", text: "V" }, // stringsUpBow
  { id: "down-bow", label: "Down bow", smufl: "\uE610", text: "⊓" }, // stringsDownBow
  { id: "pedal", label: "Pedal down", smufl: "\uE650", text: "Ped." }, // keyboardPedalPed
  { id: "pedal-up", label: "Pedal up", smufl: "\uE655", text: "*" }, // keyboardPedalUp
  { id: "8va", label: "Octave up (8va)", smufl: "\uE511", text: "8va" }, // ottavaAlta
  { id: "8vb", label: "Octave down (8vb)", smufl: "\uE51C", text: "8vb" }, // ottavaBassaVb
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
