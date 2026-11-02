#!/usr/bin/env bash
# draw-proof.sh — Phase 25 render/verify harness driver for the draw engine.
# Generates a throwaway proof canvas under <designRoot>/_draw/<slug>.proof.tsx
# that mounts the given SVG mark through the canvas-lib `DrawProof` component
# (size ladder 16/24/48/256 × {light, dark, single-color flatten}), then
# screenshots every artboard via the canonical screenshot helper. One run
# operationalizes the whole graphic rubric: per-size legibility, dark-mode
# currentColor flip, and the single-color flatten test.
#
# Reached via `maude design draw-proof` (never a raw bin path — DDR-062).
#
# Usage:
#   draw-proof.sh --asset <mark.svg> --slug <name>
#                 [--root <repo>] [--out-dir <dir>] [--name <display label>]
#                 [--engine auto|agent-browser|playwright] [--timeout <secs>]
#                 [--motion] [--motion-selector <css>] [--motion-gap <ms>]
#
# Requires a running dev server (caller runs `maude design server-up` first);
# reads the port from <designRoot>/_server.json.
#
# --motion: after the still ladder, run the LIVE-MOTION proof — sample the
#   animated element at two wall-clock times and assert it changed. A still
#   screenshot can't prove animation (DDR-094 M1); a freeze-frame pass + an
#   over-time NO-CHANGE is a HARD FAIL (dead mechanism, e.g. CSS d:path()).
#   --motion-selector targets a specific element (default: auto-detect the
#   parent of the first <animate>/<animateTransform>). --motion-gap sets the
#   sample interval in ms (default 600).
#
# Stdout (last line): the screenshot output directory (capturable in $(...)).
# Stderr: progress / diagnostics.
# Exit:   0 success / 1 missing input or server / 2 bad args / 3 capture failed
#         / 4 motion HARD FAIL (still ladder OK but no over-time change).

ASSET=""
SLUG=""
REPO=""
OUT_DIR=""
NAME=""
ENGINE="auto"
TIMEOUT=10
MOTION=0
MOTION_SELECTOR=""
MOTION_GAP=600

while [ $# -gt 0 ]; do
  case "$1" in
    --asset)   ASSET="$2"; shift 2 ;;
    --slug)    SLUG="$2"; shift 2 ;;
    --root)    REPO="$2"; shift 2 ;;
    --out-dir) OUT_DIR="$2"; shift 2 ;;
    --name)    NAME="$2"; shift 2 ;;
    --engine)  ENGINE="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --motion)  MOTION=1; shift ;;
    --motion-selector) MOTION_SELECTOR="$2"; shift 2 ;;
    --motion-gap)      MOTION_GAP="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,37p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "draw-proof.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

[ -n "$ASSET" ] || { echo "draw-proof.sh: --asset <mark.svg> required" >&2; exit 2; }
[ -n "$SLUG" ]  || { echo "draw-proof.sh: --slug <name> required" >&2; exit 2; }
[ -f "$ASSET" ] || { echo "draw-proof.sh: asset not found: $ASSET" >&2; exit 1; }

# Normalize slug to a filesystem-safe token (reuse the canonical slug helper).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Hard-fail rather than fall back to a less-sanitized value (mirrors
# photo-bg-remove.sh), and hold the slug to the exact harness shape the studio
# serves (`LOCAL_HARNESS` in http.ts): a quote, `/` or `..` never reaches the
# proof path or the URL below.
SLUG_INPUT="$SLUG"
if ! SLUG="$(bash "$SCRIPT_DIR/slug.sh" "$SLUG_INPUT" 2>/dev/null)"; then
  echo "draw-proof.sh: slug.sh failed to normalize slug '$SLUG_INPUT'" >&2
  exit 1
fi
if [[ ! "$SLUG" =~ ^[a-z0-9_][a-z0-9._-]*$ ]]; then
  echo "draw-proof.sh: --slug must normalize to [a-z0-9_][a-z0-9._-]* (got '$SLUG')" >&2
  exit 2
fi
[ -n "$NAME" ] || NAME="$SLUG"

# ---------- resolve repo + design root + port ----------
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
DESIGN_ROOT="$REPO/.design"
[ -d "$DESIGN_ROOT" ] || { echo "draw-proof.sh: no .design/ under $REPO" >&2; exit 1; }

STATE="$DESIGN_ROOT/_server.json"
[ -f "$STATE" ] || { echo "draw-proof.sh: $STATE missing — run \`maude design server-up\` first" >&2; exit 1; }
if command -v jq >/dev/null 2>&1; then
  PORT=$(jq -r .port "$STATE" 2>/dev/null)
else
  PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
fi
[ -n "$PORT" ] || { echo "draw-proof.sh: no port in $STATE" >&2; exit 1; }

