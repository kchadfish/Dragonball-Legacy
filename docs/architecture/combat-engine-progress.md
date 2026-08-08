# Combat-engine implementation progress

## Purpose

This is the versioned handoff record for the in-progress
`@dragonball-resurgence/combat-engine`. It records verified implementation
state and the next executable work, rather than restating the intended
architecture. The target architecture is in
[ARCHITECTURE.md](../../ARCHITECTURE.md); the original data baseline is in
[combat-engine-baseline.md](combat-engine-baseline.md).

Update this record whenever an engine capability is added, removed, or found
to be incomplete. A future generated capability matrix should replace the
manual coverage table below as the authoritative per-definition record.

## Active delivery scope

The requested scope is deterministic, versioned, invariant-checked combat for
converted non-spaceship mechanics. Transformation support is intentionally
limited to Humans, Saiyans, Hybrid-Saiyans, Namekians, Changelings, and
Bio-Androids. Do not widen transformation families without an explicit scope
decision.

The converted catalog is data-complete, but it is **not** equivalent to engine
complete. The current inventory has 499 moves and 837 move effects across 46
effect types. It also has 162 items, with 282 item effects; 102 item rules are
explicitly non-executable narrative or administrator rules. Full catalog
support therefore requires a validated executor-or-exception record for each
in-scope definition, not merely a parsed definition.

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

## Known incomplete work

The engine is not ready to be declared complete. These are the remaining
categories to audit and implement through the generic executor where possible:

1. Compile converted definitions into validated typed execution plans, reject
   unsupported in-scope definitions at load time, and generate the capability
   matrix named in `ARCHITECTURE.md`.
2. Complete trigger dispatch and condition support across all converted combat
   triggers and condition forms; do not rely on source prose at runtime.
3. Complete generic target and selection semantics, including optional, one,
   up-to, and all eligible targets. Persist every candidate set before a player
   makes a choice.
4. Finish effect lifecycle semantics: stacking, use limits, cooldowns,
   activation costs, scopes, all duration variants, suppression, negation,
   replacement, reactivation, and expiry ordering.
5. Complete calculation pipelines and declared precedence for roll, damage,
   cost, resource, stat, result, threshold, dice-selection, reroll, and stored
   roll effects.
6. Complete fight-flow effects: extra and counter actions, skipped actions,
   deferred/scheduled effects, defense responses, contests, and combat-result
   changes.
7. Implement remaining supported item combat effects through the same executor;
   retain non-combat/narrative item rules as explicit audited exclusions.
8. Audit transformations and race mechanics against the six-family scope;
   add only structured, source-backed rules. Do not infer the 237
   source-text-only transformation abilities.
9. Audit multiplayer, remote-target, allies, interferers, body swaps, and
   spaceship mechanics. Keep mechanics outside the approved scope rejected or
   explicitly excepted rather than silently approximated.
10. Add a representative focused regression test for every executor capability
    and every audited named-rule exception, then run the required full gates.

## Immediate resume point

### Latest implementation slice (2026-08-07)

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
- A contract, invariants, and runtime extraction accumulator have been added
  for `prevent-roll-modification`. **Activation, duration lifecycle, and
  enforcement are not yet implemented**; do not count it as supported.

Focused evidence recorded during this slice:

- `npm.cmd run build --workspace @dragonball-resurgence/combat-engine`
  passed after the combat-result-prevention and roll-prevention extraction
  changes.
- Focused Vitest runs passed for `basic-attack.test.ts`,
  `attack-rolls.test.ts`, `move-attacks.test.ts`,
  `move-effects-runtime.test.ts`, `progress-fight.test.ts`,
  `deactivation-flow.test.ts`, and `contracts.test.ts` at their respective
  implementation milestones.
- `git diff --check` found no whitespace errors. Its CRLF notices apply to
  pre-existing dirty files and are not errors.

The full repository gates were intentionally deferred by the requester until
the work is complete. They have not been run for this latest slice.

### Next executable work

Finish `prevent-roll-modification` end-to-end first: persist applications on
the originating trigger, enforce them against both active and same-action roll
modifiers, implement every declared duration expiry, and add public-behavior
tests. Then use the capability matrix to choose the next high-volume generic
executor rather than adding named-move branches.

Generate the capability matrix and typed plan validation. Use it to enumerate
every converted non-spaceship effect and classify it as:

- supported by a tested generic capability;
- supported by a tested named exception; or
- unsupported, with an explicit reason and next capability required.

Use that output to choose the next highest-volume missing generic capability.
Do not add move-name branches in `progress-fight` merely to make an individual
move appear to work. Where a rule requires a player choice, add a versioned
resolution frame and pending decision before applying it.

## Verification record

The combat-engine workspace build passed after the recent effect-runtime and
lock/deactivation work. Focused move-effect tests have also passed. A full
repository `npm run check` was started before the most recent lint refactor but
was not rerun to a clean completion afterward; it must be rerun before any
completion claim. Combat rule changes also require `npm run test:coverage` at
meaningful milestones and before declaring the engine complete.

The inventory command to refresh catalog counts is:

```bash
npm run report:combat-mechanics
```

Run the final gates only at meaningful milestones and before declaring this
scope complete:

```bash
npm run check
npm run test:coverage
```

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
> fits. Run focused checks during work; run `npm run check` and
> `npm run test:coverage` at meaningful milestones and before any completion
> claim. Do not mark the goal complete until the capability matrix accounts for
> every in-scope converted effect with an executor and focused coverage, or a
> documented approved exception.
