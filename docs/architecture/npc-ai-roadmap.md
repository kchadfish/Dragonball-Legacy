# NPC-AI completion roadmap

## Purpose

This document is the dependency-ordered roadmap for completing the NPC-owned
decision adapter around the completed `@dragonball-resurgence/ai-engine` and
the authoritative `@dragonball-resurgence/combat-engine`.

The finish line for this roadmap is **NPC Intelligence Complete**. That is the
handoff gate to the full Simulation system, not a Discord production-release
gate. The eventual production encounter scope may include both player-versus-
NPC and NPC-versus-NPC fights. The headless NPC Intelligence milestone only
requires NPC-versus-NPC autonomous execution because that is sufficient to
validate the NPC decision system and hand it to Simulation.

Once implementation begins, create `npc-ai-progress.md` as the authoritative
handoff record. Generate `npc-ai-readiness-matrix.md` as the committed
accounting artifact and keep it synchronized with the canonical NPC catalog.
This roadmap owns dependency order, completion contracts, and evidence
requirements; it does not mark future work as implemented.

## Current repository baseline

As of 2026-08-30:

- `@dragonball-resurgence/ai-engine` is complete for the verified local 1v1
  scope and exposes deterministic selection, diagnostics, replay, bounded
  reasoning, and consumer contracts.
- `@dragonball-resurgence/npc-ai` currently consists of one public implementation
  module and its focused tests. It validates `npc-ai-policy:v1` policies,
  resolves deterministic state-based phases, compiles four bounded tactical
  priority types, enumerates combat-engine legal decisions, and returns the
  exact legal decision selected by `ai-engine`.
- The current package includes the representative policies `normal-npc` and
  `multi-phase-boss`. They are examples, not an exhaustive authored catalog,
  and their current phase IDs are `desperate` and `opening`.
- The current public implementation has no pure NPC materialization adapter,
  exhaustive NPC-to-policy assignment, or production application consumer.
- `game-data` contains 32 canonical NPC definitions. Four do not currently
  contain a resolved runnable HP value, nine contain at least one unresolved
  move name, two retain transformation information as source text, and
  thirteen list equipment by display name.
- No application currently depends on `npc-ai`. The Discord and API entry
  points are placeholders, so there is no production NPC-turn loop,
  player-facing presentation, moderator control, or operational rollout.
- The active delivery scope remains local 1v1 combat. Allies, joint attacks,
  interferers, remote targets, and other exclusions recorded under
  `ai-combat-scope:v1` remain out of scope for this roadmap's intelligence
  milestone.

The current implementation also has a known contract gap: phase matching uses
`state.activeCombatantId` to derive `self`, while selection receives an
explicit `request.actorId`. Phase resolution does not yet validate that the
requested actor owns the ordinary or pending decision. Phase 2 closes this gap
before the authored policy catalog and boss work proceed.

## Architecture and ownership

The intelligence path must preserve this ownership boundary:

```text
source-faithful game-data NPC record
              |
              v
   npc-ai normalization overlay
              |
              v
 validated materialized combatant input -----> combat-engine
              |                                      |
              v                                      v
       npc-ai effective policy ---------------> legal decisions
              |                                      |
              +--------------> ai-engine <-----------+
                               |
                               v
                  exact selected legal decision
                               |
                               v
                    combat-engine transition
                               |
                               v
                 headless NPC-vs-NPC certification
                               |
                               v
                         Simulation handoff
```

Ownership is fixed as follows:

- `game-data` owns canonical NPC identity, source traceability, combat
  inputs, moves, transformations, items, race references, and style
  references.
- The normalization overlay supplies only structured values or stable IDs
  needed to turn ambiguous source representations into validated runtime
  inputs. It is not a second NPC catalog.
- `combat-engine` owns fight setup validation, legal decisions, every combat
  rule, state transitions, events, completion, and termination reasons.
- `ai-engine` owns generic decision quality, profiles, deterministic selection,
  lookahead, replay identity, and decision diagnostics.
- `npc-ai` owns NPC-specific normalization, effective policy assignment, phase
  selection, tactical priorities, policy validation, and NPC decision results.
