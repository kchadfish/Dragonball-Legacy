# Simulation-engine implementation progress

This is the verified handoff record for `@dragonball-resurgence/simulation`.
Roadmap prose remains the implementation authority; this file records what is
implemented, the evidence for it, and the next executable item.

## 2026-08-30 - SIM-080 mechanics-view integration

Simulation decision-boundary adapters now accept a bound combat runtime. The
runtime carries the immutable mechanics identity through creation,
advancement, legal-decision enumeration, descriptor/probe calls, and
submission, allowing alternate environments to run interleaved without
swapping module-level registries. The combat package owns the view and snapshot
identity; simulation remains an orchestrator and does not interpret mechanics.

## 2026-08-31 - SIM-090 through SIM-350 Phase 3 kernel

SIM-090 through SIM-350 are complete for the local sequential single-fight
kernel. Seed keys now include scenario and mechanics identity, pair, iteration,
mirror, template hashes, strategies, and independent combat/AI/diagnostic
namespaces. The package exposes strict Zod contracts, canonical identities,
template validation/materialization, deterministic scenario expansion, closure
reporting, and an explicit containment coordinator.

The 36 TF1 balance sheets are source-linked typed fixtures with their recorded
stats, SP allocation, race/class/style/mastery/transformation identity, and an
explicit loadout blocker; no missing move, item, trait, or Ki policy was
invented. Twelve synthetic archetypes materialize against the supplied
mechanics view. `runSimulationFight` creates fresh IDs, clock, combat RNG, and
keyed fighter AI streams, then drives only the combat decision-point boundary.
Summary and diagnostic retention share the same transition path; safeguards
halt externally and do not manufacture combat completion.

Evidence: simulation package typecheck, focused Phase 0/Phase 1–3 Vitest
tests, and `validate:simulation-boundaries`. The final repository gate remains
`npm run quality`.

## 2026-08-31 - SIM-400 through SIM-550 deterministic execution foundation

The Phase 4 execution foundation is implemented: legacy and keyed seed APIs
share one derivation primitive, semantic scenario identity excludes retention
and stopping policies, and a shared transition driver owns the public
advance/decision/submit loop. Replay records now retain manifest and catalog
identity, policies, effective AI metadata, derived seeds, legal-set hashes,
decisions, transition/state/event hashes, and terminal summaries. The verifier
reruns the request and returns the first typed `input`, `combat`, `ai`,
`variant`, `schema`, or `runner` divergence.

The Phase 5 foundation adds iteration-aware fight specs, mirrored series
expansion, bounded local scheduling, cancellation, fail-fast/continue
containment, and progress callbacks. Results are returned in canonical request
order and incomplete mirrored work is counted separately from completed pairs.

Evidence: simulation typecheck, focused Vitest tests covering replay
verification and tampering, retention invariance, seed isolation, bounded
scheduling, and mirrored series expansion, plus
`validate:simulation-boundaries`.

## 2026-08-31 - SIM-540 through SIM-1540 contract foundations

Series checkpoints are now manifest-bound, keyed by deterministic fight
identity, resumable through `resumeSimulationSeries`, and mergeable with
conflict detection. The default checkpoint catalog is versioned and injectable
while retaining the six roadmap defaults. Matrix expansion has an explicit
fight budget and stable ordering.

The package now exposes mergeable counters, Welford mean/variance, bounded
histogram and centroid quantile summaries, paired differences, Wilson rate
intervals, seeded 10,000-resample bootstrap intervals, and versioned
Benjamini-Hochberg exploratory adjustment. It also exposes static per-move
coverage/funnel records, sequence normalization, anomaly findings, immutable
mechanics-view variants, custom-move preflight/review dossiers, deterministic
JSON/CSV/Markdown reports, benchmark manifests, manifest compatibility checks,
budget estimates, and anonymized human-observation calibration fixtures.

Focused regressions cover these platform-neutral contracts. The generated
catalog accounting projection is checked in at
`simulation-move-balance-matrix.json` and `.md`; its rows remain explicitly
unobserved until scenario coverage is run and reviewed.

## Current scope

- Scope: `simulation-scope:v1`
- Combat capability: `ai-combat-scope:v1`
- Rules version: `legacy-reference-2026-08` from `reference/rules.md`
- Public package versions: `ai-engine`, `combat-engine`, `game-config`, and
  `game-data` at `0.1.0`
- Catalog baseline: 499 moves, 24 races, and 80 transformations
- AI baseline: `profile:simulation-quality`, profile version `ai-profile:v1`,
  with declared effective analysis capabilities required for quality requests
- Provisional safeguards: maximum 100 turns, maximum 1,000 transitions,
  semantic no-progress limit 3, with bounded deterministic concurrency
- Transformation families: Humans, Saiyans, Hybrid-Saiyans, Namekians,
  Changelings, and Bio-Androids
