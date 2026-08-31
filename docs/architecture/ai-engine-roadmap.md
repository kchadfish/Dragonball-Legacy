# AI-engine completion roadmap

## Purpose

This document is the dependency-ordered implementation queue for delivering
`@dragonball-resurgence/ai-engine`. It translates the AI contracts and
boundaries in [ARCHITECTURE.md](../../ARCHITECTURE.md) and
[combat-ai-simulation.md](combat-ai-simulation.md) into bounded capability
slices.

The AI engine is not a second combat engine. `combat-engine` remains the sole
authority for legal decisions, combat rules, state transitions, rolls, damage,
resources, statuses, transformations, counters, blocks, restricted uses, and
fight completion. `ai-engine` evaluates only decisions supplied through a
combat-engine-owned public contract and returns one complete legal decision
plus optional diagnostics.

Once implementation begins, create and maintain
`ai-engine-progress.md` as the authoritative handoff record for verified
implementation state and the exact resume point. Generate
`ai-engine-capability-matrix.md` as the accounting record once Phase 1 exists.
This roadmap owns dependency order, not current implementation status.

## Current repository baseline

As of 2026-08-30:

- `packages/ai-engine` is implemented through AI-1150 for the closed local 1v1
  scope; `packages/simulation` does not exist.
- `packages/npc-ai` provides the validated NPC policy and public AI-selection
  adapter; representative normal and multi-phase boss policies are examples.
- Combat Phase 10's explicit local-1v1 scope boundary is complete under ADR 0006.
- Combat Phase 11 catalog closure is complete, with the closed scope recorded
  in `ai-engine-progress.md`.
- `CombatDecisionInput` and `LegalDecision` carry normalized complete pending
  selections for `one`, `up-to`, and `all` responses.
- Combat transitions expose deterministic dependencies, immutable and
  serializable state, versions, structured events, pending work, explicit
  completion, the analysis/probe boundary, and branch-local speculative
  dependencies. AI Phase 0 consumes only the isolated keyed AI source.
- The combat engine now exposes a decision-point contract and semantic-progress
  identity. AI lookahead consumes those combat-owned contracts instead of
  inferring pending actor ownership or using exact replay hashes for loop
  detection.
- Simulation-quality selection now requires a declared effective analysis
  capability set. Insufficient descriptor/probe/lookahead/pending facilities
  fail explicitly instead of retaining simulation-quality profile identity
  while running a shallower policy.

AI-000 through AI-1150 are complete for the active local 1v1 scope. The next
workstream is the dedicated simulation roadmap; production simulation
infrastructure remains intentionally absent.

Update this baseline from verified repository evidence when implementation
begins. Do not use it as a substitute for the combat progress record or
capability matrix.

## Scope and authority

The initial delivery scope is deterministic, explainable AI decision-making for
the complete active local 1v1 combat scope established by Combat Phase 11. The
scope must be recorded in the AI progress document and derived from the closed
combat capability accounting.

The AI engine may:

- consume immutable `FightState` snapshots;
- consume complete combat-engine-enumerated legal decisions;
- consume an injected immutable game-data or mechanics view;
- consume combat-engine-authored decision descriptors and analysis probes;
- evaluate and rank legal decisions;
- evaluate combat state and matchup context;
- apply personality weights and difficulty settings;
- estimate tactical and strategic value;
- infer setup and combo relationships from structured mechanics;
- perform bounded shallow lookahead through combat-engine transitions;
- model likely opponent responses;
- use injected deterministic AI randomness for controlled variation; and
- return explainable score factors, rankings, and replay diagnostics.

The AI engine must not:

- determine combat legality independently;
- manufacture a decision absent from the supplied legal set;
- calculate authoritative damage, costs, statuses, rolls, or combat results;
- reinterpret raw game-data effects or source/display prose as combat rules;
- mutate supplied fight state or game-data registries;
- receive or consume the live fight's combat random source during evaluation;
- depend on `npc-ai`, `simulation`, Discord, persistence, applications, or
  forum tooling;
- treat AI hints or NPC priorities as rules;
- give difficulty levels hidden combat bonuses; or
- become an alternative combat runtime.

`npc-ai` owns NPC profiles, boss-phase configuration, and scripted tactical
priorities. `simulation` owns batch execution, matchup matrices, statistical
aggregation, anomaly detection, experimental data variants, and balance
reports. `ai-engine` owns shared decision quality used by both.

## Readiness and completion gates

