import { TRANSFORMATION_MASTERY } from "./shared/constants.js";
import type {
  GameDataDocument,
  ItemDefinition,
  LocationDefinition,
  MoveDefinition,
  NpcDefinition,
  QuestDefinition,
  QuestEncounterDefinition,
  RuleSectionDefinition,
  SagaDefinition,
  TrainerDefinition,
  TransformationDefinition,
} from "./shared/types.js";

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

export const validateItemDefinitions = (items: readonly ItemDefinition[]): readonly string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const item of items) {
    if (!idPattern.test(item.id) || !item.id.startsWith("item-")) {
      errors.push(`Invalid item ID: ${item.id}`);
    }
    if (ids.has(item.id)) errors.push(`Duplicate item ID: ${item.id}`);
    ids.add(item.id);

    if (item.name.trim().length === 0) errors.push(`Missing item name: ${item.id}`);
    if (item.description.trim().length === 0) errors.push(`Missing item description: ${item.id}`);
    if (item.effectText.trim().length === 0) errors.push(`Missing item effect text: ${item.id}`);
    if (item.effectClauses.length === 0) errors.push(`Missing item effect clauses: ${item.id}`);
    if (item.rules.length !== item.effectClauses.length) {
      errors.push(`Item rules do not cover every effect clause: ${item.id}`);
    }
    for (const [index, clause] of item.effectClauses.entries()) {
      if (clause.order !== index + 1 || !item.effectText.includes(clause.text)) {
        errors.push(`Invalid item effect clause: ${item.id}`);
      }
    }
    for (const rule of item.rules) {
      if (!item.effectText.includes(rule.sourceText)) {
        errors.push(`Item rule source is not in effect text: ${item.id}`);
      }
      if (!rule.executable && rule.unresolvedReason === undefined) {
        errors.push(`Unresolved item rule is not classified: ${item.id}:${rule.sourceText}`);
      }
      if (rule.executable && rule.unresolvedReason !== undefined) {
        errors.push(
          `Executable item rule has unresolved classification: ${item.id}:${rule.sourceText}`,
        );
      }
      if (
        rule.executable &&
        !(item.effects ?? []).some(
          (effect) =>
            rule.sourceText.includes(effect.sourceText) ||
            effect.sourceText.includes(rule.sourceText),
        )
      ) {
        errors.push(`Executable item rule is not structured: ${item.id}:${rule.sourceText}`);
      }
    }
    for (const effect of item.effects ?? []) {
      if (!item.effectText.includes(effect.sourceText)) {
        errors.push(`Item effect source is not in effect text: ${item.id}`);
      }
    }
    if (!Number.isInteger(item.inventorySlots) || item.inventorySlots < 0) {
      errors.push(`Invalid item inventory slots: ${item.id}`);
    }
    if (item.price !== undefined && (!Number.isInteger(item.price) || item.price < 0)) {
      errors.push(`Invalid item price: ${item.id}`);
    }
    if (item.maxUses !== undefined && (!Number.isInteger(item.maxUses) || item.maxUses < 1)) {
      errors.push(`Invalid item maximum uses: ${item.id}`);
    }
    if (item.locations.some((location) => location.trim().length === 0)) {
      errors.push(`Invalid item location: ${item.id}`);
    }
    if (item.availability === "listed" && item.locations.length === 0) {
      errors.push(`Missing listed item locations: ${item.id}`);
    }
    if (item.availability !== "listed" && item.locations.length > 0) {
      errors.push(`Unexpected item locations: ${item.id}`);
    }
    if (!item.source.path.startsWith("reference/items/")) {
      errors.push(`Invalid item source path: ${item.id}`);
    }
    if (!item.source.text.includes(item.name)) {
      errors.push(`Item source does not contain its name: ${item.id}`);
    }
    if (item.category === "ship" && item.ship === undefined) {
      errors.push(`Missing ship details: ${item.id}`);
    }
    if (item.ship !== undefined) {
      for (const value of [
        item.ship.maximumCapacity,
        item.ship.weaponSlots,
        item.ship.defenseSlots,
        item.ship.travelDays,
      ]) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
          errors.push(`Invalid ship detail: ${item.id}`);
          break;
        }
      }
    }
  }

  return errors;
};

