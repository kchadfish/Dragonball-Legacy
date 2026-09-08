/* eslint-disable complexity, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional -- Typed telemetry construction intentionally centralizes stable identity and finite calculation vocabulary. */
import type {
  CombatDefinitionProvenance,
  CombatCalculationObservation,
  CombatActionCalculationObservation,
  CombatDamageCalculationObservation,
  CombatDieCalculationObservation,
  CombatResourceCalculationObservation,
  CombatEvent,
  CombatMechanicObservation,
  CombatTransition,
  FightState,
  LegalDecision,
} from "./contracts.js";
import type { CombatMechanicsView } from "./mechanics-view.js";
import { activeEffectIdSchema, combatantIdSchema, pendingDecisionIdSchema } from "./ids.js";

export interface CombatMechanicObservationInput {
  readonly previousState?: FightState;
  readonly transition: CombatTransition;
  readonly legalDecisions?: readonly LegalDecision[];
  readonly submittedDecision?: LegalDecision;
  readonly mechanicsView?: CombatMechanicsView;
}

const calculationSourceFor = (
  facts: Record<string, unknown>,
  previousState: FightState | undefined,
  submittedDecision: LegalDecision | undefined,
): { readonly sourceDefinitionId?: string; readonly effectId?: string } => {
  const submittedSource =
    submittedDecision?.type === "use-move"
      ? submittedDecision.moveId
      : submittedDecision?.type === "use-item"
        ? submittedDecision.itemId
        : submittedDecision?.type === "activate-transformation"
          ? submittedDecision.transformationId
          : undefined;
  const direct =
    stringField(facts, "sourceDefinitionId") ??
    stringField(facts, "moveId") ??
    stringField(facts, "itemId") ??
    stringField(facts, "transformationId") ??
    submittedSource;
  const effectId = stringField(facts, "causedByEffectId");
  const activeEffect = previousState?.activeEffects.find((effect) => effect.id === effectId);
  return {
    ...(direct === undefined && activeEffect?.sourceDefinitionId === undefined
      ? {}
      : { sourceDefinitionId: direct ?? activeEffect?.sourceDefinitionId }),
    ...(effectId === undefined ? {} : { effectId }),
  };
};

const calculationKindFor = (
  sourceDefinitionId: string | undefined,
): CombatDefinitionProvenance["kind"] =>
  sourceDefinitionId?.startsWith("item:") || sourceDefinitionId?.startsWith("item-")
    ? "item"
    : sourceDefinitionId?.startsWith("transformation:") ||
        sourceDefinitionId?.startsWith("transformation-")
      ? "transformation"
      : "move";

const calculationBaseFor = (
  event: CombatEvent,
  kind: CombatCalculationObservation["kind"],
  previousState: FightState | undefined,
  submittedDecision?: LegalDecision,
): Omit<CombatCalculationObservation, "kind"> => {
  const facts = eventFacts(event);
  const source = calculationSourceFor(facts, previousState, submittedDecision);
  const actorId = stringField(facts, "combatantId") ?? stringField(facts, "sourceCombatantId");
  const turnNumber = previousState?.turnNumber ?? 0;
  const actionInstanceId =
    stringField(facts, "causedByDecisionId") ??
    `action:${event.fightId}:${turnNumber}:${event.sequence}`;
  const provenance =
    source.sourceDefinitionId === undefined
      ? []
      : [
          {
            kind: calculationKindFor(source.sourceDefinitionId),
            definitionId: source.sourceDefinitionId,
            ...(source.effectId === undefined ? {} : { activeEffectId: source.effectId }),
          },
        ];
  return {
    schemaVersion: "combat-calculation-observation:v1",
    observationId: `calculation:${event.id}:${kind}`,
    ...(stringField(facts, "causedByDecisionId") === undefined
      ? {}
      : { decisionId: stringField(facts, "causedByDecisionId") }),
    ...(source.effectId === undefined ? {} : { effectId: source.effectId }),
    ...(source.sourceDefinitionId === undefined
      ? {}
      : { sourceDefinitionId: source.sourceDefinitionId }),
    ...(actorId === undefined ? {} : { actorId }),
    ...(stringField(facts, "targetCombatantId") === undefined
      ? {}
      : { targetCombatantId: stringField(facts, "targetCombatantId") }),
    turnNumber,
    actionInstanceId,
    provenance,
  } as Omit<CombatCalculationObservation, "kind">;
};

