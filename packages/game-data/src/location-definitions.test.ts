import { describe, expect, it } from "vitest";
import { MOVE_DEFINITIONS } from "./move-definitions.js";
import {
  LOCATION_DEFINITIONS,
  TRAINER_CATALOG_DEFINITIONS,
  TRAINER_DEFINITIONS,
} from "./location-definitions.js";
import { validateLocationDefinitions, validateTrainerDefinitions } from "./validation.js";

describe("location and trainer definitions", () => {
  it("covers every canonical planet, sector, and trainer source", () => {
    expect(LOCATION_DEFINITIONS).toHaveLength(14);
    expect(TRAINER_CATALOG_DEFINITIONS).toHaveLength(10);
    expect(TRAINER_DEFINITIONS).toHaveLength(38);
    expect(validateLocationDefinitions(LOCATION_DEFINITIONS)).toEqual([]);
  });

  it("resolves named trainer moves and retains explicit unresolved source entries", () => {
    expect(TRAINER_DEFINITIONS.reduce((count, trainer) => count + trainer.moveIds.length, 0)).toBe(
      354,
    );
    expect(
      TRAINER_DEFINITIONS.reduce((count, trainer) => count + trainer.unresolvedMoveNames.length, 0),
    ).toBe(61);
    expect(validateTrainerDefinitions(TRAINER_DEFINITIONS, MOVE_DEFINITIONS)).toEqual([]);
  });
});
