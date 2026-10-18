#!/usr/bin/env bash
# import-brand.sh — brand-file typed-cue extraction (DDR-173). Thin shim over
# _import-brand.mjs; reached via `maude design import-brand` (DDR-062), never
# a raw bin path. Operates ONLY on an already-DDR-167-sanitized SVG asset
# (as produced by `maude design import-asset`) — never re-reads or
# re-sanitizes the original brand file (DDR-173 Decision 2: no parallel,
# ungated read path). Requires bun — _import-brand.mjs imports
# _import-tokens.mjs's `.mjs` grammar reuse and happy-dom directly.
#
# Usage:
#   import-brand.sh <sanitized-svg-path> --root <repo> [--design-root .design] [--json]
#   import-brand.sh [<sanitized-svg-path>] --url <website> --root <repo>   (S8.18)
#
# stdout on success = the typed payload `{ palette, fonts, logoRef, logoRasterRef }`
# (+ `site` and `colours` with --url: typed colours/fonts only, through the fetch-asset gate).
#
# Exit: 0 ok · 1 other · 2 usage · 3 validation/hardening reject ·
#       4 read/parse error · 5 the website could not be read · 6 write/containment error.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "$1" in
  --help|-h) sed -n '2,18p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

if ! command -v bun >/dev/null 2>&1; then
  echo "import-brand.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  echo "  Install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi

exec bun run "$SCRIPT_DIR/_import-brand.mjs" "$@"
