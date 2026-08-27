import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { describe, expect, it } from "vitest";

import {
  combatTriggerDescriptors,
  discoverCombatTriggerSources,
} from "./combat-trigger-dispatch.js";
import { combatTriggers } from "./condition-executors.js";

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
});
