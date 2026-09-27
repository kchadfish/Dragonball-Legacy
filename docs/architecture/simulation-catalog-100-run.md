# Complete catalog at 100 mirrored pairs

Superseded for the current investigation by [the budgeted study](simulation-budgeted-study.md). Do not launch this exhaustive pipeline for that study.

This run uses eight workers, 100 mirrored pairs per matchup, all 1,128 natural
matchups, and an uncapped deterministic capability selection. The initial
selection has 143 recipes: 85 restricted-use, 51 status/control, and seven
transformations. Coverage is limited to definitions selectable in the 48 current
templates. Anomaly recipes are frozen after natural analytics completes.

The original checkpoint is never overwritten. Preparation writes a read-only
copy, SHA-256, provenance, and JSON/Markdown inventories under
`artifacts/simulation/catalog-100-complete`. The saved baseline records 11 complete cells, one missing pair, and 1,116
unstarted cells. No v4 continuation fights are run. Natural v5 analytics schedules
225,600 fights, controlled analytics 57,200, and diagnostic analytics 28,600,
plus 600 per anomaly recipe selected after natural analytics. The incomplete v4
metric baseline remains explicit in the final inventory.

After the required tests and repository gate pass, start the sequential pipeline:

```sh
tmux new-session -d -s catalog-100 -c /workspaces/Dragonball-Legacy 'bash scripts/complete-simulation-catalog.sh'
```

The pipeline freezes the existing v4 checkpoint without running v4 fights,
collects all natural v5 cells, freezes capability and anomaly recipes, runs
controlled and diagnostic phases, and builds the evidence bundle.
Each analytics phase publishes JSON, CSV, Markdown, and source dossiers. Each
phase must pass completion and integrity checks before the next starts.

Inspect `pipeline.log`, the individual phase logs, and
`*.checkpoint.json.progress.json` in the output directory. Progress separates
saved fights, this invocation's saved fights, nominal remaining fights, last
checkpoint time, throughput, ETA, checkpoint growth, RSS, and free storage.
Initial and final checkpoints are written as well as periodic checkpoints.
Analytics saves every 32 successful fights. No v4 runner is invoked.
Resource guards stop after a durable save when RSS exceeds 12 GiB or available
storage falls below 2 GiB or the projected checkpoint growth reserve. A failed
atomic-write capacity check preserves the preceding checkpoint.

On interruption, rerun the same shell script in the named session. Failed request
identities and successful partial orientations/branches remain in the checkpoint;
only missing work is scheduled. Signal handlers are not needed for recovery.
Frozen files and requested baseline, target, evidence role, and selection must
match on resume. Older analytics manifests without `cellScope` retain the
`sufficient` default. Operational worker and checkpoint intervals can change.

The v4 baseline remains incomplete by instruction and its unfinished cells are
not part of the analytics completion target. Statistical sufficiency, unavailable
observations, execution failures, and collector completion remain explicit. Do
not interpret 100 completed pairs as sufficient statistical evidence, and do not
mark analytics complete until `completion-inventory.json` and all closure checks
pass.
