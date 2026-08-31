export type SimulationRegisterStatus = "open" | "provisional" | "resolved";

export interface SimulationRiskEntry {
  readonly id: string;
  readonly category:
    | "source-ambiguity"
    | "combat-scope"
    | "observation-gap"
    | "statistical-limit"
    | "performance-limit"
    | "policy-sensitivity";
  readonly status: SimulationRegisterStatus;
  readonly statement: string;
  readonly mitigation: string;
}

export interface SimulationDecisionEntry {
  readonly id: string;
  readonly status: SimulationRegisterStatus;
  readonly decision: string;
  readonly rationale: string;
  readonly revisitWhen: string;
}

/** Separate limitations from decisions so a limitation cannot become a hidden default. */
export const SIMULATION_RISK_REGISTER: readonly SimulationRiskEntry[] = [
  {
    id: "risk-combat-scope-boundary",
    category: "combat-scope",
    status: "resolved",
    statement: "Simulation v1 is limited to the certified local 1v1 ai-combat-scope:v1.",
    mitigation: "Record the scope in every run manifest and reject unsupported fixtures.",
  },
  {
    id: "risk-catalog-balance-coverage",
    category: "observation-gap",
    status: "open",
    statement: "Static catalog presence is not evidence of observed balance coverage.",
    mitigation: "Require explicit coverage cells and report never-eligible or underexposed moves.",
  },
  {
    id: "risk-policy-selection-bias",
    category: "policy-sensitivity",
    status: "open",
    statement: "A move's measured value may depend on the selected AI policy.",
    mitigation: "Use multiple profiles and mirrored or forced-exposure experiments.",
  },
  {
    id: "risk-statistical-overclaim",
    category: "statistical-limit",
    status: "open",
    statement: "Finite simulated samples cannot establish a universal balance verdict.",
    mitigation: "Publish intervals, effect sizes, sample counts, exclusions, and uncertainty.",
  },
  {
    id: "risk-variant-registry-isolation",
    category: "performance-limit",
    status: "open",
    statement: "Immutable mechanics-view support is a prerequisite for safe variants.",
    mitigation: "Complete SIM-080 before implementing variant execution.",
  },
] as const;

export const SIMULATION_DECISION_REGISTER: readonly SimulationDecisionEntry[] = [
  {
    id: "decision-no-progress-fingerprint",
    status: "provisional",
    decision: "Use combat-engine semantic-progress identity for no-progress comparison.",
    rationale:
      "Combat owns which state fields are meaningful; exact replay identity remains separate.",
    revisitWhen: "A combat-engine semantic-progress schema v2 is introduced.",
  },
  {
    id: "decision-seed-derivation-v1",
    status: "provisional",
    decision:
      "Derive seeds from semantic scenario, template, strategy, iteration, mirror, and purpose keys.",
    rationale: "Worker order and catalog display order must not affect reproducibility.",
    revisitWhen: "A versioned seed derivation migration is approved.",
  },
  {
    id: "decision-old-artifact-migration",
    status: "resolved",
    decision: "Reject mismatched Phase 0 artifact schemas with a typed error.",
    rationale: "No migration semantics exist yet, so silent reinterpretation would be unsafe.",
    revisitWhen: "A tested migrator is added for a later schema version.",
  },
  {
    id: "decision-statistical-baseline",
    status: "provisional",
    decision: "Start with Wilson binomial intervals and seeded bootstrap for skewed measures.",
    rationale: "These methods are declared in the roadmap and remain experiment configuration.",
    revisitWhen: "The first aggregate schema and fixed-manifest evidence are implemented.",
  },
  {
    id: "decision-canonical-json",
    status: "resolved",
    decision: "Use sorted-key canonical JSON v1 for logical identities and report hashes.",
    rationale: "Canonical output must not depend on insertion order or terminal formatting.",
    revisitWhen: "A compatible canonicalization migration is approved.",
  },
  {
    id: "decision-minimum-exposure",
    status: "provisional",
    decision: "Use 10 fights and 10 eligible states as the initial minimum exposure markers.",
    rationale:
      "The thresholds are evidence labels, not a claim that every metric is precise enough.",
    revisitWhen: "Pilot variance and target interval widths are measured.",
  },
  {
    id: "decision-template-sources",
    status: "resolved",
    decision:
      "Use typed simulation fixtures; normalize the 36 TF1 sheets only after template contracts exist.",
    rationale: "Simulation does not scrape live character records or infer mechanics from prose.",
    revisitWhen: "SIM-100 adds validated template materialization.",
  },
  {
    id: "decision-variant-surface",
    status: "resolved",
    decision:
      "Defer executable variant patches until the immutable mechanics-view boundary is certified.",
    rationale: "A simulation overlay must not mutate or temporarily replace canonical registries.",
    revisitWhen: "SIM-080 certifies the owning-package mechanics view.",
  },
  {
    id: "decision-comparable-algorithm",
    status: "provisional",
    decision:
      "Use a versioned multi-stage compatibility filter; do not rank comparables by name or one power score.",
    rationale:
      "Category, timing, scope, acquisition, resource, role, effects, and usage context remain distinct.",
    revisitWhen: "Static move fingerprints and observed coverage are available.",
  },
  {
    id: "decision-custom-review-status",
    status: "resolved",
    decision: "Custom reports may recommend review but never approve or reject a draft.",
    rationale: "Staff remains the sole approval authority.",
    revisitWhen: "The staff workflow explicitly changes its authority boundary.",
  },
] as const;
