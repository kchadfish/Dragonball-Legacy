import type {
  EffectDefinition,
  ItemDefinition,
  ItemEffectDefinition,
  ItemStateRuleEffect,
} from "@dragonball-resurgence/game-data";

import {
  compileEffectPlan,
  registeredEffectTypes,
  type CompiledEffect,
  type EffectCompilationIssue,
  type EffectOrigin,
} from "./effect-executors.js";

export type ItemEffectClassification =
  "supported-generic" | "supported-named" | "unsupported-in-scope" | "audited-out-of-scope";

export interface ItemEffectAdapter {
  readonly effectType: string;
  readonly classification: ItemEffectClassification;
  readonly executor: string | null;
  readonly capabilityId?: string;
  readonly reason: string;
  readonly prerequisite?: string;
}

export interface CompiledItemEffect {
  readonly type: "item-effect";
  readonly origin: Extract<EffectOrigin, "item">;
  readonly sourceDefinitionId: ItemDefinition["id"];
  readonly itemId: ItemDefinition["id"];
  readonly effectIndex: number;
  readonly sourceClauseOrder?: number;
  readonly definition: ItemEffectDefinition;
  readonly adapter: ItemEffectAdapter;
  /** Present when an item effect is already a regular shared effect. */
  readonly normalized?: CompiledEffect;
}

export type ItemEffectCompilationResult =
  | { readonly ok: true; readonly value: CompiledItemEffect }
  | { readonly ok: false; readonly issues: readonly EffectCompilationIssue[] };

export const itemStateRuleOperations = [
  "allow-use-after-combat-loss",
  "limit-healing-item-uses",
  "modify-recovery-rate",
  "modify-all-roll-sides",
  "limit-consecutive-stat-boost-weeks",
  "modify-skill-slot-capacity",
  "grant-extra-basic-weapon-action",
  "prevent-interference",
  "permit-equipment-change",
  "prevent-equipment-change-during-combat",
  "grant-marketplace-access",
  "waive-ship-pilot-requirement",
  "pay-activation-ki",
  "heal-current-hp",
  "reduce-training-days",
  "grant-zenni-on-npc-kill",
  "grant-transformation-roll-sides",
  "grant-ki-per-combat",
  "allow-quest-without-battle",
  "permit-accessory-slot-overflow",
  "restrict-use-in-purchase-week",
  "limit-race-item-uses",
  "grant-resource-when-race",
  "reflect-attack-damage",
  "make-advanced-attack-unblockable",
  "stop-low-roll-unrestricted-attack",
  "set-attack-roll-result",
  "reroll-defense-dice",
  "modify-tagged-attack-cost",
  "modify-block-cost",
  "declare-after-defense-roll",
  "declare-after-roll",
  "declare-before-roll",
  "modify-transformation-roll-result",
  "heal-total-hp-per-day",
  "grant-ship-storage-access",
  "transfer-stored-items-on-raid",
  "increase-other-ship-travel-time",
  "restrict-space-quest-work",
  "challenge-dragon-ball-carrier",
  "activate-after-defense-roll",
  "activate-on-advanced-attack",
  "stop-low-firearm-roll",
  "modify-selected-roll",
  "deny-challenge",
  "apply-challenge-cooldown",
  "select-escape-roll-modifier",
  "heal-after-item-healing",
  "select-persistent-stat",
  "increase-single-die-drain",
  "protect-combat-state",
  "forbid-defense-reroll-after-restricted-attack",
  "roll-space-combat-dice",
  "set-space-combat-starting-hp",
  "disable-selected-item-copies",
  "limit-space-combat-item-use",
  "resolve-self-destruct",
  "destroy-item-on-roll-threshold",
  "grant-post-combat-reward",
  "pay-hp-for-roll-modifier",
  "exchange-experience-for-resources",
  "require-unrestricted-single-physical-attack",
  "exclude-multi-die-attacks",
  "activate-on-block",
  "roll-first-advanced-attack-twice-lower",
  "cap-hp-at-precombat-value",
  "require-hp-threshold",
  "roll-self-destruct-die",
  "allow-target-item-attack",
] as const satisfies readonly ItemStateRuleEffect["operation"][];

