import {
  createCombatMechanicsView,
  type CombatMechanicsView,
} from "@dragonball-resurgence/combat-engine";
import type { MoveDefinition } from "@dragonball-resurgence/game-data";
import { z } from "zod";

import { canonicalHash } from "./canonical.js";
import type { SimulationFightRequest } from "./contracts.js";
import { simulationVariantIdSchema } from "./ids.js";

const overrideFields = ["kiCost", "restrictedUses", "attackPowerPercent"] as const;
type OverrideField = (typeof overrideFields)[number];

export type SimulationVariantPatch =
  | { readonly type: "add-move"; readonly move: MoveDefinition }
  | {
      readonly type: "replace-move";
      readonly moveId: string;
      readonly replacement: MoveDefinition;
    }
  | {
      readonly type: "override-move";
      readonly moveId: string;
      readonly fields: Readonly<Partial<Record<OverrideField, number | undefined>>>;
    };

export interface SimulationVariantRequest {
  readonly variantId: string;
  readonly label: string;
  readonly patches: readonly SimulationVariantPatch[];
}

export interface SimulationVariantDiff {
  readonly moveId: string;
  readonly operation: SimulationVariantPatch["type"];
  readonly beforeHash?: string;
  readonly afterHash: string;
  readonly changedFields: readonly string[];
}

export interface SimulationVariant {
  readonly schemaVersion: "simulation-variant:v1";
  readonly variantId: string;
  readonly label: string;
  readonly baseMechanicsIdentity: string;
  readonly mechanicsView: CombatMechanicsView;
  readonly patches: readonly SimulationVariantPatch[];
  readonly diff: readonly SimulationVariantDiff[];
  readonly variantHash: string;
}

export const applySimulationVariantToRequest = (
  request: SimulationFightRequest,
  variant: SimulationVariant,
): SimulationFightRequest => {
  if (request.mechanicsView.identity.contentHash !== variant.baseMechanicsIdentity)
    throw new RangeError("Variant must be based on the request mechanics view.");
  return {
    ...request,
    scenario: { ...request.scenario, variantId: variant.variantId },
    mechanicsView: variant.mechanicsView,
  };
};

export const simulationVariantRequestSchema = z
  .object({
    variantId: simulationVariantIdSchema,
    label: z.string().min(1),
    patches: z.array(z.custom<SimulationVariantPatch>()),
  })
  .strict();

export const simulationVariantDiffSchema = z
  .object({
    moveId: z.string().min(1),
    operation: z.enum(["add-move", "replace-move", "override-move"]),
    beforeHash: z.string().min(1).optional(),
    afterHash: z.string().min(1),
    changedFields: z.array(z.string().min(1)),
  })
  .strict();

export const simulationVariantSchema = z
  .object({
    schemaVersion: z.literal("simulation-variant:v1"),
    variantId: simulationVariantIdSchema,
    label: z.string().min(1),
    baseMechanicsIdentity: z.string().min(1),
    mechanicsView: z.custom<CombatMechanicsView>(),
    patches: z.array(z.unknown()),
    diff: z.array(simulationVariantDiffSchema),
    variantHash: z.string().min(1),
  })
  .strict();

const patchTarget = (patch: SimulationVariantPatch): string =>
  patch.type === "add-move" ? patch.move.id : patch.moveId;

const changedFieldsFor = (patch: SimulationVariantPatch): readonly string[] => {
  if (patch.type === "add-move") return ["move"];
  if (patch.type === "replace-move") return ["move"];
  return Object.keys(patch.fields).sort((left, right) => left.localeCompare(right));
};

const moveWithOverrides = (
  move: MoveDefinition,
  fields: Readonly<Partial<Record<OverrideField, number | undefined>>>,
): MoveDefinition => ({
  ...move,
  ...(fields.kiCost !== undefined ? { kiCost: fields.kiCost } : {}),
  ...(fields.restrictedUses !== undefined ? { restrictedUses: fields.restrictedUses } : {}),
  ...(fields.attackPowerPercent !== undefined && move.attack !== undefined
    ? { attack: { ...move.attack, powerPercent: fields.attackPowerPercent } }
    : {}),
});

const validateOverridePatch = (
  patch: Extract<SimulationVariantPatch, { readonly type: "override-move" }>,
  existing: MoveDefinition,
): void => {
  const fields = Object.keys(patch.fields);
  if (fields.some((field) => !(overrideFields as readonly string[]).includes(field)))
    throw new RangeError("Variant contains an unsupported move override field.");
  if (patch.fields.attackPowerPercent !== undefined && existing.attack === undefined)
    throw new RangeError(`Move ${patch.moveId} has no attack power field to override.`);
  for (const value of Object.values(patch.fields))
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError("Variant numeric overrides must be finite and non-negative.");
};

const validatePatch = (
  patch: SimulationVariantPatch,
  moves: ReadonlyMap<string, MoveDefinition>,
): void => {
  if (patch.type === "add-move") {
    const moveId = patch.move.id;
    if (moves.has(moveId)) throw new RangeError(`Variant add conflicts with move ${moveId}.`);
    return;
  }
  const existing = moves.get(patch.moveId);
  if (existing === undefined)
    throw new RangeError(`Variant references unknown move ${patch.moveId}.`);
  if (patch.type === "replace-move") {
    if (patch.replacement.id !== patch.moveId)
      throw new RangeError("Variant replacements must preserve the replaced move ID.");
    return;
  }
  validateOverridePatch(patch, existing);
};

const moveForPatch = (
  patch: SimulationVariantPatch,
  before: MoveDefinition | undefined,
): MoveDefinition => {
  if (patch.type === "add-move") return patch.move;
  if (patch.type === "replace-move") return patch.replacement;
  return moveWithOverrides(before!, patch.fields);
};

export const createSimulationVariant = (
  base: CombatMechanicsView,
  request: SimulationVariantRequest,
): SimulationVariant => {
  const parsed = simulationVariantRequestSchema.parse(request);
  const seen = new Set<string>();
  const moves = new Map(base.moves.map((move) => [move.id, move] as const));
  const diffs: SimulationVariantDiff[] = [];
  for (const patch of parsed.patches) {
    validatePatch(patch, moves);
    const target = patchTarget(patch);
    if (seen.has(target))
      throw new RangeError(`Variant contains conflicting patches for ${target}.`);
    seen.add(target);
    const before = moves.get(target);
    const next = moveForPatch(patch, before);
    moves.set(target, next);
    diffs.push({
      moveId: target,
      operation: patch.type,
      ...(before ? { beforeHash: canonicalHash(before) } : {}),
      afterHash: canonicalHash(next),
      changedFields: changedFieldsFor(patch),
    });
  }
  const mechanicsView = createCombatMechanicsView({
    rules: base.rules,
    rulesVersion: base.rulesVersion,
    moves: [...moves.values()],
    items: base.items,
    transformations: base.transformations,
    races: base.races,
    genericClasses: base.genericClasses,
  });
  const orderedDiffs = [...diffs].sort((left, right) => left.moveId.localeCompare(right.moveId));
  const variant = {
    schemaVersion: "simulation-variant:v1" as const,
    variantId: parsed.variantId,
    label: parsed.label,
    baseMechanicsIdentity: base.identity.contentHash,
    mechanicsView,
    patches: Object.freeze([...parsed.patches]),
    diff: Object.freeze(orderedDiffs),
    variantHash: canonicalHash({
      variantId: parsed.variantId,
      baseMechanicsIdentity: base.identity,
      patches: parsed.patches,
      diff: orderedDiffs,
    }),
  } satisfies SimulationVariant;
  return Object.freeze(variant);
};
