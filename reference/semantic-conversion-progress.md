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
`reference/moves/haokiru.md` (60 of 60 moves). Afterlife is complete except
for the unresolved Time Freeze ruling in SB-004. The current pass is
`reference/moves/kiihakai.md`.

As of the latest reindex, 475 of 499 moves have declarative structured
effects. The current per-catalog counts are:

- Afterlife: 87 of 88
- Akaikaru: 60 of 60
- Aoyosumu: 61 of 61
- Freestyle: 49 of 49
- Haokiru: 60 of 60
- Kiihakai: 51 of 61
- Kurokonwaku: 60 of 60
- Midorikatai: 47 of 60

## Next Work

1. Continue the remaining style catalogs, recording only genuine source
   ambiguities in `semantic-conversion-blockers.md`.
2. Add a semantic-coverage validation report before declaring the conversion
   complete.

## Work Rule

Do not infer undefined source mechanics. Record a concrete ruling request only
when an effect cannot be represented from approved rules and decisions.