const genericItemAdapters = Object.fromEntries(
  registeredEffectTypes.map((effectType) => [
    effectType,
    {
      effectType,
      classification: "supported-generic" as const,
      executor: `${effectType}-executor`,
      capabilityId: `${effectType}.item.v1`,
      reason: "The item uses the shared declarative effect executor.",
    },
  ]),
);

const customAdapters: Readonly<Record<string, ItemEffectAdapter>> = {
  "item-modify-stat-percent": {
    effectType: "item-modify-stat-percent",
    classification: "supported-generic",
    executor: "calculation-pipeline.stat-percent",
    capabilityId: "item-stat-percent.v1",
    reason: "Item percentage stat changes use the shared calculation pipeline.",
  },
  "item-modify-resource": {
    effectType: "item-modify-resource",
    classification: "supported-generic",
    executor: "calculation-pipeline.resource",
    capabilityId: "item-resource.v1",
    reason: "Item resource changes use the shared capped resource pipeline.",
  },
  "item-modify-roll": {
    effectType: "item-modify-roll",
    classification: "supported-generic",
    executor: "roll-executor",
    capabilityId: "item-roll.v1",
    reason: "Item roll changes are normalized into the shared roll pipeline.",
  },
  "item-modify-damage": {
    effectType: "item-modify-damage",
    classification: "supported-generic",
    executor: "damage-executor",
    capabilityId: "item-damage.v1",
    reason: "Item damage changes are normalized into the shared damage pipeline.",
  },
  "item-prevent-combat-outcome": {
    effectType: "item-prevent-combat-outcome",
    classification: "supported-generic",
    executor: "item-combat-outcome-prevention",
    capabilityId: "item-outcome-prevention.v1",
    reason: "BREAK and SEVER prevention is a named adapter for the shared result pipeline.",
  },
  "item-modify-experience-percent": {
    effectType: "item-modify-experience-percent",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Experience and progression are owned outside combat.",
  },
  "item-modify-inventory-capacity": {
    effectType: "item-modify-inventory-capacity",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Permanent inventory capacity is outside combat state.",
  },
  "item-modify-ship-capacity": {
    effectType: "item-modify-ship-capacity",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Spaceship capacity is outside the active combat scope.",
  },
  "item-modify-marketplace-price": {
    effectType: "item-modify-marketplace-price",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Marketplace economy is outside combat.",
  },
  "item-reduce-duration": {
    effectType: "item-reduce-duration",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Quest and travel duration are outside combat.",
  },
  "item-grant-travel-permission": {
    effectType: "item-grant-travel-permission",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Travel permissions are outside combat.",
  },
  "item-space-combat": {
    effectType: "item-space-combat",
    classification: "audited-out-of-scope",
    executor: null,
    reason: "Spaceship combat is a later combat scope.",
    prerequisite: "Phase 10 spaceship combat state",
  },
};

const combatStateRuleOperations = new Set<ItemStateRuleEffect["operation"]>([
  "allow-use-after-combat-loss",
  "limit-healing-item-uses",
  "pay-activation-ki",
  "heal-current-hp",
  "modify-all-roll-sides",
  "grant-extra-basic-weapon-action",
  "grant-ki-per-combat",
  "reflect-attack-damage",
  "make-advanced-attack-unblockable",
  "stop-low-roll-unrestricted-attack",
  "set-attack-roll-result",
  "reroll-defense-dice",
  "modify-tagged-attack-cost",
  "modify-block-cost",
  "declare-after-defense-roll",
  "declare-after-roll",
  "declare-before-roll",
  "modify-transformation-roll-result",
  "activate-after-defense-roll",
  "activate-on-advanced-attack",
  "stop-low-firearm-roll",
  "modify-selected-roll",
  "heal-after-item-healing",
  "increase-single-die-drain",
  "exclude-multi-die-attacks",
  "activate-on-block",
  "protect-combat-state",
  "forbid-defense-reroll-after-restricted-attack",
  "require-unrestricted-single-physical-attack",
  "pay-hp-for-roll-modifier",
  "require-hp-threshold",
  "roll-self-destruct-die",
  "resolve-self-destruct",
]);

const phase9StateRuleOperations = new Set<ItemStateRuleEffect["operation"]>([
  "limit-race-item-uses",
  "grant-resource-when-race",
]);

