import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["electron/lib/**/*.test.ts", "src/**/*.test.ts", "tests/**/*.test.ts"], environment: "node" },
});
