import type { MoveDefinition, MoveSelectorCondition } from "@dragonball-resurgence/game-data";
import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

const isConstantSkill = (move: MoveDefinition) =>
  move.category === "skill" && move.mechanics.activationClassification === "constant";

const compare = (left: number, comparison: "at-least" | "at-most" | "exactly", right: number) => {
  if (comparison === "at-least") return left >= right;
  if (comparison === "at-most") return left <= right;
  return left === right;
};

const matchesIdentity = (move: MoveDefinition, selector: MoveSelectorCondition) =>
  (selector.ids === undefined || selector.ids.includes(move.id)) &&
  (selector.styleId === undefined || selector.styleId === move.styleId) &&
  (selector.styleIdExcludes === undefined || selector.styleIdExcludes !== move.styleId) &&
  (selector.category === undefined || selector.category === move.category) &&
  (selector.categories === undefined || selector.categories.includes(move.category)) &&
  !selector.categoryExcludes?.includes(move.category);

const matchesTagsAndClassification = (move: MoveDefinition, selector: MoveSelectorCondition) =>
  (selector.tags === undefined ||
    selector.tags.every((tag) => move.tags.includes(tag as (typeof move.tags)[number]))) &&
  (selector.titleTags === undefined ||
    selector.titleTags.every((tag) => move.mechanics.titleTags?.includes(tag) === true)) &&
  (selector.custom === undefined || (move.styleId === undefined) === selector.custom) &&
  (selector.restriction === undefined ||
    (move.mechanics.restrictedUses !== undefined) === (selector.restriction === "restricted")) &&
  (selector.constant === undefined || selector.constant === isConstantSkill(move));

const matchesTextAndRequirements = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  // Legacy prose selectors remain readable for snapshot diagnostics, but are
  // intentionally non-executable until converted to typed dimensions.
  if (hasLegacyProseSelector(selector)) return false;
  const requirementTags = new Set(move.mechanics.requirementTags ?? []);
  const ruleTokens = new Set<string>([
    ...move.effectClauses.flatMap((clause) => clause.ruleTokens),
    ...(move.mechanics.effectRuleTokens ?? []),
  ]);
  return (
    (selector.effectRuleTokens === undefined ||
      selector.effectRuleTokens.every((token) => ruleTokens.has(token))) &&
    (selector.effectRuleTokensAny === undefined ||
      selector.effectRuleTokensAny.some((token) => ruleTokens.has(token))) &&
    (selector.requirementTagsInclude === undefined ||
      selector.requirementTagsInclude.every((required) =>
        requirementTags.has(required.toLowerCase()),
      )) &&
    (selector.requirementTagsExclude === undefined ||
      selector.requirementTagsExclude.every(
        (excluded) => !requirementTags.has(excluded.toLowerCase()),
      ))
  );
};

/** Legacy prose selectors are readable for migration diagnostics, never executable. */
export const hasLegacyProseSelector = (selector: MoveSelectorCondition): boolean =>
  selector.effectTextIncludes !== undefined ||
  selector.effectTextIncludesAny !== undefined ||
  selector.effectTextExcludes !== undefined ||
  selector.requirementIncludes !== undefined ||
  selector.requirementExcludes !== undefined;

const matchesAttackRoll = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  if (selector.attackRoll === undefined) return true;
  const attack = move.mechanics.attack;
  if (attack === undefined) return false;
  const dice = attack.attackRoll?.dice ?? 1;
  const sides = attack.attackRoll?.sides ?? GLOBAL_RULES.combat.standardDieSides;
  return (
    (selector.attackRoll.dice === undefined || dice === selector.attackRoll.dice) &&
    (selector.attackRoll.minimumDice === undefined || dice >= selector.attackRoll.minimumDice) &&
    (selector.attackRoll.sides === undefined || sides === selector.attackRoll.sides) &&
    (selector.attackRoll.maximumSides === undefined || sides <= selector.attackRoll.maximumSides)
  );
};

const matchesCost = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  if (selector.baseKiCost === undefined) return true;
  const cost = move.mechanics.kiCost;
  const requested = selector.baseKiCost.value;
  return (
    cost?.type === "literal" &&
    requested.type === "literal" &&
    compare(cost.value, selector.baseKiCost.comparison, requested.value)
  );
};

const hasEffectKind = (move: MoveDefinition, kind: "resource-loss" | "roll-side-reduction") =>
  (move.effects ?? []).some((effect) => {
    if (kind === "resource-loss") {
      return (
        effect.type === "modify-resource" &&
        (effect.operation === "lose" || effect.operation === "drain")
      );
    }
    return (
      effect.type === "modify-roll" &&
      effect.modifier === "sides" &&
      (effect.amount?.type !== "literal" || effect.amount.value < 0)
    );
  });

/**
 * Matches all move-local selector dimensions in one place. Contextual fields
 * such as `subject`, `styleProvenance`, and `selectionKey` are intentionally
 * evaluated by candidate resolution, where combat state is available.
 */
export const matchesMoveSelector = (move: MoveDefinition, selector: MoveSelectorCondition) =>
  matchesIdentity(move, selector) &&
  matchesTagsAndClassification(move, selector) &&
  matchesTextAndRequirements(move, selector) &&
  matchesAttackRoll(move, selector) &&
  matchesCost(move, selector) &&
  (selector.effectKinds === undefined ||
    selector.effectKinds.every((kind) => hasEffectKind(move, kind)));
