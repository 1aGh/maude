Round-7 harness (p8-c7-g1112b), canvases 11 + 12. = _d2-harness-g4 plus:
- s11c7  pn-move (a canvas held over a folder: "Move here") and pn-jump (artboard selected, list opened and scrolled)
- s11dl  pn-deeplink (waits for the toast; the toast names the artboard, the artboard is selected)
- s11ds7 pn-ds / pn-ds-search with ONE design system, the system open
- s12c7  ia-assets-keys (artboard selected, tile menu open), ia-assets-browse (click + shift-click six), ia-assets-tidy, ia-photo-inspector,
         ia-photo-steps (Placement > Crop, double-click = crop mode), ia-missing-gone (picture selected: the Missing box)
chain7.sh = the whole run (later scripts overwrite earlier frames of the same id); chain7b.sh = the retakes after the last product change.
REPO in lib.mjs points at the shooting worktree: copy into a worktree .scr, repoint it, symlink node_modules (root + apps/studio), release-build apps/studio, then
`node .scr/mkpairs.mjs <NN-dir>`. Needs ImageMagick (convert, magick). home11 needs `MAUDE_INDEX_DIR=.scr/home-idx bun .scr/seed-home.ts > .scr/home-seed.json`.
s11ds7 needs .scr/design-copy1/.design = system/maude-v2 + ui/v2 + a config.json copied from this tree with designSystems filtered to maude-v2.
Never run a chain that waits on `pgrep -f run.mjs`. macOS has no `timeout`.
