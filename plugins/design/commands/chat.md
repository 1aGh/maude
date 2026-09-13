---
name: chat
category: daily
description: "Open the existing native Studio ACP chat panel. ACP harness support is a separate integration."
argument-hint: ""
---

# /design:chat — surface the native ACP chat sidepanel

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Opens (or focuses) the **Assistant** sidepanel in the running native Maude window, where you can drive `/design:edit`, `/design:new`, `/design:critic`, `/design:screenshot` and watch the canvas change — without leaving the same shared surface. The panel runs on **your own `claude` install on a Pro/Max subscription** (no login in Maude, never metered API billing — DDR-123).

> **Native-app only.** The panel exists only in the native Maude shell (not the web surface) — ACP spawns the agent locally on your machine, which only the Tauri shell can do reliably (DDR-123, scope note phase-31). You can't open the panel from the terminal web-studio; there the terminal-driven workflow stays.

## What it does

The single source of truth is `maude design chat-open` (the on-PATH `maude` dispatches to the bundled helper — DDR-062). The helper reads the running dev-server's port from `<designRoot>/_server.json` and POSTs to `/_api/acp/focus`; the server emits a bus event that the shell (app.jsx) translates into "open the Assistant panel" (native-only).

## Procedure

1. Make sure native Maude is running (the panel renders inside it). If the server isn't running, open the Maude app.
2. Trigger focus:

```bash
maude design chat-open
```

3. The Assistant panel opens in the Maude window (or `⌘⇧A` directly in the app).

## Panel states

- **Ready** — claude is installed + logged in; type prompts, quick-actions (`/design:edit`, `/design:new`, `/design:critic`, `/design:screenshot`) prefill the composer.
- **Working…** — the agent is streaming; **Stop** (⌘↵ sends, Esc/Stop cancels the turn).
- **Not connected** — `claude` isn't installed / logged in → a plain explainer ("open a terminal, run `claude` and `/login`"), never an error. Detected via `GET /_api/acp/status`.

## Failure modes

- **No running server** (`_server.json` missing) → "Open Maude first."
- **Focus request failed** → the server is running, but `/_api/acp/focus` is unavailable (old build?) — restart Maude.
- **Web surface** → the panel won't open (native-only); use terminal Claude Code.
