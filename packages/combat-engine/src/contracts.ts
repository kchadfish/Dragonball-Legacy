import { GLOBAL_RULES, type RulesVersion } from "@dragonball-resurgence/game-config";
import type { MoveId } from "@dragonball-resurgence/game-data";
import { z } from "zod";

import type {
  ActiveEffectId,
  CombatDecisionId,
  CombatEventId,
  CombatantId,
  FightId,
  PendingDecisionId,
} from "./ids.js";

export type CombatMode = "spar" | "battle";

export type CombatPhase = "upkeep" | "action" | "end";

export interface CombatResources {
  readonly current: number;
  readonly maximum: number;
}

export interface CombatantStats {
  readonly power: number;
  readonly dexterity: number;
  readonly dexterityBonus: number;
}

export interface CombatantState {
  readonly id: CombatantId;
  readonly hitPoints: CombatResources;
  readonly ki: CombatResources;
  readonly stats: CombatantStats;
  readonly moveIds: readonly MoveId[];
  readonly status: "active" | "defeated";
}

const createFightCombatantInputSchema = z
  .object({
    maximumHitPoints: z.number().positive(),
    stats: z
      .object({
        power: z.number().nonnegative(),
        dexterity: z.number().nonnegative(),
        dexterityBonus: z
          .number()
          .min(GLOBAL_RULES.combat.minimumDexterityBonus)
          .max(GLOBAL_RULES.combat.maximumDexterityBonus),
      })
      .strict(),
    moveIds: z.array(z.string().min(1)).superRefine((moveIds, context) => {
      const seenMoveIds = new Set<string>();

      for (const [index, moveId] of moveIds.entries()) {
        if (seenMoveIds.has(moveId)) {
          context.addIssue({
            code: "custom",
            message: "Move IDs must not contain duplicates.",
            path: [index],
          });
        }
        seenMoveIds.add(moveId);
      }
    }),
  })
  .strict();

/**
 * The caller selects the initial combatant until a canonical initiative rule is
 * converted into game configuration. This prevents the engine from inventing
 * an ordering policy during fight creation.
 */
export const createFightInputSchema = z
  .object({
    mode: z.enum(["spar", "battle"]),
    activeCombatantIndex: z.union([z.literal(0), z.literal(1)]),
    combatants: z.tuple([createFightCombatantInputSchema, createFightCombatantInputSchema]),
  })
  .strict();

export type CreateFightInput = z.output<typeof createFightInputSchema>;

export interface FightSetupIssue {
  readonly path: string;
  readonly message: string;
}

export interface PendingDecisionOption {
  readonly id: string;
  readonly type: "activate-effect" | "decline" | "select-combatant" | "select-move";
  readonly combatantId?: CombatantId;
  readonly moveId?: MoveId;
}

export interface PendingDecision {
  readonly id: PendingDecisionId;
  readonly stateVersion: number;
  readonly combatantId: CombatantId;
  readonly type: "optional-effect" | "select-combatant" | "select-move";
  readonly options: readonly PendingDecisionOption[];
}

export interface AdvancedAttackCostSelector {
  readonly category: "advanced-attack";
  readonly baseKiCost: number;
}

/** A serializable temporary modifier that expires after one matching action. */
export interface ActiveCostModifierEffect {
  readonly id: ActiveEffectId;
  readonly type: "modify-ki-cost";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
  readonly amount: number;
  readonly selector: AdvancedAttackCostSelector;
  readonly scope: "next-eligible-action";
}

interface FightStateBase {
  readonly id: FightId;
  readonly version: number;
  readonly rulesVersion: RulesVersion;
  readonly mode: CombatMode;
  readonly turnNumber: number;
  readonly combatants: Readonly<Record<CombatantId, CombatantState>>;
  readonly activeEffects: readonly ActiveCostModifierEffect[];
  readonly eventSequence: number;
}

export interface ActiveFightState extends FightStateBase {
  readonly status: "active";
  readonly phase: CombatPhase;
  readonly activeCombatantId: CombatantId;
  readonly pendingDecision?: PendingDecision;
}

export interface CompletedFightState extends FightStateBase {
  readonly status: "completed";
  readonly completion: {
    readonly type: "cancelled" | "defeat" | "surrender";
    readonly winnerCombatantId?: CombatantId;
  };
}

export type FightState = ActiveFightState | CompletedFightState;

export interface FightStateInvariantViolation {
  readonly type:
    | "invalid-active-combatant"
    | "invalid-combatant-count"
    | "invalid-combatant-identity"
    | "invalid-completion"
    | "invalid-pending-decision"
    | "invalid-resource"
    | "invalid-rules-version"
    | "invalid-state-counter"
    | "invalid-stat";
  readonly message: string;
  readonly subject?: string;
}

