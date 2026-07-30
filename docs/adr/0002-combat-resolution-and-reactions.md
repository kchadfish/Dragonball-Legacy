# ADR 0002: Combat resolution and reactions

**Status:** Accepted

## Context

Combat rules include reactions, counters, rerolls, blocks, optional effects,
and effects that happen after a roll. Resolving each move in one uninterrupted
function would force choices into application code or create nested,
move-specific control flow.

## Decision

The engine represents phases and legal transitions explicitly. When a rule
requires a player choice, it creates a pending decision containing its stable
ID, authorized combatant, choice type, and legal options. The engine pauses
until that decision is submitted or an explicitly modelled default/timeout rule
applies.

When an interruption must resume prior work, the unfinished operation is stored
as serializable resolution-frame data. Frames are data, not closures, so a
transition remains deterministic and can later be persisted or diagnosed.

The exact phase vocabulary and frame variants are intentionally deferred until
the basic attack, block, reaction, and counter vertical slices establish the
smallest sufficient model.

## Consequences

* Platform code never decides reactions or resumes combat itself.
* Counter chains and optional post-roll effects can be resolved without deeply
  nested special-case calls.
* Pending choices are visible in authoritative state and are safe to validate.
* The initial engine should not create speculative phases or frame types before
  a representative rule needs them.
