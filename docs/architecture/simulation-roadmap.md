# Simulation-engine completion roadmap

## Purpose

This document is the dependency-ordered implementation roadmap for delivering
`@dragonball-resurgence/simulation`. It turns the boundaries in
[ARCHITECTURE.md](../../ARCHITECTURE.md) and
[combat-ai-simulation.md](combat-ai-simulation.md) into an executable work queue
for three connected outcomes:

1. reproducible Monte Carlo-style combat simulation;
2. complete static and observed balance data for every in-scope move; and
3. an immutable custom-move checking laboratory that supports staff decisions
   without making approval decisions itself.

The simulation package is an experimental runner and analysis consumer. It is
not a second combat engine. It must create and advance fights only through the
public `combat-engine` transition boundary, and it must select actions only
through `ai-engine` or an explicitly supplied policy that returns an exact
engine-enumerated legal decision.

Once implementation begins, create and maintain
`simulation-progress.md` as the verified handoff record. Generate a
`simulation-move-balance-matrix` as the catalog-accounting record once the move
observation schema exists. This roadmap owns dependency order, not current
implementation status.

## Current repository baseline

As of 2026-08-30:

- `packages/simulation` now exists with the Phase 0 public contracts and
  certifications for SIM-000 through SIM-070. `scripts/simulate-fights.ts`
  remains an empty placeholder until the runner phases are implemented.
- Combat Phase 11 is complete for `ai-combat-scope:v1`. The generated combat
  capability matrix accounts for 1,612 occurrences with no
  `unsupported-in-scope` row. Excluded multiplayer, remote, identity,
  progression, administrator-mediated, narrative, escape, and spaceship
  mechanics remain explicit scope decisions.
- The active move catalog contains 499 definitions: 250 Advanced Attacks, 97
  Signature Techniques, 80 Skills, 36 Blocks, and 36 Masteries. It spans the
  seven style sources plus Afterlife and has typed, source-traceable mechanics
  and effects.
- The combat engine exposes immutable, versioned state; injected seeded and
  branch-local dependencies; complete legal decisions including pending
  selections; structured events; result classification; decision descriptors;
  deterministic analysis probes; explicit completed fight states; a public
  `CombatDecisionPoint` boundary; and combat-owned semantic-progress identity.
- `ai-engine` is complete through AI-1150 for the active local 1v1 scope. It
  exposes deterministic simulation-quality profiles, canonical decision
  replay, bounded lookahead, work budgets, reduced diagnostic retention, a
  public legal-decision selector, and an effective-capability gate that rejects
  simulation-quality requests without declared probe-backed facilities.
- `npc-ai` has reached NPC Intelligence Complete. Its headless certification
  runner proves autonomous fights, external turn/transition/no-progress
  safeguards, telemetry, and replay identity, but it is certification tooling,
  not the production simulation package.
- `balance-testing/` contains 36 TF1 character sheets, one for each mastery
  across Akaikaru, Aoyosumu, Haokiru, Kiihakai, Kurokonwaku, and Midorikatai.
  These are useful source fixtures but are not yet typed simulation templates.
- There is no simulation scenario schema, seed manifest, batch runner,
  statistical aggregator, move-balance matrix, immutable variant mechanism,
  custom-move checker, or staff-facing report. Those remain later roadmap
  scope after the immutable mechanics-view prerequisite.
- Combat creation, transitions, invariants, descriptors, and trigger resolution
  still contain many direct reads from canonical module-level registries. An
  immutable variant cannot yet flow through one fight without an owning-package
  catalog/mechanics-view boundary; SIM-080 must certify or correct that before
  the runner architecture freezes.

Implementation must update this baseline from repository evidence. A catalog
count is an accounting fact, not proof that the corresponding content is
balanced.

## Definition of the finished system

The simulation workstream is complete only when all of the following gates are
satisfied.

### Boundary gate

- Every fight is created, advanced, and resolved through the public
  `combat-engine` API.
- Every automated choice is an exact member of the engine-enumerated legal set.
- Simulation code contains no damage, cost, roll, status, transformation,
  legality, or victory calculation.
- The dependency graph remains acyclic:
  `simulation -> ai-engine -> combat-engine`, never the reverse.
- `simulation` has no application, Discord, persistence, filesystem, or live
  player-record dependency in its domain-facing modules.

### Reproducibility gate

- A run manifest identifies the source commit, rules version, catalog versions,
  simulation schema version, AI versions and profiles, template/scenario
  versions, variant identity, root seed, derivation algorithm, limits, and
  retention level.
- Repeating a manifest produces identical per-fight summaries, aggregate data,
  preserved anomaly replays, and canonical logical report hashes.
- Sequential and bounded-concurrency execution, every supported worker count,
  and every partition/merge order produce the same canonical serialized logical
  output. Wall-clock and environment metadata live outside that hash.
- Diagnostic retention and progress reporting do not alter decisions, random
  consumption, events, or final state.

### Monte Carlo gate

- Single fights, paired mirrored fights, series, and scenario matrices share
  one runner contract.
- Batch execution is bounded by iterations, transitions, turns, semantic
  no-progress, time/cancellation, and retained-diagnostics budgets.
- Statistical reports state population, sample size, paired or unpaired design,
  interval method, confidence level, effect size, missing/error counts, and the
  exact comparison being made.
- Every experiment declares a fixed-count, versioned sequential, or incomplete/
  cancelled stopping policy. Ad hoc significance-driven stopping is invalid.
- A balance conclusion never relies on raw win rate alone.

### Move-data closure gate

- Every one of the 499 current moves has exactly one generated static balance
  record and an explicit observed-coverage status for every required scenario
  family.
- Each record distinguishes source facts, engine capability identity, static
  derived features, observed simulation metrics, uncertainty, exclusions, and
  data-quality warnings.
- No move is labeled balanced merely because it compiled, was selected, or did
  not trigger an anomaly.
- Catalog changes make the closure validator fail until the new or changed move
  is deliberately accounted for.

### Custom-move gate

- Untrusted drafts are schema-validated and reference-validated before any
  simulation begins.
- Experimental definitions are immutable, simulation-local overlays and never
  mutate the live game-data registry.
- A review compares baseline, addition, nearest-comparable replacement, and
  mechanically identical controls across representative builds and interaction
  scenarios.
- Reports explain comparable selection, coverage, uncertainty, anomalies, and
  unsupported mechanics.
- The system may return `cannot-evaluate`, `insufficient-evidence`,
  `no-flag-detected`, or `staff-review-required`; it must not auto-approve,
  auto-reject, or assign a universal power score.

### Operational gate

- Smoke, exploratory, decision-support, catalog-closure, and benchmark presets
  are versioned and separately named.
- Summary runs do not retain every state or event; diagnostic reruns preserve
  only selected seeds.
- JSON is the canonical machine-readable report. CSV tables and Markdown are
  deterministic projections of that report.
- Fixed-seed synthetic regressions detect intentionally broken zero-cost damage,
  hard-lock loops, and dominated alternatives without flaky probability-only
  assertions.

## Architecture and ownership

```text
game-config + game-data
          |       |
          v       v
      combat-engine ------ authoritative legal transitions and outcomes
          |
          v
       ai-engine --------- decision selection and diagnostics
          |
          v
       simulation -------- templates, scenarios, seeds, batches, analytics,
          |                 variants, custom review, reports, replay
          v
    staff decision support
```

### `game-config` ownership

`game-config` owns universal game constants and rules versions. Simulation may
record and compare them but must not shadow them with simulation-owned combat
constants. Simulation-only experiment controls such as sample counts,
confidence levels, turn caps, and retention budgets belong to simulation.

### `game-data` ownership

`game-data` owns canonical move, item, transformation, race, class, status, and
effect definitions. It also owns the canonical `MoveDefinition` vocabulary.
Simulation may derive read-only features and build immutable overlays, but it
must not add callbacks, parse effect prose at runtime, or mutate exported
registries.

### `combat-engine` ownership

