import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Tesseract builds the model's URL from a folder plus the fixed name
        // "eng.traineddata.gz", so that one asset can't carry a content hash.
        assetFileNames: (info) =>
          info.names?.some((n) => n.endsWith(".traineddata.gz")) ? "assets/ocr/[name][extname]" : "assets/[name]-[hash][extname]",
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
