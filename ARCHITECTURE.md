# System Architecture

**Dragonball Resurgence** is an npm workspaces TypeScript monorepo supporting forum role-play operations, automated combat moderation, NPC combat decisions, and transformation-review workflows.

---

## Architectural Principles

1. **Technology isolation:** Domain rules must remain independent of Discord, HTTP, ProBoards, database technologies, and other external systems.

2. **Composition:** Applications compose packages and expose the system to external platforms.

   - Packages must not import from `apps/`.
   - Applications must not import from other applications.
   - Cross-package imports must use public `@dragonball-resurgence/*` package exports.
   - Internal package source files must not be imported directly.

3. **Declarative definitions:** Static game definitions must remain declarative data rather than arbitrary executable logic.

4. **State separation:** Static game definitions, permanent player data, and temporary combat state are separate concerns.

5. **Determinism:** Domain behavior must be reproducible in tests. Randomness, time, and other nondeterministic inputs must be injected where they affect domain outcomes.

6. **Acyclic dependencies:** Dependency cycles are strictly prohibited.

7. **Platform-neutral results:** Domain packages return structured results, events, and errors rather than Discord messages, HTTP responses, or other platform-specific output.

---

## Applications

### `@dragonball-resurgence/api`

Provides the HTTP/API boundary for combat, character, transformation, and forum-related workflows.

It may:

- Validate incoming requests.
- Authenticate and authorize callers.
- Call domain packages.
- Coordinate application workflows.
- Coordinate persistence operations.
- Translate domain results into HTTP responses.
- Expose game and character data to approved clients.

It must not:

- Implement combat calculations.
- Determine move legality.
- Define transformation requirements.
- Reimplement domain rules already owned by packages.

---

### `@dragonball-resurgence/discord-bot`

Provides Discord commands, interactions, moderator tools, and combat-session orchestration.

It may:

- Start and end combat sessions.
- Collect player actions.
- Present legal action choices supplied by the combat engine.
- Render structured combat events.
- Present moderator review requests.
- Maintain or coordinate active combat sessions using combat-engine state models.
- Forward approved actions to the combat engine.
- Display combat status, history, and results.

It must not:

- Calculate damage.
- Determine move legality independently.
- Implement status behavior.
- Resolve combat rules.
- Mutate combat state outside combat-engine operations.
- Treat Discord messages as authoritative game records.

The combat engine owns the shape, validation, and legal transitions of combat state. The Discord bot may hold active instances of that state while a fight is running.

---

### `@dragonball-resurgence/forum-scanner`

Reads approved ProBoards forum content and submits normalized thread data to application workflows.

It may:

- Poll configured boards.
- Detect new or updated threads and posts.
- Fetch approved public forum content.
- Parse thread metadata and post content.
- Normalize forum-specific data into application-neutral objects.
- Prevent duplicate processing.
- Submit normalized content for transformation evaluation.
- Report scanner and parsing failures to moderators.

Fetching, parsing, deduplication, and evaluation must remain separate concerns so changes to ProBoards markup do not affect transformation or domain logic.

It must not:

- Define transformation requirements.
- Make irreversible character changes directly.
- Mix ProBoards selectors or HTML parsing with domain evaluation rules.
- Treat forum display names as permanent character identifiers.

Applications may depend on packages but must never depend on another application.

---

## Packages

### `@dragonball-resurgence/shared`

Contains small, stable, cross-cutting primitives with no domain or infrastructure dependencies.

Appropriate contents include:

- Generic result types.
- Branded primitive helpers.
- Common error foundations.
- Logging interfaces.
- General-purpose date utilities.
- General-purpose identifier helpers.
- Technology-neutral utility types.

`shared` must not become a dumping ground for domain models merely because multiple packages use them.

Domain-specific contracts must remain in the package that owns the concept unless a separate, narrowly scoped domain package is justified.

`shared` must not depend on any other internal package.

---

### `@dragonball-resurgence/game-config`

Contains versioned universal constants and configuration governing the game.

Examples include:

- Starting and maximum Ki.
- Critical-hit multipliers.
- Dice-modification limits.
- Turn and phase configuration.
- Progression thresholds.
- Default status durations.
- Global combat limits.
- Universal healing or damage rules.
- Rules-version metadata.

