import { describe, expect, it } from "vitest";

import { planFocusedCheck } from "./check-focused.js";

describe("focused check planning", () => {
  it("expands combat changes to their package, data, and capability consumers", () => {
    const plan = planFocusedCheck(["packages/combat-engine/src/progress-fight.ts"]);

    expect(plan.fullGate).toBeUndefined();
    expect(plan.typecheckWorkspaces).toEqual([
      "@dragonball-resurgence/combat-engine",
      "@dragonball-resurgence/game-config",
      "@dragonball-resurgence/game-data",
    ]);
    expect(plan.testPaths).toEqual([
      "packages/combat-engine/src",
      "packages/game-data/src",
      "scripts/combat-capability-matrix.test.ts",
    ]);
    expect(plan.validatorScripts).toEqual([
      "validate:combat-engine-boundaries",
      "validate:game-data",
    ]);
  });

  it("includes combat consumers when game data changes", () => {
    const plan = planFocusedCheck(["packages/game-data/src/moves/kiihakai.ts"]);

    expect(plan.typecheckWorkspaces).toEqual([
      "@dragonball-resurgence/combat-engine",
      "@dragonball-resurgence/game-data",
    ]);
    expect(plan.testPaths).toContain("packages/combat-engine/src");
    expect(plan.testPaths).toContain("packages/game-data/src");
    expect(plan.validatorScripts).toEqual(["validate:game-data"]);
  });

  it("uses a full gate for infrastructure changes", () => {
    expect(planFocusedCheck(["package-lock.json"]).fullGate).toBe("quality");
    expect(planFocusedCheck(["tsconfig.base.json"]).fullGate).toBe("check");
    expect(planFocusedCheck(["package.json"]).fullGate).toBeUndefined();
  });

  it("ignores documentation-only changes", () => {
    expect(planFocusedCheck(["docs/architecture/combat-engine-progress.md"])).toEqual({
      formatFiles: [],
      lintFiles: [],
      typecheckWorkspaces: [],
      testPaths: [],
      validatorScripts: [],
      notes: [],
    });
  });
});
