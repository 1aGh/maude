#!/usr/bin/env bash
# server-up.sh — ensure the design dev server is running for the given repo.
# Canonical recipe (was inline in `edit.md` step 2, `new.md` step 2, etc.).
#
# Usage:
#   server-up.sh [--root <repo>] [--timeout 10] [--allow-legacy]
#
# Reads / writes:
#   $DESIGN_ROOT/_server.json   (PID + port the running server wrote)
#   $DESIGN_ROOT/_server.log    (stdout/stderr of the spawned server)
#
# Runtime selection (DDR-020 / DDR-009 / DDR-084), in priority order:
#   - --allow-legacy: opt-in node + server.mjs (debug only; no TSX pipeline, no HMR).
#   - compiled platform binary: the PRODUCTION runtime — embeds yjs + every dep, so
#     it boots on a global @1agh/maude install where `bun server.ts` from source
#     cannot. Path comes from MAUDE_DEV_SERVER_BIN (set by `maude design <verb>`) or
#     the postinstall side-channel <pkgRoot>/cli/.platform-binary-path.
#   - bun + server.ts: dev tree / fallback. MAUDE_FORCE_SOURCE=1 forces this.
#
# Output: prints the port on stdout. Diagnostic lines go to stderr.
# Exit:   0 = server ready / 1 = start timeout or missing runtime / 2 = bad args /
#         3 = dev-server runtime deps missing (yjs/y-protocols/lib0 — see preflight).

REPO=""
TIMEOUT=10
ALLOW_LEGACY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --root)    REPO="$2"; shift 2 ;;
    --timeout) TIMEOUT="$2"; shift 2 ;;
    --allow-legacy) ALLOW_LEGACY=1; shift ;;
    --help|-h)
      sed -n '2,21p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "server-up.sh: unknown arg '$1' (try --help)" >&2
      exit 2
      ;;
  esac
done

# Resolve repo root.
if [ -z "$REPO" ]; then
  REPO="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi

# Resolve plugin root + pick a server runtime.
#   --allow-legacy → node + server.mjs (debug-only — no TSX pipeline, no HMR).
#   compiled platform binary → the PRODUCTION runtime (DDR-009/DDR-084). It embeds
#     yjs + every dev-server dep, so it boots on a global `@1agh/maude` install
#     where `bun server.ts` from source CANNOT (the deps live in a nested
#     package.json the npm tarball excludes — the historic yjs-at-boot crash).
#     `maude design <verb>` resolves it and passes MAUDE_DEV_SERVER_BIN; a direct
#     `bash server-up.sh` falls back to the postinstall side-channel.
#   bun + server.ts → dev tree / fallback (DDR-020 made bun authoritative for source).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# PLUGIN_ROOT is a 2-levels-under-pkgRoot anchor: plugins/design when `maude
# design <verb>` sets CLAUDE_PLUGIN_ROOT, else apps/studio ($SCRIPT_DIR/.. — the
# studio root, also 2-deep) for a direct `bash server-up.sh`. Both keep
# `$PLUGIN_ROOT/../../cli` = <pkgRoot>/cli. The dev-server tree itself is always
# $SCRIPT_DIR/.. (apps/studio) — DDR-095 moved it out of plugins/design.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
SERVER_TS="$PLUGIN_ROOT/dev-server/server.ts"
SERVER_MJS="$PLUGIN_ROOT/dev-server/server.mjs"
if [ ! -f "$SERVER_TS" ]; then SERVER_TS="$SCRIPT_DIR/../server.ts"; fi
if [ ! -f "$SERVER_MJS" ]; then SERVER_MJS="$SCRIPT_DIR/../server.mjs"; fi

# Resolve the compiled binary: env (set by `maude design <verb>`) wins; else the
# postinstall side-channel at <pkgRoot>/cli/.platform-binary-path (covers a direct
# `bash server-up.sh` on a production install). MAUDE_FORCE_SOURCE=1 forces source.
SERVER_BIN="${MAUDE_DEV_SERVER_BIN:-}"
if [ -z "$SERVER_BIN" ] && [ "${MAUDE_FORCE_SOURCE:-0}" != "1" ]; then
  # PLUGIN_ROOT is 2-deep under pkgRoot (plugins/design or apps/studio), so the
  # side-channel is ../../cli either way.
  # `head -n1` (parity with the Node readers' `.trim()`) tolerates a trailing newline.
  SC="$PLUGIN_ROOT/../../cli/.platform-binary-path"
  if [ -f "$SC" ]; then
    CAND="$(head -n1 "$SC" 2>/dev/null)"
    [ -n "$CAND" ] && [ -x "$CAND" ] && SERVER_BIN="$CAND"
  fi
