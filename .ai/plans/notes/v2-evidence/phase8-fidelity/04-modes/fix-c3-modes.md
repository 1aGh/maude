# Phase 8 stage C round 3 - Preview purity, menus, Present (branch p8-c3-modes)

Scope: 04 X1-X9, the context menus (artboard / object / canvas; 01 cf-duplicate-width, 14 ed-ab-menu), the share cluster's Comments icon (10 S1).
Tests: `apps/studio/test/p8-c3-modes.test.ts` (17 pins; 16 were red against the feat tip, the file went red as a whole in the revert check).
Stage D re-shot (IMPL, both themes): 04 md-model, md-annotate, md-preview, md-preview-follow, md-preview-combine, md-inspect, md-comment, md-draw, md-present-menu, md-edge-ai, md-esc; 01 cf-duplicate-width; 14 ed-ab-menu (menu shots are on the 04 fixture's Homepage).

## Done

| id | what | files |
|---|---|---|
| X1 | The `<= N px` breakpoint chip and the `+ N px` growth tag are Edit chrome (the what-shows `object-tools` cell): gone in Preview / Viewing / Present | `canvas-lib.tsx` (shared), `web-overlay-content.tsx` |
| X1 | No Inspector (sliders) corner icon while only Preview's fold hides panels (04 draws Canvases + the AI spark) | `client/v2/shell/corner-icons.jsx`, `app.jsx` (shared, one prop) |
| X1 | The Hide-panels toggle is pressed only when the PERSON hid them (`userHidden`), never by Preview's fold | `share-cluster-host.jsx` |
| X2 | Comment / annotation tool in Preview: no hover rim, no selection rim, no size tag on the design (`body[data-maude-annotating]`) | `inspect-overlay.tsx` |
| X4 | Re-shot: the Inspect island opens on a Preview cmd-click on this tip (Size and spacing, Colour and type, Export, Copy code, Advanced); the stage-D shot had caught it before the panel's entry animation ended | no code |
| X7 | Present menu 352 wide; the first row (Present from the selection) carries the accent-muted highlight | `share-cluster.css`, `mode-switch.jsx` |
| X8 | The AI tag speaks as the AI: `AI's new <artboard> - shown live` (spark pill), not `editing - <file>` | `artboard-activity-overlay.tsx`, `canvas-lib.tsx` |
| X9 | Esc leaves ONE mode segment on: a segment that loses its pressed state while focused gives the focus up | `mode-switch.jsx` |
| menus | Icon column (spark, duplicate, web, edit, export, trash; object: spark, duplicate, frame, lock, eye-off, trash) with the column kept for text-only rows; kit chevron instead of the text caret; accent-muted hover and open-flyout parent; submenu widths right-aligned (`Laptop  1280`); 268 / 292 wide; the first row no longer takes the focus ring on a mouse open (focus lands on the menu, arrows walk in); Move to trash / Remove are plain rows with the trash glyph and the key; the right-clicked artboard or object is selected under its menu | `context-menu.tsx`, `canvas-ds-icons.tsx` (+7 kit glyphs), `editing/artboard-menu.tsx`, `editing/object-menu.tsx`, `canvas-shell.tsx` |
| S1 | The Comments icon is drawn only when the canvas has open comments, an unread mention, or while its panel is open (prop `commentsShown`, default drawn) | `share-cluster.jsx`, `share-cluster-host.jsx` |

## Open

- **Cut / Copy / Paste rows (14 ed-obj-order, ed-ab-menu, 01)**: no object or artboard clipboard exists (`edit.copy/cut/paste` are text and annotation rows; CONTRACT §1). A clipboard (copy an element / artboard's source range, paste as an edit-op at the cursor or at the same gap) is a module of its own - proposed split: `V2-clipboard-objects`.
- **X3 (AI spark in Preview's fold)**: clicking the AI corner icon ends the fold for every panel by design (`CornerIcons.reveal` -> `onShow`), so the Canvases panel comes back with the chat. The board's state (folded, spark with a dot, AI working under the pointer) is reached by asking in Edit and then entering Preview (`_d-harness-g2/s04c.mjs`), shot that way now. A chat-only unfold needs `DockSlot` to show the AI island while `hidden` folds the main one (an `aiInFold` twin of `rightInFold`) - not started.
- **X2 rest**: a placed sticky is selected with Edit-style round handles, a dashed artboard rim and the `On Tablet - moves with it` tag (annotation selection in `annotations-layer.tsx`, `element-node.tsx`); the sticky tool falls back to Hand after a drop so no colour strip shows.
- **X9 rest**: no Comments panel docked when the Comment tool is armed in Preview (`comments-panel.jsx` is not opened by the lane; panel side and filters are board-side, CONTRACT §6); the composer has no Resolve and the send button is square (`canvas-comment-mount.tsx`).
- **X5 / X6** (Inspector card, Assets grid) belong to other builders (p8-c3-inspect, assets).
- md-preview-combine camera (A4 at 65 % from an overview), md-present-full pointer dot / trail at 1 s, md-edge-mixed per-kind Present, md-draw section / arrows / AI layer-read: not driven by the harness.
- The hint toast after a sticky (`cmd-Enter commits ...`) is a canvas toast with its own timeout; it is not cleared when the mode changes.
- Right-click on an object selects the hit element (deepest), not the visual parent row the critic named; the world (canvas) menu has no icon column (no board draws one).

## Decisions
- `v2-p8-c3-menu-trash-plain`: 14 owns the editing menus, so Move to trash / Remove are plain rows with the trash glyph and the key; 01's `danger` variant loses to the owning board.
- `v2-p8-c3-comments-icon-by-count`: the cluster's Comments icon follows board 10 (drawn only with comments or an open panel).