Configuration describes universal values. It does not execute game behavior.

`game-config` may depend on `shared`.

---

### `@dragonball-resurgence/game-data`

Contains curated, declarative definitions of entities that exist in the game.

Examples include:

- Moves.
- Martial arts styles.
- Races.
- Transformations.
- Items.
- NPC templates.
- Status definitions.
- Transformation requirements.
- Narrative-trigger rubric references.
- Prerequisite relationships.
- Declarative effect definitions.

Game-data definitions must not contain arbitrary executable callbacks such as:

```ts
onHit();
onTurnStart();
calculateDamage();
applyTransformation();
```

Behavior must instead be represented through typed, declarative effects interpreted by the appropriate domain package.

Example:

```ts
const blazingSpeed = {
  id: "move:akaikaru-blazing-speed",
  name: "Blazing Speed",
  effects: [
    {
      trigger: "on-success",
      type: "apply-status",
      statusId: "status:burning",
      duration: 2,
    },
  ],
} as const satisfies MoveDefinition;
```

`game-data` may depend on `shared` and `game-config`.

---

### `@dragonball-resurgence/combat-engine`

Owns deterministic combat rules, action validation, state transitions, and combat resolution.

It is responsible for:

- Fight initialization.
- Combatant setup.
- Turn and phase progression.
- Legal-action enumeration.
- Action validation.
- Attack and defense rolls.
- HP and Ki calculations.
- Damage and healing.
- Critical hits.
- Counters.
- Blocks.
- Status effects.
- Temporary modifiers.
- Transformations during combat.
- RESTRICTED-use tracking.
- Resource consumption.
- Knockout and defeat conditions.
- Win and loss conditions.
- Structured combat-event output.
- Valid combat-state transitions.
- Simulation-compatible, reproducible transitions for non-interactive callers.

The combat engine must not import:

- Discord libraries.
- HTTP frameworks.
- ProBoards clients or parsers.
- Database clients.
- Application-layer code.
- Platform-specific rendering utilities.

Randomness must be injected through an explicit interface so tests and simulations can reproduce outcomes. Combat transitions must remain pure or predictably stateful: they must not mutate input state, perform I/O, or retain hidden per-fight state. The engine must support state snapshots, terminal-state detection, and legal-decision enumeration so an AI or simulator can drive every fight through the same public transition boundary used by player-facing applications.

Bulk callers may request reduced event retention, but that may only affect returned or retained diagnostics. It must never change resolved rules, random-number consumption, or the resulting fight state. A configurable maximum-turn and no-progress safeguard belongs at the simulation boundary initially; the engine must expose enough state and event information to diagnose a resulting stalled fight.

Example:

```ts
export interface RandomSource {
  integer(minimum: number, maximum: number): number;
}
```

The engine must not call `Math.random()` directly inside domain operations.

Time must also be injected when a rule depends on the current time.

#### Declarative combat-effect execution

Converted move, item, status, and transformation definitions are data, not
engine branches. The combat engine interprets those definitions through shared
rule primitives. A move-specific resolver is permitted only when an audited
mechanic cannot be represented by those primitives; it must document why and
must not duplicate the normal transition boundary.

The executor is organized around these layers:

1. **Trigger dispatch** determines which effects are eligible at a named
   combat point, such as action, upkeep, before or after a roll, success,
   stopped, resource change, or combat end.
2. **Condition evaluation** evaluates typed conditions against an explicit,
   immutable resolution context. Conditions include roll values, resources,
   statuses, move selectors, action history, hit counts, and stored rolls.
3. **Target and selector resolution** resolves self, opponent, participants,
   and eligible moves or active effects. It returns structured candidates; it
   must never silently choose a player-owned target.
4. **Pending-choice resolution** serializes optional or player-selected work
   into a versioned resolution frame and pending decision. The same public
   decision transition used for attacks resolves the choice, validates the
   option against the persisted candidates, emits events, and resumes the
   recorded phase.
