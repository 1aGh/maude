#!/bin/bash
# D5 setup: run from the repo root. Copies the flattened harness into ./.scr (REPO = ./ , see scr/lib.mjs).
set -e
H="$(cd "$(dirname "$0")" && pwd)"
mkdir -p .scr/fx5
cp -R "$H/scr/." .scr/
ln -sfn ../fx5-canvases .scr/fx5/canvases
