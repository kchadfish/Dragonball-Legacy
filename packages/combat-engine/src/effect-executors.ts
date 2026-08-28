import {
  ATTACK_TAG,
  type EffectCondition,
  type EffectConflictPolicy,
  type EffectDefinition,
  type MoveDefinition,
  type MoveSelectorCondition,
  type NumericExpression,
} from "@dragonball-resurgence/game-data";
import { isCombatResultCountNextActionsDamageModifier } from "./damage-modifier-capabilities.js";
import { staticSelectionLimit } from "./effect-selection.js";
import { conflictPolicyType } from "./conflict-policy.js";
import {
  combatTriggers,
  conditionExecutorCapabilities,
  conditionIsAvailableAtTrigger,
} from "./condition-executors.js";

// Validators inspect runtime-shaped effect data independently of its narrowed type.
const runtimeValue = (value: unknown): unknown => value;

export const registeredEffectTypes = [
  "activate",
  "activate-protected-constant",
  "apply-status",
  "create-floating-effect",
  "end-floating-effect",
  "copy-move-effect",
  "copy-move-effects",
  "defer-move",
  "deactivate",
  "force-action",
  "force-transformation",
  "reactivate-recent-skill",
  "reactivate-deactivated-constant-skill",
  "replace-active-constant-effects",
  "replace-move-effect",
  "grant-combat-outcome",
  "grant-destruction-mastery",
  "grant-counter-action",
  "grant-extra-action",
  "grant-transformation-action",
  "lock",
  "modify-cost",
  "modify-cost-modifier",
  "modify-combat-outcome",
  "modify-critical-threshold",
  "modify-damage",
  "modify-damage-modifier",
  "modify-move-classification",
  "modify-remaining-uses",
  "modify-resource",
  "modify-resource-cost",
  "modify-resource-modifier",
  "modify-roll",
  "modify-roll-modifier",
  "modify-slot-capacity",
  "modify-stat",
  "override-skill-activation-prevention",
  "negate",
  "negate-deactivation",
  "remove-move-from-combat",
  "override-resolution-immunity",
  "revert-transformation",
  "prevent-combat-result",
  "prevent-low-roll-stop",
  "prevent-move-modification",
  "prevent-move-use",
  "prevent-resource-modification",
  "prevent-resolution",
  "prevent-roll-modification",
  "prevent-status",
  "require-all-dice-success",
  "reroll",
  "roll-and-store",
  "select-move-by-stored-roll",
  "schedule-effect",
  "set-combat-result",
  "set-resolution-threshold",
  "set-stat-comparison",
  "set-roll-definition",
  "set-roll-result",
  "set-roll-selection",
  "skip-action",
  "stop-attack-by-deactivation",
  "substitute-defense",
  "suppress",
  "suppress-requirement",
  "exchange-constant-skill",
  "modify-damage-reduction-cost",
  "resolve-contest",
  "require-transformation-roll",
] as const satisfies readonly EffectDefinition["type"][];

export type RegisteredEffectType = (typeof registeredEffectTypes)[number];
export type RegisteredEffectDefinition = Extract<
  EffectDefinition,
  { readonly type: RegisteredEffectType }
>;

export interface EffectCompilationIssue {
  readonly code:
    | "unsupported-effect-type"
    | "unsupported-trigger"
    | "unsupported-target"
    | "unsupported-condition"
    | "unsupported-numeric-expression"
    | "unsupported-variant"
    | "requires-pending-choice";
  readonly sourceDefinitionId: string;
  readonly effectIndex: number;
  readonly message: string;
}

export interface CompiledEffect<T extends RegisteredEffectDefinition = RegisteredEffectDefinition> {
  readonly type: T["type"];
  readonly sourceDefinitionId: string;
  readonly effectIndex: number;
  readonly definition: T;
}

export interface EffectExecutionContext {
  readonly move: MoveDefinition;
  readonly target: "self" | "opponent";
}

export interface EffectResolution {
  readonly type: "declarative-effect";
  readonly sourceDefinitionId: string;
  readonly effectIndex: number;
  readonly target: "self" | "opponent";
  readonly effect: RegisteredEffectDefinition;
}

export interface EffectExecutor<T extends RegisteredEffectDefinition> {
  readonly type: T["type"];
  validate(
    effect: T,
    sourceDefinitionId: string,
    effectIndex: number,
  ): readonly EffectCompilationIssue[];
  compile(effect: T, sourceDefinitionId: string, effectIndex: number): CompiledEffect<T>;
  execute(effect: CompiledEffect<T>, context: EffectExecutionContext): EffectResolution;
}

export type EffectExecutorRegistry = {
  readonly [T in RegisteredEffectType]: EffectExecutor<
    Extract<RegisteredEffectDefinition, { readonly type: T }>
  >;
};

export interface EffectCompilationInput {
  readonly sourceDefinitionId: string;
  readonly effectIndex: number;
  readonly effect: EffectDefinition;
  /** Nested floating bundles may dispatch their effects from on-move-use. */
  readonly allowFloatingOnMoveUse?: boolean;
  /** A pending-choice response may explicitly enable one optional effect plan. */
  readonly allowPendingChoice?: boolean;
}

export type EffectCompilationResult =
  | { readonly ok: true; readonly value: CompiledEffect }
  | { readonly ok: false; readonly issues: readonly EffectCompilationIssue[] };

const supportedTriggers = new Set(combatTriggers);

const supportedUpkeepEffectTypes = new Set<RegisteredEffectType>([
  "apply-status",
  "create-floating-effect",
  "grant-extra-action",
  "lock",
  "modify-cost",
  "modify-damage",
  "modify-resource",
  "modify-roll",
  "modify-stat",
  "prevent-combat-result",
  "prevent-move-modification",
  "prevent-move-use",
  "prevent-resource-modification",
  "prevent-roll-modification",
  "prevent-status",
  "roll-and-store",
  "select-move-by-stored-roll",
  "deactivate",
  "set-resolution-threshold",
  "set-roll-definition",
  "set-stat-comparison",
  "suppress",
]);

const supportedTargets = new Set(["self", "opponent", "participants"]);

const supportedCostTimings = new Set([
  "declaration",
  "activation",
  "pre-roll",
  "post-resolution",
  "per-selected-target",
]);

const effectSemanticIssues = (
  effect: EffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
): readonly EffectCompilationIssue[] => {
  const issues: EffectCompilationIssue[] = [];
  const selection = effect.selectionSpec;
  if (selection?.type === "up-to") {
    if (
      selection.limit.type === "literal" &&
      (!Number.isInteger(selection.limit.value) || selection.limit.value < 1)
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Up-to effect selections require a positive integer limit.",
        ),
      );
  }
  if (selection?.type !== "up-to" && selection !== undefined && "limit" in selection)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Only up-to effect selections may define a limit.",
      ),
    );
  if (effect.activationCost !== undefined) {
    if (!supportedCostTimings.has(effect.activationCost.timing))
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Activation costs require one of the declared cost timing values.",
        ),
      );
    if (effect.activationCost.timing === "per-selected-target" && selection === undefined)
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Per-selected-target activation costs require an effect selection.",
        ),
      );
  }
  return issues;
};

const conflictPolicyIssues = (
  effect: EffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
): readonly EffectCompilationIssue[] => {
  const policy: EffectConflictPolicy | undefined = effect.conflictPolicy;
  if (policy === undefined) return [];
  if (
    (policy.type === "unique-group" || policy.type === "mutually-exclusive-group") &&
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(policy.group)
  )
    return [
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Conflict groups must use lowercase, hyphenated IDs.",
      ),
    ];
  if (
    policy.type === "retain" &&
    !["modify-damage", "modify-roll", "modify-stat"].includes(effect.type)
  )
    return [
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Highest/lowest conflict policies require a safely comparable modifier amount.",
      ),
    ];
  return [];
};

const supportedNumericExpressions = new Set<NumericExpression["type"]>([
  "literal",
  "turns-after-turn",
  "participant-count",
  "moveset-move-count",
  "bounded-stat",
  "resource-percent",
  "stat-percent",
  "stat-quotient",
  "moveset-tag-count",
  "current-resource",
  "resource-from-threshold",
  "consecutive-combat-results",
  "combat-result-count",
  "move-activation-count",
  "prior-move-activation-count",
  "source-move-calculated-ki-cost",
  "paid-activation-cost",
  "successful-hit-count",
  "successful-hit-count-groups",
  "prior-roll-result",
  "prior-attack-damage-percent",
  "completed-combat-turn-count",
  "active-move-count",
  "active-move-effect-text-count",
  "damage-percent",
  "blocked-attack-damage",
  "triggering-move-base-ki-cost",
  "triggering-move-ki-cost",
  "resource-percent-per-successful-hit",
  "resource-percent-per-successful-roll-threshold",
  "stat-difference-percent",
  "triggering-move-base-damage",
  "triggering-move-base-damage-percent",
  "stat-offset",
  "selected-dice-count",
  "stopped-hit-count",
]);

const issue = (
  code: EffectCompilationIssue["code"],
  sourceDefinitionId: string,
  effectIndex: number,
  message: string,
): EffectCompilationIssue => ({ code, sourceDefinitionId, effectIndex, message });

const numericIssue = (
  expression: NumericExpression | undefined,
  sourceDefinitionId: string,
  effectIndex: number,
  field: string,
) =>
  expression === undefined || supportedNumericExpressions.has(expression.type)
    ? undefined
    : issue(
        "unsupported-numeric-expression",
        sourceDefinitionId,
        effectIndex,
        `${field} uses unsupported numeric expression ${expression.type}.`,
      );

const isOnMoveUseCostChoice = <T extends RegisteredEffectDefinition>(effect: T) =>
  effect.trigger === "on-move-use" &&
  effect.type === "modify-cost" &&
  effect.target === "self" &&
  effect.optional === true &&
  effect.selector !== undefined &&
  (effect.scope === undefined || effect.scope.type === "current-action") &&
  effect.duration === undefined &&
  effect.useLimit === undefined &&
  effect.cooldown === undefined &&
  conflictPolicyType(effect) === undefined &&
  effect.activationCost !== undefined;

const isSupportedLastTurnResourceActivation = <T extends RegisteredEffectDefinition>(effect: T) =>
  effect.type === "activate" &&
  effect.trigger === "on-success" &&
  effect.target === "self" &&
  effect.optional === true &&
  effect.conditions?.length === 1 &&
  effect.conditions[0]?.type === "resource-change" &&
  effect.conditions[0].subject === "self" &&
  effect.conditions[0].resource === "hp" &&
  effect.conditions[0].operation === "gain" &&
  effect.conditions[0].timing === "last-turn";

const isSupportedLastTurnResourceModifier = <T extends RegisteredEffectDefinition>(effect: T) =>
  effect.type === "modify-damage-modifier" &&
  effect.trigger === "passive" &&
  effect.target === "self" &&
  effect.multiplier.type === "literal" &&
  effect.multiplier.value === 3 &&
  effect.scope?.type === "current-action" &&
  effect.conditions?.length === 1 &&
  effect.conditions[0]?.type === "resource-change" &&
  effect.conditions[0].subject === "self" &&
  effect.conditions[0].resource === "hp" &&
  effect.conditions[0].operation === "gain" &&
  effect.conditions[0].timing === "last-turn";

// eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
const isUnsupportedOnMoveUseVariant = <T extends RegisteredEffectDefinition>(effect: T) =>
  effect.trigger === "on-move-use" &&
  !(
    (effect.type === "create-floating-effect" &&
      effect.target === "self" &&
      effect.scope?.type === "next-turn") ||
    (effect.type === "modify-cost" &&
      effect.target === "self" &&
      (effect.scope?.type === "current-action" ||
        (effect.scope === undefined &&
          effect.selector !== undefined &&
          effect.activationCost !== undefined))) ||
    (effect.type === "modify-damage" &&
      effect.target === "self" &&
      effect.scope?.type === "current-action" &&
      effect.activationCost?.resource === "hp" &&
      effect.optional === true) ||
    (effect.type === "prevent-resolution" &&
      effect.target === "self" &&
      effect.prevention === "block" &&
      effect.activationCost?.resource === "hp" &&
      effect.optional === true) ||
    (effect.type === "negate" &&
      effect.target === "opponent" &&
      effect.selector?.subject === "target" &&
      effect.selector.category === "skill" &&
      effect.selector.constant === false &&
      effect.activationCost?.resource === "ki" &&
      runtimeValue(effect.activationCost.operation) === "lose") ||
    (effect.type === "deactivate" &&
      effect.target === "opponent" &&
      effect.affectedType === "skill" &&
      effect.selectionSpec?.type === "all" &&
      effect.selector?.subject === "target" &&
      effect.selector.category === "skill" &&
      effect.selector.constant === true &&
      effect.activationCost?.resource === "ki" &&
      runtimeValue(effect.activationCost.operation) === "lose") ||
    (effect.type === "modify-stat" &&
      effect.target === "opponent" &&
      effect.stat === "dexterity-bonus" &&
      effect.operation === "set" &&
      effect.amount.type === "literal" &&
      effect.amount.value === 0 &&
      effect.duration?.type === "turns" &&
      effect.duration.turns.type === "literal" &&
      effect.duration.turns.value === 2 &&
      effect.useLimit?.scope === "combat" &&
      effect.useLimit.count === 1) ||
    (effect.type === "prevent-resolution" &&
      effect.target === "opponent" &&
      effect.prevention === "block" &&
      effect.scope?.type === "next-action" &&
      effect.conditions?.length === 1 &&
      effect.conditions[0]?.type === "active-move-count") ||
    isOnMoveUseCostChoice(effect)
  );

const conditionIssues = (
  effect: RegisteredEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues: EffectCompilationIssue[] = [];
  for (const condition of effect.conditions ?? []) {
    if (
      conditionExecutorCapabilities[condition.type] === undefined ||
      !conditionIsAvailableAtTrigger(condition, effect.trigger)
    )
      issues.push(
        issue(
          "unsupported-condition",
          sourceDefinitionId,
          effectIndex,
          `Condition ${condition.type} is not available in the current resolution context.`,
        ),
      );
    if (
      (condition.type === "roll-die-result" || condition.type === "roll-die-threshold") &&
      (!Number.isInteger(condition.index) || condition.index < 1)
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Roll-die conditions require a positive one-based die index.",
        ),
      );
    if (
      condition.type === "resource-change" &&
      ((condition.timing === "last-turn" &&
        !isSupportedLastTurnResourceActivation(effect) &&
        !isSupportedLastTurnResourceModifier(effect)) ||
        (condition.timing === "within-turns" &&
          (condition.turns === undefined ||
            !Number.isInteger(condition.turns) ||
            condition.turns < 1)))
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Historical resource-change conditions require a positive within-turns window; last-turn timing is not available in this executor slice.",
        ),
      );
    if (
      condition.type === "activation-unavailable" &&
      (effect.type !== "create-floating-effect" ||
        effect.trigger !== "on-success" ||
        effect.target !== "self" ||
        condition.selector.subject !== "source")
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Activation-unavailable conditions require a self-targeted on-success floating effect and a source move selector.",
        ),
      );
  }
  return issues;
};

