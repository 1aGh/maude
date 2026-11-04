#!/usr/bin/env bash
# One side of a before/after for scripts/bench-first-sync-mem.mjs (issue #204).
#
#   scripts/bench-first-sync-mem-ab.sh <name> <rev|HEAD> -- <bench args…>
#
# <rev> other than HEAD: `git archive`s that rev's apps/studio (and what it imports from outside it)
# into /tmp/m204-<name>/tree, links this checkout's apps/studio/node_modules in, and boots the
# measured server from there (--studio). The seed studio and the hub stay this checkout's, so only
# the server under test differs. Results land in .m204/<name>/ (result.json, the probe's ndjson
# and its heap-snapshot summary) — fetch that folder from a remote-lane run:
#
#   scripts/remote-lane.sh --slot auto --fetch .m204/old -- \
#     scripts/bench-first-sync-mem-ab.sh old 9f47e7197 -- --canvases 161 --files 6000 --media 1500 …
set -euo pipefail
name=$1
rev=$2
shift 2
[ "${1:-}" = "--" ] && shift
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/.m204/$name"
rm -rf "$out"
mkdir -p "$out"
studio=()
if [ "$rev" != "HEAD" ]; then
  tree="/tmp/m204-$name/tree"
  rm -rf "/tmp/m204-$name"
  mkdir -p "$tree"
  git -C "$root" archive "$rev" apps/studio apps/hub/src cli scripts/lib plugins/design/templates package.json |
    tar -x -C "$tree"
  ln -s "$root/apps/studio/node_modules" "$tree/apps/studio/node_modules"
  studio=(--studio "$tree/apps/studio")
fi
MAUDE_PROBE_OUT="$out/probe.ndjson" MAUDE_PROBE_INTERVAL_MS=5000 \
  node "$root/scripts/bench-first-sync-mem.mjs" --out "/tmp/m204-$name/run" \
  --preload "$root/scripts/lib/mem-probe.ts" "${studio[@]}" "$@" | tee "$out/bench.out" || true
cp "/tmp/m204-$name/run/result.json" "$out/" 2>/dev/null || true
cp "/tmp/m204-$name/run/studio.log" "$out/" 2>/dev/null || true
