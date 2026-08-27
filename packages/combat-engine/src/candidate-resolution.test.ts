import { describe, expect, it } from "vitest";

import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";
import { RULES_VERSION } from "@dragonball-resurgence/game-config";

import type { FightState } from "./contracts.js";
import {
  resolveActiveEffectCandidates,
  resolveCombatantCandidates,
  resolveMoveCandidates,
  resolveSourceActionCandidates,
  resolveSourceEffectCandidates,
  createPendingSelection,
  validatePendingSelection,
} from "./index.js";
import { combatantIdSchema, fightIdSchema, pendingDecisionIdSchema } from "./ids.js";

const selfId = combatantIdSchema.parse("combatant:candidate-self");
const opponentId = combatantIdSchema.parse("combatant:candidate-opponent");

const combatant = (id: typeof selfId, moveIds: readonly string[]) => ({
  id,
  hitPoints: { current: 100, maximum: 100 },
  ki: { current: 10, maximum: 10 },
  stats: { power: 10, dexterity: 10, dexterityBonus: 0 },
  moveIds,
  moveUses: {},
  activeStatuses: [],
  status: "active" as const,
});

const state = (moveIds = ["move-akaikaru-firestorm", "move-akaikaru-blown-fuse"]): FightState => ({
  id: fightIdSchema.parse("fight:candidate-resolution"),
  version: 0,
  rulesVersion: RULES_VERSION,
  mode: "spar",
  turnNumber: 1,
  combatants: {
    [selfId]: combatant(selfId, moveIds),
    [opponentId]: combatant(opponentId, ["move-midorikatai-power-drill"]),
  },
  activeEffects: [],
  actionHistory: [],
  resolutionFrames: [],
  eventSequence: 0,
  status: "active",
  phase: "action",
  activeCombatantId: selfId,
});

describe("combat candidate resolution", () => {
  it("returns active self, opponent, and participant candidates deterministically", () => {
    const fight = state();

    expect(
      resolveCombatantCandidates(fight, selfId, "self").map((candidate) => candidate.id),
    ).toEqual([selfId]);
    expect(
      resolveCombatantCandidates(fight, selfId, "opponent").map((candidate) => candidate.id),
    ).toEqual([opponentId]);
    expect(
      resolveCombatantCandidates(fight, selfId, "participants").map((candidate) => candidate.id),
    ).toEqual([selfId, opponentId]);
  });

  it("uses the shared selector matcher for moves and preserves moveset order", () => {
    const candidates = resolveMoveCandidates(state(), selfId, MOVE_DEFINITIONS, {
      selector: {
        type: "move-selector",
        subject: "source",
        ids: ["move-akaikaru-firestorm"],
        category: "advanced-attack",
        tags: ["energy"],
        sourceText: "test",
      },
    });

    expect(candidates.map((candidate) => candidate.id)).toEqual(["move-akaikaru-firestorm"]);
    expect(candidates[0]?.ownerCombatantId).toBe(selfId);
  });

  it("resolves source effects and attack actions without presentation-event reconstruction", () => {
    const fight = state(["move-akaikaru-firestorm"]);
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === "move-akaikaru-firestorm");
    if (move === undefined) throw new Error("Expected a converted move.");

    const sourceEffects = resolveSourceEffectCandidates(move);
    expect(sourceEffects[0]).toMatchObject({ type: "source-effect", sourceDefinitionId: move.id });
    expect(resolveSourceActionCandidates(fight)).toEqual([]);
  });

  it("exposes active effects as stable candidates scoped by source owner", () => {
    const effect = {
      id: "active-effect:candidate" as never,
      type: "active-constant" as const,
      sourceCombatantId: selfId,
      targetCombatantId: selfId,
      sourceDefinitionId: "move-akaikaru-firestorm" as const,
      activatedOnTurn: 1,
      duration: "combat" as const,
    };
    const fight = { ...state(), activeEffects: [effect] } as unknown as FightState;

    expect(resolveActiveEffectCandidates(fight, selfId).map((candidate) => candidate.id)).toEqual([
      effect.id,
    ]);
    expect(resolveActiveEffectCandidates(fight, opponentId)).toEqual([]);
  });

  it("validates a multi-selection against the persisted candidate set", () => {
    const firstMove = "move-akaikaru-firestorm" as const;
    const secondMove = "move-akaikaru-blown-fuse" as const;
    const first = { type: "move" as const, id: firstMove, ownerCombatantId: selfId };
    const second = { type: "move" as const, id: secondMove, ownerCombatantId: selfId };
    const pending = {
      id: pendingDecisionIdSchema.parse("pending-decision:candidate-selection"),
      stateVersion: 0,
      combatantId: selfId,
      type: "select-move" as const,
      selection: { type: "all" as const },
      candidates: [first, second],
      options: [
        { id: "first", type: "select-move" as const, moveId: firstMove, candidate: first },
        { id: "second", type: "select-move" as const, moveId: secondMove, candidate: second },
      ],
    };

    expect(
      validatePendingSelection(pending, { optionId: "first", optionIds: ["second"] }),
    ).toMatchObject({ ok: true });
    expect(validatePendingSelection(pending, { optionId: "first" })).toEqual({
      ok: false,
      reason: "invalid-selection",
    });
    expect(validatePendingSelection(pending, { optionId: "first", optionIds: ["first"] })).toEqual({
      ok: false,
      reason: "invalid-selection",
    });
  });

  it("creates stable serialized options without choosing a player-owned candidate", () => {
    const fight = state();
    const candidates = resolveCombatantCandidates(fight, selfId, "opponent");
    const pending = createPendingSelection({
      id: pendingDecisionIdSchema.parse("pending-decision:created-selection"),
      stateVersion: fight.version,
      combatantId: selfId,
      type: "select-combatant",
      candidates,
      selection: { type: "one" },
    });

    expect(pending).toMatchObject({
      type: "select-combatant",
      candidates: [{ type: "combatant", id: opponentId }],
      options: [
        {
          type: "select-combatant",
          candidate: { type: "combatant", id: opponentId },
          combatantId: opponentId,
        },
      ],
    });
  });
});
