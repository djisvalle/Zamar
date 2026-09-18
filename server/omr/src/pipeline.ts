import { getOmrEngine } from "./engine/omrEngine";
import { parseMusicXml } from "./musicxml/parseMusicXml";
import { toChordPro } from "./musicxml/toChordPro";
import { resolveMusicXmlText } from "./musicxml/unzipMxl";
import type { OmrResult, OmrSourceKind } from "./types";

export const STEP_LABELS: Record<OmrSourceKind, string[]> = {
  pdf: ["Reading pages…", "Detecting chords…", "Finishing up…"],
  photo: ["Reading photo…", "Detecting chords…", "Finishing up…"],
  musicxml: ["Reading score…", "Detecting chords…", "Building sheet view…"],
};

/** Real (non-simulated) OMR pipeline: MusicXML is parsed and converted
 * directly; PDF/photo first go through an OmrEngine to become MusicXML (see
 * engine/omrEngine.ts for why that step isn't wired to a real model yet). */
export async function convertToChordPro(fileBuffer: Buffer, kind: OmrSourceKind): Promise<OmrResult> {
  const musicXml = kind === "musicxml" ? await resolveMusicXmlText(fileBuffer) : await getOmrEngine().recognize(fileBuffer, kind);

  const parsed = parseMusicXml(musicXml);
  const converted = toChordPro(parsed);

  return {
    chordpro: converted.text,
    chartFormat: "chordpro",
    detectedKey: converted.detectedKey,
    detectedTempo: parsed.tempoBpm,
    musicXml,
    warnings: converted.warnings,
  };
}