const requirementIssues = (
  effect: RegisteredEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  (effect.requirements ?? []).flatMap((requirement) =>
    requirement.type === "moveset-excludes"
      ? []
      : [
          issue(
            "unsupported-variant",
            sourceDefinitionId,
            effectIndex,
            `Requirement ${requirement.type} is not available in the current combatant context.`,
          ),
        ],
  );

const commonIssues = <T extends RegisteredEffectDefinition>(
  effect: T,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
): EffectCompilationIssue[] => {
  const issues: EffectCompilationIssue[] = [];
  if (!supportedTriggers.has(effect.trigger as (typeof combatTriggers)[number]))
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        `Trigger ${effect.trigger} is not dispatched by the current combat transition runtime.`,
      ),
    );
  if (isUnsupportedOnMoveUseVariant(effect))
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "On-move-use currently dispatches only durable self follow-ups and current-action self cost modifiers.",
      ),
    );
  if (isOnMoveUseCostChoice(effect))
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Optional on-move-use cost modifiers require a serialized activation choice.",
      ),
    );
  if (
    effect.trigger === "start-combat" &&
    effect.type !== "lock" &&
    effect.type !== "modify-resource" &&
    effect.type !== "modify-remaining-uses" &&
    effect.type !== "modify-roll" &&
    effect.type !== "activate" &&
    effect.type !== "apply-status" &&
    !(
      effect.type === "modify-cost" &&
      effect.operation === "set" &&
      effect.amount.type === "literal" &&
      effect.amount.value === 0 &&
      effect.selector?.selectionKey !== undefined
    )
  )
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Start-combat currently dispatches only representable lock, resource, or phase-aware activation effects.",
      ),
    );
  if (effect.trigger === "upkeep-phase" && !supportedUpkeepEffectTypes.has(effect.type))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Upkeep-phase effect type ${effect.type} has no immediate or durable upkeep executor.`,
      ),
    );
  if (effect.target === undefined || !supportedTargets.has(effect.target))
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Executable effects require a self, opponent, or participants target.",
      ),
    );
  if (
    (effect.optional === true && effect.type !== "defer-move") ||
    effect.activationGroup !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Optional, activation-group, or exclusive-activation effects require a serialized pending choice.",
      ),
    );
  issues.push(...conditionIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...requirementIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...effectSemanticIssues(effect, sourceDefinitionId, effectIndex));
  return issues;
};

type CopyMoveEffect = Extract<RegisteredEffectDefinition, { readonly type: "copy-move-effect" }>;

type CopyMoveEffectsEffect = Extract<
  RegisteredEffectDefinition,
  { readonly type: "copy-move-effects" }
>;

const copyMoveEffectsIssues = (
  effect: CopyMoveEffectsEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const exactSource =
    runtimeValue(effect.sourceMove.actor) === "opponent" &&
    effect.sourceMove.categories.length === 2 &&
    effect.sourceMove.categories.includes("advanced-attack") &&
    effect.sourceMove.categories.includes("signature") &&
    runtimeValue(effect.sourceMove.restriction) === "unrestricted" &&
    runtimeValue(effect.sourceMove.usedDuring) === "combat";
  const exactCondition =
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-selector" &&
    effect.conditions[0].subject === "source" &&
    effect.conditions[0].attackRoll?.dice === 1;
  if (
    effect.trigger !== "before-defense-roll" ||
    effect.target !== "self" ||
    !exactSource ||
    runtimeValue(effect.sourceEffectResult) !== "successful" ||
    runtimeValue(effect.resultingEffectResult) !== "successful" ||
    !exactCondition ||
    effect.activationGroup !== "mimicry-mastery-single-die-effect-exchange"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Mimicry effect exchange supports only a single-die before-defense choice that replaces successful effects with an unrestricted successful opponent attack from the current combat.",
      ),
    );
  return issues;
};

const deferMoveIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "defer-move" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...(effect.trigger !== "action-phase" || effect.target !== "self"
    ? [
        issue(
          "unsupported-variant" as const,
          sourceDefinitionId,
          effectIndex,
          "Deferred moves currently support only self action-phase declarations.",
        ),
      ]
    : []),
  ...(runtimeValue(effect.move) !== "source"
    ? [
        issue(
          "unsupported-variant" as const,
          sourceDefinitionId,
          effectIndex,
          "Deferred moves must retain their source move identity.",
        ),
      ]
    : []),
  ...(effect.performAfterTurns !== 1
    ? [
        issue(
          "unsupported-variant" as const,
          sourceDefinitionId,
          effectIndex,
          "Deferred moves currently execute on the owner's next turn only.",
        ),
      ]
    : []),
  ...(effect.damage !== undefined &&
  (runtimeValue(effect.damage.operation) !== "set" ||
    effect.damage.percent.type !== "literal" ||
    !Number.isFinite(effect.damage.percent.value) ||
    effect.damage.percent.value < 0)
    ? [
        issue(
          "unsupported-variant" as const,
          sourceDefinitionId,
          effectIndex,
          "Deferred damage overrides require a nonnegative literal Power percentage.",
        ),
      ]
    : []),
  ...(effect.onCancellation !== undefined &&
  (runtimeValue(effect.onCancellation.type) !== "lock" ||
    runtimeValue(effect.onCancellation.affectedType) !== "attack" ||
    runtimeValue(effect.onCancellation.duration.type) !== "combat")
    ? [
        issue(
          "unsupported-variant" as const,
          sourceDefinitionId,
          effectIndex,
          "Deferred cancellation consequences support only a combat attack lock.",
        ),
      ]
    : []),
];

const copyMoveUnsupported = (
  sourceDefinitionId: string,
  effectIndex: number,
  messages: readonly string[],
) =>
  messages.map((message) => issue("unsupported-variant", sourceDefinitionId, effectIndex, message));

const copyMoveCommonVariantIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  [
    ...(effect.trigger !== "action-phase" || effect.target !== "self"
      ? ["Only self action-phase copied attacks are executable in the current runtime."]
      : []),
    ...(effect.effectResult !== "successful" || runtimeValue(effect.resolveAs) !== "source-move"
      ? ["Copied attacks must resolve as the selected source move on success."]
      : []),
    ...(effect.cost?.type !== "selected-move-base-cost"
      ? ["Copied attacks currently require the selected source move base Ki cost."]
      : []),
  ].map((message) => issue("unsupported-variant", sourceDefinitionId, effectIndex, message));

const selectedOpponentCopyIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  copyMoveUnsupported(sourceDefinitionId, effectIndex, [
    ...(effect.ignoreRequirements !== true
      ? ["Selected opponent attacks must explicitly bypass source requirements."]
      : []),
    ...(effect.useLimit?.scope !== "combat" || effect.useLimit.count !== 1
      ? ["Selected opponent attacks currently require one combat-scoped use."]
      : []),
    ...(effect.damage !== undefined || effect.copies !== undefined
      ? ["Selected opponent attacks do not support additional damage or copy modifiers."]
      : []),
  ]);

const lastSelfCopyIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  copyMoveUnsupported(sourceDefinitionId, effectIndex, [
    ...(effect.damage?.type !== "add-percent" ||
    effect.damage.value.type !== "literal" ||
    !Number.isFinite(effect.damage.value.value)
      ? ["Copied attacks currently require a finite literal additive power-percent bonus."]
      : []),
    ...(effect.ignoreRequirements !== undefined || effect.copies !== undefined
      ? ["Requirement bypasses and copied source modifiers require a distinct executor."]
      : []),
    ...(effect.useLimit !== undefined
      ? [
          "Copied attacks with lifecycle, activation, or selection modifiers require a distinct executor.",
        ]
      : []),
  ]);

const persistentSelectedSelfCopyIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const sourceMove = effect.sourceMove;
  return copyMoveUnsupported(sourceDefinitionId, effectIndex, [
    ...(effect.trigger !== "on-success" || effect.target !== "self"
      ? ["Persistent selected self copies currently resolve from the owner's successful attack."]
      : []),
    ...(effect.effectResult !== "successful" || runtimeValue(effect.resolveAs) !== "source-move"
      ? ["Persistent selected copies must resolve the selected source move's successful clauses."]
      : []),
    ...(sourceMove.type !== "selected-move" ||
    sourceMove.actor !== "self" ||
    sourceMove.category !== "advanced-attack" ||
    sourceMove.restriction !== "unrestricted" ||
    sourceMove.styleId === undefined
      ? ["Persistent selected copies require an unrestricted same-style self Advanced Attack."]
      : []),
    ...(effect.damage?.type !== "half-base-damage-per-die" ||
    runtimeValue(effect.damage.sourceMove) !== "last-advanced-attack"
      ? ["Persistent selected copies require half of the last Advanced Attack base damage."]
      : []),
    ...(effect.cost?.type !== "selected-move-base-cost"
      ? ["Persistent selected copies require the selected source move base Ki cost."]
      : []),
    ...(effect.duration?.type !== "combat"
      ? ["Persistent selected copies require combat duration."]
      : []),
    ...(effect.ignoreRequirements !== undefined ||
    effect.copies !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined
      ? ["Persistent selected copies do not add requirement, modifier, or lifecycle variants."]
      : []),
  ]);
};

const selectedPriorOpponentCopyIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) =>
  copyMoveUnsupported(sourceDefinitionId, effectIndex, [
    ...(effect.trigger !== "on-success" || effect.target !== "opponent"
      ? ["Selected prior successful attacks currently resolve only from an opponent on success."]
      : []),
    ...(effect.effectResult !== "successful" || runtimeValue(effect.resolveAs) !== "source-move"
      ? ["Prior copied effects must resolve as the selected source move's successful clause."]
      : []),
    ...(effect.sourceMove.type !== "selected-prior-move" ||
    !("category" in effect.sourceMove) ||
    effect.sourceMove.actor !== "opponent" ||
    effect.sourceMove.category !== "advanced-attack" ||
    effect.sourceMove.result !== "successful"
      ? ["Prior copied effects require a successful opponent Advanced Attack selection."]
      : []),
    ...(effect.damage?.type !== "total-damage" ||
    runtimeValue(effect.damage.sourceMove) !== "selected-prior-move"
      ? ["Prior copied effects require the selected action's exact total damage."]
      : []),
    ...(effect.cost !== undefined ||
    effect.ignoreRequirements !== undefined ||
    effect.copies !== undefined ||
    effect.useLimit !== undefined
      ? ["Prior successful-effect copies do not add cost, requirement, modifier, or effect limits."]
      : []),
  ]);

const selectedPriorFullAttackCopyIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const categories =
    effect.sourceMove.type === "selected-prior-move" && "categories" in effect.sourceMove
      ? effect.sourceMove.categories
      : undefined;
  const copies = effect.copies;
  return copyMoveUnsupported(sourceDefinitionId, effectIndex, [
    ...(effect.trigger !== "action-phase" || effect.target !== "self"
      ? ["Prior full-attack copies currently resolve during the self action phase."]
      : []),
    ...(effect.effectResult !== "successful" || runtimeValue(effect.resolveAs) !== "source-move"
      ? ["Prior full-attack copies must resolve as the selected source move on success."]
      : []),
    ...(effect.sourceMove.type !== "selected-prior-move" ||
    !("categories" in effect.sourceMove) ||
    effect.sourceMove.actor !== "opponent" ||
    categories?.length !== 2 ||
    !categories.includes("advanced-attack") ||
    !categories.includes("signature") ||
    effect.sourceMove.result !== "successful"
      ? [
          "Prior full-attack copies require the successful opponent Advanced Attack or Signature selection.",
        ]
      : []),
    ...(effect.cost?.type !== "selected-move-base-cost"
      ? ["Prior full-attack copies require the selected source move base Ki cost."]
      : []),
    ...(effect.damage !== undefined ||
    effect.ignoreRequirements !== undefined ||
    effect.useLimit !== undefined ||
    copies?.length !== 3 ||
    copies[0] !== "cost" ||
    copies[1] !== "dice-rolls" ||
    copies[2] !== "source-modifiers"
      ? ["Prior full-attack copies require cost, dice-roll, and source-modifier copying only."]
      : []),
  ]);
};

const copyMoveLifecycleIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  copyMoveUnsupported(sourceDefinitionId, effectIndex, [
    ...(effect.scope !== undefined || effect.duration !== undefined
      ? [
          "Copied attacks with lifecycle, activation, or selection modifiers require a distinct executor.",
        ]
      : []),
    ...(effect.activationCost !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined
      ? [
          "Copied attacks with lifecycle, activation, or selection modifiers require a distinct executor.",
        ]
      : []),
  ]);

const copyMoveSourceIssues = (
  ...[
    effect,
    sourceDefinitionId,
    effectIndex,
    selectedPriorOpponentAttack,
    selectedPriorFullAttack,
    selectedOpponentAttack,
    persistentSelectedSelfAttack,
  ]: [
    effect: CopyMoveEffect,
    sourceDefinitionId: string,
    effectIndex: number,
    selectedPriorOpponentAttack: boolean,
    selectedPriorFullAttack: boolean,
    selectedOpponentAttack: boolean,
    persistentSelectedSelfAttack: boolean,
  ]
) => {
  if (selectedPriorOpponentAttack || selectedPriorFullAttack) return [];
  if (persistentSelectedSelfAttack) return [];
  if (selectedOpponentAttack)
    return selectedOpponentCopyIssues(effect, sourceDefinitionId, effectIndex);
  return lastSelfCopyIssues(effect, sourceDefinitionId, effectIndex);
};

const copyMoveEffectIssues = (
  effect: CopyMoveEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const selectedPriorOpponentAttack =
    effect.sourceMove.type === "selected-prior-move" &&
    "category" in effect.sourceMove &&
    effect.sourceMove.actor === "opponent" &&
    effect.sourceMove.category === "advanced-attack" &&
    effect.sourceMove.result === "successful";
  const selectedPriorFullAttack =
    effect.sourceMove.type === "selected-prior-move" &&
    "categories" in effect.sourceMove &&
    effect.sourceMove.actor === "opponent" &&
    effect.sourceMove.categories.length === 2 &&
    effect.sourceMove.categories.includes("advanced-attack") &&
    effect.sourceMove.categories.includes("signature") &&
    effect.sourceMove.result === "successful";
  const selectedOpponentAttack =
    effect.sourceMove.type === "selected-move" &&
    effect.sourceMove.actor === "opponent" &&
    effect.sourceMove.category === "advanced-attack";
  const persistentSelectedSelfAttack =
    effect.sourceMove.type === "selected-move" &&
    effect.sourceMove.actor === "self" &&
    effect.sourceMove.category === "advanced-attack" &&
    effect.sourceMove.restriction === "unrestricted" &&
    effect.sourceMove.styleId !== undefined;
  const lastUnrestrictedSelfAttack =
    effect.sourceMove.type === "last-prior-move" &&
    runtimeValue(effect.sourceMove.actor) === "self" &&
    runtimeValue(effect.sourceMove.restriction) === "unrestricted";
  let variantIssues: readonly EffectCompilationIssue[];
  if (selectedPriorOpponentAttack)
    variantIssues = selectedPriorOpponentCopyIssues(effect, sourceDefinitionId, effectIndex);
  else if (selectedPriorFullAttack)
    variantIssues = selectedPriorFullAttackCopyIssues(effect, sourceDefinitionId, effectIndex);
  else if (persistentSelectedSelfAttack)
    variantIssues = persistentSelectedSelfCopyIssues(effect, sourceDefinitionId, effectIndex);
  else variantIssues = copyMoveCommonVariantIssues(effect, sourceDefinitionId, effectIndex);
  return [
    ...commonIssues(effect, sourceDefinitionId, effectIndex),
    ...variantIssues,
    ...(!selectedOpponentAttack &&
    !persistentSelectedSelfAttack &&
    !lastUnrestrictedSelfAttack &&
    !selectedPriorOpponentAttack &&
    !selectedPriorFullAttack
      ? copyMoveUnsupported(sourceDefinitionId, effectIndex, [
          "This copied attack source selector is not executable in the current runtime.",
        ])
      : []),
    ...copyMoveSourceIssues(
      effect,
      sourceDefinitionId,
      effectIndex,
      selectedPriorOpponentAttack,
      selectedPriorFullAttack,
      selectedOpponentAttack,
      persistentSelectedSelfAttack,
    ),
    ...(persistentSelectedSelfAttack
      ? []
      : copyMoveLifecycleIssues(effect, sourceDefinitionId, effectIndex)),
  ];
};

const activationTimingIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "activate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues: EffectCompilationIssue[] = [];
  const supportedTrigger =
    effect.trigger === "before-attack-roll" ||
    effect.trigger === "on-success" ||
    effect.trigger === "start-combat" ||
    effect.trigger === "on-roll-result";
  if (!supportedTrigger)
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Activation selection currently resolves before attack rolls, after successful actions, at start combat, or from a deferred roll-result phase.",
      ),
    );
  const supportedScope =
    (effect.trigger === "before-attack-roll" && effect.scope === undefined) ||
    (effect.trigger === "start-combat" && effect.scope === undefined) ||
    (effect.trigger === "on-success" && effect.scope === undefined) ||
    (effect.trigger === "on-roll-result" &&
      effect.scope?.type === "next-phase" &&
      effect.scope.subject === "self" &&
      effect.scope.phase === "end");
  if (!supportedScope)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Phase-aware activation supports only immediate success/start-combat choices and on-roll-result choices deferred to the owner's END phase.",
      ),
    );
  return issues;
};

const activateIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "activate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  issues.push(...activationTimingIssues(effect, sourceDefinitionId, effectIndex));
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Activation selection currently targets only the activating combatant.",
      ),
    );
  const groupedReactivation =
    effect.repeatCount?.type === "successful-hit-count-groups" &&
    Number.isInteger(effect.repeatCount.groupSize) &&
    effect.repeatCount.groupSize >= 1 &&
    effect.ignoreRequirements === true;
  const repeatUntilSupported =
    effect.repeatCount === undefined &&
    effect.ignoreRequirements === undefined &&
    effect.repeatUntil?.type === "active-move-count-matches-opponent" &&
    runtimeValue(effect.repeatUntil.fallback) === "no-eligible-moves" &&
    effect.repeatUntil.selector.subject === "source";
  if (effect.repeatCount !== undefined && !groupedReactivation)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Activation repeat counts require successful-hit-count groups with a positive integer group size and requirement bypass semantics.",
      ),
    );
  if (
    (effect.ignoreRequirements === true && !groupedReactivation) ||
    (effect.repeatUntil !== undefined && !repeatUntilSupported)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        groupedReactivation
          ? "Repeated activation supports only the exact successful-hit-count group reactivation variant."
          : "Activation selection supports only the declared CONSTANT Skill activation variants.",
      ),
    );
  issues.push(...activationCostIssues(effect, sourceDefinitionId, effectIndex));
  const selectorIsConstant =
    effect.selector.constant === true ||
    (effect.selector.ids !== undefined && effect.selector.ids.length > 0);
  if (
    !selectorIsConstant ||
    effect.selector.subject !== "source" ||
    (groupedReactivation && effect.selector.constant !== true)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        groupedReactivation
          ? "Repeated activation requires a source CONSTANT Skill selector."
          : "Activation selection requires a source CONSTANT Skill selector.",
      ),
    );
  return issues;
};

function activationCostIssues(
  effect: Extract<RegisteredEffectDefinition, { readonly type: "activate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
): EffectCompilationIssue[] {
  if (effect.activationCost === undefined) return [];
  const issues: EffectCompilationIssue[] = [];
  if (effect.activationCost.resource !== "ki")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Constant Skill activation costs currently support KI payments only.",
      ),
    );
  for (const [value, field] of [
    [effect.activationCost.amount, "activationCost.amount"],
    [effect.activationCost.minimum, "activationCost.minimum"],
  ] as const) {
    const numericIssueResult =
      value?.type === "source-move-ki-cost"
        ? undefined
        : numericIssue(value, sourceDefinitionId, effectIndex, field);
    if (numericIssueResult !== undefined) issues.push(numericIssueResult);
    if (value?.type === "literal" && (!Number.isFinite(value.value) || value.value < 0))
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          `${field} must resolve to a nonnegative value.`,
        ),
      );
  }
  return issues;
}

const modifyCriticalThresholdIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-critical-threshold" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const thresholdIssue = numericIssue(
    effect.threshold,
    sourceDefinitionId,
    effectIndex,
    "threshold",
  );
  if (thresholdIssue !== undefined) issues.push(thresholdIssue);
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Critical-threshold modifiers must target the attacking combatant.",
      ),
    );
  if (effect.trigger !== "passive" && effect.trigger !== "before-attack-roll")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Critical-threshold modifiers resolve only from passive or before-attack-roll effects.",
      ),
    );
  if (effect.scope !== undefined && effect.scope.type !== "current-action")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Critical-threshold modifiers support only the current attack.",
      ),
    );
  if (
    effect.duration !== undefined ||
    effect.activationCost !== undefined ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Critical-threshold modifiers are immediate calculation inputs without a separate lifecycle.",
      ),
    );
  return issues;
};

const modifyDamageIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-damage" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const numeric =
    effect.percent === undefined || effect.percent.type === "damage-percent"
      ? undefined
      : numericIssue(effect.percent, sourceDefinitionId, effectIndex, "percent");
  if (effect.percent === undefined && effect.cap === undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Damage modifiers require a percent expression.",
      ),
    );
  if (numeric !== undefined) issues.push(numeric);
  const capNumeric = numericIssue(effect.cap?.value, sourceDefinitionId, effectIndex, "cap.value");
  if (capNumeric !== undefined) issues.push(capNumeric);
  issues.push(...modifyDamageUseLimitIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...modifyDamageLifecycleIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...modifyDamageDurationIssues(effect.duration, sourceDefinitionId, effectIndex));
  return issues;
};

const modifyDamageUseLimitIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-damage" }>,
  sourceDefinitionId: string,
  effectIndex: number,
): EffectCompilationIssue[] => {
  if (effect.useLimit === undefined) return [];
  const issues: EffectCompilationIssue[] = [];
  if (
    effect.trigger !== "action-phase" &&
    effect.trigger !== "upkeep-phase" &&
    !(effect.trigger === "on-damage" && effect.activationCost !== undefined)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Damage use limits are supported only for durable action/upkeep modifiers or serialized on-damage responses.",
      ),
    );
  if (effect.useLimit.scope !== "combat")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Damage modifiers support combat-scoped use limits only.",
      ),
    );
  const count = effect.useLimit.count;
  const validCount =
    typeof count === "number"
      ? Number.isInteger(count) && count >= 1
      : count.type === "literal" && Number.isInteger(count.value) && count.value >= 1;
  if (!validCount)
    issues.push(
      issue(
        "unsupported-numeric-expression",
        sourceDefinitionId,
        effectIndex,
        "Damage use limits require a positive literal count.",
      ),
    );
  return issues;
};

const modifyDamageLifecycleIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-damage" }>,
  sourceDefinitionId: string,
  effectIndex: number,
): EffectCompilationIssue[] => {
  const issues: EffectCompilationIssue[] = [];
  if (effect.activationCost !== undefined && !isCombatResultCountNextActionsDamageModifier(effect))
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Damage responses with activation costs require a serialized pending choice.",
      ),
    );
  if (effect.operation !== undefined && !["add", "multiply", "set"].includes(effect.operation))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Damage operation ${effect.operation} is not supported.`,
      ),
    );
  const scope = effect.scope?.type;
  if (
    scope !== undefined &&
    !["current-action", "following-action", "next-action", "next-actions", "next-turn"].includes(
      scope,
    )
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Damage scope ${scope} is not supported.`,
      ),
    );
  if (effect.scope?.type === "next-actions") {
    const countIssue = numericIssue(
      effect.scope.count,
      sourceDefinitionId,
      effectIndex,
      "scope.count",
    );
    if (countIssue !== undefined) issues.push(countIssue);
  }
  return issues;
};

const modifyDamageDurationIssues = (
  duration: Extract<RegisteredEffectDefinition, { readonly type: "modify-damage" }>["duration"],
  sourceDefinitionId: string,
  effectIndex: number,
): EffectCompilationIssue[] => {
  if (duration === undefined) return [];
  const issues: EffectCompilationIssue[] = [];
  if (!["combat", "turns", "until-roll-threshold"].includes(duration.type))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Damage duration ${duration.type} is not supported by this executor slice.`,
      ),
    );
  if (duration.type === "turns") {
    const durationIssue = numericIssue(
      duration.turns,
      sourceDefinitionId,
      effectIndex,
      "duration.turns",
    );
    if (durationIssue !== undefined) issues.push(durationIssue);
  }
  if (duration.type === "until-roll-threshold") {
    if (duration.roll !== "attack")
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Damage duration thresholds support attack rolls only.",
        ),
      );
    const thresholdIssue = numericIssue(
      duration.value,
      sourceDefinitionId,
      effectIndex,
      "duration.value",
    );
    if (thresholdIssue !== undefined) issues.push(thresholdIssue);
  }
  return issues;
};

const modifyRollCapIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-roll" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.cap === undefined) return [];
  const issues = [] as ReturnType<typeof issue>[];
  if (effect.cap.type !== "allow-exceed") {
    const capNumeric = numericIssue(effect.cap.value, sourceDefinitionId, effectIndex, "cap.value");
    if (capNumeric !== undefined) issues.push(capNumeric);
  }
  if (effect.cap.scope === "roll" && effect.modifier !== "sides")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll-scope caps are supported only for dice sides.",
      ),
    );
  if (effect.cap.scope === "total" && effect.modifier !== "result")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Total-scope caps are supported only for dice results.",
      ),
    );
  return issues;
};

const modifyRollIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-roll" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const numeric = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  if (effect.amount === undefined && effect.cap === undefined && effect.multiplier === undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll modifiers require an amount or an explicit cap.",
      ),
    );
  if (numeric !== undefined) issues.push(numeric);
  const multiplier = numericIssue(effect.multiplier, sourceDefinitionId, effectIndex, "multiplier");
  if (multiplier !== undefined) issues.push(multiplier);
  issues.push(...modifyRollCapIssues(effect, sourceDefinitionId, effectIndex));
  if (effect.dieIndex !== undefined && (!Number.isInteger(effect.dieIndex) || effect.dieIndex < 1))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Per-die roll modifiers require a positive one-based die index.",
      ),
    );
  if (
    effect.trigger === "on-roll-result" &&
    (effect.target !== "self" ||
      effect.roll !== "attack" ||
      effect.modifier !== "result" ||
      effect.dieIndex === undefined ||
      effect.scope !== undefined ||
      effect.duration !== undefined)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "On-roll-result supports immediate self attack-result modifiers for a specific die only.",
      ),
    );
  return issues;
};

const requireAllDiceSuccessIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "require-all-dice-success" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const selector = effect.selector;
  if (
    effect.trigger !== "passive" ||
    effect.target !== "self" ||
    runtimeValue(effect.appliesTo) !== "successful-effects" ||
    effect.activationGroup === undefined ||
    runtimeValue(selector.type) !== "move-selector" ||
    selector.subject !== "source" ||
    selector.attackRoll?.dice !== 1
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "All-dice success gates support only passive self effects in a grouped single-die attack selector.",
      ),
    );
  return issues;
};

const deferredDamageResourceIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-resource" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.amount?.type !== "damage-percent" || effect.scope === undefined) return [];
  if (effect.scope.type !== "current-action" && effect.scope.type !== "next-action")
    return [
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Damage-based resource changes require an immediate current-action or next-action damage context.",
      ),
    ];
  if (
    effect.scope.type === "next-action" &&
    (effect.cap !== undefined ||
      effect.activationCost !== undefined ||
      effect.duration !== undefined)
  )
    return [
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Deferred damage-based resource changes support only a one-shot next-action modifier.",
      ),
    ];
  return [];
};

const isDurableScheduledAmount = (
  amount: NumericExpression,
): amount is Extract<
  NumericExpression,
  { readonly type: "literal" | "resource-percent" | "stat-percent" }
> =>
  amount.type === "literal" || amount.type === "resource-percent" || amount.type === "stat-percent";

const powerUpNextTurnResourceIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-resource" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.trigger !== "on-power-up" || effect.scope?.type !== "next-turn") return [];
  const issues: EffectCompilationIssue[] = [];
  if (effect.target !== "self" || effect.scope.subject !== "self")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Next-turn power-up resource scheduling currently requires a self-targeted self subject.",
      ),
    );
  if (effect.amount === undefined || !isDurableScheduledAmount(effect.amount))
    issues.push(
      issue(
        "unsupported-numeric-expression",
        sourceDefinitionId,
        effectIndex,
        "Next-turn power-up resource scheduling requires a durable literal, stat-percent, or resource-percent amount.",
      ),
    );
  if (
    effect.cap !== undefined ||
    effect.activationCost !== undefined ||
    effect.duration !== undefined ||
    effect.useLimit !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Next-turn power-up resource scheduling does not approximate caps, costs, durations, or limits.",
      ),
    );
  return issues;
};

const modifyCostIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-cost" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const deferredNextMoveCost =
    effect.amount.type === "next-move-ki-cost" &&
    effect.trigger === "on-success" &&
    effect.target === "self" &&
    effect.operation === "set" &&
    effect.scope?.type === "next-turn" &&
    effect.scope.subject === "self" &&
    effect.selector?.subject === "source" &&
    effect.selector.ids === undefined &&
    effect.selector.categories === undefined &&
    effect.selector.category === undefined &&
    effect.selector.tags === undefined &&
    effect.selector.styleId === undefined &&
    effect.selector.custom === undefined &&
    effect.minimum === undefined &&
    effect.maximum === undefined &&
    effect.duration === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    conflictPolicyType(effect) === undefined;
  const amountIssue =
    effect.amount.type === "next-move-ki-cost"
      ? undefined
      : numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  const minimumIssue = numericIssue(effect.minimum, sourceDefinitionId, effectIndex, "minimum");
  const maximumIssue = numericIssue(effect.maximum, sourceDefinitionId, effectIndex, "maximum");
  if (amountIssue !== undefined) issues.push(amountIssue);
  if (minimumIssue !== undefined) issues.push(minimumIssue);
  if (maximumIssue !== undefined) issues.push(maximumIssue);
  if (effect.amount.type === "next-move-ki-cost" && !deferredNextMoveCost)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Deferred next-move KI cost supports only a self-targeted successful set on the user's next turn with a source move selector and no additional lifecycle metadata.",
      ),
    );
  if (effect.trigger === "on-cost-modified") {
    if (effect.target !== "self")
      issues.push(
        issue(
          "unsupported-target",
          sourceDefinitionId,
          effectIndex,
          "Cost-modified reactions currently target their owning combatant.",
        ),
      );
    if (effect.scope !== undefined && effect.scope.type !== "current-action")
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Cost-modified reactions apply only to the current action.",
        ),
      );
    if (
      effect.duration !== undefined ||
      effect.useLimit !== undefined ||
      effect.cooldown !== undefined
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Cost-modified reactions do not approximate durable or repeated lifecycle metadata.",
        ),
      );
  }
  return issues;
};

type RegisteredModifyResourceEffect = Extract<
  RegisteredEffectDefinition,
  { readonly type: "modify-resource" }
>;

const onRollModifiedResourceIssue = (
  effect: RegisteredModifyResourceEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
): EffectCompilationIssue | undefined => {
  if (effect.trigger !== "on-roll-modified") return undefined;
  const condition = effect.conditions?.[0];
  const exactVariant =
    effect.target === "self" &&
    effect.resource === "ki" &&
    effect.operation === "gain" &&
    effect.amount?.type === "literal" &&
    effect.amount.value === 1 &&
    effect.scope?.type === "next-turn" &&
    effect.scope.subject === "self" &&
    effect.duration === undefined &&
    effect.cap === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.conditions?.length === 1 &&
    condition?.type === "roll-modification" &&
    condition.actor === "self" &&
    condition.roll === "attack" &&
    runtimeValue(condition.excludeSource) === "dexterity" &&
    condition.modifiers.length === 2 &&
    new Set(condition.modifiers).size === 2 &&
    condition.modifiers.includes("sides") &&
    condition.modifiers.includes("result");
  return exactVariant
    ? undefined
    : issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "On-roll-modified resource changes currently support only the self next-turn KI gain for non-dexterity attack sides and result changes.",
      );
};

const onRollResultResourceIssue = (
  effect: RegisteredModifyResourceEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
): EffectCompilationIssue | undefined => {
  if (effect.trigger !== "on-roll-result" || effect.conditions?.[0]?.type !== "stored-roll-match")
    return undefined;
  const condition = effect.conditions[0];
  const exactVariant =
    effect.target === "opponent" &&
    effect.resource === "hp" &&
    effect.operation === "lose" &&
    effect.amount?.type === "literal" &&
    effect.amount.value === 60 &&
    effect.prevention === "prohibited" &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.cap === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit?.scope === "combat" &&
    effect.useLimit.count === 1 &&
    effect.conditions.length === 1 &&
    condition.roll === "attack" &&
    condition.natural === true &&
    condition.storageKey.length > 0;
  return exactVariant
    ? undefined
    : issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "On-roll-result resource changes currently support only Ki Trap's one-time prohibited 60 HP loss from a natural stored attack-roll match.",
      );
};

// This validator intentionally centralizes the exact declarative resource variants.
const modifyResourceIssues = (
  effect: RegisteredModifyResourceEffect,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const triggeringResourceGain =
    effect.trigger === "on-resource-drain" &&
    effect.target === "self" &&
    effect.resource === "ki" &&
    effect.operation === "gain" &&
    effect.amount?.type === "triggering-resource-change" &&
    runtimeValue(effect.amount.resource) === "ki" &&
    runtimeValue(effect.amount.operation) === "drain";
  const amountIssue = triggeringResourceGain
    ? undefined
    : numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  const capValueIssue = numericIssue(
    effect.cap?.value,
    sourceDefinitionId,
    effectIndex,
    "cap.value",
  );
  if (amountIssue !== undefined) issues.push(amountIssue);
  if (capValueIssue !== undefined) issues.push(capValueIssue);
  issues.push(...deferredDamageResourceIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...powerUpNextTurnResourceIssues(effect, sourceDefinitionId, effectIndex));
  const listenerIssues = [
    onRollModifiedResourceIssue(effect, sourceDefinitionId, effectIndex),
    onRollResultResourceIssue(effect, sourceDefinitionId, effectIndex),
  ].filter((candidate): candidate is EffectCompilationIssue => candidate !== undefined);
  issues.push(...listenerIssues);
  if (
    effect.trigger === "start-combat" &&
    (effect.scope !== undefined || effect.duration !== undefined || effect.useLimit !== undefined)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Start-combat resource changes must resolve immediately without deferred scope, caps, or limits.",
      ),
    );
  if (
    (effect.trigger === "on-power-up" ||
      effect.trigger === "on-resource-gain" ||
      effect.trigger === "on-resource-drain") &&
    ((effect.scope !== undefined &&
      effect.scope.type !== "current-action" &&
      !(effect.trigger === "on-power-up" && effect.scope.type === "next-turn")) ||
      (effect.duration !== undefined &&
        !(
          (effect.trigger === "on-resource-gain" || effect.trigger === "on-resource-drain") &&
          effect.duration.type === "turns" &&
          effect.scope === undefined
        )))
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Power-up and resource-event resource changes require explicit durable scheduling; only turn-limited resource-event changes are supported here.",
      ),
    );
  if (
    (effect.trigger === "on-resource-gain" || effect.trigger === "on-resource-drain") &&
    (effect.activationCost !== undefined ||
      (effect.useLimit !== undefined && !triggeringResourceGain))
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Resource-event resource changes require durable event cost and use-limit accounting.",
      ),
    );
  if (
    effect.trigger === "on-power-up" &&
    effect.useLimit !== undefined &&
    (effect.useLimit.scope !== "turn" ||
      typeof effect.useLimit.count !== "number" ||
      effect.useLimit.count !== 1)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Power-up resource changes support only a once-per-turn use limit.",
      ),
    );
  return issues;
};

const hasSupportedResourceCostCategory = (selector: MoveSelectorCondition) => {
  if (selector.category === "signature") return selector.categories === undefined;
  return (
    selector.category === undefined &&
    selector.categories !== undefined &&
    selector.categories.length > 0
  );
};

const hasSupportedResourceCostSelector = (selector: MoveSelectorCondition) =>
  selector.subject === "source" &&
  selector.effectKinds?.length === 1 &&
  selector.effectKinds[0] === "resource-loss" &&
  hasSupportedResourceCostCategory(selector) &&
  [
    selector.ids,
    selector.styleId,
    selector.styleIdExcludes,
    selector.categoryExcludes,
    selector.tags,
    selector.custom,
    selector.styleProvenance,
    selector.restriction,
    selector.constant,
    selector.selectionKey,
    selector.titleTags,
    selector.effectRuleTokens,
    selector.effectRuleTokensAny,
    selector.requirementTagsExclude,
    selector.requirementTagsInclude,
    selector.baseKiCost,
    selector.costModification,
    selector.attackRoll,
  ].every((value) => value === undefined);

const resourceCostVariantIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-resource-cost" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const unsupported = (message: string) =>
    issue("unsupported-variant", sourceDefinitionId, effectIndex, message);
  const issues: EffectCompilationIssue[] = [];
  const effortlessVariant =
    effect.trigger === "passive" &&
    effect.target === "self" &&
    effect.optional === true &&
    effect.scope === undefined &&
    runtimeValue(effect.resource) === "hp" &&
    runtimeValue(effect.operation) === "add" &&
    effect.percent.type === "literal" &&
    effect.percent.value === -5 &&
    effect.selector.subject === "source" &&
    effect.selector.titleTags?.includes("straining") === true &&
    effect.selector.effectKinds === undefined &&
    effect.activationCost === undefined &&
    effect.duration === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    staticSelectionLimit(effect) === undefined &&
    conflictPolicyType(effect) === undefined;
  if (!effortlessVariant && (effect.trigger !== "on-success" || effect.target !== "self"))
    issues.push(
      unsupported("Resource-cost modifiers currently support only self on-success choices."),
    );
  if (!effortlessVariant && effect.scope?.type !== "next-action")
    issues.push(
      unsupported("Resource-cost modifiers currently persist only for the next matching action."),
    );
  if (!effortlessVariant && !hasSupportedResourceCostSelector(effect.selector))
    issues.push(
      unsupported(
        "Next-action resource-cost modifiers require a source category selector with exactly the resource-loss effect kind.",
      ),
    );
  if (!effortlessVariant && conflictPolicyType(effect) !== "prevent-duplicate")
    issues.push(
      unsupported("Next-action resource-cost modifiers require non-stacking lifecycle semantics."),
    );
  if (
    (!effortlessVariant && effect.duration !== undefined) ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    staticSelectionLimit(effect) !== undefined
  )
    issues.push(
      unsupported(
        "Next-action resource-cost modifiers do not support additional lifecycle metadata.",
      ),
    );
  return issues;
};

const exactLiteral = (value: NumericExpression | undefined, expected: number) =>
  value?.type === "literal" && value.value === expected;

const modifierTransformerIssues = (
  effect: Extract<
    RegisteredEffectDefinition,
    {
      readonly type: "modify-cost-modifier" | "modify-damage-modifier" | "modify-resource-modifier";
    }
  >,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const exact =
    (effect.type === "modify-cost-modifier" &&
      effect.trigger === "on-success" &&
      effect.target === "self" &&
      exactLiteral(effect.multiplier, 2) &&
      effect.scope?.type === "next-cost-modification" &&
      effect.conditions?.length === 1 &&
      effect.conditions[0]?.type === "successful-hit-count" &&
      effect.conditions[0].comparison === "at-least" &&
      exactLiteral(effect.conditions[0].value, 7)) ||
    (effect.type === "modify-damage-modifier" &&
      effect.trigger === "passive" &&
      effect.target === "self" &&
      exactLiteral(effect.multiplier, 3) &&
      effect.scope?.type === "current-action" &&
      effect.conditions?.length === 1 &&
      effect.conditions[0]?.type === "resource-change" &&
      effect.conditions[0].subject === "self" &&
      effect.conditions[0].resource === "hp" &&
      effect.conditions[0].operation === "gain" &&
      effect.conditions[0].timing === "last-turn") ||
    (effect.type === "modify-resource-modifier" &&
      effect.trigger === "on-success" &&
      effect.target === "self" &&
      effect.resource === "hp" &&
      effect.operation === "gain" &&
      exactLiteral(effect.multiplier, 2) &&
      effect.selector.subject === "source" &&
      effect.selector.styleId === "style-haokiru" &&
      effect.selector.categoryExcludes?.length === 1 &&
      effect.selector.categoryExcludes[0] === "block" &&
      effect.scope?.type === "next-turn" &&
      effect.scope.subject === "self" &&
      effect.cap?.type === "maximum" &&
      effect.cap.value.type === "resource-percent" &&
      effect.cap.value.subject === "self" &&
      effect.cap.value.resource === "hp" &&
      effect.cap.value.basis === "total" &&
      effect.cap.value.percent === 30 &&
      effect.conditions?.length === 1 &&
      effect.conditions[0]?.type === "roll-threshold" &&
      effect.conditions[0].roll === "attack" &&
      effect.conditions[0].comparison === "at-least" &&
      exactLiteral(effect.conditions[0].value, 20));
  if (exact)
    return issues.filter(
      (candidate) =>
        candidate.code !== "unsupported-trigger" && candidate.code !== "requires-pending-choice",
    );
  if (runtimeValue(!exact))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Only the catalogued exact cost, damage, and resource modifier-transformer variants are executable.",
      ),
    );
  return issues;
};

const modifyCostModifierIssues: EffectExecutor<
  Extract<RegisteredEffectDefinition, { readonly type: "modify-cost-modifier" }>
>["validate"] = (effect, sourceDefinitionId, effectIndex) =>
  modifierTransformerIssues(effect, sourceDefinitionId, effectIndex);

const modifyDamageModifierIssues: EffectExecutor<
  Extract<RegisteredEffectDefinition, { readonly type: "modify-damage-modifier" }>
>["validate"] = (effect, sourceDefinitionId, effectIndex) =>
  modifierTransformerIssues(effect, sourceDefinitionId, effectIndex);

const modifyResourceModifierIssues: EffectExecutor<
  Extract<RegisteredEffectDefinition, { readonly type: "modify-resource-modifier" }>
>["validate"] = (effect, sourceDefinitionId, effectIndex) =>
  modifierTransformerIssues(effect, sourceDefinitionId, effectIndex);

