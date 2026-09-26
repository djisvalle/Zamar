import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Tesseract builds the model's URL from a folder plus the fixed name
        // "eng.traineddata", so that one asset can't carry a content hash. It
        // also drops the ".gz" suffix: Android's asset packaging doesn't
        // reliably serve a ".gz" file under its own name, which left OCR
        // stuck loading the model. The contents stay gzipped (Tesseract
        // detects that from the data; see chartImport.ts).
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".traineddata.gz")) ? "assets/ocr/eng.traineddata" : "assets/[name]-[hash][extname]",
      },
    },
  },
  server: {
    // .playwright-mcp/ holds snapshots dropped by browser-automation tooling;
    // without this, every snapshot write triggers a full-page reload that
    // wipes in-memory app state mid-session.
    watch: { ignored: ["**/.playwright-mcp/**"] },
  },
});
