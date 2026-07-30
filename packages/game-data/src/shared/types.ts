import type {
  ATTACK_TAG,
  ATTACK_TYPE,
  ITEM_CATEGORY,
  LOCATION_TYPE,
  MOVE_CATEGORY,
  STATUS_STACKING,
  TRANSFORMATION_MASTERY,
} from "./constants.js";
import type { EffectDefinition } from "./effects.js";
import type {
  ItemId,
  LocationId,
  MoveId,
  NpcId,
  QuestId,
  RaceId,
  StatusId,
  StyleId,
  TransformationId,
} from "./ids.js";
import type { Requirement } from "./requirements.js";

export interface SourceReference {
  readonly path: string;
  readonly text: string;
}

export interface MoveDefinition {
  readonly id: MoveId;
  readonly name: string;
  readonly styleId?: StyleId;
  readonly category: (typeof MOVE_CATEGORY)[keyof typeof MOVE_CATEGORY];
  readonly tags: readonly (typeof ATTACK_TAG)[keyof typeof ATTACK_TAG][];
  readonly description: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly mechanics: MoveMechanics;
  readonly kiCost?: number;
  readonly restrictedUses?: number;
  readonly attack?: {
    readonly type: (typeof ATTACK_TYPE)[keyof typeof ATTACK_TYPE];
    readonly dice?: { readonly count: number; readonly sides: number };
    readonly powerPercent?: number;
  };
  readonly requirements?: readonly Requirement[];
  readonly effects?: readonly EffectDefinition[];
  readonly trainingDays?: number;
  readonly source: SourceReference;
}

export interface MoveSourceDefinition {
  readonly id: MoveId;
  readonly name: string;
  readonly declaredTags: readonly string[];
  readonly category?: MoveDefinition["category"];
  readonly description: string;
  readonly effectText: string;
  readonly effectClauses: readonly EffectClauseDefinition[];
  readonly mechanics: MoveMechanics;
  readonly requirementsText: string;
  readonly trainingDays?: number;
  readonly source: SourceReference;
}

export type EffectRuleToken =
  | "break"
  | "cooldown"
  | "counter"
  | "critical"
  | "deactivate"
  | "lock"
  | "negate"
  | "sever"
  | "stopped"
  | "stun"
  | "successful"
  | "suppress";

export interface EffectClauseDefinition {
  readonly order: number;
  readonly text: string;
  readonly ruleTokens: readonly EffectRuleToken[];
}

export type NumericExpression =
  | { readonly type: "literal"; readonly value: number }
  | {
      readonly type: "turns-after-turn";
      readonly turn: number;
      readonly perTurn: number;
      readonly maximum: number;
    }
  | {
      readonly type: "participant-count";
      readonly excludeSelf: boolean;
      readonly perParticipant: number;
      readonly maximum: number;
    }
  | {
      readonly type: "moveset-move-count";
      readonly subject: "self" | "opponent";
      readonly category: "advanced-attack" | "signature" | "block" | "skill" | "mastery";
    }
  | {
      readonly type: "prior-move-activation-count";
      readonly move: "source";
      readonly perActivation: number;
    }
  | {
      readonly type: "consecutive-combat-results";
      readonly actor: "self" | "opponent";
      readonly result: "successful" | "stopped" | "critical" | "counter";
      readonly resetBy: "successful" | "stopped" | "critical" | "counter";
      readonly perResult: number;
      readonly maximum?: number;
    }
  | {
      readonly type: "bounded-stat";
      readonly subject: "self" | "opponent";
      readonly stat: "dexterity-bonus";
      readonly minimum: number;
      readonly maximum: number;
    }
  | {
      readonly type: "resource-percent";
      readonly subject: "self" | "opponent";
      readonly resource: "hp" | "ki";
      readonly basis: "current" | "total";
      readonly percent: number;
    }
  | {
      readonly type: "stat-percent";
      readonly subject: "self" | "opponent";
      readonly stat: "power";
      readonly percent: number;
    }
  | {
      readonly type: "triggering-move-base-damage";
      readonly multiplier: number;
    }
  | {
      readonly type: "blocked-attack-damage";
      readonly multiplier: number;
    }
  | { readonly type: "paid-activation-cost"; readonly resource: "ki" }
  | {
      readonly type: "active-move-count";
      readonly subject: "self" | "opponent";
      readonly category: "skill";
      readonly constant: true;
      readonly perMove: number;
    }
  | { readonly type: "successful-hit-count" }
  | { readonly type: "source-expression"; readonly text: string };