export const validateLocationDefinitions = (
  locations: readonly LocationDefinition[],
): readonly string[] => {
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const location of locations) {
    if (!idPattern.test(location.id) || !location.id.startsWith("location-"))
      errors.push(`Invalid location ID: ${location.id}`);
    if (ids.has(location.id)) errors.push(`Duplicate location ID: ${location.id}`);
    ids.add(location.id);
    if (location.name.trim().length === 0 || location.description.trim().length === 0)
      errors.push(`Incomplete location: ${location.id}`);
    if (!location.source.path.startsWith("reference/planet/"))
      errors.push(`Invalid location source path: ${location.id}`);
  }
  return errors;
};

export const validateTrainerDefinitions = (
  trainers: readonly TrainerDefinition[],
  moves: readonly MoveDefinition[],
): readonly string[] => {
  const moveIds = new Set(moves.map((move) => move.id));
  const errors: string[] = [];
  for (const trainer of trainers) {
    if (!idPattern.test(trainer.id) || !trainer.id.startsWith("trainer-"))
      errors.push(`Invalid trainer ID: ${trainer.id}`);
    if (trainer.name.trim().length === 0 || trainer.styleName.trim().length === 0)
      errors.push(`Incomplete trainer: ${trainer.id}`);
    if (!trainer.source.path.endsWith("locations-and-trainers.md"))
      errors.push(`Invalid trainer source path: ${trainer.id}`);
    for (const moveId of trainer.moveIds)
      if (!moveIds.has(moveId)) errors.push(`Unknown trainer move: ${trainer.id}:${moveId}`);
  }
  return errors;
};

export const validateNpcDefinitions = (
  npcs: readonly NpcDefinition[],
  moves: readonly MoveDefinition[],
): readonly string[] => {
  const ids = new Set<string>();
  const moveIds = new Set(moves.map((move) => move.id));
  const errors: string[] = [];
  for (const npc of npcs) {
    if (!idPattern.test(npc.id) || !npc.id.startsWith("npc-"))
      errors.push(`Invalid NPC ID: ${npc.id}`);
    if (ids.has(npc.id)) errors.push(`Duplicate NPC ID: ${npc.id}`);
    ids.add(npc.id);
    if (npc.name.trim().length === 0) errors.push(`Missing NPC name: ${npc.id}`);
    if (!npc.source.path.startsWith("reference/quests/"))
      errors.push(`Invalid NPC source path: ${npc.id}`);
    if (npc.combatProfile?.levelText.trim().length === 0)
      errors.push(`Missing NPC level: ${npc.id}`);
    for (const stat of [
      npc.combatProfile?.hitPoints,
      npc.combatProfile?.power,
      npc.combatProfile?.dexterity,
    ]) {
      if (stat !== undefined && stat.sourceText.trim().length === 0)
        errors.push(`Invalid NPC stat source: ${npc.id}`);
    }
    for (const moveId of npc.moveIds)
      if (!moveIds.has(moveId)) errors.push(`Unknown NPC move: ${npc.id}:${moveId}`);
  }
  return errors;
};

export const validateQuestDefinitions = (
  quests: readonly QuestDefinition[],
  moves: readonly MoveDefinition[],
  items: readonly ItemDefinition[],
): readonly string[] => {
  const moveIds = new Set(moves.map((move) => move.id));
  const itemIds = new Set(items.map((item) => item.id));
  const errors: string[] = [];
  for (const quest of quests) {
    if (!idPattern.test(quest.id) || !quest.id.startsWith("quest-"))
      errors.push(`Invalid quest ID: ${quest.id}`);
    if (!quest.source.path.startsWith("reference/quests/"))
      errors.push(`Invalid quest source path: ${quest.id}`);
    for (const reward of quest.rewards) {
      if (!quest.rewardsText.includes(reward.sourceText))
        errors.push(`Quest reward is not source-traceable: ${quest.id}`);
      if (reward.type === "grant-zenni" && reward.amount < 0)
        errors.push(`Invalid quest Zenni reward: ${quest.id}`);
      if (
        reward.type === "grant-base-experience-multiplier" &&
        (!Number.isFinite(reward.multiplier) || reward.multiplier < 0)
      ) {
        errors.push(`Invalid quest experience reward: ${quest.id}`);
      }
      if (
        reward.type === "grant-item" &&
        reward.itemId !== undefined &&
        !itemIds.has(reward.itemId)
      )
        errors.push(`Unknown quest reward item: ${quest.id}:${reward.itemId}`);
      if (
        reward.type === "grant-move" &&
        reward.moveId !== undefined &&
        !moveIds.has(reward.moveId)
      )
        errors.push(`Unknown quest reward move: ${quest.id}:${reward.moveId}`);
    }
  }
  return errors;
};

