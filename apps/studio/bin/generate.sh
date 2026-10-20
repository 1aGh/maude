#!/usr/bin/env bash
# generate.sh — feature-ai-media-generation (Phase 0, DDR-16x). Headless BYOK
# AI-media generation: POST a GenRequest to the running dev server's privileged
# /_api/generate-jobs route, poll the job to completion, and print the produced
# content-addressed asset path (`/assets/<sha8>.<ext>`).
#
# The thin, non-browser sibling of the studio generate dialog — the provider call
# happens SERVER-SIDE (the sidecar resolves the key from the OS keychain /
# ~/.config/maude/keys.json and calls the provider directly), so this verb is a
# pure JSON curl + poll, exactly like photo-adjust.sh. No client-side inference,
# so a harness canvas + agent-browser would be pure overhead.
#
# Reached via `maude design generate` (never a raw bin path — DDR-062).
#
# Usage:
#   generate.sh --prompt "<text>" [--provider gemini|elevenlabs] [--model <id>]
#     [--modality image|audio|video] [--aspect 16:9] [--source assets/<sha8>.<ext>]
#     [--kind music|sfx|tts] [--voice <voice_id>] [--duration <seconds>]
#     [--root <repo>] [--timeout <sec>]
#   generate.sh --take next|prev [--root <repo>]
#
# --take (S8.16) swaps the picture selected in the studio (_active.json) for its
# next / previous take — the same write as ← → on the canvas: GET
# /_api/generate-takes/of names the takes, then POST /_api/edit-op
# {op: "image.replace"} puts the neighbour in its place (one undo step). Prints
# the take now shown (`assets/<sha8>.<ext>`). No provider is called.
#
# --source turns an IMAGE call into a maskless EDIT (Nano Banana): the content-
# addressed source image is read server-side into the request and the prompt
# describes the change; a NEW content-addressed asset is produced (the original
# is never mutated). For --modality video it is the image-to-video SEED (a still
# → a clip, so a generated clip can match a generated hero's style).
#
# --modality audio (provider elevenlabs): --kind music (default) | sfx | tts.
# tts needs --voice <voice_id>; music/sfx take an optional --duration in seconds.
# Produces assets/<sha8>.mp3. (Transcription is a separate verb: `maude design
# transcribe`, which writes SRT/VTT.)
#
# --modality video (provider gemini / Veo 3.1): ASYNC — the clip takes ~1–10 min;
# the poll timeout defaults to 600s for video (180s otherwise). Produces
# assets/<sha8>.mp4 + a provenance assets/<sha8>.footage.json stub so the clip is
# reel-ready (see /design:reel Step 1.5).
#
# The key is NEVER passed here — it lives server-side. Add it in Settings
# (⌘,) or drop it into ~/.config/maude/keys.json (mode 0600).
#
# Requires a running dev server (caller runs `maude design server-up` first);
# reads the port from <designRoot>/_server.json.
#
# Stdout (last line): the produced asset path `/assets/<sha8>.<ext>` (for $(...)).
# Stderr: progress / diagnostics.
# Exit:   0 ok / 1 server problem / 2 bad args / 3 generation failed.

set -euo pipefail

PROMPT="" PROVIDER="gemini" MODEL="" MODALITY="image" ASPECT="" SOURCE="" REPO="" TIMEOUT="" TAKE=""
# Audio params (Phase 2) — kind = music|sfx|tts; voice = an ElevenLabs voice_id
# (required for tts); duration = seconds (music/sfx length).
KIND="" VOICE="" DURATION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prompt)   PROMPT="$2"; shift 2 ;;
    --provider) PROVIDER="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --modality) MODALITY="$2"; shift 2 ;;
    --aspect)   ASPECT="$2"; shift 2 ;;
    --source)   SOURCE="$2"; shift 2 ;;
    --kind)     KIND="$2"; shift 2 ;;
    --voice)    VOICE="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --root)     REPO="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    --take)     TAKE="$2"; shift 2 ;;
    --help|-h)  sed -n '2,49p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "generate.sh: unknown arg '$1'" >&2; exit 2 ;;
  esac
