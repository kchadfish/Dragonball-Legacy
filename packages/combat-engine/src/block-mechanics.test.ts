import { describe, expect, it } from "vitest";

import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";

import { calculateConvertedBlockCost, evaluateBlockEligibility } from "./index.js";

const requireMove = (id: string) => {
  const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === id);
  if (move === undefined) throw new Error(`Missing converted move ${id}.`);
  return move;
};

describe("converted Block mechanics", () => {
  it("uses converted type/tag eligibility and keeps restricted attacks from being stopped", () => {
    const defiantStance = requireMove("move-aoyosumu-defiant-stance");
    const beamRedirection = requireMove("move-kiihakai-beam-redirection");

    expect(
      evaluateBlockEligibility(defiantStance, {
        attackType: "physical",
        tags: ["punch"],
        restricted: false,
      }),
    ).toEqual({ canDeclare: true, stopsAttack: true });
    expect(
      evaluateBlockEligibility(defiantStance, {
        attackType: "energy",
        tags: ["beam"],
        restricted: true,
      }),
    ).toEqual({ canDeclare: true, stopsAttack: false });
    expect(
      evaluateBlockEligibility(beamRedirection, {
        attackType: "energy",
        tags: ["beam"],
        restricted: false,
      }),
    ).toEqual({ canDeclare: true, stopsAttack: true });
    expect(
      evaluateBlockEligibility(beamRedirection, {
        attackType: "energy",
        tags: ["kick"],
        restricted: false,
      }),
    ).toEqual({ canDeclare: false, stopsAttack: false });
  });

  it("evaluates X±N costs with the configured minimum", () => {
    const defiantStance = requireMove("move-aoyosumu-defiant-stance");
    const impenetrableDefense = requireMove("move-aoyosumu-impenetrable-defense");

    expect(calculateConvertedBlockCost(defiantStance, 1)).toBe(1);
    expect(calculateConvertedBlockCost(impenetrableDefense, 2)).toBe(3);
  });
});