fi
# Structural allowlist (DDR-084 hardening): only spawn a path that LOOKS like the
# compiled platform binary — basename `maude`/`maude.exe` inside a `maude-<slug>/`
# dir. A poisoned side-channel file or an injected MAUDE_DEV_SERVER_BIN pointing
# elsewhere is ignored (fall back to source), so the env/file can only DENY the
# binary, never redirect the spawn to an arbitrary executable. Mirrors
# isPlausiblePlatformBinary() in cli/commands/design.mjs.
if [ -n "$SERVER_BIN" ]; then
  _sbase="$(basename "$SERVER_BIN")"
  _sparent="$(basename "$(dirname "$SERVER_BIN")")"
  case "$_sbase:$_sparent" in
    maude:maude-* | maude.exe:maude-*) : ;;
    *)
      echo "server-up.sh: ignoring dev-server binary outside the expected maude-<slug>/ layout ($SERVER_BIN) — falling back to source" >&2
      SERVER_BIN=""
      ;;
  esac
fi

RUNTIME=""
RUNTIME_CMD=""
if [ $ALLOW_LEGACY -eq 1 ]; then
  if [ ! -f "$SERVER_MJS" ]; then
    echo "server-up.sh: --allow-legacy requested but server.mjs not found at $SERVER_MJS" >&2
    exit 1
  fi
  RUNTIME="node"
  RUNTIME_CMD="node $SERVER_MJS"
  echo "server-up.sh: WARNING — running legacy server.mjs (no TSX canvas pipeline, no HMR). DDR-020 sunsets this in Phase B." >&2
elif [ -n "$SERVER_BIN" ] && [ -x "$SERVER_BIN" ] && [ "${MAUDE_FORCE_SOURCE:-0}" != "1" ]; then
  RUNTIME="binary"
  RUNTIME_CMD="$SERVER_BIN"
  echo "server-up.sh: using compiled dev-server binary ($SERVER_BIN)" >&2
elif command -v bun >/dev/null 2>&1 && [ -f "$SERVER_TS" ]; then
  RUNTIME="bun"
  RUNTIME_CMD="bun $SERVER_TS"
else
  echo "server-up.sh: bun not on \$PATH — install via https://bun.sh/install" >&2
  echo "server-up.sh: DDR-020 made bun authoritative; the node fallback is opt-in via --allow-legacy (debug only)." >&2
  exit 1
fi

DESIGN_ROOT="$REPO/.design"
STATE="$DESIGN_ROOT/_server.json"

read_port() {
  if command -v jq >/dev/null 2>&1; then
    jq -r .port "$STATE" 2>/dev/null
  else
    # Best-effort grep — jq is in repo deps but be defensive.
    sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" 2>/dev/null | head -n1
  fi
}
read_pid() {
  if command -v jq >/dev/null 2>&1; then
    jq -r .pid "$STATE" 2>/dev/null
  else
    sed -nE 's/.*"pid"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$STATE" 2>/dev/null | head -n1
  fi
}

# Step 1 — check existing.
NEEDS_START=1
if [ -f "$STATE" ]; then
  PID=$(read_pid)
  PORT=$(read_port)
  # Sandboxed agents may reach Studio while kill -0 returns EPERM. Verify the
  # server's identity over HTTP instead of mistaking denied signalling for death.
  HEALTH=""
  if [ -n "$PORT" ]; then
    HEALTH=$(curl -fs --max-time 2 "http://localhost:$PORT/_health" 2>/dev/null || true)
  fi
  if [ -n "$PID" ] && [ -n "$PORT" ] \
     && printf '%s' "$HEALTH" | node -e '
       try {
         const fs = require("node:fs");
         const h = JSON.parse(fs.readFileSync(0, "utf8"));
         const root = fs.realpathSync(process.argv[2]);
         const id = require("node:crypto").createHash("sha256").update(root).digest("hex").slice(0, 12);
         process.exit(h.ok === true && h.app === "design" &&
           Number(h.pid) === Number(process.argv[1]) &&
           (h.rootId === undefined || h.rootId === id) ? 0 : 1);
       } catch { process.exit(1); }
     ' "$PID" "$REPO"; then
    echo "✓ server alive pid=$PID port=$PORT" >&2
    echo "$PORT"
    exit 0
  else
    echo "→ stale _server.json — clearing and respawning" >&2
    rm -f "$STATE"
  fi
