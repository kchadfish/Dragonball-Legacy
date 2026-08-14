# Combat-engine implementation progress

## Purpose

This is the versioned handoff record for the in-progress
`@dragonball-resurgence/combat-engine`. It records verified implementation
state and the next executable work, rather than restating the intended
architecture. The target architecture is in
[ARCHITECTURE.md](../../ARCHITECTURE.md); the original data baseline is in
[combat-engine-baseline.md](combat-engine-baseline.md); and the dependency-
ordered implementation queue is in
[combat-engine-roadmap.md](combat-engine-roadmap.md).

Update this record whenever an engine capability is added, removed, or found
to be incomplete. Once CE-100 is complete, the generated capability matrix
should replace the manual coverage table below as the authoritative
per-occurrence record.

## Active delivery scope

The requested scope is deterministic, versioned, invariant-checked combat for
converted non-spaceship mechanics. Transformation support is intentionally
limited to Humans, Saiyans, Hybrid-Saiyans, Namekians, Changelings, and
Bio-Androids. Do not widen transformation families without an explicit scope
decision.

The converted catalog is data-complete, but it is **not** equivalent to engine
complete. The current inventory has 499 moves and 838 move effects across 46
effect types. It also has 162 items, with 282 item effects; 102 item rules are
explicitly non-executable narrative or administrator rules. Full catalog
support therefore requires validated generic or named executor coverage for
each in-scope occurrence, not merely a parsed definition. Approved out-of-scope
occurrences require an explicit audited exclusion.

## Implemented foundations

The following behaviors are present in the worktree and have focused tests:

- Pure fight creation and decision transitions with injected IDs, clock, and
  random source; state versions advance on accepted transitions.
- Serializable fight state, pending decisions, resolution frames, action
  history, active effects, statuses, transformations, move-use counts, and
  structured factual events.
- Invariant validation for resource bounds, references held by active effects,
  combatant state, and suspended work.
- Legal-decision enumeration and rejection of stale, wrong-phase, invalid,
  unavailable, exhausted, or otherwise illegal submissions.
- Turn lifecycle, passing, power-up, surrender, moderator cancellation,
  terminal fight detection, deterministic initiative tie-breaking, and counter
  chain safeguards.
- Basic attacks; converted attack rolls; multi-die success and damage handling;
  criticals; defense responses; blocks; restricted move uses; Ki costs; and
  source-expression rejection where a resolver is not yet available.
- A serializable suspension/resume path for post-roll reactions. It covers
  optional reaction decisions, deterministic replay-safe rolls, and the
  currently implemented Heroic Tunic, Close Shave, Energy Redirection, and
  Second Chance paths.
- Status lifecycle and action consequences for BREAK, SEVER, STUN, and
  PETRIFIED, including expiry and prevention of actions where applicable.
- Declarative effect evaluation for the implemented trigger paths, including
  typed conditions, resource changes, damage and cost modifiers, roll changes,
  status application, forced actions, locks, move-use/status prevention, and
  active-effect lifecycle handling.
- Lock enforcement in legal-decision enumeration, direct submissions, and
  blocks. Implemented durations include combat, turns, roll threshold,
  resource threshold, combat result, and deterministic turn-start-roll
  threshold expiry.
- Constant-skill deactivation flow: selector-based active-constant candidates,
  deterministic pending `select-move` choices, validation of replies, event
  emission, deactivation lifecycle state, and stale/illegal reply rejection.
- Combat item passives and the currently supported item resource, roll, and
  next-attack damage effects.
- Transformation activation, stat application, and reversion for the six
  approved race families. Transformation abilities themselves remain
  source-text-only game data and are not automatically supported.

## Focused test evidence

The combat-engine test suite currently contains focused coverage for the
following public behaviors:

| Area                                         | Focused test module                                                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Contracts, IDs, and state invariants         | `contracts.test.ts`, `create-fight.test.ts`                                                           |
| Fight creation and turn progression          | `create-fight.test.ts`, `progress-fight.test.ts`                                                      |
| Basic and converted move attacks             | `basic-attack.test.ts`, `move-attacks.test.ts`, `death-beam.test.ts`                                  |
| Rolls, damage, blocks, and generic mechanics | `attack-rolls.test.ts`, `basic-attack.test.ts`, `block-mechanics.test.ts`, `combat-mechanics.test.ts` |
| Declarative move effects and reactions       | `declarative-runtime.test.ts`, `move-effects-runtime.test.ts`, `deactivation-flow.test.ts`            |
| Items                                        | `item-effects-runtime.test.ts`                                                                        |
| Transformations                              | `transformation-runtime.test.ts`, `transformation-activation.test.ts`                                 |
| Deterministic test dependencies              | `testing/index.test.ts`                                                                               |

Run focused tests for the module being changed during development. Do not use a
passing focused test as evidence that unsupported catalog definitions work.

## Remaining roadmap

The engine is not ready to be declared complete. The dependency-ordered queue
is maintained in [combat-engine-roadmap.md](combat-engine-roadmap.md). Its major
stages are precise catalog accounting and compilation, executable data
normalization, trigger and condition coverage, targets and pending choices,
active-effect lifecycle, calculation precedence, fight-flow scheduling, shared
item execution, transformation and race closure, explicit scope classification,
and final catalog closure.

The roadmap distinguishes tested generic support, tested named support,
unfinished in-scope mechanics, and approved out-of-scope exclusions. Do not use
an audited exclusion to hide unfinished in-scope work, and do not treat an
effect-type-level executor registration as proof that every variant is
supported.

## Immediate resume point

### Latest implementation slice (2026-08-11)

This work added the following verified, generic pieces. They are partial
catalog coverage, not a completion claim.

- Active constants now retain a durable `active`/`deactivated` lifecycle.
  A normal activation can reactivate its deactivated instance; optional
  deactivation choices are represented by a pending decision and validated at
  the submission boundary.
- `prevent-move-use` is persisted and enforced for use, activation, and
  deactivation operations in legal-decision enumeration and direct
  submission. `prevent-status` is persisted before a status application and
  expires correctly on owner turns.
- `prevent-resolution: block` is extracted from passive effects and removes
  only Block options from a defense request; normal defense rolling and item
  responses remain available.
- `prevent-combat-result` is persisted with declared duration and selector.
  Critical damage and counter flow are suppressed before resolution for both
  basic attacks and converted attacks.
- Before-attack roll support now extracts `modify-roll`,
  `set-roll-definition`, and `set-roll-result`. Numeric roll-result
  substitutions are serializable and survive post-defense reaction replay.
- `prevent-roll-modification` now has an explicit durable active-effect
  contract, activation mapping, invariant validation, owner-turn,
  roll-threshold, combat-result, turn-start-threshold, and counted
  `next-actions` lifecycle handling. Enforcement runs before active and
  same-action attack/defense result and side modifiers, current roll-definition
  and numeric result replacements, and replayed post-defense rolls. Selectors,
  passive CONSTANT-skill prevention, opponent-source filtering, and the
  converted source-effect exemption are preserved. The catalog's upkeep-only
  Speed Demon path remains an audited unsupported trigger because its paired
  dice-definition and Dexterity mechanics are not executable yet.
- The catalog audit (`npm run report:combat-mechanics`) identified
  `modify-roll` as the highest-volume generic move effect (131 definitions).
  This tranche extends the durable generic capability to successful-move and
  action-triggered combat, `next-action`, `following-action`, counted
  `next-actions`, `next-roll`, and counted `next-rolls` attack/defense result
  and side modifiers, preserving selectors and consuming only matching rolls.
  Active defense-side modifiers now share the injected roll pipeline. Other
  roll kinds, dice selection, multipliers, caps, current-action and
  turn/phase/resource-bound triggers remain explicitly unsupported.
- `modify-damage` now has a generic `damage-modifier.v1` slice for durable
  `next-action`, counted `next-actions`, and `following-action` effects, plus
  durable-state `passive`/`current-action` and `before-attack-roll` damage
  adjustments. It persists selector, operation, resolved amount, scope, and
  remaining uses in invariant-checked active effects. Add, multiply, and set
  operations are applied through the shared damage pipeline; only matching
  selectors consume counted effects. Resolution-local, event-triggered,
  capped, prior-action, level, and other unresolved variants remain explicitly
  `unsupported-in-scope` in the occurrence matrix.
- The generic `modify-damage` executor now resolves non-optional
  `on-success` current-action changes after the persisted
  attack rolls and before damage state mutation. It supports the existing
  typed condition and numeric-expression pipeline without treating
  source-text choices or activation groups as automatic effects. The
  Kamehameha roll-threshold path is covered through the public decision
  transition; optional Orange Burst damage remains unsupported pending a
  serialized choice.
- The typed damage executor now accounts for `roll-die-result` and
  `roll-die-threshold` conditions against persisted attack-roll records.
  Converted die indexes are explicitly one-based at the data boundary and
  must be positive during compilation; runtime evaluation converts them to
  authoritative zero-based record positions. This closes exact roll-die
  damage variants without deriving behavior from source prose.