- The headless certification boundary owns autonomous execution limits and
  reporting around fights; it must still submit every decision through the
  ordinary combat-engine public boundary.
- Applications own future sessions, authorization, production seed
  allocation, player handoff, user/moderator controls, and platform rendering.
- The future Simulation package owns batch execution, scenario construction,
  aggregation, and simulation reports. It does not depend on Discord or
  application orchestration.

Static NPC definitions must not import `npc-ai` types. The NPC-to-policy
assignment registry belongs in `npc-ai` and is keyed by stable `game-data` NPC
IDs. No package may copy combat legality, damage, status, transformation, or
completion rules from `combat-engine`.

## Completion gates

### Runtime-ready definition gate

An NPC may be automated only when every combat-authoritative input is
structured, reference-resolved, and validated. Runtime code must never infer
stats, moves, transformations, equipment, or rules from `levelText`,
`transformationText`, `battleNotes`, source prose, or display names.

An incomplete definition is rejected with typed readiness issues or remains an
explicitly audited manual-only NPC. It must not be silently approximated.

### Policy-accounting gate

Every canonical NPC is explicitly classified as automated or justified
manual-only. Every automated NPC has exactly one effective policy. Manual-only
classification is an accounted outcome, not an omitted row or an implicit
fallback.

### Legal-transition gate

Every automated decision is an exact member of the current combat-engine
enumerated legal set, including ordinary and pending decisions, and is
submitted through the normal combat transition boundary. NPC code may not
mutate `FightState`, manufacture a pending response, or calculate an outcome.

### Determinism and safeguard gate

Fixed state, policy, versions, injected dependencies, and seed identity must
reproduce the same NPC decision and replay evidence. An autonomous fight must
either reach a combat-engine-owned completion state or halt through an explicit
external safeguard. A safeguard never manufactures a combat victory, defeat,
or stalemate.

## Phase 0 - Scope, completion contracts, and accounting

### NPC-000 - Freeze supported combat scope

Record local 1v1 combat as the active delivery scope and carry every
`ai-combat-scope:v1` exclusion into NPC accounting without reinterpretation.
Record that the eventual production scope may include player-versus-NPC and
NPC-versus-NPC encounters. Only NPC-versus-NPC autonomous execution is
required for NPC Intelligence Complete.

### NPC-010 - Define stable identity and version rules

Define owners and stable formats for canonical NPC IDs, policy IDs, phase IDs,
assignments, catalog versions, materialization versions, and replay identity.
Use lowercase hyphenated IDs for policy and phase identity, for example:

- `npc-policy-balanced`;
- `npc-policy-aggressive`; and
- `phase-enraged`.

Reserve colon-style values for schema or contract versions such as
`npc-ai-policy:v1` and `npc-policy-catalog:v1`. Do not derive durable identity
from display names, catalog order, Discord users, or encounter position.

The current `npc-ai-policy:v1` implementation remains the starting contract;
do not create `npc-ai-policy:v2` merely because the current experimental v1
implementation is not yet production-consumed. Phase 3 defines when this v1
contract becomes stable and supported.

### NPC-020 - Create the progress record

Add `npc-ai-progress.md` with the closed scope, current phase, verified
evidence, readiness counts, known exclusions, manual-only decisions, and exact
resume point. The record must distinguish implementation evidence from
planned work.

### NPC-030 - Establish generated readiness accounting

Define the schema, generator inputs, and stale-output validation for
`npc-ai-readiness-matrix.md`. The generated record must have one row per
canonical NPC and be able to account for source readiness, materialization,
policy assignment, certification, and manual-only justification.

### NPC-040 - Define boundary and readiness validation

Specify the validation commands and public-boundary evidence required for
generated source records, the normalization overlay, materialization,
effective policy assignment, legal-decision selection, and autonomous
certification. A stale matrix, missing classification, unknown reference, or
unexplained exclusion is a validation failure.

### NPC-050 - Define completion scenarios

Create representative acceptance scenarios for:

