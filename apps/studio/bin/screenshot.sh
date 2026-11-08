#!/usr/bin/env bash
# screenshot.sh — canonical screenshot helper for the design plugin.
# Wraps agent-browser (preferred) or playwright (fallback). Replaces the
# inline `agent-browser navigate + screenshot` bash blocks previously
# duplicated across new.md / edit.md / setup-ds.md / screenshot.md / critics.
#
# Usage:
#   screenshot.sh [--port N | --url URL]
#                 [--screen <id> | --element <id> | --selector <css> | --full | --shell]
#                 [--all-screens] [--out <path>] [--out-dir <dir>]
#                 [--timeout 8] [--engine auto|agent-browser|playwright]
#                 [--theme <name>] [--root <repo>] [--canvas <rel|"">]
#                 [--frame <N>]
#
# Notes:
#   - Exactly one of --screen / --element / --selector / --full / --shell is
#     required (or --all-screens, which loops over every
#     [data-dc-screen]/[data-dc-slot]).
#   - --shell captures the STUDIO ITSELF, not a canvas: it points at the server
#     root (`/`) instead of `_canvas-shell.html`, so Maude's own chrome —
#     menubar, sidebar, status bar, toasts — is in frame. That chrome is where
#     most reported UI bugs actually live, and no canvas-scoped capture can ever
#     show it. Open tabs are `useState([])` in the client (never restored from
#     `_active.json` or localStorage), so a bare load lands on "Nothing open
#     yet"; shell mode therefore clicks the active canvas's file-tree row first
#     to bring the shot back in line with what the user is looking at.
#   - --canvas says WHICH canvas shell mode opens, overriding `_active.json`.
#     Passing it EMPTY means "open nothing" — that's not the same as omitting
#     it. `_active.json` is global and sticky (it outlives every closed tab and
#     any session can write it), so a caller that knows the truth — the studio
#     client knows its own open tab — must be able to say "nothing is open"
#     instead of having a stale path resolved behind its back.
#   - --out required for single-shot modes; --out-dir required for --all-screens.
#   - --frame <N> captures a video-comp at frame N (issue #128 §6): the viewport is sized to the
#     target element (a tall artboard is not clipped), the canvas's `window.__maude_seek__(N,
#     { strict: true })` bridge seeks, the shot waits for a paint, then captures. A canvas with no
#     seek bridge FAILS (exit 3) rather than shipping the frame-0 shot the flag exists to avoid.
#     Single-shot modes only (--screen/--element/--selector/--full); not with --shell/--all-screens.
#   - --theme <name> forces every `[data-theme]` element (DS artboard wrappers)
#     to that value BEFORE capture, via a DOM eval — does not touch the actual
#     canvas file or the running server's state. Used to capture a DS's
#     alternate theme deterministically for the dual-theme reality check
#     (/design:new step 9) instead of relying on whatever the canvas is pinned
#     to. No-op if the canvas has no `[data-theme]` elements.
#   - URL resolution: --url > --port + _active.json > _server.json + _active.json.
#   - Stdout: written PNG paths, one per line (composable in for-loops).
#   - Stderr: diagnostic, engine choice, timing.
#   - Exit: 0 success / 1 missing dependency / 2 bad args / 3 capture failed.

MODE=""
SEL=""
URL=""
PORT=""
OUT=""
OUT_DIR=""
TIMEOUT=8
ENGINE="auto"
ALL_SCREENS=0
ROOT=""
THEME=""
FRAME=""
FRAME_SET=0
ACTIVE=""
# Tri-state for --canvas: unset → resolve from _active.json (the CLI default);
# set to a path → open that; set to "" → open nothing. The empty case is
# load-bearing, so it can't collapse into "unset".
CANVAS_SET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --screen)   MODE="screen";   SEL="$2"; shift 2 ;;
    --element)  MODE="element";  SEL="$2"; shift 2 ;;
    --selector) MODE="selector"; SEL="$2"; shift 2 ;;
    --full)     MODE="full"; shift ;;
    --shell)    MODE="shell"; shift ;;
    --canvas)   CANVAS_SET=1; ACTIVE="$2"; shift 2 ;;
    --all-screens) ALL_SCREENS=1; shift ;;
    --url)      URL="$2"; shift 2 ;;
    # sec-loopback-bearer §7.4 — the URL from a 0600 file (a one-time opening link never rides argv);
    # read once and deleted
    --url-file) URL="$(head -n1 "$2" 2>/dev/null)"; rm -f "$2"; shift 2 ;;
    --port)     PORT="$2"; shift 2 ;;
    --out)      OUT="$2"; shift 2 ;;
    --out-dir)  OUT_DIR="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    --engine)   ENGINE="$2"; shift 2 ;;
    --theme)    THEME="$2"; shift 2 ;;
    --frame)    FRAME_SET=1; FRAME="${2:-}"; shift 2 ;;
    --root)     ROOT="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,27p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "screenshot.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

