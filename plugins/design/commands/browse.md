---
name: browse
category: daily
description: "Start the Maude studio for this project and open it."
argument-hint: "[--port <n>]"
---

# /design:browse — local design canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Starts the Maude Studio server through the installed `maude` CLI. It scans the project's design root (`<designRoot>` from `.design/config.json`, default `.design/`) and serves the studio in the browser:

- **Canvases panel** — the project's canvases and folders, with the design system pinned at the top.
- **The canvas** — an infinite surface that fills the window. **Edit** changes the design; **Preview** uses the annotation tools (Hand · Sticky · Comment · Marker · Arrow · Shape · Text · Stickers · Section).
- **Selecting** — in Edit, click an object to select it; Esc or a click on empty canvas clears it. The selection is mirrored to `<designRoot>/_active.json`, so `/design:edit` can scope its change to it.
- **Search** (⌘K) and **Version history** (⌥⌘H). **Hide panels** (⌘\) leaves only the canvas.

The server reads `<repo>/.design/config.json` at boot. Binds **4399**, or the next free port up to 4408, and opens the default browser (`NO_OPEN=1` skips that). Idempotent: if already running, it just prints the URL. `Ctrl+C` in the terminal stops it.

**Input `$ARGUMENTS`:** `[--port <n>]`

- `--port <n>` — force a specific port (also `$PORT`). Default: 4399, walking up to 4408 when it is busy. An explicit port is never walked: a collision is an error.

## Procedure

Use the target project root explicitly. The plugin cache contains Markdown;
the executable Studio runtime is resolved by `maude`.

```bash
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
PORT=$(maude design server-up --root "$REPO_ROOT")
```

`server-up` is idempotent: it verifies the project's existing server and returns
its port. Open the returned local Studio URL with the host browser tools or the
system browser when the user requested it. It does not accept `--port`.

For an explicit `--port <n>`, first check the project's `_server.json` and health.
Reuse an existing healthy instance; do not start a second server for the project.
If none is running, bind the requested port to `REQUESTED_PORT` and start:

```bash
maude design serve --root "$REPO_ROOT" --port "$REQUESTED_PORT"
```

For a headless start, prefix the same CLI call with `NO_OPEN=1`. Start a
foreground server with the host's long-running-process facility, then wait for
`/_health` before reporting readiness. Run development probes with
`MAUDE_NO_AUTOBUILD=1` to preserve existing release bundles.

The project root is where the user's `.design/` lives, never the plugin cache.
Neither Codex nor Claude needs a `dev-server/server.ts` inside the plugin or a
`CLAUDE_PROJECT_DIR` environment variable. A repo-owned wrapper may be used when
it implements this same project-root and lifecycle contract.

## What the server supports

- **Live re-scan** — the canvas redraws as its file changes. A new file on disk appears after **Refresh tree** (⇧⌘R, or ⌘K "Refresh tree").
- **Path safety:** the server rejects everything outside the repo root.

## Server endpoints

| Endpoint | Purpose |
|---|---|
| `/` | The studio (Home, canvases, panels) |
| `/_health` | Health check `{ ok, app, project, pid, port }` |
| `/_active` | Current `_active.json` content |
| `/_config` | Resolved per-repo config (echoed from `.design/config.json` + defaults) |
| `/_ws` | WebSocket for open-canvas and selection state |

## When /design:browse vs `open <file>`

- **`open <file>`** — a quick one-off look at a single file via `file://`. **No inspector overlay, no `_active.json` tracking.**
- **`/design:browse`** — when you want the orchestrator with the `/design:edit "<feedback>"` flow. Open canvases, object selection, Version history and live updates all run through the server.

The orchestrator (`/design:edit`, `/design:new`, etc.) auto-starts the server itself if it isn't running — `/design:browse` is just an explicit boot for the browsing-only use case.

## Failure modes

- **Ports 4399–4408 all taken** → the server stops with a message naming the range. Stop another dev server or pass `--port <n>`.
- **Missing runtime** → install the `maude` CLI and its platform runtime. Source development uses Bun; there is no supported Node-only Studio server.
- **Spaces in filenames** — the server URL-decodes, link generation encodes. It works.
- **`.design/config.json` missing or invalid** — the server warns in the log and uses defaults.