done

# generate.sh produces MEDIA (image / audio) from a prompt. Transcription is a
# different shape (audio → captions) reached via `maude design transcribe`, which
# writes SRT/VTT files — not this verb, whose contract is "print the produced
# asset path".
case "$TAKE" in
  ""|next|prev) ;;
  *) echo "generate.sh: --take is next or prev" >&2; exit 2 ;;
esac
[ -n "$PROMPT" ] || [ -n "$TAKE" ] || { echo "generate.sh: --prompt is required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "generate.sh: jq is required" >&2; exit 1; }

# Async video (Veo) takes minutes — default the poll window wider than the
# seconds-fast image/audio calls unless the caller pinned --timeout explicitly.
if [ -z "$TIMEOUT" ]; then
  if [ "$MODALITY" = "video" ]; then TIMEOUT="600"; else TIMEOUT="180"; fi
fi

if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
DESIGN_ROOT="$REPO/.design"
[ -d "$DESIGN_ROOT" ] || { echo "generate.sh: no .design/ under $REPO" >&2; exit 1; }

STATE="$DESIGN_ROOT/_server.json"
[ -f "$STATE" ] || { echo "generate.sh: no _server.json (start the dev server first)" >&2; exit 1; }
PORT=$(jq -r '.port // empty' "$STATE" 2>/dev/null)
[ -n "$PORT" ] || { echo "generate.sh: could not read port from $STATE" >&2; exit 1; }

# ── --take: ← → between a generated picture's takes, on the studio's selection ──
if [ -n "$TAKE" ]; then
  ACTIVE_FILE="$DESIGN_ROOT/_active.json"
  [ -f "$ACTIVE_FILE" ] || { echo "generate.sh: nothing is selected in the studio (no _active.json)" >&2; exit 2; }
  CANVAS=$(jq -r '.active // empty' "$ACTIVE_FILE")
  SEL=$(jq -c '.selected // empty | if type == "array" then (if length == 1 then .[0] else empty end) else . end' "$ACTIVE_FILE")
  [ -n "$CANVAS" ] && [ -n "$SEL" ] || { echo "generate.sh: select one generated picture in the studio first" >&2; exit 2; }
  ASSET=$(printf '%s' "$SEL" | jq -r '[.photoAsset, .attrs.src, .html] | map(select(type == "string")) | join(" ")' \
    | grep -oE 'assets/[0-9a-f]{8}\.[A-Za-z0-9]{1,8}' | head -1 || true)
  REF=$(printf '%s' "$SEL" | jq -c 'if (.refs | type) == "array" and (.refs | length) > 0 then .refs[0]
    elif .id and .artboardId then ({ artboard: .artboardId, element: .id } + (if (.index // 0) > 0 then { occurrence: .index } else {} end))
    else empty end')
  [ -n "$ASSET" ] && [ -n "$REF" ] || { echo "generate.sh: the selection is not a picture" >&2; exit 2; }
  OF=$(curl -s -G "http://127.0.0.1:$PORT/_api/generate-takes/of" --data-urlencode "asset=$ASSET" --data-urlencode "canvas=$CANVAS")
  NEXT=$(printf '%s' "$OF" | jq -r --arg a "$ASSET" --arg dir "$TAKE" '
    (.takes // []) as $t | ($t | index($a)) as $i
    | if $i == null or ($t | length) < 2 then empty
      else $t[(($i + (if $dir == "next" then 1 else -1 end)) + ($t | length)) % ($t | length)] end' 2>/dev/null || true)
  [ -n "$NEXT" ] || { echo "generate.sh: that picture has no other takes" >&2; exit 3; }
  BODY=$(jq -n --arg file "$CANVAS" --argjson ref "$REF" --arg asset "$NEXT" \
    '{ file: $file, op: "image.replace", targets: [$ref], params: { asset: $asset } }')
  RESP=$(curl -s -X POST -H 'Content-Type: application/json' -d "$BODY" "http://127.0.0.1:$PORT/_api/edit-op")
  if [ "$(printf '%s' "$RESP" | jq -r '.ok // false' 2>/dev/null)" != "true" ]; then
    echo "generate.sh: not changed: $RESP" >&2
    exit 3
  fi
  printf '%s\n' "$NEXT"
  exit 0
fi

BASE="http://127.0.0.1:$PORT/_api/generate-jobs"

# Normalize a --source to the `assets/<sha8>.<ext>` form the route validates
# (strip a leading slash the canvas-relative writers emit).
SOURCE="${SOURCE#/}"

# Build the audio params object (only the set keys) — audioKind / voice_id /
# durationSeconds are opaque to the spine; each adapter validates its own subset.
PARAMS=$(jq -n --arg kind "$KIND" --arg voice "$VOICE" --arg dur "$DURATION" '
  {}
  + (if $kind  != "" then { audioKind: $kind }               else {} end)
  + (if $voice != "" then { voice_id: $voice }               else {} end)
  + (if $dur   != "" then { durationSeconds: ($dur|tonumber) } else {} end)')

# Build the request body — jq handles all prompt escaping. Omit empty optionals.
BODY=$(jq -n \
  --arg modality "$MODALITY" --arg provider "$PROVIDER" --arg model "$MODEL" \
  --arg prompt "$PROMPT" --arg aspect "$ASPECT" --arg source "$SOURCE" \
  --argjson params "$PARAMS" '
  { modality: $modality, provider: $provider }
  + (if $prompt != "" then { prompt: $prompt }      else {} end)
  + (if $model  != "" then { model: $model }        else {} end)
  + (if $aspect != "" then { aspectRatio: $aspect } else {} end)
  + (if $source != "" then { sourceAsset: $source } else {} end)
  + (if ($params|length) > 0 then { params: $params } else {} end)')

echo "generate.sh: submitting to $PROVIDER ($MODALITY)…" >&2
RESP=$(curl -s -X POST -H 'Content-Type: application/json' -d "$BODY" "$BASE")
JOB_ID=$(printf '%s' "$RESP" | jq -r '.jobId // empty' 2>/dev/null || echo "")
if [ -z "$JOB_ID" ]; then
  echo "generate.sh: enqueue rejected: $RESP" >&2
  exit 3
fi
echo "generate.sh: job $JOB_ID queued — polling…" >&2

# Poll the job list until this job is done/failed, or the timeout elapses.
DEADLINE=$(( $(date +%s) + TIMEOUT ))
while :; do
  JOBS=$(curl -s "$BASE" 2>/dev/null || echo '{}')
  JOB=$(printf '%s' "$JOBS" | jq -c --arg id "$JOB_ID" '.jobs[]? | select(.id == $id)' 2>/dev/null || echo "")
  STATUS=$(printf '%s' "$JOB" | jq -r '.status // empty' 2>/dev/null || echo "")
  case "$STATUS" in
    done)
      ASSET=$(printf '%s' "$JOB" | jq -r '.assets[0] // empty' 2>/dev/null || echo "")
      [ -n "$ASSET" ] || { echo "generate.sh: job done but produced no asset" >&2; exit 3; }
      # Normalize to the leading-slash canvas-relative form writers use.
      printf '/%s\n' "${ASSET#/}"
      exit 0 ;;
    failed)
      ERR=$(printf '%s' "$JOB" | jq -r '.error // "unknown error"' 2>/dev/null || echo "unknown")
      echo "generate.sh: generation failed: $ERR" >&2
      exit 3 ;;
  esac
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "generate.sh: timed out after ${TIMEOUT}s (job still $STATUS)" >&2
    exit 3
  fi
  sleep 2
done
