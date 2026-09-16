import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5178,
    strictPort: true,
    watch: {
      ignored: ["**/public/previews/**", "**/artifacts/**", "**/release/**"],
    },
  },
});