- Resolution-local `successful-hit-count` expressions now resolve only from
  the owning completed attack's persisted roll results. The generic numeric
  primitive supports per-hit roll modifiers and damage modifiers, including
  Bakuretsu Ranma, Tears of the Mystic, and Dragon Swipes; Dragon Swipes uses
  a negative damage delta so its canonical prevention mechanic cannot be
  inverted by the additive damage pipeline. The public Bakuretsu transition
  verifies deterministic seven-hit resolution, version advancement, active
  effect persistence, and consumption by the opponent's next attack.
- Resolution-local `prior-roll-result` expressions now read only finite,
  persisted results from the latest relevant single-die attack or defense
  action. Multi-die actions intentionally provide no prior scalar. Generic
  damage modifiers also retain and apply declarative maximum/minimum caps after
  resolving their numeric basis; the public Slow Charge transition verifies
  the capped damage amount and invariant-backed version advancement. Unsupported
  prior-roll contexts and cap forms without a resolved numeric damage basis
  remain rejected.
- Runtime trigger dispatch now refuses optional or activation-group effects
  until their pending-choice contract exists. The occurrence matrix records
  those rows as unfinished `generic pending-choice compilation and resolution`
  work rather than treating them as automatically resolved effects.
- The matrix is now occurrence-level rather than effect-type-level. Every
  converted occurrence records its source definition, effect index, variant
  dimensions, status, capability or executor, focused coverage, reason, and
  prerequisite. Approved item exclusions carry an explicit exclusion reason;
  unfinished in-scope rows remain visible and do not get relabeled as
  exclusions.
- `set-resolution-threshold` now has a generic `resolution-threshold.v1`
  executor for exact direct attack/defense constraints on the current attack,
  the next matching action, or a combat-duration effect. Thresholds are
  evaluated from deterministic roll results, including canonical cannot-stop
  ceiling semantics, and durable threshold effects carry source, selector,
  scope, duration, and until-roll-threshold lifecycle data through
  invariant-checked versioned transitions. Relative-roll, prior-roll,
  level-bound, active-move-bound, and undispatched-trigger variants remain
  rejected in the occurrence matrix rather than approximated.
- The generic `damage-modifier.v1` capability now evaluates passive damage
  effects emitted by active CONSTANT skills, including unscoped modifiers.
  Relative self/opponent targeting, move selectors, additive/multiplicative/
  replacement operations, and normal damage ordering flow through the shared
  pipeline for basic, converted, and Death Beam attacks. Passive effects that
  require prior actions, unresolved damage context, optional choices, or
  undispatched triggers remain explicitly unsupported.
- `prevent-move-modification.v1` established the exact generic cost-only slice.
  It compiles selector-scoped prohibitions with actor filtering, reduce-only
  operation filtering, source-style and source-move exceptions, and combat or
  turn-bound durations into durable invariant-checked effects. Cost modifiers
  are filtered before validation and consumption, including passive move rules
  and active CONSTANT rules. The later v2 slice below extends the same typed
  primitive to damage and roll mutation pipelines while effect rewriting
  remains unsupported.
- `modify-damage` now has a durable `damage-modifier.v1` lifecycle for
  selector-scoped combat, turn, next-turn, and attack-roll-threshold effects.
  It preserves the distinction between damage derived from Power and
  `damage-percent` scaling, applies those effects through the shared immutable
  damage pipeline, and validates duration references, counters, operations,
  basis, and threshold data as part of every transition. This closes the
  generic Monster Mash, Ankle Buster, One-Two Punch, Soul Breaker, and Swift
  Neck Chop slices represented by the matrix. Optional selected attacks,
  on-damage response context, upkeep or resource-event dispatch, prior-roll
  values, caps, and other unresolved expressions remain
  explicitly unsupported.
- The generic condition executor now evaluates `prior-action` and
  `no-prior-action` from the latest persisted action for the selected actor.
  Attack records retain outcome, critical, and counter metadata; move
  selectors use structured move categories, tags, and requirements. This
  closes the prior-action variants for generic roll, damage, cost, and other
  compiled effects without consulting source prose or adding move-name
  branches. Earlier matching actions cannot satisfy a last-action condition,
  and no-prior-action remains true when the latest action does not match.
- The generic condition executor now evaluates `action-sequence` from ordered
  attack records plus the current resolved attack. It preserves the approved
  rule that non-attack actions do not break a sequence, supports result and
  move selectors, different-turn requirements, and `withoutResultBy`, and
  leaves unsupported effect types such as counter-action and floating-effect
  creation explicitly rejected.
- The generic `damage-modifier.v1` executor now dispatches non-optional
  `on-damage` responses with the current attack, persisted roll records, and
  incoming damage in the immutable resolution context. Advanced Behavior is
  covered through the public basic-attack transition. Effects with activation
  costs or use limits remain pending-choice work, and critical-damage
  replacement remains rejected until an explicit critical-multiplier context
  exists; neither is inferred from source prose.

- The generic trigger dispatcher now handles non-optional `on-power-up`
  effects through the versioned power-up transition. Durable roll modifiers,
  next-turn damage modifiers, and next-action resolution thresholds are
  compiled into invariant-checked active effects; `stacking: prevent` roll
  effects replace only their matching prior source effect. Power-up resource
  changes with caps, activation costs, use limits, or deferred scopes remain
  rejected because their durable accounting is not implemented.
- The generic trigger dispatcher now handles exact current-event
  `on-resource-gain` and `on-resource-drain` effects. Resource changes carry
  structured cause and source-style metadata into the immutable transition
  context; listener-relative subjects, move-set exclusions, and gain/lose
  normalization are evaluated without source-text interpretation. Base power-up
  KI gains and action/attack resource effects dispatch only the original event
  batch, so reaction-generated resource changes cannot recursively retrigger
  themselves. Immediate resource reactions, next-action damage, and next-action
  roll modifiers are supported; deferred resource durations and turn-or-perfect-
  roll lifecycles remain explicitly rejected.
- The generic condition executor now evaluates typed `resource-comparison`
  conditions against current or maximum HP and KI for either combatant. Passive
  current-action cost modifiers use the same resolved, immutable cost pipeline
  for legal-decision enumeration and submission, including explicit add/set and
  minimum/maximum handling. The Focused Spirit Cutter public transition covers
  the lower-current-HP cost reduction and successful next-action damage effect;
  Dragon Effect and Tesla Coil receive the same generic condition coverage.

### Latest implementation slice (2026-08-12)

The generic condition executor now evaluates `move-effect-active` and
`move-effect-inactive` from durable `activeEffects` supplied to every move-
effect resolution context. It matches the persisted source move through the
typed selector, ignores deactivated CONSTANT effects, and never infers
activity from source prose or a move name. X20 Kaioken's damage and
current-action cost effects now resolve through the normal public attack
transition; focused coverage verifies deterministic rolls, reduced Ki cost,
damage, state-version advancement, and invariant validation. The inactive
condition is covered against the same declarative effect shape.

The capability compiler and generated matrix now account for these conditions
as generic executor support. This closes the exact registered rows that only
lacked this durable context. Kiihakai Twisting Beam remains unsupported
because its separate `active-move-count` numeric expression is not
implemented; optional choices, level comparisons, critical replacement, and
other unresolved variants remain explicitly unsupported.

- Durable numeric expressions now evaluate `consecutive-combat-results` and
  `combat-result-count` from ordered persisted attack records. Non-attack
  actions do not count, reset boundaries and result metadata are explicit, and
  declared minimum/maximum bounds are applied deterministically. Passive
  current-action roll modifiers share the converted attack roll pipeline with
  before-attack modifiers. Letting Off Steam's stopped-chain damage and roll
  result, Chained Mastery's successful-chain damage, and Leverage Mastery's
  stopped-result roll variants are covered without source-text interpretation.

The generic `on-resource-threshold` dispatcher now evaluates threshold
crossings from sequential immutable pre/post resource states. Direct attempted
damage is examined before the persisted HP floor, so an effect such as Eternal
Mastery's first below-zero recovery can interrupt defeat deterministically; the
resulting state is still clamped and invariant-checked before the transition is
committed. Listener-owned effects are normalized to the action actor's target
frame, preserving self/opponent semantics without move-name branches.

Active CONSTANT effects now retain the literal KI cost paid at activation. The
durable `paid-activation-cost` numeric expression uses that recorded value for
threshold-triggered refunds, and invariant validation rejects non-finite or
negative persisted costs. Optional choices and other deferred resource
mechanics remain unsupported rather than being inferred.

Focused threshold coverage includes the public converted Kamehameha transition
with Eternal Mastery, direct runtime crossing and non-recrossing checks, the
paid-cost numeric expression, and capability-matrix accounting for all seven
`on-resource-threshold` occurrences.

### Latest implementation slice (2026-08-12)

