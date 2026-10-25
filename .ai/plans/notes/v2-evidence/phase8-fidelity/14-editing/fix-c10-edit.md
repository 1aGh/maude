# P8 stage C · round 10 · c10-edit — fix report (done vs open)

Branch `p8-c10-edit` (from feat/maude-v2 55850113d). Scope: the MUST rows of 14 critic-bar4 (ed-lay-auto, ed-lay-free, ed-text-edit, ed-pen, ed-edge-paste).

## Done (product, each with a fail-first test; reverted once and watched red)
| id | change | test |
| --- | --- | --- |
| ed-lay-auto | the Layout card of an auto-layout frame ends on "3 frames, each Fills the width." — the canvas reads the children's sizing into the selection (`kids`: count, shared kind, one width word: Fills the width / Hugs its content / a fixed width / widths differ) | `p8-c10-edit-kids`, `p8-c10-edit-kids-card` |
| ed-lay-free | the free-placement line drew nothing for Datum: an object straight on the page had no frame (the page root is the artboard, so no Layers row). `placementOf` now names the artboard by its label ("Post 1:1 · Combine 2026 places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner.") | `p8-c10-edit-placement` |
| ed-text-edit | while a Czech text is typed, the ties show on the page's other Czech copy too (the board draws the arcs under "v" and "s" of the body line while the headline is edited); capped at 40 lines, found on input / focus, not per frame | `p8-c10-edit-ties-page` |
| ed-pen | (1) a click on a point of the path being edited kept nothing: the Pen overlay is a fixed svg over the world, so both marquee layers read the press as EMPTY WORLD and their bare-click rule cleared the selection (point editing left; no chip, no card). Both now leave `.ed-pen-svg` alone. (2) the Point card — Corner Smooth / Sharp, X · Y — for the selected point (the canvas says which point on the path's payload `data-dc-pen-point`; the card writes ONE `path.edit` through `/_api/edit-op` and records one undo step). (3) Stroke and Ends read from the file (`stroke*` joined KNOB_PROPS: they sat in `customStyles`, so Stroke read "None" and Ends was hidden). (4) a drawn path is "Path" in Layers and the inspector title (it was the svg's "Icon"). (5) a point under the pointer says Smooth / Sharp in a quiet tag; the picked one keeps the loud one | `p8-c10-edit-pen-click`, `p8-c10-edit-pen-point`, `p8-c10-edit-pen-card`, `p8-c10-edit-pen-points-live` |
| ed-edge-paste | a picture placed ON the page (absolute) is not a section: no "Image · new section" frame/tag (`sectionHost` / the new-section compare count only in-flow children) | `p8-c7-new-section` (extended) |

## Done (harness, `_c10-harness-g5` on top of `_d5` + `_c8e`)
ed-pen: a path of a sharp start, two dragged smooth points and a sharp end; double-click it, pick the third point (handles, "Smooth" tag, Point card), the pointer resting on the end (quiet "Sharp" tag). Side shot `ed-pen-draw`: three clicks and the pointer back on the first point (the "Click here to close" ring). ed-text-edit: the Alligators fixture's body line carries `lang="cs"`.

## Open
1. ed-pen: the board draws two states in one frame (a finished path being edited AND a new one being drawn with the "Click here to close" ring + chip); the app shows one at a time, so the drawing state is the side shot `ed-pen-draw`. The board's thick yellow stroke vs the Pen's default accent 4 px is fixture.
2. ed-lay-auto: Gap token menu and the Convert row are side states (unchanged).
3. ed-edge-paste: "Make editable needs Figma Dev Mode" note (S8.17 decision, unchanged).
4. ed-comp-pick, ed-comp-instance, ed-edge-huge, ed-text-style: as fix-c8-edit (not in this round's MUST list).
