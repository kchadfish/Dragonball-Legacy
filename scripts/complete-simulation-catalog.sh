#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
run_dir="artifacts/simulation/catalog-100-complete"
mkdir -p "$run_dir"
exec >> "$run_dir/pipeline.log" 2>&1
trap 'printf "Pipeline stopped at %s; resume with the same script after inspecting logs.\n" "$(date -u +%FT%TZ)"' ERR
printf 'Pipeline invocation %s\n' "$(date -u +%FT%TZ)"
npm exec tsx -- scripts/simulation-catalog-run.ts prepare
npm exec tsx -- scripts/simulation-catalog-run.ts freeze-baseline
npm run simulate -- analytics-backfill --role natural --baseline "$run_dir/baseline.checkpoint.json" --cell-scope all --target-pairs 100 --workers 8 --checkpoint-fights 32 --output "$run_dir/natural.json" >> "$run_dir/natural.log" 2>&1
npm exec tsx -- scripts/simulation-catalog-run.ts verify-v5 natural
npm exec tsx -- scripts/simulation-catalog-run.ts freeze-recipes
for role in controlled diagnostic; do
  npm run simulate -- analytics-backfill --role "$role" --baseline "$run_dir/baseline.checkpoint.json" --natural-artifact "$run_dir/natural.json" --capabilities restricted-use,status-control,transformation,anomaly --max-recipes all --recipe-selection "$run_dir/recipes.json" --target-pairs 100 --workers 8 --checkpoint-fights 32 --output "$run_dir/$role.json" >> "$run_dir/$role.log" 2>&1
  npm exec tsx -- scripts/simulation-catalog-run.ts verify-v5 "$role"
done
npm run simulate -- analytics-bundle --natural "$run_dir/natural.json" --controlled "$run_dir/controlled.json" --diagnostic "$run_dir/diagnostic.json" --output "$run_dir/bundle.json"
npm exec tsx -- scripts/simulation-catalog-run.ts final
printf 'Pipeline completed %s\n' "$(date -u +%FT%TZ)"
