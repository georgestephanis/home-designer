import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built dist/ works from any folder or static host.
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: { environment: "jsdom" },
});
