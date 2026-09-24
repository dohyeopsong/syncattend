import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server on :5173; proxy /api to the FastAPI backend (:8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
