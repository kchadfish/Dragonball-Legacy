import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAiCapabilityMatrix, renderAiCapabilityMatrix } from "./ai-capability-matrix.js";
import { validateAiCapabilityClosure } from "./validate-ai-capability-closure.js";

describe("AI capability matrix", () => {
  it("matches the committed generated report", () => {
    const reportPath = resolve(process.cwd(), "docs/architecture/ai-engine-capability-matrix.md");
    expect(readFileSync(reportPath, "utf8")).toBe(renderAiCapabilityMatrix());
  });

  it("accounts for legal, pending, response, exclusion, and gap surfaces", () => {
    const matrix = createAiCapabilityMatrix();
    expect(matrix.legalSurfaces).toHaveLength(9);
    expect(matrix.pendingSurfaces).toHaveLength(7);
    expect(matrix.responseShapes).toHaveLength(4);
    expect(matrix.immediateEvaluators).toHaveLength(9);
    expect(matrix.contextualEvaluators).toHaveLength(9);
    expect(matrix.exclusions).toHaveLength(14);
    expect(matrix.capabilityGaps.find((gap) => gap.roadmapId === "AI-200")).toMatchObject({
      status: "complete",
    });
    expect(validateAiCapabilityClosure(matrix)).toEqual([]);
  });

  it("rejects missing proof, duplicates, and invalid exclusions", () => {
    const matrix = createAiCapabilityMatrix();
    const malformed = {
      ...matrix,
      legalSurfaces: [
        {
          ...matrix.legalSurfaces[0],
          id: matrix.legalSurfaces[1].id,
          focusedProof: "",
          classification: "unsupported" as const,
          prerequisites: [],
          proofTarget: undefined,
        },
      ],
      exclusions: [{ ...matrix.exclusions[0], id: "combat-scope:missing" }],
    };
    const issues = validateAiCapabilityClosure(malformed);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must be registered exactly once"),
        expect.stringContaining("unsupported entry needs prerequisites"),
        expect.stringContaining("unsupported entry needs a proof target"),
        expect.stringContaining("Invalid approved exclusion"),
      ]),
    );
  });

  it("renders exclusions and deferred strategic gaps without claiming support", () => {
    const rendered = renderAiCapabilityMatrix();
    expect(rendered).toContain("ai-combat-scope:v1");
    expect(rendered).toContain("combat-scope:spaceship-combat");
    expect(rendered).toContain("AI-200");
    expect(rendered).toContain("AI-600 through AI-750");
    expect(rendered).toContain("AI-300 through AI-340");
    expect(rendered).toContain("Contextual evaluators");
    expect(rendered).toContain("complete");
  });
});
