#!/bin/bash
# compact kg search: ks.sh "q1" "q2" ... (run from the worktree)
for q in "$@"; do
  echo "=== $q"
  kg search "$q" 2>/dev/null | jq -r '.hits[:8][] | "- [\(.kind)] \(.name|.[0:130]) :: \(.id) :: \((.elements//[])|map(select(test("DDR-")))|join(","))"'
done