Combat Phase 11 completion is a hard prerequisite for this roadmap. Do not
begin PRE-000, package scaffolding, contract implementation, evaluator work, or
any later AI item against a partial combat catalog.

### AI-start gate

Before PRE-000 begins:

- complete Combat Phase 11 and its final closure gate;
- verify the active local 1v1 combat capability matrix contains no unexplained
  in-scope occurrence;
- enumerate the closed scope's legal-decision and pending-decision surfaces;
- confirm deterministic, immutable, serializable transitions for that scope;
- confirm explicit completion and typed terminal reasons; and
- carry every approved combat exclusion into AI accounting as
  `audited-out-of-scope` rather than reopening it implicitly.

### Safe-fallback gate

Before AI-030 is complete, the combat-engine public contract must represent a
complete selectable pending response. A fallback is not complete if a legal
`all` or `up-to` selection cannot be returned as one member of the supplied
legal set.

The preferred correction is a combat-engine-owned legal-decision member whose
pending response contains the complete canonical selection. A documented
combat-engine materialization function is acceptable only if it preserves the
same membership, validation, and exhaustiveness guarantees. AI code must not
construct selection combinations by interpreting `PendingDecision` rules.

Required proof cases are:

- mandatory `one` selection;
- optional `up-to` selection with explicit decline;
- non-empty `up-to` multi-selection;
- mandatory `all` selection; and
- stale, duplicate, and foreign option rejection at the combat transition.

### Decision-quality closure gate

Before the AI is called simulation-quality for the active combat scope:

- every legal and pending decision category is deliberately classified;
- no core category remains strategically opaque or dependent on an
  unjustified fallback; and
- all deterministic replay, isolation, performance, and full-fight gates in
  Phase 11 pass.

## Architectural contracts to settle first

These checkpoints protect every later evaluator from becoming a second rules
engine. They are dependency gates, not one mandatory up-front implementation
batch:

```text
Combat Phase 11 closure
  -> PRE-000 -> AI-000/010/020
  -> PRE-010 -> AI-030
  -> PRE-020 -> AI-100 through AI-540
  -> PRE-030 -> AI-600 through AI-640
  -> PRE-040 branch sandbox -> AI-700 through AI-750
```

The three-randomness separation in PRE-040 must be agreed before AI-020. Its
speculative branch dependency factory may be implemented immediately before
Phase 7.

### PRE-000 - Freeze the closed combat scope for AI accounting

After Combat Phase 11 passes, generate a versioned list of in-scope
legal-decision discriminants, pending-decision types, selection cardinalities,
and representative mechanics. Tie the declaration to the completed combat
progress record and closed capability matrix.

Exit evidence:

- an explicit closed-scope entry in `ai-engine-progress.md`;
- representative legal-decision fixtures sourced from public combat behavior;
- no unexplained combat row carried into AI implementation; and
- approved combat exclusions preserved as explicit AI exclusions.

### PRE-010 - Complete the pending-selection legal contract

Resolve the mismatch between normalized multi-selection submissions and the
single-option `LegalDecision` member. The legal surface must expose complete,
canonical, submit-ready pending responses.

This is a combat-engine-owned contract change. Audit application, NPC,
persistence, and future AI consumers when it is implemented.

### PRE-020 - Define combat-authored decision descriptors

Provide a narrow public combat-engine-owned description of mechanically
significant decision facts. A descriptor may include:

- stable decision identity and category;
- action consumption (`action`, `free`, or `response`);
- declared and effective costs through an authoritative probe;
- typed effect categories and timing;
- scarcity and remaining-use facts;
- target and selection facts;
- terminal semantics; and
- references to authoritative outcome probes.

The descriptor must be produced from compiled, authoritative combat
information. AI may reason about the strategic value of those facts, but must
not reproduce compilation, selector meaning, formulas, or effect execution.

### PRE-030 - Define the combat analysis/probe boundary

Before AI-600 or AI-700, expose an intentional combat-engine public boundary
for expected-outcome analysis and speculative transitions. The smallest useful
contract should support:

- describing a legal decision without parsing prose;
- enumerating legal decisions for a speculative state;
- running a normal transition with analysis-local dependencies;
- returning typed successor state, events, terminal state, and optionally
  combat-owned calculation traces; and
- enforcing deterministic node/probe budgets at the caller.

The probe must not expose private executors merely for AI convenience. It
should reuse ordinary combat transitions or a narrow public analysis facade
owned and tested by `combat-engine`.

### PRE-040 - Define branch-local deterministic dependencies

