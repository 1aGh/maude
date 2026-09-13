---
name: browse
category: daily
description: "Open the local Maude canvas browser."
argument-hint: "[--port <n>]"
---

# /design:browse — local design canvas

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Starts the Maude Studio server through the installed `maude` CLI that scans the project's design root (`<designRoot>` from `.design/config.json`, default `.design/`) and builds a 2-pane UI in the browser:

- **Left column** — file tree (collapsible by hierarchy + group labels from the config)
- **Right side** — tabbed iframe preview, like in an editor
- **Inspector overlay** inside every canvas (Cmd+hover highlight, Cmd+click select, Esc clear)
- **Status bar** — active file + selection (`<designRoot>/_active.json`)

The server reads `<repo>/.design/config.json` at boot. Auto-finds a free port from **4321** and opens the default browser. Idempotent: if already running, it just prints the URL. `Ctrl+C` in the terminal stops it.

**Input `$ARGUMENTS`:** `[--port <n>]`

- `--port <n>` — force a specific port (default = first free port from 4321).

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

- **Live re-scan** — the `↻ tree` button in the UI re-scans the disk (or Cmd+R / F5 on the index page).
- **Per-tab reload** — the `↻ active` button (or Cmd+R inside the UI) reloads only the active iframe, not the whole app.
- **Open in system browser** — the `↗ system` link opens the active mock in a new tab (useful for DevTools, screenshots).
- **Keyboard:** `Cmd+W` closes the active tab, `Cmd+R` reloads the active iframe.
- **Path safety:** the server rejects everything outside the repo root.

## Server endpoints

| Endpoint | Purpose |
|---|---|
| `/` | UI (file tree + tabs + inspector) |
| `/_health` | Health check `{ ok, app, project, pid, port }` |
| `/_active` | Current `_active.json` content |
| `/_config` | Resolved per-repo config (echoed from `.design/config.json` + defaults) |
| `/_ws` | WebSocket for tab/selection state |

## When /design:browse vs `open <file>`

- **`open <file>`** — a quick one-off look at a single file via `file://`. **No inspector overlay, no `_active.json` tracking.**
- **`/design:browse`** — when you want the orchestrator with the `/design:edit "<feedback>"` flow. Tab tracking, element selection (Cmd+click), inspector overlay, snapshots — all of it runs through the server.

The orchestrator (`/design:edit`, `/design:new`, etc.) auto-starts the server itself if it isn't running — `/design:browse` is just an explicit boot for the browsing-only use case.

## Failure modes

- **Ports 4321–4420 all taken** → the server throws `no free port`. Choose a free port with `--port <n>`.
- **Missing runtime** → install the `maude` CLI and its platform runtime. Source development uses Bun; there is no supported Node-only Studio server.
- **Spaces in filenames** — the server URL-decodes, link generation encodes. It works.
- **`.design/config.json` missing or invalid** — the server warns in the log and uses defaults.