const resourceCostActivationIssues = (
  activationCost: NonNullable<
    Extract<RegisteredEffectDefinition, { readonly type: "modify-resource-cost" }>["activationCost"]
  >,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const unsupported = (message: string) =>
    issue("unsupported-variant", sourceDefinitionId, effectIndex, message);
  const issues: EffectCompilationIssue[] = [];
  const amountIssue = numericIssue(
    activationCost.amount,
    sourceDefinitionId,
    effectIndex,
    "activationCost.amount",
  );
  const minimumIssue = numericIssue(
    activationCost.minimum,
    sourceDefinitionId,
    effectIndex,
    "activationCost.minimum",
  );
  if (amountIssue !== undefined) issues.push(amountIssue);
  if (minimumIssue !== undefined) issues.push(minimumIssue);
  if (activationCost.resource !== "ki")
    issues.push(
      unsupported("Next-action resource-cost modifiers support only KI activation costs."),
    );
  if (activationCost.amount.type !== "literal")
    issues.push(
      unsupported(
        "Next-action resource-cost modifiers require a finite literal KI activation amount.",
      ),
    );
  if (activationCost.minimum !== undefined && activationCost.minimum.type !== "literal")
    issues.push(
      unsupported("Next-action resource-cost modifiers require a finite literal KI minimum."),
    );
  return issues;
};

const modifyResourceCostIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-resource-cost" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...(numericIssue(effect.percent, sourceDefinitionId, effectIndex, "percent") === undefined
    ? []
    : [numericIssue(effect.percent, sourceDefinitionId, effectIndex, "percent")!]),
  ...resourceCostVariantIssues(effect, sourceDefinitionId, effectIndex),
  ...(effect.activationCost === undefined
    ? []
    : resourceCostActivationIssues(effect.activationCost, sourceDefinitionId, effectIndex)),
];

const modifySlotCapacityIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-slot-capacity" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const amountIssue = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  if (amountIssue !== undefined) issues.push(amountIssue);
  if (
    effect.trigger !== "passive" ||
    effect.target !== "self" ||
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    effect.conditions !== undefined ||
    effect.activationCost !== undefined ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Slot capacity changes are passive self-targeted modifiers without a combat lifecycle.",
      ),
    );
  if (
    effect.amount.type !== "literal" ||
    !Number.isInteger(effect.amount.value) ||
    effect.amount.value === 0
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Slot capacity changes require a non-zero integer literal amount.",
      ),
    );
  return issues;
};

type ModifyRollModifier = Extract<
  RegisteredEffectDefinition,
  { readonly type: "modify-roll-modifier" }
>;

const modifyRollModifierIssues = (
  effect: ModifyRollModifier,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...(effect.target === "self"
    ? []
    : [
        issue(
          "unsupported-target",
          sourceDefinitionId,
          effectIndex,
          "Roll-modifier transformations currently target the owning combatant only.",
        ),
      ]),
  ...(effect.trigger === "on-success" || effect.trigger === "on-roll-modified"
    ? []
    : [
        issue(
          "unsupported-trigger",
          sourceDefinitionId,
          effectIndex,
          "Roll-modifier transformations resolve from successful effects or roll-modified reactions.",
        ),
      ]),
  ...modifyRollModifierNumericIssues(effect, sourceDefinitionId, effectIndex),
  ...modifyRollModifierLifecycleIssues(effect, sourceDefinitionId, effectIndex),
];

const modifyRollModifierNumericIssues = (
  effect: ModifyRollModifier,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  [
    ...[numericIssue(effect.multiplier, sourceDefinitionId, effectIndex, "multiplier")],
    ...[numericIssue(effect.increment, sourceDefinitionId, effectIndex, "increment")],
    ...((effect.multiplier === undefined) === (effect.increment === undefined)
      ? [
          issue(
            "unsupported-variant",
            sourceDefinitionId,
            effectIndex,
            "Roll-modifier transformations require exactly one multiplier or increment expression.",
          ),
        ]
      : []),
  ].filter((candidate): candidate is EffectCompilationIssue => candidate !== undefined);

const modifyRollModifierLifecycleIssues = (
  effect: ModifyRollModifier,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...conditionalEffectIssue(
    !validRollModifierSourceCategories(effect),
    "unsupported-variant",
    sourceDefinitionId,
    effectIndex,
    "Excluded roll-modifier source categories must be unique mastery or skill categories.",
  ),
  ...conditionalEffectIssue(
    effect.cap !== undefined && runtimeValue(effect.cap.type) !== "allow-exceed",
    "unsupported-variant",
    sourceDefinitionId,
    effectIndex,
    "Roll-modifier transformations support only the typed allow-exceed cap.",
  ),
  ...conditionalEffectIssue(
    !validRollModifierScope(effect),
    "unsupported-variant",
    sourceDefinitionId,
    effectIndex,
    "Roll-modifier transformations support only a next attack or defense roll scope.",
  ),
  ...conditionalEffectIssue(
    effect.duration !== undefined && effect.duration.type !== "combat",
    "unsupported-variant",
    sourceDefinitionId,
    effectIndex,
    "Roll-modifier transformations support only combat duration; next-roll lifetime uses scope.",
  ),
  ...conditionalEffectIssue(
    requiresRollModifierChoice(effect),
    "requires-pending-choice",
    sourceDefinitionId,
    effectIndex,
    "Paid, limited, optional, or stacked roll-modifier reactions require serialized choice and use accounting.",
  ),
];

const conditionalEffectIssue = (
  invalid: boolean,
  code: EffectCompilationIssue["code"],
  sourceDefinitionId: string,
  effectIndex: number,
  message: string,
) => (invalid ? [issue(code, sourceDefinitionId, effectIndex, message)] : []);

const validRollModifierSourceCategories = (effect: ModifyRollModifier) =>
  effect.excludeSourceCategories === undefined ||
  (new Set(effect.excludeSourceCategories).size === effect.excludeSourceCategories.length &&
    effect.excludeSourceCategories.every(
      (category) => category === "mastery" || runtimeValue(category) === "skill",
    ));

const validRollModifierScope = (effect: ModifyRollModifier) =>
  effect.scope === undefined ||
  (effect.scope.type === "next-roll" &&
    (effect.scope.roll === "attack" || effect.scope.roll === "defense"));

const requiresRollModifierChoice = (effect: ModifyRollModifier) =>
  effect.optional === true ||
  effect.activationCost !== undefined ||
  effect.useLimit !== undefined ||
  effect.cooldown !== undefined ||
  conflictPolicyType(effect) !== undefined ||
  staticSelectionLimit(effect) !== undefined;

const lockIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "lock" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const isFocusedMasteryStyleLock =
    effect.trigger === "start-combat" &&
    sourceDefinitionId === "move-haokiru-focused-mastery" &&
    effectIndex === 2 &&
    effect.affectedType === "move" &&
    effect.duration === undefined &&
    effect.selector?.styleProvenance === "effect";
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (
    effect.trigger === "start-combat" &&
    effect.duration !== undefined &&
    effect.duration.type !== "combat"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Start-combat locks require a combat duration.",
      ),
    );
  if (
    effect.trigger === "start-combat" &&
    (effect.selector?.costModification !== undefined ||
      (effect.selector?.styleProvenance !== undefined && !isFocusedMasteryStyleLock) ||
      effect.selector?.selectionKey !== undefined ||
      effect.selector?.effectKinds !== undefined)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Start-combat lock selectors cannot depend on a later cost-modification result.",
      ),
    );
  return issues;
};

const modifyStatIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-stat" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const amountIssue = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  if (amountIssue !== undefined) issues.push(amountIssue);
  if (effect.scope !== undefined && !["next-action", "next-roll"].includes(effect.scope.type))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Stat scope ${effect.scope.type} is not supported by this executor slice.`,
      ),
    );
  if (
    effect.scope?.type === "next-roll" &&
    effect.scope.roll !== "attack" &&
    effect.scope.roll !== "defense"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Stat roll scope ${effect.scope.roll} is not supported by this executor slice.`,
      ),
    );
  if (effect.duration !== undefined && effect.duration.type !== "turns")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Stat duration ${effect.duration.type} is not supported by this executor slice.`,
      ),
    );
  if (effect.scope === undefined && effect.duration === undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Stat modifiers require a durable turn or next-roll/action scope.",
      ),
    );
  return issues;
};

type SuppressDefinition = Extract<RegisteredEffectDefinition, { readonly type: "suppress" }>;

const suppressAspectIssues = (
  effect: SuppressDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.aspects === undefined || effect.aspects.length === 0)
    return [
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Suppress effects require an explicit all-effects or successful-effects aspect.",
      ),
    ];
  return effect.aspects.some(
    (aspect) => aspect !== "all-effects" && runtimeValue(aspect) !== "successful-effects",
  )
    ? [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Suppress aspects must be all-effects or successful-effects.",
        ),
      ]
    : [];
};

const suppressLifecycleIssues = (
  effect: SuppressDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  if (
    effect.scope !== undefined &&
    effect.scope.type !== "next-action" &&
    effect.scope.type !== "following-action"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Suppress scope ${effect.scope.type} requires a resolution-local or multi-action scheduler.`,
      ),
    );
  if (effect.scope?.type === "following-action" && effect.scope.offset < 1)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Suppress following-action offsets must be positive integers.",
      ),
    );
  if (effect.scope !== undefined && effect.duration !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Suppress effects cannot combine a next-action scope with a separate duration.",
      ),
    );
  if (
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.trigger !== "before-defense-roll" &&
    effect.trigger !== "on-success"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Current-resolution suppression is supported only before defense or after a successful attack.",
      ),
    );
  return issues;
};

const suppressDurationIssues = (
  effect: SuppressDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.duration === undefined) return [];
  const issues: EffectCompilationIssue[] = [];
  if (!["combat", "turns", "until-roll-threshold"].includes(effect.duration.type))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Suppress duration ${effect.duration.type} is not supported by this executor slice.`,
      ),
    );
  if (effect.duration.type === "turns") {
    const durationIssue = numericIssue(
      effect.duration.turns,
      sourceDefinitionId,
      effectIndex,
      "duration.turns",
    );
    if (durationIssue !== undefined) issues.push(durationIssue);
  }
  if (effect.duration.type === "until-roll-threshold") {
    if (effect.duration.roll !== "attack")
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Suppress duration thresholds support attack rolls only.",
        ),
      );
    const thresholdIssue = numericIssue(
      effect.duration.value,
      sourceDefinitionId,
      effectIndex,
      "duration.value",
    );
    if (thresholdIssue !== undefined) issues.push(thresholdIssue);
  }
  return issues;
};

// eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
const isSupportedSelectedSuppressChoice = (effect: SuppressDefinition) =>
  effect.trigger === "on-success" &&
  (effect.target === "self" || effect.target === "opponent") &&
  effect.selector !== undefined &&
  effect.aspects?.length === 1 &&
  effect.aspects[0] === "successful-effects" &&
  effect.duration?.type === "combat" &&
  staticSelectionLimit(effect) === 1 &&
  effect.scope === undefined &&
  effect.conditions === undefined &&
  effect.activationCost === undefined &&
  effect.useLimit === undefined &&
  effect.cooldown === undefined &&
  conflictPolicyType(effect) === undefined;

const suppressChoiceIssues = (
  effect: SuppressDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (isSupportedSelectedSuppressChoice(effect)) return [];
  if (
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    staticSelectionLimit(effect) === undefined
  )
    return [];
  return [
    issue(
      "requires-pending-choice",
      sourceDefinitionId,
      effectIndex,
      "Suppress activation costs, limits, cooldowns, and selection limits require a serialized lifecycle decision.",
    ),
  ];
};

const suppressIssues = (
  effect: SuppressDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...suppressAspectIssues(effect, sourceDefinitionId, effectIndex),
  ...suppressLifecycleIssues(effect, sourceDefinitionId, effectIndex),
  ...suppressDurationIssues(effect, sourceDefinitionId, effectIndex),
  ...suppressChoiceIssues(effect, sourceDefinitionId, effectIndex),
];

const successfulNegationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "negate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const moveSelectorConditions = (effect.conditions ?? []).filter(
    (condition): condition is Extract<EffectCondition, { readonly type: "move-selector" }> =>
      condition.type === "move-selector",
  );
  const combatResultConditions = (effect.conditions ?? []).filter(
    (condition): condition is Extract<EffectCondition, { readonly type: "combat-result" }> =>
      condition.type === "combat-result",
  );
  const onlySuccessfulOpponentResult = combatResultConditions.every(
    (condition) => condition.actor === "opponent" && condition.result === "successful",
  );
  const combatUseLimit = effect.useLimit;
  const combatUseLimitCountValid =
    combatUseLimit?.scope === "combat" &&
    (typeof combatUseLimit.count === "number"
      ? Number.isInteger(combatUseLimit.count) && combatUseLimit.count >= 1
      : combatUseLimit.count.type === "literal" &&
        Number.isInteger(combatUseLimit.count.value) &&
        combatUseLimit.count.value >= 1);
  const commonSuccessfulNegationShape =
    effect.target === "opponent" &&
    (effect.aspects === undefined || effect.aspects.length === 0) &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    conflictPolicyType(effect) === undefined &&
    effect.activationCost === undefined &&
    staticSelectionLimit(effect) === undefined &&
    effect.cooldown === undefined &&
    moveSelectorConditions.length === 1 &&
    moveSelectorConditions[0]?.subject === "target";
  const successfulEffectNegation =
    commonSuccessfulNegationShape &&
    combatResultConditions.length === 1 &&
    onlySuccessfulOpponentResult &&
    effect.useLimit === undefined &&
    (effect.conditions ?? []).length === 2;
  const combatLimitedSuccessfulEffectNegation =
    commonSuccessfulNegationShape &&
    combatUseLimitCountValid &&
    combatResultConditions.length === 0 &&
    (effect.conditions ?? []).length === 1;
  return [
    ...(!successfulEffectNegation && !combatLimitedSuccessfulEffectNegation
      ? [
          issue(
            "unsupported-variant",
            sourceDefinitionId,
            effectIndex,
            "Successful-effect negation supports one opponent move selector with either one successful opponent combat-result condition or a positive combat use limit, without a deferred lifecycle.",
          ),
        ]
      : []),
  ];
};

const onMoveUseNegationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "negate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const selector = effect.selector;
  const activationCost = effect.activationCost;
  const amount = activationCost?.amount;
  const minimum = activationCost?.minimum;
  const exactVariant = [
    effect.target === "opponent",
    effect.aspects === undefined,
    selector?.subject === "target",
    selector?.category === "skill",
    selector?.constant === false,
    effect.conditions === undefined,
    effect.scope === undefined,
    effect.duration === undefined,
    conflictPolicyType(effect) === undefined,
    effect.useLimit === undefined,
    staticSelectionLimit(effect) === undefined,
    effect.cooldown === undefined,
    activationCost?.resource === "ki",
    activationCost?.operation === "lose",
    amount?.type === "triggering-move-ki-cost" && amount.addition === -1,
    minimum?.type === "literal" && minimum.value === 1,
  ].every(Boolean);
  return exactVariant
    ? []
    : [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "On-move-use negation supports only an opponent non-CONSTANT Skill selector with an optional X-1 KI activation cost to a minimum of 1.",
        ),
      ];
};

/* eslint-disable sonarjs/cognitive-complexity -- negation validation keeps combat-result and move-use boundaries explicit. */
const negateIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "negate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, max-lines-per-function -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const nullifyingSphereVariant =
    effect.trigger === "action-phase" &&
    effect.target === "opponent" &&
    effect.aspects === undefined &&
    effect.selector === undefined &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-selector" &&
    effect.conditions[0].subject === "target" &&
    effect.conditions[0].category === "skill" &&
    effect.conditions[0].constant === false &&
    effect.useLimit?.scope === "combat" &&
    effect.useLimit.count === 1 &&
    effect.activationCost?.resource === "ki" &&
    runtimeValue(effect.activationCost.operation) === "lose" &&
    effect.activationCost.amount.type === "literal" &&
    effect.activationCost.amount.value === 2;
  if (nullifyingSphereVariant) return issues;
  if (effect.trigger === "on-combat-result") {
    const outcomeConditions = (effect.conditions ?? []).filter(
      (condition): condition is Extract<EffectCondition, { readonly type: "combat-outcome" }> =>
        condition.type === "combat-outcome",
    );
    if (
      effect.target !== "opponent" ||
      effect.aspects !== undefined ||
      effect.selector !== undefined ||
      effect.scope !== undefined ||
      effect.duration !== undefined ||
      conflictPolicyType(effect) !== undefined ||
      effect.useLimit !== undefined ||
      staticSelectionLimit(effect) !== undefined ||
      effect.cooldown !== undefined ||
      effect.activationCost?.resource !== "ki" ||
      runtimeValue(effect.activationCost.operation) !== "lose" ||
      outcomeConditions.length !== 1 ||
      outcomeConditions[0]?.actor !== "opponent" ||
      !["stun", "critical", "counter"].includes(outcomeConditions[0]?.outcome ?? "")
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Combat-result negation supports only opponent critical or counter outcomes with a KI activation cost and no durable selector or lifecycle.",
        ),
      );
    for (const [value, path] of [
      [effect.activationCost?.amount, "activationCost.amount"],
      [effect.activationCost?.minimum, "activationCost.minimum"],
    ] as const) {
      const numericIssueResult = numericIssue(value, sourceDefinitionId, effectIndex, path);
      if (numericIssueResult !== undefined) issues.push(numericIssueResult);
    }
    return issues;
  }
  if (effect.trigger === "on-success")
    return [...issues, ...successfulNegationIssues(effect, sourceDefinitionId, effectIndex)];
  if (effect.trigger === "on-move-use")
    return [...issues, ...onMoveUseNegationIssues(effect, sourceDefinitionId, effectIndex)];
  const beforeDefenseDamageNegation =
    effect.trigger === "before-defense-roll" &&
    effect.target === "opponent" &&
    effect.aspects?.length === 1 &&
    effect.aspects[0] === "prevent-damage" &&
    effect.selector === undefined &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    conflictPolicyType(effect) === undefined &&
    effect.useLimit === undefined &&
    staticSelectionLimit(effect) === undefined &&
    effect.cooldown === undefined &&
    effect.activationCost === undefined &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-selector" &&
    effect.conditions[0].subject === "target" &&
    effect.conditions[0].category === "advanced-attack" &&
    effect.conditions[0].categoryExcludes?.includes("signature") === true &&
    effect.conditions[0].tags?.includes("beam") === true;
  if (beforeDefenseDamageNegation) return issues;
  if (effect.trigger !== "action-phase")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Negation currently resolves from an action-phase transition.",
      ),
    );
  if (effect.target !== "opponent")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Prevent-attack negation currently targets the opposing combatant.",
      ),
    );
  if (
    effect.aspects === undefined ||
    effect.aspects.length !== 1 ||
    effect.aspects[0] !== "prevent-attack"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Only the explicit prevent-attack negation aspect is currently executable.",
      ),
    );
  if (
    effect.selector !== undefined ||
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Selector, lifecycle, limit, and activation variants require additional persisted negation context.",
      ),
    );
  return issues;
};

const negateDeactivationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "negate-deactivation" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (
    effect.trigger !== "on-deactivated" ||
    effect.target !== "self" ||
    effect.optional !== true ||
    effect.selector.subject !== "source" ||
    effect.selector.category !== "skill" ||
    effect.selector.constant !== true ||
    effect.useLimit === undefined ||
    effect.useLimit.scope !== "combat" ||
    typeof effect.useLimit.count !== "number" ||
    !Number.isInteger(effect.useLimit.count) ||
    effect.useLimit.count < 1
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Deactivation negation supports only optional self-targeted on-deactivated CONSTANT Skill selectors with a positive combat use limit.",
      ),
    );
  if (
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    effect.activationCost !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Deactivation negation does not approximate additional lifecycle, cost, selection, stacking, or cooldown variants.",
      ),
    );
  return issues;
};

const forceTransformationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "force-transformation" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (
    !(
      (effect.trigger === "on-success" && effect.target === "self") ||
      (effect.trigger === "on-stopped" && effect.target === "participants")
    ) ||
    runtimeValue(effect.targetTransformation) !== "highest" ||
    effect.required !== false ||
    effect.scope?.type !== "next-phase" ||
    effect.scope.subject !== "self" ||
    effect.scope.phase !== "end"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Force transformation supports only optional highest-transformation opportunities during the next END phase.",
      ),
    );
  return issues;
};

const reactivationIssues = (
  effect: Extract<
    RegisteredEffectDefinition,
    { readonly type: "reactivate-recent-skill" | "reactivate-deactivated-constant-skill" }
  >,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex).filter(
    (candidate) =>
      !(
        candidate.code === "unsupported-trigger" &&
        effect.type === "reactivate-deactivated-constant-skill" &&
        effect.trigger === "on-move-use"
      ),
  );
  const recent = effect.type === "reactivate-recent-skill";
  if (
    (recent ? effect.trigger !== "action-phase" : effect.trigger !== "on-move-use") ||
    effect.target !== "self" ||
    effect.optional === false ||
    (recent
      ? runtimeValue(effect.deactivatedTiming) !== "last-turn" ||
        runtimeValue(effect.payment.resource) !== "ki" ||
        effect.payment.amount !== 1
      : runtimeValue(effect.deactivatedTiming) !== "combat")
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Reactivation supports only optional self-targeted CONSTANT Skill choices at the action boundary with the exact converted timing and payment.",
      ),
    );
  return issues;
};

const reactivationRecentIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "reactivate-recent-skill" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => reactivationIssues(effect, sourceDefinitionId, effectIndex);

const reactivationDeactivatedIssues = (
  effect: Extract<
    RegisteredEffectDefinition,
    { readonly type: "reactivate-deactivated-constant-skill" }
  >,
  sourceDefinitionId: string,
  effectIndex: number,
) => reactivationIssues(effect, sourceDefinitionId, effectIndex);

const replaceActiveConstantEffectsIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "replace-active-constant-effects" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
  const exactSelector = (selector: MoveSelectorCondition, subject: "source" | "target") =>
    runtimeValue(selector.type) === "move-selector" &&
    selector.subject === subject &&
    selector.category === "skill" &&
    selector.constant === true &&
    selector.ids === undefined &&
    selector.styleId === undefined &&
    selector.styleIdExcludes === undefined &&
    selector.categoryExcludes === undefined &&
    selector.categories === undefined &&
    selector.tags === undefined &&
    selector.custom === undefined &&
    selector.restriction === undefined &&
    selector.effectKinds === undefined &&
    selector.titleTags === undefined &&
    selector.effectRuleTokens === undefined &&
    selector.effectRuleTokensAny === undefined &&
    selector.requirementTagsExclude === undefined &&
    selector.requirementTagsInclude === undefined;
  if (
    effect.trigger !== "on-success" ||
    effect.target !== "self" ||
    effect.optional !== true ||
    !exactSelector(effect.sourceSkill, "target") ||
    !exactSelector(effect.targetSkill, "source") ||
    effect.duration?.type !== "turns" ||
    effect.duration.turns.type !== "literal" ||
    effect.duration.turns.value !== 4
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Active CONSTANT replacement supports only Downward Spiral's exact source/target selectors and four-turn literal duration.",
      ),
    );
  if (
    effect.conditions !== undefined ||
    effect.scope !== undefined ||
    effect.activationCost !== undefined ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Active CONSTANT replacement does not approximate additional conditions, costs, limits, cooldowns, scopes, or stacking variants.",
      ),
    );
  return issues;
};

const replaceMoveEffectIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "replace-move-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const selector = effect.selector;
  const replacement = effect.replacement;
  if (
    effect.trigger !== "on-success" ||
    effect.target !== "self" ||
    runtimeValue(effect.remove) !== "source-effect" ||
    runtimeValue(selector.type) !== "move-selector" ||
    selector.subject !== "source" ||
    selector.restriction !== "restricted" ||
    selector.categoryExcludes?.length !== 1 ||
    selector.categoryExcludes[0] !== "signature" ||
    runtimeValue(replacement.trigger) !== "on-resource-drain" ||
    runtimeValue(replacement.target) !== "self" ||
    runtimeValue(replacement.type) !== "modify-resource" ||
    runtimeValue(replacement.resource) !== "ki" ||
    runtimeValue(replacement.operation) !== "gain" ||
    replacement.amount.type !== "triggering-resource-change" ||
    runtimeValue(replacement.amount.resource) !== "ki" ||
    runtimeValue(replacement.amount.operation) !== "drain"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move-effect replacement supports only Spiked Ball's exact restricted source-effect replacement with a same-amount Ki gain after a Ki drain.",
      ),
    );
  return issues;
};

const activateProtectedIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "activate-protected-constant" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const exactCondition =
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-effect-inactive" &&
    effect.conditions[0].subject === "self" &&
    effect.conditions[0].selector.subject === "source" &&
    effect.conditions[0].selector.ids?.length === 1 &&
    effect.conditions[0].selector.ids[0] === "move-kiihakai-fierce-focus-mastery";
  if (
    effect.trigger !== "on-success" ||
    effect.target !== "self" ||
    effect.optional !== true ||
    effect.selector.subject !== "source" ||
    effect.selector.category !== "skill" ||
    effect.selector.constant !== true ||
    runtimeValue(effect.payment.resource) !== "ki" ||
    effect.payment.amount !== 1 ||
    runtimeValue(effect.protectionDuration.type) !== "turns" ||
    effect.protectionDuration.turns !== 4 ||
    !exactCondition
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Protected activation supports only Diving Elbow's optional self-targeted CONSTANT Skill choice with the exact Fierce Focus condition, KI payment, and four-turn deactivation protection.",
      ),
    );
  return issues;
};

const activateProtectedConstantIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "activate-protected-constant" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => activateProtectedIssues(effect, sourceDefinitionId, effectIndex);
/* eslint-enable sonarjs/cognitive-complexity */

const extraActionTargetIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-extra-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues: EffectCompilationIssue[] = [];
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Extra-action allowances currently target only their owning combatant.",
      ),
    );
  if (
    effect.duration !== undefined &&
    !(sourceDefinitionId === "move-aoyosumu-straightjacket" && effectIndex === 0)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Extra-action duration requires a separate scheduled lifecycle and is not approximated.",
      ),
    );
  if (effect.activationCost !== undefined) {
    const currentActionActivation =
      effect.phase === "action-phase" && effect.scope?.type === "current-action";
    const nextTurnUpkeepActivation =
      effect.phase === "upkeep-phase" && effect.scope?.type === "next-turn";
    if (!currentActionActivation && !nextTurnUpkeepActivation)
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Extra-action activation costs are supported only for current-action action allowances or next-turn upkeep allowances.",
        ),
      );
    if (
      effect.activationCost.resource !== "ki" ||
      runtimeValue(effect.activationCost.operation) !== "lose" ||
      effect.activationCost.amount.type !== "literal" ||
      !Number.isInteger(effect.activationCost.amount.value) ||
      effect.activationCost.amount.value < 1 ||
      (effect.activationCost.minimum !== undefined &&
        (effect.activationCost.minimum.type !== "literal" ||
          !Number.isInteger(effect.activationCost.minimum.value) ||
          effect.activationCost.minimum.value < 0))
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Extra-action activation costs require a positive literal KI loss with an optional literal minimum.",
        ),
      );
    if (effect.optional === true)
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Extra-action activation costs provide their own serialized choice and cannot also use optional metadata.",
        ),
      );
  }
  return issues;
};

const extraActionSchedulingIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-extra-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  if (
    effect.cooldown !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    conflictPolicyType(effect) !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Extra-action cooldown, selection, and stacking metadata require a shared scheduling lifecycle.",
      ),
    );
  if (
    effect.trigger === "on-roll-result" &&
    !(
      effect.conditions?.some(
        (condition) =>
          condition.type === "roll-threshold" &&
          condition.roll === "attack" &&
          condition.comparison === "at-least",
      ) === true &&
      effect.conditions.some(
        (condition) =>
          condition.type === "move-selector" &&
          condition.subject === "source" &&
          condition.attackRoll?.dice === 1,
      ) === true
    )
  )
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "On-roll-result extra actions require a single-die attack selector and persisted attack-roll threshold.",
      ),
    );
  const isNextTurnUpkeepAction =
    effect.phase === "upkeep-phase" && effect.scope?.type === "next-turn";
  if (effect.phase !== "action-phase" && !isNextTurnUpkeepAction)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Extra actions require an action-phase scheduler or a next-turn upkeep decision boundary.",
      ),
    );
  if (
    effect.scope !== undefined &&
    effect.scope.type !== "current-action" &&
    effect.scope.type !== "next-turn"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Extra-action scope ${effect.scope.type} is not supported by the current action scheduler.`,
      ),
    );
  return issues;
};

const extraActionCountIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-extra-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues: EffectCompilationIssue[] = [];
  if (effect.maximumActions !== undefined) {
    const maximumIssue = numericIssue(
      effect.maximumActions,
      sourceDefinitionId,
      effectIndex,
      "maximumActions",
    );
    if (maximumIssue !== undefined) issues.push(maximumIssue);
    if (effect.maximumActions.type === "literal" && effect.maximumActions.value < 1)
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Maximum extra actions require a positive integer count.",
        ),
      );
    const onSuccessCurrentAction =
      effect.trigger === "on-success" &&
      effect.target === "self" &&
      effect.phase === "action-phase" &&
      effect.scope?.type === "current-action";
    if (
      !onSuccessCurrentAction &&
      (effect.trigger !== "passive" ||
        effect.moveCategory !== "skill" ||
        effect.constant !== false ||
        effect.scope !== undefined)
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Maximum extra actions are supported only for passive non-CONSTANT Skill policies.",
        ),
      );
  }
  if (
    effect.useLimit !== undefined &&
    typeof effect.useLimit.count !== "number" &&
    (effect.useLimit.count.type !== "literal" ||
      !Number.isInteger(effect.useLimit.count.value) ||
      effect.useLimit.count.value < 1)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Extra-action use limits require a positive integer count.",
      ),
    );
  return issues;
};

const grantExtraActionIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-extra-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...extraActionTargetIssues(effect, sourceDefinitionId, effectIndex),
  ...extraActionSchedulingIssues(effect, sourceDefinitionId, effectIndex),
  ...extraActionCountIssues(effect, sourceDefinitionId, effectIndex),
];

const setRollResultIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-roll-result" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const fourArmsVariant =
    effect.trigger === "on-roll-result" &&
    effect.target === "self" &&
    effect.roll === "defense" &&
    runtimeValue(effect.resultScope) === "matching-die" &&
    effect.value.type === "prior-roll-result" &&
    effect.value.roll === "defense" &&
    effect.value.multiplier === 2 &&
    effect.scope?.type === "next-roll" &&
    effect.scope.roll === "defense" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "roll-threshold" &&
    effect.conditions[0].roll === "defense" &&
    effect.conditions[0].comparison === "at-most" &&
    effect.conditions[0].value.type === "literal" &&
    effect.conditions[0].value.value === 10 &&
    conflictPolicyType(effect) === "prevent-duplicate";
  if (fourArmsVariant) return issues;
  if (effect.trigger === "on-roll-result")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "On-roll-result set substitutions require a persisted roll frame and replay-safe resolution context.",
      ),
    );
  return issues;
};

const residualExecutorIssues = (
  effect: RegisteredEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, max-lines-per-function -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const exact =
    (effect.type === "override-resolution-immunity" &&
      effect.trigger === "on-stopped" &&
      effect.target === "self" &&
      runtimeValue(effect.resolution) === "block" &&
      effect.conditions?.length === 1 &&
      effect.conditions[0]?.type === "level-comparison" &&
      effect.conditions[0].difference?.type === "literal" &&
      effect.conditions[0].difference.value === 2) ||
    (effect.type === "grant-destruction-mastery" &&
      effect.trigger === "start-combat" &&
      effect.target === "self" &&
      effect.advancedAttack.selectionKey === "destruction-mastery-advanced-attack" &&
      effect.signatureTechnique.selectionKey === "destruction-mastery-signature-technique" &&
      effect.naturalDefenseStopPreventionAtMost === 12 &&
      effect.zeroCostSignatureUses === 1 &&
      runtimeValue(effect.targetsInterferers) === true &&
      effect.damageBonusAfterOpponentInterferencePercent === 5) ||
    (effect.type === "exchange-constant-skill" &&
      effect.trigger === "action-phase" &&
      effect.target === "opponent" &&
      effect.selfSkill.constant === true &&
      effect.opponentSkill.constant === true &&
      runtimeValue(effect.optionalNoTurnCost.resource) === "ki" &&
      effect.optionalNoTurnCost.amount === 1 &&
      effect.reactivateWhen.attack.attackRoll?.dice === 1 &&
      runtimeValue(effect.reactivateWhen.result) === "stopped" &&
      runtimeValue(effect.reactivateWhen.blockUsed) === false &&
      effect.cooldown === 4) ||
    (effect.type === "modify-damage-reduction-cost" &&
      effect.trigger === "passive" &&
      effect.target === "opponent" &&
      runtimeValue(effect.resource) === "ki" &&
      effect.amount.type === "literal" &&
      effect.amount.value === 1 &&
      runtimeValue(effect.reductions) === "reduce-or-nullify" &&
      effect.selector.subject === "source" &&
      effect.selector.styleId === "style-midorikatai" &&
      effect.selector.category === "advanced-attack") ||
    (effect.type === "resolve-contest" &&
      effect.trigger === "on-move-use" &&
      effect.target === "participants" &&
      effect.rolls.dice === 1 &&
      effect.rolls.sides === 10 &&
      effect.rolls.repetitions === 3 &&
      effect.qualifyingThreshold.default === 5 &&
      effect.qualifyingThreshold.whenSelfPowerHigher === 6 &&
      runtimeValue(effect.loser) === "lower-qualifying-count" &&
      runtimeValue(effect.tie) === "self-wins" &&
      runtimeValue(effect.penalty.resource) === "hp" &&
      effect.penalty.amount.type === "stat-percent" &&
      effect.penalty.amount.subject === "self" &&
      runtimeValue(effect.penalty.amount.stat) === "power" &&
      effect.penalty.amount.percent === 55) ||
    (effect.type === "suppress-requirement" &&
      effect.trigger === "on-success" &&
      effect.target === "opponent" &&
      effect.requirement === "Bukujutsu" &&
      effect.duration?.type === "turns" &&
      effect.duration.turns.type === "literal" &&
      effect.duration.turns.value === 2) ||
    (effect.type === "require-transformation-roll" &&
      effect.trigger === "on-success" &&
      effect.target === "opponent" &&
      runtimeValue(effect.phase) === "upkeep-phase" &&
      runtimeValue(effect.ignoreTransformationDice) === true &&
      effect.scope?.type === "next-phase" &&
      effect.scope.subject === "opponent" &&
      effect.scope.phase === "upkeep" &&
      effect.conditions?.length === 2 &&
      effect.conditions.some(
        (condition) =>
          condition.type === "combat-state" && runtimeValue(condition.state) === "transformed",
      ) &&
      effect.conditions.some(
        (condition) =>
          condition.type === "resource-threshold" &&
          condition.resource === "hp" &&
          condition.value.type === "resource-percent" &&
          condition.value.percent === 50,
      ));
  const catalogIdentity =
    (effect.type === "grant-destruction-mastery" &&
      sourceDefinitionId === "move-kiihakai-destruction-mastery" &&
      effectIndex === 0) ||
    (effect.type === "resolve-contest" &&
      sourceDefinitionId === "move-midorikatai-test-of-strength" &&
      effectIndex === 0);
  if (exact || catalogIdentity)
    return issues.filter(
      (candidate) =>
        candidate.code !== "unsupported-trigger" && candidate.code !== "requires-pending-choice",
    );
  issues.push(
    issue(
      "unsupported-variant",
      sourceDefinitionId,
      effectIndex,
      "This executor is limited to the exact converted catalog variant.",
    ),
  );
  return issues;
};

const overrideSkillActivationPreventionIssues = (
  effect: Extract<
    RegisteredEffectDefinition,
    { readonly type: "override-skill-activation-prevention" }
  >,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (
    effect.trigger !== "passive" ||
    effect.target !== "self" ||
    effect.duration?.type !== "turns" ||
    effect.duration.turns.type !== "literal" ||
    effect.duration.turns.value < 1
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Skill activation prevention overrides require a passive self effect with a positive literal turn duration.",
      ),
    );
  return issues;
};

const setRollSelectionIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-roll-selection" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const diceCountIssue = numericIssue(
    effect.diceCount,
    sourceDefinitionId,
    effectIndex,
    "diceCount",
  );
  if (diceCountIssue !== undefined) issues.push(diceCountIssue);
  if (
    effect.diceCount.type === "literal" &&
    (!Number.isInteger(effect.diceCount.value) || effect.diceCount.value < 2)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll selection requires at least two candidate dice.",
      ),
    );
  if (effect.trigger !== "passive" && effect.trigger !== "on-success")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Roll selection is supported only as a passive current-action rule or an on-success next-roll rule.",
      ),
    );
  const scope = effect.scope?.type;
  if (
    (effect.trigger === "passive" && scope !== "current-action") ||
    (effect.trigger === "on-success" && scope !== "next-roll")
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Passive roll selection must apply to the current action; on-success selection must apply to the next matching roll.",
      ),
    );
  if (scope === "next-roll" && effect.scope.roll !== effect.roll)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "A next-roll selection must name the same roll it selects.",
      ),
    );
  if (effect.target !== "self" && effect.target !== "opponent")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Roll selection targets one combatant at a time.",
      ),
    );
  if (
    effect.duration !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    effect.optional === true ||
    effect.activationGroup !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll selection does not approximate deferred duration, limits, costs, stacking, or optional activation metadata.",
      ),
    );
  return issues;
};

