#!/usr/bin/env bash
# visual-sanity.sh — mandatory post-scaffold visual sanity gate for
# `/design:setup-ds`. Boots the dev-server (via server-up.sh), screenshots
# N specimens (via screenshot.sh) into `_history/_system/<ds>-visual-sanity-
# <ISO>/`, and exits non-zero on any failure so the caller can surface an
# `AskUserQuestion` ("dev-server boot failed: <reason> — skip visual sanity
# or fix and retry?"). Never silently elides the gate.
#
# Closes D-3 + D-4 in the imprint-bootstrap retro (sparkle overflow + broken
# relative-URL asset path — both would have been caught by one screenshot read).
# Spec: `.ai/plans/phase-3.7-setup-ds-hardening-and-motion-subsystem.md` Task 2.
#
# Usage:
#   visual-sanity.sh --ds <ds-name>
#                    [--specimens "colors-accent,motion,logo"]
#                    [--root <repo>] [--out-dir <dir>]
#                    [--boot-timeout 15] [--shot-timeout 5]
#                    [--engine auto|agent-browser|playwright]
#
# Defaults:
#   --root         "$CLAUDE_PROJECT_DIR" → "$(git rev-parse --show-toplevel)" → cwd
#   --specimens    "colors-accent,motion,ui_kits-desktop-showcase"
#                  (signature trio — accent / motion / DS-in-use)
#                  caller may override with the roster-derived list of actually-
#                  written specimens to avoid screenshotting files that don't
#                  exist on the disk yet.
#   --out-dir      "<root>/.design/_history/_system/<ds>-visual-sanity-<ISO>"
#   --boot-timeout 15 (server-up.sh polling window, in seconds)
#   --shot-timeout 5  (screenshot.sh DC-mount poll window per specimen; bare
#                      DS-preview specimens have no [data-dc-screen] so the
#                      poll always exhausts — 5s is plenty for the page-load
#                      settle without burning 15s × N on every gate run)
#
# Output: one PNG path per line on stdout (composable in for-loops); the caller
#         is expected to `Read` each PNG into context so the agent ACTUALLY SEES
#         what shipped. JSON manifest written alongside as `_manifest.json`.
# Stderr: diagnostic, engine choice, timing, failure reasons.
# Exit:
#   0  success — all specimens screenshot successfully
#   1  dev-server boot failed   (caller MUST surface AskUserQuestion)
#   2  bad args
#   3  one or more specimen screenshots failed
#   4  no specimens existed on disk (DS not scaffolded? typo?)
#   5  dev-server runtime deps missing (yjs/y-protocols/lib0) — recovery is
#      `bun install`, NOT skip-or-retry; distinct from a generic boot failure
#      so the caller routes to the right hint (server-up.sh exit 3). DDR-083.

DS=""
SPECIMENS=""
ROOT=""
OUT_DIR=""
BOOT_TIMEOUT=15
SHOT_TIMEOUT=5
ENGINE="auto"

while [ $# -gt 0 ]; do
  case "$1" in
    --ds)           DS="$2"; shift 2 ;;
    --specimens)    SPECIMENS="$2"; shift 2 ;;
    --root)         ROOT="$2"; shift 2 ;;
    --out-dir)      OUT_DIR="$2"; shift 2 ;;
    --boot-timeout) BOOT_TIMEOUT="$2"; shift 2 ;;
    --shot-timeout) SHOT_TIMEOUT="$2"; shift 2 ;;
    --timeout)      BOOT_TIMEOUT="$2"; SHOT_TIMEOUT="$2"; shift 2 ;;  # legacy
    --engine)       ENGINE="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,33p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "visual-sanity.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

if [ -z "$DS" ]; then
  echo "visual-sanity.sh: --ds <ds-name> required" >&2
  exit 2
fi

# Resolve repo root.
if [ -z "$ROOT" ]; then
  ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
if [ ! -d "$ROOT" ]; then
  echo "visual-sanity.sh: --root '$ROOT' is not a directory" >&2
  exit 2
fi
ROOT_ABS=$(cd "$ROOT" && pwd)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

DESIGN_ROOT="$ROOT_ABS/.design"
DS_PREVIEW="$DESIGN_ROOT/system/$DS/preview"
if [ ! -d "$DS_PREVIEW" ]; then
  echo "visual-sanity.sh: preview directory not found at $DS_PREVIEW" >&2
  echo "  (is the DS scaffolded? did you mean a different --ds value?)" >&2
  exit 4
fi

# Default specimen list: the signature trio (accent, motion, DS-in-use).
# Caller can pass a roster-derived list to override.
if [ -z "$SPECIMENS" ]; then
  SPECIMENS="colors-accent,motion,ui_kits-desktop-showcase"
fi

# Filter specimens to those that actually exist on disk — the trio is a
# default that not every DS will have written (e.g. an early scaffold may
# not have ui_kits-* yet). Silently skipping a non-existent specimen is OK;
# the caller logs which ones we attempted vs. captured.
declare -a EXISTING=()
declare -a MISSING=()
IFS=',' read -r -a SPEC_ARR <<< "$SPECIMENS"
for s in "${SPEC_ARR[@]}"; do
  s_trim=$(echo "$s" | tr -d '[:space:]')
  [ -z "$s_trim" ] && continue
  if [ -f "$DS_PREVIEW/${s_trim}.tsx" ]; then
    EXISTING+=("$s_trim")
  else
    MISSING+=("$s_trim")
  fi
