#!/usr/bin/env bash
# perf.sh — render-performance benchmark for a canvas (`maude design perf`).
#
# Drives a scripted pan + zoom against a live canvas and reports frame-time
# percentiles, long-task count and the React render count during the gesture,
# with a DELTA against the previous run of the same (canvas, engine) pair. The
# history file makes "before and after" a property of the tool rather than
# something the operator has to remember to write down.
#
# Deliberately NOT a CI gate. Headless frame timings swing with GPU load and
# machine state, so an absolute threshold would go red for reasons unrelated to
# the code and train everyone to ignore it. The gate is the delta, read by a
# human, on one machine. (Plan: .ai/plans/feature-canvas-render-performance.md)
#
# Usage:
#   perf.sh [--root <repo>] [--canvas <rel-path>] [--fixture]
#           [--boards N] [--strokes N | --annotations N] [--mix]
#           [--pan N] [--zoom N] [--timeout S] [--repeat N]
#           [--engine chromium|safari]
#           [--history <path>] [--json]
#
#   --engine safari measures WebKit through safaridriver (one-time
#   `safaridriver --enable`, needs admin auth). Use it for anything the Tauri
#   desktop shell has to be fast at: the desktop is WKWebView, and Chromium does
#   NOT reproduce WebKit's compositing / re-raster behaviour — a canvas can sit
#   at a warm 60fps in headless Chromium while being unusable in the .app.
#
#   --canvas   Canvas to measure, relative to <designRoot> (default: _active.json).
#   --fixture  Generate + measure the synthetic fixture instead (--boards/--strokes).
#   --annotations N  Alias of --strokes: annotation element count (<= 5000).
#   --mix      With --fixture: a MIXED legacy-v1 board (sections incl. nested,
#              stickies, rect/ellipse/polygon with anchored labels, bound arrows,
#              text, pen, groups) beside the artboards, instead of the
#              sticky-only field. Serialized via strokesToSvg (needs bun). Warns
#              when the v2 board exceeds the 4 MB cap (DDR-242; the v1 1 MB cap bit at ~3750 mixed elements).
#   --json     Raw JSON (current + previous run) instead of the human report.
#
# Reads:  $DESIGN_ROOT/_server.json  (must exist — run `maude design server-up` first)
# Writes: $DESIGN_ROOT/_smoke/perf/history.jsonl   (append-only, per-machine runtime state)
#         $DESIGN_ROOT/ui/perf-fixture.tsx         (only with --fixture)
#
# Exit: 0 measured / 1 missing dep or capture failure / 2 bad args.

REPO=""
CANVAS=""
FIXTURE=0
BOARDS=128
STROKES=150
MIX=0
PAN=60
ZOOM=40
REPEAT=3
PROBE_ENGINE="chromium"
FIT_ALL=0
STUDIO=0
TIMEOUT=30
HISTORY=""
JSON=0

while [ $# -gt 0 ]; do
  case "$1" in
    --root)     REPO="$2"; shift 2 ;;
    --canvas)   CANVAS="$2"; shift 2 ;;
    --fixture)  FIXTURE=1; shift ;;
    --boards)   BOARDS="$2"; shift 2 ;;
    --strokes|--annotations) STROKES="$2"; shift 2 ;;
    --mix)      MIX=1; shift ;;
    --pan)      PAN="$2"; shift 2 ;;
    --zoom)     ZOOM="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    --repeat)   REPEAT="$2"; shift 2 ;;
    --engine)   PROBE_ENGINE="$2"; shift 2 ;;
    --fit-all)  FIT_ALL=1; shift ;;
    --studio)   STUDIO=1; shift ;;
    --history)  HISTORY="$2"; shift 2 ;;
    --json)     JSON=1; shift ;;
    --help|-h)
      sed -n '2,42p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "perf.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# JS runtime. The packaged desktop app ships no user `node` (DDR-177) but always
# has a `bun` on PATH (real, or the compiled-sidecar shim `maude` stages), so
# prefer bun and keep node as the developer-machine fallback.
if command -v bun >/dev/null 2>&1; then JS_RUNTIME="bun"; else JS_RUNTIME="node"; fi

# ---------- resolve repo + design root (mirrors smoke.sh) ----------
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
DESIGN_ROOT="$REPO/.design"
[ -d "$DESIGN_ROOT" ] || { echo "perf.sh: no .design/ under $REPO" >&2; exit 1; }

