import type {
  EffectCondition,
  EffectDefinition,
  MoveDefinition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";

export const registeredEffectTypes = [
  "apply-status",
  "create-floating-effect",
  "deactivate",
  "force-action",
  "grant-extra-action",
  "lock",
  "modify-cost",
  "modify-damage",
  "modify-resource",
  "modify-roll",
  "prevent-combat-result",
  "prevent-move-modification",
  "prevent-move-use",
  "prevent-resource-modification",
  "prevent-resolution",
  "prevent-roll-modification",
  "prevent-status",
  "set-resolution-threshold",
  "set-roll-definition",
  "set-roll-result",
  "skip-action",
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
  "on-power-up",
  "on-resource-gain",
  "on-resource-drain",
  "on-resource-threshold",
  "on-roll-result",
]);

const supportedTargets = new Set(["self", "opponent", "participants"]);

const supportedConditions = new Set<EffectCondition["type"]>([
  "combat-result",
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
  "active-move-count",
  "moveset-move-count",
  "move-use-count",
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
  "consecutive-combat-results",
  "combat-result-count",
  "move-activation-count",
  "paid-activation-cost",
  "successful-hit-count",
  "prior-roll-result",
  "completed-combat-turn-count",
  "active-move-count",
  "active-move-effect-text-count",
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
  if (effect.target === undefined || !supportedTargets.has(effect.target))
    issues.push(
      issue(
        "unsupported-target",
        sourceDefinitionId,
        effectIndex,
        "Executable effects require a self, opponent, or participants target.",
      ),
    );
  if (effect.optional === true || effect.activationGroup !== undefined)
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Optional or activation-group effects require a serialized pending choice.",
      ),
    );
  for (const condition of effect.conditions ?? []) {
    if (!supportedConditions.has(condition.type))
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
  for (const requirement of effect.requirements ?? []) {
    if (requirement.type !== "moveset-excludes")
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          `Requirement ${requirement.type} is not available in the current combatant context.`,
        ),
      );
  }
  return issues;
};

const modifyDamageIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-damage" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const numeric =
    effect.percent?.type === "damage-percent"
      ? undefined
      : numericIssue(effect.percent, sourceDefinitionId, effectIndex, "percent");
  if (effect.percent === undefined)
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
  if (effect.activationCost !== undefined || effect.useLimit !== undefined)
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Damage responses with activation costs or use limits require a serialized pending choice.",
      ),
    );
  if (
    effect.trigger === "on-damage" &&
    effect.operation === "multiply" &&
    effect.conditions?.some(
      (condition) => condition.type === "combat-result" && condition.result === "critical",
    )
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Critical on-damage replacement requires an explicit critical-multiplier resolution context.",
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
  issues.push(...modifyDamageDurationIssues(effect.duration, sourceDefinitionId, effectIndex));
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
  if (effect.cap.type === "allow-exceed")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Allow-exceed roll caps require the standard roll-cap rule to be applied at resolution.",
      ),
    );
  if (effect.cap.scope === undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll caps require an explicit amount, total, or roll scope.",
      ),
    );
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
  if (effect.scope !== undefined && effect.scope.type !== "current-action")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll caps currently require an immediate or current-action modifier.",
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
  if (!["attack", "defense"].includes(effect.roll))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Roll ${effect.roll} is not supported.`,
      ),
    );
  if (!["result", "sides"].includes(effect.modifier))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Roll modifier ${effect.modifier} is not supported.`,
      ),
    );
  const numeric = numericIssue(effect.amount, sourceDefinitionId, effectIndex, "amount");
  if (effect.amount === undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll modifiers require a numeric amount.",
      ),
    );
  if (numeric !== undefined) issues.push(numeric);
  if (effect.multiplier !== undefined || effect.affectedDice !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll multipliers and die selection are not in this executor slice.",
      ),
    );
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
  if (
    effect.trigger === "before-attack-roll" &&
    effect.dieIndex !== undefined &&
    effect.conditions?.some(
      (condition) =>
        condition.type === "roll-die-result" || condition.type === "roll-die-threshold",
    )
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Per-die result conditions require the on-roll-result trigger.",
      ),
    );
  if (
    (effect.trigger === "on-resource-gain" || effect.trigger === "on-resource-drain") &&
    effect.duration !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Resource-event roll modifiers require a durable roll-event lifecycle for duration handling.",
      ),
    );
  return issues;
};

const modifyResourceIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-resource" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (
    (effect.trigger === "on-power-up" ||
      effect.trigger === "on-resource-gain" ||
      effect.trigger === "on-resource-drain") &&
    (effect.scope !== undefined ||
      effect.duration !== undefined ||
      effect.cap !== undefined ||
      effect.activationCost !== undefined ||
      effect.useLimit !== undefined)
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Power-up and resource-event resource changes require explicit durable scheduling, caps, and cost accounting.",
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
  if (effect.trigger === "on-roll-result")
    issues.push(
      issue(
        "unsupported-trigger",
        sourceDefinitionId,
        effectIndex,
        "On-roll-result extra actions require a persisted per-die action allowance.",
      ),
    );
  if (effect.phase !== "action-phase")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Upkeep extra actions require an explicit upkeep decision boundary.",
      ),
    );
  if (effect.scope !== undefined && effect.scope.type !== "current-action")
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
    if (
      effect.trigger !== "passive" ||
      effect.moveCategory !== "skill" ||
      effect.constant !== false ||
      effect.scope !== undefined
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
    (!Number.isInteger(effect.useLimit.count) || effect.useLimit.count < 1)
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

const preventMoveModificationIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "prevent-move-modification" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  if (effect.aspects.length !== 1 || effect.aspects[0] !== "cost")
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "This executor slice prevents KI cost modifications only.",
      ),
    );
  if (effect.scope !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Cost prevention scope is not yet part of the durable cost pipeline.",
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
        `Cost prevention duration ${effect.duration.type} is not supported by this executor slice.`,
      ),
    );
  if (!["self", "opponent", "any"].includes(effect.actor))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        `Cost prevention actor ${effect.actor} is not supported.`,
      ),
    );
  if (effect.operations?.some((operation) => operation !== "reduce"))
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Cost prevention supports only the declared reduce operation filter.",
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
    effect.relativeTo === undefined,
    sourceDefinitionId,
    effectIndex,
    "Relative roll thresholds require the resolution-local comparison context.",
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
  if (effect.duration !== undefined)
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Floating-effect duration requires a persisted termination transition and is not approximated by scope.",
      ),
    );
  if (
    effect.activationCost !== undefined ||
    effect.useLimit !== undefined ||
    effect.cooldown !== undefined ||
    effect.selectionLimit !== undefined ||
    effect.stacking !== undefined
  )
    issues.push(
      issue(
        "requires-pending-choice",
        sourceDefinitionId,
        effectIndex,
        "Floating-effect creation costs, limits, and stacking rules require a serialized lifecycle decision.",
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
  for (const [nestedIndex, nestedEffect] of (effect.effects ?? []).entries()) {
    if (nestedEffect.type === "create-floating-effect") {
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          `Nested floating effect ${nestedIndex} is not supported; floating bundles must be flat.`,
        ),
      );
      continue;
    }
    if (
      nestedEffect.type === "modify-resource" &&
      (nestedEffect.amount === undefined ||
        nestedEffect.cap !== undefined ||
        nestedEffect.prevention !== undefined ||
        nestedEffect.exclusions !== undefined)
    ) {
      issues.push(
        issue(
          "unsupported-variant",
          sourceDefinitionId,
          effectIndex,
          `Nested effect ${nestedIndex}: resource modifiers with omitted amounts, caps, prevention, or exclusions are not represented by the floating lifecycle.`,
        ),
      );
      continue;
    }
    const nestedCompilation = compileEffectPlan({
      sourceDefinitionId,
      effectIndex: nestedIndex,
      effect: nestedEffect,
    });
    if (!nestedCompilation.ok)
      issues.push(
        ...nestedCompilation.issues.map((nestedIssue) =>
          issue(
            nestedIssue.code,
            sourceDefinitionId,
            effectIndex,
            `Nested effect ${nestedIndex}: ${nestedIssue.message}`,
          ),
        ),
      );
  }
  return issues;
}

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
  "apply-status": createExecutor("apply-status"),
  "create-floating-effect": createExecutor("create-floating-effect", createFloatingIssues),
  deactivate: createExecutor("deactivate"),
  "force-action": createExecutor("force-action"),
  lock: createExecutor("lock"),
  "modify-cost": createExecutor("modify-cost"),
  "modify-damage": createExecutor("modify-damage", modifyDamageIssues),
  "modify-resource": createExecutor("modify-resource", modifyResourceIssues),
  "grant-extra-action": createExecutor("grant-extra-action", grantExtraActionIssues),
  "modify-roll": createExecutor("modify-roll", modifyRollIssues),
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
  "set-resolution-threshold": createExecutor("set-resolution-threshold", resolutionThresholdIssues),
  "set-roll-definition": createExecutor("set-roll-definition"),
  "set-roll-result": createExecutor("set-roll-result", setRollResultIssues),
  "skip-action": createExecutor("skip-action"),
} satisfies EffectExecutorRegistry;

export const compileEffectPlan = ({
  sourceDefinitionId,
  effectIndex,
  effect,
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
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: executor.compile(effect as never, sourceDefinitionId, effectIndex) };
};

export const executeCompiledEffect = (
  effect: CompiledEffect,
  context: EffectExecutionContext,
): EffectResolution => effectExecutorRegistry[effect.type].execute(effect as never, context);
