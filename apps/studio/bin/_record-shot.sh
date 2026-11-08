#!/usr/bin/env bash
# _record-shot.sh — internal: record one successful `maude design screenshot` capture as evidence
# for the design plugin's Stop hook (contract V2-1.11 §5.4 step 2, V2-1.18 §5.1).
#
#   _record-shot.sh --root <repo> --canvas <rel> [--artboard <id> | --all]
#
# Appends {at, canvas, artboard, all, session} (one JSON line) to the design hooks' state OUTSIDE the
# project (#168 E3; cli/lib/hook-state.mjs) — a shots.jsonl in the project is never evidence:
#   <state>/<MAUDE_HOOK_SESSION>/shots.jsonl   when the hook session is known
#     (the SessionStart hook exports it to Bash through CLAUDE_ENV_FILE)
#   <state>/shots.jsonl                        otherwise
# where <state> = ${MAUDE_HOOK_STATE_HOME:-~/.claude/maude-hook}/<rootIdentity(repo)> (the first 12
# hex of sha256 over the repo's resolved path, as studio-locate.mjs `rootIdentity`). Folders 0700,
# file 0600; a symlink at the record is never followed. Stop counts a capture newer than an
# artboard's last edit; `--all` (a --full / --all-screens capture) counts for every artboard.
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

# the hook state folder of this project: rootIdentity = sha256(realpath(repo))[:12]
STATE_HOME="${MAUDE_HOOK_STATE_HOME:-}"
if [ -z "$STATE_HOME" ]; then
  [ -n "${HOME:-}" ] || exit 0
  STATE_HOME="$HOME/.claude/maude-hook"
fi
REAL=$(cd "$ROOT" 2>/dev/null && pwd -P) || exit 0
if command -v shasum >/dev/null 2>&1; then
  ID=$(printf '%s' "$REAL" | shasum -a 256 2>/dev/null | cut -c1-12)
elif command -v sha256sum >/dev/null 2>&1; then
  ID=$(printf '%s' "$REAL" | sha256sum 2>/dev/null | cut -c1-12)
else
  exit 0
fi
printf '%s' "$ID" | grep -Eq '^[0-9a-f]{12}$' || exit 0
STATE="$STATE_HOME/$ID"

SESSION="${MAUDE_HOOK_SESSION:-}"
if printf '%s' "$SESSION" | grep -Eq '^[A-Za-z0-9_-]{1,128}$'; then
  DIR="$STATE/$SESSION"
  SESSION_JSON="\"$SESSION\""
else
  DIR="$STATE"
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

umask 077
mkdir -p "$DIR" 2>/dev/null || exit 0
chmod 700 "$STATE_HOME" "$STATE" "$DIR" 2>/dev/null
FILE="$DIR/shots.jsonl"
[ -L "$FILE" ] && exit 0
[ -e "$FILE" ] && [ ! -f "$FILE" ] && exit 0
printf '{"at":%s,"canvas":"%s","artboard":%s,"all":%s,"session":%s}\n' \
  "$AT" "$(esc "$CANVAS")" "$ART_JSON" "$ALL" "$SESSION_JSON" >>"$FILE" 2>/dev/null
exit 0
