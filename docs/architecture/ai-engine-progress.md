# AI-engine implementation progress

## 2026-08-30 - Phase 0 complete: AI-000 through AI-030

Phase 0 is implemented in `@dragonball-resurgence/ai-engine`.

- AI-000: the workspace has a public root export, project references, lockfile
  registration, and the architecture-approved dependency allowlist.
- AI-010: versioned personality and difficulty profiles, combined profile
  identity, immutable mechanics views, request/result/failure contracts,
  ordered candidate score factors, provenance, and diagnostic retention are
  public contracts.
- AI-020: probability checks, bounded score noise, keyed mistake selection, and
  tie-breaking derive from the combat engine's keyed source using the root seed,
  profile/evaluator versions, purpose, and semantic key. They are independent
  of live combat randomness and candidate iteration order.
- AI-030: the safe fallback validates structural request consistency without
  recalculating legality, ranks non-surrender candidates at an equal baseline,
  places surrender below viable alternatives, preserves the exact supplied
  legal object, and retains complete pending selections.

Focused evidence is in `packages/ai-engine/src/random.test.ts` and
`packages/ai-engine/src/safe-fallback.test.ts`. Boundary evidence is in
`scripts/validate-ai-engine-boundaries.test.ts`; focused-check routing includes
the AI workspace and validator. Phase 0 does not integrate `npc-ai`, add
strategic evaluators, generate a capability matrix, or alter combat rules.

The next resume point is AI-100: generate the AI capability matrix from the
closed combat scope and public descriptors. Until then, no
`ai-engine-capability-matrix.md` is created.

## 2026-08-30 - Phase 1 complete: AI-100 through AI-130

Phase 1 is complete. The generated [AI capability matrix](ai-engine-capability-matrix.md)
accounts for all nine `LegalDecision` discriminants, all seven
`PendingDecision` discriminants, all three declarative selection cardinalities,
and engine-authored response options. The matrix also preserves all 14
approved `ai-combat-scope:v1` exclusions and groups future strategic work by
roadmap capability.

- AI-100: `scripts/ai-capability-matrix.ts` generates the committed matrix from
  the closed scope fixture, public combat descriptors/contracts, evaluator
  registries, and registered exclusions. A parity test rejects stale manual
  output.
- AI-110: `extractDecisionFeatures` returns immutable, typed, non-authoritative
  features. Costs, effects, scarcity, targets, action consumption, selection,
  and terminal behavior are copied from combat descriptors; catalog data only
  contributes advisory identity. Descriptor drift and missing catalog identity
  fail with typed errors.
- AI-120: exhaustive `satisfies Record<...>` registries account for every public
  legal and pending union member and response shape. Phase 0's safe fallback is
  explicitly the baseline evaluator for each surface.
- AI-130: `validate:ai-capability-closure` rejects missing classifications or
  proof, duplicate IDs, invalid exclusions, and registry/matrix drift; it runs
  from `npm run check` and focused-check routing.

The next and highest-priority ready capability is AI-200, the structured
score-factor and diagnostic foundation. Strategic scoring, NPC integration,
lookahead, and combat-rule changes remain deferred.

## 2026-08-30 - Phase 2 complete: AI-200 through AI-240

Phase 2 is complete for the deterministic immediate-utility slice. The AI now
consumes a required combat-engine `immediate-outcome:v1` descriptor summary and
selects only from the supplied legal decisions. The descriptor records
conservative resource, damage, healing, lethality, overkill, self-harm,
defeat-prevention, action-economy, delayed-work, and completeness facts without
running a transition or consuming combat randomness.

- AI-200: score factors are typed, signed, ordered, versioned, and backed by a
  discriminated basis. Diagnostics use `ai-decision-diagnostics:v1` and retain
  state/profile/evaluator versions, candidate identity, factors, totals, rank,
  and tie-break provenance.