export const validateQuestEncounterDefinitions = (
  encounters: readonly QuestEncounterDefinition[],
  quests: readonly { readonly id: string; readonly encounterIds: readonly string[] }[],
  npcs: readonly NpcDefinition[],
): readonly string[] => {
  const ids = new Set<string>();
  const questIds = new Set(quests.map((quest) => quest.id));
  const npcIds = new Set(npcs.map((npc) => npc.id));
  const errors: string[] = [];
  for (const encounter of encounters) {
    if (!idPattern.test(encounter.id) || !encounter.id.includes("-encounter-"))
      errors.push(`Invalid quest encounter ID: ${encounter.id}`);
    if (ids.has(encounter.id)) errors.push(`Duplicate quest encounter ID: ${encounter.id}`);
    ids.add(encounter.id);
    if (!questIds.has(encounter.questId)) errors.push(`Unknown encounter quest: ${encounter.id}`);
    if (encounter.battleText.trim().length === 0)
      errors.push(`Missing encounter battle text: ${encounter.id}`);
    if (!encounter.source.path.startsWith("reference/quests/"))
      errors.push(`Invalid encounter source path: ${encounter.id}`);
    for (const npcId of encounter.npcIds)
      if (!npcIds.has(npcId)) errors.push(`Unknown encounter NPC: ${encounter.id}:${npcId}`);
  }
  for (const quest of quests) {
    for (const encounterId of quest.encounterIds)
      if (!ids.has(encounterId)) errors.push(`Unknown quest encounter: ${quest.id}:${encounterId}`);
  }
  return errors;
};

export const validateSagaDefinitions = (sagas: readonly SagaDefinition[]): readonly string[] => {
  const ids = new Set<string>();
  const errors: string[] = [];
  for (const saga of sagas) {
    if (!idPattern.test(saga.id) || !saga.id.startsWith("saga-"))
      errors.push(`Invalid saga ID: ${saga.id}`);
    if (ids.has(saga.id)) errors.push(`Duplicate saga ID: ${saga.id}`);
    ids.add(saga.id);
    if (saga.name.trim().length === 0 || saga.overview.trim().length === 0)
      errors.push(`Incomplete saga: ${saga.id}`);
    if (!saga.source.path.startsWith("reference/saga/"))
      errors.push(`Invalid saga source path: ${saga.id}`);
    if (!saga.source.text.includes(saga.name))
      errors.push(`Saga source does not contain its name: ${saga.id}`);
    for (const section of saga.sections) {
      if (!idPattern.test(section.id) || section.content.trim().length === 0)
        errors.push(`Invalid saga section: ${saga.id}:${section.id}`);
      if (!section.source.text.includes(section.content))
        errors.push(`Saga section is not source-traceable: ${saga.id}:${section.id}`);
    }
  }
  return errors;
};

export const validateRuleSectionDefinitions = (
  sections: readonly RuleSectionDefinition[],
): readonly string[] => {
  const ids = new Set<string>();
  const numbers = new Set<number>();
  const errors: string[] = [];
  for (const section of sections) {
    if (!idPattern.test(section.id) || !section.id.startsWith("rule-section-"))
      errors.push(`Invalid rule section ID: ${section.id}`);
    if (ids.has(section.id)) errors.push(`Duplicate rule section ID: ${section.id}`);
    ids.add(section.id);
    if (!Number.isInteger(section.number) || section.number < 1 || numbers.has(section.number))
      errors.push(`Invalid rule section number: ${section.id}`);
    numbers.add(section.number);
    if (section.title.trim().length === 0 || section.content.trim().length === 0)
      errors.push(`Incomplete rule section: ${section.id}`);
    if (section.source.path !== "reference/rules.md")
      errors.push(`Invalid rule section source path: ${section.id}`);
    if (!section.source.text.includes(section.content))
      errors.push(`Rule section is not source-traceable: ${section.id}`);
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
      const hasSourceText =
        ability.effectText !== undefined &&
        ability.effectText.trim().length > 0 &&
        (ability.effectClauses?.length ?? 0) > 0;
      if (!hasSourceText && (ability.effects?.length ?? 0) === 0) {
        errors.push(`Missing ${mastery} Transformation Ability effect text: ${transformation.id}`);
      }
      for (const [index, clause] of (ability.effectClauses ?? []).entries()) {
        if (clause.order !== index + 1 || !ability.effectText?.includes(clause.text)) {
          errors.push(`Invalid ${mastery} Transformation Ability clause: ${transformation.id}`);
        }
      }
    }
  }

  return errors;
};