`combat-engine` remains authoritative for legal decisions and combat outcomes.
The simulator may consume state, transitions, events, descriptors, calculation
traces, and analysis results. If a required observation cannot be derived from
those public facts without duplicating a combat rule, extend the smallest
combat-owned structured diagnostic contract first.

### `ai-engine` ownership

`ai-engine` owns action evaluation, profiles, bounded lookahead, deterministic
decision variation, and decision replay. Simulation chooses and records
profiles, but does not tune a hidden alternate evaluator. A simulator may also
accept a policy adapter for test controls, provided it can only select exact
legal decisions.

### `npc-ai` ownership

`npc-ai` owns authored NPC policies and boss phases. Simulation may use those
policies when measuring NPC behavior. General balance runs should use generic
`ai-engine` profiles directly so canonical NPC assignments do not become a
hidden balance rule. `simulation` must not depend on `npc-ai` unless a concrete
NPC-scenario adapter is deliberately added; its core must remain independent.

### `simulation` ownership

Simulation owns:

- template and scenario identities;
- progression-checkpoint metadata;
- deterministic seed allocation;
- fight/series/matrix orchestration;
- external stall and resource safeguards;
- summary and diagnostic observation;
- incremental aggregation and statistical analysis;
- move exposure and catalog coverage accounting;
- sequence, interaction, and anomaly analysis;
- immutable experimental variants;
- custom-move review workflows;
- replay records; and
- machine-readable and staff-facing reports.

It must not own combat results, canonical data, live character records,
administrator decisions, or platform rendering.

## Initial scope and explicit exclusions

### Included in `simulation-scope:v1`

- deterministic local 1v1 fights;
- all engine-supported move, item, race/class, and active-family transformation
  mechanics in `ai-combat-scope:v1`;
- generic simulation-quality AI profiles and deliberately selected alternate
  personalities;
- canonical move balance analysis;
- the 36 existing TF1 mastery sheets after typed normalization;
- synthetic archetypes and progression checkpoints;
- mirrored matchups, variants, replay, statistics, and custom move drafts; and
- simulation-only maximum-turn, maximum-transition, and semantic-no-progress
  outcomes.

### Carried exclusions

The following remain excluded until the combat engine deliberately widens its
scope: teams and joint attacks, interferers and spectators, remote or
relationship targets, escape actions, body and identity mutation, permanent
moveset or ownership mutation, permanent progression, administrator/narrative
effects, planetary destruction, and spaceship mechanics.

### Simulation-specific non-goals

- full MCTS, reinforcement learning, or LLM combat decisions;
- distributed computing or a service architecture for the first release;
- mutation of canonical registries or persistence records;
- scraping live character sheets as part of the core runner;
- automatic balance verdicts or custom content approval;
- treating simulated AI as optimal play or as a replacement for human testing;
- asserting causation from correlation, selection rate, or win rate alone; and
- exhaustive enumeration of every possible moveset combination. Coverage uses
  deliberate scenario design, pairwise interaction coverage, and targeted deep
  experiments instead of an infeasible Cartesian product.

## Core contracts to settle first

Exact names may change during implementation, but the following information
must have typed, versioned contracts.

### Identity and versions

Use stable lowercase, hyphenated IDs with owning namespaces:

- `simulation-template:*`;
- `simulation-scenario:*`;
- `simulation-series:*`;
- `simulation-variant:*`;
- `simulation-run:*`;
- `simulation-report:*`; and
- `custom-move-draft:*`.

Version the simulation schema, observation schema, aggregate schema, seed
derivation, template catalog, scenario catalog, metric dictionary, anomaly
rules, comparator algorithm, and custom-review workflow independently. Do not
use package version alone as report identity.

The canonical run manifest includes or hashes source commit, rules version,
combat scope/version, game-data/catalog hash, immutable variant hash,
simulation schema, metric dictionary, template/scenario identities, AI
pipeline/evaluator version, requested profiles, effective AI capabilities,
combat and AI seed-derivation versions, root seed, work/execution budgets,
retention, statistical design, and stopping policy. Generated time,
environment, worker completion order, and local paths are non-canonical
metadata unless a manifest explicitly promotes them to input identity.

### Fighter template

A `SimulationFighterTemplate` must carry:

- stable ID, display label, template version, source/provenance, and tags;
- configurable progression checkpoint rather than a hardcoded tier union;
- base HP, Power, Dexterity, Dexterity Bonus, Ki inputs, and any other fields
  required by `createFight`;
- race, selected traits, class, style, mastery, moves in character-sheet order,
  items, and available transformations;
- policy/profile reference and optional policy-side metadata;
- a validation result that distinguishes malformed input, unknown references,
  incompatible loadout, unsupported combat scope, and scenario exclusion; and
- a canonical content hash used by replay and report identity.

Template materialization must be pure. It may normalize approved source
fixtures into `CreateFightInput`, but it may not create a fight, allocate IDs,
roll randomness, or infer mechanics from prose.

### Scenario

A `SimulationScenario` must identify:

- two template references or template generators;
- fight mode;
- strategy/profile assignment;
- variant reference;
- mirrored dimensions;
- root seed and iteration plan;
- turn, transition, no-progress, work, diagnostic, and concurrency budgets;
- fixed-count, versioned sequential, or incomplete/cancellation stopping policy;
- required metric and coverage families;
- checkpoint, archetype, matchup, isolation, and interaction tags;
- expected exclusions or unsupported facts; and
- completion criteria.

Scenario expansion must produce a deterministic ordered list. Display order,
filesystem order, concurrency, and previous failures must not change identities
or seed allocation.

### Seed manifest

Derive independent combat and AI seeds from semantic keys using the existing
deterministic seed facility or a versioned simulation wrapper:

```text
root seed
  + seed-derivation version
  + scenario ID
  + variant ID
  + template A/B hashes
  + strategy A/B IDs
  + iteration index
  + mirror orientation
  + purpose (combat | ai-a | ai-b | diagnostic-rerun)
```

Never allocate seeds from worker completion order or a mutable global cursor.
Adding a scenario must not renumber the seeds of existing scenarios.

### Fight result and termination

A `SimulationFightResult` must retain:

- run, scenario, pair, iteration, mirror, variant, and seed identities;
- winner/loser when combat itself completes;
- engine completion reason when available;
- a separate simulation termination reason for maximum turns, maximum
  transitions, semantic no-progress, cancellation, typed combat failure, typed
  AI failure, invalid fixture, or unsupported scope;
- turns, transitions, final resources, transformations, statuses, action counts,
  and move-level counters;
- error/failure details safe for deterministic serialization;
- state/event/decision replay hashes; and
- optional diagnostic references, never an invented engine completion state.

The runner must not surrender, cancel, damage, or otherwise mutate a fight to
force a simulation terminal result.

Replay identity is the exact snapshot/transition/decision/ID/seed identity used
to reproduce a run. Semantic progress identity is the combat-owned equivalence
used only for loop and no-progress safeguards. They are separate contracts and
must never share a hash field or substitute for one another.

### Observation levels

- `summary`: minimum counters required for aggregate reports; no full state or
  event transcript.
- `sampled`: summary plus configured periodic or stratified observations.
- `diagnostic`: full structured events, decisions, AI evaluations, and optional
  calculation trace for one preserved fight.
- `anomaly`: summary-first execution followed by a deterministic diagnostic
  replay for a flagged seed.

Retention must be observational. Running the same fight at different retention
levels must produce identical authoritative transitions and summary hashes.

### Variant

A `SimulationVariant` must carry a stable ID, base catalog/version hashes,
ordered typed patches, author-supplied rationale, affected definition IDs,
validation results, and a canonical hash. Applying a variant returns a new
immutable mechanics/catalog view. It must reject unknown IDs, duplicate or
conflicting patches, unsupported effect discriminants, unresolved references,
and changes outside its declared scope.

Patch operations should initially be limited to add one simulation-local move,
replace one move definition, and override explicit balance-relevant fields.
Arbitrary executable callbacks and mutation of module-level exports are never
allowed.

## Move-balance data model

The move-balance record is a join across distinct evidence layers. Keeping them
separate prevents observed AI behavior from being mistaken for a source rule.

### Source and identity facts

For every move record:

- move ID, name, category, style, tags, source path, and source hash;
- training days and structured requirements;
- catalog, rules, and conversion versions;
- source-clause count and clause-level provenance;
- canonical character-sheet order where the rule depends on it; and
- explicit custom, Afterlife, Freestyle, or style ownership tags where
  applicable.

### Static mechanical facts

Extract only from typed data and registered capabilities:

- base and conditional Ki costs, activation costs, floors, reductions, drains,
  gains, and alternate costs;
- attack type, dice count/sides, roll modifiers, thresholds, success model,
  critical rules, immunity, block/counter interaction, and rerolls;
- base damage expression, per-hit behavior, modifiers, caps/floors, delayed
  damage, direct HP loss, recoil, healing, and damage prevention;
- timing, action consumption, free/reaction status, forced/deferred/extra action
  behavior, and prerequisites;
- RESTRICTED/USE/cooldown limits and reset boundary;
- effect count and ordered trigger, condition, target, selection, operation,
  numeric basis, duration, scope, conflict policy, and lifecycle families;
- status, lock, suppression, negation, move-selection, move-removal,
  transformation, resource, roll, stat, schedule, and copied-effect families;
- engine capability/executor IDs, named capability IDs, and test references;
- explicit combat-scope exclusions; and
- static data warnings such as source ambiguity, missing comparable dimension,
  unbounded expression, unsupported draft mechanic, or incomplete observation
  support.

Do not collapse unlike units into one score. Ki, percent Power damage, flat HP,
dice sides, result modifiers, turn denial, action economy, and restricted uses
remain distinct dimensions.

### Opportunity funnel

Every observed move must report the denominators needed to interpret use:

1. `equipped fights` — the move was in the relevant combatant's loadout;
2. `eligible states` — the engine enumerated the move or its response;
3. `affordable states` — authoritative descriptor/cost facts made it usable;
4. `selected actions` — the policy selected it;
5. `submitted actions` — it reached the public transition boundary;
6. `resolved actions` — it completed rather than remaining pending or failing;
7. `successful actions/hits` — authoritative result classification succeeded;
8. `value-producing actions` — it caused a measured resource, status, control,
   action-economy, or terminal change.

Selection rate without eligibility and equipment denominators is not a balance
metric.

### Observed move metrics

Aggregate at minimum:

- eligibility, affordability, selection, submission, resolution, success,
  critical, stopped, blocked, countered, and lethal rates;
- attack-die and action-level success separately for multi-die attacks;
- damage attempted, damage dealt, overkill, self-damage, healing, prevention,
  and net HP swing distributions;
- Ki spent, gained, denied, wasted at cap, net Ki swing, value per Ki, and
  conditional value per use;
- status applications, failed/redundant applications, stack count, uptime,
  turns denied, options removed, and lockout duration;
- extra/skipped/forced/deferred actions and net action economy;
- restricted uses available, consumed, conserved at fight end, and exhausted;
- time and turn to first use, repeat interval, opening/finishing frequency, and
  use by resource/HP/turn bands;
- transformation state at eligibility/use and transformation value interactions;
- teammate fields reserved as absent in v1 rather than inferred for local 1v1;
- win/loss association, paired matchup delta, remaining-resource delta, and
  fight-length delta, all labeled observational rather than causal;
- policy sensitivity, side/initiative sensitivity, mirror delta, template
  sensitivity, progression-checkpoint sensitivity, and matchup dispersion;
- common prior and following moves, pair/triplet lift, setup conversion, combo
  completion rate, and repeated-loop participation;
- error, stall, unknown-fact, and diagnostic-replay counts; and
- sample size and interval for every rate or mean presented as evidence.

### Comparable cohorts

Comparable selection is a transparent multi-stage filter, not nearest name or a
single power score:

1. hard compatibility: category, action timing, attack/non-attack role, and
   executable scope;
2. acquisition context: style, training days, requirements, checkpoint, and
   restricted-use class;
3. resource envelope: base/conditional cost and scarcity;
4. mechanical role: damage, defense, control, resource, setup, finisher,
   transformation, or hybrid;
5. effect fingerprint: typed triggers, operations, targets, durations, and
   action-economy families;
6. observed usage context: eligible resource/turn/HP bands and policy profiles.

The report must show which filters selected or excluded each comparable and
must allow staff to override the cohort explicitly. Similarity weights and
algorithm version belong in report metadata.

### Move coverage states

Each move/scenario-family cell uses one of these states:

- `observed-sufficient`: met configured exposure and precision requirements;
- `observed-low-sample`: executed but did not meet evidence thresholds;
- `eligible-never-selected`: engine offered it but the tested policy did not;
- `never-eligible`: equipped but scenario preconditions never occurred;
- `incompatible-template`: cannot legally appear in that fixture;
- `audited-out-of-scope`: tied to a registered combat-scope exclusion;
- `invalid-fixture`: scenario or template failed validation;
- `runner-failure`: combat or AI failed before useful observation; or
- `not-scheduled`: required coverage has not yet been run.

Only the first state is evidence-complete. The others remain visible in closure
accounting and drive additional scenario design.

## Statistical design

### Experimental unit

One engine-resolved fight is the base observation. For mirrored analysis, the
pair sharing templates, policies, variant, and iteration key is the experimental
unit. Do not treat every action, hit, or die as an independent fight sample.

### Mirroring and controls

For balance conclusions, run paired mirrors that swap:

- fighter/template position;
- policy assignment;
- the controllable first-actor/initiative orientation; and
- variant-bearing side.

Use common semantic seed keys for paired baseline/variant experiments so
unrelated randomness is as aligned as the public dependency contracts safely
allow. Never reuse a mutable RNG instance between fights or between baseline and
variant branches.

Required controls include equivalent fighters, mechanically identical move
variants, a deliberately inferior move, a deliberately superior move, a
zero-cost high-damage move, and a repeatable control/lock loop.

### Presets and evidence levels

Initial defaults are configurable and must be validated by benchmarks:

| Preset          | Suggested paired mirrors  | Purpose                                    |
| --------------- | ------------------------- | ------------------------------------------ |
| smoke           | 10                        | Contract, replay, and gross failure checks |
| exploratory     | 250                       | Direction finding and scenario triage      |
| comparison      | 1,000                     | Routine baseline/variant decision support  |
| high-confidence | 5,000+                    | Close calls and high-variance interactions |
| catalog-closure | Exposure/precision driven | Satisfy every required move coverage cell  |

These are starting policies, not claims that a fixed sample is always enough.
Reports must state achieved precision. Adaptive continuation may add a
predeclared batch when an interval remains wider than the configured target;
it must not stop early merely because the current result is desirable.
The sequential rule, look schedule, maximum sample, alpha/error spending, and
completion semantics are versioned manifest identity. Cancelled work and an
incomplete mirror/variant pair remain incomplete evidence rather than being
silently converted into an unpaired completed observation.

### Intervals and effect sizes

- Use Wilson intervals for ordinary binomial rates such as wins, selection,
  success, critical, and stall rates.
- Use paired differences for mirrored and baseline/variant comparisons.
- Use a deterministic seeded bootstrap for skewed quantities such as fight
  length, damage, Ki efficiency, and status uptime when a simple parametric
  interval is not justified.
- Report absolute difference, relative difference where the baseline is
  meaningful, standardized or rank-based effect size where applicable, and the
  raw distributions/quantiles.
- Report interval method, confidence level, bootstrap seed/version, sample
  count, excluded/error count, and paired completeness.
- Treat a zero-containing interval as uncertainty, not proof of equality.

### Multiple comparisons

Catalog and matrix reports perform many comparisons. Preserve raw intervals and
effect sizes, label exploratory findings, and apply a versioned false-discovery
rate correction such as Benjamini-Hochberg only to a declared family of tests.
Do not mix unrelated metrics into one correction family or hide unadjusted
values. An anomaly is a triage signal, not a verdict.

### Bias controls

- Separate side, first-turn, initiative, template, policy, checkpoint, and
  matchup effects.
- Include multiple policy personalities and the deterministic
  simulation-quality profile.
