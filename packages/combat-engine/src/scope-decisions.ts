/**
 * Versioned accounting decisions for mechanics that are intentionally outside
 * the deterministic local 1v1 combat boundary.
 *
 * These decisions are accounting metadata, not runtime permissions. A caller
 * must never make an excluded mechanic executable merely because it found a
 * matching decision.
 */
export const scopeDecisionCategories = [
  "allies-and-joint-attacks",
  "interferers-and-spectators",
  "remote-and-relationship-targets",
  "escape-actions-and-roll-configuration",
  "body-mutation",
  "ownership-mutation",
  "racial-trait-mutation",
  "moveset-mutation",
  "identity-mutation",
  "progression-and-stat-acquisition",
  "administrator-and-narrative",
  "planetary-destruction",
  "spaceship-combat",
  "spaceship-travel-storage-capacity-and-raid",
] as const;

export type ScopeDecisionCategory = (typeof scopeDecisionCategories)[number];
export type ScopeDecisionId = `combat-scope:${string}`;

export interface ScopeDecision {
  readonly id: ScopeDecisionId;
  readonly category: ScopeDecisionCategory;
  readonly version: 1;
  readonly reason: string;
  readonly futureOwner: string;
}

export const scopeDecisionIds = {
  alliesAndJointAttacks: "combat-scope:allies-and-joint-attacks",
  interferersAndSpectators: "combat-scope:interferers-and-spectators",
  remoteAndRelationshipTargets: "combat-scope:remote-and-relationship-targets",
  escapeActionsAndRollConfiguration: "combat-scope:escape-actions-and-roll-configuration",
  bodyMutation: "combat-scope:body-mutation",
  ownershipMutation: "combat-scope:ownership-mutation",
  racialTraitMutation: "combat-scope:racial-trait-mutation",
  movesetMutation: "combat-scope:moveset-mutation",
  identityMutation: "combat-scope:identity-mutation",
  progressionAndStatAcquisition: "combat-scope:progression-and-stat-acquisition",
  administratorAndNarrative: "combat-scope:administrator-and-narrative",
  planetaryDestruction: "combat-scope:planetary-destruction",
  spaceshipCombat: "combat-scope:spaceship-combat",
  spaceshipTravelStorageCapacityAndRaid: "combat-scope:spaceship-travel-storage-capacity-and-raid",
} as const satisfies Record<string, ScopeDecisionId>;

const decision = <T extends ScopeDecision>(value: T): T => value;

