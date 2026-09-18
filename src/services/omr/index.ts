import { createHttpOmrProvider } from "./httpOmrProvider";
import { createMockOmrProvider } from "./mockOmrProvider";
import type { OmrProvider } from "./types";

export type { OmrJob, OmrJobStatus, OmrProvider, OmrResult, OmrSourceKind, OmrSubmitOptions } from "./types";

let cached: OmrProvider | null = null;

/** Picks the real backend when VITE_OMR_API_URL is configured (see
 * server/omr/README.md for running one), otherwise falls back to the
 * in-memory simulation so Import still works standalone. */
export function getOmrProvider(): OmrProvider {
  if (!cached) {
    const baseUrl = import.meta.env.VITE_OMR_API_URL as string | undefined;
    cached = baseUrl ? createHttpOmrProvider(baseUrl) : createMockOmrProvider();
  }
  return cached;
}
