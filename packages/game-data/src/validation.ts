import { TRANSFORMATION_MASTERY } from "./shared/constants.js";
import type { GameDataDocument, MoveDefinition, TransformationDefinition } from "./shared/types.js";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const transformationMasteries = Object.values(TRANSFORMATION_MASTERY);

export const validateGameDataDocuments = (
  documents: readonly GameDataDocument[],
): readonly string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const document of documents) {
    if (!idPattern.test(document.id)) {
      errors.push(`Invalid game-data document ID: ${document.id}`);
    }
    if (ids.has(document.id)) {
      errors.push(`Duplicate game-data document ID: ${document.id}`);
    }
    ids.add(document.id);

    if (!document.sourcePath.startsWith("reference/")) {
      errors.push(`Invalid game-data source path: ${document.sourcePath}`);
    }
    if (document.content.trim().length === 0) {
      errors.push(`Empty game-data document: ${document.id}`);
    }
  }

  return errors;
};

export const validateMoveDefinitions = (moves: readonly MoveDefinition[]): readonly string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const move of moves) {
    if (!idPattern.test(move.id)) errors.push(`Invalid move ID: ${move.id}`);
    if (ids.has(move.id)) errors.push(`Duplicate move ID: ${move.id}`);
    ids.add(move.id);

    if (!move.source.path.startsWith("reference/moves/")) {
      errors.push(`Invalid move source path: ${move.id}`);
    }
    if (move.effectText.trim().length === 0) errors.push(`Missing effect text: ${move.id}`);
    if (move.effectClauses.length === 0) errors.push(`Missing effect clauses: ${move.id}`);
    for (const [index, clause] of move.effectClauses.entries()) {
      if (clause.order !== index + 1 || !move.effectText.includes(clause.text)) {
        errors.push(`Invalid effect clause: ${move.id}`);
      }
    }
    const { mechanics } = move;
    for (const value of [
      mechanics.kiCost,
      mechanics.restrictedUses,
      mechanics.attack?.baseDamagePercent,
    ]) {
      if (value?.type === "literal" && value.value < 0) {
        errors.push(`Negative move mechanic value: ${move.id}`);
      }
    }
    if (
      mechanics.attack?.attackRoll !== undefined &&
      (mechanics.attack.attackRoll.dice <= 0 || mechanics.attack.attackRoll.sides <= 0)
    ) {
      errors.push(`Invalid attack roll: ${move.id}`);
    }
    for (const effect of move.effects ?? []) {
      if (!move.effectText.includes(effect.sourceText)) {
        errors.push(`Structured effect source is not in effect text: ${move.id}`);
      }
      for (const condition of effect.conditions ?? []) {
        if (!effect.sourceText.includes(condition.sourceText)) {
          errors.push(`Effect condition source is not in effect text: ${move.id}`);
        }
      }
      if (effect.type === "lock" || effect.type === "apply-status") {
        if (
          effect.duration !== undefined &&
          !effect.sourceText.includes(effect.duration.sourceText)
        ) {
          errors.push(`Effect duration source is not in effect text: ${move.id}`);
        }
      }
    }
  }

  return errors;
};

export const validateTransformationDefinitions = (
  transformations: readonly TransformationDefinition[],
): readonly string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const transformation of transformations) {
    if (!idPattern.test(transformation.id)) {
      errors.push(`Invalid transformation ID: ${transformation.id}`);
    }
    if (!idPattern.test(transformation.raceId)) {
      errors.push(`Invalid transformation race ID: ${transformation.id}`);
    }
    if (ids.has(transformation.id)) {
      errors.push(`Duplicate transformation ID: ${transformation.id}`);
    }
    ids.add(transformation.id);

    if (
      !Number.isInteger(transformation.tier) ||
      transformation.tier < 1 ||
      transformation.tier > 4
    ) {
      errors.push(`Invalid transformation tier: ${transformation.id}`);
    }
    if (!transformation.source.path.startsWith("reference/races.transformations/")) {
      errors.push(`Invalid transformation source path: ${transformation.id}`);
    }

    for (const modifier of Object.values(transformation.statModifiers)) {
      if (!Number.isFinite(modifier)) {
        errors.push(`Invalid transformation stat modifier: ${transformation.id}`);
        break;
      }
    }

    for (const mastery of transformationMasteries) {
      const ability = transformation.abilities[mastery];
      if (ability.name !== undefined && ability.name.trim().length === 0) {
        errors.push(`Invalid ${mastery} Transformation Ability name: ${transformation.id}`);
      }
      if (ability.effects.length === 0) {
        errors.push(`Missing ${mastery} Transformation Ability effects: ${transformation.id}`);
      }
    }
  }

  return errors;
};
