# D5 harness, G5 (13 Design System, 14 Editing, 15 Annotations)

The final re-shoot harness: every earlier G5 layer flattened into `scr/` in the order
`_d-harness-g5`, `_d2`, `_d3`, `_c6-bugs4-harness`, `_d6`, `_d4`, `_c7` (13), `_c7ds3`, `_c7e2`, `_c7e3`, `_c7g15`, `_c7g15b`
(later folders overwrite earlier files). Changes made here:

- `scr/lib.mjs`: `REPO` is `<harness>/..` (the harness runs from `<repo>/.scr`), the stub-claude import is relative, and
  `SHOT_CHANNEL=chrome` launches the installed Google Chrome (the Mac mini has no Playwright browser download).
- `scr/mkfinal-d5.mjs`: writes the INDEX "FINAL (D5)" section and the `final (D5):` line.
- Dropped: stage scripts with absolute worktree paths (`chain-c7e2/c7e3/g`, `cmp.sh`, `getspec.sh`, `crop.mjs`) and the spec/impl/pairs dirs.
- Not run: `s04i.mjs` (canvas 04, not this group).

Run from the repo root (what `scripts/remote-lane.sh` does in a slot):

    bash .ai/plans/notes/v2-evidence/phase8-fidelity/_c8ann-harness-g5/chain.sh <13|14|15|13p> <light|dark>

It copies `scr/` to `.scr/`, release-builds the client, shoots one canvas for one theme into `.scr/impl/<NN-dir>/`
(`13p` re-runs `s13p` alone). Spec PNGs are not committed: reuse an earlier worktree's `.scr/spec/<dir>/` or
`bun .scr/spec.mjs <NN>` on a scratch copy of `.design`. Pairs and JPEGs: `bun .scr/mkpairs.mjs 13-design-system 14-editing 15-annotations`
locally (needs `magick`), then `TIP=<sha> bun .scr/mkfinal-d5.mjs`.

Unreachable here: `ds-many-library`, `ds-many-linked` (need a hub), `an-viewer` (needs a share-grant session).
