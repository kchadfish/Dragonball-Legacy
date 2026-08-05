import { GLOBAL_RULES } from "@dragonball-resurgence/game-config";
import { MOVE_DEFINITIONS } from "@dragonball-resurgence/game-data";

import type {
  ActiveFightState,
  BasicAttackDecision,
  CombatDecision,
  CombatEvent,
  CombatFailure,
  CombatResult,
  CombatTransition,
  CompletedFightState,
  FightState,
  LegalDecision,
} from "./contracts.js";
import type { CombatDependencies } from "./dependencies.js";
import type { CombatantId } from "./ids.js";
import { validateFightState } from "./invariants.js";

const invalidFightState = (state: CombatTransition["state"]): CombatFailure => ({
  type: "invalid-fight-state",
  violations: validateFightState(state),
});

const createPhaseChangedEvent = (
  state: ActiveFightState,
  dependencies: CombatDependencies,
  phase: ActiveFightState["phase"],
  sequence: number,
  causedByDecisionId?: CombatDecision["id"],
): CombatEvent => ({
  id: dependencies.ids.nextEventId(),
  sequence,
  fightId: state.id,
  type: "phase-changed",
  phase,
  ...(causedByDecisionId === undefined ? {} : { causedByDecisionId }),
});

const transitionFrom = (
  state: FightState,
  events: readonly CombatEvent[],
): CombatResult<CombatTransition> => {
  const violations = validateFightState(state);
  if (violations.length > 0)
    return { ok: false, error: { type: "invalid-fight-state", violations } };

  return { ok: true, value: { state, events } };
};

const currentStateFailure = (state: CombatTransition["state"]): CombatFailure | undefined => {
  const violations = validateFightState(state);
  return violations.length === 0 ? undefined : { type: "invalid-fight-state", violations };
};

const nextActiveCombatantId = (state: ActiveFightState): CombatantId | undefined =>
  Object.values(state.combatants).find(
    (combatant) => combatant.id !== state.activeCombatantId && combatant.status === "active",
  )?.id;

const deathBeam = MOVE_DEFINITIONS.find((move) => move.id === "move-afterlife-death-beam");

