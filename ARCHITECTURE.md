# System Architecture

**Dragonball Resurgence** is an npm workspaces TypeScript monorepo supporting forum role-play operations, automated combat moderation, NPC combat decisions, and transformation-review workflows.

---

## Architectural Principles

1. **Technology isolation:** Domain rules must remain independent of Discord, HTTP, ProBoards, database technologies, and other external systems.

2. **Composition:** Applications compose packages and expose the system to external platforms.

   * Packages must not import from `apps/`.
   * Applications must not import from other applications.
   * Cross-package imports must use public `@dragonball-resurgence/*` package exports.
   * Internal package source files must not be imported directly.

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

* Validate incoming requests.
* Authenticate and authorize callers.
* Call domain packages.
* Coordinate application workflows.
* Coordinate persistence operations.
* Translate domain results into HTTP responses.
* Expose game and character data to approved clients.

It must not:

* Implement combat calculations.
* Determine move legality.
* Define transformation requirements.
* Reimplement domain rules already owned by packages.

---

### `@dragonball-resurgence/discord-bot`

Provides Discord commands, interactions, moderator tools, and combat-session orchestration.

It may:

* Start and end combat sessions.
* Collect player actions.
* Present legal action choices supplied by the combat engine.
* Render structured combat events.
* Present moderator review requests.
* Maintain or coordinate active combat sessions using combat-engine state models.
* Forward approved actions to the combat engine.
* Display combat status, history, and results.

It must not:

* Calculate damage.
* Determine move legality independently.
* Implement status behavior.
* Resolve combat rules.
* Mutate combat state outside combat-engine operations.
* Treat Discord messages as authoritative game records.

The combat engine owns the shape, validation, and legal transitions of combat state. The Discord bot may hold active instances of that state while a fight is running.

---

### `@dragonball-resurgence/forum-scanner`

Reads approved ProBoards forum content and submits normalized thread data to application workflows.

It may:

* Poll configured boards.
* Detect new or updated threads and posts.
* Fetch approved public forum content.
* Parse thread metadata and post content.
* Normalize forum-specific data into application-neutral objects.
* Prevent duplicate processing.
* Submit normalized content for transformation evaluation.
* Report scanner and parsing failures to moderators.

Fetching, parsing, deduplication, and evaluation must remain separate concerns so changes to ProBoards markup do not affect transformation or domain logic.

It must not:

* Define transformation requirements.
* Make irreversible character changes directly.
* Mix ProBoards selectors or HTML parsing with domain evaluation rules.
* Treat forum display names as permanent character identifiers.

Applications may depend on packages but must never depend on another application.

---

## Packages

### `@dragonball-resurgence/shared`

Contains small, stable, cross-cutting primitives with no domain or infrastructure dependencies.

Appropriate contents include:

* Generic result types.
* Branded primitive helpers.
* Common error foundations.
* Logging interfaces.
* General-purpose date utilities.
* General-purpose identifier helpers.
* Technology-neutral utility types.

`shared` must not become a dumping ground for domain models merely because multiple packages use them.

Domain-specific contracts must remain in the package that owns the concept unless a separate, narrowly scoped domain package is justified.

`shared` must not depend on any other internal package.

---

### `@dragonball-resurgence/game-config`

Contains versioned universal constants and configuration governing the game.

Examples include:

* Starting and maximum Ki.
* Critical-hit multipliers.
* Dice-modification limits.
* Turn and phase configuration.
* Progression thresholds.
* Default status durations.
* Global combat limits.
* Universal healing or damage rules.
* Rules-version metadata.

Configuration describes universal values. It does not execute game behavior.

`game-config` may depend on `shared`.

---

### `@dragonball-resurgence/game-data`

Contains curated, declarative definitions of entities that exist in the game.

Examples include:

* Moves.
* Martial arts styles.
* Races.
* Transformations.
* Items.
* NPC templates.
* Status definitions.
* Transformation requirements.
* Narrative-trigger rubric references.
* Prerequisite relationships.
* Declarative effect definitions.

Game-data definitions must not contain arbitrary executable callbacks such as:

```ts
onHit()
onTurnStart()
calculateDamage()
applyTransformation()
```

Behavior must instead be represented through typed, declarative effects interpreted by the appropriate domain package.

Example:

