# AI-engine capability matrix

Generated from scope `ai-combat-scope:v1` on 2026-08-30. This is an accounting artifact; combat-engine descriptors remain authoritative for mechanics.

## Authority

| Record | Path |
| --- | --- |
| combatProgress | docs/architecture/combat-engine-progress.md |
| combatCapabilityMatrix | docs/architecture/combat-engine-capability-matrix.md |
| publicContract | packages/combat-engine/src/contracts.ts |
| publicEnumeration | packages/combat-engine/src/progress-fight.ts |
| publicDescriptors | packages/combat-engine/src/decision-descriptors.ts |

## Legal decision surfaces

| ID | Surface | Classification | Roadmap owner | Feature extractor | Prerequisites | Representative scenario | Focused proof | Proof target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai-evaluator:legal-pass | pass | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | ordinary action phase | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-power-up | power-up | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | ordinary action phase | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-surrender | surrender | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | terminal surrender choice | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-basic-attack | basic-attack | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | basic attack against local opponent | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-use-move | use-move | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | ordinary or counter move | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-activate-transformation | activate-transformation | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | available transformation activation | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-deactivate-transformation | deactivate-transformation | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | manual transformation reversion | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-use-item | use-item | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | combat item use | packages/ai-engine/src/safe-fallback.test.ts |  |
| ai-evaluator:legal-respond-to-pending-decision | respond-to-pending-decision | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback | complete pending response selection | packages/ai-engine/src/safe-fallback.test.ts |  |

## Pending decision surfaces

| ID | Surface | Classification | Roadmap owner | Feature extractor | Prerequisites | Representative scenario | Focused proof | Proof target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai-evaluator:pending-defense-response | defense-response | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | engine-authored roll or block response | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:pending-post-defense-roll | post-defense-roll | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | engine-authored post-defense reaction | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:pending-optional-effect | optional-effect | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | optional activation or decline | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:pending-select-combatant | select-combatant | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | one local combatant candidate | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:pending-select-move | select-move | supported | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | one or more move candidates | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:pending-select-source-action | select-source-action | baseline | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | declared source-action candidate surface | packages/ai-engine/src/feature-extraction.test.ts | combat-engine public transition fixture for complete source selection |
| ai-evaluator:pending-select-source-effect | select-source-effect | baseline | AI-120 | ai-feature-extractor:v1 | AI-030 safe legal fallback; complete supplied LegalDecision response | declared source-effect candidate surface | packages/ai-engine/src/feature-extraction.test.ts | combat-engine public transition fixture for complete source selection |

## Response shapes

| ID | Surface | Classification | Roadmap owner | Feature extractor | Prerequisites | Representative scenario | Focused proof | Proof target |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ai-evaluator:response-one | one | supported | AI-120 | ai-feature-extractor:v1 | complete supplied LegalDecision response | exactly one persisted candidate | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:response-up-to | up-to | supported | AI-120 | ai-feature-extractor:v1 | complete supplied LegalDecision response | bounded multi-selection | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:response-all | all | supported | AI-120 | ai-feature-extractor:v1 | complete supplied LegalDecision response | all persisted candidates | packages/ai-engine/src/feature-extraction.test.ts |  |
| ai-evaluator:response-engine-authored-options | engine-authored-options | supported | AI-120 | ai-feature-extractor:v1 | complete supplied LegalDecision response | response options without declarative selection metadata | packages/ai-engine/src/feature-extraction.test.ts |  |

## Immediate utility evaluators

| ID | Code | Evaluator | Status | Proof |
| --- | --- | --- | --- | --- |
| ai-evaluator:resource-utility | resource-utility | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:damage-utility | damage-utility | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:healing-utility | healing-utility | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:survival-utility | survival-utility | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:ko-utility | ko-utility | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:terminal-utility | terminal-utility | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:action-economy | action-economy | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:tactical-clamp | tactical-clamp | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |
| ai-evaluator:baseline-fallback | baseline-fallback | ai-evaluator:baseline-immediate@baseline-immediate:v1 | complete | packages/ai-engine/src/immediate-utility.test.ts |

## Contextual evaluators

