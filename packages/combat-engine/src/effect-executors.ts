import {
  ATTACK_TAG,
  type EffectCondition,
  type EffectDefinition,
  type MoveDefinition,
  type NumericExpression,
} from "@dragonball-resurgence/game-data";

export const registeredEffectTypes = [
  "activate",
  "apply-status",
  "create-floating-effect",
  "copy-move-effect",
  "deactivate",
  "force-action",
  "grant-combat-outcome",
  "grant-extra-action",
  "lock",
  "modify-cost",
  "modify-critical-threshold",
  "modify-damage",
  "modify-move-classification",
  "modify-remaining-uses",
  "modify-resource",
  "modify-roll",
  "modify-stat",
  "negate",
  "remove-move-from-combat",
  "prevent-combat-result",
  "prevent-move-modification",
  "prevent-move-use",
  "prevent-resource-modification",
  "prevent-resolution",
  "prevent-roll-modification",
  "prevent-status",
  "reroll",
  "roll-and-store",
  "select-move-by-stored-roll",
  "schedule-effect",
  "set-combat-result",
  "set-resolution-threshold",
  "set-roll-definition",
  "set-roll-result",
  "skip-action",
  "suppress",
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

const supportedTriggers = new Set([
  "action-phase",
  "after-defense-roll",
  "before-attack-roll",
  "before-defense-roll",
  "passive",
  "on-stopped",
  "on-success",
  "on-damage",
  "on-deactivated",
  "on-combat-result",
  "on-move-use",
  "on-cost-modified",
  "on-power-up",
  "on-resource-gain",
  "on-resource-drain",
  "on-resource-threshold",
  "on-roll-result",
  "start-combat",
  "upkeep-phase",
]);

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
  "set-resolution-threshold",
  "suppress",
]);

const supportedTargets = new Set(["self", "opponent", "participants"]);

const supportedConditions = new Set<EffectCondition["type"]>([
  "combat-result",
  "defense-response",
  "successful-hit-count",
  "roll-threshold",
  "roll-comparison",
  "paid-ki-cost",
  "stat-comparison",
  "resource-threshold",
  "resource-comparison",
  "move-selector",
  "prior-action",
  "no-prior-action",
  "action-sequence",
  "incoming-damage",
  "combat-context",
  "combat-state",
  "status",
  "perfect-roll",
  "roll-die-result",
  "roll-die-threshold",
  "resource-change",
  "move-effect-active",
  "move-effect-inactive",
  "target-relation",
  "move-modification",
  "active-move-count",
  "moveset-move-count",
  "move-use-count",
  "level-comparison",
  "location",
  "transformation-mastery",
  "prior-turn-restriction",
  "combat-turn",
  "moveset",
  "stored-roll-threshold",
  "stored-move-selection",
  "stopped-hit-fraction",
]);

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
  effect.stacking === undefined &&
  effect.activationCost !== undefined;

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
    isOnMoveUseCostChoice(effect)
  );

