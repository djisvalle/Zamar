import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // .playwright-mcp/ holds snapshots dropped by browser-automation tooling;
    // without this, every snapshot write triggers a full-page reload that
    // wipes in-memory app state mid-session.
    watch: { ignored: ["**/.playwright-mcp/**"] },
  },
});
