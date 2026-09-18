/** Shared contract between the app and an OMR (optical music recognition)
 * backend — real image/PDF/MusicXML → ChordPro chord recognition. Mirrored
 * exactly by server/omr's HTTP job API so the two providers below
 * (mock vs. http) are interchangeable behind this one interface. */

export type OmrSourceKind = "pdf" | "photo" | "musicxml";

export type OmrJobStatus = "queued" | "processing" | "done" | "error";

export interface OmrResult {
  chordpro: string;
  chartFormat: "chordpro";
  detectedKey?: string;
  detectedTempo?: number;
  /** Present when the source was (or was converted to) MusicXML — kept
   * alongside the derived chart for a future real notation renderer. */
  musicXml?: string;
  warnings?: string[];
}

export interface OmrJob {
  id: string;
  status: OmrJobStatus;
  /** Index into `stepLabels` while queued/processing — drives the progress UI. */
  step: number;
  stepLabels: string[];
  result?: OmrResult;
  /** User-facing failure reason, set only when status is "error". */
  error?: string;
}

export interface OmrSubmitOptions {
  /** Mock provider only: forces the job into the error state partway through,
   * for exercising the failure UI without a real bad file. */
  simulateFailure?: boolean;
}

export interface OmrProvider {
  submit(file: { dataUrl: string; name: string }, kind: OmrSourceKind, options?: OmrSubmitOptions): Promise<string>;
  getJob(jobId: string): Promise<OmrJob>;
}
