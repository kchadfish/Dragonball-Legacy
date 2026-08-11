# Combat-engine completion roadmap

## Purpose

This document is the dependency-ordered implementation queue for completing
the active `@dragonball-resurgence/combat-engine` delivery scope. It translates
the contracts in [ARCHITECTURE.md](../../ARCHITECTURE.md) into bounded capability
slices without duplicating the current implementation record in
[combat-engine-progress.md](combat-engine-progress.md).

The progress record is authoritative for what is implemented and the exact
resume point. The generated
[combat capability matrix](combat-engine-capability-matrix.md) is the catalog
accounting record. If either disagrees with this roadmap, update this roadmap
from verified implementation evidence rather than treating an old phase entry
as authoritative.

## Scope and authority

The active scope remains deterministic, versioned, invariant-checked combat for
converted non-spaceship mechanics. Transformation work remains limited to
Humans, Saiyans, Hybrid-Saiyans, Namekians, Changelings, and Bio-Androids.
Multiplayer, remote-target, narrative, administrator-mediated, identity
mutation, and spaceship mechanics remain outside the delivery scope unless an
explicit decision widens it.

Canonical rules, accepted normalization decisions, accepted ADRs, and
`ARCHITECTURE.md` govern behavior. This roadmap chooses implementation order; it
does not create game rulings or override architecture.

## Working method

A normal implementation slice should deliver one bounded generic capability.
Treat that as a sizing heuristic, not a prohibition on tightly coupled contract,
runtime, invariant, event, legal-decision, or consumer changes needed to make
the capability complete.

For each slice:

1. Read `AGENTS.md`, `ARCHITECTURE.md`, the progress record, this roadmap, and
   the current capability matrix.
2. Confirm the exact resume point and prerequisites against the worktree.
3. Implement the smallest generic capability that closes the selected matrix
   variants without adding definition-ID branches.
4. Update compilation or validation, runtime execution, serializable state,
   invariants, events, legal decisions, and public-behavior tests wherever the
   capability requires them.
5. Regenerate the matrix and update the progress record with verified coverage,
   remaining variants, and the exact next resume point.
6. Run focused checks during implementation, then run the single repository
   handoff gate `npm run quality`. Do not run `npm run check` separately first;
   `quality` already invokes it before coverage, duplication detection, and the
   production dependency audit.

A capability is complete only for the exact variants its compiler accepts and
its public-behavior tests cover. Support for one definition, or an executor
registered only by effect discriminant, does not prove support for every
trigger, condition, target, selection, scope, duration, or numeric form in that
effect family.

## Capability accounting

Every converted effect occurrence must have one of these statuses:

- `supported-generic`: a generic executor compiles the exact variant and has
  focused public-behavior coverage.
- `supported-named`: a registered, deterministic named executor is justified,
  compiled, and covered by a definition-specific regression test.
- `unsupported-in-scope`: the mechanic belongs to the active delivery scope but
  lacks a complete executor; record its reason and prerequisite capability.
- `audited-out-of-scope`: an approved, versioned exclusion such as narrative,
  administrator-mediated, multiplayer, or spaceship behavior.

A named executor is executable support, not an audited exclusion. An unfinished
in-scope mechanic must never be relabeled out of scope merely to pass a gate.
Source ambiguity should remain `unsupported-in-scope` with a `needs-ruling`
reason until an authoritative decision exists.

The matrix must report individual occurrences or equivalently precise
capability variants. Aggregated effect-family summaries are useful for
prioritization, but cannot establish support on their own.

Two distinct validation stages apply:

1. **Accounting gate:** passes when every converted occurrence has a valid
   status, provenance, reason, and capability or exclusion reference.
   `unsupported-in-scope` is allowed.
2. **Catalog-closure gate:** passes only when the active scope contains no
   `unsupported-in-scope` or unresolved `needs-ruling` occurrences.

This separation keeps early infrastructure usable without disguising unfinished
mechanics or making normal repository checks impossible until catalog closure.

## Dependency-ordered queue

### Phase 0 — Close the existing partial slice

#### CE-000 — Prevent roll modification

Status: complete for the variants recorded in the progress document. Keep
unsupported triggers and roll forms visible in the matrix rather than treating
the entire effect family as complete.

### Phase 1 — Make work mechanically discoverable

#### CE-100 — Precise capability matrix

Replace effect-type-only support inference with occurrence- or variant-level
classification. Record source definition, origin, effect index, trigger,
conditions, target and selection, scope, duration, numeric forms, capability
ID, status, reason, prerequisite, and focused coverage.

The generated report must summarize unsupported variants by prerequisite,
occurrence count, and distinct definition count so the next slice can be chosen
without repeating catalog archaeology.

#### CE-110 — Typed compiled effect plan