- Carried exclusions: teams and joint attacks; interferers and spectators;
  remote or relationship targets; escape; body or identity mutation; permanent
  moveset or ownership mutation; permanent progression; administrator or
  narrative effects; planetary destruction; and spaceship mechanics

## Completed IDs

### SIM-000 — Scope freeze

Completed. `SIMULATION_SCOPE_V1` records the certified combat scope, public
package versions, catalog counts and content identity, legal decision-point
surface, AI profile, transformation families, and carried exclusions. The
scope derives catalog facts through `@dragonball-resurgence/game-data` public
exports.

### SIM-010 — Pre-implementation decisions

Completed as explicit provisional or resolved decisions in
`SIMULATION_DECISION_REGISTER`. The register covers semantic no-progress
identity, seed derivation, canonical JSON, statistical starting methods,
minimum exposure, template sources, variant patch surface, comparables, and
custom-review authority. Open uncertainty remains visible in the separate risk
register.

### SIM-020 — Completion gates and artifact schemas

Completed for the Phase 0 artifact envelope. Versioned contracts exist for
fight results, run manifests, aggregate reports, move-balance records, replay
records, anomaly records, and custom-move reports. The migration policy is
explicit rejection with typed `schema-mismatch` results until a tested
migrator exists.

### SIM-030 — Risk and decision registers

Completed. Risks and decisions are separate typed records. Catalog coverage,
policy sensitivity, statistical limits, and the future immutable mechanics
view are not represented as silent defaults.

### SIM-040 — Progress record

Completed. This document is the handoff record. The mechanics-view
prerequisite is resolved and no simulation consumer reads a replaceable
module-level registry.

### SIM-090 through SIM-350 — Deterministic Phase 3 kernel

Completed. Contracts, seeds, schemas, boundary validation, templates,
scenarios, closure, runner safeguards, observation, diagnostics, and
sequential failure containment are implemented in the simulation package.

### SIM-050 — Combat decision-point certification

Completed. `getSimulationDecisionPoint` delegates to the public
`combat-engine` `getCombatDecisionPoint` contract. Tests cover ordinary action
ownership, pending defense-response ownership, advanceable upkeep, and
explicit completion. Simulation code does not inspect phase, pending frames,
or active-combatant fields to infer ownership.

### SIM-060 — Effective AI capability certification

Completed. `selectSimulationDecision` delegates selection to `ai-engine`,
preserves requested profile, pipeline/evaluator versions, effective
capabilities, AI seed derivation version, and effective work limits. A
simulation-quality request without the declared probe-backed capability set
returns `insufficient-analysis-capabilities`.

### SIM-070 — Semantic-progress certification

Completed. `createSimulationSemanticProgressIdentity` and
`hasSameSimulationSemanticProgress` delegate to the combat-owned semantic
identity. Bookkeeping-only version, event-sequence, and generated-ID changes
compare equal; meaningful state such as turns, durations, scheduled work,
restrictions, stored selections, transformations, and pending choices remains
owned by the combat identity.

## Verification evidence

- `npm run typecheck --workspace @dragonball-resurgence/simulation`
- `npx vitest run packages/simulation/src/phase-0.test.ts`
- Existing combat decision-point and semantic-progress tests remain the
  authoritative engine-level evidence for those contracts.

## 2026-08-31 - SIM-800 through SIM-1540 executable evidence and closure

The deterministic all-move isolation manifest now runs every one of the 499
canonical moves through the normal combat decision-point, AI selection,
submission, advance, and structured-event observation boundaries. The default
coverage envelope is 30 turns, 500 transitions, and 20 semantic no-progress
transitions per fight, with a target of 10 completed simulation runs and 10
eligible states per move and a bounded two-times retry budget. The final
artifact records 9,980 attempts, 280 sufficient isolation cells, and 219
reviewed isolation exclusions. Natural coverage is explicitly excluded under
the reviewed TF1/loadout policy; no natural selection evidence is inferred.

The exclusions retain the measured population and funnel evidence. They cover
only moves with no authoritative legal exposure, repeated authoritative
runtime failure, or bounded underexposure; they are not balance conclusions
and require setup or combat-runtime review before re-inclusion. The artifact
and dataset hashes are validated before closure, and the balance JSON/Markdown
projection is generated from that artifact with freshness hash
`fnv1a-32:aafe399b`.

Evidence: simulation typecheck, focused Phase 1-3/Phase 4-15/statistics tests,
simulation boundary validation, move-closure validation, report freshness
validation, and the generated artifact at
`simulation-move-coverage.json`. The remaining release gate is the final
repository `npm run quality` run after all edits are complete.

## Known limits and next step

Remaining work is release verification and future evidence maintenance: rerun
the frozen manifests when the mechanics identity changes, replace reviewed
exclusions only after a setup or combat-runtime correction, and keep the
canonical report projections fresh. Worker-backed concurrency remains
deferred because the deterministic local scheduler is the current measured
execution path; benchmark drift is reported rather than allowed to alter
correctness thresholds.
