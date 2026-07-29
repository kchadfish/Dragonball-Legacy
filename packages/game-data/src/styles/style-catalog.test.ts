import { describe, expect, it } from "vitest";

import { AKAIKARU_MOVES } from "../moves/akaikaru.js";
import { FREESTYLE_MOVES } from "../moves/freestyle.js";
import { HAOKIRU_MOVES } from "../moves/haokiru.js";
import { KIIHAKAI_MOVES } from "../moves/kiihakai.js";
import { KUROKONWAKU_MOVES } from "../moves/kurokonwaku.js";
import { MIDORIKATAI_MOVES } from "../moves/midorikatai.js";
import { AKAIKARU_STYLE } from "./akaikaru.js";
import { FREESTYLE_STYLE } from "./freestyle.js";
import { HAOKIRU_STYLE } from "./haokiru.js";
import { KIIHAKAI_STYLE } from "./kiihakai.js";
import { KUROKONWAKU_STYLE } from "./kurokonwaku.js";
import { MIDORIKATAI_STYLE } from "./midorikatai.js";

describe("style catalogs", () => {
  it("promotes every categorized source move for the remaining styles", () => {
    const catalogs = [
      [AKAIKARU_STYLE, AKAIKARU_MOVES],
      [FREESTYLE_STYLE, FREESTYLE_MOVES],
      [HAOKIRU_STYLE, HAOKIRU_MOVES],
      [KIIHAKAI_STYLE, KIIHAKAI_MOVES],
      [KUROKONWAKU_STYLE, KUROKONWAKU_MOVES],
      [MIDORIKATAI_STYLE, MIDORIKATAI_MOVES],
    ] as const;

    for (const [style, moves] of catalogs) {
      const styleMoveIds = [
        ...style.masteryMoveIds,
        ...style.skillMoveIds,
        ...style.advancedAttackMoveIds,
        ...style.signatureMoveIds,
        ...style.blockMoveIds,
      ];

      expect(new Set(moves.map((move) => move.id))).toEqual(new Set(styleMoveIds));
      expect(new Set(styleMoveIds).size).toBe(styleMoveIds.length);
      expect(moves.every((move) => move.styleId === style.id)).toBe(true);
    }
  });
});
