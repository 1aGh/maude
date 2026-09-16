#!/usr/bin/env bash
# The native macOS lane — plan T31.
#
# Runs the real three-participant rig (there is only one: what is under test is
# what travels BETWEEN surfaces, so a native-only run would have nobody to send
# to), then judges ONLY the rows the bundled WKWebView app authored, plus the
# rig's own shared observations. A lane with no rows of its own fails.
#
#   bash runners/native-macos.sh --mode candidate --save-mode accepted
#
# Every flag is passed straight through to the surface runner.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
log="$(mktemp -t maude-native-lane)"
trap 'rm -f "$log"' EXIT
set +e
node "$ROOT/scripts/dev/sync-e2e/surface-run.mjs" "$@" 2>&1 | tee "$log"
run_status=${PIPESTATUS[0]}
set -e
out="$(sed -n 's/^Surface evidence: //p' "$log" | tail -1)"
if [ -z "$out" ]; then
  echo "the run produced no evidence directory — nothing to judge" >&2
  exit "${run_status:-1}"
fi
node "$ROOT/scripts/dev/sync-e2e/surface-lane.mjs" "$out" native
