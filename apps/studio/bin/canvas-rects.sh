#!/usr/bin/env bash
# canvas-rects.sh — the whiteboard AI toolkit's geometry manifest
# (feature-whiteboard-ai-toolkit). Emits `{ artboards, elements,
# elementsTruncated }` in WORLD coordinates for a canvas — the file
# `read-annotations --rects` and `annotate --in/--pin/--board` consume so
# neither verb ever hand-computes a coordinate. Reached via
# `maude design canvas-rects` (DDR-062), never a raw bin path.
#
# Usage:
#   canvas-rects.sh <rel-path> [--root <repo>] [--port N] [--timeout 8]
#                   [--engine auto|agent-browser|playwright]
#
# Two lanes:
#   - LIVE (preferred) — when a dev server is reachable (_server.json or
#     --port), navigates the canvas-shell URL and reads
#     `window.__maudeCanvasRects()` (canvas-lib.tsx) so element rects reflect
#     actual CSS/content. Engine: agent-browser (default, matches
#     screenshot.sh) or playwright (--engine playwright, or auto-fallback when
#     agent-browser isn't on PATH).
#   - STATIC fallback — no server reachable: artboard positions/sizes only
#     (meta.json + JSX width/height, DDR-027), `elements: []`. No browser
#     needed. A stderr note explains the degraded result.
#
# Unlike screenshot.sh this has no port-bounce retry (accepted v1 simplification
# — read-annotations/annotate don't have one either); a stale port just falls
# through to the static lane.
#
# Stdout: the manifest JSON (one line). Stderr: diagnostics/engine choice.
# Exit: 0 on success (either lane) / 2 on bad args.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT=""
PORT=""
TIMEOUT=8
ENGINE="auto"
REL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --root)    ROOT="$2"; shift 2 ;;
    --port)    PORT="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --engine)  ENGINE="$2"; shift 2 ;;
    --help|-h) sed -n '2,24p' "$0" | sed 's/^# \?//'; exit 0 ;;
    -*) echo "canvas-rects.sh: unknown arg '$1' (try --help)" >&2; exit 2 ;;
    *) REL="$1"; shift ;;
  esac
done

[ -n "$REL" ] || { echo "canvas-rects.sh: missing <rel-path>" >&2; exit 2; }

REPO="${ROOT:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
STATE="$REPO/.design/_server.json"

emit_static() {
  node "$SCRIPT_DIR/_canvas-rects-static.mjs" --rel "$REL" --root "$REPO"
}

# ---------- server detection ----------
if [ -z "$PORT" ] && [ -f "$STATE" ]; then
  if command -v jq >/dev/null 2>&1; then
    PORT=$(jq -r .port "$STATE" 2>/dev/null)
  else
    PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
  fi
fi

if [ -z "$PORT" ] || ! curl -fsS -o /dev/null -m 2 "http://localhost:$PORT/_health" 2>/dev/null; then
  echo "→ no live dev server reachable — static artboard-only fallback" >&2
  emit_static
  exit 0
fi

# ---------- designRel (for the canvas= query param) ----------
DESIGN_REL=".design"
CFG="$REPO/.design/config.json"
if [ -f "$CFG" ] && command -v jq >/dev/null 2>&1; then
  CAND=$(jq -r '.designRoot // empty' "$CFG" 2>/dev/null)
  [ -n "$CAND" ] && DESIGN_REL="$CAND"
fi

# Canvases mount through the canvas shell; the bare `/<rel>` route 404s when
# the canvas-origin sandbox is on (default since phase-9.1) — mirrors
# screenshot.sh's URL construction.
REL_ENC=$(printf '%s' "$DESIGN_REL/$REL" | sed 's/ /%20/g')
URL="http://localhost:${PORT}/_canvas-shell.html?canvas=${REL_ENC}"
. "$SCRIPT_DIR/_url-guard.sh" && maude_url_guard "$URL" || exit 2 # V2-8.9 B2 — http(s) to this Mac only

# ---------- engine resolution (mirrors screenshot.sh) ----------
AB="${MAUDE_AGENT_BROWSER:-agent-browser}"
# V2-8.9 M1: AI may › Search the web off (MAUDE_NO_EGRESS=1) → this browser reaches loopback only.
. "$(dirname "$0")/_no-egress.sh"
if [ "$ENGINE" = "auto" ]; then
  if command -v "$AB" >/dev/null 2>&1; then
    ENGINE="agent-browser"
  else
    ENGINE="playwright"
  fi
fi
echo "→ canvas-rects engine: $ENGINE | url: $URL" >&2

# ---------- agent-browser lane ----------
if [ "$ENGINE" = "agent-browser" ]; then
  if ! command -v "$AB" >/dev/null 2>&1; then
    echo "→ agent-browser not on PATH — static artboard-only fallback" >&2
    emit_static
    exit 0
  fi
  "$AB" open "$URL" >&2

  # Poll for the hook itself (more precise than screenshot.sh's generic
  # [data-dc-screen] mount check — this is exactly what we're about to call).
  poll=0
  ready=0
  while [ $poll -lt "$TIMEOUT" ]; do
    sleep 1
    poll=$((poll + 1))
    raw=$("$AB" eval "typeof window.__maudeCanvasRects" 2>/dev/null)
    case "$raw" in
      *function*) ready=1; break ;;
    esac
  done
  if [ $ready -eq 0 ]; then
    echo "→ hook never installed after ${TIMEOUT}s (non-canvas page?) — static artboard-only fallback" >&2
    emit_static
    exit 0
  fi

  RAW_JSON=$("$AB" eval "JSON.stringify(window.__maudeCanvasRects())" 2>/dev/null)
  if [ -z "$RAW_JSON" ]; then
    echo "→ eval returned nothing — static artboard-only fallback" >&2
    emit_static
    exit 0
  fi
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$RAW_JSON" | jq -r .
  else
    # No jq — agent-browser's output is a JSON-encoded STRING (quoted,
    # escaped); node unwraps it the same way `jq -r .` would.
    printf '%s' "$RAW_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s)+'\n'))"
  fi
  exit 0
fi

# ---------- playwright lane ----------
if [ "$ENGINE" = "playwright" ]; then
  if ! node "$SCRIPT_DIR/_canvas-rects-playwright.mjs" --url "$URL" --timeout "$TIMEOUT"; then
    echo "→ playwright capture failed — static artboard-only fallback" >&2
    emit_static
  fi
  exit 0
fi

echo "canvas-rects.sh: unknown --engine '$ENGINE'" >&2
exit 2