const numberOr = (facts: Record<string, unknown>, key: string, fallback: number): number =>
  typeof facts[key] === "number" && Number.isFinite(facts[key]) ? Number(facts[key]) : fallback;

/** Converts structured combat facts into typed, optional calculation telemetry. */
export const collectCombatCalculationObservations = (input: {
  readonly previousState?: FightState;
  readonly transition: CombatTransition;
  readonly submittedDecision?: LegalDecision;
  readonly mechanicsView?: CombatMechanicsView;
}): readonly CombatCalculationObservation[] => {
  const result: CombatCalculationObservation[] = [];
  const hpByCombatant = new Map(
    Object.values(input.previousState?.combatants ?? {}).map((combatant) => [
      String(combatant.id),
      combatant.hitPoints.current,
    ]),
  );
  const dieIndexByAction = new Map<string, number>();
  const moveUseEvents = input.transition.events.filter((event) => event.type === "move-used");
  for (const event of input.transition.events) {
    const facts = eventFacts(event);
    const type = stringField(facts, "type");
    if (type === undefined) continue;
    const base = calculationBaseFor(event, "action", input.previousState, input.submittedDecision);
    if (type === "attack-rolled" || type === "defense-rolled") {
      const actionKey = stringField(facts, "causedByDecisionId") ?? `${event.fightId}:${type}`;
      const dieIndex = dieIndexByAction.get(actionKey) ?? 0;
      dieIndexByAction.set(actionKey, dieIndex + 1);
      const moveId = stringField(facts, "moveId");
      const move =
        moveId === undefined ? undefined : input.mechanicsView?.indexes.moves.get(moveId);
      const sides =
        type === "attack-rolled"
          ? (move?.mechanics.attack?.attackRoll?.sides ??
            input.mechanicsView?.rules.combat.standardDieSides ??
            20)
          : (input.mechanicsView?.rules.combat.standardDieSides ?? 20);
      const observation: CombatDieCalculationObservation = {
        ...base,
        kind: "die",
        scope: type === "attack-rolled" ? "attack" : "defense",
        dieIndex: numberOr(facts, "dieIndex", dieIndex),
        sides: numberOr(facts, "sides", sides),
        naturalResult: numberOr(facts, "naturalResult", numberOr(facts, "result", 0)),
        result: numberOr(facts, "result", 0),
        ...(stringField(facts, "outcome") === undefined
          ? {}
          : { outcome: stringField(facts, "outcome") }),
      };
      result.push(Object.freeze(observation));
      continue;
    }
    if (type === "attack-resolved") {
      const successful = facts.outcome === "successful";
      const action: CombatActionCalculationObservation = {
        ...base,
        kind: "action",
        outcome: typeof facts.outcome === "string" ? facts.outcome : "unknown",
        attempted: true,
        resolved: true,
        successful,
      };
      result.push(Object.freeze(action));
      const defenderId = stringField(facts, "targetCombatantId");
      const parsedDefenderId = combatantIdSchema.safeParse(defenderId);
      const blockUse = moveUseEvents.find((candidate) => {
        const block = input.mechanicsView?.indexes.moves.get(candidate.moveId);
        return candidate.combatantId === defenderId && block?.category === "block";
      });
      const blockCost = input.transition.events.reduce(
        (sum, candidate) =>
          candidate.type === "ki-changed" &&
          candidate.combatantId === defenderId &&
          candidate.causedByDecisionId === blockUse?.causedByDecisionId &&
          candidate.amount < 0
            ? sum - candidate.amount
            : sum,
        0,
      );
      const declared = blockUse !== undefined;
      const block: CombatCalculationObservation = {
        ...base,
        kind: "block",
        ...(parsedDefenderId.success ? { actorId: parsedDefenderId.data } : {}),
        ...(base.actorId === undefined ? {} : { targetCombatantId: base.actorId }),
        declared,
        eligibleToStop: declared && facts.outcome === "stopped",
        success: declared && facts.outcome === "stopped",
        kiCost: numberOr(facts, "blockKiCost", blockCost),
        prevention: successful ? 0 : numberOr(facts, "damagePrevented", 0),
        counterQualified: facts.counter === true,
      };
      result.push(Object.freeze(block));
      continue;
    }
    if (type === "damage-applied") {
      const amount = Math.max(0, numberOr(facts, "amount", 0));
      const targetId = stringField(facts, "targetCombatantId");
      const before = targetId === undefined ? amount : (hpByCombatant.get(targetId) ?? amount);
      const applied = Math.min(amount, Math.max(0, before));
      const overkill = Math.max(0, amount - applied);
      const damage: CombatDamageCalculationObservation = {
        ...base,
        kind: "damage",
        stage: "applied",
        preMitigation: numberOr(facts, "preMitigation", amount),
        postMitigation: amount,
        attempted: numberOr(facts, "attempted", amount),
        applied,
        prevented: Math.max(0, numberOr(facts, "prevented", 0)),
        overkill: Math.max(0, numberOr(facts, "overkill", overkill)),
      };
      result.push(Object.freeze(damage));
      if (targetId !== undefined)
        hpByCombatant.set(
          targetId,
          numberOr(facts, "remainingHitPoints", Math.max(0, before - applied)),
        );
      continue;
    }
    if (type === "hp-changed" || type === "ki-changed") {
      const amount = numberOr(facts, "amount", 0);
      const resource = type === "hp-changed" ? "hp" : "ki";
      const after = numberOr(facts, resource === "hp" ? "remainingHitPoints" : "remainingKi", 0);
      const before = after - amount;
      const operation =
        resource === "hp" ? (amount < 0 ? "damage" : "healing") : amount < 0 ? "loss" : "gain";
      const isBasePowerUp =
        resource === "ki" &&
        operation === "gain" &&
        input.submittedDecision?.type === "power-up" &&
        input.submittedDecision.actorId === stringField(facts, "combatantId");
      const requested = isBasePowerUp
        ? (input.mechanicsView?.rules.combat.powerUpKiGain ?? Math.abs(amount))
        : Math.abs(amount);
      const change: CombatResourceCalculationObservation = {
        ...base,
        kind: "resource",
        resource,
        operation,
        requested,
        applied: Math.abs(amount),
        capDiscarded: Math.max(0, requested - Math.abs(amount)),
        before,
        after,
      };
      result.push(Object.freeze(change));
      if (resource === "hp") {
        const targetId = stringField(facts, "targetCombatantId");
        if (targetId !== undefined) hpByCombatant.set(targetId, after);
      }
    }
  }
  return Object.freeze(result);
};

