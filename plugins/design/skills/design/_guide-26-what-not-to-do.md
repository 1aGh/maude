## What NOT to do

- Never start a second server instance.
- Never edit a canvas without snapshotting first.
- Never silently regenerate from scratch when the user gave incremental feedback.
- Never reach outside the selected element when `selected` is set, unless feedback explicitly says so.
- Never commit `_server.json`, `_active.json`, or `_history/` (gitignored — verify).
- Never spawn nested subagents from a critic — critics run reviews inline.
- **Never scaffold a single-page HTML canvas via `/design:new`** — always use the multi-artboard `DesignCanvas` pattern. Single screens live as a `DCArtboard` inside an existing project canvas (use `/design:edit "<add a new artboard for X>"` on the active canvas, not `/design:new`).