fi

# Step 1.5 — dependency preflight (source `bun server.ts` path ONLY; runs on cold
# start). The compiled binary embeds its deps, so this is skipped when RUNTIME=binary
# — it only guards the source fallback. The dev-server's runtime deps live in a
# NESTED package.json (apps/studio/) that a global `@1agh/maude` npm
# install or a fresh `git worktree` does NOT populate; a missing `yjs` (imported at
# boot by sync/index.ts) crashes `bun server.ts` AFTER spawn → without this guard we
# poll the full ${TIMEOUT}s and report a generic "start timeout", burying the cause
# in _server.log and silently degrading the mandatory visual-sanity gate. Fail loud
# NOW with a context-correct hint. No auto-install: boot-self-heal.ts (DDR-044)
# dropped that, and the durable production fix is booting the compiled binary
# (DDR-009/DDR-084), not a boot-time install. setup-ds Round-2 / DDR-083 + DDR-084.
if [ "$RUNTIME" = "bun" ]; then
  DEV_SERVER_DIR="$(cd "$(dirname "$SERVER_TS")" && pwd)"
  _resolve_dep() {
    # Mirror node/bun bare-specifier resolution: walk node_modules up to /.
    # Handles both the dev-server-local install and a workspace-hoisted one.
    local dep="$1" d="$DEV_SERVER_DIR"
    while [ -n "$d" ] && [ "$d" != "/" ]; do
      [ -e "$d/node_modules/$dep/package.json" ] && return 0
      d="$(dirname "$d")"
    done
    return 1
  }
  MISSING_DEPS=""
  for dep in yjs y-protocols lib0; do
    _resolve_dep "$dep" || MISSING_DEPS="$MISSING_DEPS $dep"
  done
  if [ -n "$MISSING_DEPS" ]; then
    {
      echo "✗ dev-server runtime deps not installed:$MISSING_DEPS"
      if [ -f "$DEV_SERVER_DIR/package.json" ]; then
        # A manifest is present (local dev tree / checkout) — install resolves it.
        echo "  → run: (cd \"$DEV_SERVER_DIR\" && bun install)   # or: pnpm install at the repo root"
      else
        # No manifest beside server.ts AND no compiled binary resolved → the
        # '@1agh/maude' install is incomplete. The platform binary (which embeds
        # these deps) is the production runtime — reinstall to get it.
        echo "  (no dev-server package.json here and no compiled binary resolved — the"
        echo "   '@1agh/maude' install is incomplete; the platform binary embeds these deps)"
        echo "  → reinstall:  npm i -g @1agh/maude     (or: npm rebuild -g @1agh/maude)"
      fi
    } >&2
    exit 3
  fi
fi

# Step 2 — spawn.
mkdir -p "$DESIGN_ROOT"
echo "→ starting dev server: $RUNTIME_CMD --root $REPO" >&2
if [ "$RUNTIME" = "binary" ]; then
  nohup "$SERVER_BIN" --root "$REPO" > "$DESIGN_ROOT/_server.log" 2>&1 &
elif [ "$RUNTIME" = "bun" ]; then
  nohup bun "$SERVER_TS" --root "$REPO" > "$DESIGN_ROOT/_server.log" 2>&1 &
elif [ "$RUNTIME" = "node" ]; then
  nohup node "$SERVER_MJS" --root "$REPO" > "$DESIGN_ROOT/_server.log" 2>&1 &
fi
disown 2>/dev/null || true

# Step 3 — poll.
i=0
while [ $i -lt "$TIMEOUT" ]; do
  sleep 1
  i=$((i + 1))
  if [ -f "$STATE" ]; then
    PORT=$(read_port)
    if [ -n "$PORT" ] && curl -fs "http://localhost:$PORT/_health" >/dev/null 2>&1; then
      echo "✓ server started port=$PORT after ${i}s" >&2
      echo "$PORT"
      exit 0
    fi
  fi
done

echo "✗ server start timeout after ${TIMEOUT}s; check $DESIGN_ROOT/_server.log" >&2
exit 1