const subjectForDefinition = (
  definitionId: string,
  view: CombatMechanicsView | undefined,
): CombatMechanicObservation["subject"] => {
  if (definitionId.startsWith("combat:")) return "effect";
  if (definitionId.startsWith("basic-attack:")) return "basic-attack";
  const category = view?.indexes.moves.get(definitionId)?.category;
  return category === "block" ? "block" : "move";
};

const definitionForDecision = (
  decision: LegalDecision,
): { readonly definitionId: string; readonly subject: CombatMechanicObservation["subject"] } => {
  switch (decision.type) {
    case "use-move":
      return { definitionId: decision.moveId, subject: "move" };
    case "basic-attack":
      return {
        definitionId: `basic-attack:${decision.basicAttack}`,
        subject: "basic-attack",
      };
    case "use-item":
      return { definitionId: decision.itemId, subject: "item" };
    case "activate-transformation":
    case "deactivate-transformation":
      return {
        definitionId:
          decision.type === "activate-transformation"
            ? decision.transformationId
            : `transformation:${decision.actorId}`,
        subject: "transformation",
      };
    case "respond-to-pending-decision":
      return { definitionId: decision.pendingDecisionId, subject: "pending-response" };
    case "pass":
      return { definitionId: "combat:pass", subject: "basic-attack" };
    case "power-up":
      return { definitionId: "combat:power-up", subject: "basic-attack" };
    case "surrender":
      return { definitionId: "combat:surrender", subject: "basic-attack" };
  }
};

