# D6 harness, G5 (13 Design System, 14 Editing, 15 Annotations) — final re-shoot after stage C round 8

Per canvas the newest round-8 harness: 13 = `_c8ds-harness-g5` (s13.mjs over the D5 layers), 14 = `_c8e-harness-g5`
(`scr14/`: Alligators fixture + assets, s14h/i/j, fx5.mjs — laid over `.scr` only for canvas 14 so 13/15 keep the fixtures they
were last shot with), 15 = `_c8ann-harness-g5` (s15/s15g). `scr/` is `_c8ann-harness-g5/scr` with `_c8ds` s13.mjs on top; the
stage-script chains with absolute worktree paths are dropped.

Named `_d6f-…` because `_d6-harness-g5/` already holds the round-6 drag deltas.

Run from the repo root (what `scripts/remote-lane.sh` does in a slot), one canvas x one theme per call:

    bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d6f-harness-g5/chain.sh <13|13p|14|15> <light|dark>

It lays `scr/` into `.scr/`, release-builds the client, shoots into `.scr/impl/<NN-dir>/` (`SHOT_CHANNEL=chrome` = the mini's
Google Chrome). Spec PNGs are not committed (boards unchanged since stage A): reuse `.scr/spec/<dir>/` of the D5 worktree.
Pairs + JPEGs locally (needs `magick`): `bun .scr/mkpairs.mjs 13-design-system 14-editing 15-annotations`, then
`TIP=<sha> bun .scr/mkfinal-d6.mjs`.

Unreachable here: `ds-many-library`, `ds-many-linked` (need a hub), `an-viewer` (needs a share-grant session).