# ---------- arg validation ----------
# --theme ultimately traces back to config.json's designSystems[].themes[]
# (untrusted, same posture as prep.sh's MOODBOARD_VARIANTS). Callers (e.g.
# new.md step 9) build an --out-dir path from this value — reject anything
# outside a safe slug charset here too, at the shared sink, rather than
# trusting every caller to re-derive this guard.
if [ -n "$THEME" ]; then
  case "$THEME" in
    *[!A-Za-z0-9._-]*|"")
      echo "screenshot.sh: --theme '$THEME' contains unsafe characters (allowed: A-Za-z0-9._-)" >&2
      exit 2
      ;;
  esac
fi

if [ $FRAME_SET -eq 1 ]; then
  case "$FRAME" in
    ""|*[!0-9]*)
      echo "screenshot.sh: --frame needs a whole frame number (0, 1, 2, …), got '$FRAME'" >&2
      exit 2
      ;;
  esac
  if [ $ALL_SCREENS -eq 1 ] || [ "$MODE" = "shell" ]; then
    echo "screenshot.sh: --frame captures one artboard of a video-comp; it cannot combine with --all-screens or --shell" >&2
    exit 2
  fi
fi

if [ $ALL_SCREENS -eq 1 ]; then
  [ -z "$OUT_DIR" ] && { echo "screenshot.sh: --all-screens needs --out-dir" >&2; exit 2; }
else
  [ -z "$MODE" ]    && { echo "screenshot.sh: pick one of --full/--shell/--screen/--element/--selector or --all-screens" >&2; exit 2; }
  [ -z "$OUT" ]     && { echo "screenshot.sh: --out required for single-shot modes" >&2; exit 2; }
fi

# agent-browser ignores RELATIVE screenshot paths (it writes to its own
# ~/.agent-browser/tmp instead), which strands the PNG and trips the
# missing-file guard below. Canonicalize OUT / OUT_DIR to absolute up front so
# captures land where the caller asked.
if [ -n "$OUT" ]; then
  mkdir -p "$(dirname "$OUT")" 2>/dev/null || true
  OUT="$(cd "$(dirname "$OUT")" 2>/dev/null && pwd)/$(basename "$OUT")"
fi
if [ -n "$OUT_DIR" ]; then
  mkdir -p "$OUT_DIR" 2>/dev/null || true
  OUT_DIR="$(cd "$OUT_DIR" 2>/dev/null && pwd)"
fi

# TSX specimens cannot be opened via file:// — the browser would see raw JSX.
# They must go through the dev-server route (http://localhost:PORT/<rel>),
# which transpiles via _canvas-shell.html?canvas=<rel>. Phase 19 / DDR-044.
case "$URL" in
  file://*.tsx)
    echo "screenshot.sh: TSX specimens cannot be screenshot via file:// (the browser sees raw JSX)." >&2
    echo "  Use --port instead — the dev-server compiles TSX through _canvas-shell.html?canvas=<rel>." >&2
    echo "  Example: screenshot.sh --port 4399 --full --out shot.png  (set the active canvas in the browser first)" >&2
    exit 2
    ;;
esac

