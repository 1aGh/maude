# C10 re-shoot harness, G2 canvas 06 (Advanced) on the merged tip

Copy of `_d6-harness-g2/` with two changes (the D6 chain skipped the round-8 steps):
- `chain.sh 06` now ends with `s06j` (the round-8 states: ad-diag with its Advanced row open, ad-code panel + fold, ad-search "copy", ad-inspector in a 1760 px window, ad-export in a 1500 px window, ad-history with a version selected, ad-left with Show file names + Show hidden files ON). It runs LAST so its frames overwrite the earlier scenarios' same-named frames.
- `impl/s06e.mjs` (ad-ds): the Advanced fold is `<details open>` by default; the old blind click closed it. It now opens it only when closed.

Output frames: `.scr/c10/06-advanced/<id>-<theme>.jpg`. Run:

```
scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/c10 -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10-harness-g2/chain.sh 06
bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c10-harness-g2/mkpairs.sh 06-advanced
D5_REPO=$PWD node .ai/plans/notes/v2-evidence/phase8-fidelity/_c10-harness-g2/index.mjs 06-advanced <tip> "<note>"
```
