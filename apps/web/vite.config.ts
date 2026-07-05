import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // 5173 is taken by another local project's dev server; see docker-compose.yml for the same reasoning on 5432/6379.
    port: 5174,
  },
});