# ---------- url resolution ----------
if [ -z "$URL" ]; then
  REPO="${ROOT:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
  STATE="$REPO/.design/_server.json"
  ACTIVE_JSON="$REPO/.design/_active.json"
  # #206 T6.3d — the desktop app's attested server first; a planted _server.json never wins while the app
  # serves this project (11 = it does, but did not answer the check: stop).
  if [ -z "$PORT" ]; then
    . "$(dirname "$0")/_desktop-locate.sh"
    desktop_port "$REPO" --lease
    case $? in
      0) PORT="$DESKTOP_PORT" ;;
      11) exit 1 ;;
    esac
  fi
  if [ -z "$PORT" ] && [ -f "$STATE" ]; then
    if command -v jq >/dev/null 2>&1; then
      PORT=$(jq -r .port "$STATE" 2>/dev/null)
    else
      PORT=$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" | head -n1)
    fi
  fi
  [ -z "$PORT" ] && { echo "screenshot.sh: no --url/--port given and _server.json not found (run server-up.sh)" >&2; exit 1; }

  if [ $CANVAS_SET -eq 0 ] && [ -f "$ACTIVE_JSON" ] && command -v jq >/dev/null 2>&1; then
    ACTIVE=$(jq -r '.active // empty' "$ACTIVE_JSON" 2>/dev/null)
  fi

  # Shell mode targets the studio root, and an active canvas is a NICE-TO-HAVE
  # (it decides which file-tree row we click) rather than a precondition — a
  # chrome bug is worth capturing even with nothing open.
  if [ "$MODE" = "shell" ]; then
    # sec-loopback-bearer §7.4 — the studio page opens with a one-time launch token (a server that
    # needs no key: the plain URL). Canvas captures below go to the capture origin through the 307.
    . "$(dirname "$0")/_desktop-locate.sh"
    URL="$(studio_launch_url "$REPO" "$PORT")"
  else
    [ -z "$ACTIVE" ] && { echo "screenshot.sh: no active canvas in _active.json (open one in browser first)" >&2; exit 1; }

    # URL-encode spaces (rough); leave other chars alone.
    ACTIVE_ENC=$(printf '%s' "$ACTIVE" | sed 's/ /%20/g')
    # Canvases mount through the canvas shell. The bare `/<rel>` route 404s when
    # the canvas-origin sandbox is on (default since phase-9.1); only
    # `/_canvas-shell.html?canvas=<rel>` renders the canvas (valid in both
    # split-on and legacy same-origin modes).
    # sec-loopback-bearer §7.3 — asked with the key, so the capture gets its frame capability
    . "$(dirname "$0")/_desktop-locate.sh"
    URL="$(studio_capture_url "$REPO" "$PORT" "/_canvas-shell.html?canvas=${ACTIVE_ENC}")"
  fi
fi

# Shell mode still wants the active canvas even when the caller passed --url
# outright (the URL says WHERE to look; the active canvas says WHAT to open).
if [ "$MODE" = "shell" ] && [ $CANVAS_SET -eq 0 ] && [ -z "$ACTIVE" ]; then
  SHELL_REPO="${ROOT:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
  if [ -f "$SHELL_REPO/.design/_active.json" ] && command -v jq >/dev/null 2>&1; then
    ACTIVE=$(jq -r '.active // empty' "$SHELL_REPO/.design/_active.json" 2>/dev/null)
  fi
fi

# V2-8.9 B2 — whatever the URL came from (--url, --port, _server.json), only http(s) to this Mac:
# never file://, never another host (_url-guard.mjs). Checked before any browser starts.
. "$(dirname "$0")/_url-guard.sh" && maude_url_guard "$URL" || exit 2

# The file-tree row testid the client stamps (app.jsx `pathTestIdSlug`):
# designRoot dot-folder stripped, extension stripped, non-alphanumerics folded
# to single dashes, lowercased, dashes trimmed. Lowercasing happens BEFORE the
# extension strip so we don't need sed's non-portable `I` flag for `.TSX`.
# Output is [a-z0-9-] only, which is what makes it safe to splice into the JS
# selector string eval'd below.
shell_row_testid() {
  printf '%s' "$1" \
    | sed -E 's#^\.[^/]+/##' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/\.(tsx|html?)$//' \
    | sed -E 's/[^a-z0-9]+/-/g' \
    | sed -E 's/^-+//; s/-+$//'
}

# ---------- selector mapping ----------
case "$MODE" in
  screen)   CSS_SEL="[data-dc-screen=\"$SEL\"], [data-dc-slot=\"$SEL\"]" ;;
  element)  CSS_SEL="[data-dc-element=\"$SEL\"]" ;;
  selector) CSS_SEL="$SEL" ;;
  full|shell|"")  CSS_SEL="" ;;
