# Simulation-engine implementation progress

## 2026-09-07 - SIM-V4 finalized contracts, experimental arms, and resumable mirrors

The v4 statistics boundary now uses finalized `simulation-statistics-request:v2`
and `simulation-statistics-checkpoint:v2` contracts. Checkpoints retain
completed mirror identities, accepted half-mirror results, arm identities, seed
offset identities, paired aggregate identities, and canonical merge position;
preliminary v4 checkpoint versions are rejected. Artifact readers verify the
artifact and every nested metric hash, and draw-aware paired success mass is
allowed to remain fractional.

Natural, controlled, and diagnostic catalog requests now have distinct arm
identities and inputs. Controlled arms rotate deterministic fixed-total stat
transfers with HP/Power/Dexterity tie order and item/transformation preference
arms; diagnostics use forced legal mechanic exposure with identical AI profiles.
The CLI catalog command selects the schedule explicitly. A successful mirror is
checkpointed before its pair is folded, so resumption submits only the missing
mirror and preserves one-shot/resume identity.

Dashboard projections expose deterministic metric-family sections and explicit
evidence state/reason, including never-eligible and eligible-never-selected
outcomes. Full 100-pair checked-in catalog artifacts still require the final
coverage and quality gates before execution.

## 2026-09-06 - SIM-V4 authoritative catalog runner and resumable folding

The v4 catalog runner now drives the public simulation/combat transition path,
retains calculation telemetry until the v4 accumulator folds it, and writes
deterministic mirrored-pair statistics. Its checkpoint contract records
mechanics, template/scenario/metric/seed identities, root seed, fixed time, AI
profile, evidence roles, target, per-cell continuation state, failures, batch
and canonical-order hashes, and an overall checkpoint hash. Resume validates
those identities, executes only missing iterations, rejects lower targets, and
caps continuation at 400 pairs. Canonical Welford folding is normalized so a
one-shot run and a checkpoint/resume run produce the same artifact hash.

`simulate catalog` is the v4 path; `catalog-run` remains the legacy v3 move
coverage command. V4 dashboard, source-dossier, freshness, and closure paths
are schema-routed, while v3 report/resume behavior remains preserved. The
focused runner smoke uses real mirrored combat transitions and currently
verifies a two-template one-shot/resume artifact with zero failures; the full
Natural Normal production artifact remains an execution deliverable rather
than being represented by synthetic data.

## 2026-09-06 - SIM-V4 bounded statistics and dashboard contract

The simulation package now exposes the versioned v4 statistics surface:
`simulation-statistics-artifact:v4`, `simulation-fight-statistics:v1`, and
`simulation-metrics:v2`. v4 folds observations into bounded Welford,
histogram, quantile, denominator, and paired-observation aggregates. It
normalizes fighter dimensions to stable A/B identities, keeps incomplete,
error, forced-exposure, and natural-balance evidence separate, caps
continuation at 400 pairs, and renders deterministic JSON, CSV, and Markdown
dashboard projections. Existing v3 coverage artifacts remain owned by the
move-coverage tooling and are rejected by the v4 dashboard parser.

The v4 metric definition catalog names the core, move, style/build,
dexterity, Ki/defense, item, transformation, AI, sequence, and separate
utility families without introducing a composite utility score. The CLI now
accepts `dashboard`, `freshness`, and `catalog` aliases for v4-aware report
paths. A v4 continuation runner and fresh full Natural Normal artifact remain
follow-up work; the existing v3 runner is intentionally not silently migrated.

This is the verified handoff record for `@dragonball-resurgence/simulation`.
Roadmap prose remains the implementation authority; this file records what is
implemented, the evidence for it, and the next executable item.

## 2026-09-05 - Progressive Natural Normal precision looks

The initial 250-pair Natural Normal catalog run was deferred because its
measured schedule and runtime were impractical: the production-shaped
throughput measurement projected roughly 245 hours at 250 pairs. Progressive
looks reduce the initial screening cost without changing combat transitions,
Normal AI, natural fixtures, mirroring, seed derivation, mechanics identity,
worker count, checkpoints, or metric accumulation.

The new catalog policy starts at 50 pairs, continues at 100, and requires at
least 250 pairs for production closure. Screening findings are triage evidence,
not final balance certification. Additional pairs are cumulative under the
same manifest and deterministic seed schedule; resume executes only missing
iterations and never relabels or resumes the historical target-250 artifacts
downward. The screening artifact remains under `artifacts/simulation` and the
canonical production artifact is unchanged until the 250-pair closure gate
passes.

### Current statistical precision

The Wilson half-width values below are worst-case planning approximations for a
binary rate. Authoritative reports continue to use observed denominators,
Wilson intervals, paired effects, missingness, and error counts.

