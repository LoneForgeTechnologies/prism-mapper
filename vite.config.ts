import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  // Keep CSS minification from introducing shorthands absent in older phone web views.
  build: { cssTarget: "chrome83" },
  server: {
    port: 5178,
    strictPort: true,
    watch: {
      ignored: ["**/public/previews/**", "**/artifacts/**", "**/release/**"],
    },
  },
});