Separate three forms of randomness:

1. live authoritative combat randomness;
2. AI-only preference, mistake, noise, and tie-break randomness; and
3. speculative branch combat randomness.

AI randomness should be keyed and derivable from stable semantic inputs rather
than call order. A result should derive from the root AI seed, profile/evaluator
version, stable purpose, and canonical decision key. Reordering equivalent
legal inputs must not change deterministic scores or selection.

Each speculative branch receives a branch combat seed, fixed clock,
branch-local deterministic ID source, and deterministic work budget derived
from a stable branch path. It must never receive the production fight's
`CombatDependencies` object or mutable random source.

## Working method

A normal implementation slice adds one reusable AI capability rather than a
special case for one move, NPC, or boss.

For each slice:

1. Read `AGENTS.md`, `ARCHITECTURE.md`, `combat-ai-simulation.md`, the AI
   progress record, this roadmap, and the current AI capability matrix.
2. Confirm the closed active combat scope and public combat contracts required
   by the work.
3. Implement the smallest generic decision-quality capability that closes the
   selected matrix gaps.
4. Keep score factors, identity, versions, and provenance named and independently
   inspectable.
5. Add deterministic focused tests against synthetic and representative combat
   states through public boundaries.
6. Update the generated capability matrix and progress record with verified
   coverage, limitations, and exact resume point.
7. Format changed files and run focused checks during development. Run
   `npm run quality` for package, architecture-boundary, or multi-package
   handoffs as required by `AGENTS.md`.

Prefer this loop:

```text
unclassified or weak decision surfaces
  -> group by missing AI capability
  -> dependency-order capabilities
  -> implement one reusable primitive
  -> verify representative public cases
  -> regenerate capability accounting
```

Do not use this as the primary loop:

```text
bad choice for Move A -> add Move A branch
bad choice for Move B -> add Move B branch
```

Definition- or NPC-specific information is acceptable only as validated,
declarative advisory configuration or an explicitly justified adapter concern.
It must never become hidden AI-engine rule behavior.

## Capability accounting

The generated AI capability matrix should track strategic support by decision
and reusable capability rather than by move name. Dimensions include:

- legal-decision discriminant and complete pending-response shape;
- action category and action consumption;
- resources, damage, defense, healing, and terminal outcomes;
- statuses, transformations, scarcity, temporary setup, denial, and forced
  actions;
- current-state, matchup, horizon, and combo dependencies;
- expected-outcome support;
- personality and difficulty weighting;
- lookahead and opponent-response support;
- diagnostics and replay; and
- deterministic and isolation coverage.

Each dimension has one status:

- `supported`: implemented with focused strategic behavior coverage;
- `supported-baseline`: safely selectable through the generic fallback, but
  strategically understood only at baseline level;
- `contract-accounted-not-currently-emitted`: present in the public union but
  not emitted by a verified public combat transition;
- `unsupported-in-scope`: part of the active AI scope but waiting on an AI
  capability; or
- `audited-out-of-scope`: outside the active combat or AI delivery scope.

There must be no artificial `supported-baseline` rows before AI-030 exists. The
initial matrix should classify current AI surfaces as `unsupported-in-scope` or
`audited-out-of-scope`. AI-030 legitimately promotes enumerable, safely
selectable categories to `supported-baseline`; later phases promote deliberate
strategic coverage to `supported`.

Two gates apply:

1. **Accounting gate:** every in-scope surface is classified. Baseline and
   unsupported entries are allowed.
2. **Decision-quality closure gate:** no core in-scope surface is strategically
   opaque or dependent on unjustified fallback behavior.

The AI must remain able to choose safely when several legal candidates have
equal strategic knowledge. Empty legal sets produce an explicit typed failure;
they never cause an invented action.

## Dependency-ordered queue

### Phase 0 - Package and contract foundation

#### AI-000 - Create `@dragonball-resurgence/ai-engine`

Create the package with intentional public exports and the approved dependency
direction:

```text
shared, game-config, game-data, combat-engine
                       |
                       v
                   ai-engine
```

The package must not depend on `npc-ai`, `simulation`, applications, Discord,
persistence, or forum tooling. Add the root TypeScript project reference.

The package and closed-scope progress record are implemented. Do not create a
handwritten capability matrix that will later drift; add the generated artifact
with AI-100.

#### AI-010 - Core decision contracts

Introduce the public contracts for:

- AI decision request and result;
- candidate evaluation and canonical decision key;
- structured score factors and provenance;
- personality and difficulty profiles;
- diagnostic retention level;
- immutable AI game-data/mechanics view;
- AI-only deterministic dependencies; and
- optional combat analysis/probe dependency.

A request contains authoritative state, actor, the complete supplied legal set,
profile, immutable mechanics view, AI randomness, and requested diagnostic
level. A successful result contains exactly one complete decision from the
supplied set. Use a typed empty-set or invalid-request failure.

#### AI-020 - Keyed deterministic AI randomness

Provide deterministic derived operations for probability checks, bounded score
noise, mistake selection, and tie breaking. Each operation is keyed by stable
semantic identity; candidate iteration order must not determine random
consumption.

AI randomness must remain distinguishable from live and speculative combat
randomness. Adding or reordering a candidate must not perturb unrelated
candidate noise.

#### AI-030 - Safe legal fallback

Implement the lowest-level policy that selects one supplied complete legal
decision without strategic understanding. The fallback must:

- return only a supplied member;
- be deterministic with randomness disabled;
- support every declared ordinary and pending decision shape;
- preserve canonical multi-selection responses;
- treat surrender as terminal loss rather than an ordinary zero-utility action;
- use stable tie breaking independent of input order; and
- fail explicitly on an empty legal set.

Phase 0 exit criteria (complete 2026-08-30):

- the package exists with valid boundaries and public exports;
- contracts are stable enough for later slices;
- AI randomness is keyed, injectable, and isolated from combat randomness;
- every non-empty legal set in the verified slice can be resolved safely;
- complete pending selections remain complete; and
- no combat rule is duplicated.

The verified implementation is recorded in `ai-engine-progress.md`. Phase 1
resumes at AI-100; no AI capability matrix is created during Phase 0.

### Phase 1 - Make AI coverage mechanically discoverable

#### AI-100 - Generated AI capability matrix

Generate an accounting view from combat-engine legal and pending-decision
contracts, the closed active combat scope, decision descriptors, and registered
AI evaluators. Summaries should group gaps by reusable AI capability and cite
focused coverage.

Expected artifacts are:

- `scripts/ai-capability-matrix.ts`;
- `docs/architecture/ai-engine-capability-matrix.md`; and
- a validator integrated into the appropriate repository validation stage.

#### AI-110 - Typed non-authoritative feature extraction

Convert complete legal decisions plus combat-engine-owned descriptors,
authoritative state, and the injected immutable mechanics view into typed
evaluation features.

Feature extraction describes a decision; it does not resolve combat. It may use
identities and plainly declarative advisory metadata from game data, but all
mechanically significant meanings must come from combat-authored descriptors or
probes. Source/display text is never an executable input.

#### AI-120 - Exhaustive evaluator registry

Create deliberate accounting for every in-scope `LegalDecision` discriminant,
pending-decision type, and complete response shape. Adding a combat decision
surface must produce a compile-time or validation requirement instead of
falling silently into an unrelated evaluator.

#### AI-130 - Capability accounting gate

Fail validation on unclassified decision surfaces. Incomplete understanding may
remain baseline or unsupported, but it must be visible with a prerequisite and
proof target.

Phase 1 exit criteria:

- every active legal and pending response type is classified;
- feature extraction does not reinterpret combat mechanics;
- supported evaluators cite focused behavioral coverage; and
- the progress record names the highest-priority ready capability.

### Phase 2 - Explainable immediate utility

#### AI-200 - Structured score-factor and diagnostic foundation

Represent utility as structured named signed factors, not one opaque score or a
`Record<string, number>`. Each factor records a stable code, value, source,
and optional typed basis/provenance.

Introduce candidate identity, evaluator/profile versions, factor ordering, and
the minimal candidate diagnostic schema now. AI-800 remains the full diagnostic
phase, but provenance must not be retrofitted after the evaluators exist.

#### AI-210 - Resource utility

Evaluate state-relative consequences for Ki and HP spending, gain, loss,
efficiency, overflow, waste, and preservation of likely later options. One Ki
or HP must not have a constant value in every combat state.

#### AI-220 - Damage, survival, KO, and terminal utility

Evaluate immediate damage potential, lethal opportunities, self-lethal
consequences, prevention, healing, survival, finishing value, and strategically
relevant overkill. Explicitly classify surrender and any other terminal
decision so voluntary defeat cannot tie a weak but viable action.

Authoritative probabilities and outcomes must come from combat-owned
descriptors or probes; AI code must not reproduce damage or result formulas.

#### AI-230 - Action economy