- Where authored advisory hints exist, include bounded hints-enabled versus
  mechanically inferred hints-disabled sensitivity runs.
- Flag moves whose apparent value collapses under another reasonable policy.
- Distinguish never selected from never useful by adding forced-use or
  move-isolation scenarios for coverage, clearly labeled as non-natural policy
  experiments.
- Keep training and calibration scenarios separate from final evaluation
  scenarios if AI or thresholds are adjusted.
- Compare simulation with curated human-play evidence later; do not silently
  tune the model until it reproduces a preferred balance conclusion.

## Dependency-ordered implementation queue

### Phase 0 — Scope, decisions, progress, and completion contracts

#### SIM-000 — Freeze `simulation-scope:v1`

Record the exact combat capability/scope version, legal-decision surface,
catalog versions, AI simulation profile, race/transformation families, and
carried exclusions.

Exit evidence:

- a versioned scope record in `simulation-progress.md`;
- no combat exclusion reopened implicitly; and
- fixtures tied to public package versions rather than internal imports.

#### SIM-010 — Resolve pre-implementation decisions

Approve or explicitly mark provisional: no-progress fingerprint semantics,
turn/transition defaults, seed derivation, canonical JSON format, confidence
level, interval methods, minimum exposure policy, initial template sources,
variant patch surface, comparable algorithm, and custom review statuses.

#### SIM-020 — Define completion gates and artifact schemas

Version the fight result, run manifest, aggregate report, move-balance record,
replay record, anomaly record, and custom-move report. Provide migration policy:
old reports remain readable or are explicitly rejected with a typed schema
mismatch.

#### SIM-030 — Establish risk and decision registers

Track open source ambiguity, unsupported combat scope, observation gaps,
statistical limitations, performance limits, policy sensitivity, and human
review decisions separately. Never convert a limitation into a silent default.

#### SIM-040 — Create the simulation progress record

Use it as the authoritative handoff for completed IDs, verification evidence,
current artifact versions, generated counts, benchmark results, known limits,
and the exact next executable item.

#### SIM-050 — Certify combat-owned decision points

Use `getCombatDecisionPoint` as the sole contract for advance, decision owner,
complete legal set, and explicit completion. Prove ordinary action, pending
defense/response, automatically advanceable upkeep/end, and completed fights.
Simulation must not inspect phase, `pendingDecision`, resolution frames, or
`activeCombatantId` to reconstruct actor ownership.

#### SIM-060 — Certify effective AI capabilities

Require every simulation decision record to preserve requested profile,
pipeline/evaluator version, effective analysis capability set, AI seed
derivation version, and effective work limits. A simulation-quality request
must fail with the typed insufficient-capability error unless descriptors,
expected outcomes, pruning, setup inference, required lookahead depth,
opponent modelling, and pending expansion are declared and available.

#### SIM-070 — Certify combat semantic-progress identity

Use the public combat-owned semantic-progress identity for loop/no-progress
comparison and keep exact replay hashing unchanged. Prove bookkeeping-only
version/event/generated-ID changes compare equal while durations, cooldowns,
scheduled work, restrictions, stored selections, transformations, and pending
choices remain meaningful.

#### SIM-080 — Establish and certify the immutable mechanics-view boundary

Inventory every direct or indirect canonical registry read that can influence fight creation, legal decisions, transitions, invariants, move/item/transformation/status resolution, declarative trigger execution, decision descriptors, strategic context, combat analysis probes, and AI mechanical evaluation.

Classify each read as:

* authoritative fight mechanics that must use the fight's mechanics view;
* immutable metadata that may safely remain canonical and explain why;
* build/startup compilation that must produce view-local compiled data; or
* unrelated application/catalog access outside the combat/AI execution boundary.

Introduce the smallest coherent immutable mechanics/catalog-view abstraction necessary to represent the complete rule-definition environment used by one fight. Do not create unrelated package-specific substitute registries where a shared mechanics-view identity or input is sufficient.

The canonical game catalog must remain available through a canonical/default mechanics view so ordinary production combat behavior does not require simulation-specific setup.

Thread the mechanics view through every authoritative combat path identified by the audit. Combat must remain the owner of mechanical interpretation. Callers may select which mechanics view a fight uses, but they must not resolve definitions or substitute combat rules themselves.

Ensure AI decision descriptors, strategic-context extraction, expected-outcome analysis, probes, setup/combo inference, and lookahead use the same effective mechanics view as the combat state they are evaluating. AI must not silently fall back to canonical definitions when evaluating a fight created from another view.

Compiled definitions, indexes, lookup tables, caches, and other derived structures that depend on catalog contents must either:

* be immutable members of the mechanics view;
* be keyed by stable mechanics-view identity/content hash; or
* be proven independent of catalog contents.

Do not implement correctness by mutating, replacing, temporarily swapping, monkey-patching, or restoring module-level canonical registries.

Give each mechanics view a stable deterministic identity sufficient for later replay and variant manifests. Identical canonical mechanics must produce the same identity; mechanically different views must not accidentally share derived catalog-dependent state.

Preserve baseline behavior. Creating and running a fight through the canonical mechanics view must remain behaviorally identical to the pre-refactor canonical path for the same inputs, dependencies, and seeds.

Add isolation certification proving:

* canonical A -> alternate B -> canonical A produces identical A behavior and hashes;
* canonical and alternate fights may execute interleaved without contamination;
* canonical and alternate fights may execute in parallel without contamination;
* two distinct alternate views may coexist without contamination;
* AI analysis of each fight observes that fight's mechanics view;
* combat probes and lookahead preserve the originating mechanics view;
* cached or compiled catalog-dependent state cannot cross view boundaries;
* execution order does not change outcomes;
* diagnostics and replay inspection do not change mechanics-view selection; and
* no test requires cleanup or restoration of mutable global game-data state.

Add architecture or boundary validation that prevents newly introduced authoritative combat/AI code from bypassing the mechanics-view boundary with direct canonical registry imports where practical.

The task is complete only when the repository can construct and execute baseline and alternate immutable mechanics environments concurrently through the same combat and AI architecture without mutating canonical game data.

Do not implement simulation variant patch authoring, custom-move draft handling, comparison workflows, or the custom laboratory in this task. SIM-080 establishes only the architectural seam and isolation guarantees those later phases require.


#### SIM-090 — Freeze deterministic seed namespaces

Version semantic-key derivation for combat, AI A, AI B, diagnostic reruns,
mirrors, pairs, and variants. Prove allocation is independent of scenario
display order, batching, worker count, retries, cancellation, and completion
order.

Phase 0 exits only when SIM-050 through SIM-090 are verified. Package and
runner contracts may not freeze around provisional consumer-owned substitutes.

### Phase 1 — Package, public contracts, and boundary enforcement

#### SIM-100 — Create `@dragonball-resurgence/simulation`

Add the workspace package, TypeScript project reference, public root export,
package scripts, and allowed dependencies on `shared`, `game-config`,
`game-data`, `combat-engine`, and `ai-engine`. Do not add runtime dependencies
without a demonstrated need.

#### SIM-110 — Define core result and failure unions

Add versioned types for templates, scenarios, seeds, limits, retention, fights,
series, matrices, reports, and replay. Expected failures must be discriminated
unions rather than thrown strings.

#### SIM-120 — Add Zod validation at untrusted boundaries

Validate CLI/config/report/custom-draft input, finite numeric values, positive
budgets, stable IDs, unique references, valid probability/confidence ranges,
known schema versions, and bounded arrays. Internal public package calls may
accept already typed objects but must still reject invalid runtime data where
it can cross a process or file boundary.

Future variant/custom inputs must additionally cap effect count, nested
expression depth, AST/definition size, candidate and scenario expansion,
diagnostic retention, and report output. Validation produces immutable values;
it never mutates a canonical registry.

#### SIM-130 — Add a boundary validator

Create `validate:simulation-boundaries` to reject application dependencies,
deep package imports, combat-rule copies, direct random/wall-clock use in domain
execution, and forbidden imports from `npc-ai` in the core package.

#### SIM-140 — Define canonical serialization and hashing