esac

# ---------- engine resolution ----------
# Prefer the bundled agent-browser the desktop sidecar pins via MAUDE_AGENT_BROWSER
# (DDR-144 attacker-F4: an explicit single-binary pointer, NOT a PATH prepend that
# would let a same-user attacker shadow node/chrome in the app dir), else the one
# on PATH.
AB="${MAUDE_AGENT_BROWSER:-agent-browser}"

# agent-browser sessions are SHARED by name (default: "default"). Shell mode is
# fired automatically by the Report-a-Bug dialog, so on the shared session it
# would navigate whatever browser an agent has mid-task out from under it. Pin
# it to its own session; the canvas modes keep the shared SESSION NAME deliberately, so
# an agent's `/design:*` captures reuse the one name. On exit every capture parks its page and
# closes the session it STARTED (_ab-park.sh, which also waits for the daemon's socket to go so
# the next capture on the same name starts a fresh one); a session that was already running (the
# agent's own browsing) is parked on about:blank and left running (p8-fix-a F6).
if [ "$MODE" = "shell" ] && [ -z "$AGENT_BROWSER_SESSION" ]; then
  export AGENT_BROWSER_SESSION="maude-shell-shot"
fi
# V2-8.9 M1: AI may › Search the web off (MAUDE_NO_EGRESS=1) → this browser reaches loopback only.
. "$(dirname "$0")/_no-egress.sh"
# p8-e2e-fix-r10: on exit, a page this capture opened is parked on about:blank and its session closed.
. "$(dirname "$0")/_ab-park.sh"
# p8-e2e-fix-r11: a headless browser, and a daemon that shuts itself down when a killed capture leaves it idle.
. "$(dirname "$0")/_ab-headless.sh"
if [ "$ENGINE" = "auto" ]; then
  if command -v "$AB" >/dev/null 2>&1; then
    ENGINE="agent-browser"
  else
    ENGINE="playwright"
  fi
fi

# ---------- browser resolution for agent-browser (DDR-144 — bundled screenshots) ----------
# chrome-headless-shell, resolved (desktop: provisioned once) by _ab-headless.sh — canvas-rects.sh uses the same.
ab_headless_browser
# A log line never carries a one-time opening link or a frame capability (stderr reaches the AI chat).
shown_url() { printf '%s' "$1" | sed -E 's/(maude-launch|fc)=[^&]*/\1=…/g'; }
echo "→ screenshot engine: $ENGINE | url: $(shown_url "$URL")" >&2

# ---------- engine: agent-browser ----------
ab_screenshot() {
  local css="$1"
  local out="$2"
  if [ -n "$css" ]; then
    "$AB" screenshot "$css" "$out" >&2 || return 1
  else
    "$AB" screenshot --full "$out" >&2 || return 1
  fi
  # agent-browser sometimes reports success without writing — verify size.
  if [ ! -s "$out" ]; then
    echo "✗ agent-browser reported success but output file missing/empty: $out" >&2
    return 1
  fi
  return 0
}

# ---------- engine: playwright ----------
pw_screenshot() {
  local css="$1"
  local out="$2"
  local script_dir
  script_dir="$(cd "$(dirname "$0")" && pwd)"
  local pw_script="$script_dir/_screenshot-playwright.mjs"
  if [ ! -f "$pw_script" ]; then
    echo "✗ playwright fallback shim missing at $pw_script" >&2
    return 1
  fi
  echo "→ playwright engine; first invocation may install chromium (~150MB, one-off)" >&2
  local theme_args=()
  [ -n "$THEME" ] && theme_args=(--theme "$THEME")
  [ $FRAME_SET -eq 1 ] && theme_args+=(--frame "$FRAME")
  if [ -n "$css" ]; then
    npm exec --yes --package=playwright -- node "$pw_script" --url "$URL" --selector "$css" --out "$out" --timeout "$TIMEOUT" "${theme_args[@]}" >&2 || return 1
  else
    npm exec --yes --package=playwright -- node "$pw_script" --url "$URL" --out "$out" --timeout "$TIMEOUT" "${theme_args[@]}" >&2 || return 1
  fi
  [ -s "$out" ] || { echo "✗ playwright wrote no file: $out" >&2; return 1; }
  return 0
}

