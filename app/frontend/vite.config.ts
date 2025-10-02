import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { Agent } from "node:http";


const API_TARGET =
  process.env.VITE_API_PROXY ??
  "http://127.0.0.1:8000"; // важно: 127.0.0.1, а не localhost

// Принудительно IPv4-агент (если вдруг окружение всё равно лезет в ::1)
const ipv4Agent = new Agent({ family: 4 });

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY ?? "http://localhost:8000",
        changeOrigin: true,
        agent: ipv4Agent,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