Reuse a public stable canonicalization contract where appropriate or own a
simulation-specific implementation. Prove object-key and input-order
normalization without normalizing semantically ordered arrays.

### Phase 2 — Templates, checkpoints, and scenario catalog

#### SIM-200 — Implement pure template validation/materialization

Validate all references through public game-data catalogs and produce exact
combat-engine creation inputs. Reject incompatible race/trait/class/
transformation/loadout combinations and unsupported source expressions rather
than guessing.

#### SIM-210 — Convert the 36 TF1 mastery sheets

Create typed, source-linked templates for every existing balance sheet. Preserve
their race, class, style, mastery, HP, Power, Dexterity, Dexterity Bonus, SP
distribution, and TF1 checkpoint provenance. Record any missing loadout,
transformation, item, or Ki decision as an explicit template gap.

#### SIM-220 — Add representative synthetic archetypes

Include balanced, high-Power, high-Dexterity, defensive, burst, status-control,
Ki-denial, resource-efficient, glass-cannon, sustained-damage, transformation,
and restricted-use archetypes. Synthetic templates must be clearly labeled and
must not masquerade as canonical characters.

#### SIM-230 — Define progression checkpoints

Author configurable starter, early, mid, late, TF1, and endgame examples only
as initial scenario metadata. The contract accepts user-defined checkpoint IDs;
the engine does not hardcode this list.

#### SIM-240 — Add template and scenario closure validation

Generate a matrix showing every source sheet and required archetype exactly
once, materialization status, reference validity, profile assignment, scenario
coverage, and reason for any exclusion.

#### SIM-250 — Define scenario families

At minimum: symmetric controls, archetype cross-matchups, mastery/style matrix,
Power-versus-Dexterity, burst-versus-defense, control-versus-resource,
transformation timing, restricted-use scarcity, move isolation, combo partner,
and custom-move replacement/addition.

### Phase 3 — Deterministic single-fight runner

#### SIM-300 — Build the public transition driver

Create a fresh fight and consume `getCombatDecisionPoint`. On `advance`, call
`advanceFight`; on `decision-required`, pass the supplied actor and exact legal
set to `selectAiDecision`, submit the exact chosen decision through the public
transition; on `completed`, preserve the engine completion. Never infer actor
ownership from phase, pending state, resolution frames, or active-combatant
fields.

#### SIM-310 — Separate dependency streams

Construct fresh combat IDs, fixed clock, combat RNG, and independent keyed AI
RNGs per fighter and per fight. Prove no dependency object or mutable counter is
reused across fights.

#### SIM-320 — Implement external safeguards

Add maximum turn, maximum transition, cancellation, and semantic no-progress
limits through the combat-owned semantic-progress identity. Exhaustion returns
a distinct simulation halt and diagnostic facts without mutating combat or
manufacturing defeat, surrender, cancellation, or another engine completion.

#### SIM-330 — Add summary observation

Fold structured transitions/events into bounded counters. The summary observer
must distinguish actor actions, pending responses, per-die results, completed
actions, effects, resources, statuses, transformations, and terminal facts.

#### SIM-340 — Add diagnostic observation

Retain optional events, selected legal decisions, AI evaluations, calculation
traces, fingerprints, and state hashes. Prove the diagnostic path cannot alter
selection or transition behavior.

#### SIM-350 — Prove failure containment

A malformed fixture, typed AI/combat failure, exhausted budget, or replay
mismatch ends only its fight/pair according to configured policy. The series
reports it and continues or fails fast explicitly; it never silently drops the
observation.

### Phase 4 — Replay and determinism closure

#### SIM-400 — Implement the versioned seed allocator

Allocate by semantic identity, not array position or worker order. Golden tests
lock the derivation version and verify new unrelated scenarios do not perturb
existing seeds.

#### SIM-410 — Create fight and decision replay records

Store enough manifest, seed, template, scenario, policy, variant, legal-set,
decision, and transition identity to rerun a fight without retaining every
state in ordinary summary mode. Include requested AI profile, pipeline/
evaluator version, effective capabilities, effective work limits, combat and AI
seed derivation versions, catalog/variant hashes, metric dictionary,
statistical design, stopping policy, and retention mode.

#### SIM-420 — Implement replay verification

Compare action sequence, legal-set hashes, selected decision hashes, event/state
hashes, terminal state, and summary. Return a typed first divergence with owner
classification: input, combat, AI, variant, schema, or runner.

#### SIM-430 — Prove retention invariance

Run the same seeds under summary, sampled, diagnostic, and anomaly modes and
assert identical authoritative hashes and random consumption.

#### SIM-440 — Prove concurrency invariance

Run the same manifest sequentially and with bounded local concurrency; sort by
stable fight identity and require identical per-fight results, canonical
aggregate serialization, and logical report hashes for every tested worker
count and partition/merge order.

### Phase 5 — Series and Monte Carlo batch execution

#### SIM-500 — Implement deterministic series expansion

Expand iterations and paired mirrors into stable fight specifications. Validate
even/complete pairing requirements when a report claims paired evidence. Bind
the series to a fixed-count, versioned sequential, or incomplete/cancellation
stopping policy before expansion.

#### SIM-510 — Add bounded streaming execution

Support batch size, bounded concurrency, progress callbacks, cancellation, and
incremental aggregation. Avoid retaining full fight results when only summaries
are requested. Cancellation produces an explicit partial series; incomplete
paired observations never become completed paired evidence.

#### SIM-520 — Define mirrored execution

Swap position, policy, variant-bearing side, and controllable initiative facts.
Record incomplete pairs separately; do not combine them with complete paired
estimates.

#### SIM-530 — Add deterministic anomaly reruns

Finish the summary pass, select flagged seeds using stable ordering and bounded
retention policy, then replay only those seeds diagnostically. The second pass
must verify the first-pass summary before attaching diagnostics.

#### SIM-540 — Add resumable batch manifests

Allow a large local run to resume from completed fight identities without
changing seed allocation or aggregates. Checkpoint files are infrastructure
artifacts and never become combat authority.

#### SIM-550 — Establish batch benchmarks

Measure fights/second, transitions/second, peak memory, report size, and
diagnostic amplification for representative fast, long, control-heavy, and
transformation scenarios. Set budgets from evidence rather than intuition.

### Phase 6 — Statistical aggregation and comparison

#### SIM-600 — Implement mergeable accumulators

Use numerically stable counts, means, variance, quantile sketches or bounded
histograms, and paired-difference accumulators. Integer counts remain integers,
observations retain stable identities, and partitions merge in canonical order
or through a fixed deterministic merge tree. Canonical serialization defines
finite-number normalization and rounding so worker count and merge order yield
the same serialized logical aggregate/hash; arbitrary in-memory floating state
need not be byte-identical before canonical reduction.

#### SIM-610 — Add rate and distribution summaries

Produce outcome, fight length, remaining resource, error/stall, status,
transformation, action-economy, and move funnel metrics with denominators and
missingness.

#### SIM-620 — Add confidence intervals and effect sizes

Implement and test Wilson intervals, paired rate/resource differences, seeded
bootstrap intervals, quantiles, and declared effect sizes. Test against known
small examples and invariants, not only snapshots.

#### SIM-630 — Add baseline-versus-variant comparisons

Join only compatible manifests and paired identities. Refuse comparisons when
rules, templates, policies, seed derivation, or scenario dimensions differ
outside declared comparison fields.

#### SIM-640 — Add precision-driven continuation

Given predeclared targets, report which metrics need more samples and derive the
next deterministic iteration range. Never overwrite the original result or
hide that the run was extended. Version the look schedule, maximum sample, and
error-spending rule. Fixed-count experiments never stop early for significance,
and undeclared stopping is invalid.

#### SIM-650 — Add multiple-comparison families

Declare and version comparison groups, attach raw and adjusted triage values,
and keep effect sizes/intervals primary. The adjustment must not turn an anomaly
flag into an approval verdict.

### Phase 7 — Scenario matrices and experiment design

#### SIM-700 — Build deterministic matrix expansion