Score ordinary and free actions, responses, passes, skipped/forced actions,
additional actions, delayed benefits, and expiring opportunities.

#### AI-240 - Baseline chooser

Combine initial factors for sensible choices among attacks, power-up, pass,
surrender, defense responses, straightforward items, and other verified
immediate decisions.

Phase 2 exit criteria:

- every score is the deterministic sum of inspectable factors;
- immediate guaranteed KO is strongly preferred absent a higher-priority
  survival constraint;
- preventable immediate defeat can outweigh greedy damage;
- expensive actions are not treated as free;
- surrender is never a generic neutral fallback; and
- diagnostic retention level does not affect selection.

### Phase 3 - Combat-state and matchup context

#### AI-300 - State evaluator

Evaluate HP percentage and survival margin, Ki, active statuses/effects,
transformation state, remaining uses, turn, action history, pending work,
initiative, and estimated fight horizon. Keep each component independently
testable and avoid double-counting immediate factors.

#### AI-310 - Status and control context

Evaluate stun, action denial, move locks, forced actions, defensive impairment,
temporary buffs/debuffs, duration, expiry, immunity, and redundancy where
represented by authoritative state or descriptors. Derive value from mechanics
and opponent options, never status or move IDs.

#### AI-320 - Transformation activation and deactivation context

Evaluate both legal transformation activation and deactivation. Consider
resource cost, immediate value, remaining fight horizon, current form,
stability/cooldown/lifecycle state, HP effects, and opportunity cost represented
by combat-owned facts.

#### AI-330 - Scarce-use conservation

Evaluate restricted moves, one-per-combat items, once-only reactions,
transformation opportunities, and other authoritative capacities. Distinguish
powerful now from worth consuming now without reflexive hoarding.

#### AI-340 - Pending decisions as first-class choices

Route defense, optional effects, selections, and suspended responses through
the same factor and ranking pipeline as action-phase choices. Do not build a
parallel ad hoc defense policy.

Phase 3 exit criteria:

- state context changes rankings without determining legality;
- status and transformation decisions are not reduced to generic damage;
- deactivation is evaluated deliberately;
- scarce resources can be conserved or spent for clear value; and
- pending responses have parity with ordinary decisions.

### Phase 4 - Personality and difficulty

#### AI-400 - Personality weighting

Implement stable dimensions for aggression, damage, defense, status,
Ki conservation, risk tolerance, transformation preference, scarcity
conservation, and combo preference. Personality modifies factor weights; it
does not change mechanics or override obvious terminal priorities without an
explicitly bounded design.

#### AI-410 - Difficulty profiles

Implement difficulty through reasoning quality: evaluation precision,
candidates retained, combo awareness, lookahead depth, opponent modeling,
score noise, mistake chance, and resource preservation. Never grant hidden
stats, rolls, damage, HP, or Ki.

#### AI-420 - Controlled mistakes and score noise

Noise and mistakes are bounded, keyed, seeded, reproducible, and incapable of
selecting an illegal action or mutating state. Input order and diagnostic level
must not change their semantic result.

#### AI-430 - Simulation-quality profile

Define the strongest deterministic bounded profile with no intentional
mistakes, zero or near-zero noise, strongest supported combo awareness and
opponent modeling, stable tie breaking, and deterministic work budgets. This is
the best implemented bounded policy, not a perfect-play claim.

### Phase 5 - Tactical setup and combo inference

#### AI-500 - Declarative setup-value inference

Infer setup value from structured combat-authored mechanics: statuses enabling
actions, stat changes improving later attacks, resource denial, temporary
windows, category locks, and transformations unlocking actions. Do not encode
named move pairs in the generic evaluator.

#### AI-510 - Follow-up opportunity windows

Discount setup according to whether the AI can capitalize later in the action,
next action, next turn, several turns, or combat. Setup that expires before a
usable follow-up receives no false full value.

#### AI-520 - Denial and control value

Value Ki denial, move/defense denial, forced categories, action loss, and option
removal based on the opponent's actual engine-legal options. Locking an option
the opponent does not possess should have approximately no denial value.

#### AI-530 - Mechanically inferred combo chains

Identify bounded, obvious mechanical relationships without definition-ID
tables. Renaming an ID without changing mechanics must not change generic combo
reasoning.

#### AI-540 - Optional AI-hints gate

Only after mechanical inference is implemented and measured may `game-data`
gain optional validated `aiHints`. Hints may describe broad strategic roles or
follow-up preferences. Removing them must not change legality or executable
effects, and they must never override combat-owned mechanics.