The generic `on-roll-result` dispatcher now evaluates typed prior-die
conditions immediately before each subsequent die resolves. The callback is
given only the already resolved dice, applies an immediate per-die attack
result modifier, consumes no additional randomness, and therefore replays the
same natural rolls deterministically. Mass Genocide Attack's four escalating
result clauses now execute through this generic path and are covered by a
public move transition asserting the emitted results and committed state
version.

The compiler deliberately keeps stored-roll substitutions separate: Four
Arms' `set-roll-result` effect remains unsupported because it requires a
persisted roll frame and replay-safe resolution-local state. Optional choices,
rerolls, and unregistered effect types retain their explicit prerequisites;
none are approximated from source text or move names.

The regenerated matrix now records 635 `supported-generic`, 356
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Every
converted occurrence remains represented by generic or named coverage, an
explicit prerequisite, or a documented approved exclusion.

Focused evidence recorded during this slice:

- Combat-engine typecheck passed with `npx tsc --noEmit -p
packages/combat-engine/tsconfig.json`.
- Focused Vitest passed for the capability matrix, executor registry,
  `basic-attack.test.ts`, and `move-effects-runtime.test.ts` (71 tests),
  including operation application, selector non-matching, counted consumption,
  and invariant-backed public transitions.
- `git diff --check` found no whitespace errors. Its CRLF notices apply to
  pre-existing dirty files and are not errors.
- The current-action damage slice focused test passes in
  `progress-fight.test.ts` (23 tests across the capability-matrix and
  progress-fight modules), including deterministic roll consumption, state
  version advancement, damage events, and the invariant-checked result.
- The prior-action slice focused tests pass through both the runtime and public
  decision boundary. They cover structured requirement selectors, latest-action
  precedence, no-prior-action behavior, deterministic Smackdown damage, and
  persisted outcome/critical/counter metadata.
- The generated matrix now records 1,123 occurrences: 613 supported generic,
  380 unfinished in-scope, and 130 approved item exclusions. Its unfinished
  prerequisites are 299 typed executor/accounting rows, 16 typed damage-
  context rows, and 64 pending-choice rows.
- `npm run test:coverage` passed with 478 tests at the configured global
  threshold: 75.02% branches (2,580/3,439).
- This slice's `npm run test:coverage` passed with 481 tests at the configured
  global threshold: 75.05% branches (2,630/3,504).
- The action-sequence slice's `npm run test:coverage` passed with 484 tests at
  the configured global threshold: 75.02% branches (2,656/3,540).
- The on-damage response slice's `npm run test:coverage` passed with 488 tests
  at the configured global threshold: 75.08% branches (2,694/3,588).
- The on-power-up dispatch slice's `npm run test:coverage` passed with 489
  tests at the configured global threshold: 75.51% branches (2,742/3,631).
- The resource-event dispatch slice adds focused public transition coverage for
  exact current-event gain listeners, opposing-combatant targeting, and
  non-recursive reaction application. Its independent coverage run passed 490
  tests at 75.67% global branch coverage (2,797/3,696).
- The prior-roll and damage-cap slice adds focused declarative-runtime,
  move-effect, and public transition coverage. It closes the exact Weeping
  Willow prior-defense amount and Slow Charge resolved-cap variants while
  preserving undefined multi-die ambiguity. Focused checks pass before the
  repository gate, including 66 focused runtime/executor/matrix tests and 42
  basic-attack regression tests.
- The resource-comparison slice's focused Vitest run passed 62 tests across
  move-effect runtime, public fight progression, and capability-matrix tests.
  The combat-engine typecheck passed. The regenerated matrix now records 616
  `supported-generic`, 375 `unsupported-in-scope`, and 129 audited item
  exclusions; unfinished prerequisites are 296 typed executor/accounting rows,
  15 typed damage-context rows, and 64 pending-choice rows.
- The combat-result history slice's focused Vitest run passed 67 tests across
  declarative numeric runtime, move-effect runtime, public fight progression,
  and capability-matrix tests. The combat-engine typecheck passed. The
  regenerated matrix now records 620 `supported-generic`, 371
  `unsupported-in-scope`, and 129 audited item exclusions; unfinished
  prerequisites are 294 typed executor/accounting rows, 13 typed
  damage-context rows, and 64 pending-choice rows.

Repository-wide verification before this tranche: `npm run check` passed on
2026-08-09 (40 test files / 439 tests). The latest `npm run quality` attempt is
recorded below.

### Current handoff status (2026-08-12)

The resource-comparison/current-action cost, combat-result history, durable
move-effect condition, resource-threshold trigger, and per-die `on-roll-result`
slices are complete and verified. The generated matrix now classifies 635
occurrences as `supported-generic`; 356 in-scope occurrences still require
generic or named executor coverage, while 129 item occurrences have
documented audited exclusions. The catalog-closure goal remains active. The
next handoff must continue from the remaining prerequisite rows; it must not
reinterpret unfinished rows as exclusions.

### Next executable work

Resume after roadmap CE-110 and CE-120. Typed compilation and exhaustive
executor accounting are already implemented; the matrix now distinguishes
generic support, named support, unfinished in-scope work, and approved
out-of-scope exclusions at the individual occurrence level. The active work is
variant closure under the later trigger, condition, lifecycle, calculation,
choice, and catalog-closure stages. Its accounting gate is intentionally not
catalog closure: unsupported rows are required to identify their prerequisite,
while out-of-scope rows identify their approved exclusion.

CE-110 typed execution-plan validation and CE-120 exhaustive executor
accounting are now in place for the current runtime-owned discriminants. The
compiler rejects unsupported occurrences at runtime or load time while the
development-time report continues to represent unfinished in-scope work. The
next ready work is the remaining typed executor-accounting and compiled-plan
variants, with unsupported `modify-roll`, `modify-resource`, and
`modify-damage` rows prioritized by exact trigger, condition, target, scope,
and numeric form. The remaining `modify-damage` rows include upkeep/turn-bound,
resolution-derived amounts, level-bound, optional, critical-replacement,
unresolved cap bases, and other context that is not yet persisted or compiled.
The durable lifecycle, prior-action, resource-comparison, combat-result
history, power-up trigger, move-effect condition, and resource-threshold
trigger slices are now generic;
their remaining rows still require those distinct prerequisites.
Do not add move-name branches in
`progress-fight`; persist versioned resolution frames and exact candidate sets
before any player-owned choice.

### Latest implementation slice (2026-08-12)

The generic `modify-roll.v1` executor now carries explicit typed cap scopes
through the deterministic converted-attack pipeline:

- `amount` caps clamp an individual resolved modifier before aggregation.
- `total` caps clamp the combined active and immediate result modifier after
  aggregation.
- `roll` caps clamp the final dice-sides value before the injected random
  source is consumed.

This closes the two Vanishing Ball cap clauses and Slow Charge's current-action
result cap. The cap scope is declarative data, not inferred from source text or
move identity. `allow-exceed`, durable/global cap rules, and other uncategorized
cap variants remain explicitly rejected with matrix prerequisites until the
standard roll-cap state and resolution semantics are implemented. Public tests
cover the Slow Charge amount cap and Vanishing Ball total-result cap through
versioned fight transitions; the capability matrix records all three newly
supported occurrences and preserves explicit rows for the remaining cap
variants.

## Verification record

The combat-engine workspace typecheck and focused tests passed for this slice.
The wider workspace build remains blocked by pre-existing `game-data` test
fixture type errors in `packages/game-data/src/validation.test.ts`; the exact
errors concern widened fixture unions for attack types, NPC equipment, and
quest rewards. The required `npm run quality` gate was rerun after this slice:
formatting, lint (0 errors), reference validation, game-data validation,
combat-boundary validation, and 471 tests passed; TypeScript build stopped on
those same fixture errors. Coverage, duplication detection, and the production
dependency audit did not run because the chained gate stopped at build. The
unrelated untracked fixture was preserved.

The final quality-gate rerun after the executor refactor also passed formatting,
lint with 0 errors, reference validation, game-data validation,
combat-boundary validation, and all 478 tests. TypeScript build again stopped on
the same pre-existing `validation.test.ts` fixture errors, so the chained
quality command did not reach duplication detection or the production audit.
The independent required coverage run passed 478 tests at 75.02% global branch
coverage (2,580/3,439).

The latest `npm run quality` attempt after the prior-action slice passed
formatting, lint with 0 errors (70 warnings), reference validation, game-data
validation, combat-boundary validation, and all 481 tests. TypeScript build
again stopped on the same six pre-existing `packages/game-data/src/validation.test.ts`
fixture errors, so duplication detection and the production dependency audit
did not run. The independent coverage run passed 481 tests at 75.05% global
branch coverage (2,630/3,504).

The action-sequence slice invoked `npm run quality` as its sole final
repository gate. The tool host lost the terminal transcript after the quality
child process exited, so no new pass claim is made from that invocation. The
known workspace build blocker remains the same six pre-existing game-data
fixture errors; this slice did not modify game-data. Independent coverage for
the slice passed 484 tests at 75.02% global branch coverage (2,656/3,540).

