# _desktop-locate.sh — SOURCED (never run) by the helpers that need a project's studio port: server-up.sh,
# screenshot.sh, smoke.sh, canvas-rects.sh, perf.sh, runtime-health.sh. #206 T6.3d (DDR-250).
#
# While the Maude desktop app runs it owns a checkout's server. `desktop_port` asks the app's registry first
# (cli/lib/desktop-locate.mjs: the port is used only after the server there answers a fresh attest challenge)
# and sets DESKTOP_PORT. Return codes (the helper's own):
#   0   DESKTOP_PORT is the app's attested server for this project — use it, never `_server.json`
#   10  not the app's (no app, or it has no running server here) — keep the project's own `_server.json` path
#   11  the app serves this project but its server did not answer the check — fail closed: do NOT fall back
#       to `_server.json` (a planted copy must never win while the app runs); the reason is on stderr
#   4   the app refused for a reason the person must see (stderr) — server-up only
#
#   desktop_port <repo> [--ensure capture|show] [--lease]
#   desktop_locate <mode> …        the raw call (restart, app-pid)
#
# <pkgRoot>/cli/lib/desktop-locate.mjs is three levels above this file in every layout (dev tree, npm install,
# the .app's Contents/Resources). No JS runtime, or no module → 10 (today's behaviour).

_DL_JS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)/cli/lib/desktop-locate.mjs"

# Fast path: no registry file → no app, without starting a JS runtime. Only a precheck — the module decides
# everything else (ownership, mode, the test-runner guard). The same default as registryPath() there.
_dl_registry_file() {
  case "${MAUDE_APP_REGISTRY_FILE:-}" in
    /*) printf '%s' "$MAUDE_APP_REGISTRY_FILE"; return ;;
  esac
  case "$(uname -s 2>/dev/null)" in
    Darwin) printf '%s' "$HOME/Library/Application Support/com.maude.app/servers.json" ;;
    *)
      local data="${XDG_DATA_HOME:-}"
      case "$data" in /*) : ;; *) data="$HOME/.local/share" ;; esac
      printf '%s' "$data/com.maude.app/servers.json"
      ;;
  esac
}

desktop_locate() {
  [ -f "$_DL_JS" ] || return 10
  [ -f "$(_dl_registry_file)" ] || return 10
  if command -v node >/dev/null 2>&1; then
    node "$_DL_JS" "$@"
  elif command -v bun >/dev/null 2>&1; then
    bun "$_DL_JS" "$@"
  else
    return 10
  fi
}

desktop_port() {
  local repo="$1" out rc
  shift
  DESKTOP_PORT=""
  out=$(desktop_locate port --root "$repo" "$@")
  rc=$?
  if [ "$rc" = 0 ]; then
    if [[ "$out" =~ ^[0-9]{1,5}$ ]]; then
      DESKTOP_PORT="$out"
    elif [ -n "$out" ]; then
      return 10 # not a port: ignore it
    fi
  fi
  return "$rc"
}

# ---------------------------------------------------------------------------------------------------------
# sec-loopback-bearer §7.5–7.6 — a studio started by the app or from a terminal requires its API key from
# every caller on its main origin. These are the ONLY way a helper talks to that origin (a static test,
# cli/lib/helper-studio-key.test.mjs, fails on a bare `curl http://…:$PORT/_…` or `fetch` elsewhere).
#
#   studio_key <repo> <port>            sets STUDIO_KEY (empty: the server needs no key it told us about);
#                                       returns 11 when the app serves the project but did not attest
#   studio_curl <repo> <port> <curl args…>   curl with the key as a header, handed to curl through a
#                                       config on stdin — never argv or the environment (`ps` shows both)
#   studio_launch_url <repo> <port>     prints a one-time opening URL (`/?maude-launch=…`) for a browser
#
# The key is cached per (repo, port) in an UNEXPORTED shell variable, so a polling loop asks once and no
# child process inherits it. A request whose body is on stdin cannot use studio_curl.

_STUDIO_KEY_FOR=""
STUDIO_KEY=""

_dl_node() {
  [ -f "$_DL_JS" ] || return 10
  if command -v node >/dev/null 2>&1; then
    node "$_DL_JS" "$@"
  elif command -v bun >/dev/null 2>&1; then
    bun "$_DL_JS" "$@"
  else
    return 10
  fi
}

studio_key() {
  local repo="$1" port="$2" out rc
  if [ "$_STUDIO_KEY_FOR" = "$repo|$port" ]; then return 0; fi
  STUDIO_KEY=""
  out=$(_dl_node key --root "$repo" --port "$port" 2>/dev/null)
  rc=$?
  if [ "$rc" = 11 ]; then return 11; fi
  if [ "$rc" = 0 ] && [[ "$out" =~ ^[0-9a-fA-F]{64}$ ]]; then STUDIO_KEY="$out"; fi
  _STUDIO_KEY_FOR="$repo|$port"
  return 0
}

studio_curl() {
  local repo="$1" port="$2"
  shift 2
  # a subshell (`$(studio_curl …)`) cannot fill the caller's cache: call `studio_key` once first
  studio_key "$repo" "$port" || return 7
  if [ -n "$STUDIO_KEY" ]; then
    printf 'header = "x-maude-api-key: %s"\n' "$STUDIO_KEY" | curl --config - "$@"
  else
    curl "$@"
  fi
}

studio_launch_url() {
  local repo="$1" port="$2" out
  out=$(_dl_node launch-url --root "$repo" --port "$port" 2>/dev/null)
  if [[ "$out" =~ ^http://localhost:[0-9]{1,5}/ ]]; then
    printf '%s\n' "$out"
  else
    printf 'http://localhost:%s/\n' "$port"
  fi
}
