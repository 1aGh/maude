#!/bin/bash
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
cd /Users/iagh/git/personal/maude/.claude/worktrees/ab-w204
mkdir -p $S/probehub
env HOME=$S/fakehome XDG_CONFIG_HOME=$S/fakehome/config timeout 8 /Users/iagh/.nvm/versions/node/v24.13.0/bin/node apps/hub/test/fixtures/serve-hub.mjs $S/probehub 0 2>&1 | grep -v '^    at ' | head -12
