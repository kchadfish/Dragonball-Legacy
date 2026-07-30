# Combat-engine design guidance

## Purpose and scope

This document guides implementation of `@dragonball-resurgence/combat-engine`. It
supplements [the system architecture](../../ARCHITECTURE.md), which remains the
source of cross-package architectural constraints.

The engine owns deterministic combat rules, temporary fight state, legal-action
enumeration, state transitions, and structured event output. Applications may
collect choices, persist snapshots, and render results; they must not duplicate
or bypass combat rules.

This guidance is intentionally concerned with engine-facing contracts, not
Discord, HTTP, database, or display behavior.

## Implementation contract

Combat work should be modelled as a pure transition:

```text
previous state + submitted decision + injected dependencies
  => next state + structured events + optional pending decision
```

The latest `FightState` is the authoritative state for an active fight. Events
describe the transition and support presentation, audit, and diagnosis; they do
not need to rebuild the state on their own.

Transitions must not mutate their input. Every accepted decision produces a new
state with an incremented version. A decision carries both the version it was
made against and an opaque decision ID. Callers must reject stale decisions, and
any future persistence adapter must perform a version-checked write so two
simultaneous submissions cannot both commit.

The primary engine boundary should be a decision-submission operation. Its
eventual name and exact TypeScript shape may change during implementation, but
it must accept the fight state, a typed decision, and injected dependencies;
return either a transition or a typed domain failure; and remain independent of
platform and persistence code.

All ordinary player, moderator, and NPC actions must use that boundary. The
engine must also enumerate the exact legal actions for a specified combatant.
Interfaces and NPC AI consume that output rather than reimplementing legality.

## State and resolution

`FightState` should explicitly represent the active combat phase, the current
participant or action owner, active and scheduled effects, use counters,
transformation state, action history needed by rules, and completion state.

Some rules require a choice after an action or roll. Such a pause is a
first-class pending decision with a stable ID, the combatant permitted to make
the choice, and a complete set of legal options. A response must identify the
pending-decision ID as well as the state version.

Combat should use explicit states rather than loose combinations of flags. The
final phase names and transition graph will be confirmed through representative
vertical slices. When reactions, counters, or other interruptions need work to
resume later, represent the unfinished work with serializable resolution frames
rather than nested move-specific calls.

## Effects and calculations

Game definitions remain typed declarative data. They may not contain callbacks
or arbitrary executable code. A small, registered named-rule mechanism may
handle mechanics that cannot be expressed clearly with standard operations. A
named rule must be deterministic, have a stable ID, be covered by tests, and be
used only after a generic declarative operation is shown not to fit.

Effects require centralized semantics for:

* Trigger collection, conditions, ordering, optional-choice handling, and
  chaining.
* Stacking, replacement, and expiration.
* Duration ownership and clocks, such as actor turns, target turns, global
  turns, action uses, and combat lifetime.
* Damage, resource-cost, stat, roll, healing, cap, minimum, and rounding
  calculations.

The exact order for each calculation pipeline must come from the game rules and
be implemented in one named location. Avoid ad hoc calls to rounding functions
inside move handlers. Preserve natural dice results, die-side changes,
result-level modifiers, and final values separately so rules may correctly
refer to the appropriate stage.

## Events, failures, and invariants

The engine returns structured factual events, not presentation text. Events
should include an event ID and deterministic sequence, relevant combatant and
definition IDs, and causation where applicable (the submitted decision and/or
effect that caused the event).

Expected rule failures are discriminated unions, such as stale decision,
wrong phase, insufficient Ki, unavailable move, or exhausted restricted use.
Unexpected corruption and invariant violations remain programming or
infrastructure failures.

Tests and development assertions should maintain invariants including resource
bounds, valid active combatants, non-negative use counters, valid references for
active effects, and prohibition of ordinary actions by defeated combatants or
after fight completion.

## Versioning and persistence

Fights record the applicable rules version at initialization. Rules version
identifies the game data, configuration, and engine behavior under which a
fight began; it is not a persistence-format version.

The engine does not read or write a database. A caller applies the returned
transition and persists it when needed. If active sessions are later persisted,
their stored envelope will also carry a separately managed snapshot-schema
version.

## Delivery order

Prove the model with vertical slices before widening the effect vocabulary:

1. Basic attack and normal turn progression.
2. Simple advanced attack and resource cost.
3. Multi-die attack, defense/block, critical result, and calculation rules.
4. Restricted use and a temporary modifier with duration.
5. Optional post-roll reaction and a counter that suspends and resumes work.
6. Transformation modifier and a deliberately unusual named rule.

Each slice needs focused transition, event, failure, deterministic-randomness,
and invariant tests. Full event-transcript tests should cover representative
end-to-end flows, not replace focused assertions everywhere.

## Related decisions

* [ADR 0001: Combat state and transition model](../adr/0001-combat-state-and-transition-model.md)
* [ADR 0002: Combat resolution and reactions](../adr/0002-combat-resolution-and-reactions.md)
* [ADR 0003: Effect ordering and calculation pipelines](../adr/0003-effect-ordering-and-calculation-pipelines.md)
* [ADR 0004: Fight versioning and persistence boundary](../adr/0004-fight-versioning-and-persistence-boundary.md)
