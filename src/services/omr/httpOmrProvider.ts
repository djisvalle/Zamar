import type { OmrJob, OmrProvider, OmrSourceKind, OmrSubmitOptions } from "./types";

/** Real client for server/omr's job API. See that service's README for the
 * exact endpoint contract this mirrors. */

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:(.*);base64/)?.[1] ?? "application/octet-stream";
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export function createHttpOmrProvider(baseUrl: string): OmrProvider {
  const url = baseUrl.replace(/\/+$/, "");

  return {
    async submit(file, kind: OmrSourceKind, options?: OmrSubmitOptions) {
      const form = new FormData();
      form.append("file", dataUrlToBlob(file.dataUrl), file.name);
      form.append("kind", kind);
      if (options?.simulateFailure) form.append("simulateFailure", "true");

      const res = await fetch(`${url}/v1/omr/jobs`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`OMR submit failed: ${res.status} ${res.statusText}`);
      const body: { jobId: string } = await res.json();
      return body.jobId;
    },

    async getJob(jobId: string): Promise<OmrJob> {
      const res = await fetch(`${url}/v1/omr/jobs/${encodeURIComponent(jobId)}`);
      if (!res.ok) throw new Error(`OMR status check failed: ${res.status} ${res.statusText}`);
      return res.json();
    },
  };
}