const conditionIssues = (
  effect: RegisteredEffectDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  for (const condition of effect.conditions ?? []) {
    if (
      !supportedConditions.has(condition.type) &&
      !(condition.type === "combat-outcome" && effect.trigger === "on-combat-result")
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
    if (condition.type === "resource-change" && condition.timing !== "current-event")
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          "Resource-change conditions support current-event timing only in this executor slice.",
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
): EffectCompilationIssue[] => {
  const issues: EffectCompilationIssue[] = [];
  if (!supportedTriggers.has(effect.trigger))
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
    effect.type !== "modify-roll"
  )
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Start-combat currently dispatches only representable lock and resource effects.",
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
    effect.optional === true ||
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
  return issues;
};

const copyMoveEffectIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "copy-move-effect" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const unsupported = (message: string) =>
    issues.push(issue("unsupported-variant", sourceDefinitionId, effectIndex, message));

  if (effect.trigger !== "action-phase" || effect.target !== "self")
    unsupported("Only self action-phase copied attacks are executable in the current runtime.");
  if (
    effect.sourceMove.type !== "last-prior-move" ||
    effect.sourceMove.actor !== "self" ||
    effect.sourceMove.restriction !== "unrestricted"
  )
    unsupported("Only the last unrestricted self move source is currently executable.");
  if (effect.effectResult !== "successful" || effect.resolveAs !== "source-move")
    unsupported("Copied attacks must resolve as the selected source move on success.");
  if (
    effect.damage?.type !== "add-percent" ||
    effect.damage.value.type !== "literal" ||
    !Number.isFinite(effect.damage.value.value)
  )
    unsupported("Copied attacks currently require a finite literal additive power-percent bonus.");
  if (effect.cost?.type !== "selected-move-base-cost")
    unsupported("Copied attacks currently require the selected source move base Ki cost.");
  if (effect.ignoreRequirements !== undefined || effect.copies !== undefined)
    unsupported("Requirement bypasses and copied source modifiers require a distinct executor.");
  if (
    effect.scope !== undefined ||
    effect.duration !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    effect.selectionLimit !== undefined ||
    effect.cooldown !== undefined ||
    effect.stacking !== undefined
  )
    unsupported(
      "Copied attacks with lifecycle, activation, or selection modifiers require a distinct executor.",
    );
  return issues;
};

const activateIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "activate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.trigger !== "on-success" && effect.trigger !== "before-attack-roll")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Activation selection currently resolves only after a successful action or before an attack roll.",
      ),
    );
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
    effect.asIf !== undefined ||
    (effect.ignoreRequirements === true && !groupedReactivation) ||
    effect.selectionKey !== undefined ||
    effect.repeatUntil !== undefined ||
    effect.activationCost !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        groupedReactivation
          ? "Repeated activation supports only the exact successful-hit-count group reactivation variant."
          : "Activation selection supports one ordinary CONSTANT Skill choice without repeat or alternate activation semantics.",
      ),
    );
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
    effect.stacking !== undefined ||
    effect.selectionLimit !== undefined ||
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
  if (effect.trigger !== "action-phase" && effect.trigger !== "upkeep-phase")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Damage use limits are supported only when an action or upkeep transition creates the durable modifier.",
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
  if (effect.activationCost !== undefined)
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
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const numeric = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  if (effect.amount === undefined && effect.cap === undefined)
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
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const amountIssue = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  const minimumIssue = numericIssue(effect.minimum, sourceDefinitionId, effectIndex, "minimum");
  const maximumIssue = numericIssue(effect.maximum, sourceDefinitionId, effectIndex, "maximum");
  if (amountIssue !== undefined) issues.push(amountIssue);
  if (minimumIssue !== undefined) issues.push(minimumIssue);
  if (maximumIssue !== undefined) issues.push(maximumIssue);
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

const modifyResourceIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-resource" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const amountIssue = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
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
    effect.trigger === "start-combat" &&
    effect.conditions?.some(
      (condition) =>
        condition.type === "stat-comparison" &&
        (condition.stat === "sp" || condition.rightStat === "sp"),
    )
  )
    issues.push(
      issue(
        "unsupported-condition",
        sourceDefinitionId,
        effectIndex,
        "Start-combat SP comparisons require a persisted SP combat context.",
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
    (effect.activationCost !== undefined || effect.useLimit !== undefined)
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

const lockIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "lock" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
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
      effect.selector?.styleProvenance !== undefined ||
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
    (aspect) => aspect !== "all-effects" && aspect !== "successful-effects",
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
  if (effect.scope === undefined && effect.duration === undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Suppress effects require a durable duration or next-action scope; current-resolution suppression is not approximated.",
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

const suppressChoiceIssues = (
  effect: SuppressDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) =>
  effect.activationCost !== undefined ||
  effect.useLimit !== undefined ||
  effect.cooldown !== undefined ||
  effect.selectionLimit !== undefined
    ? [
        issue(
          "requires-pending-choice",
          sourceDefinitionId,
          effectIndex,
          "Suppress activation costs, limits, cooldowns, and selection limits require a serialized lifecycle decision.",
        ),
      ]
    : [];

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

const negateIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "negate" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
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
      effect.stacking !== undefined ||
      effect.useLimit !== undefined ||
      effect.selectionLimit !== undefined ||
      effect.cooldown !== undefined ||
      effect.activationCost?.resource !== "ki" ||
      effect.activationCost.operation !== "lose" ||
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
    effect.stacking !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    effect.selectionLimit !== undefined ||
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

const extraActionTargetIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "grant-extra-action" }>,
  sourceDefinitionId: string,
  effectIndex: number,
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
  if (effect.duration !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Extra-action duration requires a separate scheduled lifecycle and is not approximated.",
      ),
    );
  if (effect.activationCost !== undefined)
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Extra-action activation costs require a serialized choice before the action is selected.",
      ),
    );
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
    effect.selectionLimit !== undefined ||
    effect.stacking !== undefined
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
      effect.conditions?.some(
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
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
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

const setCombatResultIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-combat-result" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const isAfterDefensePerDie =
    effect.trigger === "after-defense-roll" && effect.resultScope === "matching-die";
  const isDeferredStoppedAttack =
    effect.trigger === "on-stopped" &&
    effect.result === "stopped" &&
    effect.resultScope === "current-attack" &&
    effect.scope?.type === "next-action" &&
    effect.duration === undefined &&
    effect.useLimit === undefined &&
    effect.activationCost === undefined &&
    effect.activationGroup === undefined &&
    effect.optional !== true;
  if (effect.resultScope !== "current-attack" && !isAfterDefensePerDie)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Combat-result overrides currently apply only to the current attack.",
      ),
    );
  if (effect.result === "successful" && effect.trigger !== "passive" && !isAfterDefensePerDie)
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
  if (effect.result === "stopped" && !isAfterDefensePerDie && !isDeferredStoppedAttack)
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

const preventMoveModificationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "prevent-move-modification" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const supportedAspects = new Set(["cost", "damage", "dice-sides", "roll-results"]);
  if (effect.aspects.length === 0 || effect.aspects.some((aspect) => !supportedAspects.has(aspect)))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move-modification prevention supports cost, damage, dice-side, and roll-result aspects only.",
      ),
    );
  if (effect.scope !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Move-modification prevention scope is not yet part of the durable pipeline.",
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
  if (effect.operations?.some((operation) => operation !== "reduce"))
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
) => (condition ? [] : [issue("unsupported-variant", sourceDefinitionId, effectIndex, message)]);

const resolutionThresholdShapeIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "set-resolution-threshold" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  return [
    ...resolutionThresholdIssue(
      effect.outcome === "successful" || effect.outcome === "stop",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold outcome ${effect.outcome} is not supported.`,
    ),
    ...resolutionThresholdIssue(
      effect.roll === "attack" || effect.roll === "defense",
      sourceDefinitionId,
      effectIndex,
      `Resolution threshold roll ${effect.roll} is not supported.`,
    ),
    ...resolutionThresholdIssue(
      effect.comparison === "at-least" || effect.comparison === "at-most",
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
      effect.resultScope === "matching-die",
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

const rerollIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "reroll" }>,
  sourceDefinitionId: string,
  effectIndex: number,
  // eslint-disable-next-line sonarjs/cognitive-complexity
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex).filter(
    (candidate) =>
      !(
        candidate.code === "requires-pending-choice" &&
        effect.optional === true &&
        effect.activationGroup === undefined
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
    if (condition.type !== "roll-threshold" || condition.roll !== effect.roll) {
      issues.push(
        issue(
          "unsupported-condition",
          sourceDefinitionId,
          effectIndex,
          "After-defense rerolls support only thresholds on the roll being rerolled.",
        ),
      );
      continue;
    }
    const thresholdIssue = numericIssue(
      condition.value,
      sourceDefinitionId,
      effectIndex,
      "conditions.roll-threshold.value",
    );
    if (thresholdIssue !== undefined) issues.push(thresholdIssue);
  }
  if (effect.trigger !== "after-defense-roll")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "This reroll executor resolves only after both attack and defense dice are persisted.",
      ),
    );
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "After-defense rerolls must target the combatant who owns the effect.",
      ),
    );
  if (effect.scope !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Consumable future-roll rerolls require a durable active-effect lifecycle.",
      ),
    );
  if (
    effect.duration !== undefined &&
    (effect.duration.type !== "combat" || effect.requiresPriorSourceResult !== "successful")
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Durable rerolls require combat duration and an explicit successful source-move prerequisite.",
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
  if (effect.roll === "attack" && effect.rerollScope !== "entire-attack")
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
  if (effect.useLimit !== undefined && effect.useLimit.scope !== "combat")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Immediate reroll reactions support combat use limits only.",
      ),
    );
  if (
    effect.cooldown !== undefined ||
    effect.stacking !== undefined ||
    effect.selectionLimit !== undefined ||
    effect.exclusiveActivationGroup !== undefined
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
    effect.stacking !== undefined ||
    effect.selectionLimit !== undefined ||
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
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const unsupported = (message: string) =>
    issues.push(issue("unsupported-variant", sourceDefinitionId, effectIndex, message));
  if (effect.target !== "self" || effect.subject !== "self")
    unsupported("Stored move selections are owned by the source combatant.");
  if (effect.trigger !== "upkeep-phase")
    unsupported("Stored move selections currently reindex during upkeep only.");
  if (effect.selector.subject !== "source")
    unsupported("Stored move selections require a source-relative move selector.");
  if (effect.ordering !== "character-sheet-top-to-bottom")
    unsupported("Stored move selections require character-sheet ordering.");
  if (effect.reindex !== "on-moveset-change")
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
    effect.stacking !== undefined ||
    effect.selectionLimit !== undefined ||
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
    effect.duration.type !== "turns"
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
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
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
    effect.stacking !== undefined ||
    effect.selectionLimit !== undefined ||
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

type SkipActionDefinition = Extract<RegisteredEffectDefinition, { readonly type: "skip-action" }>;

const skipActionTriggerTargetIssues = (
  effect: SkipActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  if (
    effect.trigger !== "on-success" &&
    effect.trigger !== "before-attack-roll" &&
    effect.trigger !== "on-roll-result"
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

const skipActionLifecycleIssues = (
  effect: SkipActionDefinition,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues: EffectCompilationIssue[] = [];
  const nextTurnScope = effect.scope?.type === "next-turn";
  const turnsDuration = effect.duration?.type === "turns";
  if (nextTurnScope === turnsDuration)
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
  if (effect.duration !== undefined && !turnsDuration)
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

const removeMoveFromCombatIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "remove-move-from-combat" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
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
  if (effect.scope !== undefined)
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
    effect.selectionLimit !== undefined
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
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.trigger !== "passive")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Current-action classification requires a passive trigger.",
      ),
    );
  if (effect.target !== "self")
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Current-action classification applies to the source move only.",
      ),
    );
  if (effect.scope?.type !== "current-action" || effect.duration !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "This classification executor supports current-action scope without a separate duration.",
      ),
    );
  if (
    effect.addTags === undefined ||
    effect.addTags.length === 0 ||
    effect.addTags.some((tag) => !supportedClassificationTags.has(tag.toUpperCase()))
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Current-action classification requires one or more recognized additive attack tags.",
      ),
    );
  if (
    effect.setStyleId !== undefined ||
    effect.replaceStyle !== undefined ||
    effect.selector !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Style replacement and selected-move classification require a durable selection lifecycle.",
      ),
    );
  if (
    effect.conditions !== undefined ||
    effect.requirements !== undefined ||
    effect.useLimit !== undefined ||
    effect.activationCost !== undefined ||
    effect.selectionLimit !== undefined ||
    effect.cooldown !== undefined ||
    effect.stacking !== undefined ||
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
  if (effect.sourceActor !== undefined && effect.sourceActor !== "opponent")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Resource prevention source actor ${effect.sourceActor} is not supported.`,
      ),
    );
  if (effect.exceptAction !== undefined && effect.exceptAction !== "power-up")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Resource prevention exception ${effect.exceptAction} is not supported.`,
      ),
    );
  if (effect.scope !== undefined)
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
    (thresholdConditions[0] !== undefined &&
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
) => {
  const useLimit = effect.useLimit;
  if (useLimit === undefined) return false;
  if (useLimit.scope === "combat")
    return (
      !isSingle ||
      (effect.scope !== undefined && effect.scope.type !== "combat") ||
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
  if (effect.cooldown !== undefined || effect.selectionLimit !== undefined)
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
  if (effect.trigger === "on-roll-result")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "Floating creation from on-roll-result requires persisting per-die effect activations.",
      ),
    );
  issues.push(...floatingNestedEffectIssues(effect, sourceDefinitionId, effectIndex));
  return issues;
}

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
  "apply-status": createExecutor("apply-status", applyStatusIssues),
  "copy-move-effect": createExecutor("copy-move-effect", copyMoveEffectIssues),
  "create-floating-effect": createExecutor("create-floating-effect", createFloatingIssues),
  deactivate: createExecutor("deactivate"),
  "force-action": createExecutor("force-action"),
  "grant-combat-outcome": createExecutor("grant-combat-outcome", grantCombatOutcomeIssues),
  lock: createExecutor("lock", lockIssues),
  "modify-cost": createExecutor("modify-cost", modifyCostIssues),
  "modify-critical-threshold": createExecutor(
    "modify-critical-threshold",
    modifyCriticalThresholdIssues,
  ),
  "modify-damage": createExecutor("modify-damage", modifyDamageIssues),
  "modify-move-classification": createExecutor(
    "modify-move-classification",
    modifyMoveClassificationIssues,
  ),
  "modify-remaining-uses": createExecutor("modify-remaining-uses", modifyRemainingUsesIssues),
  "modify-resource": createExecutor("modify-resource", modifyResourceIssues),
  "grant-extra-action": createExecutor("grant-extra-action", grantExtraActionIssues),
  "modify-roll": createExecutor("modify-roll", modifyRollIssues),
  "modify-stat": createExecutor("modify-stat", modifyStatIssues),
  negate: createExecutor("negate", negateIssues),
  "remove-move-from-combat": createExecutor("remove-move-from-combat", removeMoveFromCombatIssues),
  "prevent-combat-result": createExecutor("prevent-combat-result"),
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
  reroll: createExecutor("reroll", rerollIssues),
  "roll-and-store": createExecutor("roll-and-store", rollAndStoreIssues),
  "select-move-by-stored-roll": createExecutor(
    "select-move-by-stored-roll",
    selectMoveByStoredRollIssues,
  ),
  "schedule-effect": createExecutor("schedule-effect", scheduleEffectIssues),
  "set-combat-result": createExecutor("set-combat-result", setCombatResultIssues),
  "set-resolution-threshold": createExecutor("set-resolution-threshold", resolutionThresholdIssues),
  "set-roll-definition": createExecutor("set-roll-definition"),
  "set-roll-result": createExecutor("set-roll-result", setRollResultIssues),
  "skip-action": createExecutor("skip-action", skipActionIssues),
  suppress: createExecutor("suppress", suppressIssues),
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
  const issues = executor.validate(effect as never, sourceDefinitionId, effectIndex);
  const filteredIssues = issues.filter((candidate) => {
    if (
      allowFloatingOnMoveUse &&
      effect.trigger === "on-move-use" &&
      candidate.message ===
        "On-move-use currently dispatches only durable self follow-ups and current-action self cost modifiers."
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
