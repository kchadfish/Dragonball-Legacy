import type {
  CombatAnalysisProbe,
  CombatDecisionDescriptor,
  CombatResult,
  CombatantId,
  FightState,
  LegalDecision,
} from "@dragonball-resurgence/combat-engine";
import type {
  ItemDefinition,
  MoveDefinition,
  TransformationDefinition,
} from "@dragonball-resurgence/game-data";

import type { AiRandomSource } from "./random.js";

export type DiagnosticRetention = "none" | "selection-only" | "ranked-summary" | "full";

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

export interface ScoreFactor {
  readonly key: string;
  readonly value: number;
  readonly provenance: CandidateProvenance;
}

export interface CandidateEvaluation {
  readonly decision: LegalDecision;
  readonly canonicalKey: string;
  readonly scoreFactors: readonly ScoreFactor[];
  readonly provenance: readonly CandidateProvenance[];
  readonly totalScore: number;
  readonly rank: number;
}

export interface AiDiagnostics {
  readonly level: Exclude<DiagnosticRetention, "none">;
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
    };

export type AiResult<TSuccess> =
  | { readonly ok: true; readonly value: TSuccess }
  | { readonly ok: false; readonly error: AiFailure };

export const isAiFailure = (
  value: AiResult<unknown>,
): value is { readonly ok: false; readonly error: AiFailure } => !value.ok;
