#!/usr/bin/env bash
set -euo pipefail

session_name="sim"
project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
action="${1:-}"
if [[ $# -gt 0 ]]; then
  shift
fi

case "$action" in
  start)
    if [[ $# -eq 0 ]]; then
      printf 'Pass an existing simulation command, for example: start series\n' >&2
      exit 2
    fi
    if tmux has-session -t "$session_name" 2>/dev/null; then
      printf 'tmux session %s already exists\n' "$session_name" >&2
      exit 1
    fi
    printf -v simulation_args '%q ' "$@"
    tmux new-session -d -s "$session_name" -c "$project_root" "npm run simulate -- ${simulation_args% }"
    printf 'Started tmux session %s\n' "$session_name"
    ;;
  attach)
    exec tmux attach-session -t "$session_name"
    ;;
  status)
    if tmux has-session -t "$session_name" 2>/dev/null; then
      printf 'tmux session %s exists\n' "$session_name"
    else
      printf 'tmux session %s does not exist\n' "$session_name"
      exit 1
    fi
    ;;
  stop)
    exec tmux kill-session -t "$session_name"
    ;;
  *)
    printf 'Usage: %s {start [simulation arguments...]|attach|status|stop}\n' "$0" >&2
    exit 2
    ;;
esac