5. **Effect lifecycle management** persists active effects with source,
   target, scope, duration, stacking, use limit, cooldown, activation cost,
   and explicit expiry behavior. Every persisted effect is invariant-checked.
6. **State mutation execution** applies generic resource, damage, cost, roll,
   stat, status, lock, result, and move-use changes through immutable combat
   transitions.
7. **Roll execution** owns all dice creation, rerolls, stored values, result
   overrides, dice selection, and replay-safe random consumption.
8. **Fight-flow scheduling** owns extra actions, counters, skips, deferred or
   scheduled work, and phase handoff. Effects do not mutate phases directly.

The engine must prefer adding a typed capability to one of these layers over
adding a move-name conditional in `progress-fight`. This keeps the converted
catalog executable as data and makes new moves primarily a game-data change.

Converted definitions must be compiled and validated into a typed execution
plan when game data is loaded. Compilation may normalize selectors, targets,
durations, scopes, and operation metadata, but it must not execute combat
rules or mutate a fight. It must reject unsupported converted mechanics unless
they are explicitly marked as audited out-of-scope definitions. Runtime
resolution must consume the compiled plan rather than reinterpret source text.

Each executable effect type must have one registered, typed executor. Its
contract validates the definition, compiles it to the runtime plan, and
executes that plan against an explicit resolution context:

```ts
interface EffectExecutor<T extends EffectDefinition> {
  readonly type: T["type"];

  validate(effect: T): readonly ValidationIssue[];
  compile(effect: T): CompiledEffect;
  execute(effect: CompiledEffect, context: ResolutionContext): EffectResolution;
}
```

The executor registry must be exhaustively type-checked against the
in-scope executable effect union. Adding a new executable effect discriminant
without registering its executor must fail compilation. Definitions outside the
active combat scope, such as narrative, administrator-mediated, or spaceship
rules, must be represented by explicit versioned audited exclusions rather
than omitted from that check. Tests establish executor semantics; the registry
establishes that every in-scope mechanic has been deliberately accounted for.

The executor owns one documented precedence model for effects that affect the
same rule value. Prevention and negation are evaluated first, followed by
replacement or substitution, set operations, additive modifications,
multiplicative modifications, and finally caps or floors. The declared effect
operation (`add`, `multiply`, or `set`) determines the operation's stage rather
than source wording or numeric basis. A new effect type must declare its place
in this model instead of creating move-specific ordering. The default minimum
damage floor is 0.

Game data must express selection semantics directly whenever an effect can
choose targets: required versus optional, one versus up-to versus all eligible
targets, and any selection limit. Source text may explain a rule to players,
but it must not be the engine's authority for those semantics.

The repository must maintain a generated combat capability matrix. For every
converted non-spaceship effect, it records the effect type, trigger,
conditions, target and selection requirements, scope or duration, supporting
executor capability, focused test coverage, and any audited exception. A
converted definition without an executor or exception is a validation failure,
not a runtime surprise.

An optional structured rule trace may record effects considered, condition
outcomes, resolved candidates, selected targets, applied modifiers, consumed
or expired effects, and random values. The trace is diagnostic only: enabling
or retaining it must not change a transition, event sequence, or random-number
consumption.

All choices, dice, active effects, and suspended work that can affect a later
outcome must be represented in `FightState` and structured events. Replaying a
recorded state and the same injected random sequence must produce the same
legal decisions, events, resource values, and terminal result.

The initial transformation delivery scope is Humans, Saiyans, Hybrid-Saiyans,
Namekians, Changelings, and Bio-Androids. Their combat-time transformations
must use the same declarative lifecycle and transition boundary; other race
families may remain outside the active delivery scope until explicitly added.

`combat-engine` may depend on `shared`, `game-config`, and `game-data`.

---

### `@dragonball-resurgence/ai-engine`

Provides the shared, platform-neutral decision system used by NPCs, bosses,
simulations, and diagnostic tests. This package is intentionally distinct from
the combat engine: it evaluates only engine-enumerated legal decisions and then
submits its selected decision back to the engine.

It may:

- Score and rank legal decisions with explainable utility factors.
- Apply personality and difficulty profiles.
- Infer mechanical setup and combo value from declarative data.
- Perform bounded, selective shallow lookahead and likely-response modelling.
- Produce decision diagnostics without mutating combat state.