STATE="$DESIGN_ROOT/_server.json"
[ -f "$STATE" ] || { echo "perf.sh: $STATE missing — run 'maude design server-up' first" >&2; exit 1; }

if command -v jq >/dev/null 2>&1; then
  PORT=$(jq -r .port "$STATE" 2>/dev/null)
else
  PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
fi
[ -n "$PORT" ] || { echo "perf.sh: no port in $STATE" >&2; exit 1; }

# ---------- fixture generation ----------
if [ "$FIXTURE" = "1" ]; then
  # Counts are validated as plain integers and paths travel via argv, never
  # interpolated into the script body: `--boards "1); <js>; ("` or a design root
  # containing a quote would otherwise execute inside this node process, which
  # runs with the user's full privileges. `maude design perf` is reachable from
  # an agent session, so its arguments are not automatically trustworthy.
  case "$BOARDS" in ''|*[!0-9]*) echo "perf.sh: --boards must be a positive integer" >&2; exit 2 ;; esac
  case "$STROKES" in ''|*[!0-9]*) echo "perf.sh: --strokes must be a non-negative integer" >&2; exit 2 ;; esac
  # Upper bound too: the guards above accept any magnitude, and `--boards 99999999`
  # is a cheap way to make an auto-approved verb fill a disk.
  [ "$BOARDS" -le 2000 ] || { echo "perf.sh: --boards must be <= 2000" >&2; exit 2; }
  [ "$STROKES" -le 5000 ] || { echo "perf.sh: --strokes must be <= 5000" >&2; exit 2; }
  "$JS_RUNTIME" -e '
    const [modPath, designRoot, boards, strokes, mix] = process.argv.slice(1);
    import(modPath).then(async (m) => {
      const r = await m.writePerfCanvas({
        designRoot,
        boards: Number(boards),
        strokes: Number(strokes),
        mix: mix === "1",
      });
      console.error("→ fixture written: " + r.canvasPath);
      if (r.annotationsPath) {
        console.error("→ annotations: " + r.annotationsPath + " (" + r.annotationsBytes + " bytes)");
        if (r.annotationsBytes > 4 * 1024 * 1024)
          console.error("perf.sh: WARNING annotations exceed the 4 MB board cap (DDR-242) — saves/sync of this board will be refused");
      }
    }).catch((e) => {
      console.error("perf.sh: fixture generation failed: " + e.message);
      process.exit(1);
    });
  ' "$SCRIPT_DIR/../test/fixtures/perf-canvas.mjs" "$DESIGN_ROOT" "$BOARDS" "$STROKES" "$MIX" || exit 1
  CANVAS="ui/perf-fixture.tsx"
fi

# ---------- resolve canvas ----------
if [ -z "$CANVAS" ]; then
  ACTIVE_FILE="$DESIGN_ROOT/_active.json"
  if [ -f "$ACTIVE_FILE" ] && command -v jq >/dev/null 2>&1; then
    CANVAS=$(jq -r '.active // empty' "$ACTIVE_FILE" 2>/dev/null)
  fi
fi
[ -n "$CANVAS" ] || { echo "perf.sh: no --canvas and no active canvas in _active.json" >&2; exit 2; }

