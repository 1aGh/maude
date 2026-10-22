#!/usr/bin/env bash
# photo-bg-remove.sh — feature-photo-editor (Stage G, Task 18). Headless
# background removal: mirrors draw-proof.sh's structure (throwaway harness
# canvas + agent-browser drive) but the "proof" here isn't a screenshot ladder
# — it's the client-side @imgly ML pass actually running and reporting back
# through DOM attributes agent-browser polls, since there's no other channel
# to cross the process boundary out of a headless browser.
#
# Design note (the decision this task was originally deferred on): the harness
# canvas runs inside the split-origin (DDR-054) canvas iframe, but BOTH
# `/_api/asset` and `/_api/photo-edit` are already canvas-safe routes (see
# their CANVAS_SAFE_API comments in http.ts) — so the harness component
# (`PhotoBgRemoveHarness`, canvas-lib.tsx) posts the matte and the updated
# PhotoEdit sidecar directly from the canvas origin. No cross-origin relay,
# no base64-through-a-DOM-attribute round-trip needed.
#
# Reached via `maude design photo-bg-remove` (never a raw bin path — DDR-062).
#
# Security hardening (fix-photo-editor-followup-debt, Stage A): `--asset` is
# validated against the strict `assets/<sha8>.<ext>` shape (mirrors
# photo-store.ts's SHA_RE) rather than a loose glob — a permissive check
# previously let a crafted `--asset` value splice unescaped content into the
# generated harness `.tsx`. The harness-file write is symlink-safe (write to a
# freshly O_EXCL-created tmp path, then atomic `mv` into place — `mv`/rename(2)
# replaces a destination symlink's OWN dirent rather than following it, so even
# a pre-planted symlink at the harness path can't redirect the write into a
# real reviewed canvas file). The stdout deliverable is shape-validated before
# print. `--slug` failure hard-fails instead of downgrading to an unsanitized
# fallback. Concurrent invocations against the SAME asset serialize via a
# `mkdir`-based lock (portable — `flock` isn't available on macOS by default).
#
# Usage:
#   photo-bg-remove.sh --asset <assets/<sha8>.<ext>> [--root <repo>]
#                       [--slug <name>] [--timeout <secs>]
#
# Requires a running dev server (caller runs `maude design server-up` first);
# reads the port from <designRoot>/_server.json. Requires agent-browser (the
# ML pass needs a real WASM/WebGPU-capable browser driving real DOM state —
# there is no non-browser path, unlike photo-adjust.sh's plain curl).
#
# Stdout (last line): the new matte asset path `assets/<sha8>.png` (for $(...)).
# Stderr: progress / diagnostics.
# Exit:   0 success / 1 missing input, server, or agent-browser / 2 bad args
#         / 3 drive/navigation failed / 4 the harness itself reported an error
#         (or produced a malformed result) / 5 timed out waiting for the ML
#         pass to finish / 6 another run is already in progress for this asset

set -uo pipefail

ASSET="" SLUG="" REPO="" TIMEOUT=150
# Mirrors photo-store.ts's SHA_RE shape: lowercase hex sha8 (8-64 chars),
# case-insensitive extension. Shared between --asset validation (Task 1) and
# the stdout-deliverable validation (Task 3) so the two checks can't drift.
ASSET_SHAPE_RE='^assets/[0-9a-f]{8,64}\.[a-zA-Z0-9]+$'

while [ $# -gt 0 ]; do
  case "$1" in
    --asset)   ASSET="$2"; shift 2 ;;
    --slug)    SLUG="$2"; shift 2 ;;
    --root)    REPO="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,39p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "photo-bg-remove.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

[ -n "$ASSET" ] || { echo "photo-bg-remove.sh: --asset <assets/<sha8>.<ext>> required" >&2; exit 2; }
# Strip a leading designRoot-relative slash/prefix if the caller passed one.
ASSET="${ASSET#/}"
# Strict shape check (Task 1) — replaces the old `case "$ASSET" in assets/*)`
# glob, which only checked the PREFIX and let anything after it (quotes,
# backticks, `../`, JSX-breaking sequences) ride unescaped into the generated
# harness .tsx below. `[[ =~ ]]` against a character-class regex is the bash
# equivalent of photo-store.ts's `SHA_RE` hex check — `..`, `/`, quotes, and
# any non-hex/non-alnum content can never match, so nothing but a clean
# `assets/<sha8>.<ext>` reference survives validation. Captures the bare sha8
# for reuse as a filesystem-safe lock key (Task 6).
if [[ "$ASSET" =~ ^assets/([0-9a-f]{8,64})\.[a-zA-Z0-9]+$ ]]; then
  ASSET_KEY="${BASH_REMATCH[1]}"