### Phase 6 - Expected outcomes and candidate pruning

PRE-030 must be complete before this phase.

#### AI-600 - Combat-owned outcome-category estimation

Use combat-engine descriptors or probes to represent relevant outcomes such as
miss/stopped, normal success, critical success, block/counter exposure, status
success, and lethal result. AI code must not reproduce dice, cost, calculation,
or resolution rules.

#### AI-610 - Expected utility

Combine authoritative probabilities with strategic utility. Preserve
uncertainty bounds and provenance in diagnostics rather than flattening them
into false certainty.

#### AI-620 - Candidate dominance and pruning

Remove candidates that are clearly dominated under the current evaluation
while protecting lethal, survival, strategically unique, personality-relevant,
and uncertain candidates.

#### AI-630 - Deterministic analysis budget

Bound candidates, outcome categories, engine probes, and total deterministic
work. Difficulty may adjust these bounds.

Do not use wall-clock time as a selection-determining budget in deterministic
or simulation-quality profiles. External cancellation may abort work, but
machine load must not silently change strategy.

#### AI-640 - Pruning diagnostics

Record why every candidate was retained, dominated, pruned by budget, or
protected.

### Phase 7 - Selective shallow lookahead

PRE-040 must be complete before this phase.

#### AI-700 - Engine-driven one-step lookahead

Evaluate retained candidates through normal combat-engine transitions or the
approved combat analysis facade. Use the immutable input snapshot and returned
successor states; do not add `structuredClone` by default. First prove through
deep-freeze or mutation-sentinel tests that transitions preserve their inputs.
Add cloning only if a measured integration requires it.

Speculative transitions use isolated branch dependencies and never affect live
state, live randomness, IDs, or clocks.

#### AI-710 - Likely opponent responses

From each speculative successor, obtain the opponent's complete engine-legal
set, evaluate it through the same AI framework, and retain a bounded response
set. Never invent an opponent action.

#### AI-720 - Response-weighted evaluation

Evaluate the original candidate against likely legal opponent responses rather
than assuming random or cooperative play.

#### AI-730 - Configurable shallow depth

Support bounded depth through the difficulty profile. Initial scope remains
shallow; full minimax and MCTS are non-goals.

#### AI-740 - Pending-choice lookahead

Allow speculative play to continue through complete defensive responses,
optional reactions, target and move selections, and other pending decisions.

#### AI-750 - Search safeguards

Bound node count, candidate count, repeated states, counter chains,
pending-decision expansion, and probe work. Exhaustion degrades
deterministically to the best already-computed shallower legal ranking.

### Phase 8 - Diagnostics and reproducibility

#### AI-800 - Explainable ranking

Expose total score, ordered named factors, personality adjustments, outcomes,
setup/combo value, lookahead value, uncertainty, and pruning status for each
evaluated action.

#### AI-810 - Human-readable explanation

Render concise explanations exclusively from structured diagnostics. The
renderer must not recompute or alter the choice.

#### AI-820 - Decision replay record

Record enough identity for exact compatibility checks:

- replay schema version;
- fight ID, snapshot schema version, state version, rules version, and canonical
  state hash;
- actor and canonical keyed legal set;
- game-data version and optional hash;
- AI engine, evaluator, profile ID/version/hash, and seed;
- candidate, depth, node, and probe budgets;
- selected decision key and ranking hash; and
- optional diagnostics at the requested retention level.

Production records may store a canonical state hash plus version; anomaly or
offline replay tooling may retain the full snapshot when required.

#### AI-830 - Deterministic decision replay

Equal state, complete legal set, game-data view/version, profile, AI seed,
evaluator version, and deterministic budget must reproduce equal features,
factors, pruning, speculative paths, ranking, and decision.

#### AI-840 - Diagnostic retention levels

Support at least selection-only, ranked-summary, and full diagnostics. Retention
must not change selected decisions, random derivation, or speculative work.

### Phase 9 - NPC consumer readiness

NPC-specific implementation remains owned by `npc-ai`.

#### AI-900 - Profile-consumer contract

Allow `npc-ai` to supply validated personality, difficulty, tactical priority
modifiers, and phase-specific profile selection.

#### AI-910 - Boss-phase compatibility

Support profile changes based on authoritative state or declarative NPC-phase
configuration. Boss scripting may modify rankings or choose among supplied
legal candidates; it may not manufacture actions.

#### AI-920 - Controlled tactical priorities

