import { defineConfig } from "vitest/config";

// `dist` holds compiled copies of the same specs; running both would double-report
// and resurrect deleted suites after a stale build.
export default defineConfig({ test: { include: ["src/**/*.test.ts"], exclude: ["dist/**", "node_modules/**"] } });