The on-damage response slice's independent coverage run passed 488 tests at
75.08% global branch coverage (2,694/3,588). The game-data package build still
reports the same six pre-existing validation-fixture errors; the source overlay
changes in this slice are covered by the focused game-data tests and do not
alter that blocker.

The on-damage response slice's sole `npm run quality` gate passed formatting,
lint with 0 errors, reference validation, game-data validation,
combat-boundary validation, and all 488 tests. TypeScript build stopped on the
same six pre-existing `packages/game-data/src/validation.test.ts` fixture
errors, so duplication detection and the production dependency audit did not
run. No separate `npm run check` invocation was made.

The on-power-up dispatch slice's sole `npm run quality` gate passed formatting,
lint with 0 errors, reference validation, game-data validation,
combat-boundary validation, and all 489 tests. TypeScript build stopped on the
same six pre-existing `packages/game-data/src/validation.test.ts` fixture
errors, so duplication detection and the production dependency audit did not
run. The independent coverage run passed 489 tests at 75.51% global branch
coverage (2,742/3,631). No separate `npm run check` invocation was made.

The resource-event dispatch slice's sole final `npm run quality` gate passed
formatting, lint with 0 errors (78 warnings), reference validation, game-data
validation, combat-boundary validation, and all 490 tests. TypeScript build
stopped on the same six pre-existing `packages/game-data/src/validation.test.ts`
fixture errors, so duplication detection and the production dependency audit
did not run. The independent coverage run passed 490 tests at 75.67% global
branch coverage (2,797/3,696). No separate `npm run check` invocation was made.

The prior-roll and damage-cap slice's sole `npm run quality` gate passed
formatting, lint with 0 errors, reference validation, game-data validation,
combat-boundary validation, and all 492 tests. TypeScript build stopped on the
same six pre-existing `packages/game-data/src/validation.test.ts` fixture
errors, so duplication detection and the production dependency audit did not
run. The independent coverage run passed 492 tests at 75.67% global branch
coverage (2,850/3,766). No separate `npm run check` invocation was made.

The 2026-08-11 resource-comparison slice's sole `npm run quality` gate passed
formatting, lint with 0 errors, reference validation, game-data validation,
combat-boundary validation, all 495 tests, the TypeScript build, coverage,
duplication detection, and the production dependency audit with 0 high-severity
vulnerabilities. Coverage passed at 75.64% global branch coverage
(2,895/3,827). No separate `npm run check` invocation was made.

The 2026-08-12 combat-result history slice's sole `npm run quality` gate passed
formatting, lint with 0 errors, reference validation, game-data validation,
combat-boundary validation, all 498 tests, the TypeScript build, coverage,
duplication detection, and the production dependency audit with 0 high-severity
vulnerabilities. Coverage passed at 75.64% global branch coverage
(2,916/3,855). No separate `npm run check` invocation was made.

The 2026-08-12 durable move-effect condition slice's focused combat-engine
typecheck and 114 focused tests passed. The independent coverage run passed all
501 tests at 76.21% global branch coverage (2,948/3,868). Its sole final
`npm run quality` gate passed formatting, lint with 0 errors, reference
validation, game-data validation, combat-boundary validation, all 501 tests,
the TypeScript build, coverage, duplication detection, and the production
dependency audit with 0 high-severity vulnerabilities. No separate `npm run
check` invocation was made. The generated matrix records 624 generic-supported
occurrences, 367 unfinished in-scope occurrences, and 129 audited
out-of-scope occurrences; every occurrence remains represented with either
executor coverage or an explicit prerequisite/exclusion.

The 2026-08-12 resource-threshold slice's focused combat-engine typecheck and
120 tests across the affected runtime, public attack, executor, and matrix
modules passed. The regenerated matrix records 631 generic-supported
occurrences, 360 unfinished in-scope occurrences, and 129 audited
out-of-scope occurrences; all seven `on-resource-threshold` occurrences are
classified as generic coverage. The independent coverage and sole final
`npm run quality` gate are the final repository verification for this slice.

The independent `npm run test:coverage` run passed all 504 tests at 76.39%
global branch coverage (3,004/3,932).

The 2026-08-12 `on-roll-result` slice's focused combat-engine typecheck and
affected public, runtime, and capability-matrix tests passed. The regenerated
matrix records 635 generic-supported occurrences, 356 unfinished in-scope
occurrences, and 129 audited out-of-scope occurrences; all four Mass Genocide
Attack per-die result clauses are classified as generic coverage.

Its sole `npm run quality` gate passed formatting, lint with 0 errors, reference
validation, game-data validation, combat-boundary validation, all 507 tests,
the TypeScript build, coverage at 76.59% global branch coverage (3,037/3,965),
duplication detection, and the production dependency audit with 0
vulnerabilities. No separate `npm run check` invocation was made.

The 2026-08-12 typed roll-cap slice's focused combat typecheck, public cap
transition tests, runtime tests, and capability-matrix tests passed. The
regenerated matrix records 638 `supported-generic`, 353
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The three
supported cap occurrences are Vanishing Ball's dice-sides and total-result
limits plus Slow Charge's current-action result amount cap. Its sole final
`npm run quality` gate passed formatting, lint with 0 errors (90 warnings),
reference and game-data validation, combat-boundary validation, all 511 tests,
the TypeScript build, coverage at 76.70% global branch coverage (3,082/4,018),
duplication detection, and the production dependency audit with 0
vulnerabilities. No separate `npm run check` invocation was made.

The inventory command to refresh catalog counts is:

```bash
npm run report:combat-mechanics
```

The generated capability audit is:

```bash
npm run report:combat-capabilities
```

Its output is [combat-engine-capability-matrix.md](combat-engine-capability-matrix.md).
It now classifies exact occurrences using the roadmap statuses and summarizes
unfinished work by prerequisite and definition count. The current generated
record contains 638 `supported-generic`, 353 `unsupported-in-scope`, and 129
approved item-exclusion rows; those are accounting results, not a completion
claim. Source-text-only transformation abilities remain excluded from
executable effect counts; the active transformation families remain Humans,
Saiyans, Hybrid-Saiyans, Namekians, Changelings, and Bio-Androids.

The refined matrix identifies 19 `modify-damage` occurrences as unfinished
in-scope after this slice. Remaining variants include upkeep/turn-bound,
resolution-derived amounts, level comparisons, optional choices,
critical-multiplier replacement, unresolved cap bases, and other context that
is not yet persisted or compiled. They remain rejected rather than inferred
from source text.

The 2026-08-12 active-move and moveset-count slice adds one shared,
durable-state-backed count primitive. It resolves active CONSTANT Skills from
the serialized active-effect list with deactivation filtering and duplicate
source protection, then exposes that primitive to `active-move-count`
conditions, `active-move-count` and `active-move-effect-text-count` numeric
expressions, `moveset-move-count` conditions, and `move-use-count` conditions
including the current structured action. No move-name branch or source-text
execution was added. Wolf Fang Fist, Accelerated Shoulder Tackle, Heart Stab,
and Twisting Beam now have generic executor coverage; Torture Rack remains
unsupported because its transformation-roll executor is a separate missing
capability, and Thunder Ball remains unsupported because its cap still lacks
an explicit amount/total/roll scope.

The regenerated matrix records 646 `supported-generic`, 345
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Focused
runtime, declarative-expression, public transition, and matrix tests passed;
the independent coverage run passed 515 tests at 76.7% global branch coverage
(3,121/4,069), and the sole final `npm run quality` gate passed formatting,
lint with 0 errors (90 warnings), reference and game-data validation,
combat-boundary validation, all 515 tests, the TypeScript build, coverage,
duplication detection, and the production dependency audit with 0
vulnerabilities. No separate `npm run check` invocation was made.

The repository gate for a handoff is:

```bash
npm run quality
```

Do not run `npm run check` separately first. `npm run quality` already invokes
it before coverage, duplication detection, and the production dependency audit.

The 2026-08-12 floating-effect lifecycle slice adds a typed, versioned
`floating-effect` active state. The generic executor compiles the parent and
every nested effect as one flat declarative plan, persists the bundle with its
source/target provenance, dispatches nested effects through the existing
trigger runtime, and expires `next-action`, `next-turn`, and explicit
on-success/on-stopped/on-power-up termination rules. Unsupported parent
durations, creation costs/limits, nested optional effects, nested floating
bundles, and undispatched triggers remain rejected; no source text is executed
or approximated.

Focused executor, runtime, matrix, and public transition tests passed. The
regenerated matrix records 652 `supported-generic`, 339
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Six flat
floating bundles now have generic coverage. The final repository gate for this
slice remains `npm run quality`; no separate `npm run check` invocation is
permitted before it.

The 2026-08-12 extra-action scheduler slice adds the registered
`grant-extra-action` executor and a versioned `extra-action` active effect.
The supported generic boundary is deliberately exact: a self-targeted
`on-success` or `on-stopped` allowance in the ACTION phase, usable in the
current turn, with source-move/category/CONSTANT selectors and combat/turn
use limits persisted as durable state. Legal decisions are filtered against
all matching allowances, and consuming the allowance is part of the same
invariant-checked transition that resolves the action.

