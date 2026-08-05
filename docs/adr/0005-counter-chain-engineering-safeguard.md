# ADR 0005: Counter-chain engineering safeguard

**Status:** Accepted

## Context

The canonical rules define a Counter phase that repeats whenever a countered
counter attack itself qualifies for a counter. They do not define a maximum
number of consecutive counter attacks. An implementation without a bound would
permit an unbounded resolution loop and make deterministic resource use and
event output vulnerable to runaway inputs.

## Decision

`GLOBAL_RULES.combat.engineeringSafeguards.maximumConsecutiveCounterAttacks`
is set to `3`. This is an engineering safeguard, not a value transcribed from
`reference/rules.md`.

The count starts with the first counter attack, excludes the original action,
and resets when the counter chain ends. Once three consecutive counter attacks
have resolved, the engine must not offer or resolve a fourth counter attack in
that chain. The eventual resolver must make the safeguard's activation visible
through structured output.

## Consequences

* Counter resolution remains finite and deterministic even when opposing
  effects repeatedly qualify for counters.
* Consumers can distinguish an engineered limit from a canonical game rule.
* A future source-backed rule may supersede the safeguard through a new ADR and
  corresponding configuration change.
