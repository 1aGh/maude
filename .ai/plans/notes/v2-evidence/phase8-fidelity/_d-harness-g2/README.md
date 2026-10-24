# Stage D re-shoot harness, G2 (03 AI Chat, 04 Modes, 06 Advanced)

The stage-A scripts (`../_g2-harness`) repointed to the re-shoot worktree, plus the fixes the tip needed. Paths are absolute: change them before reuse.

- `lib.mjs` / `run.mjs`: `whatsNewSeen` pref written, the What's new toast closed through its last button.
- `s03a.mjs`: composer picked with `:visible` (a hidden earlier chat keeps its composer in the DOM now).
- `s03b.mjs`: the pin is toggled back with a dispatched click (the pin button sits under the settings corner icon while pinned).
- `s06b.mjs`: Diagnostics shot without tab clicks (the sheet has no tabs now); Share shot with `window.__TAURI__` removed so a local project shows Share > Advanced instead of the Move-to-cloud offer.
- `s06d.mjs`: new, ad-timeline (VideoEdit, Reel selected, timeline expanded, Advanced opened).
- `pairs.mjs` + `pairs-map.json`: pairs; panel crops widened to x 1050 / w 390; ad-timeline mapped.
- `extras.sh`, `stage-d-index.mjs`: the extra-impl frames and the INDEX / full-size-path update.

Unchanged scripts (s03c, s04a, s04b, s06c, fx*, fake-agent) are in `../_g2-harness`.
