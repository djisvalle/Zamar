import { randomUUID } from "node:crypto";
import type { OmrJob, OmrJobStatus, OmrResult } from "./types";

/** In-memory job store — fine for a single-process scaffold; a real
 * deployment would back this with a queue/database so jobs survive restarts
 * and can be picked up by multiple workers. */

const jobs = new Map<string, OmrJob>();

export function createJob(stepLabels: string[]): OmrJob {
  const job: OmrJob = { id: randomUUID(), status: "queued", step: 0, stepLabels };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): OmrJob | undefined {
  return jobs.get(id);
}

export function setStep(id: string, step: number): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, status: "processing" as OmrJobStatus, step });
}

export function setDone(id: string, result: OmrResult): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, status: "done", step: job.stepLabels.length, result });
}

export function setError(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.set(id, { ...job, status: "error", error });
}
