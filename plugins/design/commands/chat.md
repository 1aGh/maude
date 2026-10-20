---
name: chat
category: daily
description: "Open the AI chat panel in the running Maude window, or continue an in-app chat from a terminal."
argument-hint: ""
---

# /design:chat — open the AI chat panel

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Opens (or brings back) the **AI chat panel** in the running native Maude window, where you can drive `/design:edit`, `/design:new`, `/design:critic` and `/design:screenshot` and watch the canvas change. The panel runs on **your own `claude` install on a Pro/Max subscription** (no login in Maude, never metered API billing — DDR-123).

> **Native app only.** The panel exists only in the native Maude window. It spawns the agent on your machine, which only the native shell can do reliably (DDR-123). From a terminal-only studio the terminal workflow stays.

## What it does

The single source of truth is `maude design chat-open` (the on-PATH `maude` dispatches to the bundled helper — DDR-062). It reads the running studio's address from `<designRoot>/_server.json` and asks it to show the panel. The panel is also one key away in the app: **⌘/** (Ask AI), or the spark icon when the panel is folded.

## Procedure

1. Make sure native Maude is running (the panel renders inside it). If it is not, open the Maude app.
2. Show the panel:

```bash
maude design chat-open
```

3. The AI chat panel opens in the Maude window. Prompts you type there run in the same project; the canvas updates live.

## Attach to an in-app chat from a terminal

Every chat in the panel is a normal `claude` session. To continue one from a terminal, use **Open in terminal** on the chat (native app: it opens Terminal in the project root with `claude --resume <session id>`). To do it by hand, print the id from the panel's chat list and run:

```bash
claude --resume <session id>
```

Both windows then work on the same session. Attachments dragged into the panel stay with that chat.

## Panel states

- **Ready** — `claude` is installed and signed in. Type a prompt; the quick actions (`/design:edit`, `/design:new`, `/design:critic`, `/design:screenshot`) prefill the composer.
- **Working** — AI is writing. **Stop** cancels the turn (esc also cancels).
- **Not connected** — `claude` is not installed or not signed in. The panel explains it in one line ("open a terminal, run `claude` and `/login`"); it is never an error.

## Failure modes

- **No running studio** (`_server.json` missing) → "Open Maude first."
- **The request failed** → the studio is running but did not accept it (an old build?). Restart Maude.
- **Terminal-only studio** → the panel will not open; use terminal Claude Code.