It must not:

- Reimplement legality, damage, rolls, status resolution, or any other combat rule.
- Mutate a supplied fight state.
- Depend on Discord, applications, persistence, or simulation reporting.
- Treat advisory game-data AI hints as rules.

`ai-engine` may depend on `shared`, `game-config`, `game-data`, and
`combat-engine`.

---

### `@dragonball-resurgence/npc-ai`

Adapts shared AI policies to NPC and boss definitions. Once `ai-engine` exists,
this package owns NPC-specific configuration and phase changes, not a separate
decision-rule implementation.

It may:

- Select actions through `ai-engine` from combat-engine legal decisions.
- Map NPC personality, fighting-style preferences, and boss phases to AI profiles.
- Support scripted boss phases.
- Support tactical priorities.
- Introduce controlled randomness.
- Return a selected action or ranked action recommendations.

It must not:

- Independently determine whether an action is legal.
- Calculate damage.
- Apply status effects.
- Mutate combat state directly.
- Bypass the combat engine.
- Create actions that were not included in the engine’s legal-action output.

`npc-ai` may depend on `shared`, `game-data`, `combat-engine`, and `ai-engine`.
See [NPC-AI completion roadmap](docs/architecture/npc-ai-roadmap.md) for the
dependency-ordered path from the implemented decision adapter to production
NPC encounters.

---

### `@dragonball-resurgence/simulation` (planned)

Runs reproducible automated fights and analyzes their results for balance work.
It owns static fighter templates, scenario and matrix definitions, seed
allocation, bounded batch execution, aggregation, replay records, experimental
data variants, sequence analysis, anomaly flags, and staff-facing reports.

It may:

- Drive the combat engine through `ai-engine` for one fight, a series, or a matrix.
- Run mirrored matchups and configurable progression checkpoints.
- Retain summary-only, diagnostic, or anomaly-triggered records.
- Compare an immutable simulation-only game-data variant with a baseline.

It must not:

- Depend on Discord or player records.
- Mutate live game-data registries or derive combat outcomes outside the engine.
- Make automatic balance or custom-move approval decisions.
- Require distributed infrastructure for its initial implementation.

`simulation` may depend on `shared`, `game-config`, `game-data`,
`combat-engine`, and `ai-engine`. It must not be a dependency of those packages.
See [Combat AI and simulation architecture](docs/architecture/combat-ai-simulation.md)
for the detailed design and delivery order.

---

### `@dragonball-resurgence/transformation-evaluator`

Evaluates whether a character may have satisfied transformation requirements.

It is responsible for:

- Objective prerequisite checks.
- Narrative-trigger assessment.
- Evidence extraction.
- Confidence ratings.
- Duplicate-award prevention.
- Approval recommendations.
- Rejection recommendations.
- Moderator-review recommendations.
- Structured evaluation results.

Declarative transformation requirements belong in `game-data`.

Examples include:

```ts
requirements: [
  {
    type: "minimum-power-level",
    value: 500_000,
  },
  {
    type: "required-transformation",
    transformationId: "transformation:saiyan-stage-1",
  },
  {
    type: "narrative-trigger",
    rubricId: "protect-another-at-personal-risk",
  },
];
```

The evaluator interprets these requirements against character records, forum-thread evidence, and other approved inputs.

It does not:

- Define transformation statistics.
- Apply combat transformation effects.
- Mutate combat state.
- Directly unlock permanent character data without an approved application workflow.

Transformation definitions belong in `game-data`. Universal transformation configuration belongs in `game-config`. Combat-time transformation effects are resolved by `combat-engine`.

`transformation-evaluator` may depend on `shared`, `game-config`, and `game-data`.

---

### `@dragonball-resurgence/persistence`

Contains database adapters and concrete implementations for permanent records.

It may store:

- Accounts.
- Account-linking records.
- Characters.
- Character statistics.
- Learned moves.
- Unlocked transformations.
- Inventory.
- Training progress.
- Moderator decisions.
- Transformation evaluations.
- Forum-thread processing records.
- Rules versions associated with permanent rulings.
- Audit information.