export const scopeDecisionRegistry = {
  [scopeDecisionIds.alliesAndJointAttacks]: decision({
    id: scopeDecisionIds.alliesAndJointAttacks,
    category: "allies-and-joint-attacks",
    version: 1,
    reason:
      "Ally participation and joint attacks require multiple combatants beyond the local deterministic 1v1 fight.",
    futureOwner: "combat-engine future multi-combat scope",
  }),
  [scopeDecisionIds.interferersAndSpectators]: decision({
    id: scopeDecisionIds.interferersAndSpectators,
    category: "interferers-and-spectators",
    version: 1,
    reason: "Interferers and spectators are not participants in the active local 1v1 combat state.",
    futureOwner: "combat-engine future multi-combat scope",
  }),
  [scopeDecisionIds.remoteAndRelationshipTargets]: decision({
    id: scopeDecisionIds.remoteAndRelationshipTargets,
    category: "remote-and-relationship-targets",
    version: 1,
    reason:
      "Remote, same-planet, relationship-based, and non-combatant targets are absent from the local 1v1 target model.",
    futureOwner: "combat-engine future participant and target scope",
  }),
  [scopeDecisionIds.escapeActionsAndRollConfiguration]: decision({
    id: scopeDecisionIds.escapeActionsAndRollConfiguration,
    category: "escape-actions-and-roll-configuration",
    version: 1,
    reason:
      "Escape actions and escape-roll configuration remain excluded until an explicit escape transition exists.",
    futureOwner: "combat-engine future escape transition",
  }),
  [scopeDecisionIds.bodyMutation]: decision({
    id: scopeDecisionIds.bodyMutation,
    category: "body-mutation",
    version: 1,
    reason: "Body swapping changes character identity and is not temporary local combat state.",
    futureOwner: "combat-engine future identity-aware combat scope",
  }),
  [scopeDecisionIds.ownershipMutation]: decision({
    id: scopeDecisionIds.ownershipMutation,
    category: "ownership-mutation",
    version: 1,
    reason:
      "Equipment ownership and loadout mutation remain outside the temporary local combat state.",
    futureOwner: "character and inventory ownership boundary",
  }),
  [scopeDecisionIds.racialTraitMutation]: decision({
    id: scopeDecisionIds.racialTraitMutation,
    category: "racial-trait-mutation",
    version: 1,
    reason: "Acquiring or changing racial traits mutates identity rather than combat state.",
    futureOwner: "character identity and race boundary",
  }),
  [scopeDecisionIds.movesetMutation]: decision({
    id: scopeDecisionIds.movesetMutation,
    category: "moveset-mutation",
    version: 1,
    reason:
      "Acquiring, removing, or reassigning moves and styles is ability ownership mutation outside local combat.",
    futureOwner: "character moveset and style boundary",
  }),
  [scopeDecisionIds.identityMutation]: decision({
    id: scopeDecisionIds.identityMutation,
    category: "identity-mutation",
    version: 1,
    reason:
      "Temporary mastery or other identity acquisition is outside the local combat state contract.",
    futureOwner: "character identity and mastery boundary",
  }),
  [scopeDecisionIds.progressionAndStatAcquisition]: decision({
    id: scopeDecisionIds.progressionAndStatAcquisition,
    category: "progression-and-stat-acquisition",
    version: 1,
    reason:
      "Permanent progression, training, rewards, and stat acquisition belong to the character or campaign state rather than temporary combat state.",
    futureOwner: "character progression and campaign state boundary",
  }),
  [scopeDecisionIds.administratorAndNarrative]: decision({
    id: scopeDecisionIds.administratorAndNarrative,
    category: "administrator-and-narrative",
    version: 1,
    reason:
      "Administrator-mediated, narrative, and campaign choices are not deterministic local 1v1 combat mechanics.",
    futureOwner: "campaign and administrator boundary",
  }),
  [scopeDecisionIds.planetaryDestruction]: decision({
    id: scopeDecisionIds.planetaryDestruction,
    category: "planetary-destruction",
    version: 1,
    reason:
      "Planetary destruction is a world-state consequence outside the local deterministic 1v1 combat state.",
    futureOwner: "world and campaign state boundary",
  }),
  [scopeDecisionIds.spaceshipCombat]: decision({
    id: scopeDecisionIds.spaceshipCombat,
    category: "spaceship-combat",
    version: 1,
    reason: "Spaceship combat is a separate combat scope from local character 1v1 combat.",
    futureOwner: "combat-engine future spaceship combat scope",
  }),
  [scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid]: decision({
    id: scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid,
    category: "spaceship-travel-storage-capacity-and-raid",
    version: 1,
    reason:
      "Spaceship travel, storage, capacity, operation, and raid mechanics are noncombat progression or inventory behavior.",
    futureOwner: "future spaceship progression and inventory boundary",
  }),
} as const satisfies Readonly<Record<ScopeDecisionId, ScopeDecision>>;

export type RegisteredScopeDecisionId = keyof typeof scopeDecisionRegistry;

export const registeredScopeDecisions = Object.values(scopeDecisionRegistry);

export const scopeDecisionForId = (id: string): ScopeDecision | undefined =>
  scopeDecisionRegistry[id as RegisteredScopeDecisionId];

interface ScopeEffectLike {
  readonly type?: unknown;
  readonly target?: unknown;
  readonly roll?: unknown;
  readonly affectedType?: unknown;
  readonly operation?: unknown;
  readonly activity?: unknown;
  readonly sourceText?: unknown;
}

const textOf = (effect: ScopeEffectLike): string =>
  typeof effect.sourceText === "string" ? effect.sourceText : "";

const hasText = (effect: ScopeEffectLike, pattern: RegExp): boolean => pattern.test(textOf(effect));

export const scopeDecisionForItemStateRuleOperation = (
  operation: unknown,
): ScopeDecision | undefined => {
  switch (operation) {
    case "prevent-interference":
      return scopeDecisionRegistry[scopeDecisionIds.interferersAndSpectators];
    case "select-escape-roll-modifier":
      return scopeDecisionRegistry[scopeDecisionIds.escapeActionsAndRollConfiguration];
    case "allow-target-item-attack":
    case "destroy-item-on-roll-threshold":
      return scopeDecisionRegistry[scopeDecisionIds.remoteAndRelationshipTargets];
    case "disable-selected-item-copies":
    case "limit-space-combat-item-use":
    case "roll-space-combat-dice":
    case "set-space-combat-starting-hp":
    case "roll-first-advanced-attack-twice-lower":
    case "cap-hp-at-precombat-value":
      return scopeDecisionRegistry[scopeDecisionIds.spaceshipCombat];
    case "grant-ship-storage-access":
    case "transfer-stored-items-on-raid":
    case "increase-other-ship-travel-time":
    case "restrict-space-quest-work":
    case "waive-ship-pilot-requirement":
      return scopeDecisionRegistry[scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid];
    case "grant-transformation-roll-sides":
      return undefined;
    default:
      return undefined;
  }
};

