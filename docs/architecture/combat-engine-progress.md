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

## Current phase status

**Phase 1 — Make work mechanically discoverable: complete.** The Phase 1
accounting gate is satisfied for all 1,120 converted structured occurrences.
The generated capability matrix records 876 `supported-generic`, 115
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Every
occurrence has a precise status, reason, prerequisite or approved exclusion;
supported rows identify their compiler, executor, and focused coverage.

This does **not** mean the combat engine is catalog-complete. Phase 1 permits
explicitly tracked `unsupported-in-scope` work. Overall completion still
requires closing the 115 remaining in-scope occurrences through the later
normalization, execution, lifecycle, scheduling, and catalog-closure phases.
The next implementation priority is the highest-volume ready prerequisite
identified in the latest dated entry below.

The converted catalog is data-complete, but it is **not** equivalent to engine
complete. The current inventory has 499 moves and 839 move effects across 46
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
  currently implemented Heroic Tunic, Close Shave, Energy Redirection, Swift
  Reaction, Zen Explosion, and Second Chance paths.
- Status lifecycle and action consequences for BREAK, SEVER, STUN, and
  PETRIFIED, including expiry and prevention of actions where applicable.
- Declarative effect evaluation for the implemented trigger paths, including
  typed conditions, resource changes, damage and cost modifiers, roll changes,
  status application, forced actions, locks, move-use/status prevention, and
  active-effect lifecycle handling, including generic post-deactivation
  listeners for representable lock and cost effects.
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

## Capability-first catalog closure

The remaining work is no longer primarily the construction of a combat engine
from scratch. The implemented foundations already include serializable state,
resolution frames, pending decisions, effect execution, lifecycle handling,
and scheduling. Most remaining work is therefore a missing _variant of shared
architecture_, not an isolated move problem.

Do not use a move-by-move discovery loop as the primary workflow:

```text
find next unsupported move
        -> determine why it fails
        -> add a capability
        -> repeat
```

Instead, start each catalog-closure cycle by taking **all** current
`unsupported-in-scope` occurrences from the generated matrix, grouping them by
their missing capability, and maintaining an architecture-gap register. Order
the resulting capabilities by their dependencies and fanout, implement the
highest-fanout dependency-ready primitive, regenerate the matrix, and repeat:

```text
all unsupported-in-scope occurrences
        -> group by missing capability
        -> architecture-gap register
        -> dependency-order capabilities
        -> implement highest-fanout ready primitive
        -> regenerate matrix
        -> repeat
```

The matrix remains the authoritative per-occurrence evidence. The register is
the planning view derived from it: it must distinguish “this architecture is
needed” from “this move happens to need that architecture,” so one capability
is implemented and proven once rather than rediscovered for each affected
definition. The roadmap owns the phases; the register is not a set of new
architecture phases.

### Architecture-gap register

Use these buckets when grouping the in-scope matrix rows. Split or merge a
bucket only when the dependency or implementation shape is materially
different.

| Architecture gap                                    | Roadmap owner                          | What it unlocks                                                       |
| --------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Explicit selection cardinality and optionality gaps | CE-200                                 | Definitions the runtime cannot yet interpret safely                   |
| Missing resolution-local values                     | CE-320                                 | Effects needing current damage, cost, roll, or other resolution state |
| Persisted selected or resolved values               | CE-330                                 | Effects whose chosen or resolved state must survive suspension        |
| Generic candidate resolution                        | CE-400                                 | Player-selectable moves, targets, and effects                         |
| Shared selector gaps                                | CE-410                                 | Reusable legal candidate matching                                     |
| Generic pending selection                           | CE-420                                 | The large choice-dependent occurrence bucket                          |
| Generic deterministic effect resume                 | CE-430                                 | The same choice-dependent bucket after the player answers             |
| Lifecycle metadata and durations                    | CE-500–540                             | Persistent and expiring effects                                       |
| Calculation pipeline gaps                           | CE-600–660                             | More complex damage, roll, and cost variants                          |
| Scheduling gaps                                     | CE-700–750                             | Deferred actions and effects                                          |
| Reroll and reaction lifecycle gaps                  | CE-650 / CE-740-ish                    | Remaining reaction variants                                           |
| Truly missing executor shapes                       | CE-110/120 plus the owning later phase | Residual effects not covered by a shared gap above                    |

Every active register entry must record all of the following:

| Field                | Required record                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability           | The reusable architecture addition, for example `generic pending move selection`                                                                          |
| Roadmap              | Owning phase or phases, for example CE-400 / CE-410 / CE-420 / CE-430                                                                                     |
| Blocked occurrences  | `N` affected occurrences across `M` definitions, linked back to their matrix rows                                                                         |
| Dependencies         | Capabilities that must be complete first, such as normalized selection semantics and the required shared selector dimensions                              |
| Implementation shape | The durable contract to add, for example persist candidate IDs plus a continuation, validate the exact offered choice, then resume the compiled operation |
| Proof case           | One representative converted move with focused public coverage; the matrix must then show every newly supported occurrence                                |

When a primitive is implemented, regenerate the matrix before choosing the
next register entry. A representative proof case establishes the generic
contract; it does not by itself convert unrelated variants whose matrix rows
still name a different missing capability.

## Immediate resume point

### Latest implementation slice (2026-08-21) - next-turn power-up resource scheduling

The generic `modify-resource.v1` executor now covers the exact declarative
`on-power-up` self-resource variant whose scope is the next self turn. It
converts the effect into a serialized one-shot `scheduled-resource` with a
deterministic `turn-start` boundary and `turnsAfter: 1`; the power-up
transition therefore does not grant the resource early. The existing scheduler
applies and expires the work at the matching public turn boundary, with the
existing state-version and active-effect invariants validating the transition.

This closes Energy Slasher's converted +2 KI effect when the persisted prior
action is a stopped physical attack. Compiler validation deliberately limits
the generic slice to durable amounts and rejects caps, costs, durations, and
limits that the scheduled-resource contract cannot represent. No move-name
branch or source-text interpretation was added.

Focused public coverage in `progress-fight.test.ts` verifies the prior-action
condition, absence of an immediate KI grant, and serialized schedule. The
generated capability matrix and `combat-capability-matrix.test.ts` classify
the occurrence as `supported-generic`. The matrix now records 825
`supported-generic`, 166 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. The next ranked prerequisite is generic
pending-choice handling for `modify-damage`; the remaining catalog-closure
work is active.

### Latest implementation slice (2026-08-21) - stopped-fraction action lock

The generic effect executor now evaluates the declarative
`stopped-hit-fraction` condition from the persisted per-die attack outcomes.
It requires a non-empty roll set and applies the strict `stopped * 2 > total`
boundary, so equal halves, blocked dice, and missing phase-local rolls do not
trigger the condition. Move selectors used by this path also enforce their
declared minimum-dice and maximum-sides bounds.

This closes Anger Manipulation's `on-stopped` next-turn LOCK through the
existing versioned action-lock transition. The lock is serialized as one
target-local turn duration and is checked by the existing fight invariants;
the resource companion remains explicitly unsupported because its converted
`source-move-ki-cost` amount is not available in this trigger context. The
engine does not infer the attack cost from the source prose or substitute a
different numeric expression.

Focused public coverage in `move-effects-runtime.test.ts` verifies the strict
boundary, multi-die selector, blocked-die behavior, and serialized next-turn
duration. `effect-executors.test.ts` verifies compiler acceptance of the lock
and rejection of the unresolved resource amount. The generated capability
matrix and `combat-capability-matrix.test.ts` account for both Anger rows.

The regenerated matrix now records 824 `supported-generic`, 167
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 4 typed compiled damage
or resolution-local state, 115 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. The next ranked generic family remains
`modify-resource`; catalog closure remains active.

### Latest implementation slice (2026-08-21) - copied attack execution

The generic `copy-move-effect.v1` executor now covers the exact Flashback
variant: a self action-phase effect selects the last unrestricted self attack,
resolves the immutable source move snapshot through the ordinary converted
attack transition, pays the selected source move's base Ki cost, and adds its
literal Power-percent damage bonus. The copying skill's restricted uses remain
owned by the copying move, while pending defense and post-defense frames retain
the source move ID and bonus so resume never reselects mutable or source-text
state.

The executor deliberately rejects the other converted copy variants, including
selected prior opponent moves, copied dice or source modifiers, half-base-damage
per-die behavior, and requirement bypasses. Those rows remain explicitly
unsupported with typed prerequisites; no move-name branch or source-text
fallback was added.

Focused public coverage verifies legal-decision availability only after a
matching source attack, deterministic source-cost and damage behavior, durable
pending-defense metadata, state-version advancement, invariant validation, and
compiler rejection of a different copy variant. The capability matrix and
executor registry tests cover the same generic boundary.

The regenerated matrix now records 823 `supported-generic`, 168
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 4 typed compiled damage
or resolution-local state, 116 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. The next ranked generic family is
`modify-resource`; catalog closure remains active.

### Latest implementation slice (2026-08-21) - blocked-damage floating snapshots

The generic `create-floating-effect.v1` lifecycle now persists an immutable
`blockedAttackDamage` snapshot when a block effect creates a floating bundle.
The snapshot is carried through the serializable active-effect state, checked
by the fight invariants, and supplied to nested effects when the bundle is
later dispatched. This closes Display of Endurance's exact `on-stopped`
blocked-damage heal without executing source prose or adding a move-name
branch. The block response path uses the same typed floating constructor for
basic and converted attacks.

Focused public coverage in `basic-attack.test.ts` verifies the finalized
blocked-damage snapshot, deterministic turn progression, the next successful
converted attack's heal, and one-shot floating-effect consumption.
`move-effects-runtime.test.ts` verifies the typed nested numeric context, and
`combat-capability-matrix.test.ts` verifies the converted occurrence's generic
executor record. The regenerated matrix now accounts for 822
`supported-generic`, 169 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences.

The remaining five in-scope `create-floating-effect` rows still require exact
unsupported lifecycle or context capabilities, including per-die
`on-roll-result` activation and unavailable-condition state; they remain
explicitly tracked in the matrix.

### Latest implementation slice (2026-08-21) — deferred stopped-result scheduling

The generic `set-combat-result.v1` executor now covers the exact declarative
`on-stopped` form that sets the next matching attack's current-attack result to
`STOPPED`. It persists a one-shot, selector-aware `modify-next-action` effect
with source effect provenance, consumes it during the target's next attack,
and validates the transition through the existing state invariants. The typed
`defense-response` condition is evaluated from the deterministic current
resolution context, so Tranquil Strike's no-block/no-reroll/no-result-modifier
condition is not approximated.

This closes the converted Tranquil Strike and Underdog Evasion result effects
without move-name branches. Blocked converted and basic attacks use the same
active-effect primitive. Focused public coverage in `progress-fight.test.ts`
verifies creation, forced stopped resolution, consumption, and version
increments; `combat-capability-matrix.test.ts` verifies both converted rows.
The regenerated matrix now accounts for 820 `supported-generic`, 171
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences.

The remaining four in-scope `set-combat-result` rows are deliberately not
approximated: Dazzling Gymnastics and Living Voodoo require matching-die
semantics, while Manipulation Mastery requires an optional before-defense
choice and result reversal. The next ranked families are the tied
five-occurrence `copy-move-effect`, `create-floating-effect`,
`modify-resource`, and `suppress` slices.

### Latest implementation slice (2026-08-21) — passive extra-action policy

The generic `grant-extra-action.v2` scheduler now materializes the exact
passive non-CONSTANT Skill policy variant at the owning combatant's upkeep.
The executor resolves the declarative passive effect, persists a turn-scoped
allowance with its source definition and effect index, filters legal decisions
to matching Skill actions, and consumes the allowance through the existing
immutable transition path. The lifecycle is deterministic and invariant
checked; no source text or move-name branch is used.

A public `progress-fight.test.ts` scenario covers the two-action boundary,
same-Skill reuse, legal-decision filtering, turn bounds, and allowance
consumption. The matrix/compiler test classifies Aoyosumu Technique Mastery's
passive `grant-extra-action` occurrence as `supported-generic` through the
shared `extra-action-scheduler`. Its separate `modify-slot-capacity` effect
remains explicitly unsupported.

The regenerated matrix now accounts for 820 `supported-generic`, 171
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 4 typed compiled damage or
resolution-local state, 119 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. The next ranked families are the tied
five-occurrence `copy-move-effect`, `create-floating-effect`,
`modify-resource`, and `suppress` slices; catalog closure remains active.

### Previous implementation slice (2026-08-21) — critical on-damage context

The generic `modify-damage.v1` executor now accepts a typed current-attack
critical result in the `on-damage` resolution context. The finalized action
record, including the critical outcome, is passed into the existing defensive
on-damage dispatch before damage is committed. Critical Mass Mastery's 1.5x
damage multiplier is covered through the public transition, runtime,
compiler, and matrix tests without source-text evaluation or a move-name
branch.

The regenerated matrix now accounts for 819 `supported-generic`, 172
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The four
remaining typed damage-context rows retain explicit unsupported status because
they require selected-move storage, activation-cost choice, player-selected
attack targeting, or skipped-turn scheduling. The next ranked matrix priority
is the tied five-occurrence typed-executor family led by `copy-move-effect`.

### Latest implementation slice (2026-08-16) — action-phase extra-action scheduling

