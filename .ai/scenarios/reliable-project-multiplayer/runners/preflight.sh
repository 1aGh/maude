#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
exec node "$ROOT/scripts/dev/sync-e2e/surface-preflight.mjs" "$@"