| Target / completed pairs | Total completed fights | Evidence level       | Approx. worst-case 95% Wilson half-width | Relative sampling noise vs 250 pairs | Schedule size                                    | Elapsed time | Projected remaining time |                                       Failures | Artifact hash     | Current status                                           |
| ------------------------ | ---------------------: | -------------------- | ---------------------------------------: | -----------------------------------: | ------------------------------------------------ | ------------ | ------------------------ | ---------------------------------------------: | ----------------- | -------------------------------------------------------- |
| 50 / 50                  |                    100 | screening            |                   ±9.6 percentage points |                                2.24× | planning value                                   | —            | —                        |                                              — | —                 | planning approximation                                   |
| 100 / 100                |                    200 | confirmation         |                              ±6.9 points |                                1.58× | planning value                                   | —            | —                        |                                              — | —                 | planning approximation                                   |
| 250 / 250                |                    500 | production-candidate |                              ±4.4 points |                             baseline | planning value                                   | —            | —                        |                                              — | —                 | baseline production candidate                            |
| 50 / 50–161*             |               100–322* | screening            |                   ±9.6 percentage points |                                2.24× | 3,972 natural oriented requests across 499 moves | ~35 min*     | —                        | 0 unresolved; 472 recovered typed observations | fnv1a-32:ae68dafb | screening closure complete; not production certification |

| 100 / 100-366* | 200-732* | confirmation | ±6.9 points | 1.58× | 8,066 natural oriented requests across 499 moves | ~2 h 10 min* | — | 0 unresolved; 472 recovered typed observations | fnv1a-32:04bf5446 | confirmation closure complete; not production certification |
The planning values are intentionally approximate and should not be read as
observed precision. The current-state row is updated after each completed
precision look with achieved pairs, runtime, failures, and the artifact hash.

The completed Natural Normal screening artifact is
`artifacts/simulation/catalog-v3-natural-50.json`. It contains 499 moves and
998 target-present cells covering both decision and trigger paths. All 998
cells are sampling-sufficient after same-look continuation; each has at least
50 mirrored pairs / 100 oriented move-credit fights, with targeted sparse-cell
recovery producing a final per-cell range of 50–161 pairs / 100–322 oriented
fights. The run submitted 3,972 natural oriented fight requests, with 3,500
successful fight requests represented in move-credit metrics and 472 typed
failure observations recovered by continuation. The final artifact has zero
unresolved errors, screening closure passes, and its artifact hash is
`fnv1a-32:ae68dafb`; the approximately 35-minute runtime includes the
same-look corrective continuations through 2026-09-06 08:31 CDT.

The completed Natural Normal confirmation artifact is
`artifacts/simulation/catalog-v3-natural-100.json`. It contains the same 499
moves and 998 target-present cells as the screening look. All 998 cells are
sampling-sufficient after same-look continuation; each has at least 100
mirrored pairs / 200 oriented move-credit fights, with targeted sparse-cell
recovery producing a final per-cell range of 100-366 pairs / 200-732 oriented
fights. The run submitted 8,066 natural oriented fight requests, with 7,594
successful fight requests and 472 typed failure observations recovered by
continuation. The final artifact has zero unresolved errors, confirmation
closure passes under the screening validator, and its artifact hash is
`fnv1a-32:04bf5446`; the end-to-end runtime was approximately 2 hours 10
minutes through 2026-09-06 13:02 CDT. This is confirmation evidence for balance
triage and move-specific retesting, not the canonical production catalog.

The target-100 natural observation breakdown is 133 cells observed, 157
eligible but never selected, and 708 never eligible under the natural Normal
population. These limitations remain visible in the artifact and report; they
do not promote the confirmation look to production certification. The nominal
250-pair / 500-oriented-fight look remains the production-candidate target.

The natural observation breakdown remains visible: 131 cells are observed,
158 are eligible but never selected, and 709 are never eligible under the
natural Normal population. Those states are screening evidence and identify
where move-specific retesting or controlled exposure is needed. This 50-pair
artifact is not the canonical production catalog and does not satisfy the
100-pair confirmation or 250-pair production-candidate look; production
documentation must continue to distinguish screening closure from 250-pair
production closure. The asterisks in the current row denote the per-cell
range created by targeted eligibility recovery beyond the nominal 50-pair
screening look.

## 2026-09-02 - SIM-V3 coverage, retention, and deterministic orchestration

The simulation coverage artifact and coverage cells now use v3 contracts.
Coverage targets are expressed as mirrored `targetPairs`; the deprecated
`targetFights` CLI/API alias remains accepted only when supplied alone. Cell
sampling and observation are separate dimensions, with explicit evidence roles
for natural observation, mechanic exposure, and balance controls. v1/v2
artifacts are rejected on resume and closure paths.