It must not:

- Own or redefine game rules.
- Contain combat calculations.
- Determine transformation eligibility.
- Become the source of static move, race, item, or transformation definitions.
- depend directly on an application package.

Domain-specific repository interfaces should be defined by the package that owns the associated domain concept or by a dedicated technology-neutral domain-contract package.

`persistence` provides concrete implementations of those interfaces.

For example:

```ts
export interface CharacterRepository {
  findById(id: CharacterId): Promise<Character | null>;
  save(character: Character): Promise<void>;
}
```

A PostgreSQL implementation may live in `persistence`, while the interface remains with the package that owns the `Character` concept.

Current combat sessions may remain in application memory unless reconnection, recovery, auditing, or distributed deployment requirements later justify persistent fight storage.

---

## Public Package Boundaries

Packages must not import another package through a relative source path.

Prohibited:

```ts
import { resolveAttack } from "../../../combat-engine/src/actions/resolveAttack.js";
```

Required:

```ts
import { resolveAttack } from "@dragonball-resurgence/combat-engine";
```

Each package must expose its supported public API through:

- Its `package.json` `exports` field.
- One or more intentional package entry points.
- Exported types and functions that are considered stable package contracts.

Internal files inside `src/` are private implementation details.

Applications and packages must not use unsupported deep imports such as:

```ts
import { resolveAttack } from "@dragonball-resurgence/combat-engine/src/actions/resolveAttack.js";
```

A package may expose approved subpaths when necessary:

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./testing": "./dist/testing/index.js"
  }
}
```

---

## Stable IDs

Durable game entities use stable, lowercase, namespaced string IDs.

Examples:

```text
move:akaikaru-blazing-speed
race:saiyan
style:akaikaru
status:burning
transformation:saiyan-stage-2
item:senzu-bean
npc:koutton
character:12345
combatant:12345
fight:01jabc123xyz
thread:proboards-98765
```

IDs must remain separate from display names.

Display names may change. Durable IDs must not.

Do not use the following as durable identifiers:

- Array indexes.
- Display names.
- Discord usernames.
- Forum usernames.
- Mutable labels.
- Presentation order.
- Database row position.
- User-supplied text without validation.

The package that owns an entity defines its ID type and validation schema.

Example:

```ts
export type MoveId = string & {
  readonly __brand: "MoveId";
};
```

Untrusted external IDs must be validated with Zod at application boundaries before they enter domain operations.

External platform IDs should remain distinguishable from internal IDs.

For example:

```text
discord-user:123456789
proboards-user:98765
character:01jabc123xyz
```

A Discord or ProBoards identity may be linked to a character, but it is not itself the character ID.

---

## Dependency Direction

The internal dependency graph must remain acyclic.

Allowed dependency directions are:

```text
shared
  └── depends on no internal packages

game-config
  └── may depend on shared

game-data
  └── may depend on shared and game-config

combat-engine
  └── may depend on shared, game-config, and game-data

ai-engine
  -> may depend on shared, game-config, game-data, and combat-engine

npc-ai
  -> may also depend on ai-engine
  └── may depend on shared, game-data, and combat-engine

simulation (planned)
  -> may depend on shared, game-config, game-data, combat-engine, and ai-engine

transformation-evaluator
  └── may depend on shared, game-config, and game-data

persistence
  └── may depend on shared and approved domain contracts

applications
  └── may depend on packages
