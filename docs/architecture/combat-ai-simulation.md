# Combat AI and simulation architecture

## Status, purpose, and assumptions

This is the design for player-facing NPC AI and the future balance simulation.
The AI engine and NPC consumer adapter are implemented for the verified local
1v1 scope. The adapter is not yet a production-complete NPC encounter system;
see [NPC-AI completion roadmap](npc-ai-roadmap.md). The dedicated simulation
package now contains its Phase 0 contracts and remains separate from the
future runner and reporting workstream.

The design preserves the existing ownership boundary: game data declares game
content, the combat engine alone resolves combat, AI chooses from engine-legal
decisions, and simulations aggregate engine-resolved fights. It applies to 1v1
first; it must not assume team fights or other future modes are already
supported.

SIM-080 makes this ownership executable: combat and AI consumers bind an
immutable `CombatMechanicsView` identity, and alternate environments cannot be
silently evaluated through canonical registries. The full view is supplied by
the runtime on resume; only its identity is retained in fight state and
AI-facing replay facts.

```text
static game data + game config
              |
         combat engine <---------------- discord bot
              |                                |
              v                                v
          ai-engine ---------------------- NPC adapter
              |
              v
          simulation
              |
              v
       reports and staff review
```

The simulator measures performance under its configured policies, not perfect
play or an objective game-theoretic truth. Reports must use multiple strategies
and personalities, mirror otherwise symmetric fights, and eventually be
compared with human-play evidence.

## Package boundaries

### `@dragonball-resurgence/combat-engine`

The engine remains the sole authority for legal actions, phases, rolls,
damage, healing, Ki, statuses, transformations, effects, counters, blocks,
restricted uses, victory conditions, and state transitions. It never imports
the AI, simulator, Discord, database, or UI code.

Its simulation contract is its ordinary public contract:

```ts
createFight(input, dependencies) => CombatResult<CombatTransition>
getCombatDecisionPoint(state) => CombatDecisionPoint
submitCombatDecision(state, decision, dependencies) => CombatResult<CombatTransition>
advanceFight(state, dependencies) => CombatResult<CombatTransition>
```

The present names above are existing public engine concepts, not a request to
replace them with a second simulation API. A simulation driver repeatedly
consumes the combat-owned decision point, advances when instructed, asks a
policy to choose from the supplied legal set and actor, and submits that
decision using the same boundary as every other caller.

Required engine-readiness properties are:

- Transitions do not mutate the input state or use hidden per-fight state.
- Creation and transitions accept injected dependencies, including a seeded RNG.
- Equal state, actions, dependency behavior, and seed produce equal rolls,
  events, and resulting state.
- Legal decisions are complete for the active actor, including pending choices.
- Completed state is explicit and carries a typed termination reason.
- Events are factual and structured; full history is available for diagnostics.
- Snapshots are serializable and cheap enough to copy for shallow lookahead.
- Rule slices define finite resolution or surface a typed failure; they do not
  silently loop.
- Semantic-progress identity is combat-owned and separate from exact replay
  identity; callers do not choose meaningful state fields themselves.

The engine provides immutable transition-style state,
`enumerateLegalDecisions`, structured events, completed fight state, and
`SeededRandomSource`. AI consumer readiness is tracked in the AI progress and
capability records; the remaining work here is the dedicated simulation
package and its batch/reporting capabilities.

### `@dragonball-resurgence/ai-engine`

This package implements reusable decision quality. It consumes a snapshot of
the fight, legal decisions from the engine, game-data facts, a profile, and an
injected random source. It returns a chosen legal decision and an optional,
explainable ranking. It never applies the decision itself.

Suggested internal layout:

```text
packages/ai-engine/src/
  evaluation/ personalities/ difficulty/ combo-inference/
  lookahead/ opponent-modeling/ state-evaluation/ diagnostics/
```

`npc-ai` is the thin adapter for NPC profile selection, boss-phase changes, and
explicitly scripted priorities. That keeps NPC content concerns out of the
generic evaluator and lets simulations use the same decision system with a
simulation-quality profile.