const resolveDeathBeam = (
  state: ActiveFightState,
  decision: Extract<CombatDecision, { readonly type: "use-move" }>,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  if (deathBeam === undefined) throw new Error("Converted Death Beam data is unavailable.");
  const attacker = state.combatants[decision.actorId];
  const target = state.combatants[decision.targetCombatantId];
  if (target?.status !== "active" || target.id === attacker.id) {
    return {
      ok: false,
      error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
    };
  }
  const baseCost = deathBeam.mechanics.kiCost;
  const attack = deathBeam.mechanics.attack;
  if (
    baseCost?.type !== "literal" ||
    attack?.baseDamagePercent?.type !== "literal" ||
    attack.attackRoll?.dice !== 1
  ) {
    throw new Error("Converted Death Beam data no longer matches the supported effect slice.");
  }
  const matchingEffects = state.activeEffects.filter(
    (effect) =>
      effect.targetCombatantId === attacker.id &&
      effect.selector.category === "advanced-attack" &&
      effect.selector.baseKiCost === baseCost.value,
  );
  const cost = baseCost.value + matchingEffects.reduce((total, effect) => total + effect.amount, 0);
  if (attacker.ki.current < cost) {
    return {
      ok: false,
      error: { type: "insufficient-ki", required: cost, available: attacker.ki.current },
    };
  }

  const attackNaturalResult = dependencies.random.integer(1, attack.attackRoll.sides);
  const defenseNaturalResult = dependencies.random.integer(1, GLOBAL_RULES.combat.standardDieSides);
  const attackResult = attackNaturalResult + attacker.stats.dexterityBonus;
  const defenseResult = defenseNaturalResult + target.stats.dexterityBonus;
  const outcome = attackResult >= defenseResult ? "successful" : "stopped";
  const baseDamage = Math.round((attacker.stats.power * attack.baseDamagePercent.value) / 100);
  const damage = outcome === "successful" ? Math.min(baseDamage, target.hitPoints.current) : 0;
  const remainingHitPoints = target.hitPoints.current - damage;
  const defeated = outcome === "successful" && remainingHitPoints === 0;
  const remainingEffects = state.activeEffects.filter(
    (effect) => !matchingEffects.includes(effect),
  );
  const activatedEffect =
    outcome === "successful" && !defeated
      ? {
          id: dependencies.ids.nextActiveEffectId(),
          type: "modify-ki-cost" as const,
          sourceCombatantId: attacker.id,
          targetCombatantId: target.id,
          sourceDefinitionId: deathBeam.id,
          amount: 1,
          selector: { category: "advanced-attack" as const, baseKiCost: 1 },
          scope: "next-eligible-action" as const,
        }
      : undefined;
  const events: CombatEvent[] = [];
  const nextSequence = () => state.eventSequence + events.length + 1;
  events.push(
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "move-used",
      combatantId: attacker.id,
      moveId: deathBeam.id,
      targetCombatantId: target.id,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: attacker.id,
      amount: -cost,
      remainingKi: attacker.ki.current - cost,
    },
  );
  for (const effect of matchingEffects) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-expired",
      activeEffectId: effect.id,
      targetCombatantId: attacker.id,
    });
  }
  events.push(
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-rolled",
      combatantId: attacker.id,
      targetCombatantId: target.id,
      moveId: deathBeam.id,
      naturalResult: attackNaturalResult,
      result: attackResult,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "defense-rolled",
      combatantId: target.id,
      sourceCombatantId: attacker.id,
      naturalResult: defenseNaturalResult,
      result: defenseResult,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-resolved",
      combatantId: attacker.id,
      targetCombatantId: target.id,
      moveId: deathBeam.id,
      outcome,
    },
  );
  if (outcome === "successful") {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "damage-applied",
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      amount: damage,
      remainingHitPoints,
    });
  }
  if (activatedEffect !== undefined) {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: nextSequence(),
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "effect-activated",
      activeEffectId: activatedEffect.id,
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      sourceDefinitionId: deathBeam.id,
    });
  }
  if (defeated) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextSequence(),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "combatant-defeated",
        combatantId: target.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextSequence(),
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      },
    );
  } else {
    events.push(createPhaseChangedEvent(state, dependencies, "end", nextSequence(), decision.id));
  }
  const combatants = {
    ...state.combatants,
    [attacker.id]: { ...attacker, ki: { ...attacker.ki, current: attacker.ki.current - cost } },
    ...(outcome === "successful"
      ? {
          [target.id]: {
            ...target,
            hitPoints: { ...target.hitPoints, current: remainingHitPoints },
            status: defeated ? ("defeated" as const) : target.status,
          },
        }
      : {}),
  };
  const nextState: FightState = defeated
    ? {
        id: state.id,
        version: state.version + 1,
        rulesVersion: state.rulesVersion,
        mode: state.mode,
        turnNumber: state.turnNumber,
        combatants,
        activeEffects: [],
        eventSequence: state.eventSequence + events.length,
        status: "completed",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      }
    : {
        ...state,
        version: state.version + 1,
        phase: "end",
        combatants,
        activeEffects:
          activatedEffect === undefined ? remainingEffects : [...remainingEffects, activatedEffect],
        eventSequence: state.eventSequence + events.length,
      };
  return transitionFrom(nextState, events);
};

