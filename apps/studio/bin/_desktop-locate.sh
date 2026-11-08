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
