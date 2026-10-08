#!/usr/bin/env bash
# Maude v2 single test lane (plan "Single test lane").
#
#   scripts/v2-test-lane.sh [--keep-dist] [--wait <seconds>] -- <command…>
#
# One machine, one suite at a time: parallel runs fabricate failures, and `bun test` has
# clobbered apps/studio/dist/ before. This wrapper
#   1. takes the machine-wide lock `<git common dir>/v2-test.lock` — shared by the main checkout and
#      every lane worktree (waits up to --wait seconds, default 900; a lock whose pid is gone is stale
#      and is taken over),
#   2. records `git status apps/studio/dist/` before the run,
#   3. runs the command,
#   4. compares dist/ after the run and reverts tracked files the run changed (unless --keep-dist),
#      reporting any new untracked files instead of deleting them,
#   5. releases the lock and exits with the command's exit code.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# One lock for the main checkout AND every worktree: the git common dir is shared by all of them.
COMMON="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "$ROOT/.git")"
LOCK="$COMMON/v2-test.lock"
KEEP_DIST=0
WAIT=900

while [[ $# -gt 0 ]]; do
  case "$1" in
    --keep-dist) KEEP_DIST=1; shift ;;
    --wait) WAIT="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [[ $# -eq 0 ]]; then
  echo "usage: scripts/v2-test-lane.sh [--keep-dist] [--wait <s>] -- <command…>" >&2
  exit 2
fi

waited=0
while ! (set -o noclobber; printf '%s\t%s\t%s\n' "$$" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >"$LOCK") 2>/dev/null; do
  holder_pid="$(cut -f1 "$LOCK" 2>/dev/null)"
  if [[ -n "$holder_pid" ]] && ! kill -0 "$holder_pid" 2>/dev/null; then
    echo "v2-test-lane: stale lock (pid $holder_pid gone) — taking it over" >&2
    rm -f "$LOCK"
    continue
  fi
  if [[ $waited -ge $WAIT ]]; then
    echo "v2-test-lane: lane busy — $(cat "$LOCK" 2>/dev/null)" >&2
    exit 75
  fi
  [[ $waited -eq 0 ]] && echo "v2-test-lane: waiting for the lane — $(cut -f3 "$LOCK" 2>/dev/null)" >&2
  sleep 5
  waited=$((waited + 5))
done
trap 'rm -f "$LOCK"' EXIT INT TERM

dist_status() { git -C "$ROOT" status --porcelain -- apps/studio/dist/ | sort; }
# Content fingerprint, so a run that rewrites an already-modified file is still noticed.
dist_print() { { dist_status; git -C "$ROOT" diff -- apps/studio/dist/; } | shasum | cut -d' ' -f1; }
before_status="$(dist_status)"
before_print="$(dist_print)"

"$@"
code=$?

if [[ "$(dist_print)" != "$before_print" ]]; then
  after_status="$(dist_status)"
  echo "v2-test-lane: the run changed apps/studio/dist/:" >&2
  printf '%s\n' "$after_status" | sed 's/^/  /' >&2
  if [[ -n "$before_status" ]]; then
    echo "v2-test-lane: dist/ was already dirty before the run — NOT reverting; check it by hand" >&2
  elif [[ $KEEP_DIST -eq 0 ]]; then
    tracked="$(printf '%s\n' "$after_status" | grep -v '^??' | sed -E 's/^.. //' || true)"
    if [[ -n "$tracked" ]]; then
      printf '%s\n' "$tracked" | (cd "$ROOT" && xargs git checkout --)
      echo "v2-test-lane: reverted $(printf '%s\n' "$tracked" | wc -l | tr -d ' ') tracked dist file(s)" >&2
    fi
    if printf '%s\n' "$after_status" | grep -q '^??'; then
      echo "v2-test-lane: new untracked dist files left in place (review them)" >&2
    fi
  fi
fi
exit $code
