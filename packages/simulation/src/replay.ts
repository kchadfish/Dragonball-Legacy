import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import {
  simulationFightRequestSchema,
  simulationScenarioSchema,
  type SimulationFightRequest,
  type SimulationReplayRecord,
} from "./contracts.js";
import { runSimulationFight } from "./runner.js";

const replaySummarySchema = z.custom((value) => typeof value === "object" && value !== null);

export const simulationReplayRecordSchema = z
  .object({
    schemaVersion: z.literal("simulation-contracts:v1"),
    replayVersion: z.literal("simulation-replay:v1"),
    manifestHash: z.string().min(1),
    manifest: z
      .object({
        scopeVersion: z.string().min(1),
        runId: z.string().min(1),
        rootSeed: z.number().int().nonnegative(),
        scenario: simulationScenarioSchema,
        scenarioHash: z.string().min(1),
        variantId: z.string().min(1),
        templates: z
          .object({
            a: z.object({ id: z.string().min(1), hash: z.string().min(1) }).strict(),
            b: z.object({ id: z.string().min(1), hash: z.string().min(1) }).strict(),
          })
          .strict(),
        mechanics: z
          .object({
            version: z.string().min(1),
            contentHash: z.string().min(1),
            catalogHash: z.string().min(1),
          })
          .strict(),
        fixedTime: z
          .string()
          .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO date."),
        policies: z
          .object({
            retention: z.enum(["summary", "diagnostic"]),
            limits: z
              .object({
                maximumTurns: z.number().int().positive(),
                maximumTransitions: z.number().int().positive(),
                semanticNoProgressLimit: z.number().int().positive(),
              })
              .strict(),
            stoppingPolicy: z.enum(["continue", "fail-fast"]),
          })
          .strict(),
        ai: z.record(z.string(), z.unknown()),
        seeds: z
          .object({
            combat: z.number().int().nonnegative(),
            aiA: z.number().int().nonnegative(),
            aiB: z.number().int().nonnegative(),
            derivationVersion: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    legalSetHashes: z.array(z.string()),
    decisions: z.array(z.unknown()),
    transitionHashes: z.array(z.string()),
    stateHashes: z.array(z.string()),
    eventHashes: z.array(z.string()),
    terminal: z
      .object({
        terminationReason: z.string().min(1),
        stateHash: z.string().min(1),
        summary: replaySummarySchema,
      })
      .strict(),
  })
  .strict();

export type ReplayDivergenceType = "input" | "combat" | "ai" | "variant" | "schema" | "runner";

export interface ReplayDivergence {
  readonly type: ReplayDivergenceType;
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export type ReplayVerificationResult =
  | { readonly ok: true; readonly replayHash: string }
  | { readonly ok: false; readonly divergence: ReplayDivergence };

export const replayVerificationResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), replayHash: z.string().min(1) }).strict(),
  z
    .object({
      ok: z.literal(false),
      divergence: z
        .object({
          type: z.enum(["input", "combat", "ai", "variant", "schema", "runner"]),
          path: z.string().min(1),
          expected: z.unknown(),
          actual: z.unknown(),
        })
        .strict(),
    })
    .strict(),
]);

const divergence = (
  type: ReplayDivergenceType,
  path: string,
  expected: unknown,
  actual: unknown,
): ReplayVerificationResult => ({ ok: false, divergence: { type, path, expected, actual } });

const compare = (
  expected: unknown,
  actual: unknown,
  type: ReplayDivergenceType,
  path: string,
): ReplayVerificationResult | undefined =>
  canonicalHash(expected) === canonicalHash(actual)
    ? undefined
    : divergence(type, path, expected, actual);

const firstArrayDivergence = (
  expected: readonly unknown[],
  actual: readonly unknown[],
  type: ReplayDivergenceType,
  path: string,
): ReplayVerificationResult | undefined => {
  const lengthMismatch = compare(expected.length, actual.length, type, `${path}.length`);
  if (lengthMismatch !== undefined) return lengthMismatch;
  for (let index = 0; index < expected.length; index += 1) {
    const mismatch = compare(expected[index], actual[index], type, `${path}[${index}]`);
    if (mismatch !== undefined) return mismatch;
  }
  return undefined;
};

/** Reruns a fight and reports the first divergence in replay evidence. */
export const verifySimulationReplay = (
  replay: unknown,
  request: unknown,
): ReplayVerificationResult => {
  const parsedReplay = simulationReplayRecordSchema.safeParse(replay);
  if (!parsedReplay.success)
    return divergence("schema", "replay", "simulation-replay:v1", parsedReplay.error.message);
  const parsedRequest = simulationFightRequestSchema.safeParse(request);
  if (!parsedRequest.success)
    return divergence("schema", "request", "simulation-contracts:v1", parsedRequest.error.message);

  const record = parsedReplay.data as unknown as SimulationReplayRecord;
  const fightRequest = parsedRequest.data as SimulationFightRequest;
  if (record.manifest.variantId !== fightRequest.scenario.variantId)
    return divergence(
      "variant",
      "manifest.variantId",
      record.manifest.variantId,
      fightRequest.scenario.variantId,
    );
  const actual = runSimulationFight(fightRequest);
  const manifestMismatch = compare(record.manifest, actual.replay.manifest, "input", "manifest");
  if (manifestMismatch !== undefined) return manifestMismatch;
  const manifestHashMismatch = compare(
    record.manifestHash,
    actual.replay.manifestHash,
    "input",
    "manifestHash",
  );
  if (manifestHashMismatch !== undefined) return manifestHashMismatch;
  const legalMismatch = firstArrayDivergence(
    record.legalSetHashes,
    actual.replay.legalSetHashes,
    "ai",
    "legalSetHashes",
  );
  if (legalMismatch !== undefined) return legalMismatch;
  const decisionMismatch = firstArrayDivergence(
    record.decisions,
    actual.replay.decisions,
    "ai",
    "decisions",
  );
  if (decisionMismatch !== undefined) return decisionMismatch;
  for (const [field, type] of [
    ["transitionHashes", "combat"],
    ["stateHashes", "combat"],
    ["eventHashes", "combat"],
  ] as const) {
    const mismatch = firstArrayDivergence(record[field], actual.replay[field], type, field);
    if (mismatch !== undefined) return mismatch;
  }
  const terminalMismatch = compare(record.terminal, actual.replay.terminal, "runner", "terminal");
  if (terminalMismatch !== undefined) return terminalMismatch;
  return { ok: true, replayHash: canonicalHash(record) };
};