Simulation-quality requests must declare the effective descriptor, expected-
outcome, pruning, setup, lookahead, opponent-model, and pending-expansion
capabilities available to the evaluator. The selector returns a typed failure
when that capability set is insufficient. Basic profiles may intentionally use
shallower facilities, and diagnostics/replay preserve the effective capability
identity and advisory-hint mode.

### `@dragonball-resurgence/simulation` (Phase 0 implemented)

This package contains no Discord or persistence dependency. It owns static
simulation templates rather than live character records, scenario construction,
seed allocation, batch control, analytics, anomaly triage, reports, replay, and
immutable game-data variants.

```text
packages/simulation/src/
  templates/ scenarios/ strategies/ runner/ matrices/
  analytics/ sequences/ anomaly-detection/ variants/
  reports/ replay/ cli/
```

Progression checkpoints such as `starter`, `early-game`, `midgame`,
`late-game`, and `endgame` are user-defined template/scenario metadata. The
simulation engine must not hardcode that list.

## Core contracts

The following are conceptual contracts. Exact names and branded IDs should use
the owning package's conventions when implementation begins.

```ts
export interface AiDecisionRequest {
  readonly state: FightState;
  readonly actorId: CombatantId;
  readonly legalDecisions: readonly LegalDecision[];
  readonly gameData: GameDataCatalog;
  readonly personality: AiPersonalityProfile;
  readonly difficulty: AiDifficultyProfile;
  readonly random: RandomSource;
}

export interface AiDecisionResult {
  readonly decision: LegalDecision;
  readonly evaluations: readonly ActionEvaluation[];
  readonly diagnostics?: AiDecisionDiagnostics;
}

export interface RandomSource {
  next(): number;
  integer(minimum: number, maximum: number): number;
  chance(probability: number): boolean;
  choose<T>(values: readonly T[]): T;
}

export interface AiPersonalityProfile {
  readonly aggression: number;
  readonly damagePreference: number;
  readonly defensePreference: number;
  readonly statusPreference: number;
  readonly kiConservation: number;
  readonly riskTolerance: number;
  readonly transformationPreference: number;
  readonly restrictedMoveConservation: number;
  readonly comboPreference: number;
}

export interface AiDifficultyProfile {
  readonly lookaheadDepth: number;
  readonly candidateLimit: number;
  readonly mistakeChance: number;
  readonly scoreNoise: number;
  readonly comboAwareness: "none" | "obvious" | "advanced" | "full";
  readonly opponentModeling: "none" | "basic" | "likely-responses";
  readonly evaluationPrecision: number;
}
```

The engine's current `RandomSource` provides `integer`; its seeded source is
already suitable for repeatable dice. Before the AI and simulator need the
additional convenience methods, extend the shared combat RNG contract (or add
well-tested derived helpers) without changing its deterministic consumption
semantics. A report stores its root seed plus a documented seed-derivation
scheme so a preserved anomaly can be replayed exactly.

```ts
export interface ActionEvaluation {
  readonly action: LegalDecision;
  readonly totalScore: number;
  readonly factors: Readonly<Record<string, number>>;
  readonly explanation: readonly string[];
}

export interface SimulationFightResult {
  readonly seed: number;
  readonly winnerId?: CombatantId;
  readonly loserId?: CombatantId;
  readonly turns: number;
  readonly terminationReason: "KO" | "SURRENDER" | "MAX_TURNS" | "STALEMATE" | "ERROR";
  readonly remainingHp: Readonly<Record<CombatantId, number>>;
  readonly remainingKi: Readonly<Record<CombatantId, number>>;
  readonly moveUsage: Readonly<Record<string, number>>;
  readonly moveSuccesses: Readonly<Record<string, number>>;
  readonly damageByMove: Readonly<Record<string, number>>;
  readonly statusesApplied: Readonly<Record<string, number>>;
  readonly transformationsUsed: readonly string[];
  readonly actionSequence?: readonly CombatActionSummary[];
  readonly anomalyFlags?: readonly string[];
}

export interface SimulationFightRequest {
  readonly fighterA: SimulationFighterTemplate;
  readonly fighterB: SimulationFighterTemplate;
  readonly strategyA: AiStrategy;
  readonly strategyB: AiStrategy;
  readonly seed: number;
  readonly mode: "summary" | "diagnostic" | "anomaly";
}

export interface SimulationSeriesRequest extends Omit<SimulationFightRequest, "seed"> {
  readonly iterations: number;
  readonly rootSeed: number;
  readonly mirrored: boolean;
}
```

