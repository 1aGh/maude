# D7 final re-shoot harness, G4 (canvases 14 Editing, 15 Annotations), merged tip after stage C round 10

No new scenarios: `run.sh` layers the NEWEST committed harness per canvas (it reads the sibling harness dirs, nothing is copied except one file):

- **14** = `_c10-harness-g5` (`setup.sh 14`: the flattened D6 harness + `scr14/` Alligators fixture with assets, `s14h/i/j`) <- `_c10-harness-g5-edit/scr` (round 10: `s14i` pen block, the Alligators body line).
  Order: the D6 chain (`s14a/b/c` studio + gators, `s14e/f/g/ai/t`) for the full id set, then the round-8/10 tail (`s14b` for `ed-obj-multi` only, `s14h`, `s14i`, `s14j`, `s14e`, `s14g`) so their shots win. The side shot `ed-pen-draw` is not re-shot (no board pair).
- **15** = `_c10ann-harness-g5` (`setup.sh 15`; `s15` groups a-f + p, `s15g` g1-g5, round 10) with `scr15/s15.mjs` on top = its `s15.mjs` plus the one step p8-c10-print added (View > Print guides on before the `an-print` shot), because the two round-10 builders each forked `_d6f` and neither carried the other's change.

Run (the mini, one chain at a time, one canvas x one theme per call):

    scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/impl/14-editing -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g4/run.sh 14 light
    (14 dark;  15 light|dark with --fetch .scr/impl/15-annotations;  `14h` = s14h alone, ONLY=<ids>)

Then locally: copy the spec PNGs from a D6 worktree's `.scr/spec/{14-editing,15-annotations}` into `.scr/spec/`, run `bun .scr/mkpairs.mjs 14-editing 15-annotations` (from `_c10-harness-g5/scr`, laid into `.scr`) and `TIP=<sha> bun .scr/mkfinal-d7.mjs` (here).
Spec boards `.design/ui/v2/14 Editing.*`, `15 Annotations.*` are unchanged since stage A, so the stage-A spec PNGs are reused.
Safety: throwaway HOME/XDG + stubClaudeEnv in every boot (lib.mjs), `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`.
Unreachable by design: `an-viewer` (needs a share-grant session).
