# Round 6 (p8-c6-aisurf) re-shoot harness: 03 AI Chat + 01 AI frames

Layered on the earlier harnesses; copy in this order into `<repo>/.scr/impl/` (later wins): `../_d-harness-g1/` (fx*.mjs, fake-acp/), `../_g2-harness/`, `../_d2-harness-g2/`, `../_d3-harness-g2/`, then these files.
Repoint the worktree path in every `*.mjs` / `*.sh` (`.scr/repoint.mjs`-style replace of `/worktrees/agent-<id>`), run `apps/studio` `bun install --frozen-lockfile`, release-build the client
(`MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`), then `git checkout -- apps/studio/dist` and remove the compiled binary.
Spec images: `.scr/spec/03/` (stage A, reused) and `.scr/spec/01/` (`spec01.mjs` crops the round-5 spec-raw frames to 1440x900).

What changed against D3:
- `s03a`, `s03c`, `s03d`: the AI panel is opened BEFORE the artboard is picked. An artboard pick with the chat open is the ask scope (no Inspector, board 03); picking first opened the Inspector on the earlier pick.
- `s03a`: attaches a photo, a footage file and a PDF and dispatches `dragenter` (Files) on the composer so the "Drop to attach" overlay shows in `ai-attach`; ⌘/ is pressed before the pick.
- `s03e`: ai-done is ONE chat on Post (no hung poster chat); the poster chat starts only for ai-hero; ai-history hides the chat first (Version history alone); ai-panel-closed asks on Post, hides the panel at once and shoots when the Done toast shows; the left Canvases panel is folded after open.
- `s01ai`: paths point at `.scr/impl/fake-acp`.
- `c6chain.sh` / `c6chain2.sh`: the run order. `pairs-map-c6.json` / `pairs-map-c6-01.json` run through the g2 `pairs.mjs` (`MAP=...`). `c6-index.mjs <tip>` appends the "Round 6" INDEX section and the `full-size-path.txt` line.
