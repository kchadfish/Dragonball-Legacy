import type {
  CombatAnalysisProbe,
  CombatDecisionDescriptor,
  CombatResult,
  CombatantId,
  FightState,
  LegalDecision,
  PendingDecision,
  StrategicContextSummary,
} from "@dragonball-resurgence/combat-engine";
import type {
  ItemDefinition,
  MoveDefinition,
  TransformationDefinition,
} from "@dragonball-resurgence/game-data";

import type { AiRandomSource } from "./random.js";

export type DiagnosticRetention = "none" | "selection-only" | "ranked-summary" | "full";

export interface AiEvaluatorIdentity {
  readonly id: string;
  readonly version: string;
}

export type ScoreFactorBasis =
  | { readonly type: "none" }
  | {
      readonly type: "state";
      readonly metric: "survival-pressure" | "resource-pressure" | "tempo" | "momentum" | "horizon";
      readonly value: number;
    }
  | {
      readonly type: "effect-control";
      readonly executorType: string;
      readonly affectedOptionCount: number;
      readonly redundant: boolean;
    }
  | {
      readonly type: "transformation";
      readonly operation: "activate" | "deactivate";
      readonly netCombatValue: number;
      readonly horizon: number;
    }
  | {
      readonly type: "scarcity";
      readonly kind: string;
      readonly remaining?: number;
      readonly finalUse: boolean;
    }
  | {
      readonly type: "pending";
      readonly role: string;
      readonly selected: boolean;
      readonly optional: boolean;
    }
  | {
      readonly type: "normalized-amount";
      readonly resource: "hp" | "ki";
      readonly target: "self" | "opponent";
      readonly amount: number;
      readonly maximum: number;
    }
  | {
      readonly type: "range";
      readonly minimum: number;
      readonly maximum: number;
      readonly timing: "immediate" | "delayed";
    }
  | { readonly type: "boolean"; readonly value: boolean }
  | {
      readonly type: "adjustment";
      readonly reason: "tactical-clamp" | "tie-break";
    };

export interface ScoreFactor {
  readonly code: string;
  readonly value: number;
  readonly evaluator: AiEvaluatorIdentity;
  readonly basis: ScoreFactorBasis;
}

export interface PersonalityWeights {
  readonly version: string;
  readonly values: Readonly<Record<string, number>>;
}

export interface DifficultySettings {
  readonly version: string;
  readonly level: "easy" | "normal" | "hard" | (string & {});
}

export interface AiProfileIdentity {
  readonly id: string;
  readonly version: string;
}

export interface AiProfile {
  readonly identity: AiProfileIdentity;
  readonly personality: PersonalityWeights;
  readonly difficulty: DifficultySettings;
}

export type AiMoveMechanics = Pick<
  MoveDefinition,
  "id" | "category" | "tags" | "mechanics" | "kiCost" | "restrictedUses" | "attack"
>;

export type AiItemMechanics = Pick<
  ItemDefinition,
  "id" | "category" | "usePolicy" | "inventorySlots" | "effects" | "rules"
>;

export type AiTransformationMechanics = Pick<
  TransformationDefinition,
  "id" | "raceId" | "tier" | "statModifiers" | "abilities"
>;

/** Advisory catalog identity. Mechanical meaning remains combat-engine-owned. */
export type AiMechanicsReference =
  | {
      readonly type: "move";
      readonly id: MoveDefinition["id"];
      readonly category: MoveDefinition["category"];
      readonly tags: MoveDefinition["tags"];
    }
  | {
      readonly type: "item";
      readonly id: ItemDefinition["id"];
      readonly category: ItemDefinition["category"];
    }
  | {
      readonly type: "transformation";
      readonly id: TransformationDefinition["id"];
      readonly raceId: TransformationDefinition["raceId"];
      readonly tier: TransformationDefinition["tier"];
    };

export interface VersionedMechanicsCatalog<TEntry> {
  readonly version: string;
  readonly entries: readonly TEntry[];
}

