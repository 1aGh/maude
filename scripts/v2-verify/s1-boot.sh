#!/bin/bash
# boot the scratch studio from the s1-verify worktree
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-aca2e4003458210a1 || exit 1
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/s1v
export NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_MACHINE_FILE=$S/machine.json MAUDE_INDEX_DIR=$S/index
exec bun run apps/studio/server.ts --root $S/proj > $S/server.log 2>&1
