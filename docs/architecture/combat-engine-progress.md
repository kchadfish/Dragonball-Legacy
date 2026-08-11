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

| Area                                         | Focused test module                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Contracts, IDs, and state invariants         | `contracts.test.ts`, `create-fight.test.ts`                                                |
| Fight creation and turn progression          | `create-fight.test.ts`, `progress-fight.test.ts`                                           |
| Basic and converted move attacks             | `basic-attack.test.ts`, `move-attacks.test.ts`, `death-beam.test.ts`                       |
| Rolls, damage, blocks, and generic mechanics | `attack-rolls.test.ts`, `block-mechanics.test.ts`, `combat-mechanics.test.ts`              |
| Declarative move effects and reactions       | `declarative-runtime.test.ts`, `move-effects-runtime.test.ts`, `deactivation-flow.test.ts` |
| Items                                        | `item-effects-runtime.test.ts`                                                             |
| Transformations                              | `transformation-runtime.test.ts`, `transformation-activation.test.ts`                      |
| Deterministic test dependencies              | `testing/index.test.ts`                                                                    |

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

### Latest implementation slice (2026-08-10)

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

Focused evidence recorded during this slice:

- Combat-engine typecheck passed with `npx tsc --noEmit -p
packages/combat-engine/tsconfig.json`.
- Focused Vitest passed for the capability matrix, `basic-attack.test.ts`,
  `move-effects-runtime.test.ts`, and `progress-fight.test.ts` (76 tests),
  including operation application, selector non-matching, counted
  consumption, and invariant-backed public transitions.
- `git diff --check` found no whitespace errors. Its CRLF notices apply to
  pre-existing dirty files and are not errors.
- The current-action damage slice focused test passes in
  `progress-fight.test.ts` (23 tests across the capability-matrix and
  progress-fight modules), including deterministic roll consumption, state
  version advancement, damage events, and the invariant-checked result.
- The typed executor, matrix, runtime, basic-attack, and progress focused
  suite passes with 82 tests; the combat-engine workspace typecheck also
  passes. The generated matrix now records 1,120 occurrences: 575 supported
  generic, 416 unfinished in-scope, and 129 approved item exclusions. Its
  unfinished prerequisites are 324 typed executor/accounting rows, 29 typed
  damage-context rows, and 63 pending-choice rows.

Repository-wide verification before this tranche: `npm run check` passed on
2026-08-09 (40 test files / 439 tests). The latest `npm run quality` attempt is
recorded below.

### Next executable work

Resume at roadmap CE-110. The matrix now distinguishes generic support, named
support, unfinished in-scope work, and approved out-of-scope exclusions at the
individual occurrence level. Its accounting gate is intentionally not catalog
closure: unsupported rows are required to identify their prerequisite, while
out-of-scope rows identify their approved exclusion.

CE-110 typed execution-plan validation and CE-120 exhaustive executor
accounting are now in place for the current runtime-owned discriminants. The
compiler rejects unsupported occurrences at runtime or load time while the
development-time report continues to represent unfinished in-scope work. The
next ready family remains `modify-damage`: event-triggered, resolution-local,
capped, prior-action, and other unresolved variants still need explicit
context and focused public-boundary coverage. Do not add move-name branches in
`progress-fight`; persist versioned resolution frames and exact candidate sets
before any player-owned choice.

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
record contains 575 `supported-generic`, 416 `unsupported-in-scope`, and 129
approved item-exclusion rows; those are accounting results, not a completion
claim. Source-text-only transformation abilities remain excluded from
executable effect counts; the active transformation families remain Humans,
Saiyans, Hybrid-Saiyans, Namekians, Changelings, and Bio-Androids.

The refined matrix identifies 29 `modify-damage` occurrences as unfinished
in-scope after this slice. Remaining variants include upkeep/turn-bound and
resource-event triggers, resolution-derived amounts, prior-action values,
level comparisons, optional choices, caps, and other context that is not yet
persisted or compiled. They remain rejected rather than inferred from source
text.

The repository gate for a handoff is:

```bash
npm run quality
```

Do not run `npm run check` separately first. `npm run quality` already invokes
it before coverage, duplication detection, and the production dependency audit.

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
