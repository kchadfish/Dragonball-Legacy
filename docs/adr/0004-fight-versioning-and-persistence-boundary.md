# ADR 0004: Fight versioning and persistence boundary

**Status:** Accepted

## Context

Combat results must remain attributable to the rules that produced them. Active
fights may initially live in application memory, but later deployments may
require recovery, audit trails, or distributed-session support.

## Decision

Every initialized fight records a rules version. That version identifies the
applicable configuration, static game data, engine behavior, and relevant
balance changes.

The combat engine remains persistence-agnostic and synchronous unless a combat
rule itself needs asynchronous input. It produces state transitions; an
application or repository persists the resulting snapshot. Persistence must use
an atomic expected-version check when saving a fight.

Snapshot schema versioning is a separate concern from rules versioning. Add a
snapshot-schema version only when active fight snapshots are persisted.

## Consequences

* Database implementation details cannot change combat outcomes.
* Tests remain fast and deterministic.
* Rules changes cannot silently redefine a completed or active fight.
* Persistence adapters own migrations and concurrency control, while the engine
  owns rule validation and transition semantics.
