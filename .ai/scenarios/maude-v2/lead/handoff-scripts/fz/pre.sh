#!/usr/bin/env bash
cd /Users/iagh/git/personal/maude/.claude/worktrees/freeze || exit 1
export FARM_LOCAL=1
r(){ "$@" > /tmp/pre.$$.out 2>&1; rc=$?; echo "$rc  $*"; [ $rc -ne 0 ] && tail -15 /tmp/pre.$$.out; }
for s in version-parity tarball-shape containment import-coherence; do r bash scripts/check-$s.sh; done
r npx biome check .
r node scripts/gen-actions.mjs --check
r node scripts/gen-plugin-surfaces.mjs --check
r node scripts/check-v2-nothing-deleted.mjs
r node scripts/check-v2-ai-parity.mjs
for g in command-reference schema-reference stats roadmap whats-new; do r node site/scripts/build-$g.mjs; done
echo "--- diff after site gens:"; git status --short
rm -f /tmp/pre.$$.out
