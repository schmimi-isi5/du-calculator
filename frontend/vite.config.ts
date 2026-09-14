import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// API base URL is empty by default (relative /api/* requests) so the same
// build works behind any reverse proxy. In dev, requests are proxied to the
// backend so no CORS configuration is needed locally.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
