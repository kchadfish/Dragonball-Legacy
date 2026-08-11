---
name: resurgence-convert-game-data
description: >-
  Convert canonical Dragonball Resurgence reference material into typed,
  declarative definitions in @dragonball-resurgence/game-data. Use when
  transcribing, migrating, auditing, repairing, or extending moves, items,
  transformations, races, styles, statuses, quests, locations, NPCs, or other
  static game content; validating source fidelity or traceability; or
  determining whether source mechanics fit existing declarative capabilities.
  Do not use to implement combat runtime behavior directly; also use
  resurgence-combat-change when a combat-owned public contract or runtime
  consumer must change.
---

# Convert Dragonball Resurgence Game Data

Preserve the complete mechanical meaning of canonical source material as
explicit, typed data. Keep executable behavior out of `game-data`. Prefer
documented incompleteness to invented or approximate mechanics.

## Establish authority

1. Read the repository-root `AGENTS.md` and `ARCHITECTURE.md`.
2. Read `reference/data-authoring.md`, the relevant domain document under
   `reference/`, and the applicable entries in
   `reference/normalization-decisions.md`.
3. For move conversion, also read
   `reference/semantic-conversion-progress.md` and
   `reference/semantic-conversion-blockers.md`.
4. Read the complete source entry, including adjacent notes, restrictions,
   timing, prerequisites, costs, locations, and referenced universal rules.
5. Treat approved normalization decisions as authoritative interpretations.
   Treat existing TypeScript definitions as implementation evidence, not as a
   more authoritative source than the reference corpus.

Do not silently rebalance, modernize, repair, or reinterpret source content.
Apply an existing approved normalization when applicable. If the source needs
a new ruling, record the ambiguity for review and block the affected semantic
conversion rather than guessing.

## Choose the correct editing path

Inspect `scripts/generate-game-data.ts` before editing a catalog. Never edit a
file whose header says it is generated.

- Edit canonical human-readable content under `reference/` according to
  `reference/data-authoring.md`.
- Change `scripts/generate-game-data.ts` when a generated catalog needs new
  parsing or structured output, then run `npm run generate:game-data`.
- For moves, let the generator own source catalogs such as
  `move-source-definitions.ts`; author declarative effects in the appropriate
  manually maintained `packages/game-data/src/moves/*.ts` module.
- For manually maintained styles or other catalogs, inspect the owning type,
  existing definitions, tests, and public exports before editing.
- Preserve cross-package boundaries. Import through
  `@dragonball-resurgence/*` public exports and never make `game-data` depend on
  `combat-engine`.

Use the repository's current lowercase, hyphenated ID conventions and existing
generator or validator. Search for a canonical ID before creating one. Never
derive durable identity from display order, display names, forum usernames, or
temporary labels.

## Model semantics explicitly

Separate descriptive identity from mechanics. Descriptive fields may preserve
source prose, but every engine-enforced mechanic must have typed semantics.

For each mechanical clause, determine the applicable:

- trigger and ordering;
- conditions and success dependency;
- target, eligible candidates, choice owner, count, and optionality;
- operation and semantic numeric expression, including percentage basis;
- duration, scope, expiry, stacking, and replacement behavior;
- activation cost, resource cost, use limit, cooldown, and reset boundary;
- exception to universal rules.

Preserve distinctions such as dice sides versus roll results, current versus
maximum resources, attack success versus damage dealt, before versus after a
roll, one versus up-to versus all, and additive versus replacement cost
changes. Preserve written effect order unless an approved normalization says
otherwise.

Never:

- hide an enforceable mechanic only in `description`, `effectText`, or
  `sourceText`;
- parse prose at runtime to infer behavior;
- precompute a value that depends on fight or character state;
- make a required effect optional or choose a player-owned target;
- discard timing, lifecycle, limits, exclusions, or exceptions;
- add arbitrary callbacks such as `onHit`, `canUse`, or `calculateDamage` to a
  definition.

Use source-text fields only for traceability and validation. The runtime must
consume typed semantics.

## Reuse capabilities or record a gap

Before adding a schema capability:

1. Inspect the owning types, effect unions, constants, validators, and public
   exports in `packages/game-data`.
2. Search mechanically similar definitions and downstream consumers.
3. Reuse an existing trigger, condition, selector, expression, effect,
   duration, scope, or target only when its semantics match exactly.

Distinguish two blockers:

- A **source ambiguity** means the intended mechanic is unclear. Record the
  exact source and requested ruling in the repository's ruling or blocker
  ledger and do not generate or claim the affected semantic definition.
- A **declarative capability gap** means the mechanic is clear but the schema
  cannot represent it. Record the source definition, unsupported requirement,
  closest primitive, why it is insufficient, and the smallest reusable
  capability that would represent it.

Do not approximate a gap, bury it in prose, or create a definition-specific
tag as a hidden rule. Extend `game-data` schemas only when the task authorizes
that work and the capability belongs to static definitions. Also use
`resurgence-combat-change` when the change affects a combat-owned public
contract, compiled execution plan, executor, fight state, decision, or runtime
behavior.

Classify unsupported runtime behavior as converted only when the architecture
and validators provide an explicit, versioned audited exclusion. Otherwise
block it; compilation alone does not establish runtime support.

## Implement and audit

- Prefer `as const satisfies` and the repository's existing discriminated
  unions and vocabulary.
- Preserve source paths and clause-level `sourceText` required by validation.
- Verify referenced IDs exist and remain within the correct entity domain.
- Search related definitions for precedent and inconsistent conversions. Do
  not modify unrelated definitions unless the requested scope includes a
  systemic correction; report them otherwise.
- Add focused Vitest coverage for every major conversion, behavior correction,
  schema change, or bug fix. Assert important semantic fields rather than
  snapshotting large catalogs.
- Test executable behavior in the owning domain package rather than duplicating
  runtime tests extensively in `game-data`.

## Verify incrementally

After each meaningful change, run the smallest relevant formatter, validator,
type check, or focused Vitest file.

When applicable:

1. Run `npm run generate:game-data` after changing reference material or its
   generator, then inspect generated diffs for unintended churn.
2. Run `npm run validate:reference-markdown` for source-document changes.
3. Run `npm run validate:game-data` for definitions, IDs, references, or schema
   changes.
4. Run focused Vitest tests for the affected catalog and runtime consumer.
5. Run `npm run test:coverage` when changing game rules, validation schemas,
   transformation logic, or other behavior covered by the repository's
   coverage trigger.
6. Run `npm run check` from the repository root before completion.
7. Run `npm run quality` for substantial cross-package or architectural work,
   dependency changes, CI or deployment changes, or release preparation.

Do not weaken validation, coverage, lint, or architecture rules to make a
conversion pass.

## Report the result

Report:

1. definitions converted or changed;
2. important semantic mappings and reused capabilities;
3. ambiguities, capability gaps, and audited exclusions;
4. runtime support status;
5. related definitions that may need review;
6. generation, tests, validation, and quality gates performed.

For batches, count definitions that are:

- converted and executable;
- explicitly audited out of runtime scope;
- blocked by declarative capability gaps;
- ambiguous and awaiting a ruling.

Do not label work complete when a source mechanic was knowingly omitted.
