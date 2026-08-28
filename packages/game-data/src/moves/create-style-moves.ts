import { MOVE_SOURCE_DEFINITIONS } from "../move-source-definitions.js";
import { ATTACK_TAG } from "../shared/constants.js";
import type { MoveDefinition, StyleDefinition } from "../shared/types.js";

const attackTagBySourceTag = {
  PHYSICAL: ATTACK_TAG.PHYSICAL,
  ENERGY: ATTACK_TAG.ENERGY,
  PUNCH: ATTACK_TAG.PUNCH,
  KICK: ATTACK_TAG.KICK,
  BEAM: ATTACK_TAG.BEAM,
  BLAST: ATTACK_TAG.BLAST,
  VOLLEY: ATTACK_TAG.VOLLEY,
  WEAPON: ATTACK_TAG.WEAPON,
  HOLD: ATTACK_TAG.HOLD,
  THROW: ATTACK_TAG.THROW,
} as const;

export const createMovesForSource = ({
  sourcePath,
  styleId,
}: {
  readonly sourcePath: string;
  readonly styleId?: MoveDefinition["styleId"];
}): readonly MoveDefinition[] =>
  MOVE_SOURCE_DEFINITIONS.filter((move) => move.source.path === sourcePath).map((sourceMove) => {
    if (sourceMove.category === undefined)
      throw new Error(`Move is missing a category: ${sourceMove.id}`);
    return {
      id: sourceMove.id,
      name: sourceMove.name,
      ...(styleId === undefined ? {} : { styleId }),
      category: sourceMove.category,
      tags: sourceMove.declaredTags.flatMap((tag) => {
        if (!Object.hasOwn(attackTagBySourceTag, tag)) return [];
        return [attackTagBySourceTag[tag as keyof typeof attackTagBySourceTag]];
      }),
      description: sourceMove.description,
      effectText: sourceMove.effectText,
      effectClauses: sourceMove.effectClauses,
      mechanics: {
        ...sourceMove.mechanics,
        ...(sourceMove.name.toLowerCase().includes("straining")
          ? { titleTags: ["straining"] }
          : {}),
        ...(sourceMove.effectText.trimStart().startsWith("Constant.")
          ? { activationClassification: "constant" as const }
          : {}),
      },
      ...(sourceMove.requirementsText === "None"
        ? {}
        : {
            requirements: [{ type: "source-text" as const, text: sourceMove.requirementsText }],
          }),
      ...(sourceMove.trainingDays === undefined ? {} : { trainingDays: sourceMove.trainingDays }),
      source: sourceMove.source,
    };
  });

export const createStyleMoves = (style: StyleDefinition): readonly MoveDefinition[] =>
  createMovesForSource({ sourcePath: style.source.path, styleId: style.id });
