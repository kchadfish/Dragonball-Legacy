import { describe, expect, it } from "vitest";

import { compileEffectPlan } from "./effect-executors.js";
import {
  registeredScopeDecisions,
  scopeDecisionCategories,
  scopeDecisionForEffect,
  scopeDecisionForId,
  scopeDecisionForItemStateRuleOperation,
  scopeDecisionForSourceText,
} from "./scope-decisions.js";

describe("combat scope decisions", () => {
  it("uses unique stable namespaced IDs with complete versioned metadata", () => {
    const ids = registeredScopeDecisions.map((scopeDecision) => scopeDecision.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(registeredScopeDecisions).toHaveLength(scopeDecisionCategories.length);
    expect(
      registeredScopeDecisions.every(
        (scopeDecision) =>
          scopeDecision.id.startsWith("combat-scope:") &&
          scopeDecision.version === 1 &&
          scopeDecisionCategories.includes(scopeDecision.category) &&
          scopeDecision.reason.length > 0 &&
          scopeDecision.futureOwner.length > 0,
      ),
    ).toBe(true);
    expect(registeredScopeDecisions.map((scopeDecision) => scopeDecision.category)).toEqual(
      expect.arrayContaining([...scopeDecisionCategories]),
    );
  });

  it("resolves the structured Phase 10 categories without widening execution", () => {
    expect(scopeDecisionForEffect({ type: "join-attack", target: "ally" })?.category).toBe(
      "allies-and-joint-attacks",
    );
    expect(scopeDecisionForEffect({ type: "join-attack", target: "remote-target" })?.category).toBe(
      "remote-and-relationship-targets",
    );
    expect(
      scopeDecisionForEffect({ type: "grant-defense-response", target: "interferers" })?.category,
    ).toBe("interferers-and-spectators");
    expect(scopeDecisionForEffect({ type: "modify-roll", roll: "escape" })?.category).toBe(
      "escape-actions-and-roll-configuration",
    );
    expect(scopeDecisionForEffect({ type: "set-stat-comparison" })).toBeUndefined();
    expect(scopeDecisionForEffect({ type: "swap-combatant-state" })?.category).toBe(
      "body-mutation",
    );
  });

  it("does not make excluded structured mechanics executable", () => {
    const excludedEffects = [
      { type: "join-attack", target: "ally" },
      { type: "grant-defense-response", target: "interferers" },
      { type: "swap-combatant-state" },
      { type: "grant-racial-traits" },
      { type: "grant-mastery" },
      { type: "grant-escape-roll" },
      { type: "modify-roll", roll: "escape" },
    ];

    expect(
      excludedEffects.every(
        (effect) =>
          !compileEffectPlan({
            sourceDefinitionId: "test-scope-decision",
            effectIndex: 0,
            effect: effect as never,
          }).ok,
      ),
    ).toBe(true);
  });

  it("resolves every Phase 10 item state-rule operation through the registry", () => {
    const operations = [
      "prevent-interference",
      "select-escape-roll-modifier",
      "allow-target-item-attack",
      "destroy-item-on-roll-threshold",
      "disable-selected-item-copies",
      "limit-space-combat-item-use",
      "roll-space-combat-dice",
      "set-space-combat-starting-hp",
      "roll-first-advanced-attack-twice-lower",
      "cap-hp-at-precombat-value",
      "grant-ship-storage-access",
      "transfer-stored-items-on-raid",
      "increase-other-ship-travel-time",
      "restrict-space-quest-work",
      "waive-ship-pilot-requirement",
    ];

    expect(operations.every((operation) => scopeDecisionForItemStateRuleOperation(operation))).toBe(
      true,
    );
  });

  it("classifies relevant source-only relationship and identity clauses", () => {
    expect(scopeDecisionForSourceText("A same-planet partner may join your battle")?.category).toBe(
      "remote-and-relationship-targets",
    );
    expect(
      scopeDecisionForSourceText("You may interfere in another player's battle")?.category,
    ).toBe("interferers-and-spectators");
    expect(scopeDecisionForSourceText("Choose one additional RACIAL TRAIT")?.category).toBe(
      "racial-trait-mutation",
    );
    expect(scopeDecisionForId("combat-scope:unknown")).toBeUndefined();
  });

  it("routes source-only ownership, spaceship, progression, and tournament clauses", () => {
    expect(scopeDecisionForSourceText("You start the game with +500z")?.category).toBe(
      "progression-and-stat-acquisition",
    );
    expect(scopeDecisionForSourceText("Spaceship addons cost 25% less")?.category).toBe(
      "spaceship-travel-storage-capacity-and-raid",
    );
    expect(
      scopeDecisionForSourceText("Any effects that refer to style now refer to your style")
        ?.category,
    ).toBe("moveset-mutation");
    expect(scopeDecisionForSourceText("Not usable in Tournament Matches")?.category).toBe(
      "administrator-and-narrative",
    );
    expect(scopeDecisionForSourceText("Dragon Balls take 0 item slots for you")?.category).toBe(
      "ownership-mutation",
    );
    expect(scopeDecisionForSourceText("Your recover rate is +10%")?.category).toBe(
      "progression-and-stat-acquisition",
    );
    expect(
      scopeDecisionForSourceText("Only one active LSSJ character may hold the class")?.category,
    ).toBe("administrator-and-narrative");
  });
});