const scopeDecisionForCombatSpecialCase = (
  effect: ScopeEffectLike,
  type: string | undefined,
  target: string | undefined,
  roll: string | undefined,
  affectedType: string | undefined,
): ScopeDecision | undefined => {
  if (type === "join-attack")
    return target === "remote-target"
      ? scopeDecisionRegistry[scopeDecisionIds.remoteAndRelationshipTargets]
      : scopeDecisionRegistry[scopeDecisionIds.alliesAndJointAttacks];
  if (type === "grant-defense-response")
    return target === "interferers"
      ? scopeDecisionRegistry[scopeDecisionIds.interferersAndSpectators]
      : undefined;
  if (type === "grant-escape-roll" || (type === "lock" && affectedType === "escape"))
    return scopeDecisionRegistry[scopeDecisionIds.escapeActionsAndRollConfiguration];
  if (type === "modify-roll" && roll === "escape")
    return scopeDecisionRegistry[scopeDecisionIds.escapeActionsAndRollConfiguration];
  return undefined;
};

const scopeDecisionForCombatEffect = (
  effect: ScopeEffectLike,
  type: string | undefined,
  target: string | undefined,
  roll: string | undefined,
  affectedType: string | undefined,
): ScopeDecision | undefined => {
  const directDecision =
    type === undefined
      ? undefined
      : {
          "grant-equipment": scopeDecisionRegistry[scopeDecisionIds.ownershipMutation],
          "grant-mastery": scopeDecisionRegistry[scopeDecisionIds.identityMutation],
          "grant-racial-traits": scopeDecisionRegistry[scopeDecisionIds.racialTraitMutation],
          "grant-temporary-move-use": scopeDecisionRegistry[scopeDecisionIds.movesetMutation],
          "override-style-reference": scopeDecisionRegistry[scopeDecisionIds.movesetMutation],
          "swap-combatant-state": scopeDecisionRegistry[scopeDecisionIds.bodyMutation],
        }[type];
  const specialCase = scopeDecisionForCombatSpecialCase(effect, type, target, roll, affectedType);
  if (directDecision !== undefined) return directDecision;
  if (specialCase !== undefined) return specialCase;
  if (type === "modify-resource" && target === "ally")
    return scopeDecisionRegistry[scopeDecisionIds.alliesAndJointAttacks];
  if (target === "remote-target")
    return scopeDecisionRegistry[scopeDecisionIds.remoteAndRelationshipTargets];
  if (
    type === "modify-move-classification" &&
    hasText(effect, /chosen techniques|considered Haokiru|style reassignment/iu)
  )
    return scopeDecisionRegistry[scopeDecisionIds.movesetMutation];
  if (type === "modify-move-requirements" && hasText(effect, /loadout|sword weapon/iu))
    return scopeDecisionRegistry[scopeDecisionIds.ownershipMutation];
  return undefined;
};

const scopeDecisionForItemEffect = (
  effect: ScopeEffectLike,
  type: string | undefined,
  roll: string | undefined,
): ScopeDecision | undefined => {
  if (type === "item-state-rule") {
    const stateRuleDecision = scopeDecisionForItemStateRuleOperation(effect.operation);
    if (stateRuleDecision !== undefined) return stateRuleDecision;
    if (
      effect.operation === "grant-transformation-roll-sides" &&
      /ship|sparring/iu.test(textOf(effect))
    )
      return scopeDecisionRegistry[scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid];
  }
  if (type === "item-space-combat") return scopeDecisionRegistry[scopeDecisionIds.spaceshipCombat];
  if (
    type === "item-modify-inventory-capacity" ||
    type === "item-modify-ship-capacity" ||
    type === "item-grant-travel-permission"
  )
    return scopeDecisionRegistry[scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid];
  if (type === "item-reduce-duration" && effect.activity === "ship-travel")
    return scopeDecisionRegistry[scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid];
  if (type === "item-modify-roll" && roll === "escape")
    return scopeDecisionRegistry[scopeDecisionIds.escapeActionsAndRollConfiguration];
  return undefined;
};

export const scopeDecisionForEffect = (effect: ScopeEffectLike): ScopeDecision | undefined => {
  const type = typeof effect.type === "string" ? effect.type : undefined;
  const target = typeof effect.target === "string" ? effect.target : undefined;
  const roll = typeof effect.roll === "string" ? effect.roll : undefined;
  const affectedType = typeof effect.affectedType === "string" ? effect.affectedType : undefined;
  return (
    scopeDecisionForCombatEffect(effect, type, target, roll, affectedType) ??
    scopeDecisionForItemEffect(effect, type, roll)
  );
};

