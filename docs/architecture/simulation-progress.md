# Simulation-engine implementation progress

This is the verified handoff record for `@dragonball-resurgence/simulation`.
Roadmap prose remains the implementation authority; this file records what is
implemented, the evidence for it, and the next executable item.

## 2026-08-30 - SIM-080 mechanics-view integration

Simulation decision-boundary adapters now accept a bound combat runtime. The
runtime carries the immutable mechanics identity through creation,
advancement, legal-decision enumeration, descriptor/probe calls, and
submission, allowing alternate environments to run interleaved without
swapping module-level registries. The combat package owns the view and snapshot
identity; simulation remains an orchestrator and does not interpret mechanics.

## Current scope

- Scope: `simulation-scope:v1`
- Combat capability: `ai-combat-scope:v1`
- Rules version: `legacy-reference-2026-08` from `reference/rules.md`
- Public package versions: `ai-engine`, `combat-engine`, `game-config`, and
  `game-data` at `0.1.0`
- Catalog baseline: 499 moves, 24 races, and 80 transformations
- AI baseline: `profile:simulation-quality`, profile version `ai-profile:v1`,
  with declared effective analysis capabilities required for quality requests
- Provisional safeguards: maximum 100 turns, maximum 1,000 transitions,
  semantic no-progress limit 3, and sequential concurrency 1
- Transformation families: Humans, Saiyans, Hybrid-Saiyans, Namekians,
  Changelings, and Bio-Androids
- Carried exclusions: teams and joint attacks; interferers and spectators;
  remote or relationship targets; escape; body or identity mutation; permanent
  moveset or ownership mutation; permanent progression; administrator or
  narrative effects; planetary destruction; and spaceship mechanics

## Completed IDs

### SIM-000 — Scope freeze

Completed. `SIMULATION_SCOPE_V1` records the certified combat scope, public
package versions, catalog counts and content identity, legal decision-point
surface, AI profile, transformation families, and carried exclusions. The
scope derives catalog facts through `@dragonball-resurgence/game-data` public
exports.

### SIM-010 — Pre-implementation decisions

Completed as explicit provisional or resolved decisions in
`SIMULATION_DECISION_REGISTER`. The register covers semantic no-progress
identity, seed derivation, canonical JSON, statistical starting methods,
minimum exposure, template sources, variant patch surface, comparables, and
custom-review authority. Open uncertainty remains visible in the separate risk
register.

### SIM-020 — Completion gates and artifact schemas

Completed for the Phase 0 artifact envelope. Versioned contracts exist for
fight results, run manifests, aggregate reports, move-balance records, replay
records, anomaly records, and custom-move reports. The migration policy is
explicit rejection with typed `schema-mismatch` results until a tested
migrator exists.

### SIM-030 — Risk and decision registers

Completed. Risks and decisions are separate typed records. Catalog coverage,
policy sensitivity, statistical limits, and the future immutable mechanics
view are not represented as silent defaults.

### SIM-040 — Progress record

Completed. This document is the handoff record. The next executable roadmap ID
is SIM-080, because the Phase 0 public-boundary certifications are complete
and immutable mechanics-view readiness is the next prerequisite before runner
architecture freezes.

### SIM-050 — Combat decision-point certification

Completed. `getSimulationDecisionPoint` delegates to the public
`combat-engine` `getCombatDecisionPoint` contract. Tests cover ordinary action
ownership, pending defense-response ownership, advanceable upkeep, and
explicit completion. Simulation code does not inspect phase, pending frames,
or active-combatant fields to infer ownership.

### SIM-060 — Effective AI capability certification

Completed. `selectSimulationDecision` delegates selection to `ai-engine`,
preserves requested profile, pipeline/evaluator versions, effective
capabilities, AI seed derivation version, and effective work limits. A
simulation-quality request without the declared probe-backed capability set
returns `insufficient-analysis-capabilities`.

### SIM-070 — Semantic-progress certification

Completed. `createSimulationSemanticProgressIdentity` and
`hasSameSimulationSemanticProgress` delegate to the combat-owned semantic
identity. Bookkeeping-only version, event-sequence, and generated-ID changes
compare equal; meaningful state such as turns, durations, scheduled work,
restrictions, stored selections, transformations, and pending choices remains
owned by the combat identity.

## Verification evidence

- `npm run typecheck --workspace @dragonball-resurgence/simulation`
- `npx vitest run packages/simulation/src/phase-0.test.ts`
- Existing combat decision-point and semantic-progress tests remain the
  authoritative engine-level evidence for those contracts.

## Known limits and next step

The package does not yet run fights, create templates or scenarios, aggregate
observations, execute variants, or render reports. Those are later roadmap
IDs. SIM-080 must first certify that immutable mechanics views flow through
all authoritative combat and AI reads before variant or runner architecture is
implemented.