- a normal NPC using ordinary actions and moves;
- an NPC responding to every supported pending-decision category;
- an NPC using an item and transformation when legal;
- a synthetic multi-phase boss crossing overlapping thresholds;
- statuses, scarce resources, defeat, surrender, and combat completion;
- an invalid or incomplete NPC definition;
- an exhausted AI work budget or typed selection failure;
- deterministic replay of a preserved NPC decision; and
- an external safeguard halt that preserves the distinction from combat
  completion.

Phase 0 exit evidence:

- supported scope and exclusions are explicit;
- the distinction between NPC Intelligence Complete and production
  integration is recorded;
- identity and version rules are approved;
- the progress record and generated readiness-matrix contract are defined;
- boundary/readiness validation is specified; and
- completion scenarios cover ordinary, pending, terminal, replay, and
  safeguard behavior.

## Phase 1 - NPC source normalization and runtime readiness

### NPC-100 - Correct generator numeric parsing

Fix generator parsing for NPC combat-authoritative numeric values, including
HP, power, dexterity, bonuses, levels, and source percentages. Preserve the
canonical source representation and traceability while producing structured
values. Parsing fixes must not promote battle notes or descriptive prose into
runtime rules.

### NPC-110 - Preserve source-faithful generated NPC records

Ensure generated NPC records remain faithful to canonical source material,
including unresolved or ambiguous fields with explicit traceability. A source
record may retain source text for audit and display, but runtime readiness may
not treat that text as executable mechanics.

### NPC-120 - Add the narrow normalization overlay

Define a hand-authored normalization overlay only for information required to
convert an ambiguous or non-runtime source representation into a structured
value or stable ID. Generated source records remain canonical. Do not duplicate
already-resolved NPC fields or create a hand-authored replacement NPC record.

The required flow is:

```text
source NPC record
  -> normalization overlay
  -> validated materialized combatant
```

The overlay must retain provenance for each normalization decision and must
not contain combat callbacks, damage formulas, hidden rules, or runtime prose
interpretation.

### NPC-130 - Classify automated and manual-only NPCs

Classify every canonical NPC as automated or justified manual-only. A
manual-only classification must identify the unresolved source or excluded
mechanic, the applicable scope decision, and why automation is not currently
valid. It must not be used to hide a missing accounting decision.

### NPC-140 - Resolve stable runtime references and reject prose mechanics

Resolve move, item, transformation, race, and style references to stable IDs
through validated catalogs. Reject unresolved required references and reject
mechanical battle-note, transformation, or other prose that has not been
normalized into an approved structured value. Do not infer NPC personality or
combat behavior from descriptive source prose at runtime.

### NPC-150 - Implement pure materialization

Add pure `materializeNpcCombatant(...)` behavior that maps one validated source
record plus its normalization overlay into a combat-engine-owned fight-creation
input. It must return typed readiness failures, preserve immutable inputs, avoid
calling `createFight`, avoid assigning session identity, and avoid applying
combat rules.

### NPC-160 - Close readiness for all 32 canonical NPCs

Populate the generated matrix for all 32 definitions and close every row as
automated or justified manual-only. Automated rows must have complete
materialization and stable references. Manual-only rows must have explicit
provenance and an audited reason.

Phase 1 exit evidence:

- generator parsing fixes have focused source-fidelity tests;
- all 32 canonical NPCs have readiness rows and explicit classifications;
- every automated NPC materializes without runtime prose parsing;
- the normalization overlay contains no unnecessary duplicate catalog data;
- no unknown move, item, transformation, race, or style reference reaches
  fight creation; and
- generated readiness and focused game-data/NPC tests pass.

## Phase 2 - Actor-correct decision contracts and package hardening

### NPC-200 - Make phase resolution actor-explicit

Resolve phases against the explicit requested NPC actor, never by inferring
“self” from `state.activeCombatantId`. The phase resolver must receive or
derive the actor from the request contract and must evaluate self/opponent
ratios and transformations relative to that actor.

### NPC-210 - Validate decision ownership

Validate that the requested actor exists, is the NPC represented by the
effective policy, and owns the current ordinary or pending decision. Reject
wrong-actor, completed-state, stale-state, and unsupported-pending requests
with typed failures before selection. The check must preserve the
combat-engine legal-decision boundary rather than recreate its legality rules.

### NPC-220 - Modularize the package by responsibility

