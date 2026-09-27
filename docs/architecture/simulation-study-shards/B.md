# Simulation study shard B

Status: handoff prepared; production not started. Checks were stopped at the user's
request on 2026-09-27. Do not restart checks or start fights without a new instruction.

| Field                                 | Value                                                 |
| ------------------------------------- | ----------------------------------------------------- |
| Branch                                | `study/8000-b` (not created yet)                      |
| Attempt cap                           | 2,667, including failures and interrupted attempts    |
| Planned pilot fights                  | 1,806 before retries                                  |
| Workers                               | 8 on this machine                                     |
| Runtime directory                     | `artifacts/simulation/study-8000/balance-20260927/B`  |
| Common implementation commit          | Not frozen; implementation is uncommitted             |
| Production manifest / shard plan hash | Not generated                                         |
| Production attempts / durable results | 0 / 0                                                 |
| Pilot / final bundle                  | Not exported                                          |
| Verification                          | Focused tests pass; full gate and coverage incomplete |

## Operator notes

This section and everything below it survive automatic progress-document updates.
Record machine name, common commit, manifest hash, bundle paths/hashes, interruptions
and transfer acknowledgements here. Update only this shard's document on its branch.

### Mission and statistical contract

You own shard B of **one 8,000-attempt study**, not a separate 8,000-fight run.
Read [the common design](../simulation-budgeted-study.md) and
[the progress log](../simulation-progress.md) before acting. The global pilot is
2,560 natural fights and 2,860 controlled screening fights. Whole mirrored pairs
and four-fight controlled blocks have deterministic owners. Follow the supplied
assignment exactly; never move fights between shards or change seeds or budgets.

All three pilots are pooled once. The coordinator then freezes one common plan
for up to 100 single-attempt diagnostics and fresh-seed confirmation of at most
five selected recipes. After receiving that plan, all machines run independently
until final merge. Failed or interrupted diagnostics are not retried. Other fights
have at most one retry, charged against this shard's cap. A few budget slots may
remain unused to preserve complete blocks.

The practical effect threshold is ±10 percentage points. Screening is exploratory;
confirmation provides independent evidence. Sparse or incomplete confirmation can
remain inconclusive. Only the coordinator computes the combined statistical report.

### Current verification and prerequisites

Focused allocation, recovery, bundle-merge and real-worker integration tests pass.
The heartbeat fixture timeout was corrected; diagnostics now cannot exceed their
allowance through retries; generated shard resume commands use the supervisor.
The final repository check and coverage rerun were interrupted at the user's
request. They have **not passed**. Do not automatically restart them in this chat.
The remaining verification action, when requested, is `npm run check` plus
`npm run test:coverage` on unchanged files. No production run is authorized now.

Before a later authorized launch, the coordinator must:

1. Record one common implementation commit containing the intended study code.
   The current HEAD alone does not contain the uncommitted implementation. Preserve
   unrelated working-tree changes when preparing that commit.
2. Prepare the production study **once**, using the common runbook, and distribute
   the complete `B/` runtime directory. Do not independently prepare a study
   on this machine. The earlier `/tmp` preparation was only a preflight.
3. Supply the exact common commit, manifest hash and shard-plan hash. All machines
   must use the same source files, dependencies, mechanics and metric definitions.

On this machine, use that commit to create the branch (replace the placeholder):

```sh
study_common_commit=REPLACE_WITH_COMMON_COMMIT_SHA
git switch -c study/8000-b "$study_common_commit"
npm ci
npm run build
```

If the branch already exists for this run, switch to it and retain the existing
runtime directory. Ensure tmux is installed. Copy the coordinator's full directory
to `artifacts/simulation/study-8000/balance-20260927/B`; it must include `manifest.json`, `shard.json`, `shard-plan.json`, the
baseline, source archive, provenance, journal and checkpoint. This shard's
`shard.json` must identify `B`. Record the supplied identities above.

### Pilot: future commands after launch is authorized

From the repository root, on `study/8000-b`:

```sh
tmux new-session -d -s study-8000-b 'node --import tsx scripts/simulation-study-supervisor.ts artifacts/simulation/study-8000/balance-20260927/B pilot >> artifacts/simulation/study-8000/balance-20260927/B/pipeline.log 2>&1'
node --import tsx scripts/simulation-study-shards.ts status --dir artifacts/simulation/study-8000/balance-20260927/B
tmux attach-session -t study-8000-b
```

