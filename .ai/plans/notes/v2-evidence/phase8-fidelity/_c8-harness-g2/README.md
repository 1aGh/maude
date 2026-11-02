# D5 final re-shoot harness, G2 (03 AI Chat, 04 Modes, 06 Advanced) on the merged tip e37e7d82a

One flattened copy of the newest per-canvas layers, with repo-relative paths so it runs from a clean clone (the Mac mini remote lane).

- `impl/` = the layers in this order (later wins): `_d-harness-g1`, `_g2-harness`, `_d-harness-g2`, `_d2-harness-g2`, `_d3-harness-g2`, `_c6-harness-g2`, `_c7-ai-harness`, `_c7b-ai-harness` (03); `_c7-modes-harness` (04); `_c7o-harness-g2` (06); `s04i.mjs` from `_c7g15b-harness-g5` plus `fx5.mjs` / `fx5-canvases` / `mk-dsconv.mjs` from `_d-harness-g5`. Scenarios not used by 03/04/06 were dropped.
- Path edits: `REPO` = `D5_REPO` or `<impl>/../..`; the stub-claude import is relative; `MAUDE_ACP_RUNTIME` = `D5_BUN` (the runner's bun); the fake agent logs to `.scr/agent.log`; `fx5` reads `impl/fx5-canvases`.
- No ImageMagick on the mini: `fixtures/photos` (six plasma jpgs, was `convert` in `fx4`) and `fixtures/attach` (the .mov / .png / 12-page .pdf the attach scenes need) are committed; the `md-edge-mixed` contact sheet is built locally (`NO_MAGICK=1` makes `s04d` print the five part files instead).
- No Playwright headless shell on the mini: every chain runs with `SHOT_CHANNEL=chrome` (Google Chrome 156 via Playwright's `channel`). The earlier stages shot the headless shell, so a sub-pixel font or scrollbar difference against older frames is the browser, not the product.
- `s04i` (md-edit-image) now seeds the six Photos into `.design/assets`, so the Assets panel holds what the board shows (the g5 site fixture had none).

Run (each chain on the mini; frames land in `.scr/d5/<NN>-<dir>/`, fetched with `--fetch .scr/d5`):

```
scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d5 -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g2/chain.sh <03|04|06|04i>
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g2/mkpairs.sh <03-ai-chat|04-modes|06-advanced>   # local: SPEC | IMPL pairs (.scr/pairs/<dir>, committed JPEG q55 1100 px)
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g2/extras.sh                                        # the extra-impl-* frames
D5_REPO=$PWD node .ai/plans/notes/v2-evidence/phase8-fidelity/_c8-harness-g2/index.mjs <dir> <tip> "<note>"      # INDEX.md FINAL (D5) + full-size-path.txt
```

`chain.sh` order: 03 = s03a s03e s03d s03c s03n s03g s03h s03i s03k; 04 = s04a s04c s04v s04d s04k s04i; 06 = mk-dsconv, s06b s06f s06d s06e s06g s06h s06i. Spec PNGs (`.scr/spec/<NN>/`, with `meta.json`) were copied from the D3 evidence worktree: the boards `.design/ui/v2/03|04|06` have not changed since 2026-10-19.