Split the current public implementation into narrow internal responsibilities
for policy contracts and validation, phase resolution, priority compilation,
normalization/materialization, catalog assignment, and decision selection.
Preserve one intentional package-root export and do not expose implementation-
only helpers through deep imports.

### NPC-230 - Define the application-facing NPC decision request

Provide a platform-neutral request containing immutable fight state, explicit
actor identity, canonical NPC identity or a validated policy assignment,
mechanics view/version, AI randomness identity, work limits, and diagnostic
retention. Do not pass Discord, HTTP, persistence, or session objects into
`npc-ai`.

### NPC-240 - Preserve exact legal decisions and typed failures

Enumerate the legal decisions for the explicit actor through
`combat-engine`, pass the complete supplied set to `ai-engine`, and return the
exact selected legal object without manufacturing or normalizing a different
decision. Cover ordinary and pending decisions, including selection
cardinality and decline semantics supplied by the engine.

Account for completed state, wrong actor, missing assignment, invalid policy,
empty legal sets, descriptor drift, unsupported pending work, exhausted work
budgets, and AI-selection failures. Define which failures halt for diagnosis
and which may use the existing safe legal fallback. Never fabricate a pass,
surrender, victory, defeat, or pending response.

### NPC-250 - Isolate deterministic randomness and replay identity

Keep AI randomness isolated from live combat randomness. Applications or a
headless caller may supply the root seed, but NPC decision identity must derive
from stable fight, state-version, actor, policy, evaluator, and purpose inputs.
Repeated evaluation of the same identity must select the same action and must
not depend on legal-set iteration order.

### NPC-260 - Prove immutability and diagnostics retention invariants

Prove that selection does not mutate state, legal decisions, policy data, or
mechanics views. Retention level must not change the choice, replay identity,
random consumption, or failure behavior. Retained diagnostics must identify
the policy, phase, priorities, selected exact legal decision, and reason for
selection without becoming a live decision input.

Phase 2 exit evidence:

- phase resolution is actor-correct for ordinary and pending decisions;
- wrong-actor and stale requests fail before selection;
- package responsibilities and public exports are intentional;
- all successful selections return exact engine-enumerated legal objects;
- expected failures are typed and no fallback manufactures an outcome;
- deterministic AI randomness and replay identity are isolated from combat
  randomness; and
- immutability and diagnostic-retention invariants pass focused tests.

## Phase 3 - Authored NPC policy catalog

### NPC-300 - Freeze the initial supported policy contract

Refine and stabilize the existing `npc-ai-policy:v1` contract as the initial
supported version. Do not introduce `npc-ai-policy:v2` without a genuine
compatibility break that requires it. The v1 contract becomes stable when
Phase 2's request, actor, legal-decision, typed-failure, determinism, replay,
and retention invariants pass and the Phase 3 catalog validation closes.

Keep schema/version identifiers such as `npc-ai-policy:v1` distinct from
lowercase hyphenated policy and phase IDs. Existing example IDs remain
baseline facts until replaced by the authored catalog; stable catalog IDs
should use forms such as `npc-policy-balanced` and `phase-enraged`.

### NPC-310 - Establish reusable policy archetypes

Author a small catalog of reusable configuration archetypes, such as
balanced, aggressive, defensive, control, resource-conserving, elite, and
boss-quality, using completed `ai-engine` profiles. Archetypes are policy
configuration, not new scoring algorithms or combat rules.

Style may provide a weak mechanical/tactical baseline because a move set
naturally favors different choices. Style must not be treated as the complete
NPC personality or receive excessively strong weights that double-count its
mechanical strengths. The effective policy should conceptually combine:

```text
weak mechanical/style baseline
  + authored NPC personality
  + optional encounter or boss priorities
```

### NPC-320 - Assign exactly one effective policy

Create an exhaustive registry keyed by canonical NPC ID. Every automated NPC
must resolve to exactly one effective policy, including its archetype,
authored personality, optional authored NPC-specific personality overrides,
and any explicitly bounded encounter priorities. A
manual-only NPC must not receive an implicit automated policy. Reject unknown
NPCs, duplicate assignments, missing assignments, unknown mechanic IDs, and
assignments to manual-only definitions.