# ---------- shell mode: open the active canvas in the studio ----------
# The studio root always boots to "Nothing open yet" (tabs are `useState([])`,
# never rehydrated), so a bare shell shot would show chrome over an empty
# canvas area. Click the active canvas's file-tree row and wait for the canvas
# iframe to appear. Every leg is best-effort — chrome is the point of this mode,
# so a missing row or a slow mount degrades to "chrome, nothing open" rather
# than failing the capture.
# A reachable port is not a mounted app: the server can answer while the client
# bundle is still parsing, or React can fail to mount and leave an empty #root
# (the exact shape of the v0.51.1 blank-window bug). Wait for the studio's own
# file list before capturing, so a broken shell fails loud instead of shipping a
# blank PNG that looks like a real screenshot.
await_studio_shell() {
  [ "$ENGINE" = "agent-browser" ] || return 0
  local poll=0
  while [ $poll -lt "$TIMEOUT" ]; do
    local n
    n=$("$AB" eval "document.querySelectorAll('[data-testid^=\"canvas-row-\"]').length" 2>/dev/null | tr -d '[:space:]')
    case "$n" in
      ''|*[!0-9]*|0) ;;
      *) return 0 ;;
    esac
    sleep 1
    poll=$((poll + 1))
  done
  return 1
}

open_active_in_shell() {
  [ "$ENGINE" = "agent-browser" ] || return 0
  [ -n "$ACTIVE" ] || { echo "→ shell: no active canvas — capturing chrome as-is" >&2; return 0; }
  local slug
  slug=$(shell_row_testid "$ACTIVE")
  [ -n "$slug" ] || return 0
  # The file tree is React-rendered, so the row does not exist at load — poll
  # for it (a single probe 1 s after navigate reliably misses) and click the
  # moment it appears.
  local clicked=""
  local wait=0
  while [ $wait -lt "$TIMEOUT" ]; do
    clicked=$("$AB" eval "(function(){var r=document.querySelector('[data-testid=\"canvas-row-$slug\"]');if(!r)return 'miss';r.click();return 'hit'})()" 2>/dev/null | tr -d '[:space:]"')
    [ "$clicked" = "hit" ] && break
    sleep 1
    wait=$((wait + 1))
  done
  if [ "$clicked" != "hit" ]; then
    echo "→ shell: no file-tree row for '$slug' after ${TIMEOUT}s — capturing chrome as-is" >&2
    return 0
  fi
  # Wait for the canvas iframe to attach; it renders cross-origin, so the parent
  # can only observe the element, never its contents. A short settle follows so
  # the iframe has painted before we capture.
  local poll=0
  while [ $poll -lt "$TIMEOUT" ]; do
    sleep 1
    poll=$((poll + 1))
    local n
    n=$("$AB" eval "document.querySelectorAll('iframe').length" 2>/dev/null | tr -d '[:space:]')
    case "$n" in
      ''|*[!0-9]*|0) continue ;;
      *) sleep 2; echo "→ shell: opened '$ACTIVE'" >&2; return 0 ;;
    esac
  done
  echo "→ shell: canvas iframe never attached after ${TIMEOUT}s — capturing chrome as-is" >&2
}

# A string as a JS double-quoted literal (the selector may carry quotes: [data-dc-screen="x"]).
js_string() {
  local v="$1"
  v="${v//\\/\\\\}"
  v="${v//\"/\\\"}"
  printf '"%s"' "$v"
}

# ---------- --frame <N>: put a video-comp on frame N before the shot (issue #128 §6) ----------
# Without it a video artboard captures frame 0, which is usually black (media not decoded yet).
# Order matters: size the viewport to the target FIRST (the layout settles), seek SECOND, wait for
# paint THIRD, shoot last. Every failure here is fatal — a wrong frame looks like a valid shot.
frame_fail() {
  echo "✗ --frame $FRAME: $1" >&2
  rm -f "$OUT"
  exit 3
}