else
  echo "photo-bg-remove.sh: --asset must look like assets/<sha8>.<ext> (lowercase hex, 8-64 chars), got '$ASSET'" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -n "$SLUG" ] || SLUG=$(basename "$ASSET" | sed -E 's/\.[^.]+$//')
# Hard-fail (Task 4) instead of downgrading to a lowercased-but-unstripped
# fallback on slug.sh failure — a safety subprocess's failure must never
# silently continue with a less-safe code path. This repo has documented
# history (DDR-045) of sibling-script resolution breaking specifically in
# packaged/compiled distributions, so this failure mode is realistic.
# (SLUG_INPUT is captured separately so a failed substitution — which still
# assigns its, here empty, stdout to $SLUG — doesn't blank the diagnostic.)
SLUG_INPUT="$SLUG"
if ! SLUG="$(bash "$SCRIPT_DIR/slug.sh" "$SLUG_INPUT" 2>/dev/null)"; then
  echo "photo-bg-remove.sh: slug.sh failed to normalize slug '$SLUG_INPUT' — refusing to fall back to an unsanitized value" >&2
  exit 1
fi
# Assigned this early (not just before the agent-browser open call below) so
# it's always bound by the time `trap cleanup EXIT` is installed — a security
# review of this plan found that `cleanup()` unconditionally reads $SESSION,
# and under `set -u` an exit on one of the harness-write failure paths (before
# SESSION used to be assigned) would abort mid-cleanup on the unbound
# variable, skipping the `rmdir "$LOCK_DIR"` below it and leaking the lock.
SESSION="photo-bgremove-$SLUG-$$"

# ---------- resolve repo + design root + port ----------
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
DESIGN_ROOT="$REPO/.design"
[ -d "$DESIGN_ROOT" ] || { echo "photo-bg-remove.sh: no .design/ under $REPO" >&2; exit 1; }
[ -f "$DESIGN_ROOT/$ASSET" ] || { echo "photo-bg-remove.sh: asset not found: $DESIGN_ROOT/$ASSET" >&2; exit 1; }

STATE="$DESIGN_ROOT/_server.json"
[ -f "$STATE" ] || { echo "photo-bg-remove.sh: $STATE missing — run \`maude design server-up\` first" >&2; exit 1; }
if command -v jq >/dev/null 2>&1; then
  PORT=$(jq -r .port "$STATE" 2>/dev/null)
else
  PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
fi
[ -n "$PORT" ] || { echo "photo-bg-remove.sh: no port in $STATE" >&2; exit 1; }

# ---------- resolve agent-browser (hard dependency — see header) ----------
# Mirrors screenshot.sh's MAUDE_AGENT_BROWSER override (DDR-144 attacker-F4 — an
# explicit single-binary pointer, never a PATH prepend a same-user attacker
# could shadow) and its ensure-browser.sh chrome resolution.
AB="${MAUDE_AGENT_BROWSER:-agent-browser}"
command -v "$AB" >/dev/null 2>&1 || {
  echo "photo-bg-remove.sh: agent-browser not found (required — the ML pass needs a real WASM/WebGPU browser, there is no non-browser fallback here)" >&2
  exit 1
}
if [ -z "${AGENT_BROWSER_EXECUTABLE_PATH:-}" ]; then
  ES_FLAGS="--quiet"
  [ -z "${MAUDE_DEV_SERVER_ROOT:-}" ] && ES_FLAGS="--quiet --no-download"
  BROWSER_PATH="$(bash "$SCRIPT_DIR/ensure-browser.sh" $ES_FLAGS 2>/dev/null)"
  [ -n "$BROWSER_PATH" ] && export AGENT_BROWSER_EXECUTABLE_PATH="$BROWSER_PATH"
fi

