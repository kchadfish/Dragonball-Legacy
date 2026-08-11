import type {
  EffectCondition,
  EffectDefinition,
  MoveDefinition,
  NumericExpression,
} from "@dragonball-resurgence/game-data";

export const registeredEffectTypes = [
  "apply-status",
  "deactivate",
  "force-action",
  "lock",
  "modify-cost",
  "modify-damage",
  "modify-resource",
  "modify-roll",
  "prevent-combat-result",
  "prevent-move-modification",
  "prevent-move-use",
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
  "move-selector",
  "combat-context",
  "combat-state",
  "status",
  "perfect-roll",
  "roll-die-result",
  "roll-die-threshold",
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
  "move-activation-count",
  "successful-hit-count",
  "completed-combat-turn-count",
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
  }
  return issues;
};

const modifyDamageIssues = (
  effect: Extract<RegisteredEffectDefinition, { readonly type: "modify-damage" }>,
  sourceDefinitionId: string,
  effectIndex: number,
) => {
  const issues = commonIssues(effect, sourceDefinitionId, effectIndex);
  const numeric = numericIssue(effect.percent, sourceDefinitionId, effectIndex, "percent");
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
    !["current-action", "following-action", "next-action", "next-actions"].includes(scope)
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
  if (
    effect.multiplier !== undefined ||
    effect.dieIndex !== undefined ||
    effect.affectedDice !== undefined ||
    effect.cap !== undefined
  )
    issues.push(
      issue(
        "unsupported-variant",
        sourceDefinitionId,
        effectIndex,
        "Roll multipliers, die selection, and caps are not in this executor slice.",
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
  deactivate: createExecutor("deactivate"),
  "force-action": createExecutor("force-action"),
  lock: createExecutor("lock"),
  "modify-cost": createExecutor("modify-cost"),
  "modify-damage": createExecutor("modify-damage", modifyDamageIssues),
  "modify-resource": createExecutor("modify-resource"),
  "modify-roll": createExecutor("modify-roll", modifyRollIssues),
  "prevent-combat-result": createExecutor("prevent-combat-result"),
  "prevent-move-modification": createExecutor(
    "prevent-move-modification",
    preventMoveModificationIssues,
  ),
  "prevent-move-use": createExecutor("prevent-move-use"),
  "prevent-resolution": createExecutor("prevent-resolution"),
  "prevent-roll-modification": createExecutor("prevent-roll-modification"),
  "prevent-status": createExecutor("prevent-status"),
  "set-resolution-threshold": createExecutor("set-resolution-threshold", resolutionThresholdIssues),
  "set-roll-definition": createExecutor("set-roll-definition"),
  "set-roll-result": createExecutor("set-roll-result"),
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