The twelve remaining extra-action occurrences are explicitly unsupported
because they require semantics this scheduler does not yet persist: upkeep or
next-turn scheduling, pre-action/passive skill-slot policy, per-roll-result
allowances, activation costs or optional activation groups, and other deferred
selection/scheduling metadata. They remain rejected by compilation and are
not approximated from source text. The generated matrix accounts for all 19
`grant-extra-action` occurrences: 7 `supported-generic` and 12
`unsupported-in-scope`.

Focused executor, runtime, matrix, and public transition tests passed, and the
combat-engine typecheck passed. The regenerated matrix now records 659
`supported-generic`, 332 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. The independent coverage run passed all
523 tests at 75.77% global branch coverage (3,291/4,343). The sole final
`npm run quality` gate passed formatting, lint with 0 errors (107 warnings),
reference and game-data validation, combat-boundary validation, all 523 tests,
the TypeScript build, coverage at 75.77% global branch coverage, duplication
detection, and the production dependency audit with 0 vulnerabilities. No
separate `npm run check` invocation was made.

The 2026-08-12 resource-modification-prevention slice completes the generic
`prevent-resource-modification.v1` executor for six exact converted variants.
It persists a versioned, invariant-checked prevention effect with source and
target provenance, filters matching HP/KI gain, loss, drain, and set changes at
the transition boundary before resource-trigger and threshold reactions, and
preserves declared opponent-effect and power-up exceptions. Focused runtime
and public transition tests verify the typed conversion, blocked KI gain,
source filtering, and invariant-safe version increment without a false
resource-change event.

Two remaining prevention occurrences are explicitly unsupported because their
`next-turn` scope requires turn-scheduling semantics that this lifecycle does
not yet persist. They remain represented in the matrix as unfinished in-scope
work; no duration or scope is inferred from source text. All eight converted
`prevent-resource-modification` occurrences are now accounted for, with six
generic-supported and two unsupported rows. The regenerated matrix records
666 `supported-generic`, 327 `unsupported-in-scope`, and 130
`audited-out-of-scope` occurrences. Focused public, runtime, capability-matrix,
and combat-engine typecheck checks passed. The independent coverage run passed
all 527 tests at 75.56% global branch coverage (3,352/4,436), and the sole
final `npm run quality` gate passed all 527 tests, the TypeScript build,
coverage at 75.62% global branch coverage (3,336/4,411), duplication
detection, and the production dependency audit with 0 high-severity
vulnerabilities. No separate `npm run check` invocation was made.

The 2026-08-12 resource-derived roll slice adds the generic
`resource-from-threshold` numeric executor. It evaluates the declared
`sign * (threshold - current KI)` expression from durable combatant state,
supports the passive current-action Energy Lob bonus, and carries the exact
maximum-penalty amount cap through deferred Cursed Spheres roll modifiers as
clamped durable state. No source text is interpreted at runtime and no move
name is used for dispatch.

The focused public Energy Lob transition test verifies the opponent-KI-derived
attack result at a legal signature turn, while runtime tests verify both
threshold values and the Cursed Spheres maximum penalty. The capability matrix
now records all five newly covered rows (three resource-derived variants and
two exact omitted-scope amount-cap variants) as generic-supported. Its current
totals are 670 `supported-generic`, 321 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining unsupported rows are unchanged
and remain explicit; no scope or duration is inferred for them. The final
repository gate for this slice remains `npm run quality`.

The 2026-08-12 relative-resolution-threshold slice adds the generic
`set-resolution-threshold.v1` relation primitive for converted attack/defense
constraints. Declarative threshold definitions now carry an explicit `add` or
`multiply` operation and the opposite roll reference; the runtime evaluates
those relations from resolved die results, preserves them through immediate
and durable active-effect paths, and rejects incomplete or same-roll relations
at the typed executor and roll invariant boundaries. This covers six exact
in-scope occurrences: S.S. Deadly Bomb, Crushing Kick, The Secret of the
Universe, both Ki Shield variants, and Shooting Star. Midorikatai's relative
threshold remains outside this slice because its activation-group choice and
next-action resolution are still pending-choice work.

Focused attack-roll, executor-compilation, and public transition tests pass,
including additive and multiplicative boundary behavior, invalid relation
rejection, and a version-incrementing public Crushing Kick transition. The
regenerated matrix now records 676 `supported-generic`, 315
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
unsupported rows are unchanged and remain explicit; no relation, operation,
scope, or duration is inferred from source text. The independent coverage run
and the sole final `npm run quality` gate remain required before handoff.

The 2026-08-12 combat-result override slice registers the generic
`set-combat-result.v1` executor for exact current-attack variants. Passive
SUCCESSFUL overrides are converted into the existing deterministic per-die
result frame, while on-success CRITICAL overrides are resolved from the typed
attack-roll context before damage and action-history effects are applied. The
transition remains immutable, advances its state version, and carries no
source prose into runtime evaluation.

