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

## Round 7 continuation (p8-c7-g1112b) — done, re-shot (dark + light)

- **ia-assets-keys / ia-assets-browse / ia-placed** — harness: `s12c7.mjs` selects the artboard first, right-clicks a tile (menu open, mouse off the tile so no tooltip), ⇧-clicks the sixth tile in Browse; ia-placed (s12h) shows the photo group with its "6 photos" tag and the Photo inspector (not the Frame's).
- **ia-assets-tidy** — foot is ONE line in the panel (`.lp-tidy-foot` nowrap; in a panel under 270 px the size gives way: "23 assets" + the button, the size stays in the title and the dialog). C4's wrap made it two stacked lines.
- **ia-photo-inspector** — Photo tab has Placement Fill · Fit · Crop (the Image tab's `image.crop` edit-op, same ask) and Light / Colour as a track + a signed value; the SliderField number boxes are gone (`photo-section.jsx`).
- **ia-photo-steps** — the crop step is the real crop mode (double-click after Placement › Crop; tag "photo · crop"; 14 owns that tag's words) plus the line "The whole photo stays — only the frame moves." under Placement while Crop is on. The board's "4:5 · from the artboard" pill is NOT built (board 14, the owner of editing, draws "<name> · crop").
- **ia-brand-steps** — "1 colour" singular (`coloursWords`), the failed site is the callout only (no second amber row).
- **ia-missing-gone** — "Replace…" beside "Relink…" in the Missing box (the asset picker, `onReplaceMedia`); the shot selects the picture inside the frame through the shell's select-by-id lane.

## Open

- ia-photo-steps — only the crop step is a real state; "Remove background" in progress / done and the Apply-to-every-use sheet are the other three columns of the board (reachable but not shot: need the model).
- ia-gen-ask stays inline (v2-p8-c9-ask-stays-inline).
- ia-more-ways, ia-gen-placed, ia-figma-arrived, ia-figjam, ia-brand, ia-missing, ia-edges — unreachable here (fixtures / providers / peers).