Provide bounded advisory modifiers for transformation thresholds, signature
move conservation, status pressure, and aggressive phases. Priorities affect
evaluation, not combat execution.

#### AI-930 - NPC integration proof

Prove a thin NPC adapter can enumerate legal decisions, request one AI choice,
submit that same choice through the combat engine, and continue to the next
decision or completion without duplicated combat logic.

### Phase 10 - Simulation consumer readiness

Simulation implementation remains outside `ai-engine`.

#### AI-1000 - Stateless batch safety

Prove the AI retains no hidden fight-local state. Parallel or sequential
evaluation of unrelated fights must not contaminate later requests.

#### AI-1010 - Deterministic simulation mode

Provide no uncontrolled randomness or wall-clock strategy decisions, stable
factor order and tie breaking, and bounded deterministic search.

#### AI-1020 - Performance budget

Benchmark representative baseline, combo, lookahead, candidate-scaling, and
pending-decision states. Publish configuration bounds rather than assuming
unlimited compute.

#### AI-1030 - Reduced diagnostics

Allow high-volume callers to avoid constructing or retaining unnecessary
diagnostics while preserving the exact decision for equivalent semantic
configuration.

#### AI-1040 - AI-vs-AI full-fight driver proof

In test/support code, drive two AI policies through only public combat
transitions until completion or an explicit external safeguard. This proves the
consumer contract; it is not the production simulation runner.

### Phase 11 - Decision-quality closure

#### AI-1100 - Zero unexplained in-scope surfaces

Every in-scope legal and pending decision category has tested strategic
support, an explicitly accepted generic baseline limitation, or an approved
out-of-scope classification. Core simulation-quality decisions may not remain
baseline-only.

#### AI-1110 - Capability regressions

Cover immediate KO, survival, terminal surrender, resource and restricted-use
conservation, status setup, transformation activation/deactivation, denial,
pending defense, personality/difficulty differences, combo inference, pruning,
and opponent modeling.

#### AI-1120 - Deterministic and isolation invariants

The public test suite must cover:

| Invariant              | Required proof                                                       |
| ---------------------- | -------------------------------------------------------------------- |
| Legal subset           | Result deeply equals one complete supplied legal candidate.          |
| Empty set              | Explicit typed failure; no synthesized action.                       |
| Input order            | Permuting legal decisions does not alter deterministic ranking.      |
| State immutability     | Evaluation leaves frozen input state unchanged.                      |
| Game-data immutability | Evaluation cannot mutate the injected view.                          |
| Diagnostic invariance  | All retention levels select identically.                             |
| Same-seed replay       | Equal complete input reproduces factors, branches, and choice.       |
| RNG isolation          | AI noise does not change subsequent live combat rolls.               |
| Branch isolation       | Evaluating one candidate cannot change another branch.               |
| Batch isolation        | `A -> B -> A` produces the same second `A` as isolated `A`.          |
| ID independence        | Renaming IDs without changing mechanics preserves generic reasoning. |
| Search exhaustion      | Budget exhaustion returns an already-ranked legal fallback.          |
| Pending parity         | Pending responses use the core evaluation pipeline.                  |

#### AI-1130 - Representative autonomous fights

Cover balanced vs balanced, power vs dexterity, defense vs burst,
status/control vs damage, Ki denial vs efficient offense, transformation-heavy
combat, and restricted-use pressure. These are behavior regressions, not
balance conclusions.

#### AI-1140 - Synthetic decision-quality tests

Include intentionally obvious cases where a correct policy takes guaranteed
KO, avoids preventable defeat, preserves scarce resources when they add no
value, selects a strictly superior equivalent action, recognizes usable setup,
rejects expired setup, values only real denial, avoids a self-defeating line,
selects only legal actions, and remains deterministic without noise.

#### AI-1150 - Final closure gate

Regenerate the capability matrix, verify no unexplained active-scope gap, run
the required focused coverage, and run `npm run quality` as the repository
handoff gate.

## Priority and risk heuristic

Within the earliest phase whose prerequisites are satisfied, prefer:

1. a partially implemented capability whose state creates inconsistent choices;
2. a contract or analysis-boundary correction that prevents rule duplication;
3. a prerequisite shared by several strategic gaps;
4. the missing capability affecting the most legal or pending categories;
5. the capability affecting the most representative combat states;
6. work that improves both NPC and simulation consumers; and
7. the least speculative new public contract.

Use effort labels only as relative planning guidance:

- **Low:** package wiring, profile constants, retention switches, or small
  validators.
