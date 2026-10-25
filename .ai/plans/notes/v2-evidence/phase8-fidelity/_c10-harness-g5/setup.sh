#!/bin/bash
# D6 setup: run from the repo root. Copies the flattened harness into ./.scr (REPO = ./ , see scr/lib.mjs).
# $1 = 14 additionally lays the round-8 Editing overlay (scr14/: Alligators fixture with assets, s14h/i/j) over it.
set -e
H="$(cd "$(dirname "$0")" && pwd)"
mkdir -p .scr/fx5
cp -R "$H/scr/." .scr/
if [ "$1" = 14 ]; then cp -R "$H/scr14/." .scr/; rm -f .scr/chain-c8e.sh; fi
ln -sfn ../fx5-canvases .scr/fx5/canvases