export interface MoveMechanics {
  readonly kiCost?: NumericExpression;
  readonly restrictedUses?: NumericExpression;
  readonly timingText?: string;
  readonly attack?: {
    readonly type: (typeof ATTACK_TYPE)[keyof typeof ATTACK_TYPE];
    readonly baseDamagePercent?: NumericExpression;
    readonly damagePerHit?: boolean;
    readonly attackRoll?: { readonly dice: number; readonly sides: number };
  };
}

export interface UnresolvedMoveSource {
  readonly sourcePath: string;
  readonly line: number;
  readonly name: string;
  readonly reason: string;
  readonly sourceText: string;
}

export interface StyleDefinition {
  readonly id: StyleId;
  readonly name: string;
  readonly description: string;
  readonly masteryMoveIds: readonly MoveId[];
  readonly skillMoveIds: readonly MoveId[];
  readonly advancedAttackMoveIds: readonly MoveId[];
  readonly signatureMoveIds: readonly MoveId[];
  readonly blockMoveIds: readonly MoveId[];
  readonly source: SourceReference;
}

export interface RaceDefinition {
  readonly id: RaceId;
  readonly name: string;
  readonly description: string;
  readonly transformationIds: readonly TransformationId[];
  readonly source: SourceReference;
}

export interface TransformationStatModifiers {
  readonly powerPercent: number;
  readonly hpPercent: number;
  readonly dexterityPercent: number;
}

export interface TransformationAbilityDefinition {
  readonly name?: string;
  readonly effects: readonly EffectDefinition[];
}

export type TransformationMastery =
  (typeof TRANSFORMATION_MASTERY)[keyof typeof TRANSFORMATION_MASTERY];

export type TransformationAbilities = Readonly<
  Record<TransformationMastery, TransformationAbilityDefinition>
>;

export interface TransformationDefinition {
  readonly id: TransformationId;
  readonly raceId: RaceId;
  readonly name: string;
  readonly tier: number;
  readonly prerequisites: readonly Requirement[];
  readonly statModifiers: TransformationStatModifiers;
  readonly abilities: TransformationAbilities;
  readonly source: SourceReference;
}

export interface ItemDefinition {
  readonly id: ItemId;
  readonly name: string;
  readonly category: (typeof ITEM_CATEGORY)[keyof typeof ITEM_CATEGORY];
  readonly description: string;
  readonly inventorySlots: number;
  readonly requirements?: readonly Requirement[];
  readonly effects?: readonly EffectDefinition[];
  readonly source: SourceReference;
}

export interface NpcDefinition {
  readonly id: NpcId;
  readonly name: string;
  readonly raceId?: RaceId;
  readonly styleId?: StyleId;
  readonly moveIds: readonly MoveId[];
  readonly source: SourceReference;
}

export interface QuestDefinition {
  readonly id: QuestId;
  readonly name: string;
  readonly description: string;
  readonly prerequisites: readonly Requirement[];
  readonly source: SourceReference;
}

export interface LocationDefinition {
  readonly id: LocationId;
  readonly name: string;
  readonly type: (typeof LOCATION_TYPE)[keyof typeof LOCATION_TYPE];
  readonly description: string;
  readonly source: SourceReference;
}

export interface StatusDefinition {
  readonly id: StatusId;
  readonly name: string;
  readonly stacking: (typeof STATUS_STACKING)[keyof typeof STATUS_STACKING];
  readonly defaultDuration?: number;
  readonly effects: readonly EffectDefinition[];
}

export type GameDataDocumentKind =
  | "rules"
  | "moves"
  | "items"
  | "race"
  | "transformations"
  | "quest"
  | "location"
  | "trainers"
  | "reference";

export interface GameDataDocument {
  readonly id: string;
  readonly kind: GameDataDocumentKind;
  readonly sourcePath: string;
  readonly content: string;
}
