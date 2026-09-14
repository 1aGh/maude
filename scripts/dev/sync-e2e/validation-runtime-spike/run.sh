#!/bin/sh
set -eu
spike_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_bin=${MAUDE_NODE:-node}
workerd_node=${MAUDE_WORKERD_NODE:-$node_bin}
MAUDE_SPIKE_EVIDENCE_DIR=${MAUDE_SPIKE_EVIDENCE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/maude-validation-proof.XXXXXX")}
export MAUDE_SPIKE_EVIDENCE_DIR
printf 'Evidence: %s\n' "$MAUDE_SPIKE_EVIDENCE_DIR"
bun "$spike_dir/build.mjs"
"$node_bin" "$spike_dir/runtime-probe.mjs"
bun "$spike_dir/runtime-probe.mjs"
"$workerd_node" "$spike_dir/worker-probe.mjs"
"$node_bin" --test "$spike_dir/service.test.mjs"