seek_frame() {
  [ $FRAME_SET -eq 1 ] || return 0
  [ "$ENGINE" = "agent-browser" ] || return 0
  # The bridge is installed by the first VideoComp to mount, a tick after the artboard exists.
  local poll=0 has=""
  while [ $poll -lt "$TIMEOUT" ]; do
    has=$("$AB" eval "typeof window.__maude_seek__ === 'function' ? 'yes' : 'no'" 2>/dev/null | tr -d '[:space:]"')
    [ "$has" = "yes" ] && break
    sleep 1
    poll=$((poll + 1))
  done
  [ "$has" = "yes" ] || frame_fail "this canvas has no window.__maude_seek__ bridge (is the artboard a video-comp? it mounts a VideoComp)"

  if [ -n "$CSS_SEL" ]; then
    local sel size w h
    sel=$(js_string "$CSS_SEL")
    size=$("$AB" eval "(function(){var e=document.querySelector($sel);if(!e)return 'miss';var r=e.getBoundingClientRect();return Math.ceil(r.width)+'x'+Math.ceil(r.height)})()" 2>/dev/null | tr -d '[:space:]"')
    case "$size" in
      [0-9]*x[0-9]*)
        w="${size%x*}"
        h="${size#*x}"
        [ "$w" -gt 8192 ] && w=8192
        [ "$h" -gt 8192 ] && h=8192
        if [ "$w" -gt 0 ] && [ "$h" -gt 0 ]; then
          "$AB" set viewport "$w" "$h" >&2 || frame_fail "could not size the viewport to ${w}x${h}"
          echo "→ viewport sized to the artboard: ${w}x${h}" >&2
        fi
        ;;
      *) echo "→ --frame: target element not measurable ('$size') — keeping the current viewport" >&2 ;;
    esac
  fi

  local seeked
  seeked=$("$AB" eval "window.__maude_seek__($FRAME, { strict: true }).then(function(){return 'seeked'})" 2>&1 | tr -d '[:space:]"')
  case "$seeked" in
    *seeked) ;;
    *) frame_fail "the seek did not land (${seeked:-no answer})" ;;
  esac
  # __maude_seek__ resolves after ITS paint; two more frames let a freshly decoded video frame reach the screen.
  "$AB" eval "new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r('painted')})})})" >/dev/null 2>&1 \
    || frame_fail "the page did not paint after the seek"
  sleep 0.3
  echo "→ seeked to frame $FRAME" >&2
}

navigate_once() {
  if [ "$ENGINE" = "agent-browser" ]; then
    # A failed navigation MUST propagate. agent-browser leaves the session on a
    # blank page and `screenshot` then happily writes a ~4 kB white PNG, so
    # ignoring this exit code turns "the server is down" into "here is your
    # screenshot" — which for the Report-a-Bug shell shot means a blank image
    # labelled "Maude window" lands in someone's bug report.
    if ! "$AB" open "$URL" >&2; then
      echo "✗ navigation failed: $(shown_url "$URL")" >&2
      return 1
    fi
    # Shell mode lands on the studio root, which has no DC mount to poll for —
    # the canvas arrives only after we click a row.
    if [ "$MODE" = "shell" ]; then
      if ! await_studio_shell; then
        echo "✗ the studio shell never mounted at $(shown_url "$URL")" >&2
        return 1
      fi
      open_active_in_shell
      apply_theme_override
      return 0
    fi
    # Wait for canvas to mount — Babel/React canvases take 2–4s to settle.
    # Poll for [data-dc-screen] or [data-dc-slot] up to $TIMEOUT seconds; fall
    # through to a fixed sleep when the page isn't a DC canvas.
    local poll=0
    local got=0
    while [ $poll -lt "$TIMEOUT" ]; do
      sleep 1
      poll=$((poll + 1))
      local raw
      raw=$("$AB" eval "document.querySelectorAll('[data-dc-screen],[data-dc-slot]').length" 2>/dev/null)
      # raw is a plain number on success — strip whitespace, validate.
      local has=$(printf '%s' "$raw" | tr -d '[:space:]')
      case "$has" in
        ''|*[!0-9]*) continue ;;
        0) continue ;;
        *) got=1; break ;;
      esac
    done
    if [ $got -eq 0 ]; then
      # Fallback: give static pages (specimens, non-canvas HTMLs) a chance.
      echo "→ no DC mount detected after ${TIMEOUT}s — proceeding (may be a non-canvas page)" >&2
      sleep 1
    fi
    apply_theme_override
    seek_frame
  fi
}

