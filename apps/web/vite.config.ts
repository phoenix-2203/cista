import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the Cista server runs on :8787 and the chain's REST API is
// reached through the same /lcd-testnet relay Caddy provides in production
// (the REST API sends no CORS headers).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/lcd-testnet": {
        target: "https://api-testnet.qore.host",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/lcd-testnet/, ""),
      },
    },
  },
});
