## What `/design:new` does NOT do

- Does not create `.ai/design-sessions/` (concept dropped).
- Does not generate an "iteration 001". The file is the canvas directly.
- Does not overwrite an existing file (protection against mistakes).
- Does not open the file in the browser — the user clicks it themselves (auto-refresh tree via `↻ tree` in the UI).
- Does not update `_active.json` — it becomes active only when the user clicks it in the tree.
- **Does not generate a single-page HTML wrapper** — always a multi-artboard canvas.