# ---------- --theme override (dual-theme reality check) ----------
# Forces every element carrying a `data-theme` attribute (DS artboard theme
# wrappers) to $THEME, so the caller can deterministically capture a DS's
# alternate theme instead of whatever the canvas happens to be pinned to.
# agent-browser only — the playwright path applies it inside
# _screenshot-playwright.mjs (passed via --theme) since that shim owns its own
# page.evaluate. No-op when --theme wasn't passed or no [data-theme] elements
# exist (e.g. a single-theme DS or a non-canvas page).
apply_theme_override() {
  [ -z "$THEME" ] && return 0
  [ "$ENGINE" = "agent-browser" ] || return 0
  # THEME ultimately traces back to config.json's designSystems[].themes[]
  # array — treated as untrusted input elsewhere in this codebase (see
  # prep.sh's MOODBOARD_VARIANTS clamp). JSON-encode it via jq so it lands as
  # a properly-escaped JS string literal in the eval'd expression below,
  # instead of naively splicing the raw value into a JS string (which a
  # crafted config value could break out of).
  local theme_json
  theme_json=$(jq -Rn --arg t "$THEME" '$t' 2>/dev/null) || return 0
  local n
  n=$("$AB" eval "(function(t){var els=document.querySelectorAll('[data-theme]');els.forEach(function(el){el.setAttribute('data-theme',t)});return els.length})($theme_json)" 2>/dev/null)
  echo "→ theme override: forced data-theme=\"$THEME\" on $(printf '%s' "$n" | tr -d '[:space:]') element(s)" >&2
}

capture() {
  local css="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
  if [ "$ENGINE" = "agent-browser" ]; then
    ab_screenshot "$css" "$out"
  else
    pw_screenshot "$css" "$out"
  fi
}

# ---------- port-bounce recovery (P2.1 / DDR-094) ----------
# The dev server can respawn on a DIFFERENT port (the prior port got taken, a
# Tailscale/mDNS hiccup bounced it, a stale _server.json was cleared). A capture
# launched against the OLD port then fails with ERR_CONNECTION_REFUSED. The
# running server keeps _server.json current, so on any capture failure we re-read
# the LIVE port and, if it changed, rewrite $URL and retry once.
RELIVE_REPO="${ROOT:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
RELIVE_STATE="$RELIVE_REPO/.design/_server.json"
RELIVED=0

read_state_port() {
  # #206 T6.3d — the app's attested server first (a tab can be respawned on another port)
  . "$(dirname "$0")/_desktop-locate.sh"
  desktop_port "$RELIVE_REPO"
  case $? in
    0) [ -n "$DESKTOP_PORT" ] && { printf '%s\n' "$DESKTOP_PORT"; return 0; } ;;
    11) return 1 ;;
  esac
  [ -f "$RELIVE_STATE" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    jq -r .port "$RELIVE_STATE" 2>/dev/null
  else
    sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$RELIVE_STATE" 2>/dev/null | head -n1
  fi
}

# Re-read the live port; if it differs from the one in $URL, rewrite $URL and
# return 0 (a retry is warranted). Returns 1 when nothing changed (don't retry).
# Only fires ONCE per run (RELIVED guard) so a genuinely-down server still fails.
relive_url() {
  [ "$RELIVED" -eq 0 ] || return 1
  local cur new
  cur=$(printf '%s' "$URL" | sed -nE 's#https?://[^:/]+:([0-9]+).*#\1#p')
  new=$(read_state_port)
  [ -n "$new" ] || return 1
  if [ -n "$cur" ] && [ "$cur" != "$new" ]; then
    if [ "$MODE" = "shell" ]; then
      # a launch token is for the server that minted it: ask the new one for its own
      URL="$(studio_launch_url "$RELIVE_REPO" "$new")"
    else
      URL=$(printf '%s' "$URL" | sed -E "s#(://[^:/]+:)[0-9]+#\1${new}#")
    fi
    RELIVED=1
    echo "→ dev-server bounced ports ($cur → $new); re-reading _server.json and retrying at $(shown_url "$URL")" >&2
    return 0
  fi
  return 1
}

