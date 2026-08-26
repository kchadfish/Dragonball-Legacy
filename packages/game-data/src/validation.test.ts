import { describe, expect, it } from "vitest";

import { ITEM_DEFINITIONS } from "./item-definitions.js";
import { LOCATION_DEFINITIONS, TRAINER_DEFINITIONS } from "./location-definitions.js";
import { MOVE_DEFINITIONS } from "./move-definitions.js";
import {
  NPC_DEFINITIONS,
  QUEST_DEFINITIONS,
  QUEST_ENCOUNTER_DEFINITIONS,
} from "./quest-definitions.js";
import { GAME_DATA_DOCUMENTS } from "./reference-documents.js";
import { RULE_SECTION_DEFINITIONS, SAGA_DEFINITIONS } from "./saga-rule-definitions.js";
import { TRANSFORMATION_DEFINITIONS } from "./transformation-definitions.js";
import {
  validateGameDataDocuments,
  validateItemDefinitions,
  validateLocationDefinitions,
  validateMoveDefinitions,
  validateNpcDefinitions,
  validateQuestDefinitions,
  validateQuestEncounterDefinitions,
  validateRuleSectionDefinitions,
  validateSagaDefinitions,
  validateTrainerDefinitions,
  validateTransformationDefinitions,
} from "./validation.js";

const runtimeValue = (value: unknown): unknown => value;
const isDefinedAtRuntime = <T>(value: T | undefined): value is T =>
  runtimeValue(value) !== undefined;

