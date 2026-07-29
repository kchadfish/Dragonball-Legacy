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
moves). The current pass is `reference/moves/kurokonwaku.md`.

As of the latest reindex, 358 of 499 moves have declarative structured
effects. The current per-catalog counts are:

- Afterlife: 59 of 88
- Akaikaru: 40 of 60
- Aoyosumu: 61 of 61
- Freestyle: 32 of 49
- Haokiru: 40 of 60
- Kiihakai: 38 of 61
- Kurokonwaku: 43 of 60
- Midorikatai: 45 of 60

## Next Work

1. Finish the remaining Kurokonwaku effect clauses in source order.
2. Continue the remaining style catalogs, recording only genuine source
   ambiguities in `semantic-conversion-blockers.md`.
3. Add a semantic-coverage validation report before declaring the conversion
   complete.

## Work Rule

Do not infer undefined source mechanics. Record a concrete ruling request only
when an effect cannot be represented from approved rules and decisions.