# capture(), but on failure re-read the live port and retry once if it bounced.
capture_resilient() {
  local css="$1"
  local out="$2"
  capture "$css" "$out" && return 0
  if relive_url; then
    navigate_once
    capture "$css" "$out" && return 0
  fi
  return 1
}

# ---------- Stop-gate evidence (V2-1.11 §5.4 step 2) ----------
# One line per successful capture of a canvas → the design hooks' state, outside the project (_record-shot.sh).
# The design plugin's Stop hook asks for a capture of every artboard the AI changed. Best effort.
record_shot() {
  [ "$MODE" = "shell" ] && return 0
  [ -n "$ACTIVE" ] || return 0
  local repo="${REPO:-${ROOT:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}}"
  bash "$(cd "$(dirname "$0")" && pwd)/_record-shot.sh" --root "$repo" --canvas "$ACTIVE" "$@" >/dev/null 2>&1 || true
}

# A capture never outlives itself as a collab peer (_ab-park.sh): every path below opens the page.
[ "$ENGINE" = "agent-browser" ] && ab_park_arm

# ---------- --all-screens loop ----------
if [ $ALL_SCREENS -eq 1 ]; then
  mkdir -p "$OUT_DIR"
  navigate_once
  IDS=""
  if [ "$ENGINE" = "agent-browser" ]; then
    # agent-browser wraps string results in quotes and escapes newlines as
    # literal `\n`; comma-join + tr is simpler than parsing JSON for IDs.
    raw=$("$AB" eval \
      "Array.from(document.querySelectorAll('[data-dc-screen],[data-dc-slot]')).map(e => e.getAttribute('data-dc-screen') || e.getAttribute('data-dc-slot')).filter(Boolean).join(',')" \
      2>/dev/null)
    # Strip surrounding quotes, then split on comma.
    IDS=$(printf '%s' "$raw" | sed 's/^"//; s/"$//' | tr ',' '\n')
  fi
  # No screens enumerated may mean the page never loaded (port bounce) — try a
  # live-port re-read + one re-navigate before giving up.
  if [ -z "$IDS" ] && relive_url; then
    navigate_once
    if [ "$ENGINE" = "agent-browser" ]; then
      raw=$("$AB" eval \
        "Array.from(document.querySelectorAll('[data-dc-screen],[data-dc-slot]')).map(e => e.getAttribute('data-dc-screen') || e.getAttribute('data-dc-slot')).filter(Boolean).join(',')" \
        2>/dev/null)
      IDS=$(printf '%s' "$raw" | sed 's/^"//; s/"$//' | tr ',' '\n')
    fi
  fi
  if [ -z "$IDS" ]; then
    echo "✗ no [data-dc-screen]/[data-dc-slot] elements found (or eval unavailable on this engine)" >&2
    exit 3
  fi
  N=0
  FAILED=0
  for ID in $IDS; do
    N=$((N + 1))
    NN=$(printf "%03d" "$N")
    OUT_FILE="$OUT_DIR/${NN}-screen-${ID}.png"
    if [ "$ENGINE" = "agent-browser" ]; then
      "$AB" eval "document.querySelector('[data-dc-screen=\"$ID\"], [data-dc-slot=\"$ID\"]').scrollIntoView({block:'center'})" >/dev/null 2>&1
      sleep 0.6
    fi
    if capture_resilient "[data-dc-screen=\"$ID\"], [data-dc-slot=\"$ID\"]" "$OUT_FILE"; then
      echo "$OUT_FILE"
      record_shot --artboard "$ID"
    else
      echo "✗ failed: $ID" >&2
      FAILED=$((FAILED + 1))
    fi
  done
  [ $FAILED -gt 0 ] && exit 3
  record_shot --all
  exit 0
fi

# ---------- single-shot ----------
# A failed navigation is exactly the port-bounce case (DDR-094), so give
# relive_url its one shot before giving up rather than capturing a blank page.
if ! navigate_once; then
  if ! relive_url || ! navigate_once; then
    echo "✗ could not load $(shown_url "$URL") — no screenshot written" >&2
    rm -f "$OUT"
    exit 3
  fi
fi
if capture_resilient "$CSS_SEL" "$OUT"; then
  echo "$OUT"
  case "$MODE" in
    full) record_shot --all ;;
    screen) record_shot --artboard "$SEL" ;;
  esac
  exit 0
fi
exit 3
