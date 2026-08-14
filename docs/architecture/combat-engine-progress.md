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
- `prevent-move-modification.v1` now covers the exact generic cost-only slice.
  It compiles selector-scoped prohibitions with actor filtering, reduce-only
  operation filtering, source-style and source-move exceptions, and combat or
  turn-bound durations into durable invariant-checked effects. Cost modifiers
  are filtered before validation and consumption, including passive move rules
  and active CONSTANT rules. Damage, dice-side, roll-result, and effect
  prevention remain unsupported until their mutation pipelines retain source
  identity.
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
