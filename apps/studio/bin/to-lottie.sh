#!/usr/bin/env bash
# to-lottie.sh — emit ONE Lottie from CODE (the maude motion handoff, DDR-094).
#
# This is the production-delivery counterpart to draw-build.sh: where draw-build
# runs an agent-authored *engine* script to emit static SVG/JSX, to-lottie runs an
# agent-authored *python-lottie generator* to emit ONE `.lottie`/`.json` that
# renders 1:1 on web (lottie-web / dotlottie-react) AND mobile
# (lottie-react-native) — same renderer family, 1:1 by construction. It is an
# EMITTER from the keyframe data, NOT a converter of rendered SVG/SMIL (no reliable
# one exists — DDR-094 research). The generator encodes the 8 conversion rules; see
# `plugins/design/commands/to-lottie.md` + `references/draw/motion-rules.md`.
#
# Reached via `maude design to-lottie` (DDR-062), never a raw bin path.
#
# Usage:
#   to-lottie.sh --script <gen.py> --out <mark.json>
#                [--verify] [--frames "0,33,66"] [--root <repo>] [--timeout 12]
#
# The generator (gen.py) builds the Lottie via python-lottie and writes it to the
# path in $MAUDE_LOTTIE_OUT (= --out). python-lottie owns format correctness
# (beziers, keyframes, gradients, masks, parenting); the agent encodes the
# conversion rules (per-segment easing incl. overshoot, arc parsing via
# parse_svg_file, layers[0]=top + reverse, masks, baked sub-loops, coord offset,
# gradient opacity stops).
#
# --verify renders frames through HEADLESS lottie-web (cairo can't render masks —
# lottie-web must) using the shipped harness + the screenshot helper, so you can
# read the PNGs and compare to the web reference.
#
# Stdout (last line): the output .json path (capturable in $(...)).
# Exit: 0 ok / 1 missing input or runtime / 2 bad args / 3 generate failed
#       / 4 verify render failed.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GEN=""
OUT=""
VERIFY=0
FRAMES="0,33,66"
REPO=""
TIMEOUT=12

while [ $# -gt 0 ]; do
  case "$1" in
    --script)  GEN="$2"; shift 2 ;;
    --out)     OUT="$2"; shift 2 ;;
    --verify)  VERIFY=1; shift ;;
    --frames)  FRAMES="$2"; shift 2 ;;
    --root)    REPO="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --help|-h) sed -n '2,33p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "to-lottie.sh: unknown arg '$1' (try --help)" >&2; exit 2 ;;
  esac
done

[ -n "$GEN" ] || { echo "to-lottie.sh: --script <gen.py> required" >&2; exit 2; }
[ -n "$OUT" ] || { echo "to-lottie.sh: --out <mark.json> required" >&2; exit 2; }
[ -f "$GEN" ] || { echo "to-lottie.sh: generator not found: $GEN" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "to-lottie.sh: python3 is required." >&2; exit 1; }

# ---------- python-lottie venv (cached, idempotent) ----------
VENV="${MAUDE_LOTTIE_VENV:-${XDG_CACHE_HOME:-$HOME/.cache}/maude/lottie-venv}"
PY="$VENV/bin/python"
if [ ! -x "$PY" ]; then
  echo "→ bootstrapping python-lottie venv at $VENV (one-off) …" >&2
  python3 -m venv "$VENV" || { echo "to-lottie.sh: venv create failed" >&2; exit 1; }
  "$VENV/bin/pip" install --quiet --disable-pip-version-check lottie cairosvg pillow \
    || { echo "to-lottie.sh: pip install lottie failed (needs network on first run)" >&2; exit 1; }
fi
# Sanity: the `lottie` module must import.
"$PY" -c 'import lottie' 2>/dev/null || {
  echo "→ (re)installing python-lottie into $VENV …" >&2
  "$VENV/bin/pip" install --quiet --disable-pip-version-check lottie cairosvg pillow \
    || { echo "to-lottie.sh: python-lottie unavailable" >&2; exit 1; }
}

# ---------- generate ----------
mkdir -p "$(dirname "$OUT")"
echo "→ generating Lottie: $GEN → $OUT" >&2
MAUDE_LOTTIE_OUT="$OUT" "$PY" "$GEN" >&2
GRC=$?
if [ "$GRC" -ne 0 ] || [ ! -s "$OUT" ]; then
  echo "to-lottie.sh: generator failed (rc=$GRC) or wrote no output to $OUT" >&2
  exit 3
fi
# Validity gate: the output must be parseable JSON with the Lottie shape keys.
"$PY" - "$OUT" <<'PYEOF' >&2 || { echo "to-lottie.sh: output is not a valid Lottie JSON" >&2; exit 3; }
import json, sys
d = json.load(open(sys.argv[1]))
assert isinstance(d, dict) and 'layers' in d and 'op' in d, 'missing Lottie keys (layers/op)'
print(f"  ✓ valid Lottie: {len(d.get('layers', []))} layers, {d.get('op')} frames @ {d.get('fr')}fps")
PYEOF

# ---------- self-verify through headless lottie-web ----------
if [ "$VERIFY" -eq 1 ]; then
  HARNESS="$SCRIPT_DIR/to-lottie-verify.html"
  [ -f "$HARNESS" ] || { echo "to-lottie.sh: verify harness missing at $HARNESS — reinstall maude." >&2; exit 1; }
  OUT_DIR_ABS="$(cd "$(dirname "$OUT")" && pwd)"
  OUT_BASE="$(basename "$OUT")"
  cp "$HARNESS" "$OUT_DIR_ABS/_to-lottie-verify.html"
  FRAMES_DIR="$OUT_DIR_ABS/_verify-frames"
  mkdir -p "$FRAMES_DIR"

  # Serve the dir (file:// blocks fetch of the JSON). Pick a free-ish port.
  PORT=$(( ( RANDOM % 2000 ) + 8200 ))
  ( cd "$OUT_DIR_ABS" && "$PY" -m http.server "$PORT" >/dev/null 2>&1 ) &
  SRV_PID=$!
  trap 'kill "$SRV_PID" 2>/dev/null; rm -f "$OUT_DIR_ABS/_to-lottie-verify.html"' EXIT
  sleep 1

  FAIL=0
  IFS=',' read -r -a FRAME_ARR <<< "$FRAMES"
  for F in "${FRAME_ARR[@]}"; do
    F_TRIM="$(printf '%s' "$F" | tr -d '[:space:]')"
    URL="http://localhost:$PORT/_to-lottie-verify.html?src=$OUT_BASE&f=$F_TRIM"
    PNG="$FRAMES_DIR/frame-$F_TRIM.png"
    echo "→ verify frame $F_TRIM ($URL)" >&2
    bash "$SCRIPT_DIR/screenshot.sh" --url "$URL" --full --out "$PNG" --timeout "$TIMEOUT" >&2 \
      || { echo "✗ verify frame $F_TRIM failed" >&2; FAIL=$((FAIL + 1)); }
  done
  if [ "$FAIL" -gt 0 ]; then
    echo "to-lottie.sh: $FAIL verify frame(s) failed to render" >&2
    exit 4
  fi
  echo "→ verify frames in $FRAMES_DIR — READ them and compare to the web reference (masks render on lottie-web, NOT cairo)" >&2
fi

# Last stdout line = the output path, for $(maude design to-lottie ...) capture.
printf '%s\n' "$OUT"
