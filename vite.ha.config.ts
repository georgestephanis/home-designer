// The Home Assistant build: src/ha/index.tsx as one self-contained module, written into the
// integration's frontend folder (served by custom_components/home_designer).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "custom_components/home_designer/frontend",
    emptyOutDir: false,
    copyPublicDir: false,
    modulePreload: false,
    rollupOptions: {
      input: "src/ha/index.tsx",
      preserveEntrySignatures: false,
      output: { format: "es", entryFileNames: "home-designer.js", inlineDynamicImports: true },
    },
  },
});
