# _ab-headless.sh — SOURCED (never run) by the helpers that start agent-browser for a capture: screenshot.sh,
# canvas-rects.sh. p8-e2e-fix-r11 (decision maude/v2-p8-e2e-fix-r11-rects-own-headless-session).
#
# Sourcing it sets the daemon's idle limit: an agent-browser session is a DAEMON that outlives the helper, so one
# left behind by a helper that was killed mid-run (a timeout, the app quitting, a harness reap) shuts itself and its
# browser down after AGENT_BROWSER_IDLE_TIMEOUT_MS without a command, instead of keeping a canvas page open as a
# collab peer. It must outlast the longest pause between two calls of one run (canvas-rects polls once a second,
# screenshot.sh's longest wait is 2 s). A caller's value is kept.
#
#   ab_headless_browser   when ENGINE is agent-browser and the caller set no AGENT_BROWSER_EXECUTABLE_PATH: point
#                         agent-browser at a headless Chromium (chrome-headless-shell) rather than its own Chrome
#                         for Testing. On a fresh desktop machine there is no system Chrome, so the desktop bundle
#                         (it sets MAUDE_DEV_SERVER_ROOT, sidecar.rs) may provision one once; the web/CLI path only
#                         resolves an EXISTING browser (--no-download, never a surprise ~94 MB fetch) and otherwise
#                         keeps agent-browser's own default. DDR-144.
#
# Session names are each helper's own business (screenshot.sh keeps the shared one for canvas modes; canvas-rects.sh
# takes one per run), so they stay in the helper.

: "${AGENT_BROWSER_IDLE_TIMEOUT_MS:=60000}"
export AGENT_BROWSER_IDLE_TIMEOUT_MS

ab_headless_browser() {
  [ "${ENGINE:-}" = "agent-browser" ] || return 0
  [ -z "${AGENT_BROWSER_EXECUTABLE_PATH:-}" ] || return 0
  local dir flags path
  dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  flags="--quiet"
  [ -z "${MAUDE_DEV_SERVER_ROOT:-}" ] && flags="--quiet --no-download"
  path="$(bash "$dir/ensure-browser.sh" $flags 2>/dev/null)"
  if [ -n "$path" ] && [ -x "$path" ]; then
    export AGENT_BROWSER_EXECUTABLE_PATH="$path"
    echo "→ headless browser: $path" >&2
  fi
}
