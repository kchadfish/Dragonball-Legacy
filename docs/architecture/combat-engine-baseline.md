# Combat-engine implementation baseline

## Purpose

This baseline is the entry criterion for combat-engine work. It records what
the converted data can currently support, what remains outside the first
engine slice, and where an implementation must stop rather than infer a rule.

Regenerate the inventory with:

```bash
npm run report:combat-mechanics
```

The script is the canonical mechanical inventory. Counts below are the verified
baseline when this document was created; update this document whenever the
data shape or the approved initial scope changes.

## Verified inventory

| Source | Verified state | Engine implication |
| --- | --- | --- |
| Moves | 499 definitions; 498 have structured effects; 837 total move effects | Suitable for representative combat slices. `move-aoyosumu-defiant-stance` intentionally has no structured effect because it is a standard block. |
| Transformations | 237 mastery abilities; 0 structured effects; all 237 are source-text-only | Transformation abilities are not in the initial engine scope. Their stat modifiers may be considered only after an explicit slice and data conversion. |
| Races | 35 racial traits and 82 classes, represented as source text/clauses | Racial traits and classes are not in the initial engine scope. |
| Items | 162 definitions; 159 have effects; 226 executable rules; 102 non-executable rules | Items, space combat, travel, marketplace, and administrator-mediated rules are not in the initial engine scope. |

The inventory currently finds 45 `source-expression` fields in move base
mechanics. These are dynamic formulas such as variable block costs or damage
based on earlier combat state. They are not unresolved source interpretations,
but no implementation may treat them as literal values. A representative move
using each formula family must establish its resolver before that move becomes
supported.

The semantic-conversion ledger reports that all move-effect source blockers are
resolved. Any new ambiguity must be added to
[`reference/semantic-conversion-blockers.md`](../../reference/semantic-conversion-blockers.md)
and resolved through the established normalization process before engine code
implements it.

## Mechanic surface

The inventory includes 837 move effects across 21 combat triggers. The highest
volume triggers are `on-success` (405), `passive` (387), `on-stopped` (67), and
`action-phase` (49). Effects target `self` (493) or `opponent` (348) most
often, but the converted data also contains `ally`, `participants`,
`interferers`, and `remote-target` targeting.

Effect types, conditions, durations, and scopes are deliberately not copied
into a hand-maintained list here. `report:combat-mechanics` emits their exact
names and counts, preventing this document from becoming stale as data changes.

The following low-frequency, composite mechanics are named-rule candidates for
later evaluation, not pre-approved named rules:

* Joint or remote participation: `join-attack`, `grant-temporary-move-use`, and
  remote/interferer targets.
* State substitution: `swap-combatant-state`, `substitute-defense`, and
  `exchange-constant-skill`.
* Contest and stored-roll flows: `resolve-contest`, `roll-and-store`, and
  `select-move-by-stored-roll`.
* Exceptional resolution changes: `block-all-dice`,
  `override-resolution-immunity`, and `stop-attack-by-deactivation`.

First attempt to express each through the standard effect runtime and
resolution frames. Register a named engine rule only when that would otherwise
obscure the domain rule.

## Initial supported scope

The first combat-engine release is limited to a deterministic, local,
untransformed, itemless one-versus-one fight.

It includes:

* Fight creation, turn ownership, upkeep/action/end progression, pass, and
  power-up where covered by approved global rules.
* Basic attacks and selected converted move definitions targeting only `self`
  or `opponent`.
* Attack/defense rolls, damage, Ki, blocks, restricted uses, and effects proven
  by the mechanic-coverage pack.
* Typed failures, immutable transitions, deterministic dependencies, legal
  decision enumeration, and structured events.

It excludes until later slices prove and support them:

* Transformation abilities, racial traits, classes, and items.
* Allies, teams, joint attacks, interferers, remote targets, and body swaps.
* Space combat, escape/travel, marketplace, quests, real-world-time limits,
  and administrator-mediated rules.
* Persistent active fights, distributed concurrency, and user-interface or NPC
  integration.

An out-of-scope definition must not be silently approximated. The engine must
either omit it from legal decisions for this scope or return a typed unsupported
mechanic failure at the boundary.

## Coverage-pack entry criteria

Before widening scope, choose converted moves that cover these behaviors:

1. Basic single-die damage and normal defense.
2. Multi-die damage and block behavior.
3. Restricted use and cost modification.
4. A temporary modifier with a defined duration.
5. An optional post-roll choice.
6. A stopped-result override or counter.
7. A status, lock, or prevention effect.

`Blown Fuse`, `Firestorm`, `Close Shave`, and `Energy Redirection` remain good
candidate acceptance moves, provided their current structured definitions are
used directly in tests.

## Completion evidence

This baseline is complete when all of the following hold:

* `npm run validate:game-data` succeeds.
* `npm run report:combat-mechanics` runs and its results agree with this
  document's scope assumptions.
* The inventory test proves all move definitions are accounted for and
  intentionally non-executable source content remains visible.
* No unresolved move conversion blocker is open.
