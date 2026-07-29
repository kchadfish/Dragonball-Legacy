import { GAME_DATA_DOCUMENTS } from "../packages/game-data/src/reference-documents.js";
import { validateGameDataDocuments } from "../packages/game-data/src/validation.js";

const errors = validateGameDataDocuments(GAME_DATA_DOCUMENTS);
if (errors.length > 0) {
  throw new Error(errors.join("\n"));
}

console.log(`Validated ${GAME_DATA_DOCUMENTS.length} game-data documents.`);