The slice covers Back Suplex, Super Kamehameha, and Galactic Punisher as
generic current-attack variants. Post-defense matching-die changes, optional
activation groups, and next-action result changes remain explicitly
unsupported because they require persisted reaction choices or deferred
result state. The regenerated matrix now records 679 `supported-generic`,
312 `unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences; its
remaining unsupported summary is 64 pending-choice occurrences, 11 typed
compiled-damage/resolution-context occurrences, and 237 typed executor/
compiled-plan occurrences. Focused executor, runtime, and public transition
tests pass; coverage and the single final `npm run quality` gate remain
required before handoff.

The 2026-08-12 stat-modifier slice registers the generic `modify-stat.v1`
executor for typed Dexterity and Dexterity Bonus changes. Literal and durable
numeric expressions are resolved from combat state, turn durations are stored
as invariant-checked active effects, and next-action/next-roll changes are
stored as versioned resolution-local modifiers. Attack and defense roll
construction applies additive, replacement, and multiplicative stat changes
from typed state; no source prose is consulted.

This covers six exact in-scope occurrences from Blitzkrieg, Naginata, Dazzling
Gymnastics, and Rocket Fire. Kaio-Ken's upkeep trigger and Leg Vice's
on-move-use trigger remain explicitly unsupported because those phase/event
dispatch boundaries are not implemented in this slice. The regenerated matrix
now records 685 `supported-generic`, 306 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences; its remaining unsupported summary is 64
pending-choice occurrences, 11 typed compiled-damage/resolution-context
occurrences, and 231 typed executor/compiled-plan occurrences. Focused
executor, runtime, and public transition tests pass, as does the required
coverage run (539 tests; 75.02% branch coverage). The single final
`npm run quality` gate passes with 0 lint errors, 539 tests, 75.04% branch
coverage, 15 duplication findings below threshold, and zero production audit
vulnerabilities.

The 2026-08-12 suppression slice registers the generic `suppress.v1`
executor for durable, selector-scoped suppression of future move effects. The
runtime persists source and target provenance with an invariant-checked
`suppress` active effect, filters matching all-effects or successful-effects
through typed move-effect and active-effect paths, and expires combat, turn,
next-action, and attack-roll-threshold lifecycles in immutable, versioned
transitions. The approved normalization rule remains intact: suppression
covers floating effects, stat gains, and not-yet-triggered effects without
undoing effects already resolved.

Five exact occurrences are now generic-supported: Dismissive Kick, both
Dimension Scream branches, Big Bopper, and Power Drill. Seven suppressions
remain explicitly unsupported: Breakout and Mimicry Mastery require
resolution-local suppression, Soul Breaker requires a following-action offset,
and Showdown, Against the Odds, and Breaking the Cycle require upkeep or
serialized optional-choice scheduling. Their matrix rows retain the specific
prerequisite and no source text is executed or approximated. The regenerated
matrix records 690 `supported-generic`, 301 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences; the suppression family is fully accounted
for as five supported and seven unsupported rows.

Focused executor, runtime, public-transition, matrix, and combat-engine
typecheck checks pass. The independent coverage run and the single final
`npm run quality` gate pass.

The 2026-08-12 on-move-use dispatch slice adds the generic trigger boundary
for exact, durable self follow-ups and current-action self cost modifiers.
Used moves and active CONSTANT sources are dispatched through the typed
`on-move-use` runtime context, while suppression, lifecycle, target
provenance, and state-version invariants remain enforced by the existing
transition path. Chained Mastery's next-turn floating follow-up is covered
through the public attack transition; Relentless and Impulsive current-action
cost effects use the same generic cost primitive. No move-name dispatch or
source-text evaluation was added.

The matrix accounts for all 18 converted `on-move-use` occurrences: four are
now `supported-generic`. The remaining occurrences stay explicitly
unsupported: optional Channeling and Grapple choices, Cancellation's
opponent deactivation/negation, Test of Strength's contest, Leg Vice's
opponent stat/prevention effects, and item resource effects outside this
move-effect executor boundary. The generated matrix now records 694
`supported-generic`, 297 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences, with 64 pending-choice, 11 typed
compiled-damage/resolution-context, and 222 typed executor/compiled-plan
prerequisite rows remaining.

The 2026-08-12 roll-cap slice adds the generic rules-backed standard roll
modification limit and the durable `allow-exceed` permission. Advanced Attacks
use the configured +/-10 limit and Signature Techniques use the configured
+/-5 limit; matching typed bypass effects are preserved on active roll
modifiers and next-action roll modifiers. Current-action and active CONSTANT
passive roll modifiers are aggregated once, capped deterministically, and then
passed into the existing immutable, version-incrementing attack transition.
Invariant validation covers the new cap discriminant and scope, and no move
name or source prose is consulted at runtime.

The exact Aoyosumu Opportunist and Midorikatai Flawless Execution bypass
occurrences are now `supported-generic`. Optional Multi-Form and Super Galick
Gun choices, location-dependent Death Ball, roll-modifier reaction triggers,
and other deferred-context variants remain explicitly unsupported with their
existing matrix prerequisites. The regenerated matrix records 696
`supported-generic`, 295 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences, with 64 pending-choice, 11 typed
compiled-damage/resolution-context, and 220 typed executor/compiled-plan
prerequisite rows remaining.

Focused executor, public attack-transition, matrix, and combat-engine
typecheck checks pass. The required independent coverage run and the single
final `npm run quality` gate remain pending before handoff.

The 2026-08-12 `start-combat` dispatch slice adds the generic initial-match
boundary for immediate resource changes and selector-scoped combat locks.
These effects are collected from typed move definitions during the first
upkeep-to-action transition, converted into durable active effects or bounded
resource state, and emitted as deterministic structured events. The transition
increments the state version once and revalidates the resulting state; no
source prose or move-name branch participates in resolution.

Three exact occurrences are now `supported-generic`: Conservation Mastery's
opening KI gain and the two static lock selectors from Focused Mastery. The
remaining start-combat rows stay explicit: Dragon's Pride requires SP and an
activation-cost context, Control Mastery requires a later cost-modification
result and status selector semantics, Sense Power Level requires initiative,
level, and escape-roll context, and the other rows use unsupported move
classification, temporary-move, mastery, or optional-choice mechanics. The
regenerated matrix records 699 `supported-generic`, 292
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences, with 64
pending-choice, 11 typed compiled-damage/resolution-context, and 217 typed
executor/compiled-plan prerequisite rows remaining.

Focused public transition, executor, matrix, and combat-engine typecheck
checks pass. The independent coverage run passed 43 files and 551 tests,
and the single final `npm run quality` gate passed.

The 2026-08-12 shared item-resource slice closes the converted consumable
boundary for common `modify-resource` effects triggered by `on-move-use`.
The item runtime now validates the typed self-targeted gain/lose shape,
resolves literal and resource-percent amounts against the immutable combatant
snapshot, applies the existing resource caps, records one item use, and keeps
the action phase open. Legacy `item-modify-resource` definitions remain
supported through the same public resolver; no item name or source prose is
consulted.

Five converted consumable occurrences are now `supported-generic`: First Aid
Kit, 1/3 Senzu Bean, 1/2 Senzu Bean, Senzu Bean, and Bag of Senzu Beans. Their
separate `item-state-rule` loss-recovery and healing-limit definitions remain
`audited-out-of-scope` because they require post-combat or administrator
mediated lifecycle state, not an in-fight resource transition. The regenerated
matrix records 704 `supported-generic`, 287 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences, with 64 pending-choice, 11 typed
compiled-damage/resolution-context, and 212 typed executor/compiled-plan
prerequisite rows remaining.

Focused item-runtime public-transition, matrix, and combat-engine typecheck
checks pass. The independent coverage run passed 43 files and 553 tests, and
the single final `npm run quality` gate passed.

The 2026-08-12 `upkeep-phase` dispatch slice adds the generic phase-boundary
executor for immediate resource/status changes and durable modifiers. It
evaluates each combatant's typed move effects against the active combatant,
preserves participant-relative targeting, allocates injected active-effect and
event IDs deterministically, increments the state version once, and validates
the transition through the existing invariants. Resolution-only effect types
such as roll-definition replacement remain rejected by the executor registry;
no source prose or move-name branch participates in dispatch.

Seven upkeep occurrences are now `supported-generic`, including Kaio-Ken's
damage/stat/prevention effects, Future Sight's lock, Solar Flare's durable
floating-effect and lock, and Speed Demon's roll-modification prevention. The
remaining upkeep rows stay explicit: resolution-only roll definitions, stored
roll and selection lifecycles, unsupported nested conditions, and pending
choices still require their own serialized state or executor boundary. The
regenerated matrix records 711 `supported-generic`, 282
`unsupported-in-scope`, and 130 `audited-out-of-scope` occurrences, with 64
pending-choice, 11 typed compiled-damage/resolution-context, and 206 typed
executor/compiled-plan prerequisite rows remaining.

Focused upkeep public-transition, matrix, and combat-engine typecheck checks
pass. The independent coverage run passed 43 files and 554 tests, and the
single final `npm run quality` gate passed.

The 2026-08-12 resource-cap slice adds the generic numeric cap primitive to
resource changes. The typed runtime resolves `maximum` and `minimum` cap
expressions from the immutable transition context, applies the cap to each
resource change before the universal resource floor and ceiling, and carries
the resulting change through the existing versioned transition and invariant
boundary. This closes the exact Power Surge Mastery `on-power-up` occurrence
without executing its source wording or adding a move-specific branch.

Power Surge Master's capped KI gain is now `supported-generic` through
`modify-resource.v1`; compiler coverage and a public power-up transition test
verify the cap, emitted actual-gain event, deterministic state-version
increment, and valid resulting state. The regenerated matrix records 701
`supported-generic`, 290 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining prerequisite buckets are 64
pending-choice, 11 typed compiled-damage/resolution-context, and 215 typed
executor/compiled-plan rows; these remain explicit rather than approximated.

Focused resource-runtime, public combat-transition, matrix, and
combat-engine typecheck checks pass. The independent coverage run passed 43
files and 557 tests, and the single final `npm run quality` gate passed.

## 2026-08-12 phase-local resource-expression slice

The next high-volume generic capability adds deterministic numeric resolution for
typed expressions whose inputs are already present in the owning combat phase:
triggering-move base KI cost, triggering-move base damage and base-damage
percentage, HP-per-successful-hit, HP-per-successful-roll-threshold, and
dexterity-bonus differences. The runtime receives explicit triggering-move
ownership and persisted attack-roll context; it does not infer semantics from
source prose or branch on move names. Multi-hit base damage uses the declared
`damagePerHit` mechanic and the persisted successful-hit count.

The transition path now carries this context through the immutable converted
attack resolution. The new resource effects remain generic `modify-resource.v1`
changes, are applied through the existing cap/floor/ceiling resource boundary,
and retain the existing version increment and invariant validation. Focused
tests cover each expression and a public Double Arm Cannon transition verifies
the multi-hit HP gain and exact state-version increment.

The regenerated matrix now records 707 `supported-generic`, 284
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 64 pending-choice, 11 typed compiled-damage or
resolution-context, and 209 typed executor or compiled-plan rows. Rapture's
`HEAL (25% Damage)` remains in the typed compiled-damage bucket because the
approved normalization requires final damage after all modifiers; this slice
does not substitute pre-cap or pre-modifier damage. All 129 out-of-scope rows
remain explicitly classified with approved exclusions in the generated matrix.

Focused declarative-runtime, move-effect-runtime, public fight-transition,
matrix, and combat-engine typecheck checks pass. Repository coverage and the
single final `npm run quality` gate remain required before handoff.

## 2026-08-12 final-damage resource slice

The next generic resource-expression capability resolves `damage-percent` at
the resource-consumer boundary. Damage modifiers continue to retain their
declared percentage basis, while a resource effect such as Rapture resolves
the percentage against the final damage actually dealt after damage modifiers
and target HP capping. The transition supplies that immutable final-damage
value only after the attack roll and damage pipeline complete; no pre-cap
damage is substituted.

The capability is covered by declarative and move-runtime tests plus a public
Rapture transition where a 20-damage attack is capped at 15 target HP and the
attacker heals exactly 25% of 15. The transition remains deterministic,
increments the state version once, and passes the existing invariant boundary.
Psycho Driver remains unsupported because its `next-action` damage resource
effect requires a persisted deferred-resource lifecycle; the compiler now
records that generic limitation instead of silently resolving it immediately.

The regenerated matrix now records 708 `supported-generic`, 283
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 64 pending-choice, 11 typed compiled-damage or
resolution-context, and 208 typed executor or compiled-plan rows. The goal
therefore remains active; these counts are not a completion claim.

## 2026-08-13 scheduled-resource executor slice

The next high-volume generic executor capability completes the durable
`schedule-effect` resource lifecycle. Converted schedules now compile into
invariant-checked `scheduled-resource` effects and execute at their declared
target turn-start, turn-end, or phase-start boundary. The scheduler resolves
literal, stat-percent, and resource-percent amounts from the immutable source
and target combatants, applies existing resource-prevention and cap/floor
rules for direct resource changes, and routes delayed Damage through the
shared damage modifiers and structured `damage-applied` event instead of
silently treating it as HP loss. It emits structured KI/HP and expiry events,
repeats only when the declarative repeat and duration permit it, and preserves
selector-aware until-roll-threshold and cancellation expiry through the normal
attack-resolution transition, including eligible basic attacks.

The public transition tests cover a one-shot upkeep HP change, a recurring KI
drain across two target turns, Bomb Tag waiting until the opponent's second
turn before dealing damage, and cancellation by a successful single-die basic
attack. Focused invariant and move-runtime tests cover malformed durable state
and retention of unresolved numeric work until its boundary. Poison Mist's
converted duration now explicitly carries its source-required single-die move
selector; source prose is not consulted to recover that rule at runtime. The
optional Straining Bodyslam schedule remains pending-choice work because its
activation cost must be selected and persisted before the schedule can exist;
it is not treated as automatically paid. No schedule-specific move branch was
added.

The regenerated matrix now records 716 `supported-generic`, 275
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 64 pending-choice, 11 typed compiled-damage or
resolution-context, and 200 typed executor or compiled-plan rows. All 129
out-of-scope occurrences remain explicitly classified with approved
exclusions. Focused scheduler, executor-registry, public-transition,
capability-matrix, combat-engine typecheck, and boundary checks pass. The
independent coverage run and final `npm run quality` gate both pass 43 test
files and 568 tests; the quality gate also passes the solution build,
duplication threshold, and production dependency audit.

## 2026-08-13 next-turn action allowance slice

The generic `grant-extra-action` scheduler now supports non-optional,
action-phase allowances with `next-turn` scope. The durable effect records its
declared availability and expiry turn, remains targeted to its owning
combatant through the intervening opponent turn, and is consumed through the
same shared decision filter used by current-action allowances. Because the
combat turn counter advances once per combatant turn, expiry remains valid
through the owner's following action. Power Up consumption now participates in
that shared path, so a successful versioned transition cannot leave stale
allowance state behind.

Kienzan is covered through public turn progression at its signature-available
turn: the allowance is unavailable during the source attack, persists across
the opponent's turn, restricts the next source action to Power Up, and is
removed after that action. No move-name runtime branch was added. Upkeep-phase
allowances such as Destructo Disc and Sky Dance, optional variants, and
activation-cost variants remain unsupported until their explicit phase or
pending-choice lifecycle is available; they remain visible as unsupported
rows rather than being silently approximated.

The regenerated matrix now records 717 `supported-generic`, 274
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 64 pending-choice, 11 typed compiled-damage or
resolution-context, and 199 typed executor or compiled-plan rows. Every
out-of-scope occurrence remains explicitly classified with a documented
approved exclusion. Focused executor, matrix, public-transition, and
combat-engine typecheck checks pass; coverage and the single final
`npm run quality` gate remain required before handoff.

## 2026-08-13 move-modification prevention v2 slice

The generic `prevent-move-modification.v2` executor now preserves source
identity through damage, dice-side, and roll-result mutation pipelines in
addition to its existing KI-cost coverage. Durable preventions enforce their
typed target, move selector, modifier actor, reduce-only operation filter,
source-move and source-style exclusions, duration, and explicit status-source
exceptions before a matching mutation is applied. Actor matching is relative
to the prevention source, so a self-targeted prohibition against opponent
effects no longer mistakes the protected combatant for the prohibited actor.

Heat Dome Attack's converted definition was repaired against its canonical
source: it protects the user's Advanced Attacks and Signature Techniques from
opponent damage reductions, while explicitly allowing BREAK and SEVER status
penalties. The exception is represented by typed status IDs and evaluated from
persisted status provenance; runtime code does not inspect source prose or the
move name. Five Finger Shot, Neutralization, Knee Stomp, and Energy Breaker use
the same executor without named branches. State of Zen and Static Shot remain
unsupported because their `effects` aspect requires an effect-rewriting
lifecycle, and Healing Ray remains blocked on stored-roll resolution; none is
partially declared supported.

Focused public-transition tests prove that a protected attacker ignores
matching active damage and result modifiers, that reduce-only protection still
allows the declared BREAK exception, and that accepted transitions advance the
state version. Focused data-fidelity, effect-runtime, compiler-registry,
capability-matrix, and combat-engine type checks pass.

The regenerated matrix now records 722 `supported-generic`, 269
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 64 pending-choice, 11 typed compiled-damage or
resolution-context, and 194 typed executor or compiled-plan rows. Every
out-of-scope occurrence remains explicitly classified with a documented
approved exclusion. The independent coverage run passes 43 test files and 573
tests. The final `npm run quality` gate also passes the routine checks, targeted
coverage thresholds, duplication threshold, and production dependency audit.

## 2026-08-13 restricted-use limit v1 slice

The generic `modify-remaining-uses.v1` executor now accepts positive literal
increases targeting one exact move ID. The increase is represented in
combat-owned `moveUseLimitModifiers`, validated as a positive integer for an
owned move with a canonical restricted-use limit, and consumed uniformly by
attack, simple-action, CONSTANT Skill, and Block legality and submission. A
successful transition increments the fight version and emits a
`move-use-limit-changed` event with source, target, selected move, delta, and
the resulting effective limit. Runtime code does not inspect source prose or
branch on move names.

Four exact converted occurrences are now `supported-generic`: x20 Kaioken
Kamehameha's successful +2 Kaio-Ken increase, Super Arm Bar Takedown's
first-stopped-use increase, and the conditional passive increases for Breaking
The Cycle and Neuron Disruptor. The two Kurokonwaku moves now retain their
canonical base `RESTRICTEDx1`; a generator repair ignores leading parenthetical
conditional clauses when deriving base mechanics, and typed `moveset`
conditions supply the conditional second use. Neuron Disruptor's previously
missing structured conditional effect was added, while Super Arm Bar
Takedown's "this attack" selector and first-use condition were narrowed to the
exact move and including-current-use count.

Three occurrences remain explicitly unsupported. Ceasefire Mastery needs a
serialized move selection at start combat, Halting Stance needs durable
opponent-caused Ki-loss history over ten turns, and Spiked Ball retains its
optional activation-group choice. None is automatically selected or partially
approximated.

The regenerated matrix now records 726 `supported-generic`, 266
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 64 pending-choice, 11 typed compiled-damage or
resolution-context, and 191 typed executor or compiled-plan rows. Every
out-of-scope occurrence remains explicitly classified with a documented
approved exclusion. Focused game-data, compiler, runtime, invariant,
public-transition, matrix, and combat-engine type checks pass. The independent
coverage run passes 43 test files and 578 tests.

## 2026-08-13 current-action move classification v1 slice

The generic `modify-move-classification.v1` executor now accepts exact,
non-optional passive tag additions scoped to the current action. The runtime
compiles the typed effect, respects existing effect suppression, normalizes the
declared tag through the attack-tag vocabulary, and builds an immutable
resolution-local move view. No classification is persisted beyond the action.
That view is used by generic move-selector listeners, while an added Physical
or Energy tag also becomes an alternate Block attack type. The public decision
gateway still owns the version increment and validates both the pending-defense
and completed-action states through the existing invariant boundary.

Four converted occurrences are now `supported-generic`: Shock Fist,
Blitzkrieg, and Turn Up The Heat add Energy classification to their physical
attacks, and No Shadow Kick adds Punch classification. Public tests prove that
an Energy-only Block is offered against Shock Fist and that No Shadow Kick's
added Punch tag activates Chained Mastery's generic on-move-use listener. The
runtime contains no move-name or source-text branch.

The other four classification occurrences remain explicit. Intensity Mastery
is now faithfully marked optional with a one-move selection limit and requires
a serialized start-combat choice. Ki Color Cascade needs a durable declared
Martial Arts Style and four-turn replacement lifecycle. Karmic Chameleon
Mastery's two rows depend on its serialized opponent-move selections and
combat-duration copied-technique lifecycle. None is automatically selected or
approximated.

The regenerated matrix now records 730 `supported-generic`, 262
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 65 pending-choice, 11 typed compiled-damage or
resolution-context, and 186 typed executor or compiled-plan rows. Every
out-of-scope occurrence remains explicitly classified with a documented
approved exclusion. Focused data-fidelity, compiler, Block, public-transition,
matrix, and combat-engine type checks pass. The goal remains active because the
262 in-scope unsupported occurrences are not yet closed. The independent
coverage run passes 43 test files and 581 tests.

## 2026-08-13 stored-roll state v1 slice

The generic `roll-and-store.v1` executor now resolves all five converted stored
writes during their declared ACTION or UPKEEP phase. The combat-owned record
retains the source move, stable key, natural results, resolved die sides, and
turn number; another write to the same key replaces it immutably. Literal sides
cover Solar Flare, Petrifying Spit, Healing Ray, and Ki Trap, while Impulsive
uses the existing typed `moveset-move-count` expression. Randomness remains an
injected dependency, each accepted action advances the fight version exactly
once, and every emitted state passes the invariant boundary. A factual
`roll-stored` event makes each natural result and its die definition explicit.

The same generic state now supplies the `stored-roll-threshold` condition for
single-result consumers. Solar Flare applies its immediate Stun at 15 or higher,
and Healing Ray grants exactly 1 KI on 9 or lower after paying its action cost.
The optional Healing Ray target choice, its unsupported effect-rewrite
prohibition, Ki Trap's future natural-roll listeners and optional rerolls,
Impulsive's ordered move selection, and Petrifying Spit's later turn-start
status lifecycle remain rejected. No source text, move name, or guessed duration
is used to fill those gaps.

This slice also corrected seven previous capability overclaims. Six
`skip-action` occurrences had a registered compiler entry but no durable
action-flow handler, and Petrifying Spit's turn-start-roll status duration was
being accepted even though `ActiveStatus` cannot represent it. Those rows are
now explicitly unsupported. The five stored writes and two exact immediate
threshold consumers replace those seven claims, so the regenerated matrix
remains at 730 `supported-generic`, 262 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining prerequisite buckets remain 65
pending-choice, 11 typed compiled-damage or resolution-context, and 186 typed
executor or compiled-plan rows. Every out-of-scope occurrence retains its
documented approved exclusion, and the goal remains active.

Focused compiler, runtime, invariant, public-transition, capability-matrix, and
combat-engine type checks pass. The independent coverage run passes 43 test
files and 588 tests at 76.33% global branch coverage. The single final
`npm run quality` gate remains required before handoff.

## 2026-08-13 action restriction v1 slice

The generic `skip-action.v1` executor now compiles and persists exact future-turn
action restrictions. Combat-owned state records the source effect index, target,
first eligible global turn, remaining target turns, and optional blocked attack
categories. This distinguishes a complete skipped action from the canonical
“cannot attack” wording: category-scoped restrictions remove Basic Attacks,
Advanced Attacks, and Signature Techniques while preserving unrelated choices
such as Power Up, Pass, Items, and Skills. A category-free restriction advances
Upkeep directly to End and emits a factual `action-skipped` event with reason
`effect`. Restrictions decrement only after an eligible target turn, so
self-targeted next-turn effects cannot accidentally affect a same-turn extra
action. All accepted transitions remain versioned and invariant checked.

Eight converted occurrences are now `supported-generic`: Petrifying Spit's
initial successful next-turn skip; both Serenity Wave restrictions; Sonic
Whisper; both Focus Buster restrictions; Heat Seeking Blast's before-roll
attack restriction; and Shadow Realm's two-turn restriction. The Aoyosumu,
Kiihakai, and Kurokonwaku definitions were repaired against their canonical
text so every “cannot attack” row explicitly includes Basic Attacks instead of
silently treating only Advanced Attacks and Signature Techniques as attacks.
Runtime execution uses only these typed fields and contains no source-text or
move-name branch.

Two `skip-action` occurrences remain explicit and unsupported. Power Boost is
optional during the ACTION phase and requires a serialized pending choice.
Petrifying Spit's repeated pass-until-success behavior requires turn-end
dispatch plus its turn-start roll/status lifecycle; it is not approximated by
the one-turn executor.

The regenerated matrix now records 738 `supported-generic`, 254
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 65 pending-choice, 11 typed compiled-damage or
resolution-context, and 178 typed executor or compiled-plan rows. Every
out-of-scope occurrence retains its documented approved exclusion, and the
goal remains active. Focused game-data validation, compiler, effect-runtime,
invariant, public-transition, capability-matrix, and combat-engine type checks
pass. The independent coverage run passes 43 test files and 594 tests at
76.53% global branch coverage. The final `npm run quality` gate passes the
routine checks, coverage thresholds, 1.04% duplicated-token result, and
production dependency audit with zero vulnerabilities.

## 2026-08-13 critical-threshold v1 slice

The generic `modify-critical-threshold.v1` executor now applies typed natural-
or final-result thresholds inside the existing single-die attack resolution
pipeline. Threshold expressions are evaluated from authoritative combat state,
must resolve to finite values before randomness is consumed, and remain subject
to the shared single-die eligibility rule and explicit critical prevention.
The executor does not inspect source prose, persist resolution-local state, or
branch on move names. Accepted public decisions still advance the fight version
exactly once and pass through the existing transition invariant boundary.

All four converted occurrences are now `supported-generic`. Volcanic Smash
criticals at a final attack result of 30 or higher. Crescent Kick uses the same
threshold only when its typed prior-action condition confirms that the user
stopped the opponent's latest action. Critical Mass Mastery applies a final
result threshold of 29 to matching Midorikatai and non-Custom Freestyle attacks
whose typed base attack roll is exactly one die with at most 32 sides. Its
previously selector-free conversion was split into two declarative effects so
the style alternatives, non-Custom restriction, die count, and maximum die size
are explicit executable data rather than inferred from text.

Focused compiler-registry, selector, attack-resolution, data-fidelity, and
public-transition tests cover the exact threshold boundary, below-threshold and
multi-die exclusions, non-finite input rejection, the prior-action condition,
both mastery selector branches, critical damage, deterministic rolls, and state
versioning. The regenerated matrix now records 742 `supported-generic`, 251
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 65 pending-choice, 11 typed compiled-damage or
resolution-context, and 175 typed executor or compiled-plan rows. Every
out-of-scope occurrence retains its documented approved exclusion, and the goal
remains active because the 251 in-scope unsupported occurrences are not yet
closed. The independent coverage run passes 43 test files and 604 tests at
76.75% global branch coverage.
The 2026-08-12 declarative reroll slice adds the generic `reroll.v1` reaction
executor. Swift Reaction, Second Chance, and Zen Explosion now preserve their
typed roll, scope, selector, bonus, activation, use-limit, duration, and
condition data through public post-defense transitions. Reroll choices use
persisted natural rolls, consume injected randomness only for selected dice,
charge KI where declared, decrement durable use limits, and emit replayable
events. Zen Explosion's defensive threshold is evaluated at the current
post-defense boundary rather than inferred from source text.

Attacker-owned rerolls now also create the post-defense reaction boundary when
the defender has no eligible reaction, so selector-compatible Swift Reaction
uses are reachable through the public transition API. Reroll option filtering
is source-effect-specific, including active-effect IDs containing colons.

Tiger Strikes, Braced Energy Beam, Willing Sacrifice, and Ki Trap remain
explicitly unsupported because they require next-roll or next-action lifecycles,
stored-roll coupling, optional choices, opponent targeting, or multi-roll
selection that this tranche does not persist. The regenerated matrix accounts
for seven reroll occurrences: three supported generically and four
unsupported-in-scope. It records 661 `supported-generic`, 329
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Focused
compiler, runtime, public-transition, and matrix tests pass. Coverage passes
all 528 tests at 75.34% global branch coverage (3,520/4,672). The single
`npm run quality` gate was attempted but is blocked at its pre-existing
repository-wide formatting check: 135 unchanged baseline files are reported by
Prettier. No unrelated files were reformatted.

## 2026-08-14 master merge reconciliation

The reroll slice was merged into the local `master` branch after preserving the
intervening CE130 work already present on that branch. The capability report was
regenerated from the merged source after build output refresh and now records
740 `supported-generic`, 251 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. The reroll executor and its public
transition coverage remain present; the changed totals reflect the master-side
catalog and executor accounting rather than a scope reclassification.

Regression validation on the merged tree passed lint, reference and game-data
validation, combat-boundary validation, 43 test files and 612 tests, the
TypeScript build, 77.04% global branch coverage, duplication detection, and the
production dependency audit with zero vulnerabilities. The repository quality
script remains blocked only by the pre-existing 135-file repository-wide
Prettier baseline; all merged implementation and test files are formatted.

## Handoff prompt

> Resume the combat-engine goal from the current worktree. Read
> `AGENTS.md`, `ARCHITECTURE.md`, and
> `docs/architecture/combat-engine-progress.md` first. Preserve unrelated
> dirty changes. Implement the next missing high-volume generic executor
> capability, update the capability matrix and progress document, add focused
> public-behavior tests, and use deterministic, versioned,
> invariant-checked transitions. The active transformation scope is Humans,
> Saiyans, Hybrid-Saiyans, Namekians, Changelings, and Bio-Androids only. Do
> not treat converted source text as executable semantics, silently approximate
> unsupported mechanics, or add move-name branches where a generic primitive
> fits. Run focused checks during work and `npm run quality` as the single
> repository gate before handoff; do not run `npm run check` separately first.
> Do not mark the goal complete until the capability matrix accounts for every
> in-scope converted effect with generic or named executor coverage and every
> out-of-scope definition with a documented approved exclusion.