The generic extra-action scheduler now executes non-optional action-phase
allowances from simple action moves. The existing durable
`ActiveExtraActionEffect` lifecycle is reused: condition evaluation occurs
against the current public transition context, allowances are persisted with
their source effect index and turn bounds, legal decisions are filtered before
submission, and consumption increments the immutable state version.

The simple-action classifier now admits the generic action-phase
`create-floating-effect` and `grant-extra-action` primitives that the executor
already resolves. This closes the condition-aware Petrifying Spit, Special
Fighting Pose 3, and Willing Sacrifice allowances without definition-specific
branches. The capability is versioned as `grant-extra-action.v2`.

Focused public coverage in `progress-fight.test.ts` verifies creation,
condition evaluation, durable effect persistence, legal-decision filtering,
and the state-version increment through `createFight`,
`advanceFight`, `enumerateLegalDecisions`, and `submitCombatDecision`.
`combat-capability-matrix.test.ts` verifies all three converted action-phase
occurrences are classified as `supported-generic`. The regenerated matrix now
accounts for 789 `supported-generic`, 202 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences.

The remaining extra-action rows are intentionally not approximated: upkeep
decision boundaries, optional or activation-cost choices, passive policies,
and per-die `on-roll-result` scheduling still require their own serialized
mechanics. The next highest-volume prerequisite is the nine-occurrence
`modify-resource` slice in the generated matrix.

### Latest implementation slice — complete active-scope `modify-roll`

The active transformation scope has no remaining `modify-roll` occurrences
classified as `unsupported-in-scope`. The regenerated occurrence-level matrix
contains 129 active-scope `modify-roll` rows, all classified
`supported-generic` through `roll-modifier.v1`; its 86 exact trigger/target/
scope/duration/operation/numeric/cap/selector/condition variant groups remain
visible in the generated table. The supported inventory covers:

- Triggers: `start-combat`, `action-phase`, `passive`, `before-attack-roll`,
  `before-defense-roll`, `after-defense-roll`, `on-success`, `on-stopped`,
  `on-roll-result`, `on-power-up`, `on-resource-gain`, and `on-resource-drain`.
- Targets and selectors: `self` and `opponent`, including move selectors,
  constant-skill selectors, present selectors, and matching active effects.
- Scopes and lifecycle: current action, next action(s), next roll(s),
  following action, next turn, next phase, combat, and unscoped effects;
  combat, turns, until-combat-result, until-resource-threshold, and
  turns-or-until-perfect-roll durations.
- Roll semantics: attack, defense, escape, initiative, and transformation
  definitions; dice, sides, result, multiplier, selected-dice-count, and
  stopped-hit-count numeric forms; additive and cap-only modifiers; maximum,
  minimum, and allow-exceed caps; and roll-die-result, roll-threshold,
  location, level, transformation-mastery, prior-action, prior-turn,
  move-modification, move-effect-active, combat-result, resource-threshold,
  and selector conditions.
- Choice and ordering behavior: serialized optional and activation-group
  choices, prevention precedence, matching-roll consumption, per-die
  before-attack evaluation, natural-versus-modified results, durable pending
  numeric selections, deterministic replay, and invariant-checked state
  versions.

Focused public coverage now includes Kinetic Outburst's grouped
before-attack choice, Multi-Form numeric selection/resume, start-combat
initiative modifiers, caps, selectors, condition matching, persistence/resume,
natural-versus-modified roll results, and per-die result conditions in
`progress-fight.test.ts`, `attack-rolls.test.ts`, and
`move-effects-runtime.test.ts`. `npm run test:coverage` passed with 43 test
files and 628 tests, and the final `npm run quality` gate passed.

The remaining in-scope work is non-`modify-roll` work: 205 occurrence rows
remain `unsupported-in-scope`, including `modify-roll-modifier` and other
effect families. The next resume point is to take the highest-volume
dependency-ready non-`modify-roll` family from the generated matrix, without
reclassifying unfinished rows as out of scope.

### Latest implementation slice (2026-08-14) — generic damage context

The `modify-damage` executor now covers two additional declarative variants
without definition-specific branches:

- Cap-only passive current-action modifiers resolve the declared cap against
  the final damage value, including Tornado Uppercut's maximum of 55% Power.
  The cap-only representation is explicit in the durable damage modifier
  contract, so it cannot be confused with a zero-valued additive modifier.
- `prior-attack-damage-percent` evaluates from persisted action history. It
  selects the opponent's last two successful Advanced Attacks that targeted the
  current combatant, records their dealt damage at the public attack transition,
  and converts the total back to the attacker's Power percentage for Vengeance
  Wave. Missing historical damage never becomes an implicit zero.

Focused coverage in `move-effects-runtime.test.ts` verifies both variants;
the public transition paths retain deterministic state versions, action
history, and invariant validation. The regenerated matrix now accounts for
786 `supported-generic`, 205 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. The remaining `modify-damage` rows are
still explicitly unsupported where they require pending choices, unresolved
conditions, or resolution-local critical/response context.

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

## 2026-08-14 combat-duration floating bundle slice

The generic `create-floating-effect.v1` executor now accepts an explicit
`duration: combat` declaration. This is a semantic normalization, not an
approximation: the existing active floating-effect contract already represents
the same remainder-of-combat lifecycle as `scope: combat`. Other floating
durations remain rejected until their termination transitions can be persisted.

Nested floating effects can now compile their declared `on-move-use` listeners
through the same typed executor path. The standalone on-move-use restriction is
unchanged; only the already-supported active floating bundle dispatch receives
this narrow validation context. The public The Rising Sun transition verifies
that its successful attack creates an invariant-checked combat-scoped floating
effect, advances the state version once, and retains the source identity and
target. No source text or move-name branch was added.

The regenerated matrix now records 741 `supported-generic`, 250
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 69 generic pending-choice, 11 typed compiled-damage or
resolution-context, 167 typed executor or compiled-plan, and 3 typed reroll
reaction lifecycle occurrences. Every out-of-scope occurrence retains its
documented approved exclusion, and the goal remains active because the 250
in-scope unsupported occurrences are not yet closed. Focused compiler, floating
runtime, public-transition, and capability-matrix checks are required evidence
for this slice and pass. The independent coverage run passes all 43 test files
and 614 tests at 77.09% global branch coverage. The single final
`npm run quality` gate passes formatting, lint, reference and game-data
validation, combat-boundary validation, the full test suite and build, coverage
thresholds, duplication detection, and the production dependency audit.
The next highest-volume ready prerequisite remains the generic pending-choice
and deterministic-resume slice; its 69 occurrences remain explicitly
unsupported until the suspended operation can retain all required
resolution-local context.

## 2026-08-15 serialized pending-effect choice slice

The generic pending-choice transition now supports the exact grouped
`before-attack-roll` variants used by Straining Bodyslam and Straining
Knockback. A deterministic pending decision serializes the ordered effect
indices and state version before defense or randomness; activation and decline
both resume through the normal public attack transition. Selected indices are
carried through the defense frame so an activated group is not rediscovered or
applied twice. HP percentage loss, scheduled Ki loss, and Advanced Attack cost
modification continue to use their existing generic executors. Invariants
validate the serialized frame and option references, and no move-name or source
text branch was added.

Focused compiler, runtime, capability-matrix, and public transition tests cover
explicit compiler authorization, activation, decline, state-version changes,
defense suspension, resource application, and duplicate-prevention behavior.
The regenerated matrix now records 745 `supported-generic`, 246
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The
generic pending-choice prerequisite is reduced to 65 occurrences across 42
definitions; unrelated optional and activation-group variants remain
explicitly unsupported, including selection, lifecycle, and multi-effect
semantics that this slice does not persist. Every out-of-scope occurrence
retains its documented approved exclusion, and the goal remains active.
The independent coverage run passes all 43 test files and 619 tests at 77.34%
global branch coverage. The single final `npm run quality` gate passes the
format, lint, validation, full test and build, coverage, duplication, and
production dependency audit stages.

## 2026-08-15 generic CONSTANT Skill activation slice

The generic `activate` executor now covers the exact selector-driven
`on-success` CONSTANT Skill activation variant. The compiler authorizes
self-targeted source selectors that identify CONSTANT Skills by category or
explicit move IDs, while rejecting repeat, alternate activation, activation
cost, and unsupported trigger semantics. The runtime retains the selected move
IDs, source effect identity, pending-decision version, authorized combatant,
and activation operation in a serializable effect frame. Resuming the public
`select-move` decision performs the canonical CONSTANT Skill eligibility,
prevention, restricted-use, KI-cost, reactivation, active-effect, move-use, and
event transitions through the normal invariant-checked state boundary.

Focused public behavior covers Monkey Sweep: the successful attack creates a
deterministic activation selection, decline remains available for optional
activation, and selecting Monkey Maneuvers charges its KI cost, increments its
use count, creates the active CONSTANT effect, advances the version, and
clears the suspended frame. Compiler and runtime tests cover the registered
executor and declarative application. No move-name branch or source-text
execution was added.

The regenerated matrix now records 749 `supported-generic`, 242
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The
generic pending-choice prerequisite is reduced to 62 occurrences across 39
definitions; typed compiled-damage or resolution-context remains at 11,
typed executor or compiled-plan accounting at 166, and typed reroll reaction
lifecycle at 3. The newly supported activation rows are Monkey Sweep, Tricky
Sword Maneuvers, and Triple Torpedo. Activation variants requiring repeat,
selection-key, alternate activation, activation-cost, style-scoped selector,
or non-successful timing remain explicitly unsupported. Every out-of-scope
occurrence retains its documented approved exclusion, and the catalog-closure
goal remains active.

## 2026-08-15 generic grouped pre-roll choice slice

The generic pending-choice runtime now supports complete optional or activation
groups whose effects all target the current `before-attack-roll` lifecycle and
compile through the existing pending-effect executor authorization. The
serialized pending decision retains the exact ordered effect indices and
resumes through the existing public attack transition without rediscovering or
reapplying the selected group. Groups remain atomic: a group with any
unsupported effect, trigger, target, activation lifecycle, or nested selection
is left unsupported rather than partially enabled.

Supernova is covered publicly through `createFight`, `advanceFight`, and
`submitCombatDecision`. Selecting its grouped `+2 KI` cost and `1d35`
roll-definition effects charges the optional cost only on resume and applies
the selected roll definition before the deterministic attack roll. The shared
cost and roll-resolution pipelines now consume the selected effect context;
no move-name or source-text execution branch was added. Focused matrix,
runtime, compiler, and public-transition tests cover group classification,
selection, decline, exact effect indices, state-version advancement, KI
payment, roll-definition behavior, and duplicate-prevention behavior.

The regenerated matrix now records 751 `supported-generic`, 240
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The generic
pending-choice prerequisite is reduced to 60 occurrences across 38 definitions;
typed compiled-damage or resolution-context remains at 11, typed executor or
compiled-plan accounting at 166, and typed reroll reaction lifecycle at 3.
Every out-of-scope occurrence retains its documented approved exclusion, and
the catalog-closure goal remains active.

## 2026-08-15 generic grouped after-defense choice slice

The generic pending-choice transition now supports complete optional or
activation groups on the `after-defense-roll` lifecycle when their typed roll
and combat-result effects compile through the existing executor authorization.
Group discovery is atomic across target selectors: when one member matches, the
ordered group is offered so dependent conditions can evaluate against the
selected group's modified result. The pending option serializes the exact move
and effect indices, and the post-defense frame retains the natural attack and
defense rolls plus numeric and result overrides until the public decision is
accepted.

On selection, declarative activation costs are evaluated from the persisted
roll context, checked against the acting combatant's KI, and charged exactly
once. The selected effect indices resume through the normal attack resolver;
numeric roll modifications are applied before dependent result conditions, and
CRITICAL overrides are resolved without emitting duplicate roll events. The
transition remains immutable, version-incrementing, deterministic, and
invariant-checked. Super Galick Gun is covered through `createFight`,
`advanceFight`, and `submitCombatDecision`, including persisted natural rolls,
the grouped +10 result and CRITICAL effects, KI payment, final resolution, and
duplicate-prevention behavior. No move-name branch or source-text execution was
added.

The regenerated matrix now records 753 `supported-generic`, 238
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The generic
pending-choice prerequisite is reduced to 55 occurrences across 34 definitions;
typed compiled-damage or resolution-context remains at 11, typed executor or
compiled-plan accounting at 166, and typed reroll reaction lifecycle at 6.
Remaining grouped-choice work includes unsupported effect variants, nested
selection, and broader grouped activation-cost semantics; these remain visible
as prerequisites rather than being approximated. Every out-of-scope occurrence
retains its documented approved exclusion, and the catalog-closure goal remains
active.

## 2026-08-15 generic attack-prevention negation slice

The generic `negate.v1` executor now covers the exact action-phase
`prevent-attack` variant: an opponent-targeted negation removes matching
serialized `action-lock(attack)` and full-action `action-restriction` effects from the
target. The transition is generic and provenance-preserving; it does not infer
partial category restrictions, status removal, current-resolution prevention,
damage negation, selectors, or activation-cost and limit semantics that are not
retained by this slice.

The public `submitCombatDecision` transition remains immutable, increments the
state version once, emits an `effect-negated` event for each removed active
effect, and validates the resulting state through the existing invariant
boundary. Focused compiler, runtime, and public-transition tests cover
registration, legal action exposure, both serialized attack-prevention effect
families, event identity, removal, and version advancement. No move-name branch,
source-text execution, or silent approximation was added.

