# ADR 0006: Explicit combat scope boundary

**Status:** Accepted

## Context

The current combat engine deliberately resolves a deterministic local 1v1 fight.
Converted reference material also contains rules for additional participants,
remote relationships, escape, identity mutation, and spaceships. Leaving those
occurrences as provisional Phase 10 prerequisites makes catalog accounting
depend on roadmap wording and invites accidental runtime expansion.

## Decision

Phase 10 approves the current boundary as a versioned accounting decision. The
following exclusion categories are registered by `combat-engine` accounting;
each registered decision has a stable namespaced ID, version, reason, and
future owner:

| Category                                      | Boundary                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Allies and joint attacks                      | No ally or joint-attack participant is added to the local 1v1 fight.                                          |
| Interferers and spectators                    | Interferers and spectators do not become combatants or defense participants.                                  |
| Remote and relationship targets               | Remote, same-planet, relationship-based, and non-combatant targets remain unresolved.                         |
| Escape actions and escape-roll configuration  | Escape actions, escape rolls, and their modifiers remain excluded until an explicit escape transition exists. |
| Body mutation                                 | Body swapping does not mutate combatant identity or ownership.                                                |
| Ownership mutation                            | Equipment and loadout ownership changes remain outside temporary combat state.                                |
| Racial-trait mutation                         | Racial-trait acquisition or replacement remains outside temporary combat state.                               |
| Moveset mutation                              | Moveset and style acquisition, removal, or reassignment remains outside temporary combat state.               |
| Identity mutation                             | Temporary mastery or other identity acquisition remains outside temporary combat state.                       |
| Spaceship combat                              | Spaceship combat is separate from local character combat.                                                     |
| Spaceship travel, storage, capacity, and raid | Ship progression, travel, storage, capacity, operation, and raids remain outside combat.                      |

The registry is the single source for Phase 10 exclusion metadata used by item
adapters and capability-matrix accounting. Human-readable reasons and source
provenance remain in each matrix occurrence, but a Phase 10
`audited-out-of-scope` occurrence must reference its registered decision.

Ordinary `participants` effects remain supported when the selector resolves to
the existing two combatants. Effect-local stat calculations, including
`set-stat-comparison`, remain supported. Body Change, temporary mastery,
moveset/style acquisition, and racial-identity acquisition remain excluded.

No multiplayer, escape, identity, location, relationship, ship, or snapshot
fields are added to `FightState`. This decision does not change the runtime
public API, rules version, or snapshot schema version.

## Consequences

- Phase 10 exclusions are stable, reviewable, and machine-checkable.
- Regenerated capability reports can distinguish an approved exclusion from an
  unfinished in-scope capability without copying roadmap prose.
- A future owner must introduce its own contract and accepted decision before
  widening the boundary or making one of these mechanics executable.
