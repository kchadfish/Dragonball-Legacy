# Budgeted simulation study

Status: A/B/C runtimes prepared at `artifacts/simulation/study-8000/balance-20260927`; verification stopped at user request. **Production execution is
paused by user instruction.** The user approved one pooled pilot merge followed
by independent confirmation on three machines. No production fights have started.

This supersedes the exhaustive 100-pair sweep for the current balance investigation.
The hard budget is 8,000 dispatched attempts, including retries and interrupted
attempts across all three machines. Each machine uses eight workers executing normal combat transitions. Existing v4 evidence
is historical context and is never relabeled as newly collected evidence.

## Frozen design

The natural pilot selects 256 of 1,128 matchups with five mirrored seeds each
(2,560 fights). A deterministic certainty subset covers every template; the
remaining selection is stratified by unordered style pair, with recorded
inclusion probabilities. The target population is the uniform template matchup
catalog, not player usage.

Controlled screening uses five four-fight blocks for each of 143 recipes
(2,860 fights). Each block contains original/mirrored baseline and variant fights.
The intervention removes the named move, item, or transformation from the focal
template, keeping the opponent and legal preference policy fixed. The effect is
full-loadout minus target-removed win score. It is specific to this policy and
matchup, not an unconditional causal claim about all uses of a move.

Up to 100 attempts reproduce diagnostics. Diagnostics are single-attempt: failed
or interrupted reproductions are charged and are not retried. At most five recipes, ranked by absolute
screening effect with stable ID tie breaks, receive the remaining confirmation
reserve. Confirmation uses fresh seeds and frozen allocations. The practical
threshold is ±0.10 win probability. Multiplicity-adjusted seed-block bootstrap
intervals are approximate; fewer than 30 complete blocks are insufficient and
degenerate samples use conservative bounded-outcome intervals. Budget exhaustion
may leave every question inconclusive.

## Implementation and recovery

Domain study contracts, deterministic sampling and analysis belong to the
simulation package. Scripts own durable I/O, supervision and tmux.

Runtime files live under `artifacts/simulation/study-8000/<study-id>/` and are
ignored by Git. A checksummed append-only journal records reservations before
dispatch and accepted compact results before acknowledgement. Unknown interrupted
attempts remain charged. Snapshots occur every 32 results or after 15 minutes at
the next result boundary. A separate supervisor writes 15-minute heartbeats even
while a fight blocks the coordinator. Generated RESUME.md gives the exact command.

Future chats: read this file and simulation-progress.md, then the run directory's
RESUME.md, manifest, journal, snapshot and heartbeat. Never infer saved progress
from console output. A different machine requires copying the full run directory;
Git documentation alone does not contain fight results.

## Verification

The user stopped the active checks on 2026-09-27. Focused tests pass, but the final
repository gate and coverage remain incomplete. Do not restart checks automatically.
When verification is requested again, run `npm run check` and `npm run test:coverage`
on unchanged files, then record the results in simulation-progress.md. Production
execution is still paused. Per-machine handoffs are in the linked A/B/C documents.

## Three-machine execution and handoff

All machines use the same validated implementation commit, common manifest,
mechanics, metric definitions and seed scheme. Shard letters are ownership labels,
not extra seed namespaces. Create branches from the common implementation commit
only after it contains the validated implementation; current work is uncommitted.

| Shard | Branch         | Attempt cap | Owned document                       |
| ----- | -------------- | ----------: | ------------------------------------ |
| A     | `study/8000-a` |       2,667 | [A.md](simulation-study-shards/A.md) |
| B     | `study/8000-b` |       2,667 | [B.md](simulation-study-shards/B.md) |
| C     | `study/8000-c` |       2,666 | [C.md](simulation-study-shards/C.md) |

The coordinator uses `study/8000-merge` and owns
[merged.md](simulation-study-shards/merged.md). Each worker branch changes only its
own results document. Runtime artifacts are ignored by Git: transfer complete
bundles separately. Merging Markdown files does not merge statistical evidence.

Whole mirrored pairs and four-fight controlled blocks stay on one machine.
Deterministic allocation balances scheduled fights within one block; the caps sum
to 8,000. Retries and unknown interrupted attempts consume local caps. A few slots
may remain unused because complete blocks must fit. Do not move tasks between
machines or independently select confirmation recipes.

The production runtime was prepared once without dispatching fights. Study ID:
`balance-20260927`; manifest `fnv1a-32:ef36253b`; shard plan
`fnv1a-32:0d810ed1`; source commit `56c384d58b62a846a7d201056d50ba02f0eacfe2`.
Each shard handoff records the source, baseline and archive checksums. Journals are
empty and checkpoints record zero attempts. Branches are not yet created.

The following commands are a **future execution runbook**, not authorization to
start now. Verification is incomplete. After it resumes and passes, use the frozen
source commit above for worker branches. Do not prepare independently on workers;
copy the already prepared shard directory.

```sh
node --import tsx scripts/simulation-study-shards.ts prepare-shards --dir artifacts/simulation/study-8000/balance-20260927
```

Preparation does not run fights. Copy each entire A/B/C directory to its machine
at the same relative path. Each contains the common manifest, source archive,
baseline and shard plan. Install with `npm ci` and run `npm run build` on each
machine. Use the corresponding branch and letter below (A shown):

