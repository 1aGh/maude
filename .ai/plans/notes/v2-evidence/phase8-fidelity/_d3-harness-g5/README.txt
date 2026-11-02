D3 deltas over _d-harness-g5 + _d2-harness-g5 (copy those first, then these over them; set REPO in lib.mjs; node_modules symlinks into the main checkout; release-build the client).
Order: bun mk-dsconv.mjs; bash chain-d3.sh light|dark; chain-fix*.sh re-ran the flaky / changed groups; bun dsboard.mjs; bun mkpairs.mjs 13-design-system 14-editing; TIP=<sha> bun mkfinal.mjs.
Changes: g5.mjs label press by coordinates; s13.mjs ds kernel retry, wait for the system board, make door via Canvases > Advanced, instance drill 3 deep, re-open the left panel (where-studio, migrate); s14b/s14c select the artboard first and place the Button with the picker's Enter.
outside-probe.mjs: shows `ds status` never reports "outside" after a disk edit in this lane.
