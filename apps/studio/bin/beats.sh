#!/usr/bin/env bash
# beats.sh — thin shim over beats.mjs; reached via `maude design beats` (DDR-062), never a raw bin path.
# Detects the beats of one music asset (ffmpeg decode, headless-Chromium WebAudio when ffmpeg is missing →
# in-house spectral-flux / autocorrelation / dynamic-programming tracker) and writes the versioned sidecar
# assets/<base>.beats.json. `--bpm N` fixes the tempo and keeps the bar phase; `--dry-run` writes nothing.
#
# Usage:
#   beats.sh <assets/<base>.<ext>> [--bpm N] [--dry-run] [--json] [--root <repo>] [--design-root .design]
#            [--decode auto|ffmpeg|chromium]
#
# Exit: 0 ok · 2 usage · 3 no decoder (no ffmpeg, no Chromium) · 4 asset missing / undecodable · 1 other.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "$1" in
  --help|-h) sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

# beats.mjs imports TypeScript modules, so it needs bun (a hard dependency; the bundled app supplies it).
if ! command -v bun >/dev/null 2>&1; then
  echo "beats.sh: bun is required (hard dependency — see plugins/design/dependencies.json)." >&2
  echo "  Install: curl -fsSL https://bun.sh/install | bash" >&2
  exit 1
fi
exec bun run "$SCRIPT_DIR/beats.mjs" "$@"
