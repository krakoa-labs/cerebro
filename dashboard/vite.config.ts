import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds the Dashboard app at cerebro's own publish time (ADR-0019). The
 * output lands in `dist/dashboard/`, shipped through the package's existing
 * `files: ["dist"]`; `base: "./"` keeps every asset reference relative so the
 * built artifact works opened from `file://` as well as hosted.
 */
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/dashboard",
    emptyOutDir: true,
  },
});
