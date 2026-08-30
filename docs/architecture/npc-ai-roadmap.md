# NPC-AI completion roadmap

## Purpose

This document is the dependency-ordered implementation queue for turning the
completed `@dragonball-resurgence/ai-engine` and the existing
`@dragonball-resurgence/npc-ai` decision adapter into a production-ready NPC
combat system.

The shared AI decision pipeline is complete for `ai-combat-scope:v1`. This
roadmap does not reopen its evaluators or create a second combat runtime. It
finishes the NPC-owned work around runnable NPC definitions, policy assignment,
boss phases, application orchestration, diagnostics, and rollout.

Once implementation begins, create `npc-ai-progress.md` as the authoritative
handoff record. Generate `npc-ai-readiness-matrix.md` in Phase 1 and keep it as
the accounting record for NPC definition, policy, and runtime readiness. This
roadmap owns dependency order, not current implementation status.

## Current repository baseline

As of 2026-08-30:

- `@dragonball-resurgence/ai-engine` is complete for the verified local 1v1
  scope and exposes the canonical deterministic selector, diagnostics, replay,
  bounded reasoning, and consumer contracts.
- `@dragonball-resurgence/npc-ai` already validates versioned policies, resolves
  deterministic state-based boss phases, compiles four bounded tactical
  priority types, enumerates combat-engine legal decisions, and returns the
  exact legal decision selected by `ai-engine`.
- The NPC package includes representative normal-NPC and multi-phase-boss
  policies, but these are examples rather than a complete authored policy
  catalog.
- `game-data` contains 32 canonical NPC definitions. Four do not currently
  contain a resolved runnable HP value, nine contain at least one unresolved
  move name, two retain transformation information as source text, and thirteen
  list equipment by display name.
- No application currently depends on `npc-ai`. Both the Discord and API
  application entry points are placeholders, so there is no production NPC-turn
  loop, player-facing presentation, moderator control, or operational rollout.
- The active delivery scope remains local 1v1 combat. Allies, joint attacks,
  interferers, remote targets, and other exclusions recorded under
  `ai-combat-scope:v1` remain out of scope.

## Architecture and ownership

The completed system must preserve this transition path:

```text
game-data NPC definition -----> runnable combatant input
             |                           |
             v                           v
npc-ai policy registry              combat-engine
             |                           |
             +----> ai-engine <----------+
                         |
                         v
                 selected legal decision
                         |
                         v
              application orchestration
                         |
                         v
            combat-engine state transition
```

Ownership is fixed as follows:

- `game-data` owns static NPC identity, stats, moves, transformations, items,
  race/style references, and source traceability.
- `combat-engine` owns fight setup validation, legal decisions, every combat
  rule, state transitions, events, and terminal state.
- `ai-engine` owns generic decision quality, profiles, deterministic selection,
  lookahead, replay identity, and decision diagnostics.
- `npc-ai` owns the policy catalog, NPC-to-policy assignment, boss phase
  selection, tactical priorities, policy validation, and NPC-specific decision
  results.
- Applications own active sessions, authorization, clocks and timeouts,
  production seed allocation, repeated turn orchestration, user/moderator
  controls, and platform rendering.
- Persistence does not become a prerequisite. Fight or decision records are
  persisted only if recovery, moderation, or auditing requirements justify it.

Static NPC definitions must not import `npc-ai` types. The initial policy
assignment registry belongs in `npc-ai` and is keyed by stable `game-data` NPC
IDs. This avoids reversing the dependency direction merely to attach a policy
to a definition.

## Completion gates

### Runtime-ready definition gate

An NPC may enter an automated fight only when every combat-authoritative input
is structured and validated. Runtime code must never infer stats, moves,
transformations, equipment, or rules from `levelText`, `transformationText`,
`battleNotes`, source text, or display names.

An incomplete definition is rejected with typed readiness issues or remains an
explicitly audited manual-only NPC. It must not be silently approximated.

### Legal-transition gate

Every automated decision must be a member of the current
combat-engine-enumerated legal set and must be submitted through
`submitCombatDecision`. NPC code may not mutate `FightState`, manufacture a
pending response, or calculate an outcome.

### Boss-release gate

A boss is not production-ready merely because its policy validates. Every
phase must have deterministic entry conditions, an explicit priority order,
reachable transition evidence, safe overlap behavior, and end-to-end tests for
ordinary actions and pending responses.

### Production-release gate

The system is complete only when at least one application can start a supported
NPC fight, drive every NPC-owned decision boundary, expose typed failures to
staff, finish or safely halt the session, and reproduce a preserved decision
from recorded identity inputs.

## Phase 0 - Freeze scope and operating contracts

### NPC-000 - Declare the supported encounter scope