```sh
git switch -c study/8000-a <COMMON_IMPLEMENTATION_COMMIT>
tmux new-session -d -s study-8000-a 'node --import tsx scripts/simulation-study-supervisor.ts artifacts/simulation/study-8000/balance-20260927/A pilot >> artifacts/simulation/study-8000/balance-20260927/A/pipeline.log 2>&1'
node --import tsx scripts/simulation-study-shards.ts status --dir artifacts/simulation/study-8000/balance-20260927/A
```

Each pilot stops at `awaiting-pilot-merge`; it cannot start confirmation by itself.
Once the process exits, export an immutable pilot bundle to a new directory:

```sh
node --import tsx scripts/simulation-study-shards.ts export-shard --dir artifacts/simulation/study-8000/balance-20260927/A --stage pilot --out artifacts/simulation/bundles/A-pilot
```

Commit only the owned document on its branch and transfer the complete bundle to
the coordinator. Repeat for B/C. On the coordinator, pool all three pilots once:

```sh
node --import tsx scripts/simulation-study-shards.ts merge-pilots --dir artifacts/simulation/study-8000/balance-20260927-merge --a artifacts/simulation/bundles/A-pilot --b artifacts/simulation/bundles/B-pilot --c artifacts/simulation/bundles/C-pilot
```

This freezes diagnostic selection and one common confirmation allocation using
pooled screening results and all charged pilot attempts. Copy its
`confirmation-plan.json` to each worker machine. Each machine validates its own
pilot journal against the shared receipts before importing (A shown):

```sh
node --import tsx scripts/simulation-study-shards.ts import-confirmation --dir artifacts/simulation/study-8000/balance-20260927/A --plan artifacts/simulation/confirmation-plan.json
tmux new-session -d -s study-8000-a 'node --import tsx scripts/simulation-study-supervisor.ts artifacts/simulation/study-8000/balance-20260927/A confirmation >> artifacts/simulation/study-8000/balance-20260927/A/pipeline.log 2>&1'
```

Confirmation now runs independently with fresh seeds, requiring no intermediate
merge. After each process exits, export with `--stage final` to a new `A-final`
(or B/C) bundle, commit its owned document, and transfer the complete bundle.
On the coordinator:

```sh
node --import tsx scripts/simulation-study-shards.ts merge-final --dir artifacts/simulation/study-8000/balance-20260927-merge --a artifacts/simulation/bundles/A-final --b artifacts/simulation/bundles/B-final --c artifacts/simulation/bundles/C-final
```

The final merge validates hashes, common identity, ownership, attempt caps, pilot
receipts and duplicate tasks. It recomputes statistics from compact observations
in canonical order; it never averages shard confidence intervals. Outputs include
`report.json`, `effects.csv`, `report.md`, `merge-receipt.json` and the coordinator's
`merged.md`. Merge the three document commits into the coordinator branch at the
end. Findings may remain inconclusive even when execution is complete.

## Durable artifacts and recovery

Each shard's `manifest.json` freezes selection, recipes, metrics, source identity
and the global budget; `shard-plan.json` and `shard.json` fix ownership and local
cap. `source.tar.gz` preserves relevant sources; provenance records the original
commit and archive digest. Restore only into a separate checkout, then install
and build; never overwrite a working tree to resume.

`journal.jsonl` is the authoritative reservation/result ledger. Compact evidence
lives in `results/*.json.gz`; `checkpoint.json` and its previous copy index saved
progress. `progress.json` and `RESUME.md` record progress and resumption instructions.
`heartbeat.json` records supervisor liveness every 15 minutes, including while a
fight is still running. Liveness is distinct from completed or saved fights.

Resume the same phase with the same supervisor command after the old process exits.
Never run the earlier single-machine CLI for this study. Preserve the full runtime
directory, including journals and unknown attempts. A stale lock requires checking
that its process has stopped before removing it. Source changes require a new
study, not silent continuation. A final bundle includes pilot and confirmation
evidence and the shared confirmation plan.

The study collects the 16 expanded metrics plus selected fresh core and move
metrics listed in its manifest. Other legacy metrics remain historical. Paired
balance effects are calculated directly from complete four-fight seed blocks.
Raw opportunity metrics have no independence-based confidence interval. Sequence
counts cover all accepted fights and are descriptive within each phase/branch;
anomaly natural-prevalence estimates use the recorded sampling weights.

A diagnostic reproduction uses the original request's seed and intervention with
extra retention; it does not enter confirmation. Confirmation alone uses fresh
phase-separated seeds. No inference combines screening with confirmation.

Stop gracefully by sending SIGTERM to the supervisor. It forwards the signal;
the coordinator drains the current batch, persists results and snapshots, then
exits. A hard kill can charge up to eight unknown in-flight attempts. There is
at most one automatic retry per logical fight; failed or interrupted attempts
consume the budget. Source changes require a new study directory, not silent
continuation with different mechanics or metric semantics.

Sequence outcome association means focal-fighter wins among fights containing a
pattern. It does not imply that executing that pattern increases win probability.
Final confirmation reports include scheduled and incomplete seed-block counts;
missing confirmation blocks prevent a positive or equivalence classification.