Templates contain a race, style, stats, power level, HP, Ki, moves,
transformations, items, racial traits, status immunities, a strategy reference,
and a configurable progression-tier label. They use simulation-local IDs and
never Discord-user or persistence character IDs. The initial representative
template catalog should include balanced, high-power, high-dexterity,
defensive, burst, status-control, Ki-denial, resource-efficient, glass-cannon,
and sustained-damage archetypes.

## AI decision pipeline

Every AI caller uses this bounded pipeline:

```text
engine legal decisions
  -> immediate utility factors
  -> context and matchup adjustments
  -> personality weights
  -> setup/combo valuation
  -> prune inferior candidates
  -> selective shallow lookahead
  -> likely opponent response evaluation
  -> difficulty noise or mistakes
  -> selected legal decision + explanation
```

Immediate utility estimates expected damage, hit/critical/KO probability,
healing, prevention, Ki gains and costs, status effects, temporary changes,
restricted-use cost, retaliation/counter risk, resource preservation, and
move-denial value. It is a sum of named factors, never an opaque score. The
diagnostic surface must be able to show each signed contribution and its human
readable explanation.

Context maps those factors to the actual state: remaining HP and Ki, defensive
options, pending effects, transformation availability, opponent vulnerability,
and matchup-specific conditions. Personality applies stable preferences, while
difficulty controls the quality of reasoning. Personality dimensions include
aggression, damage/defense/status preference, Ki conservation, risk tolerance,
transformation preference, restricted-use conservation, and combo preference.

Difficulty changes lookahead depth, candidate count, score noise, mistake
chance, combo awareness, opponent modelling, evaluation precision, and resource
preservation. Easy through Boss configurations may differ in quality, but must
not rely on hidden stat bonuses. Simulation has no intentional mistakes, zero or
near-zero score noise, and the strongest safe bounded settings.

For lookahead, score all legal decisions, retain the top N, evaluate outcome
categories (miss, normal success, critical, blocked/countered, and status
outcomes), model a pruned set of likely legal responses, then evaluate the
resulting state. Use exact branching only when the branch set is small;
otherwise use probability-weighted categories. Do not build full MCTS for the
initial architecture.

## Combo inference and game-data hints

Mechanically inferred combo value comes from declarative effects and engine
facts: statuses enabling follow-ups, stat changes improving scaling moves,
Ki-drain removing responses, transformation unlocking an action, and move
removal constraining an archetype. It augments immediate utility and shallow
lookahead rather than becoming a parallel rules engine.

After the effect model and AI need are proven, game data may add optional,
validated `aiHints` such as strategic tags and preferred follow-ups. Hints are
advisory metadata, must remain declarative, and are not a substitute for engine
legality or effect behavior. No `aiHints` schema is added by this document.

## Simulation execution and performance

`simulateFight` creates a fresh template-derived fight and per-fight seeded
dependencies, then advances and submits decisions until completion, a maximum
turn count, a no-progress/stall detector, cancellation, or a typed error.
`simulateSeries` deterministically derives one seed per iteration. A matrix
expands scenario combinations, strategies, checkpoints, and mirrored variants.

Mirroring reverses fighter position, starting turn when controllable, template
assignment, and strategy assignment. It is required for balance conclusions
about otherwise symmetric matchups and first-turn bias.

Summary mode retains only per-fight facts needed by aggregation. Diagnostic mode
adds structured events, action evaluations, and full action history. Anomaly
mode runs summary-first, then preserves full records for flagged seeds. The
runner aggregates incrementally; it must not retain every state or full log.

Batch execution accepts a bounded concurrency, batch size, progress callback,
cancellation signal, and turn/no-progress caps. The first version runs locally
and sequentially or with bounded local concurrency. Worker threads or process
pools are future implementations behind the same runner contract; distributed
computing is not required.

