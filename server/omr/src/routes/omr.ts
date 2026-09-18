import { Router } from "express";
import multer from "multer";
import { createJob, getJob, setDone, setError, setStep } from "../jobStore";
import { convertToChordPro, STEP_LABELS } from "../pipeline";
import type { OmrSourceKind } from "../types";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const SIMULATED_ERROR: Record<OmrSourceKind, string> = {
  musicxml: "The score uses notation this app doesn't recognize yet.",
  pdf: "The scan was too blurry to detect chords and lyrics reliably.",
  photo: "The photo was too dark or angled to read clearly.",
};

const STEP_DELAY_MS = 500;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const omrRouter = Router();

omrRouter.post("/jobs", upload.single("file"), (req, res) => {
  const kind = req.body.kind as OmrSourceKind;
  if (!req.file || !STEP_LABELS[kind]) {
    res.status(400).json({ error: "Expected a 'file' upload and a 'kind' of pdf|photo|musicxml." });
    return;
  }
  const simulateFailure = req.body.simulateFailure === "true";
  const job = createJob(STEP_LABELS[kind]);
  res.json({ jobId: job.id });

  const buffer = req.file.buffer;
  void (async () => {
    setStep(job.id, 1);
    await delay(STEP_DELAY_MS);
    if (simulateFailure) {
      setError(job.id, SIMULATED_ERROR[kind]);
      return;
    }
    setStep(job.id, 2);
    try {
      const result = await convertToChordPro(buffer, kind);
      await delay(STEP_DELAY_MS);
      setDone(job.id, result);
    } catch (err) {
      setError(job.id, err instanceof Error ? err.message : "Couldn't read this file.");
    }
  })();
});

omrRouter.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Unknown job id." });
    return;
  }
  res.json(job);
});

omrRouter.get("/jobs/:id/mxl", (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.result?.musicXml) {
    res.status(404).json({ error: "No MusicXML available for this job." });
    return;
  }
  res.setHeader("Content-Type", "application/vnd.recordare.musicxml+xml");
  res.setHeader("Content-Disposition", `attachment; filename="${job.id}.musicxml"`);
  res.send(job.result.musicXml);
});