Introduce compilation between converted game data and runtime resolution.
Compilation may normalize structured definitions, but must not execute rules,
mutate fight state, or infer behavior from source prose.

Reject unsupported executable types or variants, unresolved executable numeric
expressions, ambiguous target or selection semantics, and unsupported
scope-duration combinations. Compilation errors must identify the source
definition and effect occurrence.

Do not freeze one speculative universal `CompiledEffect` shape before
representative variants prove it. Use a discriminated compiled plan whose
members preserve the information required by their owning executor.

#### CE-120 — Exhaustive executor registry

Create typed accounting for every in-scope executable effect discriminant.
Each registered executor validates supported definition variants, compiles them,
and executes them through an explicit resolution context. Adding a new
executable discriminant without deliberate registry accounting must fail type
checking.

Registration by discriminant is necessary but not sufficient: variant
validation determines whether an individual occurrence is supported.

#### CE-130 — Catalog accounting gate

Make unclassified converted effects fail validation. Allow explicitly recorded
`unsupported-in-scope` occurrences while the engine is under construction;
runtime compilation must still reject attempts to execute them. Reserve the
zero-unsupported requirement for Phase 11.

Phase 1 exit criteria:

- Every converted structured occurrence is classified.
- Supported rows identify a compiling executor and focused coverage.
- Unsupported rows identify a reason and prerequisite.
- Out-of-scope rows identify an approved exclusion category.
- The progress record names the highest-priority ready capability.

### Phase 2 — Normalize executable data semantics

#### CE-200 — Selection semantics

Represent required versus optional choice and one, up-to-N, or all-eligible
selection directly in game data. Do not infer selection from `sourceText` or
display prose.

#### CE-210 — Mechanical classification

Replace executable substring checks and prose-derived constant, activation,
deactivation, or optionality behavior with typed fields or selectors.

#### CE-220 — Cost and timing semantics

Represent when executable costs and effects occur, including declaration,
activation, pre-roll, post-resolution, and per-selected-target timing where
source-backed.

#### CE-230 — Stacking and conflict semantics

Represent stack, replace, refresh, highest or lowest, uniqueness, and mutual
exclusion policies explicitly. Do not invent a default merely to compile an
ambiguous definition.

### Phase 3 — Complete triggers and conditions

#### CE-300 — Unified trigger dispatch

Route supported combat points through one trigger-dispatch model rather than
letting individual move resolvers independently scan definitions.

#### CE-310 — Durable-state conditions

Complete conditions resolvable from `FightState`, including resources, stats,
statuses, transformations, movesets, use counts, combat mode and turn, active
effects, and action history.

#### CE-320 — Resolution-local conditions

Complete conditions based on the current roll, hit count, damage, cost,
defense response, resource change, or combat result.

#### CE-330 — Stored-context conditions

Persist earlier rolls, selected moves or targets, action sequences, and deferred
values in the resolution frame or active effect that owns them. Never rebuild
authoritative context from display events.

#### CE-340 — Condition exhaustiveness

Make an unaccounted in-scope condition discriminant a type-check or validation
failure while retaining variant-level unsupported reporting during development.

### Phase 4 — Targets, selectors, and player choices

#### CE-400 — Common target resolution

Resolve structured candidates for self, opponent, participants, source-effect
targets, moves, and active effects. Candidate resolution must not silently make
a player-owned choice.

#### CE-410 — Shared selector matching

Use one selector matcher across compiler and runtime paths. Remove text-based
equivalents only after the structured dimensions they represent are supported.

#### CE-420 — Generic pending selection

Persist candidate IDs and required selection cardinality in a versioned pending
decision. Validate replies against the exact offered candidates rather than
recalculating them from later state.

#### CE-430 — Deterministic resume

Resume the suspended compiled operation without rerolling, rescanning prose,
changing eligibility, or losing effect ordering.

### Phase 5 — Unified active-effect lifecycle

#### CE-500 — Common lifecycle metadata

Centralize source, target, activation point, scope, duration, remaining uses,
cooldown, stacking policy, lifecycle state, selector, and activation cost where
the mechanic requires them. Specialized payloads may remain discriminated.

#### CE-510 — Duration engine

Complete matrix-reported combat, turn, use, next-action, next-roll, threshold,
perfect-roll, resource, combat-result, and turn-start-roll duration variants
with deterministic ordering.

#### CE-520 — Uses, limits, and cooldowns

Unify restricted uses, effect-local limits, activation limits, per-combat
counts, cooldowns, and reactivation availability.

#### CE-530 — Stacking and reactivation

Execute the structured policies established in CE-230.

#### CE-540 — Prevention and negation lifecycle

Bring action locks, move-use, status, combat-result, roll-modification,
resolution, suppression, and future prevention families through the shared
lifecycle model.