The regenerated matrix now records 754 `supported-generic`, 237
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The
remaining unsupported rows continue to be tracked under generic pending-choice
(55), typed compiled-damage or resolution-context (11), typed executor or
compiled-plan accounting (165), and typed reroll reaction lifecycle (6)
prerequisites. Damage negation, selector-specific negation, status negation,
and other lifecycle variants remain explicitly unsupported. Every out-of-scope
occurrence retains its documented approved exclusion, and the catalog-closure
goal remains active.

## 2026-08-15 deferred damage-percent lifecycle slice

The generic damage executor now preserves a declared `damage-percent` basis when
an `on-success` damage modifier targets a later action. The basis is carried
through the durable `modify-next-action` contract, validated as an invariant,
and applied against the later attack's resolved damage rather than being
mistaken for a flat Power-percent amount. Selector-only descriptions with no
move constraints also match eligible basic attacks, so a deferred “next attack”
effect does not remain stranded when the follow-up action is a basic attack.

The public transition test covers Freestyle Underdog Dropkick against a
higher-level opponent through `createFight`, `advanceFight`, and
`submitCombatDecision`. It verifies the persisted basis and target, the
10-percent reduction against a 100-Power basic attack, one-time consumption,
state-version advancement, and the empty post-resolution active-effect set.
The implementation is generic; it does not inspect move names or source prose.

The capability matrix now recognizes the already-implemented level-comparison
condition for damage modifiers and classifies Underdog Dropkick's deferred
damage response as `supported-generic` through `damage-modifier.v1`. The
regenerated matrix records 781 `supported-generic`, 210
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 10 typed compiled-damage or
resolution-context, 145 typed executor or compiled-plan, and 6 typed reroll
reaction-lifecycle occurrences. The remaining damage rows require explicit
stored-roll, critical-resolution, optional-choice, or unsupported trigger
context and remain visible rather than being approximated.

Focused combat-engine typecheck and `progress-fight.test.ts` checks pass.
Coverage and the single final `npm run quality` gate remain required before
handoff.

## 2026-08-15 capability-priority reporting

The generated capability matrix now retains its prerequisite summary and adds a
ranked breakdown by prerequisite and concrete effect type. Ranking uses unsupported occurrence count first and distinct definition count
second, making the next generic slice visible inside broad accounting buckets
without changing runtime support or treating a family-level executor as
complete. The generated matrix is authoritative for the current ranking:
`modify-damage` under typed compiled damage context and resolution-local state
is now the highest-volume unresolved variant at 10 occurrences across 10
definitions. The earlier `modify-roll` priority note is superseded by the
regenerated occurrence-level report.

## 2026-08-15 upkeep deferred-damage accounting slice

The capability classifier now recognizes the already-implemented generic
`modify-next-action` lifecycle for self-targeted `modify-damage` effects emitted
at the `upkeep-phase` boundary. The classification is intentionally limited to
effects without activation costs or use limits; those require separate durable
consumption semantics and remain unsupported. The runtime continues to resolve
the typed percentage against the owning combatant's Power and persists the
declared next-action count through the normal immutable, versioned, invariant-
checked transition. No source text or move-name branch participates in the
classification or execution.

Kaio-Ken's exact three-attack `+(10% Power)` occurrence is now
`supported-generic` through `damage-modifier.v1`. The public upkeep transition
test asserts the persisted damage basis, amount, operation, and remaining
action count. The regenerated matrix records 782 `supported-generic`, 209
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 9 typed compiled-damage or
resolution-context, 145 typed executor or compiled-plan, and 6 typed reroll
reaction-lifecycle occurrences. The next ranked prerequisite is now
`create-floating-effect` under typed executor accounting; the remaining
compiled-damage rows require stored context, selected targets, critical
resolution, or durable use-limit semantics and remain explicitly unsupported.

## 2026-08-15 combat-result floating lifecycle slice

The generic `create-floating-effect.v1` executor now persists the supported
`until-combat-result` lifecycle instead of rejecting every non-combat duration.
The active floating-effect contract records the actor-resolved combatant,
successful or stopped result, move selector, and one literal attack or defense
roll threshold. The attack-resolution transition evaluates those fields against
the persisted move and roll results, expires the bundle immutably, advances the
state version once, and validates combatant references and finite thresholds
through the invariant boundary.

The same generic lifecycle now honors `stacking: prevent` by retaining one
matching source/target/floating-effect identity, while `stacking: allow` remains
unchanged. Ki Jammer's converted effect is covered through the public
`createFight`, `advanceFight`, and `submitCombatDecision` path, including its
normalized threshold and non-stacking state. No source text or move-name branch
participates in compilation or execution; durations with unsupported result,
condition, cost, limit, or pending-choice semantics remain explicitly rejected.

The regenerated matrix records 784 `supported-generic`, 207
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 9 typed compiled-damage or
resolution-context, 143 typed executor or compiled-plan, and 6 typed reroll
reaction-lifecycle occurrences. Every out-of-scope occurrence retains its
documented approved exclusion, and the catalog-closure goal remains active.

## 2026-08-15 on-power-up resource activation-cost slice

The generic `modify-resource.v1` executor now carries a resolved activation
cost and source effect index through immediate resource changes. The transition
boundary pays each eligible cost once, rejects the benefit when the owning
combatant cannot satisfy the declared cost or minimum, and applies the cost and
benefit as one immutable, versioned, invariant-checked resource transition.
Start-combat costs use the same generic path. Immediate `on-power-up` effects
may also declare the bounded once-per-turn limit, which is enforced by the
power-up lifecycle rather than by a move-specific rule.

The public `progress-fight.test.ts` coverage exercises Haokiru Reserves through
`createFight`, `advanceFight`, `enumerateLegalDecisions`, and
`submitCombatDecision`. It verifies the HP benefit, net KI change after the
activation cost, structured KI event, legal power-up exposure, and state-version
advancement. No source-text execution or move-name branch was added.

The regenerated matrix now records 790 `supported-generic`, 201
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The
typed-executor accounting bucket is 139 occurrences; its next ranked slice is
`create-floating-effect` at 8 occurrences, followed by 8 remaining
`modify-resource` occurrences. Remaining resource rows require persisted SP
combat context, deferred scopes, resource-event cost or use-limit accounting,
stored-roll context, or other explicit lifecycle primitives and remain
unsupported. Every out-of-scope occurrence retains its documented approved
exclusion, and the catalog-closure goal remains active.

## 2026-08-20 floating activation-cost lifecycle slice

The generic `create-floating-effect.v1` executor now supports the exact
self-targeted `upkeep-phase` activation-cost variant. The typed runtime
application retains the source effect index, resolved HP or KI cost, minimum,
and one-per-combat limit. Before upkeep mutations are applied, the transition
checks the persisted active-effect identity and current resource availability;
an eligible creation pays its cost and creates the floating bundle in the same
immutable transition, while an unaffordable or already-consumed creation is
omitted without charging a partial cost. The active effect is invariant-checked
and the public transition advances the state version once and emits the normal
resource and activation events.

Hidden Power Level is covered through `createFight` and `advanceFight`, with
runtime and compiler tests covering the serialized application metadata,
two-KI payment, durable source identity, event output, and state-version
advance. No source text or move-name branch was added. The exact Fall 7 Times,
Get Up 8 occurrence remains unsupported because its nested relative resolution
threshold has no explicit typed add or multiply operation. Other floating rows
requiring roll-threshold termination, optional selection, unsupported condition
context, or unsupported nested resource exclusions remain explicitly
unsupported.

The regenerated matrix now records 791 `supported-generic`, 200
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 7 typed compiled damage or
resolution-local state, 138 typed executor or compiled-plan, and 6 typed reroll
reaction-lifecycle occurrences. The next ranked typed-executor slices are
`modify-resource` and `set-combat-result` at 8 occurrences each; every
out-of-scope definition retains its documented approved exclusion and the
catalog-closure goal remains active.

## 2026-08-20 after-defense per-die combat-result slice

The generic `set-combat-result.v1` executor now supports the exact
`after-defense-roll` and `matching-die` lifecycle for declarative successful or
stopped results. Source moves are discovered from active constants and owned
reaction definitions, each die is evaluated against the persisted attack and
defense results, and paid or use-limited reactions retain their source move,
effect index, die index, resolved KI cost, and combat use accounting across the
versioned post-defense frame. Automatic results and selected reactions use the
same generic source/effect path; unsupported current-attack, next-action,
before-defense, and on-stopped result transitions remain explicitly rejected.

Close Shave and Energy Redirection are covered through the public basic-attack
decision boundary. Tests verify the persisted per-die stop, serialized
reaction option identity, one-KI payment, source move-use increment, resumed
successful outcome, and invariant-checked state transition. No source prose or
move-name branch participates in this executor path.

The regenerated matrix now records 793 `supported-generic`, 198
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 7 typed compiled damage or
resolution-local state, 136 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor slice is
`modify-resource` at 8 occurrences; every out-of-scope definition retains its
documented approved exclusion and the catalog-closure goal remains active.

## 2026-08-20 deferred modify-resource next-action slice

The generic `modify-resource.v1` executor now supports the exact deferred
damage-based resource variant: a `damage-percent` amount with a `next-action`
scope. The runtime persists this as a typed, opponent- or self-targeted
`modify-next-action` resource modifier, resolves the percentage from the later
attack's final damage, applies the immutable HP or KI transition with existing
prevention rules, consumes the one-shot modifier only after a matching attack,
and validates the serialized shape through the combat invariant boundary.
Basic and converted attacks use the same deterministic resource transition;
basic attacks also emit the resource event and normalize a defeated attacker.

Psycho Driver is covered through the public fight transition path, including
the serialized modifier, exact target, 20 percent damage result, HP event,
one-shot consumption, and state-version advance. No source text or move-name
branch participates in execution, and deferred variants with activation costs,
caps, or durations remain rejected rather than approximated.

The regenerated matrix now records 794 `supported-generic`, 197
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. The typed
executor accounting bucket is 135 occurrences; its next ranked slices are
`create-floating-effect` at 7 and `negate` at 7. The seven remaining typed
`modify-resource` rows are Akaikaru Shotgun Blast's roll-modified trigger,
Freestyle Anger Manipulation's stopped-hit-fraction condition, Haokiru Dragon's
Pride's SP comparison, Haokiru Display of Endurance's blocked-attack-damage
amount, Kiihakai Energy Slasher's deferred power-up trigger, Kurokonwaku Ki
Trap's stored-roll condition, and Kurokonwaku Bloodletter's duration-bound
resource event. Each remains explicitly excluded in the matrix with its
required missing lifecycle or context; every other in-scope converted effect
has generic or named coverage, and every out-of-scope definition retains an
approved exclusion.

## 2026-08-20 floating attack-roll threshold duration slice

The generic `create-floating-effect.v1` executor now supports the exact
`until-roll-threshold` duration for attack and defense rolls. The runtime
persists the target-local roll, comparison, threshold, optional move selector,
and source move's turn-scoped one-use limit in typed state. Expiry is evaluated
from the deterministic persisted roll context, and the resulting active effect
passes the existing versioned transition and invariant checks.

Haokiru Dragon Dust is covered through compiler, runtime, and public fight
transition tests. Its retaliation effect is created after a successful move,
expires after the target's attack roll reaches 23, and cannot be created twice
from the same source move during one turn because the generic executor checks
persisted action history. No source text or move-name branch participates in
this behavior. Transformation-roll thresholds, per-die creation, unsupported
condition context, unsupported nested numeric/resource semantics, and optional
effect selection remain explicitly rejected in the matrix.

The regenerated matrix now records 795 `supported-generic`, 196
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 7 typed compiled damage or
resolution-local state, 134 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor slices
are `modify-resource` and `negate` at 7 occurrences each. The six remaining
typed `create-floating-effect` rows are Afterlife Solar Flare's target-relation
condition, Akaikaru Backflip Kick's per-die creation, Freestyle Monkey Sweep's
activation-unavailable condition, Haokiru Display of Endurance's blocked-attack
damage amount, Kurokonwaku Vampiric Lust's unsupported nested resource shape,
and Midorikatai Fall 7 Times Get Up 8's unresolved relative roll threshold.
Midorikatai Not Over Till It's Over remains a documented pending-choice
exclusion. Every out-of-scope definition retains its approved exclusion, and
the catalog-closure goal remains active.

## 2026-08-20 turn-window resource-event slice

The generic `modify-resource.v1` executor now supports the exact
turn-limited `on-resource-gain` and `on-resource-drain` variant when the effect
has no deferred scope, cap, activation cost, or use limit. Runtime matching
uses the source definition's most recent successful move action in persisted
action history, excludes the activation turn, and applies only through the
declared number of following owner turns. This makes the duration boundary
explicit and replay-safe instead of treating a duration-bearing resource event
as an immediate unbounded change.

Bloodletter is covered through `createFight`, `advanceFight`, and
`submitCombatDecision`: after a successful Bloodletter, the owner's following
Cannonball drains 3 KI rather than 2, emits one resource event, advances the
state version once, and leaves no hidden lifecycle state. The compiler,
runtime, matrix, and public transition tests all use the generic source and
effect path; no move-name branch or source-text evaluation participates.