/** Classifies source-only clauses without making source prose executable. */
/* eslint-disable sonarjs/cognitive-complexity -- ordered scope routing keeps exclusions auditable. */
export const scopeDecisionForSourceText = (sourceText: string): ScopeDecision | undefined => {
  if (/planetary destruction|\[DESTROY\]|destroy effect/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.planetaryDestruction];
  if (
    /Extra Moves|moveset|move to your Extra Moves|do not already know|know that move|considered to know|created technique|technique you created|considered your style|effects referring to style/iu.test(
      sourceText,
    )
  )
    return scopeDecisionRegistry[scopeDecisionIds.movesetMutation];
  if (/Ki cost is lowered by 1 to a minimum of 0/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.movesetMutation];
  if (
    /inventory|equipment|item ownership|item slots|worn item|worn-item|take one|surrender/iu.test(
      sourceText,
    )
  )
    return scopeDecisionRegistry[scopeDecisionIds.ownershipMutation];
  if (/spaceship|space combat|ship|addons/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.spaceshipTravelStorageCapacityAndRaid];
  if (/Dragon Ball in your possession/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.ownershipMutation];
  if (/minion/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.alliesAndJointAttacks];
  if (/^Before round one, choose a number\.?$/iu.test(sourceText.trim()))
    return scopeDecisionRegistry[scopeDecisionIds.administratorAndNarrative];
  if (/cannot have the .* trait|cannot have .* class|racial trait/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.racialTraitMutation];
  if (
    /choose one of the .*classes|choose a planet|choose a number|start the game with .*item|start with .*item|start with .*weapon|requires \d+\+? lbs/iu.test(
      sourceText,
    )
  )
    return scopeDecisionRegistry[scopeDecisionIds.ownershipMutation];
  const normalizedSourceText = sourceText.toLowerCase();
  if (/^permanent \+\d+% to all stats\.?$/iu.test(sourceText.trim()))
    return scopeDecisionRegistry[scopeDecisionIds.progressionAndStatAcquisition];
  if (
    [
      "administrator",
      "character creation",
      "custom",
      "story",
      "saga",
      "roleplay",
      "guardian",
      "tournament",
      "source does not define",
      "choose mercy",
      "must accept challenges",
      "only one active",
      "spares their life",
      "shown mercy",
      "willingly",
    ].some((term) => normalizedSourceText.includes(term))
  )
    return scopeDecisionRegistry[scopeDecisionIds.administratorAndNarrative];
  if (
    [
      "exp",
      "training",
      "learn",
      "acquire",
      "quest",
      "week",
      "day",
      "travel",
      "wpd",
      "zenni",
      "afterlife",
      "dead zone",
      "reward",
      "reproduction",
      "recover rate",
    ].some((term) => normalizedSourceText.includes(term)) ||
    /\dz/iu.test(sourceText) ||
    (normalizedSourceText.includes("transformation") &&
      (normalizedSourceText.includes("start") || normalizedSourceText.includes("unlock"))) ||
    (normalizedSourceText.includes("requires") && normalizedSourceText.includes("lbs"))
  )
    return scopeDecisionRegistry[scopeDecisionIds.progressionAndStatAcquisition];
  if (/interfer(?:e|ence|ing)|spectator/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.interferersAndSpectators];
  if (
    /same[- ]planet|partner agrees|another character|take your place|call an opponent/iu.test(
      sourceText,
    )
  )
    return scopeDecisionRegistry[scopeDecisionIds.remoteAndRelationshipTargets];
  if (/escape/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.escapeActionsAndRollConfiguration];
  if (/switch bod(?:y|ies)|bodyguard/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.bodyMutation];
  if (/racial trait|genetic composition/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.racialTraitMutation];
  if (
    /moveset|move set|styled moves|style changes|add moves|refer to style|USS option remains/iu.test(
      sourceText,
    )
  )
    return scopeDecisionRegistry[scopeDecisionIds.movesetMutation];
  if (/^(?:That|Those) attack(?:s)? cost(?:s)? -1 Ki/iu.test(sourceText))
    return scopeDecisionRegistry[scopeDecisionIds.movesetMutation];
  return undefined;
};
/* eslint-enable sonarjs/cognitive-complexity */

export const scopeDecisionMetadata = (scopeDecision: ScopeDecision | undefined) =>
  scopeDecision === undefined
    ? {}
    : {
        scopeDecisionId: scopeDecision.id,
        scopeDecisionCategory: scopeDecision.category,
      };
