import type { MoveDefinition, MoveSelectorCondition } from "@dragonball-resurgence/game-data";
import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";

const isConstantSkill = (move: MoveDefinition) =>
  move.category === "skill" && move.effectClauses.some((clause) => clause.text === "Constant.");

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
  (selector.custom === undefined || (move.styleId === undefined) === selector.custom) &&
  (selector.restriction === undefined ||
    (move.mechanics.restrictedUses !== undefined) === (selector.restriction === "restricted")) &&
  (selector.constant === undefined || selector.constant === isConstantSkill(move));

const matchesTextAndRequirements = (move: MoveDefinition, selector: MoveSelectorCondition) => {
  const requirements = move.requirements ?? [];
  const sourceTextRequirements = requirements
    .filter((requirement) => requirement.type === "source-text")
    .map((requirement) => requirement.text.toLowerCase());
  return (
    (selector.effectTextIncludes === undefined ||
      move.effectText.includes(selector.effectTextIncludes)) &&
    (selector.effectTextIncludesAny === undefined ||
      selector.effectTextIncludesAny.some((text) => move.effectText.includes(text))) &&
    (selector.effectTextExcludes === undefined ||
      !move.effectText.includes(selector.effectTextExcludes)) &&
    (selector.requirementIncludes === undefined ||
      selector.requirementIncludes.every((required) =>
        sourceTextRequirements.some((text) => text.includes(required.toLowerCase())),
      )) &&
    (selector.requirementExcludes === undefined ||
      selector.requirementExcludes.every(
        (excluded) => !sourceTextRequirements.some((text) => text.includes(excluded.toLowerCase())),
      ))
  );
};

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