const phase10StateRuleOperations = new Set<ItemStateRuleEffect["operation"]>([
  "prevent-interference",
  "select-escape-roll-modifier",
  "allow-target-item-attack",
  "destroy-item-on-roll-threshold",
]);

const externalStateRuleReasons: Readonly<
  Partial<Record<ItemStateRuleEffect["operation"], string>>
> = {
  "modify-recovery-rate": "Real-world recovery is outside combat state.",
  "limit-consecutive-stat-boost-weeks": "Weekly progression is outside combat state.",
  "modify-skill-slot-capacity": "Permanent inventory and equipment capacity is outside combat.",
  "permit-equipment-change": "Permanent equipment mutation is outside combat state.",
  "prevent-equipment-change-during-combat":
    "Equipment ownership and mutation are outside combat state.",
  "grant-marketplace-access": "Marketplace economy is outside combat.",
  "waive-ship-pilot-requirement": "Spaceship operation is outside the active combat scope.",
  "reduce-training-days": "Training progression is outside combat state.",
  "grant-zenni-on-npc-kill": "Post-combat progression rewards are outside combat state.",
  "grant-transformation-roll-sides":
    "Spaceship transformation support is outside the active combat scope.",
  "allow-quest-without-battle": "Quest resolution is outside combat state.",
  "permit-accessory-slot-overflow": "Permanent inventory and equipment capacity is outside combat.",
  "restrict-use-in-purchase-week":
    "Purchase-week restrictions belong to progression and inventory.",
  "deny-challenge": "Challenge eligibility and saga cooldowns are outside combat state.",
  "apply-challenge-cooldown": "Challenge eligibility and saga cooldowns are outside combat state.",
  "select-persistent-stat": "Permanent stat selection is outside combat state.",
  "exchange-experience-for-resources": "Experience and progression are outside combat.",
  "heal-total-hp-per-day": "Real-world daily recovery is outside combat state.",
  "grant-ship-storage-access": "Spaceship storage is outside the active combat scope.",
  "transfer-stored-items-on-raid": "Spaceship storage and raid resolution are outside combat.",
  "increase-other-ship-travel-time": "Spaceship travel is outside the active combat scope.",
  "restrict-space-quest-work": "Spaceship quest work is outside the active combat scope.",
  "challenge-dragon-ball-carrier": "Quest and saga challenge rules are outside combat state.",
  "roll-space-combat-dice": "Spaceship combat is outside the active combat scope.",
  "set-space-combat-starting-hp": "Spaceship combat is outside the active combat scope.",
  "disable-selected-item-copies":
    "Multiplayer spaceship item targeting is outside the active combat scope.",
  "limit-space-combat-item-use": "Spaceship combat is outside the active combat scope.",
  "roll-first-advanced-attack-twice-lower": "Spaceship combat is outside the active combat scope.",
  "cap-hp-at-precombat-value": "Spaceship combat is outside the active combat scope.",
  "grant-post-combat-reward": "Post-combat progression rewards are outside combat state.",
};

const itemStateRuleAdapter = (effect: ItemStateRuleEffect): ItemEffectAdapter => {
  const effectType = `item-state-rule:${effect.operation}`;
  if (combatStateRuleOperations.has(effect.operation)) {
    return {
      effectType,
      classification: "supported-named",
      executor: `item-state-rule.${effect.operation}`,
      capabilityId: `${effectType}.v1`,
      reason: "The operation is independently accounted for by a combat item adapter.",
    };
  }
  if (phase9StateRuleOperations.has(effect.operation)) {
    return {
      effectType,
      classification: "supported-named",
      executor: `item-state-rule.${effect.operation}`,
      capabilityId: `${effectType}.v1`,
      reason: "The race-dependent operation is resolved from typed combatant race state.",
    };
  }
  if (phase10StateRuleOperations.has(effect.operation)) {
    return {
      effectType,
      classification: "audited-out-of-scope",
      executor: null,
      reason: "Multiplayer, escape, or remote-target item behavior requires the Phase 10 contract.",
      prerequisite: "Phase 10 multiplayer and remote-target state",
    };
  }
  const externalReason = externalStateRuleReasons[effect.operation];
  if (externalReason !== undefined) {
    return {
      effectType,
      classification: "audited-out-of-scope",
      executor: null,
      reason: externalReason,
    };
  }
  return {
    effectType,
    classification: "unsupported-in-scope",
    executor: null,
    reason: "The generated item operation is known but has no approved combat or external owner.",
    prerequisite: "Phase 8 item state-rule executor",
  };
};

