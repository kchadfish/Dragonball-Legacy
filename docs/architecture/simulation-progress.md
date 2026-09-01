# Simulation-engine implementation progress

This is the verified handoff record for `@dragonball-resurgence/simulation`.
Roadmap prose remains the implementation authority; this file records what is
implemented, the evidence for it, and the next executable item.

## 2026-08-31 - SIM-V2 Monte Carlo closure work

Combat transitions now optionally retain immutable mechanic observations with
definition provenance while preserving state, event, random, and replay
identities. Decision-required points are non-empty, and counter continuation
cannot create an invalid counter phase without a resolved counter action.

Simulation coverage and move artifacts are versioned as v2. Coverage now
separates decision and trigger funnels, natural/isolation/forced populations,
failure-aware states, registered scope decisions, precision looks, and
stratified mergeable accumulators. Population artifacts now persist root-seed,
fixed-time, and per-move attempt offsets so `resume` advances a precision look
without replaying prior attempts or pooling denominators. Catalog iterations
now emit deterministic original/mirrored orientations under one semantic pair
identity. TF1 overlays are deterministic drafts with
the canonical 1/4/5/2/2 slot limits and remain blocked for natural evidence
until explicitly approved. The catalog runner no longer converts setup,
underexposure, AI, or combat failures into exclusions. The checked-in pilot
artifact is intentionally not closure-complete until the catalog run and
overlay approval produce sufficient required cells.

The v2 artifact now also persists bounded per-population, per-move combat
seeds for representative replay reruns. The pure move-balance report consumes
coverage cells and publishes Wilson interval evidence for decision and trigger
funnels, descriptive population effect sizes with explicit non-causal and
exposure-only rationale, comparable-selection rationale, and representative
seed projections. The CLI exposes deterministic `dossiers` output, and the
checked-in pilot currently contains 499 move records, 998 mirrored orientation
runs, 998 decision/trigger cells, and zero run failures.

Merged catalog artifacts can resume only the requested existing populations;
population attempt offsets are merged as cumulative maxima so continuation does
not double-count prior orientations. Closure validation now requires decision
and trigger cells for natural, isolation, and forced populations.

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

## 2026-08-31 - SIM-800 through SIM-1540 executable evidence (superseded pilot)

The earlier v1 isolation pilot is retained as historical context only. It used
10 attempts and free-text exclusion accounting, so its 219 exclusions are not
completion evidence and are rejected by the v2 validators. The replacement v2
pilot runs all 499 canonical moves through the normal combat decision-point,
AI selection, submission, advance, and structured-event observation boundaries
with separate decision and trigger cells. The current pilot records 998
required cells and explicit `not-scheduled`, `observed-low-sample`,
`eligible-never-selected`,
and `runner-failure` states, plus typed failure slots; it intentionally does
not claim catalog closure. Natural coverage remains blocked until the 36 draft
TF1 overlays are explicitly approved.

Evidence: simulation typecheck, focused Phase 1-3/Phase 4-15/statistics tests,
simulation boundary validation, move-closure validation, report freshness
validation, and the generated artifact at
`simulation-move-coverage.json`. The remaining release gate is the final
repository `npm run quality` run after all edits are complete.

## 2026-09-01 - SIM-1550 through SIM-1600 metric and report projections

Completed the v2 observability projection without changing authoritative fight
state. The runner now streams mergeable per-move metrics for outcomes, damage,
overkill, remaining resources, Ki efficiency, action economy, attack outcomes,
statuses, transformations, restricted use, deferred sequences, stalls, event
and die outcomes, policy/orientation counts, and diagnostic versus summary-only
coverage. Mirrored runs share one semantic pair identity and produce separate
paired target-versus-control accumulators with deterministic bootstrap
intervals; population namespaces remain distinct.

The generated report projections are now available as JSON, Markdown, and CSV,
with a metric dictionary, denominators, confidence intervals, effect sizes,
paired effects, comparability rationale, replay seeds, and follow-up targets.
Per-move dossiers are scoped to one move, so they do not duplicate the full
catalog's metrics. The CLI benchmark presets execute real simulation requests
and emit deterministic hashes rather than placeholder timing records.

Evidence: the isolation pilot completed 499 moves across 998 mirrored runs with
zero failures; report freshness verified at `fnv1a-32:b9684ffb`; all 14 v2
contract tests pass, including worker equivalence, pair merging, report
effects, and the executable fast benchmark. Natural and forced production
populations remain intentionally unpopulated pending the required TF1 approval
reference.

## Known limits and next step

Remaining work is release verification and future evidence maintenance: rerun
the frozen manifests at the configured precision looks, approve the TF1
overlays, resolve every runtime failure, and keep the canonical report
projections fresh. The worker-backed executor preserves sequential hashes and
merge order. Natural coverage remains an explicit approval-controlled
population, and benchmark drift must not alter correctness thresholds.
