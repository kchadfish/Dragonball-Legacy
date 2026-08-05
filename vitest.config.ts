import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.{test,spec}.ts"],
    passWithNoTests: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Only executable domain logic is gated. Catalogs and generated game data are
      // validated structurally by validate:game-data rather than through coverage.
      include: ["packages/combat-engine/src/**/*.ts", "packages/game-data/src/validation.ts"],
      exclude: ["**/index.ts", "**/testing/**"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 75,
      },
    },
  },
});
