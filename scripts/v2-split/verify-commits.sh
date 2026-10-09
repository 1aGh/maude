#!/usr/bin/env bash
# Verify every commit of the V2-0.2 split, one by one, in THIS checkout (detached at each
# commit, then back to where it started). Takes the shared test lane PER COMMIT, so other
# lanes can run between commits:
#   bash scripts/v2-split/verify-commits.sh <base> <tip>
# Per commit: verify-verbatim (move-only proof) · import coherence · the 11 move-proof
# source tests · release build + characterization of all 30 v1 states + boot gate.
set -uo pipefail
BASE="$1"; TIP="$2"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 2
START="$(git rev-parse --abbrev-ref HEAD)"
TESTS="test/cloud-history-posture.test.ts test/cloud-managed-save-surfaces.test.ts test/cloud-shell-surfaces.test.ts test/comment-relay-origin-gate.test.ts test/config-projection.test.ts test/export-format-scope-coherence.test.ts test/git-cloud-posture.test.ts test/history-preview-routing.test.ts test/shell-accessibility.test.ts test/sync-panel-surface.test.ts test/tree-expansion.test.ts"
fails=0
for sha in $(git rev-list --reverse "$BASE..$TIP"); do
  git checkout -q "$sha" || exit 2
  subj="$(git log -1 --format=%s | cut -c1-80)"
  r1="$(bun scripts/v2-split/verify-verbatim.mjs --base "$BASE" 2>&1 | tail -1)"
  bash scripts/check-import-coherence.sh >/tmp/v2c-coh.log 2>&1 && r2=ok || r2=FAIL
  LANE="bash scripts/v2-test-lane.sh --wait 7200 --"
  $LANE bash -c "cd apps/studio && NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 bun test $TESTS" >/tmp/v2c-tests.log 2>&1 && r3=ok || r3=FAIL
  $LANE node scripts/check-v1-characterization.mjs --build --jobs 4 --boot-gate >/tmp/v2c-char.log 2>&1 && r4=ok || r4=FAIL
  size="$(grep -o 'client.bundle.js [0-9]* B' /tmp/v2c-char.log | head -1)"
  case "$r1" in move-only:*) r1=ok ;; *) r1="FAIL ($r1)" ;; esac
  echo "$(git rev-parse --short HEAD) · verbatim $r1 · coherence $r2 · tests $r3 · characterization+boot $r4 · $size · $subj"
  if [[ "$r1$r2$r3$r4" != "okokokok" ]]; then
    fails=$((fails + 1))
    tail -5 /tmp/v2c-char.log; tail -5 /tmp/v2c-tests.log; tail -3 /tmp/v2c-coh.log
  fi
done
git checkout -q "$START"
echo "$fails commit(s) failed"
exit $((fails > 0))