# `_active.json` stores the path relative to the REPO (".design/ui/x.tsx"); the
# canvas-shell query param wants it the same way, so normalize either input
# shape to the repo-relative form rather than guessing at call sites.
DESIGN_REL="${DESIGN_ROOT#"$REPO"/}"
case "$CANVAS" in
  "$DESIGN_REL"/*) REL_FULL="$CANVAS" ;;
  *)               REL_FULL="$DESIGN_REL/$CANVAS" ;;
esac
# Containment: an existence check alone would accept `--canvas ../../../x.tsx`
# and leave the boundary entirely to the dev-server route. A benchmark has no
# business probing that gate.
case "$REL_FULL" in
  *..*) echo "perf.sh: --canvas must not contain '..'" >&2; exit 2 ;;
esac
[ -f "$REPO/$REL_FULL" ] || { echo "perf.sh: canvas not found: $REPO/$REL_FULL" >&2; exit 2; }

# Percent-encode the whole value, not just spaces: a canvas named with `#`, `&`
# or `%` would otherwise truncate or rewrite the query string.
REL_ENC=$("$JS_RUNTIME" -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$REL_FULL")
URL="http://localhost:${PORT}/_canvas-shell.html?canvas=${REL_ENC}"

# ---------- history path ----------
# `_smoke/` is already IGNORED runtime state (DDR-115), so the benchmark log
# inherits the right gitignore posture without touching any of the three lists.
if [ -z "$HISTORY" ]; then
  HISTORY="$DESIGN_ROOT/_smoke/perf/history.jsonl"
fi
# Containment: `perf` is auto-approved in ACP sessions (`Bash(maude:*)`), so an
# unconstrained --history would be an arbitrary mkdir + append outside every
# write-scope gate. The default already lives under the design root; require it.
HISTORY_ABS=$("$JS_RUNTIME" -e 'const p=require("path");process.stdout.write(p.resolve(process.argv[1]))' "$HISTORY")
DESIGN_ABS=$("$JS_RUNTIME" -e 'const p=require("path");process.stdout.write(p.resolve(process.argv[1]))' "$DESIGN_ROOT")
case "$HISTORY_ABS" in
  "$DESIGN_ABS"/*) ;;
  *) echo "perf.sh: --history must resolve under $DESIGN_ABS (got $HISTORY_ABS)" >&2; exit 2 ;;
esac
HISTORY="$HISTORY_ABS"
mkdir -p "$(dirname "$HISTORY")"

# ---------- engine tag ----------
# The tag is part of the history KEY, not decoration: a WKWebView number and a
# headless-Chromium number are not comparable, and silently averaging them would
# make every delta meaningless.
ENGINE_TAG="${MAUDE_PERF_ENGINE_TAG:-}"
if [ -z "$ENGINE_TAG" ]; then
  if [ -n "$MAUDE_DESKTOP" ]; then ENGINE_TAG="webkit-desktop"; else ENGINE_TAG="blink-headless"; fi
fi

if [ "$PROBE_ENGINE" = "safari" ]; then
  command -v safaridriver >/dev/null 2>&1 || {
    echo "perf.sh: safaridriver not found (macOS only)" >&2
    exit 1
  }
  PROBE_URL="$URL"
  if [ "$STUDIO" = "1" ]; then
    # Studio mode drives the real app shell (root URL + a file-tree click),
    # not the bare canvas page — see _perf-probe-safari.mjs for why that
    # difference changes the numbers.
    PROBE_URL="http://localhost:${PORT}/"
    SLUG=$(printf '%s' "${REL_FULL#"$DESIGN_REL"/}" \
      | sed -E 's/\.[A-Za-z]+$//' | tr '[:upper:]' '[:lower:]' \
      | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g')
  fi
  echo "→ perf: $REL_FULL | port: $PORT | engine: webkit-safari${STUDIO:+ | studio}" >&2
  ARGS=(--url "$PROBE_URL" --label "$REL_FULL$([ "$STUDIO" = "1" ] && echo " (studio)")" --history "$HISTORY"
        --timeout "$TIMEOUT" --pan "$PAN" --zoom "$ZOOM" --repeat "$REPEAT")
  [ "$STUDIO" = "1" ] && ARGS+=(--studio "$SLUG")
  [ "$FIT_ALL" = "1" ] && ARGS+=(--fit-all)
  [ "$JSON" = "1" ] && ARGS+=(--json)
  exec "$JS_RUNTIME" "$SCRIPT_DIR/_perf-probe-safari.mjs" "${ARGS[@]}"
fi

AB="${MAUDE_AGENT_BROWSER:-agent-browser}"
command -v "$AB" >/dev/null 2>&1 || {
  echo "perf.sh: agent-browser not on PATH (required — the probe needs scripted gestures + rAF timing)" >&2
  exit 1
}

echo "→ perf: $REL_FULL | port: $PORT | engine: $ENGINE_TAG" >&2

ARGS=(--url "$URL" --label "$REL_FULL" --history "$HISTORY" --engine-tag "$ENGINE_TAG"
      --timeout "$TIMEOUT" --pan "$PAN" --zoom "$ZOOM" --repeat "$REPEAT")
[ "$FIT_ALL" = "1" ] && ARGS+=(--fit-all)
[ "$JSON" = "1" ] && ARGS+=(--json)

exec "$JS_RUNTIME" "$SCRIPT_DIR/_perf-probe.mjs" "${ARGS[@]}"
