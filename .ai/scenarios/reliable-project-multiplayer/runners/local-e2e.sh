#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
exec node "$root/scripts/dev/sync-e2e/surface-run.mjs" "$@"
