import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  combatTriggerSourcesFor,
  combatTriggerDescriptors,
  discoverCombatTriggerSources,
} from "./combat-trigger-dispatch.js";
import { combatTriggers } from "./condition-executors.js";
import { combatantIdSchema } from "./ids.js";

const move = (id: string) => {
  const definition = MOVE_DEFINITIONS.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`Missing test move ${id}.`);
  return definition;
};

describe("combat trigger dispatcher", () => {
  it("has one exhaustive descriptor for every supported trigger", () => {
    expect(Object.keys(combatTriggerDescriptors).sort()).toEqual([...combatTriggers].sort());
    expect(combatTriggerDescriptors["on-resource-gain"].recursion).toBe(
      "non-recursive-resource-listener",
    );
    expect(combatTriggerDescriptors["on-resource-drain"].recursion).toBe(
      "non-recursive-resource-listener",
    );
  });

  it("preserves discovery order while deduplicating owner/source identity", () => {
    const first = move("move-afterlife-spirit-bomb");
    const second = move("move-afterlife-light-grenade");
    const discovered = discoverCombatTriggerSources("on-success", [
      { kind: "action-move", move: first, owner: "self" },
      { kind: "carried-skill", move: second, owner: "self" },
      { kind: "active-constant", move: first, owner: "self" },
      { kind: "carried-mastery", move: first, owner: "opponent" },
    ]);

    expect(discovered.map(({ owner, move: source }) => `${owner}:${source.id}`)).toEqual([
      `self:${first.id}`,
      `self:${second.id}`,
      `opponent:${first.id}`,
    ]);
  });

  it("appends selected innate sources and active transformation ability in stable order", () => {
    const sources = combatTriggerSourcesFor(
      {
        id: combatantIdSchema.parse("combatant:self"),
        raceId: "race-humans",
        raceTraitIds: ["race-trait-taifuu-jins-runner-s-high"],
        classId: "generic-class-weaponmaster",
        transformationProfiles: [
          {
            transformationId: "transformation-humans-1-high-tension",
            rollSides: 20,
            mastery: "novice",
          },
        ],
        transformation: {
          transformationId: "transformation-humans-1-high-tension",
          activatedOnTurn: 1,
        },
        moveIds: ["move-afterlife-spirit-bomb"],
        hitPoints: { current: 100, maximum: 100 },
        ki: { current: 5, maximum: 10 },
        stats: { power: 20, dexterity: 4, dexterityBonus: 0 },
        activeStatuses: [],
        moveUses: {},
        status: "active",
      },
      "self",
    );

    expect(sources.map((source) => source.source?.kind)).toEqual([
      "move",
      "race-trait",
      "generic-class",
      "transformation-ability",
    ]);
    expect(sources.at(-1)?.source).toEqual({
      kind: "transformation-ability",
      definitionId: "transformation-humans-1-high-tension:novice",
      mastery: "novice",
    });
  });
});