```ts
const blazingSpeed = {
  id: 'move:akaikaru-blazing-speed',
  name: 'Blazing Speed',
  effects: [
    {
      trigger: 'on-success',
      type: 'apply-status',
      statusId: 'status:burning',
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

* Fight initialization.
* Combatant setup.
* Turn and phase progression.
* Legal-action enumeration.
* Action validation.
* Attack and defense rolls.
* HP and Ki calculations.
* Damage and healing.
* Critical hits.
* Counters.
* Blocks.
* Status effects.
* Temporary modifiers.
* Transformations during combat.
* RESTRICTED-use tracking.
* Resource consumption.
* Knockout and defeat conditions.
* Win and loss conditions.
* Structured combat-event output.
* Valid combat-state transitions.

The combat engine must not import:

* Discord libraries.
* HTTP frameworks.
* ProBoards clients or parsers.
* Database clients.
* Application-layer code.
* Platform-specific rendering utilities.

Randomness must be injected through an explicit interface so tests and simulations can reproduce outcomes.

Example:

```ts
export interface RandomSource {
  integer(minimum: number, maximum: number): number;
}
```

The engine must not call `Math.random()` directly inside domain operations.

Time must also be injected when a rule depends on the current time.

`combat-engine` may depend on `shared`, `game-config`, and `game-data`.

---

### `@dragonball-resurgence/npc-ai`

Selects NPC actions from legal actions supplied by the combat engine.

It may:

* Score legal actions.
* Apply NPC personality and fighting-style preferences.
* Consider current HP, Ki, statuses, and opponent state.
* Evaluate threats and opportunities.
* Support scripted boss phases.
* Support tactical priorities.
* Introduce controlled randomness.
* Return a selected action or ranked action recommendations.

It must not:

* Independently determine whether an action is legal.
* Calculate damage.
* Apply status effects.
* Mutate combat state directly.
* Bypass the combat engine.
* Create actions that were not included in the engine’s legal-action output.

`npc-ai` may depend on `shared`, `game-data`, and `combat-engine`.

---

### `@dragonball-resurgence/transformation-evaluator`

Evaluates whether a character may have satisfied transformation requirements.

It is responsible for:

* Objective prerequisite checks.
* Narrative-trigger assessment.
* Evidence extraction.
* Confidence ratings.
* Duplicate-award prevention.
* Approval recommendations.
* Rejection recommendations.
* Moderator-review recommendations.
* Structured evaluation results.

Declarative transformation requirements belong in `game-data`.

Examples include:

```ts
requirements: [
  {
    type: 'minimum-power-level',
    value: 500_000,
  },
  {
    type: 'required-transformation',
    transformationId: 'transformation:saiyan-stage-1',
  },
  {
    type: 'narrative-trigger',
    rubricId: 'protect-another-at-personal-risk',
  },
]
```

The evaluator interprets these requirements against character records, forum-thread evidence, and other approved inputs.

It does not:

* Define transformation statistics.
* Apply combat transformation effects.
* Mutate combat state.
* Directly unlock permanent character data without an approved application workflow.

Transformation definitions belong in `game-data`. Universal transformation configuration belongs in `game-config`. Combat-time transformation effects are resolved by `combat-engine`.

`transformation-evaluator` may depend on `shared`, `game-config`, and `game-data`.

---

### `@dragonball-resurgence/persistence`

Contains database adapters and concrete implementations for permanent records.

It may store:

* Accounts.
* Account-linking records.
* Characters.
* Character statistics.
* Learned moves.
* Unlocked transformations.
* Inventory.
* Training progress.
* Moderator decisions.
* Transformation evaluations.
* Forum-thread processing records.
* Rules versions associated with permanent rulings.
* Audit information.

It must not:

* Own or redefine game rules.
* Contain combat calculations.
* Determine transformation eligibility.
* Become the source of static move, race, item, or transformation definitions.
* depend directly on an application package.

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
import { resolveAttack } from '../../../combat-engine/src/actions/resolveAttack.js';
```

Required:

```ts
import { resolveAttack } from '@dragonball-resurgence/combat-engine';
```

Each package must expose its supported public API through:

* Its `package.json` `exports` field.
* One or more intentional package entry points.
* Exported types and functions that are considered stable package contracts.

Internal files inside `src/` are private implementation details.

Applications and packages must not use unsupported deep imports such as:

```ts
import { resolveAttack } from '@dragonball-resurgence/combat-engine/src/actions/resolveAttack.js';
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

* Array indexes.
* Display names.
* Discord usernames.
* Forum usernames.
* Mutable labels.
* Presentation order.
* Database row position.
* User-supplied text without validation.

The package that owns an entity defines its ID type and validation schema.

Example:

```ts
export type MoveId = string & {
  readonly __brand: 'MoveId';
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

npc-ai
  └── may depend on shared, game-data, and combat-engine

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

* Moves.
* Martial arts styles.
* Races.
* Transformations.
* Items.
* NPC templates.
* Status definitions.
* Transformation requirements.
* Universal configuration.

Static definitions are not player records and do not belong in the character database.

---

### Permanent player state

Permanent player state is stored through persistence adapters.

Examples include:

* Character identity.
* Character statistics.
* Learned moves.
* Unlocked transformations.
* Inventory.
* Training progress.
* Progression history.
* Moderator decisions.
* Account links.
* Approved transformation rulings.

Permanent records must use stable internal IDs.

---

### Temporary combat state

The combat engine defines temporary combat-state models and valid state transitions.

Temporary combat state may include:

* Current HP and Ki.
* Active statuses.
* Turn and phase.
* Temporary modifiers.
* RESTRICTED-use counters.
* Pending effects.
* Action history.
* Current transformation state.
* Combatant participation.
* Victory and defeat state.

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
  readonly type: 'damage-applied';
  readonly sourceCombatantId: CombatantId;
  readonly targetCombatantId: CombatantId;
  readonly amount: number;
  readonly remainingHp: number;
}
```

Applications translate these events into:

* Discord messages.
* HTTP responses.
* Moderator notifications.
* Logs.
* Persisted summaries.
* Future website UI updates.

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
      readonly type: 'insufficient-ki';
      readonly required: number;
      readonly available: number;
    }
  | {
      readonly type: 'restricted-use-exhausted';
      readonly moveId: MoveId;
    }
  | {
      readonly type: 'invalid-combat-phase';
      readonly expected: CombatPhase;
      readonly actual: CombatPhase;
    };
```

Applications determine how expected failures are presented to users.

Unexpected programming or infrastructure failures may throw exceptions.

Examples include:

* Database connection failure.
* Invalid internal configuration.
* Corrupted persisted data.
* Unreachable external service.
* Unhandled invariant violation.
* Unexpected ProBoards markup.

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

* Seeded randomness.
* Fixed sequences.
* Stubbed results.

Example:

```ts
const randomSource = new SequenceRandomSource([18, 27, 4]);
```

Domain packages must not scatter direct calls to:

```ts
Math.random()
Date.now()
new Date()
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

* Game configuration.
* Static game data.
* Domain-engine behavior.
* Relevant balance changes.

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

* Discord.
* ProBoards.
* A live HTTP server.
* A production database.
* External network access.
* Real system randomness.

Combat tests must use injected deterministic randomness.

Domain tests should verify:

* State transitions.
* Legal and illegal actions.
* Resource calculations.
* Status durations.
* Transformation effects.
* Win and loss conditions.
* Structured events.
* Domain invariants.

---

### Game-data tests

Game-data validation must detect:

* Duplicate IDs.
* Unknown references.
* Invalid effect types.
* Negative resource costs.
* Invalid percentages.
* Missing required properties.
* Transformation prerequisite cycles.
* NPC references to nonexistent moves.
* Status references that do not exist.
* Invalid RESTRICTED-use values.

---

### NPC AI tests

NPC AI tests must verify that:

* Every selected action was supplied by the combat engine as legal.
* The AI does not mutate combat state.
* Scripted phases obey their conditions.
* Randomized decisions remain within an acceptable set of outcomes.
* Invalid or empty legal-action sets are handled safely.

Tests should not require one exact action when several choices are intentionally valid.

---

### Forum-scanner tests

Forum fetching and parsing must be tested separately.

Parsing tests should use stored HTML fixtures rather than live ProBoards requests during ordinary test runs.

Tests should cover:

* New-thread detection.
* Updated-thread detection.
* Post extraction.
* Author extraction.
* Board identification.
* Pagination.
* Duplicate processing.
* Missing or changed markup.
* Malformed HTML.
* Retry and backoff behavior.

Live integration tests, when used, must be isolated from the normal unit-test suite.

---

### Persistence tests

Persistence adapters may use controlled integration tests against a disposable test database.

Persistence tests must verify:

* Repository contracts.
* Data mapping.
* Transaction behavior.
* Unique constraints.
* Migration compatibility.
* Duplicate-processing protection.

Persistence tests must not duplicate domain calculations.

---

### Application tests

Applications may mock package contracts to test:

* Command handling.
* HTTP routing.
* Input validation.
* Authentication.
* Discord rendering.
* Moderator workflows.
* Error translation.
* Application orchestration.

Application tests must not recreate combat calculations or transformation logic inside mocks.

---

## External Input Validation

All external input must be treated as untrusted.

External inputs include:

* Discord interaction data.
* HTTP requests.
* ProBoards content.
* Environment variables.
* Database records.
* Moderator form submissions.
* LLM-generated structured results.
* Imported JSON.
* User-provided identifiers.

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

* npm workspace package boundaries.
* TypeScript project references.
* `package.json` exports.
* ESLint import restrictions.
* Dependency-cycle checks.
* Unit and integration tests.
* Code review.
* Continuous integration.

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