Coverage retention is compact: it keeps foldable counters, terminal state/event/
decision hashes, replay manifest hashes, and bounded representative seeds while
omitting transitions, evaluations, state histories, and diagnostic traces.
Metrics and mirrored-pair accumulators retain stable composite keys for
population, profile, exposure context, and evidence role; merge operations do
not pool those strata. Checkpoints are v3, batch-sized at 25 pairs, and are
written atomically by the canonical generator and CLI.

Natural coverage defaults to the Normal profile and approved TF1 source
overlays. Stable identities deduplicate identical natural fights and credit
every applicable equipped move. Isolation uses matched target-present,
target-removed, and comparable-replacement contexts with legal-set-only
controlled selection. Forced coverage uses legal target-first decisions and
stops at `coverage-satisfied` while the fight is still active; it records no
win-rate or precision evidence. Maximum turns, transitions, and semantic
no-progress safeguards produce typed stalls and never manufacture completion.

The checked-in artifact is a deterministic pilot at target pair look 1 with
complete isolation/forced catalog scheduling and an explicit draft natural
population blocker. A full approved Normal natural production run remains the
next data-generation operation; the report, matrix, CSV, and dossiers are
regenerated from the v3 artifact and freshness-validated.

The compact runtime now reuses immutable legal sets and static descriptor facts,
and skips discarded search-path/state-history hashing in coverage retention.
The fixed v3 acceptance benchmark covers two moves across natural, isolation,
and forced populations with Normal-profile mirrored requests: four workers,
12 requests, zero failures, 22,864 output bytes, and approximately 4.2 seconds
on the local workspace. This benchmark fixture is performance evidence only;
it does not replace the pending full Normal natural production run.

The post-optimization production-shaped 50-fight Normal natural measurement is
recorded in [natural-v3-throughput.json](../../artifacts/simulation/cli-1788619140330/natural-v3-throughput.json).
It retained the compact coverage path and four workers, took 839,839.517 ms,
used 3,066,250,000 user and 45,610,000 system CPU microseconds, reached
1,213,849,600 bytes peak RSS, and recorded 3,783 decisions, 12,047 probes,
and 9,689 transitions. The authoritative result hash was
`fnv1a-32:8a8f40ea`; the run was deterministic across repeated measurements.
The schedule estimator reports 26,258 unique natural matchups and 52,516
required fights, projecting 245.03 hours. The memory gate passed, but the
duration gate did not (and 11 of the 50 representative fights hit existing
typed safeguards or combat failures), so production was intentionally not
resumed under the stated stop rule.

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
identity. TF1 overlays use the repository-authoritative source
`repository:balance-testing/tf1:v1` with the canonical 1/4/5/2/2 slot limits.
Unsupported source fields remain explicit capability or item limitations. The
catalog runner no longer converts setup,
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
stats, SP allocation, race/class/style/mastery/transformation identity, and
explicit capability limitations; no missing move, item, trait, or Ki policy was
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
- AI baseline: Normal natural production with `profile:normal`; controlled and
  forced exposure use `profile:simulation-quality`, profile version
  `ai-profile:v1`, with declared effective analysis capabilities required for
  quality requests
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
not claim catalog closure. Natural coverage now uses the repository-authoritative
TF1 source; unsupported specialization, Ki, inventory-quantity, and out-of-scope
mechanics remain visible as limitations in artifact and report metadata.

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

Evidence: the prior isolation pilot completed 499 moves across 998 mirrored runs
with zero failures; it is superseded by the context-stratified catalog
implementation. The new production artifact must be regenerated at the
configured precision looks and verified by closure and freshness checks.

## 2026-09-02 - Monte Carlo catalog orchestration

The catalog runner now authorizes TF1 through
`repository:balance-testing/tf1:v1`, retains source capability limitations,
and combines approved TF1 anchors with deterministic generated, synthetic, and
per-move fallback templates. Natural Normal, Hard, and Simulation Quality
profiles remain selectable and reportable independently. Isolation coverage is
stratified into target-present, target-removed, and comparable-replacement
contexts; forced target-first evidence remains diagnostic and separate from
natural evidence.

Coverage cells retain profile/context strata, Wilson precision state, per-context
attempt offsets, and deterministic look continuation at 50, 100, 250, 500,
1,000, 2,000, 5,000, and 10,000 mirrored pairs. CLI catalog and resume workflows support
population, profile, context, retry, output, and reproducible resume selection.
The canonical production run still requires execution at the declared looks;
the checked-in artifact is not marked closure-complete until that run finishes.

## Known limits and next step

Remaining work is release verification and evidence generation: run natural AI
coverage separately for Normal, Hard, and Simulation Quality profiles, run the
isolation contexts and forced diagnostic population, continue incomplete cells
through the declared precision looks, resolve every runtime failure, regenerate
the canonical JSON/CSV/Markdown/dossiers, and run the closure, freshness, and
final quality gates. The worker-backed executor preserves sequential hashes and
merge order; forced evidence remains exposure-only.