The regenerated matrix now records 796 `supported-generic`, 195
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 7 typed compiled damage or
resolution-local state, 133 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor slice is
`negate` at 7 occurrences; the remaining resource rows still require pending
choices, stored-roll context, roll-modification dispatch, SP context, blocked-
attack damage context, power-up scheduling, or resource-event lifecycle
variants beyond this exact turn-window capability. Every out-of-scope
definition retains its approved exclusion, and the catalog-closure goal
remains active.

## 2026-08-20 combat-result negation slice

The generic `negate.v1` executor now supports the exact post-defense
`on-combat-result` branch for an opponent's critical or counter when the
converted effect has a KI activation cost, including the typed
`triggering-move-ki-cost` expression and minimum-cost invariant. The runtime
dispatches the matching outcome from the persisted post-defense roll, exposes
one serialized activation option for the owning source effect, deducts the
evaluated cost through the versioned reaction transition, and resumes the
attack with the selected critical or counter result prevented. The outcome,
source definition, effect index, and state version remain explicit; no source
text or move-name branch participates in execution.

Cancellation Mastery's critical branch is covered through the public
`createFight`, `advanceFight`, and `submitCombatDecision` boundary with
deterministic natural rolls. Compiler and matrix tests cover both the critical
and counter rows. The Kurokonwaku stun row, on-move-use negations, and other
negation lifecycles remain explicitly unsupported because they require status,
move-selection, or different trigger context that this tranche does not
possess; none is approximated.

The regenerated matrix now records 798 `supported-generic`, 193
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 7 typed compiled damage or
resolution-local state, 131 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor slices
are `modify-damage` at 7 and `create-floating-effect` at 6 occurrences.
Every out-of-scope definition retains its approved exclusion, and the
catalog-closure goal remains active.

## 2026-08-21 generic damage-modifier lifecycle slice

The generic `modify-damage` executor now supports the exact action-phase and
upkeep-phase durable variants with positive combat-scoped use limits. The
runtime preserves source effect provenance, enforces `stacking=prevent` from
durable state, and accounts for each accepted upkeep activation in the
persisted source move's combat use count. These transitions remain
deterministic, versioned, and invariant-checked; they use the existing
`modify-next-action` primitive rather than move-name dispatch.

Special Fighting Pose 1 and Midorikatai War Cry are now covered through the
generic compiler and public fight transitions. War Cry's two combat-limited
upkeep activations are each materialized once, do not stack, and do not
activate a third time. Focused compiler, matrix, and public transition tests
cover the capability and its boundaries.

Quiet Preparation remains unsupported because its activation cost requires a
serialized pending choice and its source describes a counter-phase zero-cost
activation that cannot be silently treated as the typed action-phase effect.
Kiihakai Power Boost remains unsupported because its damage effect requires
the persisted prior-turn `turn-skipped` restriction and compiled damage
context. Neither mechanic is approximated, and no source-text semantics are
executed.

The regenerated matrix now records 800 `supported-generic`, 191
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 5 typed compiled damage
or resolution-local state, 131 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked ready slices are
`create-floating-effect`, `grant-extra-action`, and `modify-resource` under
typed executor accounting; catalog closure remains active.

## 2026-08-21 floating target-relation slice

The generic `create-floating-effect.v1` executor now supports nested
`target-relation` conditions when the relation is the exact
`same-as-source-effect-target` form. The runtime records the relation target
as a durable combatant ID when the bundle is created, carries it through the
versioned active-effect transition, and supplies the in-progress action target
to the nested condition evaluator. Invalid relation references are rejected
by the existing fight-state invariant validation.

Solar Flare is covered through `createFight`, `advanceFight`, and
`submitCombatDecision`: its same-turn bundle retains the opponent, changes the
matching single-die Kamehameha attack to 1d35 and its defense to 1d25, and is
consumed after that next action. The compiler, runtime, matrix, and public
transition tests all exercise the generic path. No source text or move-name
branch participates in execution.

The remaining five typed `create-floating-effect` rows are still explicitly
unsupported: Akaikaru Backflip Kick's per-die creation, Freestyle Monkey
Sweep's activation-unavailable condition, Haokiru Display of Endurance's
blocked-attack damage amount, Kurokonwaku Vampiric Lust's nested resource
shape, and Midorikatai Fall 7 Times Get Up 8's unresolved relative roll
threshold. The regenerated matrix now records 801 `supported-generic`, 190
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 5 typed compiled damage or
resolution-local state, 130 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor family
is `grant-extra-action` at six occurrences, with each row requiring a distinct
upkeep, activation-cost, passive-policy, or per-die scheduling context rather
than a blanket approximation. The catalog-closure goal remains active.

## 2026-08-21 on-roll-result extra-action slice

The generic `grant-extra-action.v1` executor now supports the exact
`on-roll-result` variant where a typed single-die attack selector and an
at-least attack-roll threshold are both present. Kiihakai Synergy's converted
effect now records its canonical `skill` and `constant` selectors in structured
game data; the runtime evaluates the persisted completed attack roll and
dispatches active constant source effects without reading source prose or
branching on the move name. Extra-action applications retain their typed source
definition ID, so the durable action and combat-use accounting remain attached
to Synergy rather than the triggering attack.

Synergy is covered through the public `createFight`, `advanceFight`, and
`submitCombatDecision` boundary with a deterministic threshold roll. A
single-die Focus Buster attack at 25 grants one remaining constant-skill action,
while the legal action set exposes the selected constant skill and does not
silently broaden the result to other move categories. The transition remains
versioned and invariant-checked; the existing compiler and matrix tests cover
the accepted condition shape and its occurrence record.

The remaining five typed `grant-extra-action` rows are explicitly unsupported:
Kiihakai Synergy's other scheduling context still needs its end-phase
activation boundary, while the remaining rows require activation-cost choices,
upkeep scheduling, passive action-policy context, or per-die scheduling data
that is not fully represented by the current typed effect contract. Basic
attacks are not inferred as move-selector matches when no typed
`MoveDefinition` triggering context exists. These mechanics remain visible in
the matrix and are not approximated.

The regenerated matrix now records 802 `supported-generic`, 189
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 5 typed compiled damage or
resolution-local state, 129 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor family
is `modify-resource` at six occurrences; catalog closure remains active.

## 2026-08-21 current-attack combat-outcome slice

The generic `grant-combat-outcome.v1` executor now supports the exact
current-attack form: after a successful source attack, a typed `break`,
`sever`, or `stun` outcome is materialized as the corresponding opponent
status through the existing status lifecycle. `combat-turn` exact matching is
also available as a typed runtime condition. The compiler rejects selectors,
deferred scopes, durations, activation choices, and other separate lifecycles
for this slice; the runtime consumes only the structured effect and persisted
turn/roll context, never source text.

Guldo Special's BREAK and SEVER thresholds, Akaikaru Delta Storm's last-die
SEVER threshold, and Midorikatai Breaker Breaker's first-turn BREAK are covered
by compiler, runtime, matrix, and public `createFight`, `advanceFight`, and
`submitCombatDecision` tests. The public transition preserves source
provenance, applies the one-turn status, advances the state version once, and
emits the typed status event under invariant validation. No move-name branch is
used.

Kiihakai Ki Barbs remains explicitly unsupported: its STUN outcome is attached
to a future-turn Advanced Attack or Signature Technique selected by a typed
selector and requires all dice to succeed. Supporting it needs durable
next-action selector scheduling and the corresponding multi-die resolution
context; treating it as an immediate current-attack outcome would change the
rule and is not allowed.

The regenerated matrix now records 806 `supported-generic`, 185
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 5 typed compiled damage
or resolution-local state, 125 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked typed-executor family
is `modify-resource` at six occurrences; catalog closure remains active.

## Blocked attack damage numeric context — Display of Endurance

The generic numeric evaluator now supports the typed `blocked-attack-damage`
expression. A block transition resolves block effects only after the attack
roll has produced its finalized damage, then supplies that value to the
generic resource executor. The value is rounded with the established numeric
evaluation rule, and the transition continues to use the existing version,
event-sequence, and invariant validation paths.

Display of Endurance's immediate `on-stopped` HP loss is covered by runtime,
compiler/matrix, and public `submitCombatDecision` tests using a deterministic
two-die energy attack. The nested next-attack heal remains explicitly
unsupported: its effect would need a durable snapshot of the blocked damage
across the floating effect lifecycle. No source text or move-name branch is
used, and missing phase-local context returns no resource change.

The regenerated matrix now records 807 `supported-generic`, 184
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 49 generic pending-choice, 5 typed compiled damage
or resolution-local state, 124 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. The next ranked family is the
generic pending-choice `modify-damage` slice at six occurrences; catalog
closure remains active.

## 2026-08-21 post-roll on-success pending-choice slice

The generic pending-effect transition now supports the exact grouped
`on-success` choice whose selected effects contain a current-action damage
replacement and a CONSTANT Skill deactivation. The attack resolves its
natural rolls once, emits those factual roll events before suspending, and
retains the natural rolls, block and pre-roll item selections, result
overrides, and prior effect selections in the serializable resolution frame.
Declining or accepting the group resumes through the normal attack transition;
the accepted damage replacement is applied once and any eligible deactivation
continues through the existing generic move-selection frame.

Kiihakai Orange Burst is covered through `createFight`, `advanceFight`, and
`submitCombatDecision`. The public test verifies the serialized post-roll
choice, exact natural-roll preservation, 20% Power damage, single KI payment,
state-version advancement, and absence of duplicate roll events on resume.
Compiler and matrix tests cover both effects in the atomic group. This slice
uses only typed trigger, effect, and lifecycle shapes; it does not read source
text or branch on the move name.

The regenerated matrix now records 809 `supported-generic`, 182
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 5 typed compiled damage
or resolution-local state, 124 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. Other on-success choices remain
unsupported when their effect family, activation selection, or deferred
scheduling context is not covered by this exact group contract; catalog
closure remains active.

## 2026-08-21 counted next-actions cost slice

The generic `modify-next-action` primitive now supports a counted `cost`
modifier with explicit add/set operation, optional finite minimum and maximum
bounds, and deterministic remaining-count consumption. `modify-cost` effects
with `scope: next-actions` are converted into durable invariant-checked
combat effects; each matching action applies the modifier and decrements the
count, removing the effect at zero. The current-action cost path and legacy
advanced-attack cost path remain separate, so unsupported variants are not
silently broadened.

Kurokonwaku Sixty Second Meltdown's grouped `on-success` choice is covered
end-to-end. Accepting the group creates two more action-phase advanced-attack
allowances and a two-action `-1 KI` cost modifier bounded at 1. A public
deterministic transition test verifies the serialized choice, one-time attack
cost payment, durable effect shape, second-action cost, state-version
advancement, and counted remainder. Executor and matrix tests identify both
converted effects as generic coverage. The implementation uses typed effect
shape and lifecycle state only; it does not execute source text or branch on
the move name.

The regenerated matrix now records 811 `supported-generic`, 180
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 5 typed compiled damage
or resolution-local state, 124 typed executor or compiled-plan, and 6 typed
reroll reaction-lifecycle occurrences. Other counted cost variants and
on-success choices remain unsupported until their exact selector, prevention,
or scheduling semantics have a generic contract; catalog closure remains
active.

## 2026-08-21 optional post-defense reroll slice

The generic `reroll.v1` reaction executor now receives matrix coverage for
optional post-defense rerolls when the typed effect plan and serialized
post-defense reaction frame are both supported. Swift Reaction, Zen Explosion,
and Second Chance already resolve through that public transition path; the
matrix previously rejected them solely because `optional: true` was checked
before pending-choice-aware compilation. The correction preserves selector,
threshold, use-limit, activation-cost, and state-version behavior instead of
flattening those details into an automatic effect.

Focused public transitions cover all three choices, including Swift Reaction's
KI payment and move selector, Zen Explosion's defense threshold, and Second
Chance's bounded use limit and persisted defense replacement. The matrix test
asserts all three rows use `reroll.v1` and the `reroll-reaction` executor. Future
roll and stored-roll rerolls remain explicitly unsupported because their
durable listener context is not present; no source text or move-name dispatch
is used.

The regenerated matrix now records 814 `supported-generic`, 177
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 5 typed compiled damage
or resolution-local state, 124 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. Catalog closure remains active.

## 2026-08-21 on-deactivated trigger slice

The generic deactivation boundary now dispatches typed `on-deactivated`
listeners after each constant skill is durably marked deactivated. The
deactivated move is retained as `triggeringMove`, so numeric expressions such
as Redirected Energy's `triggering-move-ki-cost` resolve from the actual skill
being deactivated. Representable lock and cost applications enter the normal
active-effect lifecycle; cost listeners use a selector-aware `next-action`
modifier and are consumed by the ordinary attack transition.

A public transition test covers the deactivation selection, state-versioned
resume, factual deactivation event, invariant validation, and Redirected
Energy's durable selector/cost effect. The matrix/compiler tests classify
Unquenchable Bloodthirst and Redirected Energy as generic coverage. Fierce
Focus's two optional `negate-deactivation` effects remain unsupported because
prevention must be selected before mutation through a serialized choice; they
are not silently applied after deactivation. No source text or move-name
branch is executable.

The regenerated matrix now records 816 `supported-generic`, 175
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 5 typed compiled damage
or resolution-local state, 122 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. The next ranked family is
`set-combat-result`; catalog closure remains active.