```

Forbidden dependency directions include:

```text
packages → applications
application → application
combat-engine → discord-bot
combat-engine → api
combat-engine → persistence
game-data → combat-engine
game-config → game-data
shared → any domain package
```

When two packages genuinely require the same contract:

1. Determine which package owns the concept.
2. Keep the contract with that owner whenever possible.
3. Depend on the owning package’s public contract.
4. Extract only broadly reusable, technology-neutral primitives into `shared`.
5. Introduce a narrowly scoped domain-contract package when ownership cannot reasonably belong to either consumer.
6. Do not move domain concepts into `shared` solely to silence a circular dependency.

Circular dependencies must be corrected architecturally rather than hidden through dynamic imports, duplicated types, or untyped boundaries.

---

## State Ownership

### Static definitions

Static definitions are stored in version-controlled TypeScript files.

Examples include:

- Moves.
- Martial arts styles.
- Races.
- Transformations.
- Items.
- NPC templates.
- Status definitions.
- Transformation requirements.
- Universal configuration.

Static definitions are not player records and do not belong in the character database.

---

### Permanent player state

Permanent player state is stored through persistence adapters.

Examples include:

- Character identity.
- Character statistics.
- Learned moves.
- Unlocked transformations.
- Inventory.
- Training progress.
- Progression history.
- Moderator decisions.
- Account links.
- Approved transformation rulings.

Permanent records must use stable internal IDs.

---

### Temporary combat state

The combat engine defines temporary combat-state models and valid state transitions.

Temporary combat state may include:

- Current HP and Ki.
- Active statuses.
- Turn and phase.
- Temporary modifiers.
- RESTRICTED-use counters.
- Pending effects.
- Action history.
- Current transformation state.
- Combatant participation.
- Victory and defeat state.

An application may hold active instances of combat state while a fight is running, but it must mutate that state only through combat-engine operations.

Temporary combat state may be discarded when the fight ends unless recovery, replay, auditing, or distributed-session requirements are introduced later.

A completed combat log or result summary may be persisted without making the database responsible for resolving combat.

---

## Event Boundaries

Domain packages return structured events rather than platform-formatted prose.

Examples of combat events include:

```text
fight-started
turn-started
move-used
attack-rolled
defense-rolled
attack-resolved
damage-applied
healing-applied
ki-spent
ki-gained
status-applied
status-removed
transformation-activated
combatant-defeated
fight-ended
```

Example:

```ts
export interface DamageAppliedEvent {
  readonly type: "damage-applied";
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly amount: number;
  readonly remainingHp: number;
}
```

Applications translate these events into:

- Discord messages.
- HTTP responses.
- Moderator notifications.
- Logs.
- Persisted summaries.
- Future website UI updates.

Domain packages must not return preformatted Discord markdown, embed objects, HTML responses, or ProBoards markup.

---

## Error Boundaries

Expected domain failures must be represented through typed results or typed domain errors.

Examples include:

```text
insufficient-ki
not-active-combatant
invalid-combat-phase
illegal-action
unknown-move
restricted-use-exhausted
prerequisite-not-met
transformation-already-unlocked
duplicate-thread-evaluation
```

Example:

```ts
export type UseMoveFailure =
  | {
      readonly type: "insufficient-ki";
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly type: "restricted-use-exhausted";
      readonly moveId: MoveId;
    }
  | {
      readonly type: "invalid-combat-phase";
      readonly expected: CombatPhase;
      readonly actual: CombatPhase;
    };
