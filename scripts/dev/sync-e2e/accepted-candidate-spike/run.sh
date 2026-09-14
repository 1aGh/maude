#!/bin/sh
set -eu
spike_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node24_bin=${MAUDE_NODE24:-node}
if [ "$("$node24_bin" -p 'process.versions.node.split(".")[0]')" != 24 ]; then
  echo 'Set MAUDE_NODE24 to a Node 24 executable. This spike does not rebuild dependencies.' >&2
  exit 1
fi
"$node24_bin" --test "$spike_dir/project-transactions.test.mjs"
"$node24_bin" "$spike_dir/evidence.mjs"
