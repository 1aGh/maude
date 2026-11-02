#!/bin/bash
# usage: r6.sh <scenario-stem> [themes]   — 06 harness (g2 layers), frames land in ../impl-out/<dir>
cd "$(dirname "$0")" || exit 1
export SHOTS_OUT="$(cd .. && pwd)/impl-out"
node run.mjs "$1.mjs" "${2:-dark,light}" 2>&1 | grep -v "^ \|Call log\|WARNING\|^$\|^skip" | cut -c1-500