const observationForDecision = (
  category: "opportunity" | "availability" | "activation",
  decision: LegalDecision,
  view: CombatMechanicsView | undefined,
): CombatMechanicObservation => {
  const definition = definitionForDecision(decision);
  const subject =
    decision.type === "use-move"
      ? subjectForDefinition(definition.definitionId, view)
      : definition.subject;
  return Object.freeze({
    schemaVersion: "combat-mechanic-observation:v1" as const,
    category,
    subject,
    definitionId: definition.definitionId,
    ...(decision.type === "respond-to-pending-decision"
      ? { pendingDecisionId: decision.pendingDecisionId }
      : {}),
    combatantId: decision.actorId,
    ...(decision.type === "basic-attack" || decision.type === "use-move"
      ? { targetCombatantId: decision.targetCombatantId }
      : {}),
    detail: category === "opportunity" ? "legal-decision-opportunity" : `${category}-decision`,
  });
};

const eventFacts = (event: CombatEvent): Record<string, unknown> =>
  event as unknown as Record<string, unknown>;

const stringField = (facts: Record<string, unknown>, key: string): string | undefined =>
  typeof facts[key] === "string" ? facts[key] : undefined;

const numberField = (facts: Record<string, unknown>, key: string): number | undefined =>
  typeof facts[key] === "number" ? facts[key] : undefined;

type EventObservationCategory = Extract<
  CombatMechanicObservation["category"],
  "activation" | "trigger" | "resolution" | "outcome" | "value"
>;

const activationEventTypes = new Set([
  "move-used",
  "item-used",
  "transformation-activated",
  "transformation-deactivated",
  "effect-activated",
]);
const triggerEventTypes = new Set([
  "effect-activated",
  "effect-deactivated",
  "effect-negated",
  "effect-replaced",
]);
const resolutionEventTypes = new Set(["attack-resolved", "defense-rolled", "attack-rolled"]);
const outcomeEventTypes = new Set(["attack-resolved", "fight-ended", "combatant-defeated"]);
const valueEventTypes = new Set([
  "damage-applied",
  "hp-changed",
  "ki-changed",
  "status-applied",
  "transformation-activated",
]);

const eventDefinitionIdFor = (facts: Record<string, unknown>, type: string) => {
  const moveId = stringField(facts, "moveId");
  const itemId = stringField(facts, "itemId");
  const transformationId = stringField(facts, "transformationId");
  const sourceDefinitionId = stringField(facts, "sourceDefinitionId");
  const basicAttack = stringField(facts, "basicAttack");
  if (moveId !== undefined) return moveId;
  if (itemId !== undefined) return itemId;
  if (transformationId !== undefined) return transformationId;
  if (sourceDefinitionId !== undefined) return sourceDefinitionId;
  if (type !== "attack-rolled" || basicAttack === undefined) return undefined;
  return `basic-attack:${basicAttack}`;
};

const definitionIdForEvent = (
  facts: Record<string, unknown>,
  type: string,
  previousState: FightState | undefined,
): string | undefined => {
  const direct = eventDefinitionIdFor(facts, type);
  if (direct !== undefined) return direct;
  const causedByEffectId = stringField(facts, "causedByEffectId");
  const activeEffect = previousState?.activeEffects.find(
    (effect) => effect.id === causedByEffectId,
  );
  if (activeEffect?.sourceDefinitionId !== undefined) return activeEffect.sourceDefinitionId;
  if (
    [
      "damage-applied",
      "hp-changed",
      "ki-changed",
      "status-applied",
      "status-removed",
      "transformation-activated",
      "transformation-deactivated",
    ].includes(type)
  )
    return `combat:${type}`;
  return undefined;
};

const eventSubjectFor = (
  definitionId: string,
  facts: Record<string, unknown>,
  view: CombatMechanicsView | undefined,
): CombatMechanicObservation["subject"] => {
  if (stringField(facts, "itemId") !== undefined) return "item";
  if (stringField(facts, "transformationId") !== undefined) return "transformation";
  return subjectForDefinition(definitionId, view);
};

