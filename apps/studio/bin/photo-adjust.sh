#!/usr/bin/env bash
# photo-adjust.sh — feature-photo-editor (Stage G, Task 19). Headless PARAMETRIC
# photo edit: assemble a PhotoEdit from flags and PUT it to the running dev
# server's /_api/photo-edit route so an agent (or a human) can tune a photo
# without opening a browser or clicking a slider.
#
# Deliberately the THIN, NON-BROWSER sibling of photo-bg-remove.sh. Background
# removal needs a browser round-trip because @imgly runs the ML model client-
# side; parametric edits are pure JSON, so a direct curl to the already-validated
# route (the photo-store cap stack — validatePhotoEdit + sha8 + containment +
# size cap — is the gate) is the whole job. DO NOT "fix" this asymmetry by making
# this verb heavier: there is no inference step here, so a harness canvas +
# agent-browser would be pure overhead.
#
# Reached via `maude design photo-adjust` (never a raw bin path — DDR-062).
#
# Usage:
#   photo-adjust.sh --asset <assets/<sha8>.<ext> | <sha8>> [--root <repo>]
#     [--brightness N] [--contrast N] [--saturation N] [--exposure N]
#     [--hue N] [--sepia N] [--grayscale N] [--invert N]
#     [--duotone "#aabbcc,#ddeeff[,intensity]"]
#     [--grain "amount[,size]"]
#     [--pattern "type[,scale,opacity,blend]"]
#     [--mask "preset[,strength]"]
#     [--replace]   (overwrite the sidecar instead of merging onto it)
#     [--reset]     (clear the sidecar to neutral / unedited)
#
# Adjustment ranges (normalized, 0 = neutral): brightness/contrast/saturation/
# exposure ∈ −1..1, hue ∈ −180..180 (deg), sepia/grayscale/invert ∈ 0..1.
# Merges onto the existing sidecar by default (successive calls accumulate).
#
# Requires a running dev server (caller runs `maude design server-up` first);
# reads the port from <designRoot>/_server.json.
#
# Stdout (last line): the sidecar path `assets/<sha8>.photo.json` (for $(...)).
# Stderr: progress / diagnostics.
# Exit:   0 ok / 1 server or asset problem / 2 bad args / 3 server rejected edit.

set -euo pipefail

ASSET="" REPO="" REPLACE=0 RESET=0
BRIGHTNESS="" CONTRAST="" SATURATION="" EXPOSURE="" HUE="" SEPIA="" GRAYSCALE="" INVERT=""
DUOTONE="" GRAIN="" PATTERN="" MASK=""

while [ $# -gt 0 ]; do
  case "$1" in
    --asset)      ASSET="$2"; shift 2 ;;
    --root)       REPO="$2"; shift 2 ;;
    --brightness) BRIGHTNESS="$2"; shift 2 ;;
    --contrast)   CONTRAST="$2"; shift 2 ;;
    --saturation) SATURATION="$2"; shift 2 ;;
    --exposure)   EXPOSURE="$2"; shift 2 ;;
    --hue)        HUE="$2"; shift 2 ;;
    --sepia)      SEPIA="$2"; shift 2 ;;
    --grayscale)  GRAYSCALE="$2"; shift 2 ;;
    --invert)     INVERT="$2"; shift 2 ;;
    --duotone)    DUOTONE="$2"; shift 2 ;;
    --grain)      GRAIN="$2"; shift 2 ;;
    --pattern)    PATTERN="$2"; shift 2 ;;
    --mask)       MASK="$2"; shift 2 ;;
    --replace)    REPLACE=1; shift ;;
    --reset)      RESET=1; shift ;;
    --help|-h)    sed -n '2,39p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "photo-adjust.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