The runner enforces the branch, source identity, ownership and local cap. The pilot
stops at `awaiting-pilot-merge`. Do not start confirmation or select targets locally.
When the process has exited and its lock is released, export to a new directory:

```sh
node --import tsx scripts/simulation-study-shards.ts export-shard --dir artifacts/simulation/study-8000/balance-20260927/B --stage pilot --out artifacts/simulation/bundles/B-pilot
git add docs/architecture/simulation-study-shards/B.md
git commit -m "Record shard B pilot results"
```

Transfer the **entire** `artifacts/simulation/bundles/B-pilot/` directory to
the coordinator, including `bundle.json`, journal and compressed results. Record
the destination and bundle hash here. Runtime artifacts are ignored by Git and
must be transferred separately. A Markdown document or console log is insufficient.
Keep the local runtime directory for confirmation and recovery.

### Wait for the single pilot merge

The coordinator needs closed pilot bundles from A, B and C. It runs `merge-pilots`
and returns the same `confirmation-plan.json` to all three machines. Do not change
or regenerate the plan. Place the received file at
`artifacts/simulation/confirmation-plan.json` and import it:

```sh
node --import tsx scripts/simulation-study-shards.ts import-confirmation --dir artifacts/simulation/study-8000/balance-20260927/B --plan artifacts/simulation/confirmation-plan.json
```

Import checks that the plan matches this shard's frozen pilot journal and charged
attempts. If it rejects, preserve the files and report the mismatch to the
coordinator. Do not edit hashes, receipts, journals or manifest to force a match.

### Independent confirmation: future commands

After import, run the assigned diagnostics and confirmation with the supervisor:

```sh
tmux new-session -d -s study-8000-b 'node --import tsx scripts/simulation-study-supervisor.ts artifacts/simulation/study-8000/balance-20260927/B confirmation >> artifacts/simulation/study-8000/balance-20260927/B/pipeline.log 2>&1'
node --import tsx scripts/simulation-study-shards.ts status --dir artifacts/simulation/study-8000/balance-20260927/B
```

No intermediate merge is needed. On `ready-for-final-merge`, after the process exits:

```sh
node --import tsx scripts/simulation-study-shards.ts export-shard --dir artifacts/simulation/study-8000/balance-20260927/B --stage final --out artifacts/simulation/bundles/B-final
git add docs/architecture/simulation-study-shards/B.md
git commit -m "Record shard B final results"
```

Transfer the complete `B-final/` bundle and the branch/document commit
reference to the coordinator. The final bundle includes pilot and confirmation
evidence. Record attempts, errors, unknown attempts and the exported bundle hash
here. Preserve the original runtime directory and both exports until the
coordinator confirms the final merge. If an export destination already exists,
use a new versioned path; never overwrite an earlier bundle.

### Progress, stop and recovery

- The append-only `journal.jsonl` is authoritative. Reservations are durable before
  dispatch, so unknown interrupted attempts remain charged.
- `progress.json` and `checkpoint.json` record saved progress; `results/*.json.gz`
  contains compact evidence. Console output alone is not a checkpoint.
- `heartbeat.json` is written by the supervisor every 15 minutes even while a fight
  blocks. Compare its timestamp with `lastResultAt`; liveness is not completed work.
- The owner document updates at phase boundaries and exports. Use runtime progress
  files for current counts during a phase.
- For a graceful stop, send SIGTERM to the supervisor PID recorded in
  `heartbeat.json`. It drains the current batch and saves state. Do not start a
  second supervisor while the first still runs.
- Resume the same phase using the command in this directory's `RESUME.md`, after
  confirming the old process has stopped. A stale lock requires checking its
  recorded process before removal; do not delete checkpoints or restart at zero.
- Keep the same branch, common source identity, manifest and complete directory
  when moving machines. Never use the older single-machine runner for this shard.

### Final handoff checklist

Record machine and common commit; manifest, shard-plan and confirmation-plan hashes;
charged attempts and durable results; errors and unknown attempts; journal head;
pilot/final bundle hashes and transfer destinations; owned document commit; and any
unresolved interruption. State explicitly if the cap prevented completing all
assigned blocks. The coordinator merges raw observations and the three document
branches at the end; do not average shard confidence intervals or claim unselected
recipes have been independently confirmed.