export interface AiMechanicsView {
  readonly version: string;
  readonly moves: readonly AiMoveMechanics[];
  readonly items: readonly AiItemMechanics[];
  readonly transformations: readonly AiTransformationMechanics[];
}

export interface AiFeatureExtractionInput {
  readonly state: Readonly<FightState>;
  readonly decision: LegalDecision;
  readonly descriptor: Readonly<CombatDecisionDescriptor>;
  readonly mechanics: Readonly<AiMechanicsView>;
}

export interface AiAuthoritativeStateContext {
  readonly status: "active";
  readonly stateVersion: number;
  readonly turnNumber: number;
  readonly phase: Extract<FightState, { readonly status: "active" }>["phase"];
  readonly activeCombatantId: CombatantId;
}

export interface AiPendingSelectionFacts {
  readonly pendingDecisionId: PendingDecision["id"];
  readonly pendingType: PendingDecision["type"];
  readonly optionIds: readonly string[];
  readonly selectedOptionIds: readonly string[];
  readonly optional: boolean;
  readonly selection: CombatDecisionDescriptor["selection"];
}

export interface AiDecisionFeatureBase {
  readonly decision: LegalDecision;
  readonly canonicalKey: string;
  readonly category: CombatDecisionDescriptor["identity"]["category"];
  readonly actionConsumption: CombatDecisionDescriptor["actionConsumption"];
  readonly costs: CombatDecisionDescriptor["costs"];
  readonly effects: CombatDecisionDescriptor["effects"];
  readonly scarcity: CombatDecisionDescriptor["scarcity"];
  readonly targets: CombatDecisionDescriptor["targets"];
  readonly terminal: CombatDecisionDescriptor["terminal"];
  readonly immediateOutcome: CombatDecisionDescriptor["immediateOutcome"];
  readonly strategicContext?: StrategicContextSummary;
  readonly authoritative: {
    readonly costs: CombatDecisionDescriptor["costs"];
    readonly effects: CombatDecisionDescriptor["effects"];
    readonly scarcity: CombatDecisionDescriptor["scarcity"];
    readonly targets: CombatDecisionDescriptor["targets"];
    readonly terminal: CombatDecisionDescriptor["terminal"];
    readonly immediateOutcome: CombatDecisionDescriptor["immediateOutcome"];
    readonly strategicContext?: StrategicContextSummary;
  };
  readonly state: AiAuthoritativeStateContext;
  readonly mechanics?: AiMechanicsReference;
  readonly pending?: AiPendingSelectionFacts;
  readonly pendingSelection?: AiPendingSelectionFacts;
}

/** Feature union intentionally carries the original legal decision unchanged. */
export type AiDecisionFeature = AiDecisionFeatureBase &
  ({ readonly decisionType: LegalDecision["type"] } & (
    | { readonly decisionType: "pass" }
    | { readonly decisionType: "power-up" }
    | { readonly decisionType: "surrender" }
    | { readonly decisionType: "basic-attack" }
    | { readonly decisionType: "use-move" }
    | { readonly decisionType: "activate-transformation" }
    | { readonly decisionType: "deactivate-transformation" }
    | { readonly decisionType: "use-item" }
    | { readonly decisionType: "respond-to-pending-decision" }
  ));

export type AiFeatureExtractionFailure =
  | {
      readonly type: "invalid-state";
      readonly message: string;
    }
  | {
      readonly type: "descriptor-decision-mismatch";
      readonly field: "key" | "type" | "category" | "pending-decision";
      readonly expected: string;
      readonly actual: string;
    }
  | {
      readonly type: "missing-mechanics";
      readonly mechanicsType: AiMechanicsReference["type"];
      readonly mechanicsId: string;
    };

export type AiFeatureExtractionResult =
  | { readonly ok: true; readonly value: AiDecisionFeature }
  | { readonly ok: false; readonly error: AiFeatureExtractionFailure };

export type FeatureExtractionInput = AiFeatureExtractionInput;

export interface AiDependencies {
  readonly random: AiRandomSource;
  readonly randomness?: "enabled" | "disabled";
}

