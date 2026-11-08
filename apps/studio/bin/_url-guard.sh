# _url-guard.sh — sourced by the browser helpers (V2-8.9 B2). `maude_url_guard [--launch-ok] <url>`
# returns 0 when a browser may open <url> (http(s) to this Mac only, and never a one-time opening link
# unless the helper passes --launch-ok for a link it minted itself — the rule lives in _url-guard.mjs)
# and prints the refusal and returns 2 otherwise. Node when present, else bun (the packaged app stages a
# `bun` shim for every helper, DDR-177); neither → refused, never skipped.
#
# `maude_redact <text>` — the one redaction every helper log line goes through (sec-loopback-bearer
# §7.5, re-check E): `maude-launch=` and `fc=` values never reach stderr, which the AI chat reads.
maude_url_guard() {
  local guard
  guard="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_url-guard.mjs"
  if command -v node >/dev/null 2>&1; then
    node "$guard" "$@" || return 2
  elif command -v bun >/dev/null 2>&1; then
    bun run "$guard" "$@" || return 2
  else
    echo "maude: refusing to open that URL: node (or bun) is needed to check it." >&2
    return 2
  fi
}

# `maude_take_link_file <path>` — prints the link the server left for this helper and removes the file;
# refuses (2) any path outside the server's private link folder without reading or removing it.
maude_take_link_file() {
  local guard
  guard="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_url-guard.mjs"
  if command -v node >/dev/null 2>&1; then
    node "$guard" --take-link-file "$1" || return 2
  elif command -v bun >/dev/null 2>&1; then
    bun run "$guard" --take-link-file "$1" || return 2
  else
    return 2
  fi
}

maude_redact() {
  printf '%s' "$*" | sed -E "s/(maude-launch|fc)=[^&#[:space:]\"']*/\\1=…/g"
}
