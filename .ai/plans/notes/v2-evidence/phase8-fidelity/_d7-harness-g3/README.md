# D7 final re-shoot harness, G3 (canvases 10 12 13), merged tip after stage C round 10

Two committed layers, repo-relative (they run from a Mac mini slot root), one remote-lane call per canvas (13: per theme):

- `g4/` = `_c10m-harness-g4` (10 and 12), trimmed to the 10 / 12 scenarios (the 11-only scenarios and the Home seeding dropped), paths one level deeper.
  - 10 = `chain10.sh`: `s10 s10cm s10c s10d s10e s10m s10k s10v`, later scenarios overwrite earlier frames of the same id (round 8: `s10cm` print guides, `s10d` ask-edit tip; round 10: `s10v` co-comment-video through a pin + thread card in Preview, `s10cm` co-comment-thread / -print).
  - 12 = `chain12.sh` (new here; the D6 `chain1112.sh` minus the 11 half): `s12 s12b s12e s12f s12g s12h s12c7` (round 7 `s12c7`, round 8/10 `s12g` ia-brand-steps(+1/2/3)).
  - pairs: `g4/mkpairs.mjs` (the crop table of D6, unchanged).
- `g5/` = `_d6f-harness-g5` (13), `scr14/` and the README dropped. The round-10 builder (`_c10m-harness-g5`) only re-ran `s13.mjs G=b` and `s13p.mjs` of this same layer, so no scenario changed:
  `chain.sh 13 <light|dark>` = `mk-dsconv`, `s13` groups a-k, `s13p`, `s13s`, `s13u`, and (light run only) `dsboard` (the three whole-board crops through the capture origin).
  - pairs: `g5/scr/mkpairs.mjs` (laid into `.scr` by `setup.sh`); an id with no impl becomes the grey "not reachable" card (ds-many-library, ds-many-linked: a team library needs a hub).

Run:

    scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/impl/10-share-and-collaboration -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/run.sh 10
    scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/impl/12-import-and-assets      -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/run.sh 12
    scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/impl/13-design-system          -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/run.sh 13 dark   (then light)
    bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/mkpairs.sh <10|12|13>      # local, ImageMagick

Spec PNGs are reused (`.scr/spec/<dir>/`, copied from the D6 worktrees): the boards `.design/ui/v2/10|12|13 ...` last changed 2026-10-19 / 2026-10-21 / 2026-10-08, before the stage-A spec shots.
Safety: throwaway HOME/XDG + stubClaudeEnv in every boot, NO_OPEN=1, MAUDE_NO_AUTOBUILD=1; the runner shoots with its Google Chrome (`SHOT_CHANNEL=chrome`), so a sub-pixel font difference against pre-D6 frames is the browser.
