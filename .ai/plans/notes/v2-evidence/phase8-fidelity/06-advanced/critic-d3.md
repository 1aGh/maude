# critic-d3 — 06 Advanced · V2-8.5 stage D, after round 3 (one critic, four lenses)

_Board `.design/ui/v2/06 Advanced.tsx`. Round 3 re-shot only ad-history and ad-pinned (INDEX "stage D, round 3"); full-size pairs read from the "round 3:" path in full-size-path.txt. Every other id is carried from critic-d.md (no new shot, no upgrade). Read-only._

Summary: 1 id matches in both themes (ad-open-all, carried), 15 differ, 9 unreachable.

## Re-shot in round 3

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ad-history | dark, light | differs | D: the floating card with rounded corners is now right (no dock column; Undo/Redo/zoom island and content-height Canvases panel also draw). Still differs: an All / Named / Made by AI / People seg sits above the list, the board has none; the Compare + Restore this version row under the list is absent (shot has only a Now row and "Version history starts here" and no selected version; fixture); the fold body shows only Compare / Project, so Branch, Drafts, Remote, "Changed in this version" with diff, "Not in a version yet" and the git action buttons are not drawn (local project; cannot confirm). "Name this version…" ghost on the Now row is not on the board. A (cannot confirm): chosen-segment cue. |
| ad-pinned | dark, light | differs | D: the board pins Canvases left (tree with folders, "Advanced · Files, folder, Trash" at the foot) AND the Inspector right (Artboard, Preset/Size/Fill, Advanced folds open, In code rows) with the "Drag · double-click resets · ← → move 8" chip; the shot pins only the AI panel, the Inspector column and the chip are not drawn, and the Canvases panel is the floating panel, not the pinned one. The pinned AI column carries the 03 chat rows, not drawn on this board. A: pinned Canvases/Inspector state not shown (cannot confirm). |

## Carried from stage D (critic-d.md, not re-shot in round 3)

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| ad-map, ad-why, ad-trace | both | unreachable | documentation boards |
| ad-ds | both | unreachable | needs a seed that writes a real DS board (round 3 made `ds make` list the made system, but no new shot) |
| ad-menus | both | unreachable | native menu bar, desktop-e2e only |
| ad-edge-sync, ad-edge-hub | both | unreachable | hub-linked fixture |
| ad-edge-where | both | unreachable | viewer-origin + comment-only + offline fixtures |
| ad-edge-remember | both | unreachable | multi-day per-Mac memory story |
| ad-left | both | differs (carried) | extra "Open canvas" row; foot line wraps; row menu / Trash / Layers-fold states not in frame |
| ad-inspector | both | differs (carried) | fold body below crop; fold under ~15 plain rows (round 3 Inspector card not re-shot) |
| ad-ai | both | differs (carried) | Model/Effort/Fast mode/etc. rows absent; selects not the 140x28 kit select; glyphs missing; composer not one 40 px row |
| ad-share | both | differs (carried) | values in bordered inputs; extra "Open in the Mac app" line; sheet wider than 400 |
| ad-timeline | both | differs (carried) | raw keys; no ruler/diamonds/easing; extra tool row; light beat clips solid black |
| ad-export | both | differs (carried) | two-column body; no File names / terminal blocks; "1 ×" not 2.5×; switch cut off |
| ad-diag | both | differs (carried) | board is the Menu > Diagnostics submenu, shot is the sheet |
| ad-logs | both | differs (carried) | no "Show in Finder"; extra Refresh; reload toast not shown |
| ad-syncd | both | differs (carried, cannot confirm) | frame is the Logs sheet; needs cloud-linked fixture in trouble |
| ad-settings | both | differs (carried, cannot confirm) | opens General, not Advanced; three columns not shown |
| ad-search | both | differs (carried) | query "advanced" not "copy", no shortcuts sheet, fallback chevron rows |
| ad-code | both | differs (carried, cannot confirm) | palette only, code panel not opened |
| ad-edge-syntax | both | differs (carried) | closed card only; no code excerpt / last-good boards; provenance clause needs server signal |
| ad-open-all | both | match (carried) | none |
