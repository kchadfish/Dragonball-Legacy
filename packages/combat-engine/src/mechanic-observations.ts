import type {
  CombatDefinitionProvenance,
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

const subjectForDefinition = (
  definitionId: string,
  view: CombatMechanicsView | undefined,
): CombatMechanicObservation["subject"] => {
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
    const value = numberField(facts, "amount");
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
): readonly CombatMechanicObservation[] => {
  const facts = eventFacts(event);
  const type = stringField(facts, "type");
  if (type === undefined) return [];
  const definitionId = eventDefinitionIdFor(facts, type);
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
    ...(stringField(facts, "combatantId") === undefined
      ? {}
      : { combatantId: combatantIdSchema.parse(stringField(facts, "combatantId")) }),
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
    observations.push(...eventObservationFor(event, view));
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
