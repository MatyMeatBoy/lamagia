import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  base: "/lamagia/",
  server: { proxy: { "/api": "http://localhost:8787" } },
  resolve: { alias: { "@prossh/rules": fileURLToPath(new URL("../../packages/rules/src/index.ts", import.meta.url)) } }
});
