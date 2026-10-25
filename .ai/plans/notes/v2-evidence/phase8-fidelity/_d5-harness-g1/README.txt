D5 (FINAL, merged tip) harness for G1 (canvases 01 / 02 / 05). Repo-relative so a remote-lane slot can run it.
Layers: _d-harness-g1-d4/ (D3 base + 01 chain) -> _c7-harness-g1/ (s01b s01c s01d) -> _c7b-harness-g1/ (s01b s01c), plus:
  lib.mjs / home2.mjs / chain.mjs / chain01.mjs / pair.mjs  REPO = $D5_REPO || the harness' own ../.. || cwd (no worktree paths);
                                                            stub-claude imported relative; chromium channel from $D5_CHANNEL
  home2.mjs   es-home-local registers NO project (the board's "No projects on this Mac yet." card, as the round-7 oboard note says);
              the four flat thumbnails come from ./thumbs (no ImageMagick on the mini)
  chain.mjs   output dir from $D5_OUT (default .scr/impl-raw)
  removed     boot-spec / spec (SPEC side is reused: no board 01/02/05 file changed since D3), fx2 / fx4 / s04cm / home.mjs (unused by 01/02/05)
Remote run (the mini has no Playwright chromium build, so it uses the installed Google Chrome: D5_CHANNEL=chrome):
  scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d5g1-impl -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d5-harness-g1/run-remote.sh light
  (and the same with dark). The chain: s01ai s01b s01c s01d s02p s05a s05c s05d s05e s05f s05g, then home2 (all Home scenes).
Pairs (local): copy the fetched .scr/d5g1-impl to .scr/impl-raw, spec PNGs to .scr/spec-raw/{01,02,05}, copy this dir to .scr/h, then
  node .scr/h/pair.mjs 01 light,dark   (and 02, 05)   -- needs ImageMagick (magick); writes .scr/pairs/<NN> and the committed JPEGs.