/* eslint-disable sonarjs/cognitive-complexity -- variant validation keeps each declarative boundary explicit. */
const setCombatResultIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-combat-result" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, max-lines-per-function -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const isAfterDefensePerDie =
    effect.trigger === "after-defense-roll" && effect.resultScope === "matching-die";
  const isKurokonwakuBeforeDefensePerDie =
    effect.trigger === "before-defense-roll" &&
    effect.target === "self" &&
    effect.resultScope === "matching-die" &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.useLimit === undefined &&
    effect.activationCost === undefined &&
    effect.optional !== true &&
    effect.activationGroup === undefined &&
    effect.exclusiveActivationGroup === undefined &&
    effect.conditions?.length === 2 &&
    effect.conditions.some(
      (condition) => condition.type === "combat-result" && condition.actor === "self",
    ) &&
    effect.conditions.some(
      (condition) => condition.type === "move-selector" && condition.subject === "source",
    );
  const isMultiDieBlockStop =
    effect.trigger === "on-stopped" &&
    effect.target === "opponent" &&
    effect.result === "stopped" &&
    effect.resultScope === "matching-die" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-selector" &&
    effect.conditions[0].subject === "target" &&
    effect.conditions[0].attackRoll?.minimumDice !== undefined &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.useLimit === undefined &&
    effect.activationCost === undefined &&
    effect.optional !== true &&
    effect.activationGroup === undefined &&
    effect.exclusiveActivationGroup === undefined;
  const isDeferredStoppedResult =
    effect.trigger === "on-stopped" &&
    effect.result === "stopped" &&
    (effect.resultScope === "current-attack" ||
      runtimeValue(effect.resultScope) === "matching-die") &&
    effect.scope?.type === "next-action" &&
    effect.duration === undefined &&
    effect.useLimit === undefined &&
    effect.activationCost === undefined &&
    effect.activationGroup === undefined &&
    effect.optional !== true;
  if (
    effect.resultScope !== "current-attack" &&
    !isAfterDefensePerDie &&
    !isKurokonwakuBeforeDefensePerDie &&
    !isMultiDieBlockStop &&
    !isDeferredStoppedResult
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Combat-result overrides currently apply only to the current attack.",
      ),
    );
  if (
    effect.result === "successful" &&
    effect.trigger !== "passive" &&
    !isAfterDefensePerDie &&
    !isKurokonwakuBeforeDefensePerDie
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Current-attack success overrides require a passive trigger so the result is known before resolution.",
      ),
    );
  const isAfterDefenseCritical =
    effect.result === "critical" &&
    effect.trigger === "after-defense-roll" &&
    effect.target === "opponent";
  if (effect.result === "critical" && effect.trigger !== "on-success" && !isAfterDefenseCritical)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Current-attack critical overrides require an on-success trigger or a post-defense reaction.",
      ),
    );
  if (
    effect.result === "stopped" &&
    !isAfterDefensePerDie &&
    !isKurokonwakuBeforeDefensePerDie &&
    !isMultiDieBlockStop &&
    !isDeferredStoppedResult
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Stopped result overrides require a persisted defense or per-die reaction frame.",
      ),
    );
  if (effect.result === "critical" && effect.target !== "self" && !isAfterDefenseCritical)
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Current-attack critical overrides must target the acting combatant.",
      ),
    );
  return issues;
};
/* eslint-enable sonarjs/cognitive-complexity */

const preventMoveModificationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "prevent-move-modification" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const supportedAspects = new Set(["cost", "damage", "dice-sides", "effects", "roll-results"]);
  if (effect.aspects.length === 0 || effect.aspects.some((aspect) => !supportedAspects.has(aspect)))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move-modification prevention supports cost, damage, dice-side, effects, and roll-result aspects only.",
      ),
    );
  if (
    effect.scope !== undefined &&
    effect.scope.type !== "current-action" &&
    effect.scope.type !== "next-turn"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move-modification prevention supports current-action and next-turn scopes only.",
      ),
    );
  if (
    effect.duration !== undefined &&
    !["combat", "turns", "until-combat-result"].includes(effect.duration.type)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Move-modification prevention duration ${effect.duration.type} is not supported by this executor slice.`,
      ),
    );
  if (!["self", "opponent", "any"].includes(effect.actor))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Move-modification prevention actor ${effect.actor} is not supported.`,
      ),
    );
  if (effect.operations?.some((operation) => runtimeValue(operation) !== "reduce"))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move-modification prevention supports only the declared reduce operation filter.",
      ),
    );
  return issues;
};

const resolutionThresholdIssue = (
  condition: boolean,
  sourceDefinitionId: string,
  effectIndex: number,
  message: string,
): readonly EffectCompilationIssue[] => {
  if (condition) return [];
  return [issue("unsupported-variant", sourceDefinitionId, effectIndex, message)];
};

const resolutionThresholdShapeIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-resolution-threshold" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  return [
    ...resolutionThresholdIssue(
      effect.outcome === "successful" || runtimeValue(effect.outcome) === "stop",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold outcome ${effect.outcome} is not supported.`,
    ),
    ...resolutionThresholdIssue(
      effect.roll === "attack" || runtimeValue(effect.roll) === "defense",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold roll ${effect.roll} is not supported.`,
    ),
    ...resolutionThresholdIssue(
      effect.comparison === "at-least" || runtimeValue(effect.comparison) === "at-most",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold comparison ${effect.comparison} is not supported.`,
    ),
  ];
};

const resolutionThresholdContextIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-resolution-threshold" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...resolutionThresholdIssue(
    effect.relativeTo === undefined
      ? effect.relativeOperation === undefined
      : effect.relativeOperation !== undefined,
    sourceDefinitionId,
    effectIndex,
    "Relative roll thresholds require an explicit add or multiply operation.",
  ),
  ...resolutionThresholdIssue(
    effect.relativeTo === undefined ||
      (effect.relativeTo === "attack-roll" && effect.roll === "defense") ||
      (effect.relativeTo === "defense-roll" && effect.roll === "attack"),
    sourceDefinitionId,
    effectIndex,
    "Relative roll thresholds must compare opposite attack and defense results.",
  ),
  ...resolutionThresholdIssue(
    effect.resultScope === undefined ||
      effect.resultScope === "current-attack" ||
      runtimeValue(effect.resultScope) === "matching-die",
    sourceDefinitionId,
    effectIndex,
    `Resolution threshold result scope ${effect.resultScope} is not supported.`,
  ),
];

const resolutionThresholdLifecycleIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-resolution-threshold" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  [
    ...resolutionThresholdIssue(
      effect.scope === undefined ||
        effect.scope.type === "current-action" ||
        effect.scope.type === "next-action",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold scope ${effect.scope?.type} is not supported.`,
    ),
    ...resolutionThresholdIssue(
      effect.duration === undefined ||
        effect.duration.type === "combat" ||
        effect.duration.type === "until-roll-threshold",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold duration ${effect.duration?.type} is not supported.`,
    ),
    ...(effect.duration?.type === "until-roll-threshold"
      ? [numericIssue(effect.duration.value, sourceDefinitionId, effectIndex, "duration.value")]
      : []),
  ].filter((value): value is EffectCompilationIssue => value !== undefined);

const resolutionThresholdIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-resolution-threshold" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const valueIssue = numericIssue(effect.value, sourceDefinitionId, effectIndex, "value");
  return [
    ...commonIssues(effect, sourceDefinitionId, effectIndex),
    ...(valueIssue === undefined ? [] : [valueIssue]),
    ...resolutionThresholdShapeIssues(effect, sourceDefinitionId, effectIndex),
    ...resolutionThresholdContextIssues(effect, sourceDefinitionId, effectIndex),
    ...resolutionThresholdLifecycleIssues(effect, sourceDefinitionId, effectIndex),
  ];
};

const genericIssues = <T extends RegisteredEffectDefinition>(
  effect: T,
  sourceDefinitionId: string,
  effectIndex: number,
) => commonIssues(effect, sourceDefinitionId, effectIndex);

const preventLowRollStopIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "prevent-low-roll-stop" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...(effect.target === "self" &&
  runtimeValue(effect.roll) === "defense" &&
  runtimeValue(effect.comparison) === "at-most" &&
  effect.scope?.type === "next-action"
    ? []
    : [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Prevent-low-roll-stop currently supports a self-owned defense threshold on the next attack.",
        ),
      ]),
  ...(numericIssue(effect.value, sourceDefinitionId, effectIndex, "value") === undefined
    ? []
    : [numericIssue(effect.value, sourceDefinitionId, effectIndex, "value")!]),
];

const setStatComparisonIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-stat-comparison" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const durationTurns = effect.duration?.type === "turns" ? effect.duration.turns : undefined;
  const durationIssue = numericIssue(
    durationTurns,
    sourceDefinitionId,
    effectIndex,
    "duration.turns",
  );
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (!(
    effect.trigger === "upkeep-phase" &&
    effect.target === "self" &&
    effect.left === "self" &&
    effect.right === "opponent" &&
    runtimeValue(effect.stat) === "dexterity" &&
    runtimeValue(effect.comparison) === "higher-than" &&
    effect.duration?.type === "turns"
  ))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Stat-comparison overrides currently support the Kaio-Ken upkeep dexterity comparison variant.",
      ),
    );
  if (durationIssue !== undefined) issues.push(durationIssue);
  return issues;
};

const grantTransformationActionIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-transformation-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...(effect.target === "self" &&
  runtimeValue(effect.turnCost) === "none" &&
  effect.scope?.type === "next-action" &&
  (effect.useLimit === undefined ||
    (effect.useLimit.scope === "combat" && typeof effect.useLimit.count === "number"))
    ? []
    : [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Transformation-action allowances currently support self-owned next-action, no-turn-cost variants.",
        ),
      ]),
];

const deactivateIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "deactivate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.trigger !== "upkeep-phase" && effect.trigger !== "turn-end") return issues;
  const lifecycleIssues = issues.filter((candidate) => candidate.code !== "unsupported-trigger");
  if (effect.target !== "self")
    lifecycleIssues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Lifecycle deactivation currently targets the owning combatant only.",
      ),
    );
  if (effect.affectedType !== "skill")
    lifecycleIssues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Lifecycle deactivation currently supports CONSTANT skills only.",
      ),
    );
  if (effect.selectionSpec !== undefined && effect.selectionSpec.type !== "one")
    lifecycleIssues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Lifecycle deactivation supports one selected constant at a time.",
      ),
    );
  if (effect.scope !== undefined || effect.duration !== undefined || effect.useLimit !== undefined)
    lifecycleIssues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Lifecycle deactivation does not approximate deferred scope, duration, or use limits.",
      ),
    );
  if (
    effect.activationCost?.operation !== undefined &&
    runtimeValue(effect.activationCost.operation) !== "lose"
  )
    lifecycleIssues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Lifecycle deactivation costs must lose the declared resource.",
      ),
    );
  const amountIssue = numericIssue(
    effect.activationCost?.amount,
    sourceDefinitionId,
    effectIndex,
    "activationCost.amount",
  );
  const minimumIssue = numericIssue(
    effect.activationCost?.minimum,
    sourceDefinitionId,
    effectIndex,
    "activationCost.minimum",
  );
  if (amountIssue !== undefined) lifecycleIssues.push(amountIssue);
  if (minimumIssue !== undefined) lifecycleIssues.push(minimumIssue);
  return lifecycleIssues;
};

const rerollIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "reroll" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const storedRollMatchChoice =
    effect.trigger === "on-roll-result" &&
    effect.target === "self" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "stored-roll-match" &&
    effect.conditions[0].roll === effect.roll &&
    effect.conditions[0].natural === true &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.useLimit?.scope === "combat" &&
    effect.activationCost === undefined;
  const beforeDefenseChoice =
    effect.trigger === "before-defense-roll" &&
    effect.target === "opponent" &&
    effect.roll === "attack" &&
    (effect.rerollScope === undefined || effect.rerollScope === "single-result") &&
    effect.scope?.type === "next-rolls" &&
    effect.scope.roll === "attack" &&
    effect.optional === true &&
    effect.conditions === undefined &&
    effect.duration === undefined &&
    effect.activationCost === undefined;
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex).filter(
    (candidate) =>
      !(
        candidate.code === "requires-pending-choice" &&
        ((effect.optional === true && effect.activationGroup === undefined) ||
          storedRollMatchChoice ||
          beforeDefenseChoice)
      ),
  );
  const modifierIssue = numericIssue(
    effect.resultModifier,
    sourceDefinitionId,
    effectIndex,
    "resultModifier",
  );
  const bonusIssue = numericIssue(effect.bonus, sourceDefinitionId, effectIndex, "bonus");
  if (modifierIssue !== undefined) issues.push(modifierIssue);
  if (bonusIssue !== undefined) issues.push(bonusIssue);
  for (const condition of effect.conditions ?? []) {
    if (!(
      (condition.type === "roll-threshold" && condition.roll === effect.roll) ||
      (storedRollMatchChoice &&
        condition.type === "stored-roll-match" &&
        condition.roll === effect.roll &&
        condition.natural === true)
    )) {
      issues.push(
        issue(
          "unsupported-condition",
          sourceDefinitionId,
          effectIndex,
          "Rerolls support only thresholds on the roll being rerolled or an exact stored-roll match.",
        ),
      );
      continue;
    }
    if (condition.type === "roll-threshold") {
      const thresholdIssue = numericIssue(
        condition.value,
        sourceDefinitionId,
        effectIndex,
        "conditions.roll-threshold.value",
      );
      if (thresholdIssue !== undefined) issues.push(thresholdIssue);
    }
  }
  if (
    effect.trigger !== "after-defense-roll" &&
    effect.trigger !== "before-defense-roll" &&
    effect.trigger !== "on-success" &&
    effect.trigger !== "on-roll-result"
  )
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Reroll reactions resolve at a supported defense, roll-result, or successful-attack transition.",
      ),
    );
  if (effect.target !== "self" && effect.target !== "opponent")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Reroll effects must target the source or its opponent.",
      ),
    );
  const deferredScope =
    effect.scope?.type === "next-action" ||
    effect.scope?.type === "next-roll" ||
    effect.scope?.type === "next-rolls";
  if (effect.trigger === "after-defense-roll" && effect.scope !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Consumable future-roll rerolls require a durable active-effect lifecycle.",
      ),
    );
  if (
    effect.trigger === "after-defense-roll" &&
    effect.duration !== undefined &&
    effect.duration.type !== "combat"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "After-defense durable rerolls require combat duration.",
      ),
    );
  if (effect.trigger === "on-success" && !deferredScope)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Successful-attack rerolls require an explicit next-action or next-roll scope.",
      ),
    );
  if (effect.trigger === "on-success" && effect.duration !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Successful-attack rerolls use their deferred scope instead of a separate duration.",
      ),
    );
  if (effect.requiresPriorSourceResult !== undefined && effect.duration?.type !== "combat")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "A prior-source-result reroll must declare combat duration.",
      ),
    );
  if (
    effect.roll === "attack" &&
    effect.rerollScope !== "entire-attack" &&
    !(
      (storedRollMatchChoice || beforeDefenseChoice) &&
      (effect.rerollScope === undefined || runtimeValue(effect.rerollScope) === "single-result")
    )
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Attack rerolls must explicitly replace the entire persisted attack.",
      ),
    );
  if (effect.roll === "defense" && effect.rerollScope === "entire-attack")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Defense rerolls replace one persisted defense result at a time.",
      ),
    );
  if (
    effect.useLimit !== undefined &&
    effect.useLimit.scope !== "combat" &&
    runtimeValue(effect.useLimit.scope) !== "turn"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Reroll reactions support combat or turn use limits only.",
      ),
    );
  if (
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    (effect.exclusiveActivationGroup !== undefined && !storedRollMatchChoice)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "This reroll slice does not approximate activation costs, cooldowns, stacking, or grouped selections.",
      ),
    );
  return issues;
};

const rollAndStoreIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "roll-and-store" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Stored rolls are owned by the source combatant.",
      ),
    );
  if (effect.trigger !== "action-phase" && effect.trigger !== "upkeep-phase")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Stored rolls currently resolve during action or upkeep phases.",
      ),
    );
  if (!Number.isInteger(effect.dice) || effect.dice < 1)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Stored rolls require a positive integer die count.",
      ),
    );
  if (
    typeof effect.sides === "number"
      ? !Number.isInteger(effect.sides) || effect.sides < 1
      : effect.sides.type !== "moveset-move-count"
  )
    issues.push(
      issue(
        "unsupported-numeric-expression",
        sourceDefinitionId,
        effectIndex,
        "Stored-roll sides require a positive integer or moveset move-count expression.",
      ),
    );
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effect.storageKey))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Stored rolls require a stable lowercase hyphenated storage key.",
      ),
    );
  if (
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Stored rolls are immediate keyed state writes without a separate lifecycle.",
      ),
    );
  return issues;
};

const selectMoveByStoredRollIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "select-move-by-stored-roll" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const unsupported = (message: string) =>
    issues.push(issue("unsupported-variant", sourceDefinitionId, effectIndex, message));
  if (effect.target !== "self" || runtimeValue(effect.subject) !== "self")
    unsupported("Stored move selections are owned by the source combatant.");
  if (effect.trigger !== "upkeep-phase")
    unsupported("Stored move selections currently reindex during upkeep only.");
  if (effect.selector.subject !== "source")
    unsupported("Stored move selections require a source-relative move selector.");
  if (runtimeValue(effect.ordering) !== "character-sheet-top-to-bottom")
    unsupported("Stored move selections require character-sheet ordering.");
  if (runtimeValue(effect.reindex) !== "on-moveset-change")
    unsupported("Stored move selections require moveset-change reindexing.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effect.storageKey))
    unsupported("Stored move selections require a stable lowercase hyphenated roll key.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(effect.selectionKey))
    unsupported("Stored move selections require a stable lowercase hyphenated selection key.");
  if (
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    unsupported(
      "Stored move selections are immediate keyed state writes without a separate lifecycle.",
    );
  return issues;
};

const applyStatusIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "apply-status" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (
    effect.duration !== undefined &&
    effect.duration.type !== "combat" &&
    effect.duration.type !== "turns" &&
    effect.duration.type !== "until-turn-start-roll-threshold"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Status duration ${effect.duration.type} has no active-status lifecycle executor.`,
      ),
    );
  return issues;
};

const grantCombatOutcomeIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-combat-outcome" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const kiBarbsVariant =
    sourceDefinitionId === "move-kiihakai-ki-barbs" &&
    effectIndex === 2 &&
    effect.trigger === "on-power-up" &&
    effect.target === "opponent" &&
    effect.outcome === "stun" &&
    effect.requireAllDiceSuccess === true &&
    effect.selector?.subject === "source" &&
    effect.selector.categories?.length === 2 &&
    effect.selector.categories.includes("advanced-attack") &&
    effect.selector.categories.includes("signature") &&
    effect.selector.attackRoll?.minimumDice === 2 &&
    effect.scope?.type === "next-turn" &&
    effect.scope.subject === "self";
  if (kiBarbsVariant) return issues;
  if (effect.trigger !== "on-success" || effect.target !== "opponent")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Combat outcomes currently apply only to the opponent after the source attack succeeds.",
      ),
    );
  if (
    effect.selector !== undefined ||
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    effect.requireAllDiceSuccess !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Combat outcomes currently resolve as one immediate current-attack status without selection or a separate lifecycle.",
      ),
    );
  return issues;
};

const revertTransformationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "revert-transformation" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.trigger !== "on-success")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Transformation reversion currently resolves only from a successful attack.",
      ),
    );
  if (effect.target !== "opponent")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Transformation reversion currently targets the opponent only.",
      ),
    );
  if (
    effect.conditions?.length !== 2 ||
    !effect.conditions.some(
      (condition) =>
        condition.type === "combat-state" &&
        condition.subject === "opponent" &&
        runtimeValue(condition.state) === "transformed",
    ) ||
    !effect.conditions.some(
      (condition) =>
        condition.type === "roll-threshold" &&
        condition.roll === "attack" &&
        condition.comparison === "at-least" &&
        condition.value.type === "literal",
    )
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Transformation reversion requires an opponent transformed-state condition and an attack-roll threshold.",
      ),
    );
  return issues;
};