const resolveBasicAttack = (
  state: ActiveFightState,
  decision: BasicAttackDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const attacker = state.combatants[decision.actorId];
  const target = state.combatants[decision.targetCombatantId];
  if (target?.status !== "active" || target.id === attacker.id) {
    return {
      ok: false,
      error: { type: "invalid-target", targetCombatantId: decision.targetCombatantId },
    };
  }

  const attackNaturalResult = dependencies.random.integer(1, GLOBAL_RULES.combat.standardDieSides);
  const defenseNaturalResult = dependencies.random.integer(1, GLOBAL_RULES.combat.standardDieSides);
  const attackResult = attackNaturalResult + attacker.stats.dexterityBonus;
  const defenseResult = defenseNaturalResult + target.stats.dexterityBonus;
  const outcome = attackResult >= defenseResult ? "successful" : "stopped";
  const basicDamage = Math.round(
    (attacker.stats.power * GLOBAL_RULES.combat.basicAttackPowerDamagePercent) / 100,
  );
  const damage = outcome === "successful" ? Math.min(basicDamage, target.hitPoints.current) : 0;
  const remainingHitPoints = target.hitPoints.current - damage;
  const defeated = outcome === "successful" && remainingHitPoints === 0;
  const eventCount = outcome === "stopped" ? 4 : defeated ? 6 : 5;
  const nextCombatants =
    outcome === "successful"
      ? {
          ...state.combatants,
          [target.id]: {
            ...target,
            hitPoints: { ...target.hitPoints, current: remainingHitPoints },
            status: defeated ? ("defeated" as const) : target.status,
          },
        }
      : state.combatants;
  const nextEventSequence = state.eventSequence + eventCount;
  const nextState: ActiveFightState | CompletedFightState = defeated
    ? {
        id: state.id,
        version: state.version + 1,
        rulesVersion: state.rulesVersion,
        mode: state.mode,
        turnNumber: state.turnNumber,
        combatants: nextCombatants,
        activeEffects: [],
        eventSequence: nextEventSequence,
        status: "completed",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      }
    : {
        ...state,
        version: state.version + 1,
        phase: "end",
        combatants: nextCombatants,
        eventSequence: nextEventSequence,
      };
  const events: CombatEvent[] = [
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-rolled",
      combatantId: attacker.id,
      targetCombatantId: target.id,
      basicAttack: decision.basicAttack,
      naturalResult: attackNaturalResult,
      result: attackResult,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 2,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "defense-rolled",
      combatantId: target.id,
      sourceCombatantId: attacker.id,
      naturalResult: defenseNaturalResult,
      result: defenseResult,
    },
    {
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 3,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "attack-resolved",
      combatantId: attacker.id,
      targetCombatantId: target.id,
      basicAttack: decision.basicAttack,
      outcome,
    },
  ];
  if (outcome === "successful") {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 4,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "damage-applied",
      sourceCombatantId: attacker.id,
      targetCombatantId: target.id,
      amount: damage,
      remainingHitPoints,
    });
  }
  if (defeated) {
    events.push(
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + 5,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "combatant-defeated",
        combatantId: target.id,
      },
      {
        id: dependencies.ids.nextEventId(),
        sequence: state.eventSequence + 6,
        fightId: state.id,
        causedByDecisionId: decision.id,
        type: "fight-ended",
        completion: { type: "defeat", winnerCombatantId: attacker.id },
      },
    );
  } else {
    events.push(
      createPhaseChangedEvent(
        state,
        dependencies,
        "end",
        state.eventSequence + events.length + 1,
        decision.id,
      ),
    );
  }

  return transitionFrom(
    { ...nextState, eventSequence: state.eventSequence + events.length },
    events,
  );
};

/** Returns every currently supported player decision for the requested combatant. */
export const enumerateLegalDecisions = (
  state: CombatTransition["state"],
  combatantId: CombatantId,
): readonly LegalDecision[] => {
  if (
    state.status !== "active" ||
    state.phase !== "action" ||
    state.pendingDecision !== undefined ||
    state.activeCombatantId !== combatantId
  ) {
    return [];
  }
  const opponentId = nextActiveCombatantId(state);
  if (opponentId === undefined) return [];
  const activeCombatant = state.combatants[combatantId];

  return [
    {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: "basic-punch",
      targetCombatantId: opponentId,
    },
    ...(activeCombatant.moveIds.includes("move-afterlife-death-beam")
      ? [
          {
            type: "use-move" as const,
            actorId: combatantId,
            moveId: "move-afterlife-death-beam",
            targetCombatantId: opponentId,
          },
        ]
      : []),
    {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: "basic-kick",
      targetCombatantId: opponentId,
    },
    {
      type: "basic-attack",
      actorId: combatantId,
      basicAttack: "basic-ki-blast",
      targetCombatantId: opponentId,
    },
    { type: "pass", actorId: combatantId },
    { type: "power-up", actorId: combatantId },
  ];
};

/**
 * Resolves a non-interactive phase boundary. Upkeep has no supported actions in
 * this slice, and an empty end phase hands the turn to the other combatant.
 */
export const advanceFight = (
  state: CombatTransition["state"],
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const invalidState = currentStateFailure(state);
  if (invalidState !== undefined) return { ok: false, error: invalidState };
  if (state.status === "completed") {
    return {
      ok: false,
      error: { type: "wrong-phase", expected: ["upkeep", "end"], actual: "completed" },
    };
  }
  if (state.pendingDecision !== undefined) {
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    };
  }

  if (state.phase === "upkeep") {
    const nextState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      phase: "action",
      eventSequence: state.eventSequence + 1,
    };
    return transitionFrom(nextState, [
      createPhaseChangedEvent(state, dependencies, "action", nextState.eventSequence),
    ]);
  }
  if (state.phase === "end") {
    const nextCombatantId = nextActiveCombatantId(state);
    if (nextCombatantId === undefined) return { ok: false, error: invalidFightState(state) };

    const nextState: ActiveFightState = {
      ...state,
      version: state.version + 1,
      turnNumber: state.turnNumber + 1,
      phase: "upkeep",
      activeCombatantId: nextCombatantId,
      eventSequence: state.eventSequence + 2,
    };
    return transitionFrom(nextState, [
      createPhaseChangedEvent(state, dependencies, "upkeep", state.eventSequence + 1),
      {
        id: dependencies.ids.nextEventId(),
        sequence: nextState.eventSequence,
        fightId: state.id,
        type: "turn-started",
        combatantId: nextCombatantId,
        turnNumber: nextState.turnNumber,
      },
    ]);
  }

  return {
    ok: false,
    error: { type: "wrong-phase", expected: ["upkeep", "end"], actual: state.phase },
  };
};

