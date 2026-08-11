---
name: resurgence-combat-change
description: >
  Implement, fix, refactor, diagnose, or review Dragonball Resurgence combat
  behavior. Use for combat rules, attacks, defenses, blocks, counters,
  statuses, transformations, combat items, declarative effects, legal
  decisions, fight state, phases, rolls, damage, Ki, or fight resolution. Also
  use when a combat-owned public contract changes and downstream application,
  AI, or persistence consumers must be audited. Do not use for unrelated UI,
  forum, persistence-only, or narrative-content work.
---

# Dragonball Resurgence Combat Change

Implement combat changes through the repository's deterministic, declarative,
versioned transition architecture. Prefer the smallest correct generic mechanic,
not merely the smallest local patch.

## Establish context and authority

Before changing code:

1. Read `AGENTS.md`, `ARCHITECTURE.md`, and
   `docs/architecture/combat-engine-progress.md` completely.
2. Read `docs/architecture/combat-engine.md` and the relevant accepted ADRs when
   the change touches state transitions, pending decisions, effect ordering,
   versioning, or engineering safeguards.
3. Identify the request, bug report, rule, or source definition governing the
   behavior.
4. For an existing game rule, inspect the relevant canonical Markdown under
   `reference/` before relying on implementation or tests.
5. Inspect the corresponding typed definitions in
   `@dragonball-resurgence/game-data`, the generic engine capability that
   executes them, and existing tests.
6. Check `reference/normalization-decisions.md` and
   `reference/semantic-conversion-blockers.md` when source prose is incomplete
   or ambiguous. Do not silently invent a ruling or approximate unsupported
   behavior.

Treat canonical rule text, approved normalization decisions, accepted ADRs, and
explicit user-requested rule changes as distinct authorities. Do not treat an
existing test as authoritative when it conflicts with an established rule. Do
not treat an engineering safeguard as a canonical game rule. If the request
changes a rule, update the authoritative source and consider rules-version
implications rather than changing runtime behavior alone.

Do not infer executable behavior from flavor text. Converted or source-text-only
data is not proof that the engine supports a mechanic. Confirm current support
in `docs/architecture/combat-engine-progress.md` and the runtime executor.

## Classify ownership

Place behavior in its owning layer:

- universal numerical rule or limit -> `game-config`
- static move, item, status, or transformation definition -> `game-data`
- generic combat behavior and temporary combat state -> `combat-engine`
- Discord, HTTP, or other presentation/orchestration -> application layer
- durable storage and mapping -> persistence layer

Within `combat-engine`, classify the work as trigger dispatch, condition
evaluation, target or selector resolution, pending choice, effect lifecycle,
state mutation, roll execution, or fight-flow scheduling. Extend an existing
generic capability when possible.

Read `ARCHITECTURE.md` before adding a game-domain concept or dependency. Keep
cross-package imports on `@dragonball-resurgence/*` public exports. Applications
may depend on packages; packages must not import applications.

## Protect the game-data workflow

Before editing `packages/game-data`, determine whether the target is generated
or hand-authored. Inspect its header and `scripts/generate-game-data.ts`.

- Do not manually edit files marked as generated.
- Change canonical Markdown, conversion logic, or the appropriate hand-authored
  structured-effect overlay according to the owning workflow.
- Run `npm run generate:game-data` when the source or generator requires
  regenerated output.
- Preserve source paths and record unresolved source ambiguity as `Needs ruling`
  instead of generating or executing a guess.

Keep static definitions declarative. Never add arbitrary callbacks to
`game-data`. Express executable mechanics with typed triggers, conditions,
targets, operations, units or bases, durations, scopes, stacking, use limits,
costs, expiry, and player-selection semantics as applicable.

Do not materialize values before their meaning is known. Distinguish percentages,
flat amounts, die-side modifiers, result modifiers, and percentages of current
or maximum resources.

## Reject definition-specific shortcuts

Ask whether another move, item, status, or transformation could need the same
mechanic. If so, implement it generically.

Avoid definition-ID branches such as:

```ts
if (move.id === "move-something") {
  // special behavior
}
```

Use a named or definition-specific resolver only when the mechanic cannot be
represented by existing or reasonably extensible primitives. Document why,
keep it deterministic, route it through the normal combat transition boundary,
and cover it with focused tests. Do not duplicate generic engine behavior.