describe("game-data validation boundaries", () => {
  it("rejects malformed document and move metadata", () => {
    const document = GAME_DATA_DOCUMENTS[0];
    const move = MOVE_DEFINITIONS.find(
      (candidate) =>
        candidate.mechanics.attack?.attackRoll !== undefined &&
        candidate.mechanics.kiCost?.type === "literal" &&
        candidate.mechanics.attack.baseDamagePercent?.type === "literal",
    );
    if (move === undefined) throw new Error("Expected a literal attack move fixture.");
    const attack = move.mechanics.attack;
    if (attack === undefined) throw new Error("Expected attack mechanics on the move fixture.");

    expect(
      validateGameDataDocuments([
        { ...document, id: "bad id", sourcePath: "bad", content: " " },
        document,
        document,
      ]),
    ).toEqual(
      expect.arrayContaining([
        "Invalid game-data document ID: bad id",
        "Invalid game-data source path: bad",
        "Empty game-data document: bad id",
        `Duplicate game-data document ID: ${document.id}`,
      ]),
    );

    const invalidMove = {
      ...move,
      id: "bad move",
      effectText: "",
      effectClauses: [],
      source: { ...move.source, path: "bad" },
      mechanics: {
        ...move.mechanics,
        kiCost: { type: "literal" as const, value: -1 },
        restrictedUses: { type: "literal" as const, value: -1 },
        attack: {
          ...attack,
          baseDamagePercent: { type: "literal" as const, value: -1 },
          attackRoll: { dice: 0, sides: 0 },
        },
      },
    };

    expect(validateMoveDefinitions([invalidMove, invalidMove])).toEqual(
      expect.arrayContaining([
        "Invalid move ID: bad move",
        "Duplicate move ID: bad move",
        "Invalid move source path: bad move",
        "Missing effect text: bad move",
        "Missing effect clauses: bad move",
        "Negative move mechanic value: bad move",
        "Invalid attack roll: bad move",
      ]),
    );
  });

  it("rejects malformed item properties, rules, effects, and ship details", () => {
    const item = ITEM_DEFINITIONS.find(
      (candidate) => candidate.rules.length > 0 && candidate.effects?.length,
    );
    if (item === undefined) throw new Error("Expected an item fixture with rules and effects.");
    const rule = item.rules[0];
    const effect = item.effects?.[0];
    if (!isDefinedAtRuntime(rule) || !isDefinedAtRuntime(effect))
      throw new Error("Expected item details.");

    const invalidItem = {
      ...item,
      id: "bad item",
      name: "",
      description: "",
      effectText: "",
      effectClauses: [],
      rules: [
        { ...rule, sourceText: "missing", executable: false, unresolvedReason: undefined },
        {
          ...rule,
          executable: true,
          unresolvedReason: "requires-dedicated-effect-family" as const,
        },
      ],
      inventorySlots: -1,
      price: -1,
      maxUses: 0,
      locations: [""],
      availability: "listed" as const,
      effects: [{ ...effect, sourceText: "missing" }],
      category: "ship" as const,
      ship: {
        maximumCapacity: -1,
        weaponSlots: 0.5,
        defenseSlots: 1,
        travelDays: 1,
        supportSystems: [],
      },
      source: { ...item.source, path: "bad", text: "source" },
    };

    expect(validateItemDefinitions([invalidItem])).toEqual(
      expect.arrayContaining([
        "Invalid item ID: bad item",
        "Missing item name: bad item",
        "Missing item description: bad item",
        "Missing item effect text: bad item",
        "Missing item effect clauses: bad item",
        "Item rules do not cover every effect clause: bad item",
        "Item rule source is not in effect text: bad item",
        "Unresolved item rule is not classified: bad item:missing",
        `Executable item rule has unresolved classification: bad item:${rule.sourceText}`,
        "Item effect source is not in effect text: bad item",
        "Invalid item inventory slots: bad item",
        "Invalid item price: bad item",
        "Invalid item maximum uses: bad item",
        "Invalid item location: bad item",
        "Invalid item source path: bad item",
        "Invalid ship detail: bad item",
      ]),
    );
  });

  it("rejects malformed references and source-derived records", () => {
    const location = LOCATION_DEFINITIONS[0];
    const trainer = TRAINER_DEFINITIONS[0];
    const npc = NPC_DEFINITIONS[0];
    const quest = QUEST_DEFINITIONS.find((candidate) => candidate.rewards.length > 0);
    const encounter = QUEST_ENCOUNTER_DEFINITIONS[0];
    const saga = SAGA_DEFINITIONS[0];
    const rule = RULE_SECTION_DEFINITIONS[0];
    const transformation = TRANSFORMATION_DEFINITIONS[0];
    if (
      !isDefinedAtRuntime(location) ||
      !isDefinedAtRuntime(trainer) ||
      !isDefinedAtRuntime(npc) ||
      !isDefinedAtRuntime(quest) ||
      !isDefinedAtRuntime(encounter) ||
      !isDefinedAtRuntime(saga) ||
      !isDefinedAtRuntime(rule) ||
      !isDefinedAtRuntime(transformation)
    ) {
      throw new Error("Expected canonical validation fixtures.");
    }
    const combatProfile = npc.combatProfile;
    if (combatProfile === undefined) throw new Error("Expected combat profile fixture.");
    const reward = quest.rewards[0];
    if (!isDefinedAtRuntime(reward)) throw new Error("Expected quest reward fixture.");

    expect(
      validateLocationDefinitions([
        {
          ...location,
          id: "bad location",
          name: "",
          description: "",
          source: { ...location.source, path: "bad" },
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        "Invalid location ID: bad location",
        "Incomplete location: bad location",
        "Invalid location source path: bad location",
      ]),
    );

    expect(
      validateTrainerDefinitions(
        [
          {
            ...trainer,
            id: "bad trainer",
            name: "",
            styleName: "",
            moveIds: ["move-missing"],
            source: { ...trainer.source, path: "bad" },
          },
        ],
        MOVE_DEFINITIONS,
      ),
    ).toEqual(
      expect.arrayContaining([
        "Invalid trainer ID: bad trainer",
        "Incomplete trainer: bad trainer",
        "Invalid trainer source path: bad trainer",
        "Unknown trainer move: bad trainer:move-missing",
      ]),
    );

    expect(
      validateNpcDefinitions(
        [
          {
            ...npc,
            id: "bad npc",
            name: "",
            moveIds: ["move-missing"],
            source: { ...npc.source, path: "bad" },
            combatProfile: {
              ...combatProfile,
              levelText: "",
              hitPoints: { sourceText: "" },
            },
          },
        ],
        MOVE_DEFINITIONS,
      ),
    ).toEqual(
      expect.arrayContaining([
        "Invalid NPC ID: bad npc",
        "Missing NPC name: bad npc",
        "Invalid NPC source path: bad npc",
        "Missing NPC level: bad npc",
        "Invalid NPC stat source: bad npc",
        "Unknown NPC move: bad npc:move-missing",
      ]),
    );

    expect(
      validateQuestDefinitions(
        [
          {
            ...quest,
            id: "bad quest",
            source: { ...quest.source, path: "bad" },
            rewards: [
              {
                sourceText: "missing",
                type: "grant-zenni" as const,
                amount: -1,
                executable: true as const,
              },
              {
                sourceText: reward.sourceText,
                type: "grant-item" as const,
                itemName: "Missing Item",
                quantity: 1,
                itemId: "item-missing",
                executable: true,
              },
              {
                sourceText: reward.sourceText,
                type: "grant-move" as const,
                moveName: "Missing Move",
                moveId: "move-missing",
                executable: true,
              },
            ],
          },
        ],
        MOVE_DEFINITIONS,
        ITEM_DEFINITIONS,
      ),
    ).toEqual(
      expect.arrayContaining([
        "Invalid quest ID: bad quest",
        "Invalid quest source path: bad quest",
        "Quest reward is not source-traceable: bad quest",
        "Invalid quest Zenni reward: bad quest",
        "Unknown quest reward item: bad quest:item-missing",
        "Unknown quest reward move: bad quest:move-missing",
      ]),
    );

    expect(
      validateQuestEncounterDefinitions(
        [
          {
            ...encounter,
            id: "bad",
            questId: "quest-missing",
            battleText: "",
            npcIds: ["npc-missing"],
            source: { ...encounter.source, path: "bad" },
          },
        ],
        [{ ...quest, encounterIds: ["encounter-missing"] }],
        NPC_DEFINITIONS,
      ),
    ).toEqual(
      expect.arrayContaining([
        "Invalid quest encounter ID: bad",
        "Unknown encounter quest: bad",
        "Missing encounter battle text: bad",
        "Invalid encounter source path: bad",
        "Unknown encounter NPC: bad:npc-missing",
        `Unknown quest encounter: ${quest.id}:encounter-missing`,
      ]),
    );

    expect(
      validateSagaDefinitions([
        {
          ...saga,
          name: "Missing Saga Name",
          overview: "",
          source: { ...saga.source, path: "bad", text: "source" },
          sections: [
            {
              ...saga.sections[0],
              id: "bad id",
              content: "missing",
              source: { ...saga.sections[0].source, text: "source" },
            },
          ],
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        `Incomplete saga: ${saga.id}`,
        `Invalid saga source path: ${saga.id}`,
        `Saga source does not contain its name: ${saga.id}`,
        `Invalid saga section: ${saga.id}:bad id`,
        `Saga section is not source-traceable: ${saga.id}:bad id`,
      ]),
    );

    expect(
      validateRuleSectionDefinitions([
        {
          ...rule,
          id: "bad",
          number: 0,
          title: "",
          content: "missing",
          source: { ...rule.source, path: "bad", text: "source" },
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        `Invalid rule section ID: bad`,
        `Invalid rule section number: bad`,
        `Incomplete rule section: bad`,
        `Invalid rule section source path: bad`,
        `Rule section is not source-traceable: bad`,
      ]),
    );

    expect(
      validateTransformationDefinitions([
        {
          ...transformation,
          id: "bad id",
          raceId: "bad race",
          tier: 0,
          source: { ...transformation.source, path: "bad" },
          statModifiers: { ...transformation.statModifiers, powerPercent: Number.NaN },
        },
      ]),
    ).toEqual(
      expect.arrayContaining([
        "Invalid transformation ID: bad id",
        "Invalid transformation race ID: bad id",
        "Invalid transformation tier: bad id",
        "Invalid transformation source path: bad id",
        "Invalid transformation stat modifier: bad id",
      ]),
    );
  });
});