| ID | Code | Evaluator | Status | Proof |
| --- | --- | --- | --- | --- |
| ai-evaluator:state-survival-pressure | state-survival-pressure | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:state-resource-pressure | state-resource-pressure | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:state-tempo | state-tempo | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:state-recent-momentum | state-recent-momentum | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:state-horizon | state-horizon | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:status-control | status-control | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:transformation-context | transformation-context | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:scarcity-conservation | scarcity-conservation | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |
| ai-evaluator:pending-response | pending-response | ai-evaluator:combat-context@combat-context:v1 | complete | packages/ai-engine/src/contextual-utility.test.ts |

## Approved exclusions

| Scope decision ID | Category | Reason |
| --- | --- | --- |
| combat-scope:allies-and-joint-attacks | allies-and-joint-attacks | Ally participation and joint attacks require multiple combatants beyond the local deterministic 1v1 fight. |
| combat-scope:interferers-and-spectators | interferers-and-spectators | Interferers and spectators are not participants in the active local 1v1 combat state. |
| combat-scope:remote-and-relationship-targets | remote-and-relationship-targets | Remote, same-planet, relationship-based, and non-combatant targets are absent from the local 1v1 target model. |
| combat-scope:escape-actions-and-roll-configuration | escape-actions-and-roll-configuration | Escape actions and escape-roll configuration remain excluded until an explicit escape transition exists. |
| combat-scope:body-mutation | body-mutation | Body swapping changes character identity and is not temporary local combat state. |
| combat-scope:ownership-mutation | ownership-mutation | Equipment ownership and loadout mutation remain outside the temporary local combat state. |
| combat-scope:racial-trait-mutation | racial-trait-mutation | Acquiring or changing racial traits mutates identity rather than combat state. |
| combat-scope:moveset-mutation | moveset-mutation | Acquiring, removing, or reassigning moves and styles is ability ownership mutation outside local combat. |
| combat-scope:identity-mutation | identity-mutation | Temporary mastery or other identity acquisition is outside the local combat state contract. |
| combat-scope:progression-and-stat-acquisition | progression-and-stat-acquisition | Permanent progression, training, rewards, and stat acquisition belong to the character or campaign state rather than temporary combat state. |
| combat-scope:administrator-and-narrative | administrator-and-narrative | Administrator-mediated, narrative, and campaign choices are not deterministic local 1v1 combat mechanics. |
| combat-scope:planetary-destruction | planetary-destruction | Planetary destruction is a world-state consequence outside the local deterministic 1v1 combat state. |
| combat-scope:spaceship-combat | spaceship-combat | Spaceship combat is a separate combat scope from local character 1v1 combat. |
| combat-scope:spaceship-travel-storage-capacity-and-raid | spaceship-travel-storage-capacity-and-raid | Spaceship travel, storage, capacity, operation, and raid mechanics are noncombat progression or inventory behavior. |

## Coverage evidence