Expand templates, checkpoints, policies, sides, variants, and scenario tags
without an uncontrolled Cartesian explosion. Estimate run count before
execution and reject budgets that exceed configured limits unless explicitly
overridden.

#### SIM-710 — Add symmetric and side-bias controls

Equivalent fighters should approach even paired results within configured
uncertainty. Report raw side win rate, initiative advantage, and mirrored
residual separately.

#### SIM-720 — Add mastery/style and archetype coverage

Schedule the 36 mastery fixtures across compatible archetype opponents and
cross-style controls. Balance the design so one mastery is not evaluated only
against a favorable or unfavorable opponent family.

#### SIM-730 — Add move-isolation coverage

For each move, construct validated compatible loadouts with and without the
move, plus a nearest-comparable replacement when available. Use forced-use
policies only to establish mechanic exposure, never as natural win-rate
evidence.

Every observation and report separates `naturally-eligible`,
`naturally-selected`, `eligible-not-selected`, `never-naturally-eligible`,
`isolation-exposed`, and `forced-exposed`. Forced/isolation outcomes cannot be
pooled into normal-policy selection, win-rate, or utility metrics.

#### SIM-740 — Add pairwise interaction coverage

Use deterministic covering arrays or an equivalent pairwise design across
move, mastery, race/class, transformation, item, archetype, and policy
dimensions. Promote suspicious pairs to targeted higher-order experiments.

#### SIM-750 — Add matchup stratification

Report global summaries only alongside per-checkpoint, per-archetype,
per-policy, per-side, and relevant mechanic-family strata. Detect Simpson's
paradox candidates where aggregate and major strata point in opposite
directions.

### Phase 8 — Complete move balancing dataset

#### SIM-800 — Generate static move feature records

Walk every `MOVE_DEFINITIONS` entry through public typed contracts and the
combat capability matrix. Emit all source, identity, cost, attack, effect,
lifecycle, selection, restriction, and capability fields defined above.

#### SIM-810 — Define the metric dictionary

For every metric, record stable ID, schema version, unit, numerator,
denominator, aggregation level, interval method, applicable categories,
missingness behavior, and interpretation warning.

#### SIM-820 — Instrument the complete opportunity funnel

Track equipped, eligible, affordable, selected, submitted, resolved,
successful, and value-producing counts without reconstructing legality. Add the
smallest public combat diagnostic only if an authoritative denominator is not
currently observable. Record natural eligibility/selection separately from
isolation and forced exposure in schemas, coverage accounting, reports, and
anomaly inputs.

#### SIM-830 — Aggregate dynamic move metrics

Produce per-move, per-template, per-matchup, per-policy, per-checkpoint,
per-variant, and global views. Retain sufficient paired keys to compare
with/without and baseline/variant experiments.

#### SIM-840 — Generate comparable cohorts

Implement the transparent staged algorithm, staff overrides, reason codes,
similarity components, and versioned outputs. Synthetic tests must choose
obvious comparables and reject incompatible timing/category candidates.

#### SIM-850 — Generate the move-balance matrix

Create one row per move and required scenario family with static completeness,
observation status, exposure counts, interval widths, anomalies, representative
seeds, and follow-up target. The generated artifact is an accounting surface,
not a ranking table.

#### SIM-860 — Add catalog closure validation

Create `validate:simulation-move-closure`. It fails on missing/duplicate move
rows, stale catalog hashes, unknown metric IDs, missing required scenario cells,
unsupported unexplained facts, invalid comparables, or unclassified coverage.
Low-sample rows may remain visible during development but must prevent the final
move-data closure claim.

#### SIM-870 — Add per-move staff dossiers

Project the canonical JSON into concise Markdown/CSV views containing source
facts, comparable cohort, scenario coverage, distributions, funnel, efficiency,
interactions, policy sensitivity, anomalies, uncertainty, and replay links.

### Phase 9 — Sequence, interaction, and anomaly analysis

#### SIM-900 — Normalize action and state-transition tokens

Derive tokens from authoritative decisions/events: move use, result, status,
resource band, transformation, lock, pending choice, skipped/extra action, and
terminal outcome. Preserve turn distance and actor; ignore only fields proven
irrelevant to the sequence question.

#### SIM-910 — Add pair/triplet and setup conversion analysis

Measure support, conditional rate, lift over baseline, setup-to-follow-up
conversion, interruption, and outcome association. Do not call a frequent pair
a combo without a typed setup edge or observed dependency evidence.

#### SIM-920 — Add loop and lockout detection

Detect repeated semantic fingerprints, repeating action/effect cycles, near-
permanent action denial, unbounded resource cycles, and no-progress patterns.
Attach representative seeds and the shortest known diagnostic trace.

#### SIM-930 — Add anomaly rules

Version thresholds for extreme matchup delta, selection after eligibility,
value per Ki, damage/healing tails, control uptime, transformation swing,
restricted-use efficiency, dominant opening/finishing lines, dominated
alternatives, excessive length, stalls, errors, and crowd-out.

Required categories include illegal transition attempts, AI selections outside
the supplied legal set, replay mismatch, invariant-invalid state, semantic
loop/stalemate, maximum-turn/work exhaustion, suspicious control lock, extreme
damage/resource outlier, suspicious non-use of eligible mechanics, one-sided
dominance, and variant contamination. A flag is investigation evidence, never
an automatic balance verdict.

#### SIM-940 — Add anomaly triage records

Each flag states metric, threshold, population, sample, interval, adjustment
family, effect size, contributing scenarios/actions, representative seeds,
possible confounders, manifest/hash identity, shortest reproducible trace, and
recommended next experiment. Never emit only a red/yellow/green label.

#### SIM-950 — Add metamorphic invariants

Examples: equivalent fighter renaming does not change outcomes; mirror swaps
invert side labels; diagnostic retention does not change summaries; identical
variants have zero paired delta; adding an unreachable move does not change a
fight; and catalog iteration order does not change decisions or seeds.

### Phase 10 — Immutable variants

#### SIM-1000 — Implement immutable variant construction

Build on the SIM-080 certified owning-package catalog/mechanics-view boundary.
Construct validated baseline and variant views used consistently by fight
creation, descriptors, AI mechanics, probes, and reporting. Do not reopen
dependency injection as a late runner redesign.

#### SIM-1010 — Add typed patch operations

Support add, replace, and narrow field override with conflict detection,
reference resolution, source provenance, schema validation, and canonical hash.
Do not support arbitrary JSON merge or executable callbacks.

#### SIM-1020 — Prove parallel isolation

Run baseline and multiple variants concurrently and verify canonical exports,
other runs, and later tests remain unchanged. Freeze or defensively copy all
variant inputs.

#### SIM-1030 — Add variant compatibility validation

Reject rules/catalog/profile mismatch, unsupported new mechanic discriminants,
changed IDs in replacement patches, invalid source references, and variants
that require excluded combat scope.

#### SIM-1040 — Add variant diff reports

Show exact changed fields and derived static feature differences before dynamic
results. A report must never make staff infer what the experiment changed from
win-rate movement alone.

### Phase 11 — Custom-move checking suite

#### SIM-1100 — Define the custom draft contract

Reuse the canonical `MoveDefinition` vocabulary through a simulation-owned
review envelope carrying draft ID, author rationale, intended category/style/
checkpoint, proposed source text for display, staff notes, and version. Custom
IDs are simulation-local and cannot collide with canonical IDs.

#### SIM-1110 — Add structural and semantic preflight

Validate ID/name/category/tags, finite values, costs, restrictions, attack
shape, effect ordering, trigger/condition/target/selection/lifecycle semantics,
references, requirements, source trace, and executor capability. Separate:

- malformed draft;
- source ambiguity requiring a ruling;
- clear mechanic with a declarative capability gap;
- engine-supported mechanic outside active combat scope; and
- executable in-scope draft.

Only the last category proceeds to simulation.

#### SIM-1120 — Add static safety and abuse checks

Flag, with exact fields and comparables:

- zero/negative cost paired with substantial guaranteed value;
- missing cost/restriction/duration for repeatable high-impact effects;
- invalid or unreachable selection;
- unconditional hard locks, indefinite stun/control, and self-renewing loops;
- uncapped positive feedback, recursive resource generation, and cost floors
  below universal rules;
