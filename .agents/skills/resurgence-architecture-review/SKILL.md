---
name: resurgence-architecture-review
description: >-
  Review Dragonball Resurgence changes and proposals for compliance with
  ARCHITECTURE.md. Use when the user requests an architecture audit or when a
  change materially affects package boundaries, dependency direction, domain
  ownership, public exports, deterministic state, declarative game rules, or
  static, permanent, and combat-state separation. Also use to evaluate the
  architecture of a major refactor plan. Do not use for ordinary code review,
  style-only refactoring, or routine combat and game-data work unless an
  architectural contract or boundary is meaningfully in scope.
---

# Dragonball Resurgence Architecture Review

Review architecture against the repository's current documented contract.
Prefer evidence-backed findings and the smallest justified correction. Do not
maximize abstraction or redesign valid architecture for stylistic preference.

## Establish scope and authority

1. Read the repository-root `AGENTS.md` and the sections of `ARCHITECTURE.md`
   relevant to the review. Read `ARCHITECTURE.md` completely for a repository-
   wide review or major architectural refactor.
2. Identify the exact files, diff, package, feature, pull request, or proposal
   under review. Determine the comparison base when reviewing a change.
3. Inspect affected package manifests, public exports, callers, consumers, and
   tests when ownership or contracts are relevant.
4. Distinguish problems introduced by the change from pre-existing debt and
   optional improvements. Do not attribute existing problems to the change.
5. Distinguish implemented architecture from planned packages and intentionally
   deferred scope. Do not require planned components to exist.
6. Keep a focused review within the requested scope unless evidence shows that
   a changed public contract has additional affected consumers.

Treat `ARCHITECTURE.md` as the primary architectural contract. Derive current
package ownership and allowed dependency directions from it instead of relying
on a duplicated package graph in this skill. When implementation and
documentation disagree, report the disagreement without silently assuming
which side should change.

## Review ownership and dependencies

For each significant concept, ask which package is authoritative for it and
whether the implementation agrees with the ownership documented in
`ARCHITECTURE.md`.

Flag evidence that:

- multiple packages independently own the same rule;
- an application reimplements domain logic;
- infrastructure becomes authoritative for domain state;
- a domain concept is moved into `shared` merely to avoid dependency design;
- a package imports an application, one application imports another, or an
  internal dependency cycle is introduced;
- a dependency is added for convenience despite unrelated ownership; or
- dependency inversion hides a cycle without establishing a legitimate owner.

When consumers need the same concept, keep it with its rightful owner and use
that owner's public contract. Extract only genuinely technology-neutral
primitives. Recommend a narrow contract package only when ownership cannot
reasonably belong to either consumer.

For planned packages such as those currently marked planned in
`ARCHITECTURE.md`, evaluate proposals against the documented future direction
without treating the dependency as present or mandatory in current code.

## Review public and technology boundaries

Require cross-package imports to use intentional
`@dragonball-resurgence/*` public exports. Inspect `package.json` exports when
relevant. Flag cross-package relative imports, another package's `src/` paths,
unsupported deep imports, accidental implementation exposure, and consumers
coupled to internals.

Keep domain packages platform-neutral. Flag direct dependencies on Discord,
HTTP frameworks, ProBoards parsing, databases, filesystems, authentication,
platform rendering, or application response types. Applications and adapters
may translate platform inputs into domain inputs and structured domain results
into platform output; they must not make platform-specific strings or response
objects part of the domain contract.

## Review game rules and declarative data

Keep static game definitions declarative and executable rules in the package
that owns their interpretation.

Flag:

- callbacks such as `onHit`, `calculateDamage`, `resolveEffect`, or
  `canActivate` embedded in `game-data` definitions;
- runtime source-text parsing or tags used as hidden executable instructions;
- engine branches tied to specific move, item, status, or transformation IDs;
- the same executable rule implemented in multiple packages; or
- applications, AI, or persistence deriving outcomes that belong to a domain
  engine.

Distinguish executable duplication from declarative configuration, test
fixtures, and coincidentally similar code. Consolidate only rules with the same
semantics and one clear owner.

For combat effects, determine whether the change is a reusable mechanic or a
new definition using an existing mechanic. Prefer extending the appropriate
generic trigger, condition, selector, pending-choice, lifecycle, mutation,
roll, or scheduling capability. Do not recommend a generic abstraction when
the behavior is genuinely local.

## Review state, determinism, and identity

Verify that the implementation preserves the distinctions documented in
`ARCHITECTURE.md` among static definitions, permanent player records, and
temporary combat state.

Flag:

- static definitions mutated during execution;
- temporary combat effects stored as permanent player state;
- persistence records used as hidden live rule state;
- information needed to resume a decision boundary stored outside
  authoritative domain state;
- direct `Math.random()`, outcome-relevant wall-clock reads, hidden mutable
  singletons, I/O during deterministic transitions, or replay paths that
  consume different randomness; and
- durable identity derived from array position, display labels, usernames,
  presentation order, or unvalidated external input.

Applications may hold an authoritative `combat-engine` `FightState` in memory
as permitted by `ARCHITECTURE.md`. Do not flag that arrangement by itself.
Instead, flag continuation data that affects later resolution but is hidden
outside `FightState`, or mutations that bypass combat-engine operations.

Require randomness, time, and generated identifiers to be injected when they
affect outcomes. A replay from the same authoritative state and deterministic
dependencies should resolve identically.

## Review transitions, contracts, and invariants

For combat changes, verify that applications, AI, NPC behavior, and simulations
drive the normal public combat-engine transition boundary. Flag alternate paths
that mutate fight state directly, bypass legal-decision validation or
invariants, calculate combat outcomes elsewhere, or submit actions the engine
did not declare legal.

Require future-relevant state such as pending choices, persisted rolls,
selected targets, active effects, durations, use counts, cooldowns, resolution
frames, and forced actions to be explicit in authoritative state when the
mechanic needs them. Events may describe outcomes but must not be the only
source for reconstructing unresolved work.

Check whether a new concept needs a contract extension, schema validation,
stable ID, explicit lifecycle, invariant, or serialized continuation state.
Report a contract weakness only when it permits a concrete invalid state, stale
reference, invalid lifecycle, unresolved completed fight, or validation bypass.
Do not advocate type complexity without a demonstrated risk.

## Review abstractions, modules, and tests

Before recommending extraction, determine whether the concept is actually
shared, has one stable meaning, clarifies ownership, reduces semantic
duplication, or improves testability and extension. Avoid miscellaneous shared
utilities, generic manager packages, premature plugin systems, unnecessary
service layers, and single-implementation interfaces without boundary value.

Do not use file size alone as evidence of poor architecture. Flag a module when
it owns multiple unrelated reasons for change, and name the exact stable
responsibility a proposed module would own.

Use tests as architectural evidence. Check for deep imports in tests, behavior
tested only through private helpers, duplicated application expectations,
nondeterministic domain tests, and missing regression protection for important
boundaries. Prefer public-boundary tests for cross-component behavior without
duplicating the same rule test at every layer.

## Classify and rank findings

Classify each item as:

- **Critical violation**: Breaks an explicit rule or creates a correctness,
  determinism, ownership, or dependency failure.
- **Significant risk**: Creates a credible path to coupling, duplication,
  hidden state, or architectural drift.
- **Improvement opportunity**: Preserves valid architecture but can become
  clearer, simpler, or easier to extend.
- **No action**: Is acceptable or offers insufficient benefit to change.

Rank actionable findings by consequence: correctness, divergent rule
implementations, hidden coupling, cycle risk, testing difficulty, deferred
migration cost, extension cost, and likelihood that the pattern will spread.
Do not inflate preferences into violations.

For each actionable finding:

1. State the architectural problem and severity.
2. Cite concrete file-and-line evidence.
3. Explain the consequence and correct owner.
4. Recommend the smallest correction.
5. Identify affected callers, consumers, contracts, or migration steps.

Avoid speculative infrastructure such as microservices, event buses, queues,
caches, distributed persistence, or new frameworks without a demonstrated
requirement.

## Report the review

Return findings in descending severity. For each finding include:

- **Finding**
- **Severity**
- **Evidence**
- **Why it matters**
- **Recommended correction**

Then report:

### Architecture status

Choose one:

- Healthy
- Healthy with minor drift
- Moderate architectural debt
- Significant architectural risk

### Strong patterns worth preserving

Identify only architectural choices supported by evidence.

### Recommended next actions

List only concrete actions justified by the findings. If no meaningful issue is
found, say so clearly and do not manufacture work.

## Keep fixes opt-in

For review-only requests, inspect, explain, and recommend without modifying the
repository. When the user also requests fixes, implement the smallest approved
correction and follow the repository-root `AGENTS.md` quality gates.

Also use `resurgence-combat-change` when implementing or changing combat-owned
behavior or public contracts. Also use `resurgence-convert-game-data` when
transcribing, auditing, repairing, or extending canonical static game
definitions. Apply both when a declarative capability and its combat runtime
consumer must change.