# ---------- per-asset concurrency guard (Task 6) ----------
# `mkdir` is atomic on every POSIX filesystem and needs no extra binary —
# `flock` isn't available on macOS by default, so this is the portable choice.
# Keyed on the asset's sha8 (already validated hex — safe as a path segment),
# NOT global, so two different assets still run concurrently. Fail-fast rather
# than queue/wait: a full job queue is out of scope for this backstop, whose
# only job is refusing to let a runaway loop spawn unbounded concurrent
# browser+WASM processes against the same asset.
PHOTO_DIR="$DESIGN_ROOT/_photo"
mkdir -p "$PHOTO_DIR"
LOCK_DIR="$PHOTO_DIR/.lock.$ASSET_KEY"
TMP_HARNESS=""
# The harness THIS run wrote (bound only after its rename lands, so a run that fails earlier never
# deletes a harness some other run owns). Removed on every exit — gate-b-c4c: a harness left on
# disk after a failed or timed-out run kept a valid nonce line for whoever came next.
WRITTEN_HARNESS=""
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "photo-bg-remove.sh: another photo-bg-remove run is already in progress for asset '$ASSET' — refusing to run concurrently against the same asset (lock: ${LOCK_DIR#$REPO/})" >&2
  exit 6
fi

cleanup() {
  "$AB" --session "$SESSION" close >/dev/null 2>&1 || true
  [ -n "$TMP_HARNESS" ] && rm -f "$TMP_HARNESS" 2>/dev/null
  [ -n "$WRITTEN_HARNESS" ] && rm -f "$WRITTEN_HARNESS" 2>/dev/null
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# ---------- generate the harness canvas (symlink-safe — Task 2) ----------
# Write to a freshly O_CREAT|O_EXCL-created tmp path in the SAME directory
# (same filesystem, so the rename below is atomic), then `mv` into place.
# `mv`/rename(2) replaces the destination NAME, never dereferences it — so
# even a pre-planted symlink at $HARNESS_TSX gets its dirent swapped out
# rather than followed, unlike the bare `{ ... } > "$HARNESS_TSX"` truncating
# redirect this replaces (which WOULD follow a symlink and could splice
# attacker-controlled JSX into whatever real file it pointed at). `set -C`
# (noclobber) makes bash open the tmp path with O_EXCL, so a pre-existing tmp
# path (including a dangling symlink) fails the write instead of following it
# — the bash equivalent of sync/atomic-write.ts's Node `wx` flag (DDR-054 §2c).
# gate-b-c4c — a one-time 128-bit nonce, written into the harness AND passed on the open URL. The
# main origin mints the harness frame (a capability over every canvas using this photo) only when
# the two match, so a canvas that frames the guessable `?canvas=_photo/<hash>.bgremove.tsx` URL gets
# nothing. Canvas code cannot read the harness source to learn it.
NONCE="$(openssl rand -hex 16 2>/dev/null || true)"
if [[ ! "$NONCE" =~ ^[0-9a-f]{32}$ ]]; then
  NONCE="$(od -An -tx1 -N16 /dev/urandom 2>/dev/null | tr -d ' \n')"
fi
if [[ ! "$NONCE" =~ ^[0-9a-f]{32}$ ]]; then
  echo "photo-bg-remove.sh: could not draw a random nonce (no openssl, no /dev/urandom)" >&2
  exit 1
fi
HARNESS_TSX="$PHOTO_DIR/$SLUG.bgremove.tsx"
TMP_HARNESS="$PHOTO_DIR/.$SLUG.bgremove.tsx.tmp.$$.$RANDOM$RANDOM"
if ! (
  set -C
  {
    echo "import { PhotoBgRemoveHarness } from '@maude/canvas-lib';"
    echo
    echo "// AUTO-GENERATED by \`maude design photo-bg-remove\` — headless bg-removal proof"
    echo "// harness. Lives under _photo/ (gitignored); deleted when the run exits."
    echo "// maude-harness-nonce: $NONCE"
    echo "export default function PhotoBgRemoveCanvas() {"
    printf '  return <PhotoBgRemoveHarness source=%s />;\n' "\"$ASSET\""
    echo "}"
  } > "$TMP_HARNESS"
); then
  echo "photo-bg-remove.sh: failed to create harness scratch file (possible pre-existing path at $TMP_HARNESS)" >&2
  exit 1
fi
if ! mv "$TMP_HARNESS" "$HARNESS_TSX"; then
  echo "photo-bg-remove.sh: atomic rename of harness file failed" >&2
  exit 1
fi
TMP_HARNESS="" # renamed away — cleanup() removes the harness itself instead
WRITTEN_HARNESS="$HARNESS_TSX"
echo "→ harness canvas: ${HARNESS_TSX#$REPO/}" >&2

REL="_photo/$SLUG.bgremove.tsx"
# V2-2.4b gate — the harness renders on the CANVAS origin (`canvasOrigin` in
# _server.json), never the main one: the main origin 307s every canvas shell
# to the read-only capture origin, and this harness needs the canvas origin's
# canvas-safe `/_api/asset` + `/_api/photo-edit` writes — nothing more. Only a
# loopback origin is accepted. With the origin split off there is no canvas
# origin and everything renders on the main origin, as before.
CANVAS_ORIGIN=""
if command -v jq >/dev/null 2>&1; then
  CANVAS_ORIGIN=$(jq -r '.canvasOrigin // empty' "$STATE" 2>/dev/null)
else
  CANVAS_ORIGIN=$(sed -nE 's/.*"canvasOrigin"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$STATE" | head -n1)
fi
if [ -z "$CANVAS_ORIGIN" ]; then
  CANVAS_ORIGIN="http://localhost:$PORT"
elif [[ ! "$CANVAS_ORIGIN" =~ ^http://(localhost|127\.0\.0\.1):[0-9]+$ ]]; then
  echo "photo-bg-remove.sh: canvasOrigin in $STATE is not a loopback origin ('$CANVAS_ORIGIN')" >&2
  exit 1
fi
# gate-b-c4 — opened through the MAIN origin, which 307s this exact harness shape to the canvas
# origin with the frame's capability (the canvas origin answers nothing per canvas without one) —
# only for the nonce this run wrote into the harness (gate-b-c4c). With the split off (no canvas
# origin) the main origin serves it itself, as before.
URL="http://localhost:$PORT/_canvas-shell.html?canvas=$REL&nonce=$NONCE"
SEL="[data-photo-bgremove-status]"

echo "→ driving $URL (session $SESSION)" >&2
if ! "$AB" --session "$SESSION" open "$URL" >&2; then
  echo "photo-bg-remove.sh: agent-browser failed to open the harness canvas" >&2
  exit 3
fi

# ---------- poll the harness's status attribute ----------
# The ML pass includes a first-use ~40 MB model-weight fetch (Task 11/12) —
# this can dominate the wait far more than inference itself, hence the
# generous default timeout.
ELAPSED=0
STATUS="pending"
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  STATUS="$("$AB" --session "$SESSION" get attr "$SEL" data-photo-bgremove-status 2>/dev/null | tr -d '"')"
  case "$STATUS" in
    done|error) break ;;
  esac
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

if [ "$STATUS" = "error" ]; then
  ERR="$("$AB" --session "$SESSION" get attr "$SEL" data-photo-bgremove-error 2>/dev/null | tr -d '"')"
  echo "photo-bg-remove.sh: harness reported an error: ${ERR:-unknown}" >&2
  exit 4
fi

if [ "$STATUS" != "done" ]; then
  echo "photo-bg-remove.sh: timed out after ${TIMEOUT}s waiting for the ML pass (still '$STATUS')" >&2
  exit 5
fi

RESULT="$("$AB" --session "$SESSION" get attr "$SEL" data-photo-bgremove-result 2>/dev/null | tr -d '"')"
[ -n "$RESULT" ] || { echo "photo-bg-remove.sh: harness reported done but no result asset" >&2; exit 4; }
# Shape-validate the deliverable (Task 3) before it's ever trusted as far as
# stdout — the harness runs inside the (untrusted, DDR-054) canvas origin, so
# a malformed/crafted `data-photo-bgremove-result` value is treated exactly
# like the empty-result case above rather than printed verbatim.
if [[ ! "$RESULT" =~ $ASSET_SHAPE_RE ]]; then
  echo "photo-bg-remove.sh: harness reported a malformed result asset '$RESULT'" >&2
  exit 4
fi

echo "→ background removed → $RESULT" >&2
# Last stdout line = the new matte asset path, for $(maude design photo-bg-remove ...) capture.
printf '%s\n' "$RESULT"
# The harness is removed by cleanup() on this and every other exit path (gate-b-c4c — it used to
# stay on error for debugging, still holding a valid nonce).