| ID | Kind | Surface | Source | Behavior |
| --- | --- | --- | --- | --- |
| action-phase-basic-and-flow:legal-basic-attack | legal-decision | basic-attack | packages/combat-engine/src/basic-attack.test.ts | enumerates the three zero-Ki basic attacks plus pass, power-up, and surrender |
| action-phase-basic-and-flow:legal-basic-attack | legal-decision | basic-attack | packages/combat-engine/src/basic-attack.test.ts | enumerates the three zero-Ki basic attacks plus pass, power-up, and surrender |
| action-phase-basic-and-flow:legal-basic-attack | legal-decision | basic-attack | packages/combat-engine/src/basic-attack.test.ts | enumerates the three zero-Ki basic attacks plus pass, power-up, and surrender |
| action-phase-basic-and-flow:legal-pass | legal-decision | pass | packages/combat-engine/src/basic-attack.test.ts | enumerates the three zero-Ki basic attacks plus pass, power-up, and surrender |
| action-phase-basic-and-flow:legal-power-up | legal-decision | power-up | packages/combat-engine/src/basic-attack.test.ts | enumerates the three zero-Ki basic attacks plus pass, power-up, and surrender |
| action-phase-basic-and-flow:legal-surrender | legal-decision | surrender | packages/combat-engine/src/basic-attack.test.ts | enumerates the three zero-Ki basic attacks plus pass, power-up, and surrender |
| counter-use-move:legal-use-move | legal-decision | use-move | packages/combat-engine/src/basic-attack.test.ts | counter phase offers a use-move legal decision when a counter action is available |
| defense-response-roll-or-block:pending-defense-response | pending-decision | defense-response | packages/combat-engine/src/death-beam.test.ts | converted attack pauses for the defender to choose a defense response |
| fixture:engine-authored-options | response-shape | engine-authored-options | docs/architecture/ai-engine-legal-decision-fixtures.json | engine-authored options have no declarative selection metadata |
| fixture:response-all | response-shape | all | packages/combat-engine/src/candidate-resolution.test.ts | complete LegalDecision members are enumerated in persisted option order |
| fixture:response-one | response-shape | one | packages/combat-engine/src/candidate-resolution.test.ts | complete for one option |
| fixture:response-up-to | response-shape | up-to | packages/combat-engine/src/candidate-resolution.test.ts | complete LegalDecision members are enumerated in persisted option order |
| generic-one-combatant-selection:pending-select-combatant | pending-decision | select-combatant | packages/combat-engine/src/candidate-resolution.test.ts | generic candidate resolution persists an opponent combatant candidate |
| generic-one-move-selection:pending-select-move | pending-decision | select-move | packages/combat-engine/src/candidate-resolution.test.ts | generic candidate resolution persists move candidates and one-selection metadata |
| move-item-and-transformation-actions:legal-activate-transformation | legal-decision | activate-transformation | packages/combat-engine/src/death-beam.test.ts; packages/combat-engine/src/item-effects-runtime.test.ts; packages/combat-engine/src/transformation-activation.test.ts | public action enumeration exposes move, item, and transformation decisions when state permits |
| move-item-and-transformation-actions:legal-deactivate-transformation | legal-decision | deactivate-transformation | packages/combat-engine/src/death-beam.test.ts; packages/combat-engine/src/item-effects-runtime.test.ts; packages/combat-engine/src/transformation-activation.test.ts | public action enumeration exposes move, item, and transformation decisions when state permits |
| move-item-and-transformation-actions:legal-use-item | legal-decision | use-item | packages/combat-engine/src/death-beam.test.ts; packages/combat-engine/src/item-effects-runtime.test.ts; packages/combat-engine/src/transformation-activation.test.ts | public action enumeration exposes move, item, and transformation decisions when state permits |
| move-item-and-transformation-actions:legal-use-move | legal-decision | use-move | packages/combat-engine/src/death-beam.test.ts; packages/combat-engine/src/item-effects-runtime.test.ts; packages/combat-engine/src/transformation-activation.test.ts | public action enumeration exposes move, item, and transformation decisions when state permits |
| optional-effect-decline:pending-optional-effect | pending-decision | optional-effect | packages/combat-engine/src/basic-attack.test.ts | a defense transition offers an optional effect activation or explicit decline |
| registry:ai-evaluator:legal-respond-to-pending-decision | legal-decision | respond-to-pending-decision | packages/ai-engine/src/safe-fallback.test.ts | public legal-decision union member accounted by the baseline evaluator |
| registry:ai-evaluator:pending-post-defense-roll | pending-decision | post-defense-roll | packages/ai-engine/src/feature-extraction.test.ts | closed pending-decision union member accounted by the baseline evaluator |
| registry:ai-evaluator:pending-select-source-action | pending-decision | select-source-action | packages/ai-engine/src/feature-extraction.test.ts | closed pending-decision union member accounted by the baseline evaluator |
| registry:ai-evaluator:pending-select-source-effect | pending-decision | select-source-effect | packages/ai-engine/src/feature-extraction.test.ts | closed pending-decision union member accounted by the baseline evaluator |

## Capability gaps by reusable roadmap capability