done
if [ ${#EXISTING[@]} -eq 0 ]; then
  echo "visual-sanity.sh: none of the requested specimens exist on disk under $DS_PREVIEW" >&2
  printf '  missing: %s\n' "${MISSING[@]}" >&2
  exit 4
fi
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "visual-sanity.sh: skipping ${#MISSING[@]} non-existent specimen(s): ${MISSING[*]}" >&2
fi

# ISO-like timestamp safe for filenames (no colons / spaces).
TS=$(date -u +"%Y%m%dT%H%M%SZ")

if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$DESIGN_ROOT/_history/_system/${DS}-visual-sanity-${TS}"
fi
mkdir -p "$OUT_DIR"

# Step 1 — boot the dev-server. Failure here is fatal: the caller MUST surface
# AskUserQuestion ("dev-server boot failed: <reason>; skip visual sanity or
# fix and retry?") rather than silently skipping the gate.
echo "→ booting dev-server (timeout ${BOOT_TIMEOUT}s)" >&2
PORT=$(bash "$SCRIPT_DIR/server-up.sh" --root "$ROOT_ABS" --timeout "$BOOT_TIMEOUT")
SERVER_RC=$?
if [ $SERVER_RC -ne 0 ] || [ -z "$PORT" ]; then
  # server-up.sh exit 3 = the dev-server's runtime deps aren't installed. That's
  # a distinct failure from a generic boot crash/timeout: the fix is `bun install`,
  # not "skip or retry". Surface a dedicated status + exit code (5) so the caller
  # routes to the right remediation instead of the boot-failed AskUserQuestion.
  # The actionable hint already went to stderr from server-up.sh. DDR-083.
  if [ $SERVER_RC -eq 3 ]; then
    echo "✗ dev-server runtime deps missing — run \`bun install\` in the dev-server dir (see hint above)" >&2
    VS_STATUS="server-deps-missing"
    VS_EXIT=5
  else
    echo "✗ dev-server boot failed (server-up.sh exit $SERVER_RC); see $DESIGN_ROOT/_server.log" >&2
    VS_STATUS="server-boot-failed"
    VS_EXIT=1
  fi
  cat > "$OUT_DIR/_manifest.json" <<EOF
{
  "ds": "$DS",
  "ts": "$TS",
  "status": "$VS_STATUS",
  "server_up_rc": $SERVER_RC,
  "specimens_requested": $(printf '%s\n' "${SPEC_ARR[@]}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | sed '/^$/d' | sed 's/.*/"&"/' | paste -sd, -),
  "specimens_captured": []
}
EOF
  exit $VS_EXIT
fi
echo "✓ dev-server on port $PORT" >&2

# Step 2 — screenshot each existing specimen. Track captures vs failures.
declare -a CAPTURED=()
declare -a FAILED=()
for s in "${EXISTING[@]}"; do
  REL="system/$DS/preview/${s}.tsx"
  REL_ENC=$(printf '%s' "$REL" | sed 's/ /%20/g')
  URL="http://localhost:${PORT}/_canvas-shell.html?canvas=${REL_ENC}"
  . "$SCRIPT_DIR/_url-guard.sh" && maude_url_guard "$URL" || exit 2 # V2-8.9 B2 — http(s) to this Mac only
  OUT_PNG="$OUT_DIR/${s}.png"
  echo "→ screenshot: $s" >&2
  if bash "$SCRIPT_DIR/screenshot.sh" \
        --url "$URL" \
        --full \
        --out "$OUT_PNG" \
        --engine "$ENGINE" \
        --timeout "$SHOT_TIMEOUT" >&2; then
    echo "$OUT_PNG"
    CAPTURED+=("$s")
  else
    echo "✗ screenshot failed: $s" >&2
    FAILED+=("$s")
  fi
done

# Step 3 — write manifest. Caller can parse this to know what was captured
# without re-listing the directory.
json_arr() {
  # Print a JSON array literal from positional args. Empty → "[]".
  if [ $# -eq 0 ]; then printf '[]'; return; fi
  printf '['
  i=0
  for a in "$@"; do
    if [ $i -gt 0 ]; then printf ', '; fi
    printf '"%s"' "$a"
    i=$((i + 1))
  done
  printf ']'
}

STATUS="ok"
[ ${#FAILED[@]} -gt 0 ] && STATUS="partial-failure"

{
  printf '{\n'
  printf '  "ds": "%s",\n' "$DS"
  printf '  "ts": "%s",\n' "$TS"
  printf '  "status": "%s",\n' "$STATUS"
  printf '  "port": %s,\n' "$PORT"
  printf '  "out_dir": "%s",\n' "$OUT_DIR"
  printf '  "specimens_requested": %s,\n' "$(json_arr "${SPEC_ARR[@]}")"
  printf '  "specimens_captured":  %s,\n' "$(json_arr "${CAPTURED[@]}")"
  printf '  "specimens_missing":   %s,\n' "$(json_arr "${MISSING[@]}")"
  printf '  "specimens_failed":    %s\n' "$(json_arr "${FAILED[@]}")"
  printf '}\n'
} > "$OUT_DIR/_manifest.json"

echo "→ manifest: $OUT_DIR/_manifest.json" >&2

if [ ${#FAILED[@]} -gt 0 ]; then
  echo "✗ ${#FAILED[@]}/${#EXISTING[@]} specimen(s) failed to capture: ${FAILED[*]}" >&2
  exit 3
fi
exit 0
