# _url-guard.sh — sourced by the browser helpers (V2-8.9 B2). `maude_url_guard <url>` returns 0 when
# a browser may open <url> (http(s) to this Mac only — the rule lives in _url-guard.mjs) and prints
# the refusal and returns 2 otherwise. Node when present, else bun (the packaged app stages a `bun`
# shim for every helper, DDR-177); neither → refused, never skipped.
maude_url_guard() {
  local guard
  guard="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_url-guard.mjs"
  if command -v node >/dev/null 2>&1; then
    node "$guard" "$1" || return 2
  elif command -v bun >/dev/null 2>&1; then
    bun run "$guard" "$1" || return 2
  else
    echo "maude: refusing to open $1: node (or bun) is needed to check the URL." >&2
    return 2
  fi
}
