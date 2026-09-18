/** Mirrors src/services/omr/types.ts on the frontend — keep the two in sync. */

export type OmrSourceKind = "pdf" | "photo" | "musicxml";

export type OmrJobStatus = "queued" | "processing" | "done" | "error";

export interface OmrResult {
  chordpro: string;
  chartFormat: "chordpro";
  detectedKey?: string;
  detectedTempo?: number;
  musicXml?: string;
  warnings?: string[];
}

export interface OmrJob {
  id: string;
  status: OmrJobStatus;
  step: number;
  stepLabels: string[];
  result?: OmrResult;
  error?: string;
}
