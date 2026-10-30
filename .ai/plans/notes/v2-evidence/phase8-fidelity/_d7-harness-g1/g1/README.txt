D7 G1 / canvas 01 chain = _c10m-harness-g1 (D6 g1 harness + the round-10 s01d delta: AI panel open while the render-error card shows) with:
  run-remote.sh  paths -> _d7-harness-g1/g1, output .scr/d7g1-impl, runs ONLY s01ai s01b s01c s01d + home2 limited to cf-home-prompt(.target) (D5_HOME_ONLY)
  chain.mjs      home2 takes an optional scene filter from D5_HOME_ONLY
  removed        the index generators (index-d7.mjs in the parent dir writes INDEX.md / full-size-path.txt)
Remote:  scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7g1-impl -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g1/g1/run-remote.sh light,dark
Pairs (local, ImageMagick): cp -R .scr/d7g1-impl .scr/impl-raw; mkdir -p .scr/h && cp -R <this dir>/. .scr/h/; spec PNGs in .scr/spec-raw/01 (D3 set, reused);
  node .scr/h/pair.mjs 01 light,dark   -> .scr/pairs/01 + the committed JPEGs in 01-create-flow/