Record local 1v1 player-versus-NPC and NPC-versus-NPC as the only initial
encounter forms. Carry every `ai-combat-scope:v1` exclusion into NPC accounting
without reinterpretation.

### NPC-010 - Define production completion scenarios

Create representative acceptance scenarios for:

- a normal NPC using ordinary actions and moves;
- an NPC responding to every supported pending-decision category;
- an NPC using a transformation and item when legal;
- a multi-phase boss crossing overlapping HP and turn thresholds;
- a fight reaching defeat and surrender completion;
- an invalid or incomplete NPC definition;
- an exhausted AI work budget or typed selection failure; and
- deterministic replay of a preserved NPC decision.

### NPC-020 - Set stable identity and versioning rules

Define stable formats and owners for policy IDs, policy-catalog versions,
NPC-policy assignments, and boss phase IDs. Do not derive durable identity from
NPC names, catalog order, Discord users, or encounter position.

### NPC-030 - Create the progress record

Add `npc-ai-progress.md` with the closed scope, current phase, verified evidence,
known exclusions, and exact resume point.

Exit evidence:

- scope and non-goals are explicit;
- completion scenarios are approved;
- identity/version rules are documented; and
- the progress record points to Phase 1.

## Phase 1 - Close NPC definition readiness

### NPC-100 - Generate the readiness matrix

Generate one row per canonical NPC with at least:

- NPC ID and source reference;
- resolved HP, power, dexterity, and dexterity bonus status;
- race and style reference status;
- resolved and unresolved moves;
- transformation resolution status;
- item/equipment resolution status;
- assigned policy ID;
- automated, manual-only, or audited-excluded classification; and
- focused test evidence.

Validation must fail when the committed matrix is stale or an NPC is missing a
classification.

### NPC-110 - Define a runnable NPC combat profile

Extend `game-data` only as needed to represent combat-authoritative NPC inputs
declaratively. Prefer stable IDs and resolved numeric values while retaining
canonical source text solely for traceability.

The runnable profile should cover the subset required by
`CreateFightInput`: HP, power, dexterity and bonus, level when mechanically
needed, race/style, moves, transformations, items, and any already-supported
race traits or mastery data.

### NPC-120 - Resolve or exclude incomplete definitions

Resolve the four NPCs without runnable HP, the nine NPCs with unresolved move
names, and all required transformation/equipment references. If a canonical
mechanic remains outside active combat scope, record a versioned audited
exclusion and classify the NPC as manual-only or runnable with an explicitly
approved reduced loadout. Do not drop unresolved content silently.

### NPC-130 - Build the definition-to-combatant adapter

Add a pure adapter that maps one validated NPC definition into a
combat-engine-owned creation input. It returns typed readiness failures and
does not call `createFight`, assign session identity, parse source prose, or
apply combat rules.

### NPC-140 - Validate catalog integrity

Add public-boundary tests for complete mapping, unknown references, duplicate
IDs, invalid numeric values, unresolved required content, immutability, and
catalog-version drift.

Exit evidence:

- every one of the 32 NPCs has an explicit readiness classification;
- every automated NPC materializes without prose parsing;
- no unknown move, transformation, item, race, or style reference reaches
  fight creation; and
- the readiness matrix and focused game-data/NPC tests pass.

## Phase 2 - Build the authored NPC policy catalog

### NPC-200 - Modularize the NPC package by responsibility

Split the current single implementation module into narrow public contracts
and private policy validation, phase resolution, priority compilation, catalog,
and selection modules. Preserve one intentional package root export; do not
expose implementation-only helpers through deep imports.

### NPC-210 - Establish reusable policy archetypes

Author a small, versioned base catalog using completed `ai-engine` profiles,
such as balanced, aggressive, defensive, control, resource-conserving, elite,
and boss-quality. Archetypes are configuration, not new scoring algorithms.

### NPC-220 - Assign every runnable NPC a policy

Create an exhaustive `npc-ai` registry keyed by canonical NPC ID. Allow an NPC
to reference a shared archetype plus bounded NPC-specific priorities. Reject
unknown NPCs, duplicate assignments, missing runnable assignments, unknown
mechanics IDs, and assignments to audited manual-only definitions.

### NPC-230 - Strengthen policy validation

Validate unknown or externally loaded policy data with Zod at the adapter
boundary. Preserve typed validation issues and add checks for stable identity,
profile validity, modifier bounds, duplicate phase priorities, unknown move
references, contradictory thresholds, and unreachable phases.

### NPC-240 - Prove meaningful behavioral separation

Use sets of acceptable outcomes rather than brittle exact-choice assertions.
Show that representative archetypes produce intended preferences while every
choice remains legal, affordable, deterministic under fixed inputs, and based
on the same AI evaluator.

Exit evidence:

- every runnable NPC has exactly one effective policy;
- policies contain no combat callbacks, damage formulas, or source-text rules;
- catalog validation is exhaustive; and
- representative archetypes are behaviorally distinct without hidden bonuses.

