import type {
  CombatActionCalculationObservation,
  CombatCalculationObservation,
  CombatDamageCalculationObservation,
  CombatDefinitionProvenance,
  CombatDieCalculationObservation,
  CombatResourceCalculationObservation,
} from "./contracts.js";
import type { ActiveEffectId, CombatantId, CombatDecisionId } from "./ids.js";

export interface PrimitiveCalculationObservationContext {
  readonly decisionId?: CombatDecisionId;
  readonly effectId?: ActiveEffectId;
  readonly sourceDefinitionId?: string;
  readonly actorId?: CombatantId;
  readonly targetCombatantId?: CombatantId;
  readonly turnNumber: number;
  readonly actionInstanceId: string;
}

const provenanceFor = (
  sourceDefinitionId: string | undefined,
  effectId: ActiveEffectId | undefined,
): readonly CombatDefinitionProvenance[] => {
  if (sourceDefinitionId === undefined) return [];
  let kind: CombatDefinitionProvenance["kind"] = "move";
  if (sourceDefinitionId.startsWith("item-") || sourceDefinitionId.startsWith("item:")) {
    kind = "item";
  } else if (
    sourceDefinitionId.startsWith("transformation-") ||
    sourceDefinitionId.startsWith("transformation:")
  ) {
    kind = "transformation";
  }
  return [
    {
      kind,
      definitionId: sourceDefinitionId,
      ...(effectId === undefined ? {} : { activeEffectId: effectId }),
    },
  ];
};

const baseFor = (
  context: PrimitiveCalculationObservationContext,
  kind: CombatCalculationObservation["kind"],
  suffix: string,
) => ({
  schemaVersion: "combat-calculation-observation:v1" as const,
  observationId: `calculation:${context.actionInstanceId}:${kind}:${suffix}`,
  ...(context.decisionId === undefined ? {} : { decisionId: context.decisionId }),
  ...(context.effectId === undefined ? {} : { effectId: context.effectId }),
  ...(context.sourceDefinitionId === undefined
    ? {}
    : { sourceDefinitionId: context.sourceDefinitionId }),
  ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
  ...(context.targetCombatantId === undefined
    ? {}
    : { targetCombatantId: context.targetCombatantId }),
  turnNumber: context.turnNumber,
  actionInstanceId: context.actionInstanceId,
  provenance: provenanceFor(context.sourceDefinitionId, context.effectId),
});

export const primitiveDieObservationsFor = (input: {
  readonly context: PrimitiveCalculationObservationContext;
  readonly rolls: readonly {
    readonly attackNaturalResult: number;
    readonly attackResult: number;
    readonly defenseNaturalResult?: number;
    readonly defenseResult?: number;
    readonly outcome?: string;
  }[];
  readonly attackSides: number;
  readonly defenseSides: number;
}): readonly CombatDieCalculationObservation[] =>
  input.rolls.flatMap((roll, index) => [
    {
      ...baseFor(input.context, "die", `attack:${index}`),
      kind: "die" as const,
      scope: "attack" as const,
      dieIndex: index,
      sides: input.attackSides,
      naturalResult: roll.attackNaturalResult,
      result: roll.attackResult,
      ...(roll.outcome === undefined ? {} : { outcome: roll.outcome }),
    },
    ...(roll.defenseNaturalResult === undefined || roll.defenseResult === undefined
      ? []
      : [
          {
            ...baseFor(input.context, "die", `defense:${index}`),
            kind: "die" as const,
            scope: "defense" as const,
            dieIndex: index,
            sides: input.defenseSides,
            naturalResult: roll.defenseNaturalResult,
            result: roll.defenseResult,
            ...(roll.outcome === undefined ? {} : { outcome: roll.outcome }),
          },
        ]),
  ]) as readonly CombatDieCalculationObservation[];

export const primitiveActionObservationFor = (
  context: PrimitiveCalculationObservationContext,
  input: { readonly outcome: string; readonly successful: boolean },
): CombatActionCalculationObservation => ({
  ...baseFor(context, "action", "resolved"),
  kind: "action",
  outcome: input.outcome,
  attempted: true,
  resolved: true,
  successful: input.successful,
});

export const primitiveDamageObservationFor = (
  context: PrimitiveCalculationObservationContext,
  input: {
    readonly stage: CombatDamageCalculationObservation["stage"];
    readonly preMitigation: number;
    readonly postMitigation: number;
    readonly attempted: number;
    readonly applied: number;
    readonly prevented: number;
    readonly overkill: number;
  },
): CombatDamageCalculationObservation => ({
  ...baseFor(context, "damage", input.stage),
  kind: "damage",
  stage: input.stage,
  preMitigation: input.preMitigation,
  postMitigation: input.postMitigation,
  attempted: input.attempted,
  applied: input.applied,
  prevented: input.prevented,
  overkill: input.overkill,
});

export const primitiveResourceObservationFor = (
  context: PrimitiveCalculationObservationContext,
  input: {
    readonly resource: CombatResourceCalculationObservation["resource"];
    readonly operation: CombatResourceCalculationObservation["operation"];
    readonly requested: number;
    readonly applied: number;
    readonly capDiscarded: number;
    readonly before: number;
    readonly after: number;
  },
): CombatResourceCalculationObservation => ({
  ...baseFor(context, "resource", `${input.resource}:${input.operation}`),
  kind: "resource",
  resource: input.resource,
  operation: input.operation,
  requested: input.requested,
  applied: input.applied,
  capDiscarded: input.capDiscarded,
  before: input.before,
  after: input.after,
});

export const emitPrimitiveCalculationObservations = (
  sink: ((observations: readonly CombatCalculationObservation[]) => void) | undefined,
  observations: readonly CombatCalculationObservation[],
): void => {
  if (sink === undefined || observations.length === 0) return;
  sink(Object.freeze(observations));
};
