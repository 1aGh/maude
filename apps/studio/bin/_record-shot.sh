#!/usr/bin/env bash
# _record-shot.sh — internal: record one successful `maude design screenshot` capture as evidence
# for the design plugin's Stop hook (contract V2-1.11 §5.4 step 2, V2-1.18 §5.1).
#
#   _record-shot.sh --root <repo> --canvas <rel> [--artboard <id> | --all]
#
# Appends {at, canvas, artboard, all, session} (one JSON line) to
#   <repo>/.design/_runs/<MAUDE_HOOK_SESSION>/shots.jsonl   when the hook session is known
#     (the SessionStart hook exports it to Bash through CLAUDE_ENV_FILE)
#   <repo>/.design/_runs/shots.jsonl                        otherwise
# Stop counts a capture newer than an artboard's last edit; `--all` (a --full / --all-screens
# capture) counts for every artboard of the canvas. Runtime state (DDR-115).
#
# Best effort and silent: any problem → exit 0 without writing (a capture never fails for it).
set -u

ROOT=""
CANVAS=""
ARTBOARD=""
ALL=false
while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    --canvas) CANVAS="${2:-}"; shift 2 ;;
    --artboard) ARTBOARD="${2:-}"; shift 2 ;;
    --all) ALL=true; shift ;;
    *) shift ;;
  esac
done
[ -n "$ROOT" ] && [ -n "$CANVAS" ] || exit 0
DESIGN="$ROOT/.design"
[ -d "$DESIGN" ] || exit 0

# designRoot-relative canvas: `.design/ui/C.tsx` and `ui/C.tsx` both name ui/C.tsx
CANVAS="${CANVAS#./}"
CANVAS="${CANVAS#.design/}"
case "$CANVAS" in
  /* | *..* | "") exit 0 ;;
esac

SESSION="${MAUDE_HOOK_SESSION:-}"
if printf '%s' "$SESSION" | grep -Eq '^[A-Za-z0-9_-]{1,128}$'; then
  DIR="$DESIGN/_runs/$SESSION"
  SESSION_JSON="\"$SESSION\""
else
  DIR="$DESIGN/_runs"
  SESSION_JSON=null
fi

# milliseconds: Stop compares against edit times in ms. Without a sub-second clock, round UP
# (a capture in the same second as an edit counts — the lenient direction).
AT=$(perl -MTime::HiRes=time -e 'printf "%d", time*1000' 2>/dev/null) ||
  AT=$(python3 -c 'import time; print(int(time.time()*1000))' 2>/dev/null) ||
  AT=$(($(date +%s) * 1000 + 999))
case "$AT" in
  '' | *[!0-9]*) AT=$(($(date +%s) * 1000 + 999)) ;;
esac

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'; }
if [ -n "$ARTBOARD" ]; then ART_JSON="\"$(esc "$ARTBOARD")\""; else ART_JSON=null; fi

mkdir -p "$DIR" 2>/dev/null || exit 0
printf '{"at":%s,"canvas":"%s","artboard":%s,"all":%s,"session":%s}\n' \
  "$AT" "$(esc "$CANVAS")" "$ART_JSON" "$ALL" "$SESSION_JSON" >>"$DIR/shots.jsonl" 2>/dev/null
exit 0
