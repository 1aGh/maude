# D7 final re-shoot harness, G1 / canvases 03 + 04 (merged tip after stage C round 10)

= `_c10-ai-harness/` (the D6 g2 flattened harness + the round-10 03 deltas: s03c s03e s03h s03z fake-agent) with `impl/s04a.mjs` taken from `_c10m-harness-g2/` (round 10: md-inspect at camera <= 69 %, Advanced open). Paths -> `_d7-harness-g1/g2`, frames land in `.scr/d7/<NN>-<dir>/`. Everything else (Google Chrome on the mini, `fixtures/`, `NO_MAGICK=1`, spec PNGs reused from the D3 evidence set) is as in `_d6-harness-g2/README.md`.

```
scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7/03-ai-chat -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g1/g2/chain.sh 03
scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7/04-modes   -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g1/g2/chain.sh 04
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g1/g2/mkpairs.sh <03-ai-chat|04-modes>      # local: needs .scr/spec/<NN>/ (+ meta.json)
```
