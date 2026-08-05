import { ITEM_DEFINITIONS } from "../packages/game-data/src/item-definitions.js";
import {
  LOCATION_DEFINITIONS,
  TRAINER_DEFINITIONS,
} from "../packages/game-data/src/location-definitions.js";
import { MOVE_DEFINITIONS } from "../packages/game-data/src/move-definitions.js";
import { RACE_DEFINITIONS } from "../packages/game-data/src/race-definitions.js";
import { GAME_DATA_DOCUMENTS } from "../packages/game-data/src/reference-documents.js";
import {
  RULE_SECTION_DEFINITIONS,
  SAGA_DEFINITIONS,
} from "../packages/game-data/src/saga-rule-definitions.js";
import { TRANSFORMATION_DEFINITIONS } from "../packages/game-data/src/transformation-definitions.js";
import {
  NPC_DEFINITIONS,
  QUEST_DEFINITIONS,
  QUEST_ENCOUNTER_DEFINITIONS,
} from "../packages/game-data/src/quest-definitions.js";
import {
  validateGameDataDocuments,
  validateItemDefinitions,
  validateLocationDefinitions,
  validateNpcDefinitions,
  validateQuestDefinitions,
  validateQuestEncounterDefinitions,
  validateRuleSectionDefinitions,
  validateSagaDefinitions,
  validateTrainerDefinitions,
  validateTransformationDefinitions,
} from "../packages/game-data/src/validation.js";

const errors = [
  ...validateGameDataDocuments(GAME_DATA_DOCUMENTS),
  ...validateItemDefinitions(ITEM_DEFINITIONS),
  ...validateTransformationDefinitions(TRANSFORMATION_DEFINITIONS),
  ...validateLocationDefinitions(LOCATION_DEFINITIONS),
  ...validateTrainerDefinitions(TRAINER_DEFINITIONS, MOVE_DEFINITIONS),
  ...validateNpcDefinitions(NPC_DEFINITIONS, MOVE_DEFINITIONS),
  ...validateQuestDefinitions(QUEST_DEFINITIONS, MOVE_DEFINITIONS, ITEM_DEFINITIONS),
  ...validateQuestEncounterDefinitions(
    QUEST_ENCOUNTER_DEFINITIONS,
    QUEST_DEFINITIONS,
    NPC_DEFINITIONS,
  ),
  ...validateSagaDefinitions(SAGA_DEFINITIONS),
  ...validateRuleSectionDefinitions(RULE_SECTION_DEFINITIONS),
];
if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(
  `Validated ${GAME_DATA_DOCUMENTS.length} game-data documents, ${ITEM_DEFINITIONS.length} item definitions, ${RACE_DEFINITIONS.length} race definitions, ${TRANSFORMATION_DEFINITIONS.length} transformation definitions, ${SAGA_DEFINITIONS.length} saga definitions, and ${RULE_SECTION_DEFINITIONS.length} rule sections.`,
);
