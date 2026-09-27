# Three-shard coordinator handoff

Status: no production fights or production merges have run. Checks stopped at the
user's request on 2026-09-27; full verification remains incomplete. Do not restart
checks or launch fights without a new instruction.

Coordinator branch: `study/8000-merge` (not created).
Common commit: `56c384d58b62a846a7d201056d50ba02f0eacfe2`. Study `balance-20260927`; manifest `fnv1a-32:ef36253b`;
shard plan `fnv1a-32:0d810ed1`. All shard runtimes are prepared with zero attempts.

Follow [the common runbook](../simulation-budgeted-study.md) and distribute the
self-contained [A](A.md), [B](B.md) and [C](C.md) handoffs to their machines.

1. Record a common implementation commit that includes the current study code;
   preserve unrelated working-tree changes. Record verification limitations.
2. Prepare the production study once using `prepare-shards`, then distribute the
   complete A/B/C directories and common identities. Do not use the old `/tmp`
   preflight as a production directory. Each machine uses its own worker branch.
3. Collect the three closed pilot bundles and run `merge-pilots` once using the
   common runbook. Save the pilot receipt and distribute the identical frozen
   `confirmation-plan.json` to every machine. Each imports its own receipt before
   confirmation. Do not select targets independently on the worker machines.
4. Collect the three final bundles and run `merge-final`. It validates ownership,
   identities, receipts, hashes and global attempt accounting and recomputes the
   combined statistics from observations. Keep bundles outside Git, with their
   hashes and stable storage locations recorded in the documents.
5. Merge only the three owned document commits from worker branches into the
   coordinator branch. Preserve report JSON, CSV, Markdown and merge receipts;
   record report and bundle hashes. This document is replaced by the final summary.

The coordinator directory `artifacts/simulation/study-8000/balance-20260927`
contains complete A/B/C runtime directories. Copy each owner directory intact and
compare its hashes with the corresponding handoff.

The global hard cap is 8,000 attempts, split 2,667 / 2,667 / 2,666. Incomplete
confirmation remains inconclusive. Full verification is still outstanding:
`npm run check` and `npm run test:coverage` when the user requests resuming checks.
