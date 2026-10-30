#!/usr/bin/env bash
# transcribe-local.sh — S7.2 (V2-1.10 §5.6–§5.7). Local words + speech regions for ONE project asset,
# written to assets/<name>.transcript.json through the strict sidecar writer. Reached via
# `maude design transcribe-local` (never a raw bin path — DDR-062). No dev server needed.
#
# Usage:
#   transcribe-local.sh <assets/x.ext> [--lang xx] [--model <installed id>] [--speech-only] [--json]
#                       [--root <repo>]
#
# Local whisper.cpp only, and it never downloads a model; there is deliberately no --provider (a flag
# must never escalate a tier — V2-1.11 §5.3): `maude design transcribe --provider` is the cloud path.
# --speech-only needs no engine (speech regions from energy, labelled "energy").
#
# Stdout (last line): the sidecar path, design-root relative; with --json, one JSON object.
# Exit: 0 ok · 1 input/dependency problem · 2 usage · 3 No speech engine on this Mac (Settings path
# printed) · 4 decoding or transcription failed.

set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "transcribe-local.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  echo "  Install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bun run "$SCRIPT_DIR/_transcribe-local.mjs" "$@"