[ -n "$ASSET" ] || { echo "photo-adjust.sh: --asset is required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "photo-adjust.sh: jq is required" >&2; exit 1; }

if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
DESIGN_ROOT="$REPO/.design"
[ -d "$DESIGN_ROOT" ] || { echo "photo-adjust.sh: no .design/ under $REPO" >&2; exit 1; }

STATE="$DESIGN_ROOT/_server.json"
[ -f "$STATE" ] || { echo "photo-adjust.sh: no _server.json (start the dev server first)" >&2; exit 1; }
PORT=$(jq -r '.port // empty' "$STATE" 2>/dev/null)
[ -n "$PORT" ] || { echo "photo-adjust.sh: could not read port from $STATE" >&2; exit 1; }
# sec-loopback-bearer §7.6 — every call carries the studio's API key (studio_curl: curl's stdin config)
. "$(dirname "$0")/_desktop-locate.sh"
studio_key "$REPO" "$PORT" || { echo "photo-adjust.sh: Maude has this project open, but its server did not answer the check" >&2; exit 1; }

BASE_URL="http://127.0.0.1:$PORT/_api/photo-edit"
# URL-encode the asset param minimally (slashes are safe as a query value here).
ENC_ASSET=$(printf '%s' "$ASSET" | jq -sRr @uri)
URL="$BASE_URL?asset=$ENC_ASSET"

# --reset short-circuits: write a neutral sidecar.
if [ "$RESET" -eq 1 ]; then
  RESP=$(studio_curl "$REPO" "$PORT" -s -X PUT -H 'Content-Type: application/json' -d '{}' "$URL")
  OK=$(printf '%s' "$RESP" | jq -r '.ok // false' 2>/dev/null || echo false)
  [ "$OK" = "true" ] || { echo "photo-adjust.sh: reset rejected: $RESP" >&2; exit 3; }
  printf '%s\n' "$(printf '%s' "$RESP" | jq -r '.path')"
  exit 0
fi

# Assemble the patch from set flags (unset flags are omitted entirely).
PATCH=$(jq -n \
  --arg brightness "$BRIGHTNESS" --arg contrast "$CONTRAST" --arg saturation "$SATURATION" \
  --arg exposure "$EXPOSURE" --arg hue "$HUE" --arg sepia "$SEPIA" \
  --arg grayscale "$GRAYSCALE" --arg invert "$INVERT" \
  --arg duotone "$DUOTONE" --arg grain "$GRAIN" --arg pattern "$PATTERN" --arg mask "$MASK" '
  def n($s): if $s == "" then null else ($s | tonumber) end;
  def adj:
    { brightness: n($brightness), contrast: n($contrast), saturation: n($saturation),
      exposure: n($exposure), hue: n($hue), sepia: n($sepia),
      grayscale: n($grayscale), invert: n($invert) }
    | with_entries(select(.value != null));
  def duo:
    if $duotone == "" then null
    else ($duotone | split(",")) as $p
      | { enabled: true, colorA: $p[0], colorB: $p[1] }
        + (if ($p | length) > 2 then { intensity: ($p[2] | tonumber) } else {} end)
    end;
  def gr:
    if $grain == "" then null
    else ($grain | split(",")) as $p
      | { enabled: true, amount: ($p[0] | tonumber) }
        + (if ($p | length) > 1 then { size: ($p[1] | tonumber) } else {} end)
    end;
  def pat:
    if $pattern == "" then null
    else ($pattern | split(",")) as $p
      | { enabled: true, type: $p[0] }
        + (if ($p | length) > 1 then { scale: ($p[1] | tonumber) } else {} end)
        + (if ($p | length) > 2 then { opacity: ($p[2] | tonumber) } else {} end)
        + (if ($p | length) > 3 then { blend: $p[3] } else {} end)
    end;
  def msk:
    if $mask == "" then null
    else ($mask | split(",")) as $p
      | { preset: $p[0] }
        + (if ($p | length) > 1 then { strength: ($p[1] | tonumber) } else {} end)
    end;
  ({}
    + (adj as $a | if ($a | length) > 0 then { adjustments: $a } else {} end)
    + (duo as $d | if $d then { duotone: $d } else {} end)
    + (gr  as $g | if $g then { grain: $g } else {} end)
    + (pat as $p | if $p then { pattern: $p } else {} end)
    + (msk as $m | if $m then { mask: $m } else {} end))
')

if [ "$(printf '%s' "$PATCH" | jq -r 'keys | length')" = "0" ]; then
  echo "photo-adjust.sh: no edit flags given (nothing to do)" >&2
  exit 2
fi

if [ "$REPLACE" -eq 1 ]; then
  BODY="$PATCH"
else
  # Merge onto the current sidecar (deep object merge via jq's `*`), dropping the
  # server-stamped `version` (it's re-stamped on write).
  BASE=$(studio_curl "$REPO" "$PORT" -s "$URL" 2>/dev/null || echo '{}')
  printf '%s' "$BASE" | jq -e . >/dev/null 2>&1 || BASE='{}'
  BODY=$(jq -n --argjson base "$BASE" --argjson patch "$PATCH" '($base | del(.version)) * $patch')
fi

RESP=$(studio_curl "$REPO" "$PORT" -s -X PUT -H 'Content-Type: application/json' -d "$BODY" "$URL")
OK=$(printf '%s' "$RESP" | jq -r '.ok // false' 2>/dev/null || echo false)
if [ "$OK" != "true" ]; then
  echo "photo-adjust.sh: server rejected the edit: $RESP" >&2
  exit 3
fi
printf '%s\n' "$(printf '%s' "$RESP" | jq -r '.path')"