/** Exhaustive runtime registry for every generated item effect family. */
export const itemEffectAdapterRegistry: Readonly<Record<string, ItemEffectAdapter>> = {
  ...genericItemAdapters,
  ...customAdapters,
  "item-state-rule": {
    effectType: "item-state-rule",
    classification: "supported-named",
    executor: "item-state-rule-dispatch",
    capabilityId: "item-state-rule.v1",
    reason: "Each operation is classified by itemStateRuleAdapter.",
  },
};

export const itemEffectAdapterFor = (effect: ItemEffectDefinition): ItemEffectAdapter => {
  if (effect.type === "item-state-rule") return itemStateRuleAdapter(effect);
  if (!Object.hasOwn(itemEffectAdapterRegistry, effect.type))
    return {
      effectType: effect.type,
      classification: "unsupported-in-scope",
      executor: null,
      reason: "No item adapter is registered for this generated effect family.",
      prerequisite: "Phase 8 item adapter implementation",
    };
  const adapter = itemEffectAdapterRegistry[effect.type];
  if (effect.type === "item-modify-stat-percent" && effect.duration?.unit === "week")
    return {
      effectType: effect.type,
      classification: "audited-out-of-scope",
      executor: null,
      reason: "Weekly stat progression is outside combat state.",
    };
  if (effect.type === "item-modify-roll" && effect.trigger === "after-spar-or-battle")
    return {
      effectType: effect.type,
      classification: "audited-out-of-scope",
      executor: null,
      reason: "Post-combat transformation rewards are outside combat state.",
    };
  return adapter;
};

export const compileItemEffectPlan = (input: {
  readonly item: ItemDefinition;
  readonly effectIndex: number;
}): ItemEffectCompilationResult => {
  const effect = input.item.effects?.[input.effectIndex];
  if (effect === undefined)
    return {
      ok: false,
      issues: [
        {
          code: "unsupported-variant",
          sourceDefinitionId: input.item.id,
          effectIndex: input.effectIndex,
          message: "The item effect index does not exist.",
        },
      ],
    };
  const adapter = itemEffectAdapterFor(effect);
  if (adapter.classification === "unsupported-in-scope")
    return {
      ok: false,
      issues: [
        {
          code: "unsupported-variant",
          sourceDefinitionId: input.item.id,
          effectIndex: input.effectIndex,
          message: adapter.reason,
        },
      ],
    };
  const normalized = isGenericEffect(effect)
    ? compileEffectPlan({
        sourceDefinitionId: input.item.id,
        effectIndex: input.effectIndex,
        effect,
        origin: "item",
        allowFloatingOnMoveUse: true,
        allowPendingChoice: true,
      })
    : undefined;
  if (normalized !== undefined && !normalized.ok) return normalized;
  return {
    ok: true,
    value: {
      type: "item-effect",
      origin: "item",
      sourceDefinitionId: input.item.id,
      itemId: input.item.id,
      effectIndex: input.effectIndex,
      ...(effect.sourceClauseOrder === undefined
        ? {}
        : { sourceClauseOrder: effect.sourceClauseOrder }),
      definition: effect,
      adapter,
      ...(normalized?.ok === true ? { normalized: normalized.value } : {}),
    },
  };
};

const isGenericEffect = (effect: ItemEffectDefinition): effect is EffectDefinition =>
  Object.hasOwn(itemEffectAdapterRegistry, effect.type) && !effect.type.startsWith("item-");

/** Returns every item effect family that the generated catalog can emit. */
export const registeredItemEffectTypes = [
  ...new Set([...registeredEffectTypes, ...Object.keys(customAdapters), "item-state-rule"]),
] as readonly string[];

/** Ensures the generated catalog has no effect type without an adapter result. */
export const auditItemEffectAdapters = (items: readonly ItemDefinition[]) =>
  items.flatMap((item) =>
    (item.effects ?? []).flatMap((effect, effectIndex) => {
      const result = compileItemEffectPlan({ item, effectIndex });
      return result.ok ? [] : [{ itemId: item.id, effectIndex, issues: result.issues }];
    }),
  );