### Phase 6 — Calculation and roll precedence

Implement the architectural precedence model—prevention or negation,
replacement or substitution, set, multiplicative, additive, then caps or
floors—through explicit calculation stages.

- CE-600: reusable calculation result and trace model.
- CE-610: Ki and resource costs.
- CE-620: damage and damage prevention.
- CE-630: roll definitions and die sides.
- CE-640: natural and final roll results.
- CE-650: rerolls, die selection, stored rolls, and replay.
- CE-660: successful, stopped, blocked, critical, counter, and related result
  classification.

After these primitives exist, audit Close Shave, Second Chance, Energy
Redirection, Heroic Tunic, Death Beam, and any other named paths. Migrate each
to generic capabilities or register and justify a tested named executor.

### Phase 7 — Fight-flow scheduling

- CE-700: serializable immediate, end-of-action, next-upkeep, and delayed work.
- CE-710: extra-action scheduling and ownership.
- CE-720: counter scheduling with the configured chain safeguard.
- CE-730: skips, forced categories, fallback attacks, passes, and locks.
- CE-740: defense responses and contests through suspended frames.
- CE-750: combat-result changes through normal defeat and completion handling.

Effects request scheduled operations; they do not directly manipulate phases.

### Phase 8 — Items through the shared executor

- CE-800: compile combat-executable item effects through the shared registry.
- CE-810: action use, free use, costs, restrictions, and use counts.
- CE-820: persistent item-created roll, damage, resource, status, prevention,
  and lifecycle effects.
- CE-830: explicit audited exclusions for noncombat item rules.

Items must not grow a parallel combat runtime.

### Phase 9 — Transformation and race closure

- CE-900: audit activation, cost, stat and resource changes, baseline retention,
  reversion, defeat, and lifecycle behavior for the six-family scope.
- CE-910: execute only structured transformation mechanics; retain source-text-
  only abilities as unsupported until converted.
- CE-920: classify each in-scope race and class combat rule as supported,
  unsupported, noncombat, narrative or administrator-mediated, or deferred.

### Phase 10 — Explicit scope boundary

- CE-1000: classify multiplayer, ally, interferer, and spectator mechanics.
- CE-1010: classify remote and relationship targets.
- CE-1020: keep body swap and identity mutation separate from stat swapping.
- CE-1030: retain spaceship mechanics outside this delivery scope unless
  explicitly approved.

Excluded mechanics must remain visible in the matrix with approved reasons.

### Phase 11 — Catalog closure

#### CE-1100 — Zero unexplained in-scope definitions

Every in-scope converted effect must be tested generic support or tested named
support. Every exclusion must be approved and versioned. No
`unsupported-in-scope`, `needs-ruling`, or unclassified executable occurrence
may remain.

#### CE-1110 — Capability regressions

Cover each executor capability through public combat boundaries. Give every
justified named executor its own regression test.

#### CE-1120 — Deterministic replay

Prove representative suspended and resumed fights reproduce legal decisions,
random consumption, rolls, resources, active effects, events, and outcomes.

#### CE-1130 — Full-fight scenarios

Cover a small representative set combining attacks, blocks, reactions,
statuses, items, transformations, counters, expiry, and terminal defeat.

#### CE-1140 — Final closure gate

Regenerate the capability matrix, pass its zero-unsupported closure validation,
and run `npm run quality` as the single repository gate. It includes
`npm run check`, coverage, duplication detection, and the production dependency
audit; do not run those constituent commands separately beforehand.

## Priority heuristic

Within the earliest phase whose prerequisites are satisfied, prefer:

1. a partially completed capability whose unfinished state creates drift;
2. a prerequisite shared by multiple unsupported capabilities;
3. the unsupported variant affecting the most converted occurrences;
4. the variant affecting the most distinct definitions;
5. the option requiring the least speculative new state shape.

This is a heuristic, not an automatic ruling. Source ambiguity, architectural
risk, tightly coupled work, and newly discovered prerequisites may justify a
different choice. Record that reason in the progress document.

## Definition of complete

The active combat-engine delivery scope is complete only when:

- converted in-scope definitions compile into validated typed plans;
- executable discriminants and their variants have deliberate executor
  accounting;
- the capability matrix has no unexplained or unsupported in-scope occurrence;
- runtime outcomes never depend on source or display prose;
- player choices and future-relevant values are persisted in authoritative
  versioned fight state;
- active effects and suspended work are invariant-checked and replay-safe;
- conflicting calculations use the declared precedence model;
- named executors are rare, justified, registered, and tested;
- the six approved transformation families have been audited;
- excluded multiplayer, spaceship, narrative, administrator, and identity
  mechanics are explicit rather than approximated; and
- focused capability tests and the required repository verification pass.
