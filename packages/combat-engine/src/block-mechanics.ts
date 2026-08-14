import type { MoveDefinition } from "@dragonball-resurgence/game-data";

import { calculateBlockKiCost } from "./combat-mechanics.js";

export interface BlockableAttack {
  readonly attackType: "physical" | "energy";
  readonly additionalAttackTypes?: readonly ("physical" | "energy")[];
  readonly tags: readonly string[];
  readonly restricted: boolean;
}

export interface BlockEligibility {
  readonly canDeclare: boolean;
  readonly stopsAttack: boolean;
}

/**
 * Evaluates a converted Block against the declared attack. Restricted attacks
 * may still receive the Block's own effects, but the global rules prevent the
 * Block from stopping them.
 */
export const evaluateBlockEligibility = (
  block: MoveDefinition,
  attack: BlockableAttack,
): BlockEligibility => {
  const mechanics = block.mechanics.block;
  if (block.category !== "block" || mechanics === undefined) {
    return { canDeclare: false, stopsAttack: false };
  }

  const attackTypes = [attack.attackType, ...(attack.additionalAttackTypes ?? [])];
  const typeMatches =
    mechanics.allowedAttackTypes?.some((type) => attackTypes.includes(type)) ?? false;
  const tagMatches = mechanics.allowedAttackTags?.some((tag) => attack.tags.includes(tag)) ?? false;
  const canDeclare = typeMatches || tagMatches;
  return { canDeclare, stopsAttack: canDeclare && !attack.restricted };
};

/** Calculates a converted Block's X±N cost, respecting the global minimum. */
export const calculateConvertedBlockCost = (block: MoveDefinition, attackBaseKiCost: number) => {
  const mechanics = block.mechanics.block;
  if (block.category !== "block" || mechanics === undefined) return undefined;
  return calculateBlockKiCost(attackBaseKiCost, mechanics.baseCostAdjustment);
};