- AI-210 through AI-230: the fixed `baseline-immediate:v1` registry scores
  state-relative resources, damage, healing, survival, KO, terminal, and action
  economy utility. Conditional ranges use the conservative first-quartile
  estimate; delayed facts are discounted; tactical subtotal clamping is an
  explicit factor.
- AI-240: `selectImmediateUtilityDecision` is public and `selectLegalDecision`
  routes to it when a descriptor facade is supplied, while
  `selectSafeLegalDecision` remains the Phase 0 fallback. Selection retains the
  exact legal object and does not invoke `probeCombatDecision`.

Focused evidence is in `packages/ai-engine/src/immediate-utility.test.ts` and
`packages/combat-engine/src/analysis.test.ts`. The generated capability matrix
is schema v2: AI-200 through AI-240 are complete with verified proof,
AI-300 through AI-340 are ready, and personality, difficulty, scarcity,
lookahead, and later strategic phases remain deferred. No application, NPC, or
persistence migration was required. The next resume point is AI-300.

## 2026-08-30 - PRE-010 through PRE-040 combat handoff contracts

The first AI preflight contract slice is complete in the public
`@dragonball-resurgence/combat-engine` boundary. `LegalDecision` now carries a
complete `selectedOptionIds` response, with `optionId` and `optionIds` retained
as canonical compatibility projections. Pending choices enumerate every valid
one, up-to, and all selection in persisted candidate order, including an
explicit decline only when the pending option set permits it. Unsupported
pending frames remain absent from the legal set so enumeration remains
submit-ready.

Combat now exports `CombatDecisionDescriptor` and descriptor enumeration. The
descriptor is assembled from compiled move/item effect plans plus engine-owned
cost and scarcity probes; it contains no source prose or executable AI rule.
The public analysis facade enumerates decisions, describes them, and probes a
legal decision through the ordinary immutable transition boundary, returning
the successor state, structured events, terminal completion, and optional
diagnostic trace. Caller-owned deterministic node/probe budget accounting is
also public.

AI keyed randomness and speculative combat dependencies are separated from
live `CombatDependencies`. Keyed values derive from root seed, profile and
evaluator versions, purpose, and semantic key. Branch dependencies derive a
branch combat seed and provide a fixed clock, branch-local ID source, and
declared work budget. They do not share live random or ID sources.

Focused evidence is in `candidate-resolution.test.ts`, `analysis.test.ts`,
and the updated pending-flow regressions. `npc-ai`, applications, and
persistence currently export no consumers of these contracts, so no downstream
implementation migration was required. The next dependency is AI-000/010
package scaffolding and keyed fallback policy.

## 2026-08-30 - PRE-000 closed combat scope v1

PRE-000 is complete. This record freezes the AI handoff scope at
`ai-combat-scope:v1` after the completed Combat Phase 11 closure. It is an
accounting declaration, not a second source of combat rules.

### Authority and closure proof

The declaration is tied to these repository records:

- [Combat Phase 11 completion record](combat-engine-progress.md)
- [Generated combat capability matrix](combat-engine-capability-matrix.md)
- [Versioned combat scope-decision registry](../../packages/combat-engine/src/scope-decisions.ts)
- [Representative public-boundary fixtures](ai-engine-legal-decision-fixtures.json)

The Phase 11 completion record reports 1,612 accounted combat occurrences,
zero `unsupported-in-scope` rows, and an explicit scope decision for every
excluded occurrence. The closure validator passed on 2026-08-30 with:

```text
npm run validate:combat-capability-closure
Combat capability closure is complete.
```

No combat capability-matrix row is carried into AI implementation as an
unclassified mechanic. Supported rows remain combat-engine facts exposed by
future descriptors or probes; they are not reimplemented by AI. Excluded rows
remain excluded below and require a new combat-scope decision before they can
enter AI accounting.

### Closed legal-decision discriminants

These are the complete discriminants of the combat-engine `LegalDecision`
union. The fixture file records submit-ready examples from the public combat
surface. `cancel-fight` is intentionally absent: it is an application-
authorized `CombatDecision`, not an enumerated player or NPC legal decision.

