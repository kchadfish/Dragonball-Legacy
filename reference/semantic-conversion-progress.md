# Semantic Conversion Progress

This ledger preserves the semantic move-effect conversion state across agent
context changes. It supplements `normalization-decisions.md`.

## Completed Foundation

- All 499 moves have typed catalogs, source provenance, base mechanics, and
  ordered effect clauses.
- The catalog contains 2,776 ordered clauses.
- Structured effects are source-traceable and validated against their source
  effect text.
- Approved normalization rulings are recorded as ND-010 through ND-021.

## Current Scope

The semantic pass has completed `reference/moves/aoyosumu.md` (61 of 61
moves), `reference/moves/kurokonwaku.md` (60 of 60 moves), and
`reference/moves/akaikaru.md` (60 of 60 moves), and
`reference/moves/freestyle.md` (49 of 49 moves), and
`reference/moves/haokiru.md` (60 of 60 moves), and
`reference/moves/kiihakai.md` (61 of 61 moves),
`reference/moves/afterlife.md` (88 of 88 moves), and
`reference/moves/midorikatai.md` (60 of 60 moves).

As of the latest reindex, 499 of 499 moves have declarative structured
effects. The current per-catalog counts are:

- Afterlife: 88 of 88
- Akaikaru: 60 of 60
- Aoyosumu: 61 of 61
- Freestyle: 49 of 49
- Haokiru: 60 of 60
- Kiihakai: 61 of 61
- Kurokonwaku: 60 of 60
- Midorikatai: 60 of 60

## Next Work

1. Keep the semantic-coverage audit green when adding or changing move data.

## Latest Completion Audit

The 2026-07-30 completion audit loaded all 499 `MOVE_DEFINITIONS` and found
498 with declarative effects. Defiant Stance is the sole intentionally empty
`effects` list: its source defines only a standard Block stopping physical or
energy attacks. No unmapped move IDs remain, no move-effect map contains a
`source-expression` placeholder, and SB-002 through SB-004 are resolved.

## Work Rule

Do not infer undefined source mechanics. Record a concrete ruling request only
when an effect cannot be represented from approved rules and decisions.