- **Medium:** stable contracts, keyed randomness, registries, state/resource
  evaluators, pruning, replay records, or consumer adapters.
- **High:** authoritative descriptors, expected outcomes, status/control
  semantics, pending parity, combo inference, branch isolation, lookahead, and
  autonomous full-fight proof.

Do not prioritize a capability merely because a prominent move or boss exposes
it. Diagnose the missing reusable concept first.

## Decision-quality gap register

Once Phase 1 exists, derive a planning view from the generated matrix:

| AI gap                            | Roadmap owner       | What it unlocks                                |
| --------------------------------- | ------------------- | ---------------------------------------------- |
| Complete legal/pending accounting | PRE-010, AI-100-130 | Safe exhaustive AI surface                     |
| Combat-authored descriptors       | PRE-020, AI-110     | Strategic features without duplicate rules     |
| Resource valuation                | AI-210              | HP/Ki-efficient decisions                      |
| Damage/KO/survival/terminal value | AI-220              | Basic tactical competence                      |
| Action economy                    | AI-230              | Free, delayed, and skipped-action reasoning    |
| State context                     | AI-300              | State-aware scoring                            |
| Status/control                    | AI-310              | Control archetypes                             |
| Transformations                   | AI-320              | Activation and deactivation timing             |
| Scarcity                          | AI-330              | Restricted move and item management            |
| Pending parity                    | AI-340              | Autonomous reactions and defense               |
| Personality                       | AI-400              | Distinct NPC behavior                          |
| Difficulty                        | AI-410-430          | Scalable reasoning quality                     |
| Setup/combo inference             | AI-500-540          | Multi-action strategy                          |
| Authoritative outcome probe       | PRE-030, AI-600-610 | Risk-aware utility without duplicated formulas |
| Candidate pruning                 | AI-620-640          | Affordable deeper reasoning                    |
| Branch-local dependencies         | PRE-040             | Reproducible isolated speculation              |
| Lookahead                         | AI-700-750          | Tactical foresight                             |
| Diagnostics/replay                | AI-200, AI-800-840  | Explainability and reproducibility             |
| NPC contracts                     | AI-900-930          | Thin NPC and boss integration                  |
| Simulation contracts              | AI-1000-1040        | Batch and Monte Carlo readiness                |

Each active entry records capability, roadmap owner, affected decision
categories, representative scenarios, prerequisites, implementation shape,
and proof case.

## Non-goals

The initial AI-engine roadmap excludes:

- Monte Carlo orchestration, statistics, matchup matrices, anomaly detection,
  and balance reports;
- custom-move laboratory workflows and mutable live game-data experiments;
- NPC definitions, Discord integration, persistence, and application behavior;
- reinforcement learning, neural networks, and LLM combat decisions;
- full minimax, full MCTS, and perfect-play claims;
- hidden difficulty bonuses;
- wall-clock-driven selection in deterministic modes;
- source/display prose execution; and
- duplicated combat rules.

These belong to another owner or are intentionally deferred.

## Definition of complete

The initial `@dragonball-resurgence/ai-engine` delivery scope is complete only
when:

- it selects exclusively from complete combat-engine legal decisions;
- it never mutates authoritative state or game-data views;
- it contains no duplicated authoritative combat-rule implementation;
- every in-scope legal and pending decision category has deliberate accounting;
- immediate utility uses named, ordered, provenance-bearing factors;
- HP, Ki, survival, KO, terminal loss, defense, statuses, transformations,
  scarcity, and action economy affect decisions where relevant;
- transformation deactivation and pending decisions are first-class choices;
- personality changes preference without changing rules;
- difficulty changes reasoning quality without hidden combat bonuses;
- setup and combo value comes from structured mechanics rather than IDs;
- expected outcomes and speculative transitions use combat-owned probes;
- expensive reasoning uses deterministic bounded pruning and shallow lookahead;
- opponent models use only complete engine-legal responses;
- AI and speculative combat randomness are isolated, keyed, and reproducible;
- diagnostics explain rankings without changing behavior;
- replay records identify state, rules, data, profile, evaluator, seed, and
  budgets;
- `npc-ai` can consume the package without combat logic;
- future simulation can call it repeatedly without hidden state or cross-fight
  contamination;
- representative autonomous fights reach terminal engine states or explicit
  external safeguards; and
- capability closure, focused coverage, and repository quality gates pass.

At that point, work can proceed to a dedicated simulation roadmap without
redesigning AI decision architecture.