## Analytics, sequences, and anomalies

Reports include win rate and mirrored win rate with confidence intervals,
fight-length distribution, remaining resources, move selection/success/damage
and damage-per-Ki, status application and uptime, transformation timing,
restricted-use consumption, first-turn advantage, stalemate rate, and error
rate. Win rate alone is never sufficient.

Sequence analytics retain normalized action and meaningful-state-transition
tokens. Normalization permits harmless irrelevant actions between a setup and
follow-up, while preserving turn distance and key preconditions. Analyze move
pairs/triplets, status follow-ups, transformation bursts, resource lockouts,
repeated loops, and dominant opening or finishing lines.

The anomaly layer flags, but never decides, potential balance concerns:
threshold-exceeding matchup rates; extreme selection, utility-per-Ki, or
conditional combo rates; status loops; near-permanent lockout; extreme
transformation value; excessive length; impossible transitions; dominated
alternatives; and custom moves that crowd out comparable choices. Each flag
includes metric, threshold, population, sample size, confidence, representative
seeds, contributing actions, and an investigation target. Correlation with
winning is not proof of causation, and high usage is not automatically power.

## Variants and custom-move laboratory

Experimental balance data uses an immutable, simulation-only catalog overlay or
cloned registry. Parallel runs never mutate the live global registry. A variant
record identifies its base data version and exact overrides.

Custom-move review is: schema validation, static comparable-move analysis,
temporary registry injection, representative build tests, race/style/
transformation interaction tests, combo and anomaly analysis, then a
staff-facing multi-factor report. Compare baseline, baseline plus custom move,
replacement of the nearest existing move, and multiple realistic movesets with
and without likely combo partners. This is decision support, never auto-approval
or a single universal power score.

## Reproducibility and testing

Every report records source commit, game-data and combat-engine versions, rules
version, AI profiles, simulation configuration, root and derived seed range,
template versions, variant patches, and generation time. Preserved anomaly seeds
must replay with the same actions and state transitions under those inputs.

Required tests include deterministic engine seed replay, legal-action
consistency, transitions/effects/resources/transformations/restricted uses, and
impossible-action rejection. AI tests prove it selects only legal affordable
actions, recognizes immediate KO and obvious survival, expresses personality
and difficulty differences, and is deterministic without noise. Simulation
tests cover iteration counts, mirroring, aggregate determinism, caps,
memory-safe logging, aggregation, variant isolation, and replay. Synthetic
balance tests should flag a zero-cost high-damage move and stun loop, prefer a
strictly superior move, approach even mirrored results for equivalent fighters,
and show no meaningful shift for a mechanically identical custom move.

## Development order and non-goals

1. Complete engine readiness: seeded deterministic dependencies, complete legal
   decisions, terminal reasons, snapshots, and max-turn/no-progress observability.
2. Implement immediate-utility AI with KO, Ki, healing, defense, and legality.
3. Add personality and difficulty profiles.
4. Add templates, single fights, series, basic reports, and replay.
5. Add status, transformation, restricted-use, and matchup context.
6. Add inferred combo value, optional hints, and sequence tracking.
7. Add pruned shallow lookahead and likely-response modelling.
8. Add mirrored matrices, checkpoints, bounded batch execution, and CSV/JSON reports.
9. Add anomaly/smoke-trail detection.
10. Add the custom-move laboratory and experimental variants.

Explicit non-goals are full MCTS, reinforcement learning, LLM combat decisions,
duplicated combat rules in AI, distributed computing, automatic balance verdicts,
and Discord dependencies in simulation code.

## Decisions required before implementation

- Define the supported engine rule coverage at each simulation milestone; a
  partially implemented move catalog cannot support ecosystem-wide conclusions.
- Set initial maximum-turn and no-progress policies, including how a terminal
  simulation-only stalemate is reported without changing game rules.
- Choose deterministic seed derivation and report serialization formats.
- Define template sources and the first representative moveset/checkpoint set.
- Set human-review thresholds and minimum sample/confidence requirements.
- Decide whether AI hints are needed only after mechanical inference is measured.