## Phase 3 - Complete boss phases and scripted priorities

### NPC-300 - Make phase evaluation actor-explicit

Resolve phases against the NPC combatant identified by the request rather than
an implicit encounter position. Validate that the actor exists and is entitled
to the current decision, including pending-response boundaries.

### NPC-310 - Define the supported phase-condition vocabulary

Keep conditions declarative and state-based. The initial vocabulary may use
turn, self/opponent HP and Ki ratios, and active-transformation state. Add a
condition only when it is generically useful and can be evaluated from
authoritative immutable combat state.

### NPC-320 - Define deterministic overlap and lifecycle semantics

Document highest-priority matching, stable tie rejection, whether phases may be
re-entered, and whether a phase is a stateless policy view or requires explicit
combat state. Prefer stateless state-derived phases. If a future one-time phase
affects later outcomes, its lifecycle marker must be combat-engine-owned state,
not hidden mutable state in `npc-ai` or an application.

### NPC-330 - Expand bounded tactical priorities only from evidence

Retain transformation timing, signature conservation, status pressure, and
aggression as the initial surface. Add priorities only through typed generic
advisory modifiers. A script may rank or filter the supplied legal set but may
never manufacture an action or require an ID-specific combat branch.

### NPC-340 - Certify representative bosses

Author at least one two-phase and one three-phase boss policy. Test threshold
boundaries, overlapping phases, transformation state, low-resource behavior,
pending responses, terminal transitions, deterministic replay, and policy
fallback.

Exit evidence:

- phase selection is actor-correct and deterministic;
- all production boss phases are reachable or explicitly reserved;
- boss tests drive public combat transitions; and
- boss scripting contains no hidden fight-local state.

## Phase 4 - Harden NPC decision execution

### NPC-400 - Define the application-facing request

Provide a narrow request that accepts the immutable state, actor ID, NPC ID or
validated policy assignment, mechanics view/version, AI randomness identity,
work limits, and diagnostic retention. Avoid passing application, Discord, or
persistence objects into the package.

### NPC-410 - Derive production AI randomness reproducibly

Applications allocate the encounter root seed. NPC decision identity derives
from stable fight, state-version, actor, policy, evaluator, and purpose inputs
without consuming live combat randomness. Repeated evaluation of the same
identity must select the same action.

### NPC-420 - Complete typed failure and fallback behavior

Account for completed state, wrong actor, missing assignment, invalid policy,
empty legal set, descriptor drift, work-budget exhaustion, and AI selection
failure. Define which failures halt for staff review and which may use the
existing safe legal fallback. Never fabricate a pass or surrender decision.

### NPC-430 - Preserve diagnostics and replay identity

Return the selected exact legal object, policy and phase identity, applied
priorities, AI replay record, and optional ranking diagnostics. Retention level
must not change the choice or random consumption.

### NPC-440 - Prove immutability and legal-subset invariants

Test every legal and pending-decision discriminant, reordered equivalent legal
sets, input immutability, empty and completed states, repeated calls, and
parallel unrelated decisions.

Exit evidence:

- all NPC selection outcomes are reproducible;
- every success returns an exact engine-enumerated legal decision;
- all expected failures are typed; and
- diagnostics identify how and why a policy selected an action.

## Phase 5 - Integrate a production encounter loop

### NPC-500 - Implement application-owned NPC turn orchestration

In the first production application, add a loop that:

1. holds the authoritative current `FightState`;
2. advances engine-owned non-interactive work as required;
3. detects which combatant owns the current decision;
4. asks `npc-ai` for a decision only when that actor is NPC-controlled;
5. submits the exact returned decision through `submitCombatDecision`;
6. publishes structured combat events; and
7. stops on player input, completion, cancellation, typed failure, or an
   external safeguard.

The application may orchestrate these calls, but it must not duplicate phase,
legality, damage, pending-choice, or completion rules.

### NPC-510 - Add session control and safeguards

Provide bounded consecutive NPC decisions, cancellation, timeout, idempotency,
stale-state protection, and a no-progress/maximum-turn escalation path. These
are operational safeguards, not alternate combat outcomes.

### NPC-520 - Add player and moderator presentation

Render combat-engine events and NPC decision diagnostics separately. Normal
players receive appropriate combat events; staff diagnostics may include
policy, phase, factors, replay identity, and typed failure context. Domain
packages return no Discord markdown or HTTP response types.

### NPC-530 - Add application integration tests

Cover player-to-NPC handoff, NPC-to-player handoff, NPC pending responses,
multi-step free/reaction work, stale interaction rejection, cancellation,
completion, retries, and failure translation. Mocks must not recreate combat
calculations.

### NPC-540 - Add a second consumer only when required