## 2026-08-21 critical on-damage context slice

The generic `modify-damage.v1` executor now accepts a typed current-attack
critical result in the `on-damage` resolution context. The finalized action
record, including the critical outcome, is passed into the existing defensive
on-damage dispatch before damage is committed; the effect remains a declarative
`damage-percent` multiplier and uses the ordinary immutable damage pipeline.
Compiler validation no longer rejects this exact critical-result form, and the
transition remains deterministic, state-versioned, and invariant-checked.

Midorikatai Critical Mass Mastery's 1.5x damage reduction is covered through
the public attack transition, the runtime condition/effect path, the compiled
executor, and the generated matrix. The implementation does not read source
text or branch on the move name. The four remaining typed damage-context rows
stay explicitly unsupported: Impulsive requires durable selected-move storage,
Quiet Preparation requires an activation-cost choice and counter-phase
boundary, Lights Out Strike requires a player-selected opponent attack, and
Power Boost requires persisted skipped-turn scheduling. None is broadened by
this slice.

The regenerated matrix now records 819 `supported-generic`, 172
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 4 typed compiled damage or
resolution-local state, 120 typed executor or compiled-plan, and 3 typed reroll
reaction-lifecycle occurrences. The next ranked families are the tied
five-occurrence `copy-move-effect`, `create-floating-effect`,
`grant-extra-action`, `modify-resource`, `modify-cost`, and `negate` slices;
catalog closure remains active.

## 2026-08-21 passive extra-action policy slice

The generic `grant-extra-action.v2` executor now covers passive policies that
grant a positive number of non-CONSTANT Skill actions for the current turn.
At upkeep, the engine evaluates the passive declarative effect for the active
combatant and persists an `ActiveExtraActionEffect` with the resolved count,
turn bounds, source definition, and source effect index. The ordinary public
legal-decision and consumption transitions enforce the declared Skill-only
policy and decrement the allowance without bypassing state versioning or
invariant validation.

Focused public coverage verifies that Technique Mastery permits two uses of
the same non-CONSTANT Skill, rejects other action categories while the policy
is available, and removes the allowance after the second use. The capability
matrix and compiler tests cover the generic executor classification. The
separate slot-capacity effect on the same definition remains unsupported and
is not inferred from this scheduler capability.

The regenerated matrix now records 820 `supported-generic`, 171
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 4 typed compiled damage or
resolution-local state, 119 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. The next ranked families are the tied
five-occurrence `copy-move-effect`, `create-floating-effect`,
`modify-resource`, and `suppress` slices; catalog closure remains active.

## 2026-08-22 grouped on-power-up damage-choice slice

The generic pending-choice boundary now supports the exact Kiihakai Ki Barbs
`on-power-up` damage alternatives. A serialized, versioned effect-choice frame
offers the `+15%` and `+25%` branches separately even though the converted
definitions share an activation group; all-optional group members are treated
as alternatives, while mixed groups remain atomic. Accepting a branch charges
its typed KI activation cost once and persists the selected `next-action`
damage modifier through the existing invariant-checked active-effect lifecycle.

Focused public coverage verifies the pending decision, selected effect index,
state-version advancement, exact 2-KI charge, durable `+15% Power` modifier,
and absence of the unselected `+25%` branch. Compiler and matrix tests cover
both alternatives. The separate deferred multi-dice STUN effect remains
explicitly unsupported because its future-action result context is not yet
serialized. No source text or move-name branch is executable.

The regenerated matrix now records 827 `supported-generic`, 164
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 4 typed compiled damage or
resolution-local state, 114 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. Catalog closure remains active.

## 2026-08-22 serialized on-move-use cost-choice slice

The generic pending-choice boundary now supports the exact Haokiru Channeling
Mastery effect that lets a Signature Technique pay 10% of current HP for a
typed `-3 KI` current-action cost modifier with a minimum of 3 KI. The listener
source move is persisted separately from the attack move in the versioned
`awaiting-effect-choice` frame, and the selected effect index is carried through
any defense request before resolution.

The transition evaluates the HP activation amount deterministically from the
selected combat state, verifies activation-resource availability before the
attack can resolve, pays that resource exactly once, applies the cost modifier
before KI payment, and validates the resulting state through the existing
invariant boundary. Focused public coverage verifies the serialized choice,
source move, selected index, exact 20 HP charge from 200 current HP, reduced
4-KI payment from a 7-KI Signature Technique, state-version advancement, and
closed resolution frame. Compiler, runtime, and matrix tests cover the exact
optional shape. Other Channeling Mastery `on-move-use` effects and other
optional cost variants remain explicitly unsupported; no source text or
move-name branch is executable.

The regenerated matrix now records 828 `supported-generic`, 163
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 42 generic pending-choice, 4 typed compiled damage or
resolution-local state, 114 typed executor or compiled-plan, and 3 typed
reroll reaction-lifecycle occurrences. Catalog closure remains active.

## 2026-08-22 serialized on-cost-modified Creationist choice slice

The generic pending-choice boundary now supports the exact Haokiru Creationist
alternatives that activate when a Haokiru effect modifies the current attack's
cost. The two declarative `modify-cost` branches are serialized as distinct
effect-index alternatives: one adds `0` with a minimum of `0`, and the other
adds `-1` KI. The source move, trigger, selected effect indices, and alternative
sets are retained in versioned resolution frames; exclusive activation groups
cannot be silently collapsed into an arbitrary branch.

The transition re-evaluates the typed current-action cost modifier from the
selected alternative, suppresses the resolved alternative group on resume, and
passes the selected source and indices through defense before charging the
attack. Public tests cover the three pending options, selected `-1` behavior,
exact KI payment, state-version advancement, frame metadata, and invariant
validation. Compiler, runtime, and capability-matrix tests cover the generic
exclusive-group shape. Unsupported cost variants remain explicit; no source
text or move-name branch is executable.

The regenerated matrix now records 824 `supported-generic`, 167
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 48 generic pending-choice, 4 typed compiled damage or
resolution-local state, 114 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. Catalog closure remains active.

## 2026-08-22 source-aware generic cost-expression slice

The generic cost executor now resolves the source-aware `prior-move-activation-count`
and `source-move-calculated-ki-cost` numeric expressions from authoritative combat
state. Prior activation counts use the source combatant's durable move-use counter;
calculated source costs evaluate the source move's declarative Ki-cost definition.
Scope-omitted passive `modify-cost` effects now materialize as immediate
current-action modifiers through the shared cost pipeline, including constant-skill
activation costs. No move-name branch or source-text inference was added.

The transition remains deterministic and versioned: effective activation cost is
resolved before affordability validation, paid exactly once, persisted as the
active constant's `paidActivationCost`, and checked by the existing fight-state
invariants. Focused public coverage verifies Impulsive's second activation charge,
while runtime coverage verifies Shadow Stalker and Sweet Dreams source-aware cost
resolution. The deferred Kiihakai BOOMerang `next-move-ki-cost` expression remains
explicitly unsupported because its future opponent action is not serialized.

The regenerated matrix now records 827 `supported-generic`, 164
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 48 generic pending-choice, 4 typed compiled damage or
resolution-local state, 111 typed executor or compiled-plan, and 1 typed reroll
reaction-lifecycle occurrence. Catalog closure remains active.

## 2026-08-22 typed STUN negation slice

The generic `negate.v1` post-defense reaction now recognizes typed STUN as a
combat-result outcome alongside CRITICAL and COUNTER. The post-defense
classifier derives STUN from the converted move's typed successful-effect
result, and the selected serialized reaction carries the outcome through a
versioned transition. Resume applies the ordinary KI activation-cost pipeline
and filters only the typed STUN status application before invariant validation;
the implementation does not branch on the triggering move name or execute
source prose.

Focused public coverage uses Akaikaru Hypersonic Knockout and Kurokonwaku
Cancellation Mastery to verify the pending STUN-negation option, exact `X-1`
KI payment, one-version transition, removal of the STUN status, and closed
resolution frame. Compiler, runtime, and matrix tests cover the exact
`on-combat-result` condition shape. Cancellation Mastery's remaining
on-move-use deactivate and negate effects remain unsupported because their
targeted skill lifecycle and serialized action-phase selection are not covered
by this primitive; the other three in-scope negate rows remain explicit typed
executor work.

The regenerated matrix now records 828 `supported-generic`, 163
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 48 generic pending-choice, 4 typed compiled damage or
resolution-local state, 110 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. Catalog closure remains active.

## 2026-08-22 grouped CONSTANT Skill reactivation slice

The generic activation executor now supports the exact Kiihakai Rollback
Barrage variant: `successful-hit-count-groups` resolves from the completed
attack, and each group becomes one distinct CONSTANT Skill reactivation choice.
The normalized activation application carries a positive selection limit and a
typed reactivation-only constraint; it can select only constants with a durable
`deactivated` lifecycle. Each response reuses the same versioned effect frame,
removes the selected move from the remaining eligible set, and either creates
the next pending choice or closes the frame. KI payment, move-use accounting,
active-constant lifecycle, event sequencing, and state invariants remain part of
the public transition.

Focused compiler, runtime, and public tests cover four deterministic successful
dice, two serialized reactivation choices, exact KI payment, lifecycle reuse,
and frame closure. The implementation evaluates typed data only; it does not
execute source prose or branch on Rollback Barrage's name. Halcyon Blow remains
unsupported because `last-turn` HP history is not authoritative in the current
state model. Fierce Focus remains unsupported because start-combat selection
and its zero-cost activation need a distinct serialized choice contract;
Synergy remains unsupported because its on-roll-result choice is deferred to a
next-phase END boundary. Those variants remain explicit matrix exclusions.

The regenerated matrix now records 829 `supported-generic`, 162
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 4 typed compiled damage or
resolution-local state, 110 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. Catalog closure remains active.

## 2026-08-22 stored-roll move-selection slice

The generic stored-roll executor now covers the exact `select-move-by-stored-roll`
primitive. A typed, invariant-checked `storedMoveSelections` combatant record
retains the source definition, selection key, selected move, and selection turn.
During upkeep, the executor resolves the stored one-based natural result against
the combatant's current ordered moveset and selector, replacing or removing the
key deterministically when the moveset changes. The transition emits a
`move-selection-updated` event after the corresponding stored roll, advances the
state version once, and preserves event sequencing across both combatants.

The selected key is now available to the generic `stored-move-selection`
condition. Active CONSTANT Skills can expose a typed selected-move force-action
instruction before the public action decision; the forced decision accepts only
the retained move (or the declared pass), while passive damage and cost modifiers
apply only when the triggering move equals that selection. Compiler, runtime, and
public `advanceFight`/`enumerateLegalDecisions` tests cover the exact Impulsive
selection, reindexing contract, event, and selected/unselected behavior. No
source prose or move-name branch is executable.

The regenerated matrix now records 832 `supported-generic`, 159
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 3 typed compiled damage or
resolution-local state, 108 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. The six-family catalog is still open; all
remaining out-of-scope definitions retain explicit approved exclusions in the
matrix.

## 2026-08-22 upkeep-phase extra-action slice

The generic extra-action scheduler now supports the exact next-turn upkeep
variants for Afterlife Destructo Disc and Aoyosumu Sky Dance Technique. The
compiler accepts only the typed `grant-extra-action.v2` shape with an
upkeep-phase, next-turn scope and no activation cost; it preserves the declared
power-up or constant-skill action and rejects variants that still require an
unmodeled pending choice. The implementation is phase-generic and does not
branch on either move name or execute converted source prose.

After normal upkeep effects resolve, the public fight transition retains a
serializable `phase: upkeep` extra-action frame when the active combatant has
one of these allowances. The matching decision is exposed through
`enumerateLegalDecisions`, consumes exactly one versioned transition, removes
the allowance, and then advances normally. The same-phase boundary emits no
spurious phase-change event; event sequencing and invariant validation remain
deterministic. Focused compiler, runtime, and public `advanceFight` tests cover
the thresholded and constant-skill forms, the upkeep phase, legal-decision
filtering, and frame closure.

Launching Kick remains unsupported because its activation cost requires a
pending choice, and Akaikaru Limb Twist remains unsupported for the same
unmodeled choice boundary. Those exclusions remain explicit in the matrix.

The regenerated matrix now records 834 `supported-generic`, 157
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 3 typed compiled damage or
resolution-local state, 106 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. The six-family catalog is still open; all
remaining out-of-scope definitions retain explicit approved exclusions in the
matrix.

## 2026-08-22 combat-local moveset removal slice

The generic `remove-move-from-combat.v1` executor now covers the exact automatic
source-move variants for Aoyosumu Breakout and Freestyle Nullifying Sphere. A
successful/action-phase effect resolves to a durable, combat-local active effect
with source definition, effect index, removed move ID, original moveset index,
and `combat` duration. The public transition removes the move from the
authoritative `moveIds` record, cleans dependent per-move counters and stored
selections, emits a typed removal event, and exposes the updated legal decisions.

The transition is immutable, versioned, event-sequenced, and checked by the
fight-state invariants; no source prose or move-name branch is executable.
Selector-based target removal and until-perfect-roll restoration remain explicit
unsupported variants because they require a serialized move-selection and
restoration frame. The matrix records those pending/typed prerequisites rather
than selecting a target or silently treating temporary removal as permanent.