| Discriminant                  | Closed meaning supplied by combat-engine                                                                           | Representative public behavior                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pass`                        | Consume an ordinary action without a combat effect.                                                                | Action-phase enumeration in `basic-attack.test.ts`.                                                |
| `power-up`                    | Take the engine-owned power-up transition.                                                                         | Upkeep/action progression and resource-cap tests in `progress-fight.test.ts`.                      |
| `surrender`                   | End the fight as a surrender loss.                                                                                 | Always-present terminal choice in the basic legal-action enumeration.                              |
| `basic-attack`                | Choose one of punch, kick, or ki blast against the other local combatant.                                          | Three basic attacks enumerated in `basic-attack.test.ts`.                                          |
| `use-move`                    | Use an engine-legal move against the local opponent; the same discriminant also represents a legal counter attack. | Converted attack and counter enumeration in `death-beam.test.ts` and `basic-attack.test.ts`.       |
| `activate-transformation`     | Activate one available transformation profile during the action phase.                                             | Transformation activation in `transformation-activation.test.ts`.                                  |
| `deactivate-transformation`   | Revert the active transformation during the action phase.                                                          | Manual deactivation in `transformation-activation.test.ts`.                                        |
| `use-item`                    | Use one combat-usable item when timing, capacity, ownership, and cost permit.                                      | Item action/free-use behavior in `item-effects-runtime.test.ts`.                                   |
| `respond-to-pending-decision` | Submit one option from the current persisted pending decision.                                                     | Defense response and optional-effect responses in `death-beam.test.ts` and `basic-attack.test.ts`. |

The closed ordinary legal surface is phase-filtered and state-filtered by the
engine. It is not the Cartesian product of every row above: the active phase,
active combatant, restrictions, costs, uses, cooldowns, transformation state,
and pending work determine which members are offered.

### Closed pending-decision types

The pending union is also closed for this scope:

| Pending type           | Selection-bearing?                                                        | Representative mechanic or contract evidence                                            |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `defense-response`     | No declarative candidate selection; response options are engine-authored. | Roll defense, use a block, or other defense response in public attack resolution.       |
| `post-defense-roll`    | No declarative candidate selection; response options are engine-authored. | Post-defense reaction/counter opportunity after a defense roll.                         |
| `optional-effect`      | Sometimes; may include explicit `decline`.                                | Optional paid effects, reactions, activation groups, and forced transformation choices. |
| `select-combatant`     | Yes; combatant candidates.                                                | Generic candidate resolution for a local participant/opponent target.                   |
| `select-move`          | Yes; move candidates.                                                     | Deactivation, suppression, move-target, and other move selections.                      |
| `select-source-action` | Yes; completed source-action candidates.                                  | Contract-declared prior-action selection for copy/replay mechanics.                     |
| `select-source-effect` | Yes; source-effect candidates.                                            | Contract-declared source-clause selection for copied or selected effects.               |

`select-source-action` and `select-source-effect` are retained in the closed
public union even though the current public transition fixtures do not emit
them directly. They are accounted contract surfaces, not evidence of an AI
evaluator or of a currently emitted mechanic. A future engine change must add
public transition coverage before AI implementation treats either as
strategically understood.

### Closed selection cardinalities

The only declarative selection cardinalities in the active combat scope are:

| Cardinality | Meaning                                         | Empty selection                                                                                                                                               |
| ----------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `one`       | Exactly one candidate must be selected.         | Rejected.                                                                                                                                                     |
| `up-to`     | One through the resolved limit may be selected. | Allowed only when the pending choice is explicitly optional and the caller selects `decline`; a zero-length selected set is not an ordinary `up-to` response. |
| `all`       | Every persisted candidate must be selected.     | Allowed only for an explicitly optional choice through `decline`; otherwise rejected.                                                                         |

`up-to` limits may be literal or resolved from an engine-owned numeric
expression. The selection metadata and candidate snapshot belong to the
combat engine. At this PRE-000 boundary, `LegalDecision` still exposes a
single `optionId`; normalized `selectedOptionIds` are accepted by
`CombatDecisionInput` but a complete multi-selection member is PRE-010 work.
AI must therefore consume only complete supplied legal members and must not
construct `one`, `up-to`, or `all` combinations itself.

### Representative in-scope mechanics

These mechanics are representative strategic inputs, not duplicated AI rules.
Their authoritative outcomes remain in the combat engine and their source
coverage is visible in the closed matrix and public tests.

| Mechanic family         | Representative behavior included in the handoff                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Action economy          | Ordinary actions, free/reaction work, pass, power-up, forced actions, extra actions, and deferred actions.                                     |
| Attack and defense      | Basic and converted attacks, attack/defense rolls, blocks, counters, stopped/blocked/successful outcomes, criticals, and counter-chain limits. |
| Resources and scarcity  | HP and Ki costs, gains, drains, caps, restricted uses, ordinary uses, cooldowns, and cost modifications.                                       |
| Effects and conditions  | Declarative triggers, conditions, prevention/negation, replacement, modifiers, locks, statuses, stacking, duration, and expiry.                |
| Selection and reactions | Defense responses, optional activations, target/move/source candidates, explicit cardinality, persisted candidates, and resume validation.     |
| Transformations         | Available activation, manual reversion, stability/upkeep behavior, cooldown, HP/stat overlays, and transformation-specific legal moves.        |
| Items                   | Combat item timing, action versus free use, capacity/group restrictions, activation costs, and item effects through the shared executor.       |
| Terminal state          | Knockout, surrender, completion, explicit terminal reason, and completed-state cleanup.                                                        |

### Approved AI exclusions

These exclusions mirror the registered combat scope decisions. They are
explicit AI exclusions for `ai-combat-scope:v1`; no AI policy may infer or
simulate them from source prose.

| Scope decision ID                                         | AI exclusion                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------- |
| `combat-scope:allies-and-joint-attacks`                   | Allies, joint attacks, and multi-combatant cooperation.             |
| `combat-scope:interferers-and-spectators`                 | Interferers, spectators, and interference-only behavior.            |
| `combat-scope:remote-and-relationship-targets`            | Remote, relationship-based, same-planet, and non-combatant targets. |
| `combat-scope:escape-actions-and-roll-configuration`      | Escape actions and escape-roll configuration.                       |
| `combat-scope:body-mutation`                              | Body swaps and other identity/body mutation.                        |
| `combat-scope:ownership-mutation`                         | Equipment ownership, inventory ownership, and loadout mutation.     |
| `combat-scope:racial-trait-mutation`                      | Acquiring or changing racial traits.                                |
| `combat-scope:moveset-mutation`                           | Acquiring, removing, or reassigning moves and styles.               |
| `combat-scope:identity-mutation`                          | Mastery or other permanent identity acquisition.                    |
| `combat-scope:progression-and-stat-acquisition`           | Permanent progression, rewards, training, and stat acquisition.     |
| `combat-scope:administrator-and-narrative`                | Administrator-mediated, narrative, campaign, and roleplay choices.  |
| `combat-scope:planetary-destruction`                      | Planetary or world-state destruction consequences.                  |
| `combat-scope:spaceship-combat`                           | Spaceship combat.                                                   |
| `combat-scope:spaceship-travel-storage-capacity-and-raid` | Spaceship travel, storage, capacity, operation, and raid mechanics. |

### PRE-000 handoff status

- Closed scope version: `ai-combat-scope:v1`.
- Combat authority: `@dragonball-resurgence/combat-engine` public legal and
  transition boundaries.
- AI implementation status: Phase 0 complete through AI-030.
- Next resume point: AI-100, generated AI capability accounting. PRE-010 through
  PRE-040 are complete prerequisites, and the fallback consumes only complete
  supplied legal members.