```

Applications determine how expected failures are presented to users.

Unexpected programming or infrastructure failures may throw exceptions.

Examples include:

- Database connection failure.
- Invalid internal configuration.
- Corrupted persisted data.
- Unreachable external service.
- Unhandled invariant violation.
- Unexpected ProBoards markup.

Unexpected failures must be caught and logged at application boundaries with enough context to diagnose the problem without exposing secrets.

Application code must not identify error types by parsing human-readable error messages.

---

## Randomness and Time

Randomness that affects domain outcomes must be injected.

Production may use a pseudorandom implementation:

```ts
const randomSource: RandomSource = new SystemRandomSource();
```

Tests may use:

- Seeded randomness.
- Fixed sequences.
- Stubbed results.

Example:

```ts
const randomSource = new SequenceRandomSource([18, 27, 4]);
```

Domain packages must not scatter direct calls to:

```ts
Math.random();
Date.now();
new Date();
```

through rule logic.

When current time affects a domain decision, inject a clock:

```ts
export interface Clock {
  now(): Date;
}
```

This allows time-dependent rules and evaluations to be reproduced in tests.

---

## Rules Versioning

Combat sessions, transformation rulings, and other permanent outcomes must remain attributable to the rules under which they were resolved.

A rules version should identify the applicable combination of:

- Game configuration.
- Static game data.
- Domain-engine behavior.
- Relevant balance changes.

Example:

```ts
export interface RulesVersion {
  readonly value: string;
}
```

Example value:

```text
2026.1
```

Active combat sessions should record their rules version when initialized.

Permanent moderator rulings and transformation unlocks should record the relevant rules version when approved.

Changes to current rules must not silently alter the historical meaning of completed combat logs or past rulings.

---

## Testing Boundaries

### Domain-package tests

Domain-package tests must not require:

- Discord.
- ProBoards.
- A live HTTP server.
- A production database.
- External network access.
- Real system randomness.

Combat tests must use injected deterministic randomness.

Domain tests should verify:

- State transitions.
- Legal and illegal actions.
- Resource calculations.
- Status durations.
- Transformation effects.
- Win and loss conditions.
- Structured events.
- Domain invariants.

---

### Game-data tests

Game-data validation must detect:

- Duplicate IDs.
- Unknown references.
- Invalid effect types.
- Negative resource costs.
- Invalid percentages.
- Missing required properties.
- Transformation prerequisite cycles.
- NPC references to nonexistent moves.
- Status references that do not exist.
- Invalid RESTRICTED-use values.

---

### NPC AI tests

NPC AI tests must verify that:

- Every selected action was supplied by the combat engine as legal.
- The AI does not mutate combat state.
- Scripted phases obey their conditions.
- Randomized decisions remain within an acceptable set of outcomes.
- Invalid or empty legal-action sets are handled safely.

Tests should not require one exact action when several choices are intentionally valid.

---

### Forum-scanner tests

Forum fetching and parsing must be tested separately.

Parsing tests should use stored HTML fixtures rather than live ProBoards requests during ordinary test runs.

Tests should cover:

- New-thread detection.
- Updated-thread detection.
- Post extraction.
- Author extraction.
- Board identification.
- Pagination.
- Duplicate processing.
- Missing or changed markup.
- Malformed HTML.
- Retry and backoff behavior.

Live integration tests, when used, must be isolated from the normal unit-test suite.

---

### Persistence tests

Persistence adapters may use controlled integration tests against a disposable test database.

Persistence tests must verify:

- Repository contracts.
- Data mapping.
- Transaction behavior.
- Unique constraints.
- Migration compatibility.
- Duplicate-processing protection.

Persistence tests must not duplicate domain calculations.

---

### Application tests

Applications may mock package contracts to test:

- Command handling.
- HTTP routing.
- Input validation.
- Authentication.
- Discord rendering.
- Moderator workflows.
- Error translation.
- Application orchestration.

Application tests must not recreate combat calculations or transformation logic inside mocks.

---

## External Input Validation

All external input must be treated as untrusted.

External inputs include:

- Discord interaction data.
- HTTP requests.
- ProBoards content.
- Environment variables.
- Database records.
- Moderator form submissions.
- LLM-generated structured results.
- Imported JSON.
- User-provided identifiers.

Zod schemas should validate untrusted input at the application or adapter boundary.

Once validated, domain packages should receive typed values rather than raw external payloads.

Validation does not replace domain-rule enforcement. An input may be structurally valid but still illegal under current game rules.

---

## Infrastructure Isolation

External technologies must be accessed through dedicated adapters or application boundaries.

Examples include:

```text
Discord adapter
ProBoards client
PostgreSQL repository
HTTP controller
LLM narrative evaluator
System clock
Random-number generator
```

Domain packages should depend on technology-neutral contracts where interaction is required.

Replacing ProBoards, Discord, PostgreSQL, or an LLM provider must not require rewriting combat rules or static game definitions.

---

## Architectural Enforcement

Architecture rules should be enforced through a combination of:

- npm workspace package boundaries.
- TypeScript project references.
- `package.json` exports.
- ESLint import restrictions.
- Dependency-cycle checks.
- Unit and integration tests.
- Code review.
- Continuous integration.

The following command should eventually verify the repository:

```bash
npm run check
```

It should include:

```text
Type-checking
Linting
Formatting verification
Unit tests
Game-data validation
Dependency-cycle validation
Production builds
```

A task is not complete when it merely runs locally. It is complete when the repository’s required checks pass without bypassing architectural boundaries.
