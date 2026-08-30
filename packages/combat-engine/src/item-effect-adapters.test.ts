import { ITEM_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  auditItemEffectAdapters,
  compileItemEffectPlan,
  itemEffectAdapterFor,
  itemStateRuleOperations,
  registeredItemEffectTypes,
} from "./item-effect-adapters.js";
import { scopeDecisionForItemStateRuleOperation } from "./scope-decisions.js";

const item = (id: string) => {
  const definition = ITEM_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Missing ${id}.`);
  return definition;
};

describe("item effect adapters", () => {
  it("compiles item provenance without requiring a move context", () => {
    const definition = item("item-equipment-first-aid-kit");
    const result = compileItemEffectPlan({ item: definition, effectIndex: 0 });

    expect(result).toMatchObject({
      ok: true,
      value: {
        type: "item-effect",
        origin: "item",
        itemId: definition.id,
        sourceDefinitionId: definition.id,
        effectIndex: 0,
        sourceClauseOrder: 2,
        normalized: { provenance: { origin: "item", sourceClauseOrder: 2 } },
      },
    });
  });

  it("keeps USE, RESTRICTED, and action timing distinct in generated data", () => {
    expect(item("item-equipment-first-aid-kit").usePolicy).toMatchObject({
      timing: "action",
      consumableUses: 1,
    });
    expect(item("item-equipment-senzu-root").usePolicy).toMatchObject({
      timing: "free",
      consumableUses: 1,
    });
    expect(item("item-equipment-yema-fruit").usePolicy).toMatchObject({
      timing: "free",
      restrictedUses: 1,
    });
    expect(item("item-equipment-heroic-tunic").usePolicy).toMatchObject({
      timing: "reaction",
      restrictedUses: 1,
      groups: ["roll-modifier"],
    });
  });

  it("accounts for every generated item effect and state-rule operation", () => {
    expect(itemStateRuleOperations).toContain("resolve-self-destruct");
    expect(registeredItemEffectTypes).toContain("item-state-rule");
    expect(auditItemEffectAdapters(ITEM_DEFINITIONS)).toEqual([]);
    const yemaCost = item("item-equipment-yema-fruit").effects?.find(
      (effect) => effect.type === "item-state-rule" && effect.operation === "pay-activation-ki",
    );
    if (yemaCost === undefined) throw new Error("Expected Yema activation cost data.");
    expect(itemEffectAdapterFor(yemaCost)).toMatchObject({
      classification: "supported-named",
      executor: "item-state-rule.pay-activation-ki",
    });
  });

  it("uses registered scope decisions for every Phase 10 item state rule", () => {
    const phase10Operations = itemStateRuleOperations.filter(
      (operation) => scopeDecisionForItemStateRuleOperation(operation) !== undefined,
    );
    const phase10Effects = ITEM_DEFINITIONS.flatMap((definition) =>
      (definition.effects ?? []).filter(
        (effect) =>
          effect.type === "item-state-rule" && phase10Operations.includes(effect.operation),
      ),
    );

    expect(phase10Effects.length).toBeGreaterThan(0);
    expect(
      phase10Effects.every((effect) => {
        const adapter = itemEffectAdapterFor(effect);
        return (
          adapter.classification === "audited-out-of-scope" &&
          adapter.scopeDecisionId !== undefined &&
          adapter.scopeDecisionCategory !== undefined
        );
      }),
    ).toBe(true);
    expect(itemEffectAdapterFor(phase10Effects[0])).toMatchObject({
      classification: "audited-out-of-scope",
    });
  });
});
