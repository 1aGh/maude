#!/usr/bin/env bash
# chat-open.sh — Phase 31 (DDR-123). Backs `/design:chat` (via `maude design
# chat-open`): asks the running dev-server to surface the native ACP chat
# sidepanel by POSTing /_api/acp/focus. The server emits a bus event the shell
# (app.jsx, native-only) turns into "open the AI chat panel".
#
# Reads:  $DESIGN_ROOT/_server.json  (port the running server wrote)
# Usage:  chat-open.sh [--root <repo>]
# Exits:  0 on success, 1 if no live server / focus request failed.
set -euo pipefail

REPO="${CLAUDE_PROJECT_DIR:-$(pwd)}"
while [ $# -gt 0 ]; do
  case "$1" in
    --root) REPO="$2"; shift 2 ;;
    *) shift ;;
  esac
done

DESIGN_ROOT="$REPO/.design"
STATE="$DESIGN_ROOT/_server.json"

if [ ! -f "$STATE" ]; then
  echo "chat-open: no running dev server ($STATE missing). Open Maude first." >&2
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  PORT="$(jq -r '.port // empty' "$STATE" 2>/dev/null)"
else
  PORT="$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" 2>/dev/null | head -n1)"
fi

if [ -z "${PORT:-}" ]; then
  echo "chat-open: could not read the server port from $STATE." >&2
  exit 1
fi

if curl -fsS -X POST "http://127.0.0.1:${PORT}/_api/acp/focus" >/dev/null 2>&1; then
  echo "→ opened the AI chat panel in Maude (port ${PORT})."
else
  echo "chat-open: focus request to the dev server failed (port ${PORT})." >&2
  exit 1
fi