Focused compiler, runtime, and public transition tests cover the registered
executor, typed application, source removal, active-effect provenance, event,
state version, invariant validity, and legal-decision filtering.

The regenerated matrix now records 836 `supported-generic`, 155
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 3 typed compiled damage or
resolution-local state, 104 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. The six-family catalog remains open; all
remaining out-of-scope definitions retain explicit approved exclusions in the
matrix.

## 2026-08-22 source-aware activation-cost slice

The generic `activate.v1` executor now covers the exact source-aware KI cost
variant for Kurokonwaku Shadow Stalker. Its typed activation application
resolves `source-move-ki-cost` against the source definition, persists the
resolved amount and minimum in the versioned effect-selection frame, and the
public response transition charges the greater of the normal effective cost
and the declarative activation cost exactly once. Nonnegative cost invariants,
state-version progression, active-constant provenance, and frame closure are
checked at the transition boundary. The implementation remains generic and
does not execute converted source prose or branch on the move name.

Focused compiler, runtime, and public transition tests cover the source-aware
cost resolution and serialized-cost resume behavior. The remaining activation
rows for `asIf: power-up`, `repeatUntil`, and keyed/all-source selection (with
Big Shot's delayed deactivation) remain explicit typed executor exclusions;
they are not approximated by ordinary activation. The active transformation
scope remains Humans, Saiyans, Hybrid-Saiyans, Namekians, Changelings, and
Bio-Androids, with no structured transformation effects treated as executable
in this slice.

The regenerated matrix now records 837 `supported-generic`, 154
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 3 typed compiled damage or
resolution-local state, 103 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. Every remaining out-of-scope definition
continues to carry an explicit approved exclusion in the matrix.

## 2026-08-22 selected-opponent copied attack slice

The generic `copy-move-effect.v1` executor now covers the exact selected
opponent Advanced Attack variant used by Mimicry Mastery. At the action
boundary it serializes the opponent's currently owned eligible move IDs and
the original decision ID in an invariant-checked `select-move` frame. The
selected move is then resolved through the ordinary converted-attack
transition as an immutable source snapshot, with the copying move paying its
literal cost and consuming its one-per-combat use limit. Pending defense and
result frames retain copied-move provenance, and state versions, event IDs,
and frame IDs remain injected and deterministic.

The compiler accepts only this exact generic shape: action-phase self target,
opponent-owned Advanced Attack selection, successful source-move resolution,
requirements ignored, and one combat use. Follow Up, Karmic Possession, and
Mind Reading remain explicitly unsupported because their converted semantics
require different prior-action or effect-result context; copied dice,
source-modifier context, and those selection boundaries are not silently
approximated. No source prose or move-name branch is executable.

Focused compiler, matrix, and public `enumerateLegalDecisions` /
`submitCombatDecision` coverage verifies deterministic selection serialization,
the copied attack's provenance and damage, exact KI/use accounting, frame
closure, and invariant validation. The regenerated matrix now records 838
`supported-generic`, 153 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining prerequisite buckets are 47
generic pending-choice, 3 typed compiled damage or resolution-local state,
102 typed executor or compiled-plan, and 1 typed reroll reaction-lifecycle
occurrence. Every out-of-scope definition retains an explicit approved
exclusion in the matrix; catalog closure remains active.

## 2026-08-22 relative floating-threshold slice

The generic `create-floating-effect.v1` executor now covers the exact Fall 7
Times, Get Up 8 variant whose next low-cost Advanced Attack requires a defense
result at least two times the attack result. The converted definition records
that relationship explicitly as `relativeTo: "attack-roll"` with
`relativeOperation: "multiply"`; the executor preserves the typed operation in
the active floating effect and the existing resolution-threshold runtime
applies it against the current attack roll. No source prose is interpreted at
runtime and no move-name branch was added.

The public upkeep transition test verifies the two-stopped-action condition,
the one-KI activation, serialized floating-effect provenance and threshold,
state progression, and consumption after the next matching attack. The
compiler and invariant path therefore reject an omitted or ambiguous relative
operation instead of silently treating it as addition or a literal threshold.

The remaining `create-floating-effect` rows are still explicit exclusions: the
Not Over Till It's Over optional selection requires the pending-choice
lifecycle, while the remaining typed rows require their own unsupported nested
resource or activation-context contracts. The regenerated matrix now records
839 `supported-generic`, 152 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining prerequisite buckets are 47
generic pending-choice, 3 typed compiled damage or resolution-local state, 101
typed executor or compiled-plan, and 1 typed reroll reaction-lifecycle
occurrence. Every out-of-scope definition retains an explicit approved
exclusion in the matrix; catalog closure remains active.

## 2026-08-23 stopped-skill listener and triggering-cost slice

The generic stopped-result transition now dispatches exact `on-stopped`
listeners from the acting combatant's carried non-CONSTANT Skills. The
listener path evaluates its declarative conditions against the persisted
multi-die attack rolls and triggering move, respects the source move's
restricted-use limit, applies its resource and durable effects through the
ordinary versioned transition, and increments the listener's durable use
count. The path is generic by effect trigger and move category; it does not
branch on Anger Manipulation or interpret source prose.

Anger Manipulation's converted KI reward now uses the typed
`triggering-move-ki-cost` expression, which resolves the performed attack's
authoritative KI cost rather than the listener skill's zero cost. Its next-turn
LOCK retains the listener source definition, and the public transition test
verifies the stopped boundary, exact one-KI net result after Firestorm's cost,
listener use accounting, active-lock provenance, state-version increment, and
KI event. Compiler, runtime, game-data, and capability-matrix tests cover the
same generic shape.

The regenerated matrix now records 840 `supported-generic`, 151
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 3 typed compiled damage or
resolution-local state, 100 typed executor or compiled-plan, and 1 typed
reroll reaction-lifecycle occurrence. Every remaining out-of-scope definition
continues to carry an explicit approved exclusion; catalog closure remains
active.

## 2026-08-23 successful-effect negation listener slice

The generic successful-effect negation executor now accepts the exact
non-deferred listener shape: one successful opponent combat-result condition,
one target-relative move selector, no activation cost or lifecycle, and no
prevent-attack approximation. During a successful converted attack, the
versioned resolver discovers matching carried or active-constant listener
definitions, evaluates their typed conditions against the persisted current
action and triggering move, remaps their effects to the action participants,
and suppresses only the triggering move's declarative effect set when the
selector matches. Base attack damage and the listener's own transition remain
separate, so negation does not silently erase the attack itself.

The public transition test covers The Untroubled Mind against Firestorm and
asserts the successful result, version increment, and absence of Firestorm's
next-action effect. Compiler and runtime tests cover selector provenance.
Optional activation-cost negations and the special attack-reaction shape remain
unsupported because they require serialized choice context; those rows retain
their explicit matrix reasons rather than being auto-activated.

The regenerated matrix now records 841 `supported-generic`, 150
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 47 generic pending-choice, 3 typed compiled damage or
resolution-local state, 99 typed executor or compiled-plan, and 1 typed reroll
reaction-lifecycle occurrence. Every remaining out-of-scope definition
continues to carry an explicit approved exclusion; catalog closure remains
active.

## 2026-08-23 current-resolution suppression slice

The generic \`suppress.v1\` executor now represents a declared
current-resolution lifecycle for the exact \`before-defense-roll\` and
\`on-success\` variants that carry explicit aspects. Runtime applications retain
selectors declared either directly or as typed \`move-selector\` conditions.
Current suppressions remain resolution-local and are never persisted as durable
active effects.

The versioned attack transition now dispatches the current move's
\`before-defense-roll\` suppression into its own resolution context and applies
matching carried or active-constant \`on-success\` listener suppressions before
the triggering move's declarative successful effects are materialized. Base
attack damage and listener transitions remain separate. Focused compiler,
runtime, and public transition tests cover Aoyosumu Breakout against Firestorm;
the existing Mimicry Mastery copied-attack transition also exercises the
before-defense path. The copy choice remains unsupported and is still tracked
as a pending-choice prerequisite.

The regenerated matrix records 843 \`supported-generic\`, 148
\`unsupported-in-scope\`, and 129 \`audited-out-of-scope\` occurrences. The
remaining suppression rows are not silently broadened: Showdown and Against
the Odds omit an executable suppression aspect, while Breaking the Cycle still
requires a serialized optional choice. Remaining prerequisite buckets are 47
generic pending-choice, 3 typed compiled damage or resolution-local state, 99
typed executor or compiled-plan, and 1 typed reroll reaction-lifecycle
occurrence. Every remaining out-of-scope definition continues to carry an
explicit approved exclusion; catalog closure remains active.

## 2026-08-23 deferred reroll lifecycle slice

The generic \`reroll.v1\` executor now supports exact successful-effect rerolls
with typed \`next-action\`, \`next-roll\`, and counted \`next-rolls\` lifecycles.
Applications preserve source/effect identity, target relation, selectors,
future-roll conditions, optionality, use limits, bonuses, and deterministic
duration state. Active rerolls are serialized in the existing post-defense
resolution frame; mandatory rerolls omit the decline option, optional rerolls
remain selectable, and duration consumption is invariant-checked and expires
after the matching action or roll even when an optional choice is declined.

Focused public transition coverage verifies a targeted Braced Energy Beam
reroll, including its future attack threshold, mandatory reaction, turn use
limit, version increment, rerolled natural result, and expiration. Compiler and
runtime coverage verifies Tiger Strikes' optional next defensive reroll with
its +3 result modifier. Willing Sacrifice's before-defense future choice and Ki
Trap's stored-roll on-roll-result choices remain explicit pending-choice
exclusions; no source prose is executed.

The regenerated matrix now records 845 \`supported-generic\`, 146
\`unsupported-in-scope\`, and 129 \`audited-out-of-scope\` occurrences. The
remaining prerequisite buckets are 46 generic pending-choice, 3 typed compiled
damage or resolution-local state, and 97 typed executor or compiled-plan.
Every remaining out-of-scope definition continues to carry an explicit
approved exclusion; catalog closure remains active.

## 2026-08-23 deferred matching-die result slice

The generic `set-combat-result.v1` executor now supports the exact deferred
matching-die stopped-result lifecycle represented by Living Voodoo. Its
future move-selector condition is retained as typed selector metadata rather
than evaluated against the stopped triggering attack. The serialized
`modify-next-action` effect preserves source/effect identity, target relation,
result scope, selector, and one-shot scope; invariants accept both current
attack and matching-die result scopes only for the declared next-action
modifier shape. The attack transition applies the matching-die result to every
successful die (already-stopped dice remain stopped) and consumes the effect
after the first matching unrestricted action.

Focused compiler and public transition tests cover Living Voodoo through a
stopped Skill, an intervening counter/pass boundary, and the owner's next
unrestricted attack. The transition remains immutable, versioned, and
deterministic; no source prose or move-name branch is used. Basic attacks are
matched as unrestricted actions through the generic selector bridge.

The regenerated matrix now records 846 `supported-generic`, 145
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 46 generic pending-choice, 3 typed compiled damage or
resolution-local state, and 96 typed executor or compiled-plan. The remaining
in-scope `set-combat-result` rows are Dazzling Gymnastics' block-time
multi-die stop and Manipulation Mastery's optional before-defense result
reversal; both remain explicitly unsupported because their serialized timing
or choice state is not represented. Every remaining out-of-scope definition
continues to carry an explicit approved exclusion; catalog closure remains
active.

## 2026-08-23 on-damage defender-choice slice

The generic `damage-modifier.v1` executor now supports the exact serialized
on-damage response shape used by Muscle Infusion: an opponent-targeted additive
current-action modifier with an activation cost, combat use limit, and typed
successful advanced-attack condition. The compiler admits this shape only when
the pending-choice path is explicitly enabled; deterministic on-damage
modifiers and unsupported response variants remain separately classified.

The versioned converted-attack transition now discovers matching mastery or
active-constant listeners, serializes the listener source, selected effect
indices, natural rolls, and defender decision ownership, then resumes the same
attack without rerolling. Activation costs are applied to the defender, and
`effectUseCounts` records the source definition/effect index so combat use
limits survive the transition. Invariants require positive integer effect-use
counts, valid source frames, and pending decisions owned by the defender for
this trigger. Focused compiler, runtime, and public transition tests cover the
activation path and its persisted use accounting.

The regenerated matrix now records 847 `supported-generic`, 144
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 45 generic pending-choice, 3 typed compiled damage or
resolution-local state, and 96 typed executor or compiled-plan occurrences.
The remaining 45 pending-choice occurrences are not widened by this slice:
they require different timing, resource, effect-group, or selection semantics.
Every remaining out-of-scope definition continues to carry an explicit
approved exclusion; catalog closure remains active.

## 2026-08-23 phase-aware CONSTANT Skill activation slice

The generic `activate.v1` executor now preserves trigger provenance and
declarative effect identity for CONSTANT Skill choices across three supported
boundaries: immediate start-combat selection, existing successful-action
selection, and an `on-roll-result` selection deferred to the owner's END
phase. Start-combat Fierce Focus pairs its typed absolute zero-cost
`modify-cost` companion with the selected Skill; the serialized frame retains
that override and the resume transition charges exactly zero KI. Synergy's
single-die threshold creates unresolved END-phase work rather than exposing a
choice during the action phase. Both paths reuse selector validation, restricted
use checks, versioned transitions, and invariant-checked pending decisions.

Focused public coverage verifies Fierce Focus's start-combat decision and
zero-cost activation, the Synergy deferred frame, and existing before-roll and
successful-action activation behavior. The compiler and capability matrix
cover the paired cost override and deferred trigger variants. Halcyon's
last-turn HP-gain activation remains explicitly unsupported: its pending
choice is not treated as unconditional until durable resource-change history
exists.

The regenerated matrix now records 849 `supported-generic`, 141
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 3 typed compiled damage or
resolution-local state, and 95 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 following-action damage and skipped-turn history slice

The generic `damage-modifier.v1` executor now supports the exact passive
following-action variant used by Power Boost: a self-targeted additive modifier
with an offset of one action and a prior-turn restriction. The runtime resolves
the restriction against the owner's latest earlier turn, not the immediately
preceding global turn number, so alternating combatant turns cannot change the
meaning of the declarative condition. The existing generic damage pipeline then
applies the typed literal modifier to the selected attack.

Full-action restrictions now append a durable, typed `turn-skipped` action record
with an explicit status/effect reason. It is versioned with the same immutable
transition, participates in invariant validation, and does not consume a player
decision ID. This history is the generic fact consumed by prior-turn conditions;
Power Boost's separate optional skip-action choice remains explicitly
unsupported because its serialized pending-choice semantics are not yet
represented.

Focused public transition coverage verifies the skipped history boundary and a
subsequent Kamehameha resolving at 50% Power plus Power Boost's declared +20
damage. The capability-matrix test and regenerated report cover the exact
following-action row; Quiet Preparation and Lights Out Strike remain explicit
typed-damage exclusions rather than being approximated.

The regenerated matrix now records 850 `supported-generic`, 140
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 95 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 bounded repeat-until CONSTANT Skill activation slice

The generic `activate.v2` executor now supports the exact
`active-move-count-matches-opponent` repeat-until variant used by Vile Energy.
At the on-success boundary, the runtime computes the opponent's active
matching CONSTANT Skill count minus the owner's active matching count, clamps
the result at zero, and serializes that bounded selection count in the
versioned effect frame. Existing selector validation, KI costs, restricted
uses, pending choices, immutable transitions, and invariant checks govern each
selection; the declared no-eligible-moves fallback is represented by the
existing empty-eligible continuation.

Focused compiler, capability-matrix, and public transition tests cover the
two-selection path, including deterministic choice order, KI and move-use
accounting, serialized remaining selections, and version increments. No
move-name branch or source-text execution was added. Overdrive Blast's
`asIf: "power-up"` activation and Big Shot's keyed activation plus delayed
deactivation remain explicit unsupported rows because their alternate
activation semantics and cross-effect selection identity are not represented
by this primitive.

The regenerated matrix now records 851 `supported-generic`, 139
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 94 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 roll-modifier transformation slice

The generic `modify-roll-modifier.v1` executor now covers automatic
increment and multiplier transformations. It preserves the source definition
and effect index, supports combat and next-roll lifetimes, honors source
category exclusions and the allow-exceed cap, and applies only to positive
declarative roll modifications. A next-roll transformation is consumed by the
first matching attack or defense roll through the normal versioned transition
and invariant validation paths.

Agile Medley and Rolling Thunder are covered as automatic generic effects;
Rolling Thunder's typed trigger is `on-success`, matching its canonical
successful-attack lifecycle and avoiding source-prose dispatch. Stoicism
remains an explicit unsupported in-scope row because its paid, limited
`on-roll-modified` reaction needs serialized choice and use accounting. No
move-name branch or source-text execution was added.

Focused compiler, matrix, runtime, and public-transition tests cover the
automatic variants, persistent transformer state, transformed attack results,
source provenance, and deterministic version increments. The regenerated
matrix now records 854 `supported-generic`, 137 `unsupported-in-scope`, and
129 `audited-out-of-scope` occurrences. Remaining prerequisite buckets are 43
generic pending-choice, 2 typed compiled damage or resolution-local state, and
92 typed executor or compiled-plan occurrences. Every remaining out-of-scope
definition retains an explicit approved exclusion; catalog closure remains
active.

## 2026-08-23 roll-selection slice

The generic `set-roll-selection.v1` executor now covers the exact advantage
and disadvantage primitive across the active transformation scope. It accepts
only passive current-action selection and successful-action next-roll
selection, resolves the declarative candidate count, and persists next-roll
selection as a typed active effect with source provenance, target combatant,
roll, and selector data. Unsupported costs, limits, stacking, optional groups,
and mismatched lifecycle or roll declarations remain rejected by compilation.

Attack resolution now selects highest or lowest final attack or defense results
from the declared candidate dice. Persisted natural rolls remain authoritative
when a reaction resumes, so the transition never rerolls candidate dice. The
one-shot active effect is consumed only after its matching attack or defense
roll, with immutable version increments and invariant validation preserved.
Bullrush, Floating Drop, and Fade Attack are covered by the generic executor;
no move-name dispatch or source-text execution was added.

Focused compiler, runtime, attack-resolution, and matrix tests cover the three
converted variants, candidate selection, and replay determinism. The
regenerated matrix now records 857 `supported-generic`, 134
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 89 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 move-modification prevention v3 slice

The generic `prevent-move-modification.v3` executor now covers the remaining
converted `effects` aspect and the two represented temporal boundaries used by
the active six-family transformation scope. Durable prevention remains a
versioned active effect with invariant-checked actor, selector, aspect,
exception, operation, and duration data. A `next-turn` prevention records its
first applicable turn, so Static Shot cannot affect the triggering action. A
`current-action` prevention remains in the resolution effect set and is never
silently promoted to combat duration, which preserves Healing Ray's local
semantics.

Active CONSTANT Skill sources are evaluated through the same generic passive
executor when checking protection, and external triggered effect bundles are
filtered by the declared target and source provenance before they are merged
into the action. No source-text dispatch or move-name branch was added.

Focused runtime, compiler, capability-matrix, invariant, and public transition
tests cover State of Zen's effects aspect, Healing Ray's resolution-local
application, Static Shot's persisted turn boundary, and deterministic version
increments. The regenerated matrix now records 860 `supported-generic`, 131
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 86 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 passive moveset slot capacity slice

The generic `modify-slot-capacity.v1` executor now covers passive,
self-targeted, nonzero integer slot-capacity modifiers. It uses the canonical
`GLOBAL_RULES.movesetSlots` capacities—1 mastery, 4 skill, 5 advanced attack,
2 signature technique, and 2 block—as the immutable base for each combatant.

Fight creation evaluates these effects through the passive trigger path and
materializes the resulting capacities and source/effect provenance in
serializable combatant state. The initial state remains version 0, and the
capacity values and provenance are checked by the fight invariants. The three
converted definitions covered are Technique Mastery (+1 Skill), Channeled Chi
Mastery (+1 Skill), and Absolute Might (+1 Advanced Attack). No source prose
was executed and no move-name dispatch was added.

Focused executor, runtime, capability-matrix, create-fight, and public
invariant tests cover the generic primitive and deterministic materialization.
The regenerated matrix now records 863 `supported-generic`, 128
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 83 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 combat-limited successful-effect negation slice

The generic `negate.v1` executor now covers the exact successful-effect
listener variant with a positive combat use limit and one target move
selector. This closes Sucker Punch's converted `negate` occurrence without
interpreting its source prose or adding a move-name branch. The existing
successful-opponent-result listener shape remains supported separately;
action-phase negation with activation cost and the unresolved counter-action
choice variants remain explicit unsupported rows.

Successful listener negations now retain source definition and effect-index
provenance plus their resolved combat limit. When a matching listener actually
negates the triggering move, the owning combatant's serializable
`effectUseCounts` is incremented in the same immutable, versioned transition.
Availability is checked before suppression, and invalid or unprovenanced
limited applications are rejected by the runtime rather than approximated.
Focused compiler, runtime, matrix, and exported effect-behavior tests cover
the variant, provenance, and deterministic limit representation. The
regenerated matrix now records 864 `supported-generic`, 127
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 43 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 82 typed executor or compiled-plan occurrences.
Every remaining out-of-scope definition retains an explicit approved
exclusion; catalog closure remains active.

## 2026-08-23 post-die floating-effect slice

The generic `create-floating-effect.v1` lifecycle now covers the exact
`on-roll-result` creation boundary used by Backflip Kick. The roll primitive
invokes a deterministic post-die observer with the fully resolved attack and
defense die; the converted runtime evaluates the declarative condition and
persists the resulting next-action floating application through the existing
versioned active-effect transition. Existing pre-die roll modifiers retain
their prior timing, and persisted natural rolls remain authoritative on
replay. No source prose or move-name dispatch was added.

Focused runtime, roll, executor, capability-matrix, and public transition
tests cover the threshold boundary, durable source/effect provenance, and
version increments. The regenerated matrix now records 865
`supported-generic`, 126 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining prerequisite buckets are 43
generic pending-choice, 2 typed compiled damage or resolution-local state,
and 81 typed executor or compiled-plan occurrences. Every remaining
out-of-scope definition retains an explicit approved exclusion; catalog
closure remains active.

## 2026-08-23 passive combat-outcome condition slice

The generic `prevent-resolution.v1` executor now covers passive
`combat-outcome` conditions against durable BREAK, SEVER, and STUN status
state. The existing current-event combat-outcome path remains authoritative
for `on-combat-result`; passive evaluation does not infer outcomes from source
prose or from move names. Monkey Sweep's two block-prevention effects now
compile and are applied before the defense-choice transition, leaving the
defender's roll option while removing block options through the typed
resolution-prevention application.

The transition remains immutable and versioned, and focused runtime and public
decision tests cover status matching, the non-matching branch, generic
prevention, and the deterministic pending-defense option set. The regenerated
matrix now records 867 `supported-generic`, 124 `unsupported-in-scope`, and
129 `audited-out-of-scope` occurrences. Remaining prerequisite buckets are
43 generic pending-choice, 2 typed compiled damage or resolution-local state,
and 79 typed executor or compiled-plan occurrences. Every remaining
out-of-scope definition retains an explicit approved exclusion; catalog
closure remains active.

## 2026-08-23 next-action resource-cost modifier slice

The generic `modify-resource-cost.v1` executor now represents the exact
successful-action choice needed for a self-targeted HP-loss adjustment on the
next matching action. The supported selector is source-relative and requires
the `resource-loss` effect kind: one variant covers Advanced Attack, Mastery,
and Skill categories with a `-100%` HP-cost adjustment, and the other covers
Signature Techniques with a `-50%` adjustment. Both variants require the
declared non-stacking lifecycle and literal 1-KI activation cost.

The compiler registers the effect and preserves its pending-choice contract;
the runtime emits a typed application, the transition charges the selected
KI cost before creating an invariant-checked serializable
`modify-next-action` effect, and the next matching HP `lose` or `drain`
resource change applies the persisted percentage before consuming the one-shot
effect. Grouped alternatives are presented together, a selected alternative
resolves the group exactly once, and insufficient KI rejects the decision
without mutating the fight. No move-name branch or source-text execution was
added.

Haokiru Tornado Uppercut effects #2 and #3 are newly supported: 2 occurrences
across 1 definition. Focused compiler and executor evidence is in
`effect-executors.test.ts`; the runtime regression suite is in
`move-effects-runtime.test.ts`; and `progress-fight.test.ts` covers the public
pending options, persisted selected modifier, KI payment, exact HP-loss
adjustment, state transition, and one-shot consumption. Freestyle Effortless
effect #0 remains explicitly `unsupported-in-scope`: its passive optional
listener and `effectTextIncludes: "Straining"` condition require a passive
choice/listener boundary that this slice does not provide.

The regenerated matrix now records 869 `supported-generic`, 122
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 41 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 79 typed executor or compiled-plan occurrences.
The next highest-priority ready family is `copy-move-effect` under typed
executor accounting and compiled effect-plan validation, with 3 occurrences
across 3 definitions. Every remaining out-of-scope definition retains an
explicit approved exclusion; catalog closure remains active.

Final focused handoff gate: `npm run check:focused -- --coverage` passed
(39 test files, 750 tests, formatting, lint, transitive typechecks, validators,
and capability-matrix coverage).

## 2026-08-23 selected-prior successful-effect copy slice

The generic `copy-move-effect.v2` executor now covers the exact selected-prior
successful-effect attack variant. Karmic Possession effect #0 is newly
supported: one occurrence across one definition. The serialized selection
records the completed source action ID, immutable source move snapshot, and
exact prior damage. Resolution clones only the source move's `on-success`
clauses into the copying attack, uses the persisted total damage as the
current attack's base damage, and resumes through the ordinary defense and
post-defense transition boundary without drawing new randomness.

The source selector is the canonical opponent successful Advanced Attack
performed during the current combat. A source attack is offered only when its
SUCCESSFUL clauses are themselves covered by an executable compiled effect
plan; unsupported source clauses remain governed by their own matrix rows and
are not silently discarded. The copied effect resolves in the Karmic
resolution context, with source/effect provenance retained under the copying
move. No source prose or move-name runtime branch was added.

Focused compiler, invariant, capability-matrix, and public transition tests
cover the exact compiler variant, deterministic source-action selection,
immutable snapshot fields, ND-030 total damage for a prior attack, successful
effect replay, HP/use accounting, and pending-frame closure. Follow Up remains
explicitly `unsupported-in-scope` because its combat-persistent start-of-match
selection, inherited tags, and immediate-follow-up lifecycle require a
different capability. Mind Reading remains explicitly `unsupported-in-scope`
because replaying prior-turn costs, dice, and opponent source modifiers needs
an immutable attack-resolution snapshot.

The regenerated matrix now records 870 `supported-generic`, 121
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 41 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 78 typed executor or compiled-plan occurrences.
The next highest-priority ready family is `grant-counter-action` under typed
executor accounting and compiled effect-plan validation, with 3 occurrences
across 3 definitions. Every remaining out-of-scope definition retains an
explicit approved exclusion; catalog closure remains active.

Final focused handoff gate: `npm run check:focused -- --coverage` passed
(39 test files, 752 tests, formatting, lint, transitive typechecks, validators,
and capability-matrix coverage).

## 2026-08-23 immediate counter-action slice

The generic `grant-counter-action.v1` executor now covers the two exact
immediate counter variants that the engine can represent without persistent
permission lifecycle state. Counterstrike Mastery effect #0 is supported as a
post-defense `choose-attack` reaction for an unrestricted single-die Advanced
Attack: the typed option charges its literal KI activation cost, consumes the
combat-scoped effect use, stops the triggering attack, and persists the
counter-action reference into the awaiting-counter frame. Reversal of Fortune
effect #0 is supported as an `on-success` `repeat-triggering-attack` reaction
for the exact two-successful-opponent-action sequence without an intervening
stopped result. It persists the triggering action and immutable source move
snapshot, applies the additive cost modifier with its zero-KI floor, consumes
the combat use, and exposes the resumed source attack through the normal legal
decision and counter transition boundary.

The compiler rejects the grouped `use-source-attack` occurrence on Afterlife
X20 Kaioken Kamehameha because it still requires an optional serialized source
selection. Straightjacket effect #0 remains explicitly
`unsupported-in-scope`: its six-turn, non-stacking permission needs a
persistent counter-permission lifecycle rather than an immediate reaction.
Unsupported duration, stacking, and optional-selection variants were not
broadened to improve accounting. Counter references are serializable and
invariant-checked; source actions and move snapshots are never reconstructed
from mutable catalog data or source prose.

Focused public transition tests cover both supported variants through
`createFight`, `advanceFight`, `enumerateLegalDecisions`, and
`submitCombatDecision`, including post-defense option availability, KI and
effect-use accounting, stopped-trigger behavior, counter-frame persistence,
and Reversal source-action resumption. Compiler/registry coverage and the
capability-matrix test cover the exact supported and explicitly unsupported
variants.

The regenerated matrix now records 872 `supported-generic`, 119
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 41 generic pending-choice, 2 typed compiled damage or
resolution-local state, and 76 typed executor or compiled-plan occurrences.
The next highest-priority ready family is `modify-resource` under typed
executor accounting and compiled effect-plan validation, with 3 occurrences
across 3 definitions. Every remaining out-of-scope definition retains an
explicit approved exclusion; catalog closure remains active.

Final focused handoff gate: `npm run check:focused -- --coverage` passed
(11 changed files; formatting, lint, transitive typechecks, combat and game-data
tests, validators, and capability-matrix coverage).

## 2026-08-23 typed resource-listener slice

Implemented the reusable `modify-resource.v1` listener variants that were
ready under the typed executor prerequisite. The compiler, runtime, and public
transition boundary now support only these exact forms:

- Akaikaru Shotgun Blast effect #0: `on-roll-modified`, self, next own turn,
  literal +1 KI, when the self attack has both sides and result modifiers from
  a source other than dexterity.
- Haokiru Dragon's Pride effect #0: `start-combat`, self, literal +10% total
  HP, when self SP is at most opponent SP, with its literal 1 KI activation
  cost. SP is optional permanent combatant input/state and is invariant
  checked when present.
- Kurokonwaku Ki Trap effect #1: `on-roll-result`, opponent, prohibited
  literal 60 HP loss, when the current natural attack result matches the named
  stored roll, with one combat use. Source definition/effect provenance,
  prevention behavior, and use-limit state are persisted through the normal
  transition boundary.

No other trigger, target, condition, scope, duration, numeric, or lifecycle
variant was widened. The unsupported Ki Trap reroll effects and Healing Ray's
pending stored-roll choices remain explicitly `unsupported-in-scope`.

Focused evidence includes the `fight:dragons-pride-sp` public
`createFight`/`advanceFight` transition, which verifies SP-gated HP gain and
the KI cost event, and the `fight:ki-trap-stored-match` public
`createFight`/`advanceFight`/`submitCombatDecision` transition, which verifies
natural stored-roll matching, prohibited HP loss on the attacker's side, and
the persisted `move-kurokonwaku-ki-trap:1` use count. Exact compiler and
runtime listener tests cover all three catalog variants, including Shotgun's
next-turn roll-modification context.

The regenerated matrix now records 875 `supported-generic`, 116
`unsupported-in-scope`, and 129 `audited-out-of-scope` occurrences. Remaining
prerequisite buckets are 41 generic pending-choice occurrences across 27
definitions, 2 typed compiled damage or resolution-local occurrences across 2
definitions, and 73 typed executor or compiled-plan occurrences across 58
definitions. The next highest-priority ready capability is
`modify-resource` under generic pending-choice compilation and resolution:
three occurrences across X20 Kaioken Kamehameha and Healing Ray. The focused
handoff gate is complete: `npm run check:focused -- --coverage` passed after
the targeted lint repairs, with the focused combat tests and typecheck also
passing.

## 2026-08-23 generic on-roll-result pending-choice slice

Implemented the reusable serialized optional-effect continuation for
`on-roll-result` simple actions. The resolution frame now retains the exact
stored roll results, source move, and effect indices while the pending
`optional-effect` decision is open. Resume validates the selected source and
indices, reuses the persisted roll without drawing new randomness, and routes
the selected compiled effect through the normal simple-action transition.
Stored-roll frame data is invariant checked, and the existing resource,
status, action-history, event, and phase lifecycle remains owned by the normal
transition boundary.

This closes exactly one catalog occurrence: Haokiru Healing Ray effect #1,
`on-roll-result`, self, HP gain of `resource-percent(self, hp, total, 25)`
when the stored d30 result is at least 10, with exclusive target-choice
activation. The public transition offers the self-heal choice, persists the
12 result, resumes without rerolling, applies 25% of total HP, charges the
move's KI cost once, records the action, and clears the pending frame. The
runtime test also verifies that the unsupported ally alternative is not
silently mapped to opponent or self.

Healing Ray effect #2 remains explicitly `unsupported-in-scope` because the
current two-combatant target model has no faithful ally candidate. X20 Kaioken
Kamehameha effect #5 remains unsupported because its on-damage resource loss
is coupled to a before-defense source-attack response choice that is not yet a
generic listener boundary; no standalone on-damage approximation was added.

The regenerated matrix now records 876 `supported-generic`, 0
`supported-named`, 115 `unsupported-in-scope`, and 129
`audited-out-of-scope` occurrences. Remaining prerequisite buckets are 40
generic pending-choice occurrences across 27 definitions, 2 typed compiled
damage or resolution-local occurrences across 2 definitions, and 73 typed
executor or compiled-plan occurrences across 58 definitions. The next
highest-priority ready capability is generic pending-choice `reroll`, with 3
occurrences across 2 definitions. Final focused handoff gate:
`npm run check:focused -- --coverage` passed (39 test files, 762 tests, mapped
formatting, lint, transitive typechecks, validators, and capability coverage;
0 errors).

## Handoff prompt

> Resume the combat-engine catalog-closure goal from the current worktree.
>
> Read `AGENTS.md`, `ARCHITECTURE.md`,
> `docs/architecture/combat-engine-progress.md`,
> `docs/architecture/combat-engine-roadmap.md`, and the current generated
> `docs/architecture/combat-engine-capability-matrix.md` first. Treat the
> progress document as the authoritative implementation handoff and the
> generated capability matrix as the authoritative per-occurrence accounting
> record. Preserve unrelated dirty changes.
>
> Continue from the highest-priority ready prerequisite recorded by the current
> progress document and capability matrix. Work in capability-sized slices,
> not move-sized slices. Implement the next missing high-volume generic
> capability and close every currently unsupported occurrence that is safely
> covered by the exact implemented variant. Do not stop after one or two moves
> merely because they demonstrate the capability when additional occurrences
> require no new semantic capability.
>
> Prefer the smallest correct reusable combat primitive rather than
> definition-specific behavior. Extend compilation or validation, runtime
> execution, serializable state, invariants, events, legal decisions,
> resolution context, lifecycle handling, and consumers wherever the capability
> actually requires them.
>
> Add generic support only for the exact variants the engine can faithfully
> represent. Unsupported trigger, condition, target, selection, scope,
> duration, numeric, lifecycle, or resolution-context variants must remain
> explicitly unsupported until their prerequisite capability exists.
>
> Do not treat converted source text as executable semantics, infer mechanics
> from display prose, silently approximate unsupported behavior, or broaden a
> compiler merely to improve capability-matrix counts. Consult the canonical
> source under `reference/` and approved normalization decisions when the
> structured definition is incomplete or ambiguous.
>
> Do not add move-name or definition-ID runtime branches when a generic
> primitive fits. If a mechanic is genuinely definition-specific and cannot be
> represented by existing or reasonably extensible generic primitives, use the
> engine's documented deterministic named-executor path, justify why generic
> representation is inappropriate, route it through the normal transition
> boundary, and cover it with definition-specific regression tests.
>
> Use deterministic, versioned, invariant-checked combat transitions. Persist
> any information required to resume unresolved work rather than reconstructing
> authoritative state from events, mutable catalog data, source prose, or new
> randomness.
>
> The active transformation scope is Humans, Saiyans, Hybrid-Saiyans,
> Namekians, Changelings, and Bio-Androids only. Do not widen transformation,
> multiplayer, remote-target, spaceship, narrative, administrator-mediated, or
> other documented scope without an explicit scope decision.
>
> Add or strengthen focused public-behavior tests for each completed capability.
> Prefer tests through `createFight`, `advanceFight`,
> `enumerateLegalDecisions`, and `submitCombatDecision` when the behavior spans
> public combat transitions. Use focused helper/compiler/runtime tests where
> appropriate, but do not treat isolated helper coverage as proof that a
> catalog occurrence works through the public engine.
>
> Work in coherent implementation checkpoints rather than treating every file
> edit as a verification boundary. Batch tightly related contract, compiler,
> runtime, state, invariant, and test edits when they form one logical piece of
> the capability.
>
> During implementation, use the smallest useful verification command:
>
> - after contract/compiler/type changes stabilize, run the relevant workspace
>   typecheck and focused compiler/executor tests;
> - after runtime/state/invariant behavior stabilizes, run the focused runtime
>   or public-behavior tests for that capability;
> - after catalog-accounting changes, run the capability-matrix test and any
>   affected validator;
> - format changed files as part of each coherent edit batch.
>
> Do not repeatedly run repository-wide or package-wide gates after every small
> corrective edit.
>
> When any incremental or final verification command fails, diagnose the
> specific failure and rerun only the smallest command that exercises that
> failure while repairing it: the failing test case or test file, affected
> workspace typecheck, validator, formatter, or lint target. Continue using that
> narrow command until the failure is resolved. Do not restart the entire
> focused or repository-wide gate after every corrective edit.
>
> Once the capability implementation, focused tests, capability accounting, and
> progress documentation are complete, run exactly one normal combat handoff
> gate:
>
> `npm run check:focused -- --coverage`
>
> The focused checker should cover the affected formatting, lint, transitive
> package typechecks, combat and game-data tests, validators, and
> capability-matrix coverage for ordinary combat-engine work.
>
> If the final focused gate fails, repair each failure using the smallest
> relevant command as described above. After the individual failures are
> resolved, rerun `npm run check:focused -- --coverage` once to establish clean
> final handoff evidence.
>
> Escalate beyond the focused handoff gate only when required. Run
> `npm run check` when the focused impact map explicitly requires the routine
> repository-wide gate or when the changed files fall outside reliable focused
> impact mapping. Run `npm run quality` instead of `npm run check` when the
> repository's Extended Quality Gate applies, including substantial
> cross-package or architecture-boundary changes, dependency changes,
> CI/deployment changes, release preparation, milestone integration checks, or
> when the focused checker explicitly escalates to `quality`.
>
> Do not run `npm run quality` merely because ordinary combat calculations or
> game rules changed, and do not run `npm run check` immediately before
> `npm run quality` because `quality` already includes the routine check.
>
> Regenerate the capability matrix after the completed capability and update
> `docs/architecture/combat-engine-progress.md` with:
>
> - the generic or named capability implemented;
> - the exact variants and occurrences newly supported;
> - focused public-behavior evidence;
> - current supported, unsupported-in-scope, and audited-out-of-scope counts;
> - remaining prerequisite buckets;
> - the next highest-priority ready capability;
> - the final verification command and result.
>
> Keep unfinished mechanics explicitly `unsupported-in-scope`. Do not reclassify
> unfinished work as out of scope merely to improve counts or finish a slice.
>
> Do not mark the combat-engine catalog-closure goal complete until the
> capability matrix accounts for every in-scope converted effect with tested
> generic or justified named executor coverage and every out-of-scope
> definition with a documented approved exclusion.