## Trace the public transition

Trace every relevant stage instead of inspecting only the helper that appears
broken:

```text
game data
  -> legal-decision enumeration
  -> decision validation
  -> pending decision / resolution frame
  -> cost and resource handling
  -> roll execution
  -> effect resolution
  -> immutable state mutation
  -> phase and turn scheduling
  -> structured events
  -> invariant validation
```

Keep `enumerateLegalDecisions` and `submitCombatDecision` consistent. A decision
offered for a state must be valid when submitted against that unchanged version.
An accepted ordinary player or NPC decision should normally have been
representable through legal-decision enumeration.

Prefer behavior tests through the public boundaries:

- `createFight`
- `advanceFight`
- `enumerateLegalDecisions`
- `submitCombatDecision`

Use helper tests for isolated calculations, but not as the only evidence for
behavior spanning multiple transition layers.

## Preserve deterministic, durable state

Do not call `Math.random()` from domain logic, read wall-clock time directly
when it affects rules, retain hidden mutable fight state, perform I/O during a
combat transition, or consume new randomness while replaying persisted rolls.
Use injected randomness, IDs, and time.

Persist all information needed to resume unresolved work in `FightState`,
including natural rolls, choices, selected targets, active effects, durations,
use counts, and suspended resolution frames. Never reconstruct authoritative
rule state from presentation events.

When adding temporary state:

1. Define it explicitly in the owning contract.
2. Keep it serializable and immutable or predictably stateful.
3. Validate references and structural rules in invariants.
4. Define creation, stacking, consumption, expiry, and fight-completion behavior.
5. Ensure accepted transitions increment and validate the state version as
   required.

Do not bypass invariant validation to make a test pass.

## Test behavior and adjacent interactions

For every bug fix or major behavior change, add or strengthen a focused Vitest
regression test that fails without the fix. Cover normal behavior, relevant
boundaries, and the actual sequence of decisions for interaction-heavy rules.
Use deterministic random sequences and restore mocks or spies after each test.

Assert whichever public outcomes matter: legal decisions, state version, phase,
HP, Ki, statuses, active effects, move or item uses, persisted rolls, action
history, resolution frames, events, and final fight status.

Search for every consumer of changed contracts or semantic fields. Check for
duplicate rules, obsolete assumptions, affected definitions, and interactions
with blocks, counters, RESTRICTED use, statuses, transformations, items, pending
choices, and fight completion. Fix a shared cause once rather than patching each
definition separately.

When a combat-owned public contract changes, inspect application, NPC AI, and
persistence consumers even if the main implementation remains in
`combat-engine`. Update affected consumers without moving domain behavior into
them.

## Maintain scope and progress records

Keep unsupported mechanics explicitly unsupported. Do not widen multiplayer,
remote-target, transformation-family, narrative, spaceship, or other documented
scope without an explicit decision.

Update `docs/architecture/combat-engine-progress.md` whenever an engine
capability is added, removed, or discovered to be incomplete. Record partial
coverage honestly; one passing definition does not prove catalog-wide support.

## Verify incrementally and finish with evidence

After each meaningful code or configuration change, run the smallest relevant
format, type, validation, or focused Vitest command. For game-data work, run the
relevant generation and validation commands early.

Before completing any implementation change:

1. Run `npm run check` from the repository root.
2. Run `npm run test:coverage` for combat calculations, game rules, validation
   schemas, transformation logic, persistence behavior, Discord command or
   moderation logic, or API behavior.
3. Run `npm run quality` when the change substantially affects multiple
   packages, changes architecture or package boundaries, adds or upgrades
   dependencies, modifies CI or deployment behavior, or prepares a release.

Do not weaken quality rules or claim completion while a required command fails.
If a gate cannot run or fails for an unrelated reason, report the exact command,
failure, and remaining action separately from the change's focused evidence.

For diagnosis or review-only work, keep the repository read-only unless the user
also requests implementation. Run only relevant non-mutating checks and report
their results.

In the final response, report:

1. the root cause or requested mechanic,
2. the owning architectural layer,
3. the generic implementation approach,
4. tests added or modified,
5. validation commands and results,
6. progress documentation updated when applicable,
7. remaining unsupported interactions or follow-up work.