#!/bin/sh
set -eu
spike_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
MAUDE_SPIKE_EVIDENCE_DIR=${MAUDE_SPIKE_EVIDENCE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/maude-browser-proof.XXXXXX")}
export MAUDE_SPIKE_EVIDENCE_DIR
printf 'Evidence: %s\n' "$MAUDE_SPIKE_EVIDENCE_DIR"
bun "$spike_dir/build.mjs"
node_bin=${MAUDE_NODE:-node}
"$node_bin" --test "$spike_dir/browser-candidate.test.mjs"
