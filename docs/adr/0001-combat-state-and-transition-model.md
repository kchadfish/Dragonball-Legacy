# ADR 0001: Combat state and transition model

**Status:** Accepted

## Context

Combat must work consistently through Discord, HTTP, NPC AI, and future
interfaces. It must also safely handle delayed interactions and retries without
allowing an action to apply twice.

## Decision

`FightState` is the authoritative truth for an active fight. Combat operations
are immutable, deterministic transitions from state and a typed decision to a
new state plus structured events and, where required, a pending decision.

All combat mutations enter through the engine's decision gateway. The engine
enumerates legal decisions; applications and NPC AI select only from that
enumeration. Each accepted transition increments the fight-state version.
Submitted decisions identify the version and a stable decision ID. Responses to
a pending choice also identify the pending-decision ID.

## Consequences

* The engine can be tested without a platform or database.
* Previous state is available for diagnostics and transition tests.
* Callers can reject stale user-interface interactions.
* A future repository must make version checking atomic and support decision
  idempotency; an in-memory version comparison alone does not prevent concurrent
  writes.
* Events are descriptive transition output, not an event-sourced replacement for
  state.
