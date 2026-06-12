import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "dashboard/src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