After the first application proves the orchestration contract, add an API or
other consumer if there is a concrete product need. Reuse public package
contracts; do not make one application depend on another or extract a generic
orchestration service prematurely.

Exit evidence:

- a supported fight can be played from creation to completion against an NPC;
- all NPC decisions traverse the ordinary combat transition boundary;
- the loop safely yields for player decisions and halts on safeguards; and
- application tests contain no copied domain rules.

## Phase 6 - End-to-end certification and operations

### NPC-600 - Build the autonomous certification suite

Drive normal NPCs, each policy archetype, and every production boss through
seeded fights. Cover all supported decision and pending-decision categories,
items, transformations, status play, resource scarcity, defeat, and surrender.

### NPC-610 - Add catalog smoke tests

For every automated NPC, construct a valid fight, enumerate at least one legal
decision at each encountered boundary, and run until engine completion or an
explicit external cap. Classify failures by definition, policy, AI, combat, or
application ownership.

### NPC-620 - Establish operational telemetry

Record structured counts for policy/phase selection, decision latency and work
budget, fallback use, typed failures, fight completion, external safeguards,
and replay capture. Do not use telemetry as hidden input to live decisions.

### NPC-630 - Create staff debugging tools

Allow authorized staff to inspect the NPC definition, effective policy and
phase, ranked summary, selected decision, relevant combat events, and replay
identity. Redact platform or player information not required for diagnosis.

### NPC-640 - Run the extended quality gate

Because completing this system affects `game-data`, `npc-ai`, an application,
and public integration boundaries, run focused package checks throughout and
`npm run test:coverage` for game-rule, validation, Discord, or API behavior
changes. Finish the implementation workstream with exactly one
`npm run quality` from the repository root.

Exit evidence:

- all automated NPC rows are certified or explicitly blocked;
- deterministic replays reproduce preserved decisions;
- telemetry exposes failures without affecting decisions;
- required coverage and architecture checks pass; and
- the readiness matrix contains no unexplained row.

## Phase 7 - Staged release

### NPC-700 - Shadow evaluation

Run the NPC policy beside staff-controlled test encounters without submitting
its choices. Compare recommendations, inspect diagnostics, and preserve seeds
for surprising behavior.

### NPC-710 - Opt-in normal-NPC pilot

Enable a small set of fully ready normal NPCs behind application configuration.
Define rollback as disabling automated control while preserving ordinary manual
combat moderation.

### NPC-720 - Expand normal-NPC coverage

Promote additional NPCs only after their readiness and certification rows pass.
Do not make catalog-wide enablement the fallback for an unclassified NPC.

### NPC-730 - Boss pilot and general availability

Release certified bosses after normal encounter operations are stable. Review
phase telemetry and preserved replays before enabling the remaining boss
catalog.

Exit evidence:

- rollout is reversible per NPC or policy;
- every enabled NPC is backed by a passing readiness row;
- staff can diagnose and take over a failed encounter; and
- production safeguards and replay capture are exercised.

## Recommended implementation order

```text
Phase 0: scope and contracts
  -> Phase 1: runnable definitions and readiness matrix
  -> Phase 2: authored policy catalog
  -> Phase 3: boss phases
  -> Phase 4: hardened decision boundary
  -> Phase 5: application encounter loop
  -> Phase 6: certification and operations
  -> Phase 7: staged release
```

Phase 2 catalog scaffolding may begin after the Phase 1 matrix schema is fixed,
but NPC assignments cannot close until definition classifications are stable.
Application presentation may be prototyped during Phase 4, but production
integration must wait for the hardened failure and replay contracts.

The exact implementation resume point is **NPC-000**. The first vertical
milestone is one fully resolved normal NPC that passes Phases 1, 2, 4, and 5
end to end; broad catalog conversion should follow only after that path proves
the contracts.

## Explicit non-goals

- changing or retraining the completed shared AI evaluator without evidence of
  a generic decision-quality defect;
- full MCTS, reinforcement learning, or LLM-driven combat decisions;
- NPC-only combat rules, legality checks, damage calculations, or direct state
  mutation;
- parsing canonical prose at runtime;
- team fights, joint attacks, interferers, spectators, remote targets, or
  relationship-based targeting in the initial release;
- hidden boss stat bonuses presented as difficulty;
- mandatory combat-session persistence before recovery requirements exist;
- a new application-to-application dependency or speculative orchestration
  framework; and
- automatic balance or content-approval decisions.

## Architecture status

**Healthy with an incomplete production adapter.** The package dependency
direction and decision boundary are sound: the existing NPC adapter consumes
engine legal decisions through `ai-engine` and does not resolve combat. The
remaining risks are incomplete structured NPC data, the absence of exhaustive
policy assignment, and the absence of an application encounter loop. The
roadmap closes those gaps without relocating rules or adding a new engine.