- action-economy creation without a bounded consumption/expiry model;
- guaranteed attack/result immunity without an explicit counterpath;
- damage, healing, or roll values far outside compatible cohorts;
- exact or near-exact canonical duplication; and
- combinations of individually ordinary clauses whose ordered interaction is
  exceptional.

These are review flags, not automatic rejection rules.

#### SIM-1130 — Select and explain comparables

Return nearest canonical candidates, cohort statistics, rejected candidates,
and explicit dimensions. Staff may pin required comparables. The checker must
not compare a control Skill to a damage Signature merely because their text is
similar.

#### SIM-1140 — Build the experiment set

For each executable draft, schedule:

1. baseline loadout without the draft;
2. baseline plus draft when slot rules allow;
3. replacement of each pinned/nearest comparable;
4. mechanically identical renamed control;
5. realistic low-, median-, and high-synergy loadouts;
6. multiple compatible race/class/mastery/transformation contexts;
7. multiple policy profiles;
8. mirrored sides and first-turn controls;
9. move-isolation/forced-exposure mechanic checks; and
10. targeted interaction escalation for anomalies.

Use bounded representative policy sensitivity: simulation-quality balanced,
selected alternative personalities/strategies, and advisory-hints enabled/
disabled where authored hints exist. Every matrix need not run every policy,
but reports flag findings that materially depend on the selected policy.

#### SIM-1150 — Add crowd-out and dominance analysis

Measure whether the draft suppresses selection of comparable choices, is
strictly or conditionally dominated, dominates within key resource bands,
changes loadout win rate, or creates one mandatory best line. Include
eligibility denominators and policy sensitivity.

#### SIM-1160 — Add interaction sweep

Screen pairwise combinations with every relevant typed mechanic family, then
deep-run the highest-risk mastery, race/class, transformation, item, and move
partners. Record what was tested, pruned, incompatible, excluded, or still
unknown; never claim literal all-build coverage.

#### SIM-1170 — Produce the staff review dossier

The report includes draft and variant hashes, validation, static diff,
comparables, experiment design, coverage, paired results, intervals/effect
sizes, funnel, resource/action metrics, sequence/loop flags, representative
replays, policy sensitivity, exclusions, unknowns, and suggested follow-up
experiments.

Allowed conclusion states:

- `cannot-evaluate`;
- `insufficient-evidence`;
- `no-flag-detected`;
- `potential-balance-concern`;
- `potential-rules-concern`; and
- `staff-review-required`.

No state means approved or rejected.

#### SIM-1180 — Add custom-suite regression controls

The suite must:

- show no meaningful paired shift for an identical renamed move;
- flag the synthetic zero-cost high-damage move;
- flag a self-sustaining control loop;
- identify a strictly superior replacement;
- retain uncertainty for an underexposed conditional move;
- refuse an unsupported effect discriminant; and
- preserve the canonical catalog after success and failure.

### Phase 12 — Reports, CLI, and developer workflow

#### SIM-1200 — Add a pure report model

Keep generation separate from rendering. The canonical report contains no ANSI
codes, terminal widths, absolute local paths, or current-time-dependent ordering.

#### SIM-1210 — Add deterministic JSON, CSV, and Markdown renderers

JSON is lossless and versioned. CSV has explicit table schemas and stable
column/order rules. Markdown is staff-readable and links replay/definition
identities without becoming the data source.

#### SIM-1220 — Replace the placeholder CLI

Route `scripts/simulate-fights.ts` through the public simulation package. Add
validated commands or options for one fight, series, matrix, replay, move
report, closure, custom review, and benchmark. CLI code parses inputs and writes
artifacts; it does not own simulation logic.

#### SIM-1230 — Add repository scripts

Planned scripts:

- `simulate`;
- `simulate:smoke`;
- `report:simulation-move-balance`;
- `validate:simulation-move-closure`;
- `validate:simulation-boundaries`;
- `review:custom-move`; and
- `benchmark:simulation`.

Only stable, reasonably fast validators belong in `npm run check`. Large Monte
Carlo runs remain explicit evidence jobs and should consume committed or
reproducible manifests.

#### SIM-1240 — Add actionable progress output

Expose started/completed/failed pair counts, throughput, estimated remaining
work, cancellation status, retained anomaly count, and current aggregate memory
without making wall-clock timing part of deterministic report identity.

#### SIM-1250 — Add artifact freshness checks

Generated balance matrices and checked-in baseline reports must record their
input hashes. Validation fails on stale artifacts rather than regenerating them
silently during `check`.

### Phase 13 — Performance, resilience, and local parallelism

#### SIM-1300 — Profile before parallelizing

Measure combat, AI, observation, aggregation, serialization, and report costs
separately. Retain cheap descriptor/candidate-count microbenchmarks, but add
representative tiers for resource-heavy choices, transformations, control/
status states, combo/setup-heavy states, high candidate-count pruning,
probe-backed lookahead, opponent responses, pending-decision expansion, and
full autonomous fights. Track candidates evaluated/retained, outcome branches,
probe count, nodes, depth, pending expansions, decisions per fight, and
transitions per fight in addition to informational wall-clock values. Address
avoidable retention and cloning first.

#### SIM-1310 — Add bounded local concurrency

Use a worker abstraction only after sequential correctness and benchmark need
are proven. Workers receive immutable fight specs and return bounded summaries;
they do not share registries or RNGs.

#### SIM-1320 — Add memory and output budgets

Reject configurations whose estimated diagnostic retention exceeds limits.
Cap representative seeds per anomaly, sequence samples, report row counts, and
in-memory result buffering while preserving aggregate correctness.

#### SIM-1330 — Add cancellation and crash recovery

Cancellation occurs between safe fight/batch boundaries, writes a partial
manifest with explicit incompleteness, and never presents partial paired data as
complete. Resumption validates all hashes before continuing.

#### SIM-1340 — Add performance regression gates

Track fixed-manifest throughput and peak memory with generous environment-aware
thresholds. Functional correctness and deterministic hashes remain hard gates;
performance drift produces an actionable benchmark finding.

### Phase 14 — Calibration and human evidence

#### SIM-1400 — Define an external human-observation contract

Accept anonymized, consented, versioned fight summaries or curated staff records
without making persistence a simulation dependency. Record missing actions,
rules version, player skill uncertainty, and selection bias.

#### SIM-1410 — Compare policy and human distributions

Compare move eligibility/selection, fight length, resource use, transformation
timing, and common sequences. Treat differences as model-calibration evidence,
not proof that the game or humans are wrong.

#### SIM-1420 — Calibrate only on separated data

If AI profiles, scenario weights, or anomaly thresholds change, use declared
calibration data and rerun untouched evaluation manifests. Version every change
and preserve prior reports.

#### SIM-1430 — Add robustness analysis

Show which balance findings persist across reasonable policy mixtures, template
weights, checkpoint distributions, and sample ranges. Findings that depend on
one arbitrary mixture remain explicitly fragile.

### Phase 15 — Closure, governance, and release evidence

#### SIM-1500 — Close all required move coverage

Every current move must reach `observed-sufficient` for its required natural
and isolation scenario families or carry a reviewed explicit exclusion. Resolve
`eligible-never-selected` and `never-eligible` rows with scenario or policy
evidence rather than relabeling them complete.

#### SIM-1510 — Close deterministic and statistical regressions

Run replay, concurrency, retention, metamorphic, synthetic anomaly, identical
variant, aggregation, interval, and custom-suite controls against frozen
manifests.

#### SIM-1520 — Close architecture and capability accounting

Verify public imports, dependency direction, immutable variants, no copied
combat rules, no runtime prose parsing, complete metric dictionary, complete
scenario catalog, and zero unexplained move rows.

#### SIM-1530 — Establish balance-data change governance

Document how canonical balance changes update source/reference material,
game-data, rules version, capability matrices, simulation baselines, and custom
comparables. Simulation evidence proposes a change; it does not edit canonical
balance automatically.

#### SIM-1540 — Declare Simulation Complete