/**
 * Applies an ACTION-phase player decision. Move and pending-decision resolution
 * deliberately remain unsupported until their effect-resolution slices exist.
 */
export const submitCombatDecision = (
  state: CombatTransition["state"],
  decision: CombatDecision,
  dependencies: CombatDependencies,
): CombatResult<CombatTransition> => {
  const invalidState = currentStateFailure(state);
  if (invalidState !== undefined) return { ok: false, error: invalidState };
  if (decision.expectedStateVersion !== state.version) {
    return {
      ok: false,
      error: {
        type: "stale-decision",
        expectedVersion: decision.expectedStateVersion,
        actualVersion: state.version,
      },
    };
  }
  if (state.status === "completed") {
    return { ok: false, error: { type: "wrong-phase", expected: ["action"], actual: "completed" } };
  }
  if (decision.actorId !== state.activeCombatantId) {
    return {
      ok: false,
      error: {
        type: "not-active-combatant",
        combatantId: decision.actorId,
        activeCombatantId: state.activeCombatantId,
      },
    };
  }
  if (state.phase !== "action") {
    return { ok: false, error: { type: "wrong-phase", expected: ["action"], actual: state.phase } };
  }
  if (state.pendingDecision !== undefined) {
    return {
      ok: false,
      error: { type: "unsupported-mechanic", mechanic: "pending decision resolution" },
    };
  }

  if (decision.type === "basic-attack") {
    return resolveBasicAttack(state, decision, dependencies);
  }
  if (decision.type === "use-move") {
    const move = MOVE_DEFINITIONS.find((candidate) => candidate.id === decision.moveId);
    if (move === undefined)
      return { ok: false, error: { type: "unknown-move", moveId: decision.moveId } };
    if (!state.combatants[decision.actorId].moveIds.includes(decision.moveId)) {
      return {
        ok: false,
        error: { type: "move-not-owned", moveId: decision.moveId, combatantId: decision.actorId },
      };
    }
    if (decision.moveId !== "move-afterlife-death-beam") {
      return {
        ok: false,
        error: { type: "unsupported-mechanic", mechanic: `move resolution: ${decision.moveId}` },
      };
    }
    return resolveDeathBeam(state, decision, dependencies);
  }
  if (decision.type === "respond-to-pending-decision") {
    return {
      ok: false,
      error: { type: "no-pending-decision", pendingDecisionId: decision.pendingDecisionId },
    };
  }

  const activeCombatant = state.combatants[decision.actorId];
  const powerUpAmount =
    decision.type === "power-up"
      ? Math.min(
          GLOBAL_RULES.combat.powerUpKiGain,
          activeCombatant.ki.maximum - activeCombatant.ki.current,
        )
      : 0;
  const nextState: ActiveFightState = {
    ...state,
    version: state.version + 1,
    phase: "end",
    eventSequence: state.eventSequence + (decision.type === "power-up" ? 2 : 1),
    combatants:
      decision.type === "power-up"
        ? {
            ...state.combatants,
            [decision.actorId]: {
              ...activeCombatant,
              ki: { ...activeCombatant.ki, current: activeCombatant.ki.current + powerUpAmount },
            },
          }
        : state.combatants,
  };
  const events: CombatEvent[] = [];
  if (decision.type === "power-up") {
    events.push({
      id: dependencies.ids.nextEventId(),
      sequence: state.eventSequence + 1,
      fightId: state.id,
      causedByDecisionId: decision.id,
      type: "ki-changed",
      combatantId: decision.actorId,
      amount: powerUpAmount,
      remainingKi: activeCombatant.ki.current + powerUpAmount,
    });
  }
  events.push(
    createPhaseChangedEvent(state, dependencies, "end", nextState.eventSequence, decision.id),
  );
  return transitionFrom(nextState, events);
};