export interface PassDecision {
  readonly type: "pass";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

export interface PowerUpDecision {
  readonly type: "power-up";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
}

export type BasicAttackType = "basic-punch" | "basic-kick" | "basic-ki-blast";

export interface BasicAttackDecision {
  readonly type: "basic-attack";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly basicAttack: BasicAttackType;
  readonly targetCombatantId: CombatantId;
}

export interface UseMoveDecision {
  readonly type: "use-move";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface RespondToPendingDecision {
  readonly type: "respond-to-pending-decision";
  readonly id: CombatDecisionId;
  readonly actorId: CombatantId;
  readonly expectedStateVersion: number;
  readonly pendingDecisionId: PendingDecisionId;
  readonly optionId: string;
}

export type CombatDecision =
  PassDecision | PowerUpDecision | BasicAttackDecision | UseMoveDecision | RespondToPendingDecision;

export type LegalDecision =
  | {
      readonly type: "pass";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "power-up";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "basic-attack";
      readonly actorId: CombatantId;
      readonly basicAttack: BasicAttackType;
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "use-move";
      readonly actorId: CombatantId;
      readonly moveId: MoveId;
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "respond-to-pending-decision";
      readonly actorId: CombatantId;
      readonly pendingDecisionId: PendingDecisionId;
      readonly optionId: string;
    };

export interface CombatEventBase {
  readonly id: CombatEventId;
  readonly sequence: number;
  readonly fightId: FightId;
  readonly causedByDecisionId?: CombatDecisionId;
  readonly causedByEffectId?: ActiveEffectId;
  readonly sourceDefinitionId?: string;
}

export interface FightStartedEvent extends CombatEventBase {
  readonly type: "fight-started";
  readonly mode: CombatMode;
}

export interface TurnStartedEvent extends CombatEventBase {
  readonly type: "turn-started";
  readonly combatantId: CombatantId;
  readonly turnNumber: number;
}

export interface PhaseChangedEvent extends CombatEventBase {
  readonly type: "phase-changed";
  readonly phase: CombatPhase;
}

export interface MoveUsedEvent extends CombatEventBase {
  readonly type: "move-used";
  readonly combatantId: CombatantId;
  readonly moveId: MoveId;
  readonly targetCombatantId: CombatantId;
}

export interface AttackRolledEvent extends CombatEventBase {
  readonly type: "attack-rolled";
  readonly combatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly basicAttack?: BasicAttackType;
  readonly moveId?: MoveId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface DefenseRolledEvent extends CombatEventBase {
  readonly type: "defense-rolled";
  readonly combatantId: CombatantId;
  readonly sourceCombatantId: CombatantId;
  readonly naturalResult: number;
  readonly result: number;
}

export interface AttackResolvedEvent extends CombatEventBase {
  readonly type: "attack-resolved";
  readonly combatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly basicAttack?: BasicAttackType;
  readonly moveId?: MoveId;
  readonly outcome: "successful" | "stopped";
}

export interface EffectActivatedEvent extends CombatEventBase {
  readonly type: "effect-activated";
  readonly activeEffectId: ActiveEffectId;
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly sourceDefinitionId: MoveId;
}

export interface EffectExpiredEvent extends CombatEventBase {
  readonly type: "effect-expired";
  readonly activeEffectId: ActiveEffectId;
  readonly targetCombatantId: CombatantId;
}

export interface KiChangedEvent extends CombatEventBase {
  readonly type: "ki-changed";
  readonly combatantId: CombatantId;
  readonly amount: number;
  readonly remainingKi: number;
}

export interface DamageAppliedEvent extends CombatEventBase {
  readonly type: "damage-applied";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly amount: number;
  readonly remainingHitPoints: number;
}

export interface CombatantDefeatedEvent extends CombatEventBase {
  readonly type: "combatant-defeated";
  readonly combatantId: CombatantId;
}

export interface FightEndedEvent extends CombatEventBase {
  readonly type: "fight-ended";
  readonly completion: CompletedFightState["completion"];
}

export type CombatEvent =
  | FightStartedEvent
  | TurnStartedEvent
  | PhaseChangedEvent
  | MoveUsedEvent
  | AttackRolledEvent
  | DefenseRolledEvent
  | AttackResolvedEvent
  | EffectActivatedEvent
  | EffectExpiredEvent
  | KiChangedEvent
  | DamageAppliedEvent
  | CombatantDefeatedEvent
  | FightEndedEvent;

export interface CombatTransition {
  readonly state: FightState;
  readonly events: readonly CombatEvent[];
  readonly pendingDecision?: PendingDecision;
}

export type CombatFailure =
  | {
      readonly type: "invalid-fight-setup";
      readonly issues: readonly FightSetupIssue[];
    }
  | {
      readonly type: "invalid-fight-state";
      readonly violations: readonly FightStateInvariantViolation[];
    }
  | {
      readonly type: "stale-decision";
      readonly expectedVersion: number;
      readonly actualVersion: number;
    }
  | {
      readonly type: "wrong-phase";
      readonly expected: readonly CombatPhase[];
      readonly actual: CombatPhase | "completed";
    }
  | {
      readonly type: "not-active-combatant";
      readonly combatantId: CombatantId;
      readonly activeCombatantId?: CombatantId;
    }
  | {
      readonly type: "invalid-target";
      readonly targetCombatantId: CombatantId;
    }
  | {
      readonly type: "insufficient-ki";
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly type: "unknown-move";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "move-not-owned";
      readonly moveId: MoveId;
      readonly combatantId: CombatantId;
    }
  | {
      readonly type: "move-locked";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "restricted-use-exhausted";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "no-pending-decision";
      readonly pendingDecisionId: PendingDecisionId;
    }
  | {
      readonly type: "invalid-pending-decision-option";
      readonly pendingDecisionId: PendingDecisionId;
      readonly optionId: string;
    }
  | {
      readonly type: "unsupported-mechanic";
      readonly mechanic: string;
    }
  | {
      readonly type: "illegal-decision";
      readonly decisionType: CombatDecision["type"];
    };

export type CombatResult<TSuccess> =
  | { readonly ok: true; readonly value: TSuccess }
  | { readonly ok: false; readonly error: CombatFailure };