export interface AiAnalysisFacade {
  readonly describeDecision: (
    state: FightState,
    decision: LegalDecision,
  ) => CombatDecisionDescriptor;
  readonly probeDecision?: (
    state: FightState,
    decision: LegalDecision,
  ) => CombatResult<CombatAnalysisProbe>;
}

export type AiImmediateAnalysisFacade = Pick<AiAnalysisFacade, "describeDecision">;

export interface AiDecisionRequest {
  readonly state: Readonly<FightState>;
  readonly actorId: CombatantId;
  readonly legalDecisions: readonly LegalDecision[];
  readonly profile: AiProfile;
  readonly mechanics: Readonly<AiMechanicsView>;
  readonly dependencies: AiDependencies;
  readonly analysis?: AiAnalysisFacade;
  readonly diagnosticRetention?: DiagnosticRetention;
}

export interface AiImmediateUtilityRequest extends Omit<AiDecisionRequest, "analysis"> {
  readonly analysis: AiImmediateAnalysisFacade;
}

export type CandidateProvenance =
  | {
      readonly type: "baseline";
      readonly reason: "viable-alternative" | "surrender";
    }
  | {
      readonly type: "keyed-tie-break";
      readonly key: string;
      readonly value: number;
    }
  | {
      readonly type: "canonical-key-fallback";
      readonly key: string;
    };

export interface CandidateEvaluation {
  readonly decision: LegalDecision;
  readonly canonicalKey: string;
  readonly candidateIdentity: {
    readonly canonicalKey: string;
    readonly decisionType: LegalDecision["type"];
  };
  readonly evaluator: AiEvaluatorIdentity;
  readonly profileVersion: string;
  readonly scoreFactors: readonly ScoreFactor[];
  readonly provenance: readonly CandidateProvenance[];
  readonly totalScore: number;
  readonly rank: number;
}

export interface AiDiagnostics {
  readonly schemaVersion: "ai-decision-diagnostics:v1";
  readonly level: Exclude<DiagnosticRetention, "none">;
  readonly stateVersion: number;
  readonly profileVersion: string;
  readonly evaluator: AiEvaluatorIdentity;
  readonly selectedCanonicalKey: string;
  readonly evaluations?: readonly CandidateEvaluation[];
}

export interface AiDecisionResult {
  readonly decision: LegalDecision;
  readonly selectedDecision: LegalDecision;
  readonly evaluations: readonly CandidateEvaluation[];
  readonly diagnostics?: AiDiagnostics;
}

export interface AiRequestIssue {
  readonly path: string;
  readonly message: string;
}

export type AiFailure =
  | {
      readonly type: "empty-legal-set";
      readonly actorId: CombatantId;
    }
  | {
      readonly type: "completed-state";
      readonly stateVersion: number;
    }
  | {
      readonly type: "actor-mismatch";
      readonly actorId: CombatantId;
      readonly expectedActorId: CombatantId;
    }
  | {
      readonly type: "candidate-actor-mismatch";
      readonly actorId: CombatantId;
      readonly candidateActorId?: CombatantId;
      readonly candidateIndex: number;
    }
  | {
      readonly type: "duplicate-candidate";
      readonly canonicalKey: string;
      readonly firstIndex: number;
      readonly duplicateIndex: number;
    }
  | {
      readonly type: "invalid-request";
      readonly issues: readonly AiRequestIssue[];
    }
  | {
      readonly type: "candidate-analysis-failure";
      readonly candidateIndex: number;
      readonly canonicalKey?: string;
      readonly reason:
        | "missing-analysis"
        | "malformed-analysis"
        | "descriptor-mismatch"
        | "incomplete-required-facts"
        | "feature-extraction-failed";
      readonly detail: string;
    };

export type AiResult<TSuccess> =
  | { readonly ok: true; readonly value: TSuccess }
  | { readonly ok: false; readonly error: AiFailure };

export const isAiFailure = (
  value: AiResult<unknown>,
): value is { readonly ok: false; readonly error: AiFailure } => !value.ok;
