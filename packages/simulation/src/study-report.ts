import { z } from "zod";
import { studyHash } from "./study-design.js";
import { simulationMetricAggregateV2Schema } from "./statistics-v4.js";
const estimateSchema = z
  .object({
    estimate: z.number().nullable(),
    lower: z.number().nullable(),
    upper: z.number().nullable(),
    status: z.string(),
    sampledCells: z.number().int().nonnegative(),
  })
  .strict();
const confirmationSchema = z
  .object({
    blocks: z.number().int().nonnegative(),
    scheduledBlocks: z.number().int().nonnegative(),
    incompleteBlocks: z.number().int().nonnegative(),
    estimate: z.number().nullable(),
    lower: z.number(),
    upper: z.number(),
    method: z.string(),
    classification: z.enum([
      "insufficient",
      "inconclusive",
      "above-practical-threshold",
      "below-practical-threshold",
      "practically-equivalent",
    ]),
  })
  .strict();
export const simulationStudyReportSchema = z
  .object({
    schemaVersion: z.literal("simulation-study-report:v1"),
    manifestHash: z.string(),
    attempts: z.number().int().nonnegative(),
    budget: z.number().int().positive().max(8000),
    acceptedResults: z.number().int().nonnegative(),
    executionErrors: z.number().int().nonnegative(),
    incomplete: z.number().int().nonnegative(),
    effects: z.array(
      z
        .object({
          recipeId: z.string(),
          target: z.string(),
          cellId: z.string(),
          screening: z
            .object({
              blocks: z.number().int().nonnegative(),
              estimate: z.number().nullable(),
              label: z.literal("exploratory"),
            })
            .strict(),
          confirmation: confirmationSchema.nullable(),
        })
        .strict(),
    ),
    natural: z
      .object({
        winScore: estimateSchema,
        executionErrorRate: estimateSchema,
        incompleteRate: estimateSchema,
      })
      .strict(),
    metrics: z.record(z.string(), simulationMetricAggregateV2Schema),
    metricLineage: z.record(
      z.string(),
      z
        .object({
          definitionVersion: z.literal("simulation-study-metrics:v1"),
          observationIdentities: z.array(z.string()),
          fights: z.number().int().nonnegative(),
          seedBlocks: z.number().int().nonnegative(),
          eligibleOpportunities: z.number().int().nonnegative(),
          uncertainty: z.literal("not-estimated-for-event-aggregates"),
        })
        .strict(),
    ),
    sequences: z.record(
      z.string(),
      z
        .object({
          fights: z.number().int().nonnegative(),
          definitionVersion: z.literal("sequence-prefix-occurrence:v2"),
          patterns: z.array(
            z
              .object({
                pattern: z.array(z.string()),
                order: z.union([z.literal(2), z.literal(3)]),
                support: z.number().min(0).max(1),
                sequenceCount: z.number().int().nonnegative(),
                conversionRate: z.number().min(0).max(1),
                outcomeAssociation: z.number().min(0).max(1),
                minTurnDistance: z.number().nonnegative(),
                maxTurnDistance: z.number().nonnegative(),
              })
              .strict(),
          ),
          inference: z.literal("descriptive-selected-sample-only"),
        })
        .strict(),
    ),
    anomalies: z.array(
      z
        .object({
          code: z.string(),
          natural: estimateSchema,
          observedExamples: z.array(z.string()),
          totalTriggered: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    limitations: z.array(z.string()),
    hash: z.string(),
  })
  .strict();
export const readSimulationStudyReport = (input: unknown) => {
  const report = simulationStudyReportSchema.parse(input);
  if (studyHash(report) !== report.hash) throw new Error("Study report hash mismatch");
  if (report.attempts > report.budget || report.acceptedResults > report.attempts)
    throw new Error("Invalid report budget ledger");
  return report;
};
