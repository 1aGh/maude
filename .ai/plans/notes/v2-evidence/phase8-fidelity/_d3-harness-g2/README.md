# Stage D3 (final re-shoot on 63592219a) harness, G2 (03 AI Chat, 04 Modes)

Built on `../_d2-harness-g2` (copy its other files: `lib.mjs`, `run.mjs`, `fake-agent.mjs`, `s03a/s03c/s04c/s04v`, fx*.mjs from `../_d-harness-g1` / `../_g2-harness`). Paths hard-code the worktree
`/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1d011f1a56ad7ee9` (`.scr/`): repoint before reuse. Run `apps/studio` `bun install --frozen-lockfile` first (a fresh worktree has no node_modules), then
`MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`, then `git checkout -- apps/studio/dist` and remove the compiled binary.

New here:
- `s03e.mjs`: the old s03b sequence (ai-long, ai-done, ai-hero, ai-history, ai-panel-closed, ai-choice-q, ai-question, ai-adv-edges, ai-quit) with each artboard picked by its LABEL CHIP in the canvas frame (`pick(/^Post 1:1/)`): the camera moves when the chat is pinned and the panels fold, so fixed coordinates select "Whole canvas".
- `s03d.mjs`: ai-needs-hidden from a clean chat. `s03n.mjs`: stage-A signed-out stub (ai-not-ready, ai-not-ready-after).
- `s04a.mjs`: md-draw uses `toolbar-slot-sticky` by testid, closes the Comments panel first, and re-enters Preview if one esc left it.
- `d3chain.sh`: the order the first pass ran (its s03b was superseded by s03e). Where two scripts shoot the same id the LATER one wins (s03c after s03a / s03e).
- `pairs.mjs` takes `MAP=pairs-map-d3.json` (03 + 04 only); `stage-d3-index.mjs` writes the FINAL (D3) section + the `full-size-path.txt` line.