| Roadmap | Capability | Status | Prerequisite | Proof target | Proof |
| --- | --- | --- | --- | --- | --- |
| AI-200 | structured score-factor and diagnostic foundation | complete | Phase 1 accounting and AI-030 baseline | focused score-factor and diagnostic tests | verified: packages/ai-engine/src/immediate-utility.test.ts |
| AI-210 through AI-240 | resource, terminal, action-economy utility, and baseline chooser | complete | AI-200 | authoritative feature and chooser behavior tests | verified: packages/ai-engine/src/immediate-utility.test.ts |
| AI-300 through AI-340 | state, status, transformation, scarcity, and pending-choice context | complete | AI-200 through AI-240 | state-aware evaluator and pending parity tests | verified: packages/ai-engine/src/contextual-utility.test.ts |
| AI-400 through AI-430 | typed personality, difficulty, and controlled variation | complete | AI-200 through AI-340 | profile, noise, and terminal-protection tests | verified: packages/ai-engine/src/phases-4-8.test.ts |
| AI-500 through AI-540 | descriptor-driven setup, combo, denial, and advisory hints | complete | AI-400 through AI-430 | setup graph and validated hint tests | verified: packages/ai-engine/src/phases-4-8.test.ts; packages/game-data/src/ai-hints.test.ts |
| AI-600 through AI-640 | combat-owned outcome estimation, expected utility, and pruning | complete | PRE-030 and AI-500 through AI-540 | outcome classification, uncertainty, and pruning tests | verified: packages/ai-engine/src/phases-4-8.test.ts |
| AI-700 through AI-750 | isolated bounded shallow lookahead and pending expansion | complete | PRE-040 and AI-600 through AI-640 | branch isolation and deterministic budget tests | verified: packages/ai-engine/src/phases-4-8.test.ts; packages/combat-engine/src/analysis.test.ts |
| AI-800 through AI-840 | structured diagnostics, explanations, retention, and replay | complete | AI-700 through AI-750 | diagnostic retention and replay identity tests | verified: packages/ai-engine/src/phases-4-8.test.ts |
| AI-900 through AI-930 | validated NPC policy phases, tactical priorities, and public transition adapter | complete | AI-840 | NPC consumer readiness and legal-object handoff | verified: packages/npc-ai/src/index.test.ts |
| AI-1000 through AI-1040 | canonical selector, deterministic bounded consumer mode, reduced diagnostics, and AI-vs-AI proof | complete | AI-900 through AI-930 | consumer isolation and bounded autonomous driver | verified: packages/ai-engine/src/phases-9-11.test.ts |
| AI-1100 through AI-1150 | decision-quality closure, deterministic invariants, scenarios, and final accounting | complete | AI-1000 through AI-1040 | closure validator and representative quality cases | verified: packages/ai-engine/src/phases-9-11.test.ts |

## Consumer proofs

| Consumer proof | Status | Evidence |
| --- | --- | --- |
| npc-adapter | verified | packages/npc-ai/src/index.test.ts |
| canonical-ai-selector | verified | packages/ai-engine/src/phases-9-11.test.ts |
| public-combat-handoff | verified | packages/npc-ai/src/index.test.ts |

## Determinism and isolation invariants

| Invariant | Evidence |
| --- | --- |
| legal-subset | packages/ai-engine/src/phases-9-11.test.ts |
| empty-set | packages/ai-engine/src/safe-fallback.test.ts |
| input-order | packages/ai-engine/src/contextual-utility.test.ts |
| state-and-catalog-immutability | packages/ai-engine/src/phases-9-11.test.ts |
| diagnostic-invariance | packages/ai-engine/src/phases-9-11.test.ts |
| same-seed-replay | packages/ai-engine/src/phases-4-8.test.ts |
| live-rng-isolation | packages/ai-engine/src/phases-9-11.test.ts |
| branch-and-batch-isolation | packages/ai-engine/src/phases-4-8.test.ts |
| id-independent-reasoning | packages/ai-engine/src/phases-9-11.test.ts |
| safe-search-exhaustion | packages/ai-engine/src/phases-4-8.test.ts |
| pending-choice-parity | packages/ai-engine/src/contextual-utility.test.ts |

## Autonomous scenario coverage

| Scenario | Evidence |
| --- | --- |
| balanced | packages/ai-engine/src/phases-9-11.test.ts |
| power-vs-dexterity | packages/ai-engine/src/phases-9-11.test.ts |
| defense-vs-burst | packages/ai-engine/src/phases-9-11.test.ts |
| status-vs-damage | packages/ai-engine/src/phases-9-11.test.ts |
| ki-denial-vs-efficient-offense | packages/ai-engine/src/phases-9-11.test.ts |
| transformation-heavy | packages/ai-engine/src/phases-9-11.test.ts |
| restricted-use-pressure | packages/ai-engine/src/phases-9-11.test.ts |

## Accounting totals

| Surface group | Count |
| --- | ---: |
| Legal decisions | 9 |
| Pending decisions | 7 |
| Response shapes | 4 |
| Approved exclusions | 14 |
| Coverage evidence rows | 23 |
