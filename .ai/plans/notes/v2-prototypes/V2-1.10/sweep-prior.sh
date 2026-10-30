#!/bin/bash
# Sweep the tempo prior width for the JS beat detector.
cd "$(dirname "$0")" || exit 1
for sd in 0.5 0.7; do
  echo "== PRIOR_SD=$sd"
  PRIOR_SD=$sd bun expC-beats.mjs 2>&1 | grep -E "mean F|s[0-9]-|all-|bed|repo-" | cut -c1-150
done