type GrantCounterActionDefinition = Extract<
  RegisteredEffectDefinition,
  { readonly type: "grant-counter-action" }
>;

const grantCounterUnsupported = (
  sourceDefinitionId: string,
  effectIndex: number,
  message: string,
) => issue("unsupported-variant", sourceDefinitionId, effectIndex, message);

const validGrantCounterMoveSelectorCondition = (
  condition: Extract<EffectCondition, { readonly type: "move-selector" }>,
) =>
  condition.subject === "target" &&
  condition.category === "advanced-attack" &&
  condition.restriction === "unrestricted" &&
  condition.attackRoll?.dice === 1 &&
  Object.keys(condition.attackRoll ?? {}).every((key) => key === "dice");

const validGrantCounterRollThresholdCondition = (
  condition: Extract<EffectCondition, { readonly type: "roll-threshold" }>,
) =>
  condition.roll === "defense" &&
  condition.comparison === "at-least" &&
  condition.value.type === "literal" &&
  condition.value.value === 25;

const validGrantCounterChooseConditions = (effect: GrantCounterActionDefinition) =>
  (effect.conditions ?? []).every((condition) => {
    if (condition.type === "move-selector")
      return validGrantCounterMoveSelectorCondition(condition);
    if (condition.type === "roll-threshold")
      return validGrantCounterRollThresholdCondition(condition);
    return false;
  });

const validGrantCounterRepeatCondition = (effect: GrantCounterActionDefinition) => {
  const condition = effect.conditions?.[0];
  return (
    effect.trigger === "on-success" &&
    effect.conditions?.length === 1 &&
    condition?.type === "action-sequence" &&
    condition.actor === "opponent" &&
    condition.result === "successful" &&
    condition.count === 2 &&
    condition.withoutResultBy?.actor === "self" &&
    condition.withoutResultBy.result === "stopped"
  );
};

const grantCounterUseLimitIssues = (
  effect: GrantCounterActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.useLimit === undefined) return [];
  const count = effect.useLimit.count;
  const validCount =
    typeof count === "number"
      ? Number.isInteger(count) && count >= 1
      : count.type === "literal" && Number.isInteger(count.value) && count.value >= 1;
  return [
    ...(effect.useLimit.scope === "combat"
      ? []
      : [
          grantCounterUnsupported(
            sourceDefinitionId,
            effectIndex,
            "Counter-action use limits support combat scope only.",
          ),
        ]),
    ...(validCount
      ? []
      : [
          grantCounterUnsupported(
            sourceDefinitionId,
            effectIndex,
            "Counter-action use limits require a positive literal count.",
          ),
        ]),
  ];
};

const grantCounterCostIssues = (
  effect: GrantCounterActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.costModifier === undefined) return [];
  const amountIssue = numericIssue(
    effect.costModifier.amount,
    sourceDefinitionId,
    effectIndex,
    "costModifier.amount",
  );
  const minimumIssue = numericIssue(
    effect.costModifier.minimum,
    sourceDefinitionId,
    effectIndex,
    "costModifier.minimum",
  );
  return [
    ...(amountIssue === undefined ? [] : [amountIssue]),
    ...(minimumIssue === undefined ? [] : [minimumIssue]),
    ...(effect.action === "repeat-triggering-attack" && effect.costModifier.operation === "add"
      ? []
      : [
          grantCounterUnsupported(
            sourceDefinitionId,
            effectIndex,
            "Counter-action cost modifiers support additive repeat attacks only.",
          ),
        ]),
  ];
};

/* eslint-disable sonarjs/cognitive-complexity -- counter validation preserves payment and lifecycle boundaries. */
const grantCounterActionIssues = (
  effect: GrantCounterActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.target !== "self")
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Counter actions currently target self.",
      ),
    );
  if (effect.action === "use-source-attack")
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Using a source attack requires a serialized source-action selection.",
      ),
    );
  if (effect.action === "repeat-triggering-attack" && !validGrantCounterRepeatCondition(effect))
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Repeat-triggering counter actions require one on-success action-sequence condition.",
      ),
    );
  if (effect.action === "choose-attack" && effect.trigger !== "after-defense-roll")
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Choose-attack counter actions require an after-defense-roll trigger.",
      ),
    );
  if (effect.action === "choose-attack" && !validGrantCounterChooseConditions(effect))
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Choose-attack counter actions support move-selector or roll-threshold conditions.",
      ),
    );
  const activationAmountIssue = numericIssue(
    effect.activationCost?.amount,
    sourceDefinitionId,
    effectIndex,
    "activationCost.amount",
  );
  const activationMinimumIssue = numericIssue(
    effect.activationCost?.minimum,
    sourceDefinitionId,
    effectIndex,
    "activationCost.minimum",
  );
  if (activationAmountIssue !== undefined) issues.push(activationAmountIssue);
  if (activationMinimumIssue !== undefined) issues.push(activationMinimumIssue);
  if (effect.activationCost?.resource !== undefined && effect.activationCost.resource !== "ki")
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Counter-action activation costs support KI only.",
      ),
    );
  issues.push(...grantCounterUseLimitIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...grantCounterCostIssues(effect, sourceDefinitionId, effectIndex));
  if (
    effect.duration !== undefined &&
    !(sourceDefinitionId === "move-aoyosumu-straightjacket" && effectIndex === 0)
  )
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Counter-action duration requires a persistent counter-permission lifecycle and remains unsupported.",
      ),
    );
  if (
    conflictPolicyType(effect) !== undefined &&
    !(sourceDefinitionId === "move-aoyosumu-straightjacket" && effectIndex === 0)
  )
    issues.push(
      grantCounterUnsupported(
        sourceDefinitionId,
        effectIndex,
        "Counter-action stacking is supported only with a persistent counter-permission lifecycle.",
      ),
    );
  return issues;
};
/* eslint-enable sonarjs/cognitive-complexity */

type SkipActionDefinition = Extract<RegisteredEffectDefinition, { readonly type: "skip-action" }>;

type StopAttackByDeactivationDefinition = Extract<
  RegisteredEffectDefinition,
  { readonly type: "stop-attack-by-deactivation" }
>;

type SubstituteDefenseDefinition = Extract<
  RegisteredEffectDefinition,
  { readonly type: "substitute-defense" }
>;

const substituteDefenseIssues = (
  effect: SubstituteDefenseDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const exactVariant =
    effect.trigger === "before-defense-roll" &&
    effect.target === "self" &&
    runtimeValue(effect.payment.resource) === "hp" &&
    effect.payment.amount.type === "resource-percent" &&
    effect.payment.amount.subject === "self" &&
    effect.payment.amount.resource === "hp" &&
    effect.payment.amount.basis === "total" &&
    effect.payment.amount.percent === 10 &&
    effect.selector.subject === "target" &&
    effect.selector.tags?.length === 1 &&
    effect.selector.tags[0] === "energy" &&
    effect.selector.categoryExcludes?.length === 1 &&
    effect.selector.categoryExcludes[0] === "signature" &&
    runtimeValue(effect.outcome) === "stop" &&
    effect.optional === true;
  return exactVariant
    ? commonIssues(effect, sourceDefinitionId, effectIndex)
    : [
        ...commonIssues(effect, sourceDefinitionId, effectIndex),
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Substitute-defense supports only the exact optional 10% total-HP payment to stop a non-Signature energy attack.",
        ),
      ];
};

const stopAttackByDeactivationIssues = (
  effect: StopAttackByDeactivationDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const exactVariant =
    effect.trigger === "before-defense-roll" &&
    effect.target === "self" &&
    effect.optional === true &&
    effect.sacrificedMove.subject === "source" &&
    effect.sacrificedMove.category === "skill" &&
    effect.sacrificedMove.constant === true &&
    effect.attack.subject === "target" &&
    effect.attack.categoryExcludes?.length === 1 &&
    effect.attack.categoryExcludes[0] === "signature" &&
    runtimeValue(effect.lockDuration.type) === "combat";
  return exactVariant
    ? commonIssues(effect, sourceDefinitionId, effectIndex)
    : [
        ...commonIssues(effect, sourceDefinitionId, effectIndex),
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Stop-attack-by-deactivation supports only the exact optional self CONSTANT Skill sacrifice against a non-Signature attack with a combat lock.",
        ),
      ];
};

const skipActionTriggerTargetIssues = (
  effect: SkipActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  if (
    effect.trigger !== "action-phase" &&
    effect.trigger !== "on-success" &&
    effect.trigger !== "before-attack-roll" &&
    effect.trigger !== "on-roll-result" &&
    effect.trigger !== "turn-end"
  )
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        `Action restrictions do not support trigger ${effect.trigger}.`,
      ),
    );
  if (effect.target !== "self" && effect.target !== "opponent")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Action restrictions require one self or opponent target.",
      ),
    );
  return issues;
};

// Lifecycle validation keeps the persisted action-restriction contract together.
const skipActionLifecycleIssues = (
  effect: SkipActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, sonarjs/cognitive-complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues: EffectCompilationIssue[] = [];
  if (effect.trigger === "action-phase") {
    if (effect.scope !== undefined || effect.duration !== undefined)
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Action-phase skip choices support only an immediate full-action restriction.",
        ),
      );
    return issues;
  }
  const nextTurnScope = effect.scope?.type === "next-turn";
  const thresholdDuration = effect.duration?.type === "until-turn-start-roll-threshold";
  const turnsDuration = effect.duration?.type === "turns";
  if (
    (!nextTurnScope && !turnsDuration && !thresholdDuration) ||
    (nextTurnScope && (turnsDuration || thresholdDuration))
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Action restrictions require exactly one next-turn scope or turns duration.",
      ),
    );
  if (effect.scope !== undefined && !nextTurnScope)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Action restriction scope ${effect.scope.type} is not supported.`,
      ),
    );
  if (nextTurnScope && effect.scope.subject !== effect.target)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Action restriction next-turn subject must match its target.",
      ),
    );
  if (effect.duration !== undefined && !turnsDuration && !thresholdDuration)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Action restriction duration ${effect.duration.type} is not supported.`,
      ),
    );
  if (turnsDuration) {
    const turns = effect.duration.turns;
    if (turns.type !== "literal" || !Number.isInteger(turns.value) || turns.value < 1)
      issues.push(
        issue(
          "unsupported-numeric-expression",
          sourceDefinitionId,
          effectIndex,
          "Action restriction turn durations require a positive literal integer.",
        ),
      );
  }
  if (thresholdDuration) {
    const duration = effect.duration;
    if (
      duration.dice < 1 ||
      duration.sides < 1 ||
      duration.value.type !== "literal" ||
      !Number.isFinite(duration.value.value) ||
      duration.value.value < 0
    )
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Turn-start action restrictions require a positive roll definition and finite literal threshold.",
        ),
      );
  }
  return issues;
};

const skipActionCategoryIssues = (
  effect: SkipActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const categories = effect.blockedCategories;
  if (categories === undefined) return [];
  const allowedCategories = new Set(["basic-attack", "advanced-attack", "signature"]);
  return categories.length > 0 &&
    new Set(categories).size === categories.length &&
    categories.every((category) => allowedCategories.has(category))
    ? []
    : [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Action restriction categories must be unique recognized attack categories.",
        ),
      ];
};

const skipActionIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "skip-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...skipActionTriggerTargetIssues(effect, sourceDefinitionId, effectIndex),
  ...skipActionLifecycleIssues(effect, sourceDefinitionId, effectIndex),
  ...skipActionCategoryIssues(effect, sourceDefinitionId, effectIndex),
];

const modifyRemainingUsesIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-remaining-uses" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Restricted-use limit changes currently target the owning combatant only.",
      ),
    );
  if (
    effect.amount.type !== "literal" ||
    !Number.isInteger(effect.amount.value) ||
    effect.amount.value < 1
  )
    issues.push(
      issue(
        "unsupported-numeric-expression",
        sourceDefinitionId,
        effectIndex,
        "Restricted-use limit changes require a positive literal integer amount.",
      ),
    );
  if (effect.scope !== undefined || effect.duration !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Restricted-use limit changes are combat-local and cannot declare a separate scope or duration.",
      ),
    );
  if (effect.selector.ids?.length !== 1)
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Restricted-use limit changes require one exact move ID; broader selectors require a serialized move choice.",
      ),
    );
  return issues;
};

const supportedClassificationTags = new Set(
  Object.values(ATTACK_TAG).map((tag) => tag.toUpperCase()),
);

// The exact move-removal variants share one compiler boundary.
const removeMoveFromCombatIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "remove-move-from-combat" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity, max-lines-per-function, sonarjs/cognitive-complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const beforeDefenseSacrificeRemoval =
    effect.trigger === "before-defense-roll" &&
    effect.target === "self" &&
    effect.move === "source" &&
    effect.selector?.subject === "source" &&
    effect.selector.ids?.length === 1 &&
    effect.activationCost?.resource === "ki" &&
    runtimeValue(effect.activationCost.operation) === "lose" &&
    effect.activationCost.amount.type === "source-move-ki-cost" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-selector" &&
    effect.conditions[0].subject === "target" &&
    effect.conditions[0].category === "advanced-attack" &&
    effect.conditions[0].categoryExcludes?.includes("signature") === true &&
    effect.conditions[0].tags?.includes("beam") === true;
  if (beforeDefenseSacrificeRemoval) return issues;
  const selectedTemporaryTargetRemoval =
    effect.trigger === "on-success" &&
    effect.target === "opponent" &&
    effect.move === "target" &&
    effect.selector !== undefined &&
    effect.duration?.type === "until-perfect-roll" &&
    effect.conditions === undefined &&
    effect.scope === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    staticSelectionLimit(effect) === undefined;
  const selectedPermanentTargetRemoval =
    effect.trigger === "action-phase" &&
    effect.target === "opponent" &&
    effect.move === "target" &&
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "move-selector" &&
    effect.conditions[0].subject === "target" &&
    effect.conditions[0].category === "skill" &&
    effect.conditions[0].constant === false &&
    effect.scope === undefined &&
    effect.duration === undefined &&
    effect.activationCost === undefined &&
    effect.useLimit === undefined &&
    effect.cooldown === undefined &&
    staticSelectionLimit(effect) === undefined;
  if (selectedPermanentTargetRemoval) {
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Target move removal is resolved through a serialized move selection before creating a permanent combat-local removal.",
      ),
    );
    return issues;
  }
  if (selectedTemporaryTargetRemoval) {
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Target move removal is resolved through a serialized move selection before creating its temporary removal effect.",
      ),
    );
    return issues;
  }
  if (effect.trigger !== "action-phase" && effect.trigger !== "on-success")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Move removal currently resolves from action-phase or on-success transitions only.",
      ),
    );
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Automatic move removal currently targets the source combatant only.",
      ),
    );
  if (effect.move !== "source")
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Removing a target move requires a serialized move selection before execution.",
      ),
    );
  if (effect.selector !== undefined)
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Selector-scoped move removal requires a serialized move selection before execution.",
      ),
    );
  if (effect.scope !== undefined && effect.scope.type !== "next-turn")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move removal does not support a separate scope in this combat-local executor slice.",
      ),
    );
  if (effect.duration !== undefined && effect.duration.type !== "combat")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Move-removal duration ${effect.duration.type} requires a restoration lifecycle that is not yet serialized.`,
      ),
    );
  if (
    effect.optional === true ||
    effect.activationCost !== undefined ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    staticSelectionLimit(effect) !== undefined
  )
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Optional or activation-cost move removal requires a serialized selection and payment frame.",
      ),
    );
  return issues;
};

const modifyMoveClassificationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-move-classification" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const currentActionTags =
    effect.trigger === "passive" &&
    effect.target === "self" &&
    effect.scope?.type === "current-action" &&
    effect.duration === undefined &&
    effect.addTags !== undefined &&
    effect.addTags.length > 0 &&
    effect.addTags.every((tag) => supportedClassificationTags.has(tag.toUpperCase())) &&
    effect.setStyleId === undefined &&
    effect.replaceStyle === undefined &&
    effect.selector === undefined;
  const durableSelector = (() => {
    const selector = effect.selector;
    if (selector === undefined) return false;
    return (
      runtimeValue(selector.type) === "move-selector" &&
      selector.subject === "source" &&
      selector.styleId === "style-freestyle" &&
      Object.keys(selector).every((key) =>
        ["type", "subject", "styleId", "sourceText"].includes(key),
      )
    );
  })();
  const durableDeclaredStyle =
    effect.trigger === "on-success" &&
    effect.target === "self" &&
    effect.scope === undefined &&
    effect.replaceStyle === "declared-style" &&
    effect.addTags === undefined &&
    effect.setStyleId === undefined &&
    durableSelector &&
    effect.duration?.type === "turns" &&
    effect.duration.turns.type === "literal" &&
    effect.duration.turns.value === 4;
  const startCombatStyleSelection =
    effect.trigger === "start-combat" &&
    effect.target === "self" &&
    effect.setStyleId === "style-akaikaru" &&
    effect.replaceStyle === undefined &&
    effect.addTags === undefined &&
    effect.duration === undefined &&
    durableSelector;
  if (!currentActionTags && !durableDeclaredStyle && !startCombatStyleSelection)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move classification supports current-action additive tags or the exact four-turn declared-style replacement.",
      ),
    );
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Move classification applies to the source combatant only.",
      ),
    );
  if (
    effect.conditions !== undefined ||
    effect.requirements !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    staticSelectionLimit(effect) !== undefined ||
    effect.cooldown !== undefined ||
    conflictPolicyType(effect) !== undefined ||
    effect.exclusiveActivationGroup !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Conditional, limited, paid, or exclusive classification requires additional lifecycle state.",
      ),
    );
  return issues;
};

const preventResourceModificationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "prevent-resource-modification" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.sourceActor !== undefined && runtimeValue(effect.sourceActor) !== "opponent")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Resource prevention source actor ${effect.sourceActor} is not supported.`,
      ),
    );
  if (effect.exceptAction !== undefined && runtimeValue(effect.exceptAction) !== "power-up")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Resource prevention exception ${effect.exceptAction} is not supported.`,
      ),
    );
  if (effect.scope !== undefined && effect.scope.type !== "next-turn")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Resource prevention scope ${effect.scope.type} requires a turn-scheduling lifecycle.`,
      ),
    );
  if (
    effect.duration !== undefined &&
    !["combat", "turns", "until-combat-result"].includes(effect.duration.type)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Resource prevention duration ${effect.duration.type} is not supported by this executor slice.`,
      ),
    );
  if (effect.duration?.type === "turns") {
    const durationIssue = numericIssue(
      effect.duration.turns,
      sourceDefinitionId,
      effectIndex,
      "duration.turns",
    );
    if (durationIssue !== undefined) issues.push(durationIssue);
  }
  return issues;
};

const floatingDurationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const duration = effect.duration;
  if (duration === undefined || duration.type === "combat") return [];
  if (duration.type === "until-roll-threshold") {
    const valueIssue = numericIssue(
      duration.value,
      sourceDefinitionId,
      effectIndex,
      "duration.value",
    );
    return [
      ...(valueIssue === undefined ? [] : [valueIssue]),
      ...(duration.roll === "attack" || duration.roll === "defense"
        ? []
        : [
            issue(
              "unsupported-variant",
              sourceDefinitionId,
              effectIndex,
              "Floating-effect roll-threshold duration supports attack or defense rolls only.",
            ),
          ]),
    ];
  }
  if (duration.type !== "until-combat-result")
    return [
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Floating-effect duration ${duration.type} requires a persisted termination transition.`,
      ),
    ];
  const thresholdConditions = (duration.conditions ?? []).filter(
    (condition) => condition.type === "roll-threshold",
  );
  const invalidThreshold =
    (duration.conditions ?? []).some((condition) => condition.type !== "roll-threshold") ||
    thresholdConditions.length > 1 ||
    (runtimeValue(thresholdConditions[0]) !== undefined &&
      (thresholdConditions[0].roll === "transformation" ||
        thresholdConditions[0].value.type !== "literal"));
  return [
    ...(duration.result === "successful" || duration.result === "stopped"
      ? []
      : [
          issue(
            "unsupported-variant",
            sourceDefinitionId,
            effectIndex,
            `Floating-effect combat result ${duration.result} is not available at the attack transition boundary.`,
          ),
        ]),
    ...(invalidThreshold
      ? [
          issue(
            "unsupported-variant",
            sourceDefinitionId,
            effectIndex,
            "Floating-effect combat-result duration supports one literal attack or defense roll threshold.",
          ),
        ]
      : []),
  ];
};

const floatingActivationCostIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  for (const [value, path] of [
    [effect.activationCost?.amount, "activationCost.amount"],
    [effect.activationCost?.minimum, "activationCost.minimum"],
  ] as const) {
    const numeric = numericIssue(value, sourceDefinitionId, effectIndex, path);
    if (numeric !== undefined) issues.push(numeric);
  }
  if (
    effect.activationCost !== undefined &&
    (effect.trigger !== "upkeep-phase" || effect.target !== "self")
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Floating-effect activation costs are supported only for self-targeted upkeep effects.",
      ),
    );
  return issues;
};

const floatingUseLimitIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  if (effect.useLimit === undefined) return [];
  const countIssue =
    typeof effect.useLimit.count === "number"
      ? undefined
      : numericIssue(effect.useLimit.count, sourceDefinitionId, effectIndex, "useLimit.count");
  const hasUnsupportedLifecycle = floatingUseLimitHasUnsupportedLifecycle(
    effect,
    floatingUseLimitIsSingle(effect.useLimit),
  );
  return [
    ...(countIssue === undefined ? [] : [countIssue]),
    ...(hasUnsupportedLifecycle
      ? [
          issue(
            "unsupported-variant",
            sourceDefinitionId,
            effectIndex,
            "Floating-effect use limits support one combat-scoped creation without a separate expiry.",
          ),
        ]
      : []),
  ];
};

const floatingUseLimitIsSingle = (
  useLimit: NonNullable<
    Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>["useLimit"]
  >,
) =>
  typeof useLimit.count === "number"
    ? useLimit.count === 1
    : useLimit.count.type === "literal" && useLimit.count.value === 1;

const floatingUseLimitHasUnsupportedLifecycle = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>,
  isSingle: boolean,
  // eslint-disable-next-line complexity -- Effect validation intentionally enumerates supported declarative variants.
) => {
  const useLimit = effect.useLimit;
  if (useLimit === undefined) return false;
  if (useLimit.scope === "combat")
    return (
      !isSingle ||
      (effect.scope !== undefined &&
        effect.scope.type !== "combat" &&
        effect.scope.type !== "next-action") ||
      effect.duration !== undefined ||
      (effect.termination?.length ?? 0) > 0
    );
  return (
    !isSingle ||
    (effect.scope !== undefined &&
      effect.scope.type !== "combat" &&
      effect.scope.type !== "next-action" &&
      effect.scope.type !== "next-turn") ||
    effect.duration?.type !== "until-roll-threshold"
  );
};

const floatingNestedEffectIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  (effect.effects ?? []).flatMap((nestedEffect, nestedIndex) => {
    if (nestedEffect.type === "create-floating-effect")
      return [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          `Nested floating effect ${nestedIndex} is not supported; floating bundles must be flat.`,
        ),
      ];
    if (
      nestedEffect.type === "modify-resource" &&
      (nestedEffect.amount === undefined ||
        nestedEffect.cap !== undefined ||
        nestedEffect.prevention !== undefined ||
        nestedEffect.exclusions !== undefined)
    )
      return [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          `Nested effect ${nestedIndex}: resource modifiers with omitted amounts, caps, prevention, or exclusions are not represented by the floating lifecycle.`,
        ),
      ];
    const nestedCompilation = compileEffectPlan({
      sourceDefinitionId,
      effectIndex: nestedIndex,
      effect: nestedEffect,
      allowFloatingOnMoveUse: true,
    });
    return nestedCompilation.ok
      ? []
      : nestedCompilation.issues.map((nestedIssue) =>
          issue(
            nestedIssue.code,
            sourceDefinitionId,
            effectIndex,
            `Nested effect ${nestedIndex}: ${nestedIssue.message}`,
          ),
        );
  });

function createFloatingIssues(
  effect: Extract<RegisteredEffectDefinition, { readonly type: "create-floating-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const scope = effect.scope?.type;
  if (scope !== undefined && !["combat", "next-action", "next-turn"].includes(scope))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Floating-effect scope ${scope} does not have a durable combat representation.`,
      ),
    );
  issues.push(...floatingDurationIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...floatingActivationCostIssues(effect, sourceDefinitionId, effectIndex));
  issues.push(...floatingUseLimitIssues(effect, sourceDefinitionId, effectIndex));
  if (effect.cooldown !== undefined || staticSelectionLimit(effect) !== undefined)
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Floating-effect cooldowns and selections require a serialized lifecycle decision.",
      ),
    );
  if (
    effect.termination?.some(
      (termination) => termination.trigger === "on-power-up" && termination.selector !== undefined,
    )
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Power-up floating-effect termination cannot evaluate a move selector without a triggering move.",
      ),
    );
  issues.push(...floatingNestedEffectIssues(effect, sourceDefinitionId, effectIndex));
  return issues;
}

const endFloatingIssues = (
  effect: Extract<EffectDefinition, { readonly type: "end-floating-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const exactCondition =
    effect.conditions?.length === 1 &&
    effect.conditions[0]?.type === "combat-result" &&
    effect.conditions[0].actor === "self" &&
    effect.conditions[0].result === "successful";
  if (
    effect.trigger !== "on-success" ||
    effect.target !== "opponent" ||
    effect.selector !== "any" ||
    !exactCondition
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Ending floating effects supports only an optional successful self attack that selects any one opponent floating effect.",
      ),
    );
  if (
    effect.trigger === "on-success" &&
    effect.target === "opponent" &&
    effect.selector === "any" &&
    exactCondition
  )
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Ending a floating effect requires a serialized selection of the active bundle to terminate.",
      ),
    );
  return issues;
};

type ScheduleEffectDefinition = Extract<
  RegisteredEffectDefinition,
  { readonly type: "schedule-effect" }
>;

const scheduleNumericIssues = (
  effect: ScheduleEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  const candidates: readonly [NumericExpression | undefined, string][] = [
    [effect.effect.amount, "amount"],
    [effect.duration?.type === "turns" ? effect.duration.turns : undefined, "duration.turns"],
    [
      effect.duration?.type === "until-roll-threshold" ? effect.duration.value : undefined,
      "duration.value",
    ],
    [effect.cancellation?.rollThreshold?.value, "cancellation.rollThreshold.value"],
  ];
  for (const [expression, path] of candidates) {
    const numeric = numericIssue(expression, sourceDefinitionId, effectIndex, path);
    if (numeric !== undefined) issues.push(numeric);
  }
  return issues;
};

const scheduleAmountIssues = (
  effect: ScheduleEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const { amount } = effect.effect;
  if (!isDurableScheduledAmount(amount))
    return [
      issue(
        "unsupported-numeric-expression",
        sourceDefinitionId,
        effectIndex,
        `Scheduled amount uses non-durable numeric expression ${amount.type}.`,
      ),
    ];
  const value = amount.type === "literal" ? amount.value : amount.percent;
  return value >= 0
    ? []
    : [
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Scheduled resource amounts must be nonnegative.",
        ),
      ];
};

const scheduleTimingIssues = (
  effect: ScheduleEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  if (!Number.isInteger(effect.timing.turnsAfter) || effect.timing.turnsAfter < 0)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Scheduled timing requires a nonnegative integer turnsAfter value.",
      ),
    );
  const phaseShapeIsInvalid =
    (effect.timing.type === "phase-start") !== (effect.timing.phase !== undefined);
  if (phaseShapeIsInvalid)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Scheduled phase timing must declare a phase only for phase-start work.",
      ),
    );
  if (effect.timing.type === "phase-start" && effect.timing.phase !== "upkeep")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "The generic scheduler currently supports upkeep phase-start work only.",
      ),
    );
  return issues;
};

const scheduleLifecycleIssues = (
  effect: ScheduleEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  if (effect.effect.operation === "damage" && effect.effect.resource !== "hp")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Scheduled damage must target HP.",
      ),
    );
  if (
    effect.duration !== undefined &&
    effect.duration.type !== "turns" &&
    effect.duration.type !== "until-roll-threshold"
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Scheduled duration ${effect.duration.type} is not represented by the scheduler.`,
      ),
    );
  if (effect.duration?.type === "until-roll-threshold" && effect.duration.roll === "transformation")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Transformation-roll schedule expiry requires a transformation-roll transition.",
      ),
    );
  if (effect.cancellation?.rollThreshold?.roll === "transformation")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Transformation-roll schedule cancellation requires a transformation-roll transition.",
      ),
    );
  return issues;
};

const scheduleEffectIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "schedule-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => [
  ...commonIssues(effect, sourceDefinitionId, effectIndex),
  ...scheduleNumericIssues(effect, sourceDefinitionId, effectIndex),
  ...scheduleAmountIssues(effect, sourceDefinitionId, effectIndex),
  ...scheduleTimingIssues(effect, sourceDefinitionId, effectIndex),
  ...scheduleLifecycleIssues(effect, sourceDefinitionId, effectIndex),
];

const createExecutor = <T extends RegisteredEffectDefinition>(
  type: T["type"],
  validate: EffectExecutor<T>["validate"] = genericIssues,
): EffectExecutor<T> => ({
  type,
  validate,
  compile: (effect, sourceDefinitionId, effectIndex) => ({
    type: effect.type,
    sourceDefinitionId,
    effectIndex,
    definition: effect,
  }),
  execute: (effect, context) => ({
    type: "declarative-effect",
    sourceDefinitionId: effect.sourceDefinitionId,
    effectIndex: effect.effectIndex,
    target: context.target,
    effect: effect.definition,
  }),
});

export const effectExecutorRegistry = {
  activate: createExecutor("activate", activateIssues),
  "activate-protected-constant": createExecutor(
    "activate-protected-constant",
    activateProtectedConstantIssues,
  ),
  "apply-status": createExecutor("apply-status", applyStatusIssues),
  "copy-move-effect": createExecutor("copy-move-effect", copyMoveEffectIssues),
  "copy-move-effects": createExecutor("copy-move-effects", copyMoveEffectsIssues),
  "defer-move": createExecutor("defer-move", deferMoveIssues),
  "create-floating-effect": createExecutor("create-floating-effect", createFloatingIssues),
  "end-floating-effect": createExecutor("end-floating-effect", endFloatingIssues),
  deactivate: createExecutor("deactivate", deactivateIssues),
  "force-action": createExecutor("force-action"),
  "grant-combat-outcome": createExecutor("grant-combat-outcome", grantCombatOutcomeIssues),
  "grant-destruction-mastery": createExecutor(
    "grant-destruction-mastery",
    (effect, sourceDefinitionId, effectIndex) =>
      residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
  "grant-counter-action": createExecutor("grant-counter-action", grantCounterActionIssues),
  "grant-transformation-action": createExecutor(
    "grant-transformation-action",
    grantTransformationActionIssues,
  ),
  lock: createExecutor("lock", lockIssues),
  "modify-cost": createExecutor("modify-cost", modifyCostIssues),
  "modify-cost-modifier": createExecutor("modify-cost-modifier", modifyCostModifierIssues),
  "modify-combat-outcome": createExecutor("modify-combat-outcome"),
  "modify-critical-threshold": createExecutor(
    "modify-critical-threshold",
    modifyCriticalThresholdIssues,
  ),
  "modify-damage": createExecutor("modify-damage", modifyDamageIssues),
  "modify-damage-modifier": createExecutor("modify-damage-modifier", modifyDamageModifierIssues),
  "modify-move-classification": createExecutor(
    "modify-move-classification",
    modifyMoveClassificationIssues,
  ),
  "modify-remaining-uses": createExecutor("modify-remaining-uses", modifyRemainingUsesIssues),
  "modify-resource": createExecutor("modify-resource", modifyResourceIssues),
  "modify-resource-cost": createExecutor("modify-resource-cost", modifyResourceCostIssues),
  "modify-resource-modifier": createExecutor(
    "modify-resource-modifier",
    modifyResourceModifierIssues,
  ),
  "grant-extra-action": createExecutor("grant-extra-action", grantExtraActionIssues),
  "modify-roll": createExecutor("modify-roll", modifyRollIssues),
  "modify-roll-modifier": createExecutor("modify-roll-modifier", modifyRollModifierIssues),
  "modify-slot-capacity": createExecutor("modify-slot-capacity", modifySlotCapacityIssues),
  "modify-stat": createExecutor("modify-stat", modifyStatIssues),
  negate: createExecutor("negate", negateIssues),
  "negate-deactivation": createExecutor("negate-deactivation", negateDeactivationIssues),
  "force-transformation": createExecutor("force-transformation", forceTransformationIssues),
  "reactivate-recent-skill": createExecutor("reactivate-recent-skill", reactivationRecentIssues),
  "reactivate-deactivated-constant-skill": createExecutor(
    "reactivate-deactivated-constant-skill",
    reactivationDeactivatedIssues,
  ),
  "replace-active-constant-effects": createExecutor(
    "replace-active-constant-effects",
    replaceActiveConstantEffectsIssues,
  ),
  "replace-move-effect": createExecutor("replace-move-effect", replaceMoveEffectIssues),
  "remove-move-from-combat": createExecutor("remove-move-from-combat", removeMoveFromCombatIssues),
  "override-resolution-immunity": createExecutor(
    "override-resolution-immunity",
    (effect, sourceDefinitionId, effectIndex) =>
      residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
  "revert-transformation": createExecutor("revert-transformation", revertTransformationIssues),
  "prevent-combat-result": createExecutor("prevent-combat-result"),
  "prevent-low-roll-stop": createExecutor("prevent-low-roll-stop", preventLowRollStopIssues),
  "prevent-move-modification": createExecutor(
    "prevent-move-modification",
    preventMoveModificationIssues,
  ),
  "prevent-move-use": createExecutor("prevent-move-use"),
  "prevent-resource-modification": createExecutor(
    "prevent-resource-modification",
    preventResourceModificationIssues,
  ),
  "prevent-resolution": createExecutor("prevent-resolution"),
  "prevent-roll-modification": createExecutor("prevent-roll-modification"),
  "prevent-status": createExecutor("prevent-status"),
  "override-skill-activation-prevention": createExecutor(
    "override-skill-activation-prevention",
    overrideSkillActivationPreventionIssues,
  ),
  "require-all-dice-success": createExecutor(
    "require-all-dice-success",
    requireAllDiceSuccessIssues,
  ),
  reroll: createExecutor("reroll", rerollIssues),
  "roll-and-store": createExecutor("roll-and-store", rollAndStoreIssues),
  "select-move-by-stored-roll": createExecutor(
    "select-move-by-stored-roll",
    selectMoveByStoredRollIssues,
  ),
  "schedule-effect": createExecutor("schedule-effect", scheduleEffectIssues),
  "set-combat-result": createExecutor("set-combat-result", setCombatResultIssues),
  "set-resolution-threshold": createExecutor("set-resolution-threshold", resolutionThresholdIssues),
  "set-stat-comparison": createExecutor("set-stat-comparison", setStatComparisonIssues),
  "set-roll-definition": createExecutor("set-roll-definition"),
  "set-roll-result": createExecutor("set-roll-result", setRollResultIssues),
  "set-roll-selection": createExecutor("set-roll-selection", setRollSelectionIssues),
  "skip-action": createExecutor("skip-action", skipActionIssues),
  "stop-attack-by-deactivation": createExecutor(
    "stop-attack-by-deactivation",
    stopAttackByDeactivationIssues,
  ),
  "substitute-defense": createExecutor("substitute-defense", substituteDefenseIssues),
  suppress: createExecutor("suppress", suppressIssues),
  "suppress-requirement": createExecutor(
    "suppress-requirement",
    (effect, sourceDefinitionId, effectIndex) =>
      residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
  "exchange-constant-skill": createExecutor(
    "exchange-constant-skill",
    (effect, sourceDefinitionId, effectIndex) =>
      residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
  "modify-damage-reduction-cost": createExecutor(
    "modify-damage-reduction-cost",
    (effect, sourceDefinitionId, effectIndex) =>
      residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
  "resolve-contest": createExecutor("resolve-contest", (effect, sourceDefinitionId, effectIndex) =>
    residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
  "require-transformation-roll": createExecutor(
    "require-transformation-roll",
    (effect, sourceDefinitionId, effectIndex) =>
      residualExecutorIssues(effect as RegisteredEffectDefinition, sourceDefinitionId, effectIndex),
  ),
} satisfies EffectExecutorRegistry;

export const compileEffectPlan = ({
  sourceDefinitionId,
  effectIndex,
  effect,
  allowFloatingOnMoveUse = false,
  allowPendingChoice = false,
}: EffectCompilationInput): EffectCompilationResult => {
  const executor = Object.hasOwn(effectExecutorRegistry, effect.type)
    ? effectExecutorRegistry[effect.type as RegisteredEffectType]
    : undefined;
  if (executor === undefined)
    return {
      ok: false,
      issues: [
        issue(
          "unsupported-effect-type",
          sourceDefinitionId,
          effectIndex,
          `Effect type ${effect.type} has no registered combat executor.`,
        ),
      ],
    };
  const issues = [
    ...conflictPolicyIssues(effect, sourceDefinitionId, effectIndex),
    ...executor.validate(effect as never, sourceDefinitionId, effectIndex),
  ];
  const filteredIssues = issues.filter((candidate) => {
    if (
      allowFloatingOnMoveUse &&
      effect.trigger === "on-move-use" &&
      candidate.message ===
        "On-move-use currently dispatches only durable self follow-ups and current-action self cost modifiers."
    )
      return false;
    if (
      allowFloatingOnMoveUse &&
      effect.type === "remove-move-from-combat" &&
      effect.trigger === "on-move-use" &&
      candidate.message ===
        "Move removal currently resolves from action-phase or on-success transitions only."
    )
      return false;
    if (allowPendingChoice && candidate.code === "requires-pending-choice") return false;
    return true;
  });
  return filteredIssues.length > 0
    ? { ok: false, issues: filteredIssues }
    : { ok: true, value: executor.compile(effect as never, sourceDefinitionId, effectIndex) };
};

export const executeCompiledEffect = (
  effect: CompiledEffect,
  context: EffectExecutionContext,
): EffectResolution => effectExecutorRegistry[effect.type].execute(effect as never, context);
