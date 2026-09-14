#!/bin/sh
set -eu
spike_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_bin=${MAUDE_NODE:-node}
export MAUDE_SPIKE_EVIDENCE_DIR=${MAUDE_SPIKE_EVIDENCE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/maude-storage-conformance.XXXXXX")}
bun --no-env-file "$spike_dir/build.mjs"
"$node_bin" --test "$spike_dir/conformance.test.mjs"
