# D7 final re-shoot harness, G2 (canvases 06 07 08), merged tip after stage C round 10

Two committed layers, kept side by side (they have different libs), run one canvas per remote-lane call by `run.sh`:

- `g2/` = `_d6b-harness-g2` (06: every `ad-*` id, `s06j` round-8 states LAST). Trimmed to the 06 scenarios (s03/s04 dropped).
- `g3/` = `_c10-harness-g3` (07 / 08 / `t06v`), with `chain.sh` set to the layering the rounds produced:
  07 = `t07` (all ids) < `t07c` (ve-captions, ve-music) < `t07v` (round 9: HypeFormats / ZapasLong / NaborKeyframes fixtures);
  08 = `t08` (all ids) < `t08m` (round-8 states) < `t08p` (round 10: ak-print-view, ak-advanced);
  06-advanced = `t06v` (ad-timeline on a keyframed title; overwrites g2's ad-timeline).

Run (the mini, one chain at a time; repo-relative so it runs from a slot root):

    scripts/remote-lane.sh --slot auto --max 3600 --fetch .scr/d7/06 -- bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/run.sh 06
    (same for 07, 08)  then locally:  bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/mkpairs.sh <06|07|08>

Impl frames: `.scr/d7/<NN>/<id>-<theme>.jpg`. Pairs (spec | impl, full size PNG) -> `.scr/pairs/<NN>/`; the committed
`<id>-<theme>.jpg` (<=1100 wide, q55) are overwritten. Spec PNGs are reused from the D6/D6b worktrees (`.scr/spec/<NN>/`;
the 06 / 07 / 08 boards under `.design/ui/v2/` are unchanged since the D4 spec shots). Safety: throwaway HOME/XDG + stubClaudeEnv
in every boot, NO_OPEN=1, MAUDE_NO_AUTOBUILD=1.
