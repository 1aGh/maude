#!/bin/sh
set -eu
spike_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_bin=${MAUDE_NODE:-node}
export MAUDE_SPIKE_EVIDENCE_DIR=${MAUDE_SPIKE_EVIDENCE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/maude-warm-validator.XXXXXX")}
"$node_bin" "$spike_dir/evidence.mjs"
"$node_bin" --test "$spike_dir/pool.test.mjs"
"$node_bin" "$spike_dir/benchmark.mjs"
