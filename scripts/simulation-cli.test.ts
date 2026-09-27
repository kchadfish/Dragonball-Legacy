import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalJson,
  planSimulationStatisticsBackfill,
  simulationV4CatalogCheckpointSchema,
} from "@dragonball-resurgence/simulation";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
const run = (args: readonly string[]) => {
  try {
    execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/simulate-fights.ts", "analytics-backfill", ...args],
      { encoding: "utf8", stdio: "pipe" },
    );
    return "unexpected success";
  } catch (error) {
    return String((error as { stderr: string }).stderr);
  }
};

describe("analytics CLI resume identity", () => {
  it("rejects invalid full-catalog selectors before running fights", () => {
    expect(run(["--cell-scope", "unknown"])).toContain("--cell-scope must be sufficient or all");
    expect(
      run(["--role", "controlled", "--capabilities", "status-control", "--max-recipes", "invalid"]),
    ).toContain("--max-recipes");
  }, 60_000);

  it("does not silently reuse a different target from a saved checkpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "simulation-cli-"));
    directories.push(directory);
    const output = join(directory, "natural.json");
    const baselinePath = "artifacts/simulation/catalog-v4-natural-100.json.checkpoint.json";
    const baseline = simulationV4CatalogCheckpointSchema.parse(
      JSON.parse(readFileSync(baselinePath, "utf8")),
    );
    const checkpoint = planSimulationStatisticsBackfill(baseline, {
      cellScope: "all",
      targetPairs: 1,
    });
    const path = `${output}.checkpoint.json`;
    const content = canonicalJson(checkpoint);
    writeFileSync(path, content);
    expect(
      run([
        "--baseline",
        baselinePath,
        "--output",
        output,
        "--cell-scope",
        "all",
        "--target-pairs",
        "2",
        "--workers",
        "8",
      ]),
    ).toContain("Backfill resume baseline, target, role, or selected cells/recipes mismatch");
    expect(readFileSync(path, "utf8")).toBe(content);
  }, 60_000);
});
