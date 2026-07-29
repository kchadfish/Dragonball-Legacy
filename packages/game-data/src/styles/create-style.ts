import { MOVE_SOURCE_DEFINITIONS } from "../move-source-definitions.js";
import type { StyleDefinition } from "../shared/types.js";

export const createStyleDefinition = (
  definition: Omit<
    StyleDefinition,
    | "masteryMoveIds"
    | "skillMoveIds"
    | "advancedAttackMoveIds"
    | "signatureMoveIds"
    | "blockMoveIds"
  >,
): StyleDefinition => {
  const moves = MOVE_SOURCE_DEFINITIONS.filter(
    (move) => move.source.path === definition.source.path,
  );
  const byCategory = (category: NonNullable<(typeof moves)[number]["category"]>) =>
    moves.filter((move) => move.category === category).map((move) => move.id);

  return {
    ...definition,
    masteryMoveIds: byCategory("mastery"),
    skillMoveIds: byCategory("skill"),
    advancedAttackMoveIds: byCategory("advanced-attack"),
    signatureMoveIds: byCategory("signature"),
    blockMoveIds: byCategory("block"),
  };
};
