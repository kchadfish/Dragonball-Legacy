import { describe, expect, it } from "vitest";

import {
  NPC_DEFINITIONS,
  QUEST_DEFINITIONS,
  QUEST_ENCOUNTER_DEFINITIONS,
} from "./quest-definitions.js";
import { MOVE_DEFINITIONS } from "./move-definitions.js";
import {
  validateNpcDefinitions,
  validateQuestDefinitions,
  validateQuestEncounterDefinitions,
} from "./validation.js";
import { ITEM_DEFINITIONS } from "./item-definitions.js";

describe("quest and NPC definitions", () => {
  it("converts every quest heading that is not a move definition", () => {
    expect(QUEST_DEFINITIONS).toHaveLength(215);
    expect(new Set(QUEST_DEFINITIONS.map((quest) => quest.id))).toHaveLength(215);
    expect(
      QUEST_DEFINITIONS.every((quest) => quest.source.path.startsWith("reference/quests/")),
    ).toBe(true);
    expect(QUEST_DEFINITIONS.every((quest) => quest.requirementsText.length > 0)).toBe(true);
    expect(
      QUEST_DEFINITIONS.every((quest) =>
        quest.rewards.every((reward) => quest.rewardsText.includes(reward.sourceText)),
      ),
    ).toBe(true);
    expect(QUEST_DEFINITIONS.find((quest) => quest.name === "The Babysitter")?.rewards).toEqual([
      expect.objectContaining({ type: "grant-zenni", amount: 400, executable: true }),
    ]);
  });

  it("links quest encounters to combat-ready NPC profiles and records unnamed opponents", () => {
    const npcIds = new Set(NPC_DEFINITIONS.map((npc) => npc.id));
    expect(NPC_DEFINITIONS).toHaveLength(32);
    expect(QUEST_ENCOUNTER_DEFINITIONS).toHaveLength(37);
    expect(QUEST_DEFINITIONS.filter((quest) => quest.battleText !== undefined)).toHaveLength(37);
    expect(
      QUEST_DEFINITIONS.every((quest) => quest.npcIds.every((npcId) => npcIds.has(npcId))),
    ).toBe(true);
    expect(
      NPC_DEFINITIONS.every(
        (npc) => npc.combatProfile !== undefined && npc.combatProfile.levelText.length > 0,
      ),
    ).toBe(true);
    expect(
      NPC_DEFINITIONS.every((npc) => npc.source.text.includes(npc.combatProfile?.levelText ?? "")),
    ).toBe(true);
    expect(
      QUEST_ENCOUNTER_DEFINITIONS.filter(
        (encounter) => encounter.unresolvedCombatantTexts.length > 0,
      ),
    ).toHaveLength(5);
  });

  it("rejects broken NPC and encounter references", () => {
    const npc = NPC_DEFINITIONS[0];
    const encounter = QUEST_ENCOUNTER_DEFINITIONS[0];
    if (npc === undefined || encounter === undefined)
      throw new Error("Expected generated encounter data.");

    expect(validateNpcDefinitions([{ ...npc, id: "bad npc" }], MOVE_DEFINITIONS)).toEqual(
      expect.arrayContaining(["Invalid NPC ID: bad npc"]),
    );
    expect(
      validateQuestEncounterDefinitions(
        [{ ...encounter, npcIds: ["npc-missing"] }],
        QUEST_DEFINITIONS,
        NPC_DEFINITIONS,
      ),
    ).toEqual(expect.arrayContaining([`Unknown encounter NPC: ${encounter.id}:npc-missing`]));
    const quest = QUEST_DEFINITIONS.find((entry) => entry.name === "The Babysitter");
    if (quest === undefined) throw new Error("Expected The Babysitter quest.");
    expect(
      validateQuestDefinitions([{ ...quest, id: "bad quest" }], MOVE_DEFINITIONS, ITEM_DEFINITIONS),
    ).toEqual(expect.arrayContaining(["Invalid quest ID: bad quest"]));
  });
});
