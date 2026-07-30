# ADR 0003: Effect ordering and calculation pipelines

**Status:** Accepted

## Context

The game-data package already represents mechanics as typed, declarative effect
definitions. Combat rules also depend on precise ordering, roll stages,
durations, stacking, caps, and rounding. Distributing those concerns through
individual move handlers would make equivalent rules behave inconsistently.

## Decision

The combat engine interprets declarative effects and centralizes their ordering,
stacking, duration, and calculation semantics. It may provide a narrow
registered named-rule escape hatch for a mechanic that cannot be expressed
clearly by composed declarative operations. Named rules must have stable IDs,
deterministic behavior, and focused tests.

Each calculation category has a named pipeline. Its exact order is defined from
the game rules, rather than inferred locally by a move. Rounding, caps, and
minimums are explicit pipeline stages. Natural dice results, dice-side changes,
result modifiers, and final results are preserved as distinct values.

## Consequences

* Static game data remains serializable, searchable, and safe to validate.
* Equivalent modifiers receive consistent semantics across moves and
  transformations.
* Existing generic `turns` and `allow`/`prevent` concepts may be expanded when
  proven necessary by vertical slices; they are not assumed to cover every
  duration or stacking rule.
* Adding a named rule requires justification and tests, preventing it from
  becoming the default implementation path.
