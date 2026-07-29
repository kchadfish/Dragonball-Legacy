import { describe, expect, it } from "vitest";

import { MOVE_SOURCE_DEFINITIONS } from "../move-source-definitions.js";
import { AOYOSUMU_STYLE } from "./aoyosumu.js";

describe("AOYOSUMU_STYLE", () => {
  it("organizes every Aoyosumu source move into one explicit progression group", () => {
    const moveIds = [
      ...AOYOSUMU_STYLE.masteryMoveIds,
      ...AOYOSUMU_STYLE.skillMoveIds,
      ...AOYOSUMU_STYLE.advancedAttackMoveIds,
      ...AOYOSUMU_STYLE.signatureMoveIds,
      ...AOYOSUMU_STYLE.blockMoveIds,
    ];
    const sourceMoveIds = MOVE_SOURCE_DEFINITIONS.filter((move) =>
      move.id.startsWith("move-aoyosumu-"),
    ).map((move) => move.id);

    expect(moveIds).toHaveLength(61);
    expect(new Set(moveIds).size).toBe(moveIds.length);
    expect(new Set(moveIds)).toEqual(new Set(sourceMoveIds));
  });
});
