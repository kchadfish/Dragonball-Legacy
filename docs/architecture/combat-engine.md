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

Implementation begins from the
[combat-engine implementation baseline](combat-engine-baseline.md), which
defines the verified game-data surface and the initial supported combat scope.

## Package boundary and ownership

`combat-engine` depends on the public roots of `game-config` and `game-data`.
It must not deep-import either package, depend on application or persistence
code, or duplicate their definitions.

The engine owns temporary fight-state contracts: fight, combatant, decision,
event, pending-decision, active-effect, and resolution-frame identities and
models. `game-data` owns move, status, transformation, race, item, and style
definitions. `game-config` owns universal rules values and their rules version.
Permanent character identity and records are outside the engine boundary.

The package root is the production public API. `@dragonball-resurgence/combat-engine/testing`
is the only testing subpath; it will expose test builders and deterministic
fakes as stable combat contracts are introduced. Internal source modules remain
private.

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

The initial public contract exports combat-owned namespaced ID schemas and
types, the active/completed fight-state union, typed decisions and legal
decisions, transitions, factual events, typed failures, and injected random,
clock, and ID-source dependencies. It exposes `createFight` for the supported
initial 1v1 scope. Decision submission will arrive with its first implemented
behavior rather than as a placeholder function.

### Initial fight creation

`createFight` accepts exactly two validated combatant setups and a mode. It snapshots current hit points, the
configured starting and maximum Ki values, combat stats, selected move IDs, and
the rules version. It rejects malformed inputs, duplicate or unknown move IDs,
and does not consume generated IDs for rejected setup.

The engine selects the first combatant: highest Dexterity goes first, while tied
Dexterity is resolved through injected 1d100 rolls (rerolling tied results).
Creation emits `fight-started`, each required tie-break roll, and `turn-started`.
A successful result starts turn 1 in `upkeep` at state version 0. The state is
checked against the internal 1v1 invariant validator before it is returned.

### Initial turn progression

`advanceFight` resolves only non-interactive boundaries in this slice: it moves
an `upkeep` phase to `action`, and moves an empty `end` phase to the other
combatant's next `upkeep` while incrementing the turn. During `action`,
`enumerateLegalDecisions` returns the supported basic attacks, pass, power-up,
surrender, and an owned Death Beam. During `counter`, it returns basic attacks
and surrender for the countering combatant. `submitCombatDecision` applies those
actions, caps Ki gained from a power-up at the configured maximum, and emits
factual Ki, phase, turn, and completion events. A moderator-authorized
`cancel-fight` decision is accepted by the engine boundary but deliberately is
not a player legal action.

Pending-decision resolution is not represented as a legal action yet.
Hand-authored pending-decision responses return a typed missing-pending-decision
failure rather than approximating that behavior. Moves outside the explicitly
supported Death Beam slice return typed failures.

### Basic attack slice

The action list also includes `basic-punch`, `basic-kick`, and `basic-ki-blast`
against the other active combatant. Each costs zero Ki and resolves through two
injected standard-die rolls with the combatants' Dexterity Bonuses applied. A
tie is successful; success deals the configured, rounded percentage of the
attacker's Power, while a stopped attack deals no damage. The engine emits raw
attack and defense rolls, the outcome, damage, and defeat/fight-end events as
applicable.

Single-die attacks can critically hit using the configured natural-roll
threshold, while qualifying stopped defenses enter the serializable Counter
phase. Counter ownership transfers to the defender and consecutive counter
attacks stop at the configured engineering safeguard. Blocks and broader
move-specific behavior remain subsequent explicit resolution work.

### Universal combat configuration

`game-config` is the single source for the engine's shared, source-transcribed
combat values: phase order, Dexterity initiative and its 1d100 tie-break,
critical-hit multiplier and eligibility, counter prerequisites, and the
minimum turn for Signature Techniques. The source supports an iterative Counter
phase but does not state a maximum chain length.

`combat.engineeringSafeguards.maximumConsecutiveCounterAttacks` is therefore
an explicit engine protection, set to 3. It is not a game rule. The third
consecutive counter attack in one chain is the last allowed; a further counter
opportunity does not create another counter attack. The engine emits
`counter-chain-limit-reached` when it prevents a counter, and the safeguard may
be replaced only by a source-backed rule decision.

### First effect-runtime slice

The engine now stores serializable active cost modifiers with an explicit move
selector and `next-eligible-action` expiration scope. Death Beam is the first
complete advanced-attack slice: it spends its literal Ki cost, uses its declared
single-die attack roll and base damage, then creates a modifier after a
successful non-defeating hit. The target's next matching advanced attack pays
the modifier, emits its expiry, and removes it. Other converted moves remain
unsupported until their complete effect behavior is implemented.

## State and resolution

`FightState` should explicitly represent the active combat phase, the current
participant or action owner, active and scheduled effects, use counters,
transformation state, action history needed by rules, and completion state.

The current contract now carries these temporary-state foundations directly:
each combatant has move-use counts, keyed natural rolls retained by declarative
effects, active statuses with explicit duration clocks, and an optional active
transformation. Stored rolls retain their source move, stable storage key, die
sides, natural results, and combat turn; a later write to the same key replaces
the prior value and emits a factual `roll-stored` event. Durable action
restrictions retain their source effect index, target, first eligible turn,
remaining target turns, and optional blocked attack categories. A restriction
without categories skips the complete eligible action and emits
`action-skipped`; a category-scoped restriction filters only those attacks and
leaves unrelated legal choices available. The fight records
completed actions separately from presentation events and has a serializable
stack of resolution frames for suspended attack or effect work. Creation
initializes all of these collections empty; accepted current actions append
their history and advanced moves increment their use count. A turn-based Stun
now consumes the affected combatant's action during Upkeep; transformation and
broader status semantics remain unsupported until their dedicated resolution
slices define the transition.

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

- Trigger collection, conditions, ordering, optional-choice handling, and
  chaining.
- Stacking, replacement, and expiration.
- Duration ownership and clocks, such as actor turns, target turns, global
  turns, action uses, and combat lifetime.
- Damage, resource-cost, stat, roll, healing, cap, minimum, and rounding
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

Expected rule failures are discriminated unions, such as invalid fight setup,
stale decision, wrong phase, insufficient Ki, unavailable move, or exhausted
restricted use. The creation boundary reports a typed invalid-state failure if
its internal invariant validation fails; later transitions should maintain those
invariants by construction.

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

- [ADR 0001: Combat state and transition model](../adr/0001-combat-state-and-transition-model.md)
- [ADR 0002: Combat resolution and reactions](../adr/0002-combat-resolution-and-reactions.md)
- [ADR 0003: Effect ordering and calculation pipelines](../adr/0003-effect-ordering-and-calculation-pipelines.md)
- [ADR 0004: Fight versioning and persistence boundary](../adr/0004-fight-versioning-and-persistence-boundary.md)
- [ADR 0005: Counter-chain engineering safeguard](../adr/0005-counter-chain-engineering-safeguard.md)
- [ADR 0006: Explicit combat scope boundary](../adr/0006-explicit-combat-scope-boundary.md)
