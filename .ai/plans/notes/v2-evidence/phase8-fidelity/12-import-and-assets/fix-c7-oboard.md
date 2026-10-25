# 12 Import and Assets — stage C round 7 (p8-c7-g1112)

Checklist: critic-bar2.md MUST rows. Branch p8-c7-g1112.

## Done (product, not yet re-shot)

- **ia-assets-keys** — "Rename…" in the tile menu (Place · Show details · Rename… · Copy · — · Move to trash, board order).
  `POST /_api/assets/rename` (routes/asset-rename.ts + asset-rename.ts): main origin only, table CSRF gate, Can edit on the
  project (viewer / commenter / canvas-only refused 403), the new path stays directly in `assets/`, extension kept,
  sidecars (`.photo.json`, per-use edits, `.gen.json`, transcripts) move with it. A picture a canvas uses, one an older
  version shows, or one still being checked is REFUSED (409 used / kept-by-versions / checking) — so no reference breaks
  (decision v2-p8-c7-asset-rename-refuse-used). Inline field under the head (named "New name for <file>", extension fixed
  after it), ↵ renames, esc cancels; the line says "Renamed to “…”." with Undo (the same call back). Registry action
  `assets.rename` + regen; writer-registry, ACL class (project), role-refusal row, hub studio-manifest entry.
- **ia-placed** — after a place (From this Mac… onto a selected artboard, or ↵ with several picked) the created photos are
  selected as one group: `select-by-id` gained `add: true` (dgn bridge + canvas-shell), and the group box draws an
  "N photos" tag when the selection is only pictures (`groupPhotoCount`). Whether the Frame inspector still opens for
  the photo group is unverified until the re-shoot.

## Open

- ia-assets-browse — the selection foot bar IS built (browse-view.jsx "N selected · size · Clear · Place N in …"); the
  shot needs the harness to pick tiles (⇧-click 6) after opening Photos. Harness fix, not product.
- ia-assets-keys — the shot must open the tile menu (right-click a tile with an artboard selected) to evidence the rows.
- ia-assets-tidy — one-line foot inside the panel (the two-row cap is ruled out: v2-p8-lead-rulings-06-folds-keys-notused).
- ia-photo-inspector (Fill / Fit / Crop segment, extra numeric fields), ia-photo-steps (crop step), ia-brand-steps
  ("1 colours" plural; duplicate amber row), ia-missing-gone ("Replace…"). Not started.
- ia-gen-ask stays inline (v2-p8-c9-ask-stays-inline) — only the in-card look is in scope.
- Re-shoot of all 12 light + dark with the `_d2-harness-g4` scripts (copied to `.scr/`, REPO repointed; spec PNGs come
  from the stage-A worktree) — not done this round.