# ---------- generate the proof canvas ----------
DRAW_DIR="$DESIGN_ROOT/_draw"
mkdir -p "$DRAW_DIR"
PROOF_TSX="$DRAW_DIR/$SLUG.proof.tsx"

# Every value reaches the generated TSX as base64 and is decoded at runtime —
# never spliced into source. The base64 alphabet is inert in any JS/JSX
# context, so a `--name` or mark carrying `"`, `}`, `{`, a backtick or `${`
# is text, not code (V2-2.4b gate). The mark itself is still model-authored
# SVG mounted with innerHTML, which is why the proof renders on the read-only
# capture origin under the strict canvas CSP (no inline handlers run there),
# never on the main origin.
b64() { base64 | tr -d '\n\r'; }
MARK_B64="$(b64 < "$ASSET")"
NAME_B64="$(printf '%s' "$NAME" | b64)"
for v in "$MARK_B64" "$NAME_B64"; do
  [[ "$v" =~ ^[A-Za-z0-9+/=]*$ ]] || { echo "draw-proof.sh: base64 encoding failed" >&2; exit 1; }
done

# Symlink-safe write (as photo-bg-remove.sh): a fresh O_EXCL tmp file in the
# same dir, then rename over the harness NAME — a planted symlink at the proof
# path is replaced, never followed into a real canvas.
TMP_PROOF="$DRAW_DIR/.$SLUG.proof.tsx.tmp.$$.$RANDOM$RANDOM"
if ! ( set -C; {
  echo "import { DrawProof } from '@maude/canvas-lib';"
  echo
  echo "// AUTO-GENERATED by \`maude design draw-proof\` — render/verify harness for one"
  echo "// mark. Lives under _draw/ (gitignored); safe to delete + regenerate."
  echo "const text = (b64: string) =>"
  echo "  new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));"
  printf "const MARK = text('%s');\n" "$MARK_B64"
  printf "const NAME = text('%s');\n" "$NAME_B64"
  echo
  echo "export default function DrawProofCanvas() {"
  echo "  return ("
  echo "    <DrawProof name={NAME} mark={<span dangerouslySetInnerHTML={{ __html: MARK }} />} />"
  echo "  );"
  echo "}"
} > "$TMP_PROOF" ) || ! mv "$TMP_PROOF" "$PROOF_TSX"; then
  rm -f "$TMP_PROOF" 2>/dev/null
  echo "draw-proof.sh: failed to write the proof canvas" >&2
  exit 1
fi
echo "→ proof canvas: ${PROOF_TSX#$REPO/}" >&2

# ---------- resolve out-dir ----------
if [ -z "$OUT_DIR" ]; then
  OUT_DIR="$DESIGN_ROOT/_history/_draw-proof/$SLUG"
fi
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

# ---------- screenshot every artboard ----------
REL="_draw/$SLUG.proof.tsx"
URL="http://localhost:$PORT/_canvas-shell.html?canvas=$REL"
echo "→ screenshotting proof ladder ($URL)" >&2

bash "$SCRIPT_DIR/screenshot.sh" \
  --all-screens \
  --url "$URL" \
  --out-dir "$OUT_DIR" \
  --engine "$ENGINE" \
  --timeout "$TIMEOUT" >&2
RC=$?

if [ "$RC" -ne 0 ]; then
  echo "draw-proof.sh: screenshot capture failed (rc=$RC)" >&2
  exit 3
fi

COUNT=$(find "$OUT_DIR" -maxdepth 1 -type f -name '*.png' 2>/dev/null | wc -l | tr -d ' ')
echo "→ captured $COUNT proof image(s) in $OUT_DIR" >&2

# ---------- live-motion proof (--motion) ----------
# The still ladder above is the freeze-frame; it cannot prove the mark ANIMATES.
# Sample the animated element at two wall-clock times and require a delta.
if [ "$MOTION" -eq 1 ]; then
  echo "→ live-motion proof (over-time delta) …" >&2
  MOTION_ARGS=(--url "$URL" --gap "$MOTION_GAP" --timeout "$TIMEOUT")
  [ -n "$MOTION_SELECTOR" ] && MOTION_ARGS+=(--selector "$MOTION_SELECTOR")
  node "$SCRIPT_DIR/_motion-sample-playwright.mjs" "${MOTION_ARGS[@]}" >&2
  MRC=$?
  case "$MRC" in
    0) echo "→ motion proven (over-time delta confirmed)" >&2 ;;
    4) echo "draw-proof.sh: MOTION HARD FAIL — still ladder OK but the mark does NOT animate over time (dead mechanism). See DDR-094 M1/M2." >&2
       exit 4 ;;
    *) echo "draw-proof.sh: motion sampler error (rc=$MRC) — could not verify animation" >&2
       exit 3 ;;
  esac
fi

# Last stdout line = the output dir, for $(maude design draw-proof ...) capture.
printf '%s\n' "$OUT_DIR"
