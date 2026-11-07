#!/bin/bash
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a2735bcc7ca654c2b/apps/studio || exit 1
files=()
for f in test/annotations*.test.ts* test/canvas-lib*.test.ts* test/viewport*.test.ts* test/r4-zoom-var-scope.test.tsx test/v2-perf-*.test.ts* test/perf-annot-zoom-paint.test.tsx test/input-router.test.ts test/gate-a-polish.test.tsx; do
  [ -f "$f" ] && files+=("./$f")
done
bun test --isolate "${files[@]}"
