/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of a running server/omr instance, e.g. http://localhost:8787.
   * Unset by default — Import falls back to the in-memory OMR simulation. */
  readonly VITE_OMR_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
