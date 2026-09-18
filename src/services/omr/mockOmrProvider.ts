import type { OmrJob, OmrProvider, OmrSourceKind, OmrSubmitOptions } from "./types";

/** Demo/offline fallback used whenever no real OMR backend is configured
 * (see index.ts) — carries forward the mockup's original timer-driven
 * simulation so Import still works standalone, but is honest that its
 * output is canned, not derived from the uploaded file. */

const STEP_LABELS: Record<OmrSourceKind, string[]> = {
  pdf: ["Reading pages…", "Detecting chords…", "Finishing up…"],
  photo: ["Reading photo…", "Detecting chords…", "Finishing up…"],
  musicxml: ["Reading score…", "Detecting chords…", "Building sheet view…"],
};

const MOCK_CHORDPRO = `{key: G}

[G]Verse line goes [D]here, edit as [Em]needed to [C]match
[G]Second line of the [D]imported [Em]chart [C]appears`;

const STEP_INTERVAL_MS = 500;

const jobs = new Map<string, OmrJob>();

export function createMockOmrProvider(): OmrProvider {
  return {
    async submit(_file, kind, options?: OmrSubmitOptions) {
      const id = `mock-omr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stepLabels = STEP_LABELS[kind];
      const job: OmrJob = { id, status: "queued", step: 0, stepLabels };
      jobs.set(id, job);

      let step = 0;
      const timer: ReturnType<typeof setInterval> = setInterval(() => {
        step++;
        const current = jobs.get(id);
        if (!current) {
          clearInterval(timer);
          return;
        }
        if (options?.simulateFailure && step >= 2) {
          clearInterval(timer);
          jobs.set(id, {
            ...current,
            status: "error",
            step,
            error:
              kind === "musicxml"
                ? "The score uses notation this app doesn't recognize yet."
                : kind === "pdf"
                ? "The scan was too blurry to detect chords and lyrics reliably."
                : "The photo was too dark or angled to read clearly.",
          });
          return;
        }
        if (step >= stepLabels.length) {
          clearInterval(timer);
          jobs.set(id, {
            ...current,
            status: "done",
            step,
            result: { chordpro: MOCK_CHORDPRO, chartFormat: "chordpro", detectedKey: "G" },
          });
          return;
        }
        jobs.set(id, { ...current, status: "processing", step });
      }, STEP_INTERVAL_MS);

      return id;
    },

    async getJob(jobId: string) {
      const job = jobs.get(jobId);
      if (!job) throw new Error(`Unknown OMR job: ${jobId}`);
      return job;
    },
  };
}
