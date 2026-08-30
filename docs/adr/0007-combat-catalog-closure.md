# ADR 0007: Combat catalog closure and innate source overlays

**Status:** Accepted

## Context

The generated catalog contains combat clauses on transformations, racial traits,
and classes that cannot be represented safely by parsing prose during a fight.
Those clauses need either a typed declarative definition with source provenance or
an explicit, versioned exclusion. Transformation mastery also needs to remain
stable when a fight is serialized and resumed.

## Decision

Innate combat mechanics are represented by hand-authored overlays keyed by the
stable definition ID and, for transformation abilities, mastery. The generator
copies the canonical clause order, text, and reference path onto every overlay
effect. Runtime discovery orders carried moves, selected traits, the selected
class, and the active transformation ability; duplicate source identities are
removed at the dispatch boundary.

Selected race traits and classes are combat-local snapshots. Durable effects and
passive capacity applications retain a discriminated source reference containing
the source kind, definition ID, effect index, and transformation mastery where
applicable. Legacy snapshots normalize to schema version 4 at public state
boundaries.

Source-only clauses are not executable. They must either be covered by typed
overlay metadata or carry a registered scope decision with a reason and future
owner. The closure validator fails on unsupported clauses, missing source
coverage, incomplete executor/test metadata, or invalid exclusion IDs. The
active catalog has no unsupported in-scope occurrences, so the validator is part
of the regular repository check gate.

## Consequences

- Static source fidelity is preserved without runtime prose interpretation.
- Innate effects participate in the same deterministic trigger and calculation
  paths as move effects.
- New catalog clauses cannot silently become “supported” without source mapping,
  an executor, focused coverage, or an explicit scope decision.
- Permanent progression, moveset ownership, narrative administration, and
  multiplayer/remote mechanics remain outside the local 1v1 combat state.