### NPC-330 - Validate authored behavior and provenance

Validate catalog data at the adapter boundary, using Zod for untrusted or
externally loaded values, with stable IDs, profile validity, modifier bounds,
duplicate priorities, known mechanics references, and contradictory or
unreachable declarations. Preserve typed validation issues.

NPC behavior is authored game design and may introduce deliberate personality
decisions even when legacy source prose does not state them. Require
provenance for authored decisions, such as `source-derived`, `npc-design`, or
`saga-boss-design`. Combat mechanics remain source/structure-authoritative;
personality must never be inferred automatically from descriptive prose.

### NPC-340 - Prove behavioral separation

Use acceptable outcome sets rather than brittle exact-choice assertions. Show
that representative archetypes and authored personalities express intended
preferences while every choice remains legal, affordable, deterministic under
fixed inputs, and evaluated by the same `ai-engine` pipeline. Verify that
style-derived baselines remain weak and do not hide stat or damage bonuses.

Phase 3 exit evidence:

- `npc-ai-policy:v1` is documented as the stable initial policy contract;
- every automated NPC has exactly one effective policy;
- policy and phase identities follow the lowercase-hyphenated convention;
- authored personality and priorities have explicit provenance;
- policies contain no combat callbacks, damage formulas, or source-text rules;
- catalog validation is exhaustive; and
- representative policies are behaviorally distinct without double-counted
  style bonuses or hidden combat bonuses.

## Phase 4 - Boss phases and tactical behavior

### NPC-400 - Define generic declarative phase conditions

Keep phase conditions state-based and declarative. The initial vocabulary may
use turn, self/opponent HP and Ki ratios, active transformation state, and
other facts available from authoritative immutable combat state. Add a
condition only when it is generically useful; never add a boss-name branch.

### NPC-410 - Define deterministic overlap and re-entry semantics

Document highest-priority matching, stable tie behavior, contradictory
conditions, phase re-entry, and whether a phase is a stateless policy view.
Prefer stateless state-derived phases. If a one-time phase affects later
outcomes, its lifecycle marker must be explicit combat-engine-owned state, not
hidden mutable state in `npc-ai` or an application.

### NPC-420 - Add bounded tactical priorities

Retain transformation timing, resource conservation, status pressure, and
aggression as bounded generic advisory priorities. Priorities may rank or
filter the supplied legal set but may never manufacture an action, calculate a
combat outcome, or require an ID-specific combat branch.

### NPC-430 - Certify synthetic phase behavior

Author and test synthetic two-phase and three-phase bosses. Cover threshold
boundaries, overlapping phases, phase re-entry, transformation state,
conservation and aggression priorities, status pressure, low-resource behavior,
ordinary actions, pending responses, terminal transitions, and deterministic
replay.

### NPC-440 - Keep canonical boss assignment out of this milestone

Do not require production canonical boss assignments to close Phase 4. A
canonical boss may remain manual-only or unassigned until its readiness and
policy rows are complete. Phase 4 proves the generic vocabulary and behavior;
Phase 5 certifies every automated catalog row.

Phase 4 exit evidence:

- phase conditions and overlaps are declarative, actor-correct, and
  deterministic;
- synthetic two-phase and three-phase bosses pass threshold and re-entry
  tests;
- phase behavior uses no hidden fight-local state;
- tactical priorities remain bounded advisory configuration; and
- no production canonical boss assignment is claimed merely because synthetic
  certification passed.

## Phase 5 - Autonomous certification, replay, telemetry, and safeguards

### NPC-500 - Drive autonomous headless NPC-vs-NPC fights

Build a headless certification driver or test boundary that constructs valid
NPC combatants, advances non-interactive engine work, obtains the current
actor's ordinary or pending legal decisions, asks `npc-ai` to choose, and
submits the exact decision through the real `combat-engine` transition
boundary. It must run NPC-versus-NPC fights without Discord, slash commands,
player presentation, application sessions, or production rollout.

The driver must run each fight until the combat engine reports completion or
an explicit external safeguard halts it. It must not replace engine
orchestration with copied combat rules.

### NPC-510 - Certify the full automated catalog

