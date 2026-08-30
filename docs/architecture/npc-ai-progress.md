# NPC-AI progress

## Active scope

NPC Intelligence Complete: deterministic local 1v1 NPC-versus-NPC fights driven
through `createFight`, `advanceFight`, legal-decision enumeration, and
`submitCombatDecision`. The implementation is platform-neutral and prepares a
separate Simulation consumer.

## Exclusions carried forward

Multiplayer, allies, joint attacks, interferers, remote targets, spaceship
combat, Discord commands/components, session orchestration, persistence
migrations, player handoff, production rollout, runtime prose parsing, and
canonical production-boss assignment remain out of scope.

## Completed and verified

- Canonical NPC source records remain generated and source-traceable.
- Generator parsing distinguishes fixed values, relative percentages, and
  explicit resolved values with trailing annotations.
- Every canonical NPC appears once in the generated readiness matrix.
- Automated and manual-only classification is explicit; manual-only rows carry
  typed reasons and source references.
- Normalization overlays materialize only structured combat creation inputs and
  never create fights, parse prose, choose policies, or roll randomness.
- Stable `npc-ai-policy:v1` and `npc-policy-catalog:v1` contracts exist with
  reusable authored archetypes and exhaustive automated-NPC assignments.
- Actor-explicit phase selection and NPC decisions preserve engine-enumerated
  legal objects and return deterministic replay identities.
- Synthetic two-phase and three-phase boss policies are available; canonical
  production bosses remain unassigned.
- A headless certification runner drives the real combat-engine boundaries and
  halts externally on turn, transition, or semantic no-progress limits without
  fabricating a combat outcome.
- Observational telemetry and platform-neutral inspection records are exposed.

## Verified evidence

- `npm run validate:npc-ai-boundaries`
- `npm run validate:npc-ai-readiness`
- `npx vitest run packages/npc-ai/src`
- `npm run typecheck --workspace @dragonball-resurgence/npc-ai`
- `npm run test:coverage` (74 files, 1,107 tests passed)
- `npm run typecheck --workspace @dragonball-resurgence/ai-engine`
- `npm run typecheck --workspace @dragonball-resurgence/combat-engine`
- `npm run typecheck --workspace @dragonball-resurgence/game-data`
- Ten automated NPC catalog smoke matchups passed through the headless runner.
- Combat-engine regression confirms unaffordable KI moves are not enumerated.
- AI-engine regression confirms pending actors may differ from the active combatant.
- `npm run quality` passed, including the repository final quality gate.

## Exact resume point

NPC Intelligence Complete is achieved. No resume point remains for this
roadmap slice; future work begins with the separate Simulation consumer or the
deferred production-integration milestone.