Record final package/report schema versions, benchmark envelope, catalog counts,
coverage counts, required commands, known exclusions, reproducibility examples,
and the exact process for adding a new move or scenario.

## Verification strategy

### Unit and contract tests

- schemas, IDs, canonicalization, seed derivation, immutable patching;
- template/scenario validation and deterministic expansion;
- combat decision-point and semantic-progress boundaries;
- event/decision observation and opportunity denominators;
- mergeable accumulators, intervals, effect sizes, bootstrap replay;
- comparable filtering and reason codes;
- sequence normalization, loop detection, and anomaly thresholds; and
- renderers and schema compatibility.

### Public-boundary integration tests

Drive representative fights only through `createFight`,
`getCombatDecisionPoint`, `advanceFight`, `selectAiDecision`, and
`submitCombatDecision`.
Cover ordinary attacks, blocks/counters, pending choices, statuses,
transformations, items, restricted uses, deferred work, completion, and each
external safeguard.

### Deterministic batch tests

- exact iteration and mirror counts;
- stable seeds when scenario order changes;
- sequential/concurrent and worker-count equivalence;
- summary/diagnostic equivalence;
- batch-order and partition/merge-order equivalence;
- retention-mode invariance of the canonical logical report;
- cancelled and resumed run accounting;
- baseline/variant pairing and compatibility rejection; and
- byte-stable canonical report generation.

Additional regression proofs cover exact legal-membership selection, empty
legal-set failure, pending decisions, semantic loop detection, legitimate
delayed-state non-loop behavior, A -> B -> A and parallel variant isolation,
partial/cancelled series, serialization round trips, natural/forced exposure
separation, catalog closure, and synthetic broken-damage/control-loop cases.

### Statistical tests

Use fixed synthetic samples with analytically checkable answers for intervals,
paired differences, missingness, adjustment families, and quantiles. Use fixed
seed combat experiments for monotonic/extreme signals. Avoid brittle assertions
that a realistic move must achieve an exact win rate.

### Catalog tests

- exactly 499 current move records at the present baseline;
- category/source counts match public game data;
- every move has a static fingerprint and required coverage cells;
- every metric ID is registered and unit-compatible;
- every comparable references a known compatible move;
- capability and source hashes are fresh; and
- new catalog entries fail closure until accounted for.

### Custom laboratory tests

Cover valid drafts, malformed values, stale references, ambiguous semantics,
unsupported discriminants, duplicate canonical moves, immutable isolation,
identical controls, clearly overpowered controls, loops, dominance, low
exposure, and deterministic dossier rendering.

### Required development gates

After each meaningful implementation batch:

1. format only changed files with the repository formatter;
2. run the smallest relevant package typecheck and focused Vitest modules;
3. run affected generation/validation commands early;
4. run `npm run test:coverage` for simulation behavior, game rules, schemas,
   variants, API behavior, or persistence-adjacent behavior covered by the
   repository trigger; and
5. run exactly one final repository gate: `npm run check` for an ordinary
   isolated slice or `npm run quality` for cross-package/architecture,
   dependency, CI, release, or substantial multi-package work.

Large statistical evidence runs are additional acceptance evidence. They do
not replace deterministic tests or the repository gate.

## Recommended delivery milestones

```text
Milestone A — Simulation Kernel
  SIM-000 through SIM-440
  One deterministic fight, replay, retention and concurrency invariants

Milestone B — Monte Carlo Runner
  SIM-500 through SIM-750
  Paired series, bounded batches, statistics and scenario matrices

Milestone C — Full Move Balance Data
  SIM-800 through SIM-950
  All-move static/dynamic records, coverage closure, interactions and anomalies

Milestone D — Variant and Custom Laboratory
  SIM-1000 through SIM-1180
  Immutable experiments and staff-facing custom-move dossiers

Milestone E — Production-Quality Tooling
  SIM-1200 through SIM-1430
  CLI/reports, performance, recovery and optional human calibration

Simulation Complete
  SIM-1500 through SIM-1540
  Catalog closure, architecture closure and governance
```

The critical path is:

```text
scope/version and prerequisite contract certification
  -> decision point + AI capability + semantic progress
  -> immutable catalog-read readiness + seed namespace
  -> package and validation
  -> typed templates/scenarios
  -> deterministic single-fight runner
  -> replay invariants
  -> paired batch runner
  -> statistical aggregation
  -> scenario and move coverage
  -> variant construction on the certified immutable boundary
  -> custom-move laboratory
  -> closure
```

Sequence/anomaly analysis can begin after stable observations exist. CLI
rendering can begin after report schemas stabilize. Worker concurrency must not
precede sequential determinism. Custom-move dynamic checking must not precede
variant isolation and complete baseline move accounting.

## Risks and mitigations

| Risk                              | Consequence                                                           | Required mitigation                                                                       |
| --------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| AI-policy bias                    | A move looks strong or weak only because one policy handles it poorly | Multiple profiles, policy stratification, forced-exposure checks, later human calibration |
| First-turn or side bias           | Symmetric content appears asymmetric                                  | Paired mirrors and explicit initiative/side metrics                                       |
| Rare conditional moves            | False safety from no observations                                     | Opportunity funnel, isolation scenarios, precision-driven continuation                    |
| Combinatorial explosion           | Infeasible all-build matrix                                           | Representative fixtures, pairwise coverage, risk-ranked targeted escalation               |
| Hidden global catalog reads       | Baseline/variant contamination                                        | Explicit immutable views, isolation tests, owning-boundary contract changes               |
| Randomness coupled to concurrency | Irreproducible batches                                                | Semantic seed derivation and fresh per-fight dependencies                                 |
| Diagnostic memory growth          | Large runs exhaust memory                                             | Summary-first aggregation and bounded anomaly replay                                      |
| Statistical overclaim             | Noise becomes a balance verdict                                       | Intervals, effect sizes, paired design, multiple-comparison labels, staff review          |
| Metric ambiguity                  | Different reports use the same name differently                       | Versioned metric dictionary with numerator/denominator/unit                               |
| Combat-rule duplication           | Simulator diverges from live combat                                   | Public transition-only execution and boundary validation                                  |
| Stale baseline reports            | Custom comparisons use old rules                                      | Input hashes and artifact freshness validation                                            |
| Source ambiguity                  | Draft or canonical effect is simulated incorrectly                    | Separate ambiguity/capability/scope statuses; never guess                                 |

## Decisions required before Phase 1 implementation

1. Approve the initial semantic no-progress fingerprint and default limits.
2. Approve seed-derivation version 1 and whether canonical hashes use the
   existing AI canonicalization implementation or a new shared public primitive.
3. Choose canonical artifact locations and JSON/CSV/Markdown schema names.
4. Confirm which missing fields in the 36 TF1 sheets are supplied by defaults,
   authored overlays, or explicit blockers.
5. Approve the first scenario weights, compatible loadout rules, and progression
   checkpoint definitions.
6. Approve confidence level, target interval widths, bootstrap count, and
   exploratory multiple-comparison policy.
7. Approve the variant patch surface and the public catalog-input changes, if
   any, required to avoid hidden global registry reads.
8. Approve comparable dimensions and staff override format.
9. Decide which move coverage cells are required for Simulation Complete versus
   informational only.
10. Approve custom review conclusion vocabulary and confirm staff remains the
    sole approval authority.

These decisions should be versioned. Reasonable provisional defaults may be
used for early kernel work, but no catalog-wide or custom-move balance claim may
use an unresolved decision silently.

## Architecture status

**Healthy with required simulation preflight.** Combat decision ownership,
semantic progress identity, and simulation-quality capability enforcement are
now explicit. The remaining work belongs in a downstream `simulation` package:
templates, scenarios, seed allocation, batch control, statistics, catalog-wide
move accounting, immutable variants, custom-move analysis, reports, replay, and
operational safeguards. The principal unresolved architectural prerequisite is
variant support: the verified canonical module-level registry reads must be
replaced or routed through public immutable owning-package inputs in SIM-080,
before the runner architecture freezes, rather than bypassed or duplicated in
simulation.
