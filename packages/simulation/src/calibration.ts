import { z } from "zod";

import { canonicalHash } from "./canonical.js";

export interface HumanObservation {
  readonly observationId: string;
  readonly anonymizedParticipantId: string;
  readonly rulesVersion: string;
  readonly checkpointId: string;
  readonly selectedAction?: string;
  readonly outcome?: "win" | "loss" | "other";
  readonly missingness: "none" | "action-not-recorded" | "outcome-not-recorded";
  readonly skillUncertainty: "unknown" | "low" | "medium" | "high";
  readonly selectionBias: readonly string[];
  readonly consent: "consented" | "synthetic-fixture";
}

export const humanObservationSchema = z
  .object({
    observationId: z.string().min(1),
    anonymizedParticipantId: z.string().min(1),
    rulesVersion: z.string().min(1),
    checkpointId: z.string().min(1),
    selectedAction: z.string().min(1).optional(),
    outcome: z.enum(["win", "loss", "other"]).optional(),
    missingness: z.enum(["none", "action-not-recorded", "outcome-not-recorded"]),
    skillUncertainty: z.enum(["unknown", "low", "medium", "high"]),
    selectionBias: z.array(z.string().min(1)),
    consent: z.enum(["consented", "synthetic-fixture"]),
  })
  .strict();

export interface HumanObservationDataset {
  readonly schemaVersion: "simulation-human-observations:v1";
  readonly datasetId: string;
  readonly datasetKind: "calibration" | "evaluation";
  readonly rulesVersion: string;
  readonly observations: readonly HumanObservation[];
  readonly datasetHash: string;
}

export const humanObservationDatasetSchema = z
  .object({
    schemaVersion: z.literal("simulation-human-observations:v1"),
    datasetId: z.string().min(1),
    datasetKind: z.enum(["calibration", "evaluation"]),
    rulesVersion: z.string().min(1),
    observations: z.array(humanObservationSchema),
    datasetHash: z.string().min(1),
  })
  .strict();

export const createHumanObservationDataset = (
  datasetId: string,
  datasetKind: HumanObservationDataset["datasetKind"],
  rulesVersion: string,
  observations: readonly HumanObservation[],
): HumanObservationDataset => {
  const ordered = [...observations].sort((left, right) =>
    left.observationId.localeCompare(right.observationId),
  );
  const dataset = {
    schemaVersion: "simulation-human-observations:v1" as const,
    datasetId,
    datasetKind,
    rulesVersion,
    observations: Object.freeze(ordered),
    datasetHash: canonicalHash({ datasetId, datasetKind, rulesVersion, observations: ordered }),
  } satisfies HumanObservationDataset;
  return Object.freeze(dataset);
};

export interface SimulationDistributionComparison {
  readonly datasetHash: string;
  readonly policyIdentity: string;
  readonly sampleCount: number;
  readonly categories: readonly string[];
  readonly humanRates: Readonly<Record<string, number>>;
  readonly policyRates: Readonly<Record<string, number>>;
  readonly totalVariationDistance: number;
  readonly externalEvidence: "present" | "absent";
}

export const compareHumanPolicyDistributions = (
  dataset: HumanObservationDataset,
  policyIdentity: string,
  policySelections: readonly string[],
): SimulationDistributionComparison => {
  const humanCounts = new Map<string, number>();
  const policyCounts = new Map<string, number>();
  for (const observation of dataset.observations) {
    if (observation.selectedAction !== undefined) {
      humanCounts.set(
        observation.selectedAction,
        (humanCounts.get(observation.selectedAction) ?? 0) + 1,
      );
    }
  }
  for (const selection of policySelections)
    policyCounts.set(selection, (policyCounts.get(selection) ?? 0) + 1);
  const categories = [...new Set([...humanCounts.keys(), ...policyCounts.keys()])].sort((a, b) =>
    a.localeCompare(b),
  );
  const humanTotal = [...humanCounts.values()].reduce((total, count) => total + count, 0);
  const policyTotal = policySelections.length;
  const humanRates = Object.fromEntries(
    categories.map((category) => [
      category,
      humanTotal ? (humanCounts.get(category) ?? 0) / humanTotal : 0,
    ]),
  );
  const policyRates = Object.fromEntries(
    categories.map((category) => [
      category,
      policyTotal ? (policyCounts.get(category) ?? 0) / policyTotal : 0,
    ]),
  );
  return {
    datasetHash: dataset.datasetHash,
    policyIdentity,
    sampleCount: humanTotal,
    categories,
    humanRates,
    policyRates,
    totalVariationDistance:
      categories.reduce(
        (total, category) => total + Math.abs(humanRates[category] - policyRates[category]),
        0,
      ) / 2,
    externalEvidence: dataset.observations.some(
      (observation) => observation.consent === "consented",
    )
      ? "present"
      : "absent",
  };
};