Run full-catalog smoke certification for every automated NPC. Cover
representative ordinary and pending decisions, items, transformations,
statuses, scarce HP/Ki/restricted uses, defeat, surrender, and completion.
Use mirrored starting positions where useful to detect first-actor or
position-dependent behavior. Classify failures by source readiness,
materialization, policy, AI, combat-engine, or certification-boundary cause.

### NPC-520 - Prove deterministic replay

Preserve root seed, derived NPC decision identities, rules/data/policy
versions, actor identity, phase identity, selected legal decisions, and the
relevant diagnostic record. Replaying the same autonomous fight must reproduce
the same legal decisions, random consumption, events, state transitions, and
combat-engine terminal result.

### NPC-530 - Add diagnostics and telemetry

Provide structured certification diagnostics and telemetry for policy and
phase selection, decision latency and work budget, fallback use, typed
failures, pending responses, replay capture, combat completion, and safeguard
halts. Telemetry must be observational only and must never affect live
decisions. Diagnostics must retain enough information to distinguish domain
combat completion from an external operational halt.

### NPC-540 - Define external safeguards and semantic no-progress detection

Support explicit maximum-turn, transition, and no-progress safeguards at the
headless/certification boundary. A safeguard halt is an operational result; it
must never manufacture a combat victory, defeat, or stalemate. The engine's
own terminal state and reason remain authoritative for domain completion.

When implementing semantic no-progress fingerprints, exclude non-semantic
churn such as timestamps, generated IDs, event IDs, transition counters, and
turn/history metadata that does not change tactical state. Include tactically
meaningful state such as HP, Ki, statuses, active effects, transformations,
available or restricted uses, pending work, and relevant scheduling or locks.
The exact fingerprint contract may be finalized during implementation, with
focused evidence for false-positive and false-negative boundaries.

### NPC-550 - Close NPC Intelligence Complete

Publish the final readiness and certification records, preserve representative
replays, and record the exact Simulation handoff inputs and exclusions.

Phase 5 exit evidence:

- every automated NPC can drive a complete headless NPC-vs-NPC fight through
  the real combat engine or halt through an explicit external safeguard;
- full-catalog certification covers ordinary and pending decisions, items,
  transformations, statuses, scarce resources, defeat, and completion;
- deterministic seed/replay behavior is proven;
- diagnostics and telemetry distinguish domain completion from operational
  halts without changing decisions;
- no-progress fingerprints ignore non-semantic churn and include meaningful
  tactical state;
- the generated readiness matrix has no unexplained automated or manual-only
  row;
- no copied combat rules exist in `npc-ai`; and
- all focused and final repository quality gates required by `AGENTS.md` pass.

This phase closes **NPC Intelligence Complete**. It does not close production
integration.

## Definition of complete

### NPC Intelligence Complete — roadmap finish and Simulation handoff

NPC Intelligence Complete means all of the following are evidenced:

- every canonical NPC is explicitly classified as automated or justified
  manual-only;
- every automated NPC can be materialized without runtime prose parsing;
- every automated NPC has exactly one effective policy;
- NPC decisions are actor-correct;
- ordinary and pending decisions work through the real combat-engine
  legal-decision boundary;
- boss phases and tactical priorities are deterministic and stateless unless
  combat-engine-owned state is explicitly required;
- deterministic AI seed and replay behavior is proven;
- every automated NPC can drive a complete headless NPC-vs-NPC fight through
  the real combat engine or halt through an explicit external safeguard;
- certification, diagnostics, and telemetry exist; and
- no copied combat rules exist in `npc-ai`.

This milestone does not require Discord session management, player-versus-NPC
interaction, live slash commands, player presentation, player handoff, or
production rollout. Those are later application integration work.

### NPC Production Integration Complete — deferred application milestone

This is a separate future milestone for a concrete application consumer. It
may include Discord/API orchestration, player-versus-NPC encounters, shadow
and allowlist rollout, all-certified rollout, staff controls, session
persistence and recovery, and platform rendering. It is not a prerequisite for
NPC Intelligence Complete and is not a dependency of the full Simulation
system.

## Future: NPC Production Integration

These are deliberately deferred until after NPC Intelligence Complete and may
be sequenced by the consuming application:

