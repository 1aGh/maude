

# /design:edit — iterate on the active canvas

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

The design plugin's default flow. Edits the **file you currently have open in the browser tab** — not a new session, not a new file. Like a Claude Design canvas — you say "add a presence dot here", and the presence dot appears in the active canvas.

Project-specific values (designRoot, rootClass, tokens path, themeDefault) come from `<repo>/.design/config.json`. The orchestrator reads them via the server `/_config` endpoint (or straight from the file).

**Input `$ARGUMENTS`:** `"<feedback>" [--screenshot <path>] [--opt-out=palette|aesthetic|full]`

- `<feedback>` — verbatim what should change. Concretely: "presence dot 8px next to each roster player name", "tighter row density", "remove avatar from chat header".
- `--screenshot <path>` — optionally a path to an annotated image. Claude reads it as image input.
- `--opt-out=palette|aesthetic|full` — override scope for this iteration and persist to `.meta.json`. If absent, read from the sidecar `<canvas>.meta.json` field `opt_out_scope` (default `palette`). See SKILL.md "Opt-out scope".

**Examples:**
```
/design:edit "Presence dot 8px (--status-success) before each roster player name"
/design:edit "Tighter density on Roster section — padding 8/12 instead of 12/16"
/design:edit "Match this layout exactly" --screenshot /Users/me/Downloads/anotated.png
```