const eventCategoriesFor = (
  type: string,
  facts: Record<string, unknown>,
): readonly EventObservationCategory[] => [
  ...(activationEventTypes.has(type) ? (["activation"] as const) : []),
  ...(triggerEventTypes.has(type) || stringField(facts, "causedByEffectId") !== undefined
    ? (["trigger"] as const)
    : []),
  ...(resolutionEventTypes.has(type) ? (["resolution"] as const) : []),
  ...(outcomeEventTypes.has(type) ? (["outcome"] as const) : []),
  ...(valueEventTypes.has(type) ? (["value"] as const) : []),
];

const eventValueFor = (
  category: EventObservationCategory,
  facts: Record<string, unknown>,
): { readonly value?: number | string } => {
  if (category === "value") {
    const value = numberField(facts, "amount") ?? numberField(facts, "stacks");
    return value === undefined ? {} : { value };
  }
  if (category === "resolution" || category === "outcome") {
    const value = stringField(facts, "outcome");
    return value === undefined ? {} : { value };
  }
  return {};
};

const eventObservationFor = (
  event: CombatEvent,
  view: CombatMechanicsView | undefined,
  previousState: FightState | undefined,
): readonly CombatMechanicObservation[] => {
  const facts = eventFacts(event);
  const type = stringField(facts, "type");
  if (type === undefined) return [];
  const definitionId = definitionIdForEvent(facts, type, previousState);
  if (definitionId === undefined) return [];
  const base = {
    schemaVersion: "combat-mechanic-observation:v1" as const,
    subject: eventSubjectFor(definitionId, facts, view),
    definitionId,
    ...(stringField(facts, "causedByEffectId") === undefined
      ? {}
      : { activeEffectId: activeEffectIdSchema.parse(stringField(facts, "causedByEffectId")) }),
    ...(stringField(facts, "pendingDecisionId") === undefined
      ? {}
      : {
          pendingDecisionId: pendingDecisionIdSchema.parse(stringField(facts, "pendingDecisionId")),
        }),
    ...(stringField(facts, "combatantId") === undefined &&
    stringField(facts, "sourceCombatantId") === undefined
      ? {}
      : {
          combatantId: combatantIdSchema.parse(
            stringField(facts, "combatantId") ?? stringField(facts, "sourceCombatantId"),
          ),
        }),
    ...(stringField(facts, "targetCombatantId") === undefined
      ? {}
      : {
          targetCombatantId: combatantIdSchema.parse(stringField(facts, "targetCombatantId")),
        }),
  } as const;
  return eventCategoriesFor(type, facts).map((category) =>
    Object.freeze({ ...base, category, detail: type, ...eventValueFor(category, facts) }),
  );
};

const provenanceKey = (entry: CombatDefinitionProvenance): string =>
  `${entry.kind}:${entry.definitionId}:${entry.effectIndex ?? ""}:${entry.activeEffectId ?? ""}:${entry.pendingDecisionId ?? ""}`;

/** Builds opt-in observations from authoritative legal sets and transition facts. */
export const collectCombatMechanicObservations = (
  input: CombatMechanicObservationInput,
): readonly CombatMechanicObservation[] => {
  const observations: CombatMechanicObservation[] = [];
  const view = input.mechanicsView;
  for (const decision of input.legalDecisions ?? []) {
    observations.push(
      observationForDecision("opportunity", decision, view),
      observationForDecision("availability", decision, view),
    );
  }
  if (input.submittedDecision !== undefined)
    observations.push(observationForDecision("activation", input.submittedDecision, view));
  for (const event of input.transition.events)
    observations.push(...eventObservationFor(event, view, input.previousState));
  const seen = new Set<string>();
  return Object.freeze(
    observations.filter((observation) => {
      const provenance: CombatDefinitionProvenance = {
        kind: observation.subject === "basic-attack" ? "move" : observation.subject,
        definitionId: observation.definitionId,
        ...(observation.activeEffectId === undefined
          ? {}
          : { activeEffectId: observation.activeEffectId }),
        ...(observation.pendingDecisionId === undefined
          ? {}
          : { pendingDecisionId: observation.pendingDecisionId }),
      };
      const key = `${observation.category}:${provenanceKey(provenance)}:${observation.detail}:${observation.value ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
};