### NPC-600 - Add Discord/API orchestration when required

The preferred consumer path is:

```text
Discord/application
  -> npc-ai
  -> ai-engine
```

The application may also depend directly on `combat-engine` because it owns
authoritative fight orchestration and player action handoff. It should not
depend directly on `ai-engine` unless a concrete use case requires generic AI
profiles, and generic AI internals must not leak through the NPC abstraction.
No application may depend on another application.

### NPC-610 - Add player-versus-NPC encounters

Add player handoff, player legal-decision presentation, NPC-to-player turns,
and mixed encounter tests through application-owned orchestration. The
application translates structured domain results into platform responses; it
does not calculate combat rules or legality.

### NPC-620 - Add operational rollout controls

If production use requires it, add shadow evaluation, per-policy or per-NPC
allowlists, all-certified rollout, rollback, and staff take-over controls.
These controls must remain external operational behavior and must not alter
combat outcomes.

### NPC-630 - Add sessions, recovery, and platform rendering

Add channel/API session coordination, idempotency, stale-state protection,
optional persistence and recovery, staff diagnostics, slash commands,
components, and platform-specific rendering only when the application has a
concrete requirement. None is needed by Simulation.

## Simulation handoff gate

Full Simulation implementation may begin once NPC Intelligence Complete is
reached and its evidence is recorded. The handoff guarantees:

- autonomous deterministic NPC-versus-NPC execution through the real combat
  engine;
- reusable NPC policies with explicit classification and provenance;
- the simulation-quality AI path remains owned by `ai-engine`;
- Simulation may use generic AI profiles directly, or NPC policies when it is
  intentionally testing NPC behavior; and
- Simulation does not depend on Discord or application orchestration.

Simulation remains responsible for its own templates, scenarios, batch
execution, seed derivation, aggregation, reports, anomaly triage, and future
simulation-only variants. It may broaden beyond the active NPC local-1v1
scope only through its own combat-scope and engine-readiness decisions.

## Recommended implementation order

```text
Phase 0: scope, completion contracts, and accounting
  -> Phase 1: source normalization and runtime readiness
  -> Phase 2: actor-correct decision contracts and package hardening
  -> Phase 3: authored NPC policy catalog
  -> Phase 4: boss phases and tactical behavior
  -> Phase 5: autonomous certification, replay, telemetry, and safeguards
  -> NPC Intelligence Complete
  -> Simulation handoff
  -> Future NPC Production Integration, when an application requires it
```

The implementation resume point is **NPC-000**. Phase 2 must precede the
authored policy catalog and boss certification because actor ownership and
pending-decision correctness are foundational contracts. Production Discord
orchestration, player presentation, rollout controls, and session persistence
must not be treated as prerequisites for the Simulation handoff.

## Explicit non-goals

- changing or retraining the completed shared AI evaluator without evidence of
  a generic decision-quality defect;
- creating `npc-ai-policy:v2` without a genuine compatibility reason;
- full MCTS, reinforcement learning, or LLM-driven combat decisions;
- NPC-only combat rules, legality checks, damage calculations, or direct state
  mutation;
- parsing canonical prose at runtime or inferring personality from prose;
- treating fighting style as a complete NPC personality;
- permanently redefining the eventual encounter architecture as NPC-versus-
  NPC only;
- team fights, joint attacks, interferers, spectators, remote targets, or
  relationship-based targeting in the active local-1v1 scope;
- hidden boss stat bonuses presented as difficulty;
- Discord sessions, slash commands, components, player presentation,
  production rollout, or mandatory persistence before the future integration
  milestone requires them; and
- automatic balance or content-approval decisions.

## Architecture status

**Healthy with intelligence work incomplete.** The current dependency
direction and combat decision boundary are sound: `npc-ai` consumes
combat-engine legal decisions through `ai-engine` and does not resolve combat.
The verified remaining work is structured NPC readiness, normalization and
materialization, actor-correct contracts, exhaustive policy accounting,
authored behavior, generic boss phases, autonomous certification, diagnostics,
telemetry, and safeguards. The current application integration absence is
intentional deferred scope, not a blocker for the Simulation handoff.
