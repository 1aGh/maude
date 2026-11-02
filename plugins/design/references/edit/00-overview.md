# /design:edit — change the open canvas

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

The design plugin's default flow. It changes the canvas the person has open in the Maude window, in place: not a new session, not a new file. They say "add a presence dot here", and the dot appears on the canvas while they watch.

You change the canvas by editing its `.tsx` file. The canvas redraws by itself; there is nothing to reload.

How an edit is kept safe (you do none of it by hand):

- **One run, one version.** The design plugin's hooks open a run when the conversation starts, keep the bytes before every write, and close the run when the turn ends. Everything you change in the run is one version in Version history and one undo step. See [AI runs and busy artboards](../../skills/design/_guide-27-ai-runs-and-busy-artboards.md) and [Snapshot protocol](../../skills/design/_guide-07-snapshot-protocol.md).
- **Ids stay.** Every element carries a `data-cd-id`. Keep each one on the element that had it, and give a new element a new readable id. Never reuse or renumber ids. See [Editing in Maude v2](../../skills/design/_guide-editing-v2.md).
- **Locks and busy artboards are respected.** A locked element (`data-cd-locked`) is not yours to change. One AI changes an artboard at a time; step 4.5 explains what to do when a write is denied.

Project-specific values (designRoot, rootClass, tokens path, themeDefault) come from `<repo>/.design/config.json`, read through step 1.

**Input `$ARGUMENTS`:** `"<feedback>" [--screenshot <path>] [--perfect [N]] [--no-critic] [--no-propose] [--opt-out=palette|aesthetic|full]`

- `<feedback>`: verbatim what should change. Concretely: "presence dot 8px next to each roster player name", "tighter row density", "remove avatar from chat header".
- `--screenshot <path>`: optionally a path to an annotated image. Read it as image input.
- `--opt-out=palette|aesthetic|full`: override the scope for this iteration and persist it to `.meta.json`. If absent, read `opt_out_scope` from the sidecar `<canvas>.meta.json` (default `palette`). See SKILL.md "Opt-out scope".

**Examples:**
```
/design:edit "Presence dot 8px (--status-success) before each roster player name"
/design:edit "Tighter density on Roster section — padding 8/12 instead of 12/16"
/design:edit "Match this layout exactly" --screenshot /Users/me/Downloads/anotated.png
```
