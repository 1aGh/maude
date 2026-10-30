# P8 stage C · round 8 · c8-edit — fix report (done vs open)

Branch `p8-c8-edit` (from feat/maude-v2 296623789). Scope: the MUST rows of 14 critic-bar3.

## Done (product, each with a fail-first test; reverted once and watched red)
| id | change | test |
| --- | --- | --- |
| ed-lay-auto | the selection tag reads "Services → Auto layout" while a gap is dragged (token ruler up); the size is back after | `p8-c8-edit-layout-tag` |
| ed-lay-reorder | the four hint pills (Let go · esc · ⌥ · Drag out) under the work; the tag is a pill | `edit-layout-client` |
| ed-obj-multi | Layers lights every object of a multi-selection (`selectedAlso`) | `p8-c8-edit-layers-multi` |
| ed-comp-pick | the picker's highlighted row is ghosted on the artboard centre line (`place-component` modes `preview` / `cancel`; `onPreview` from app.jsx, one line) | `p8-c8-edit-comp-preview` |
| ed-lay-free | the Position card says "<frame> places things freely — no auto layout. Constraints keep Datum 64 from the top-right corner." | `p8-c8-edit-free-line` |
| ed-inspector | a frame or Button that holds text shows the Style row in its Type group | `p8-c8-edit-frame-style` |
| ed-edge-paste | `image.place` loose + `at`: a pasted Figma picture lands ON the page (the artboard's element child; the artboard itself when the page is a component call) at the paste point, absolute | `edit-ops-image`, `edit-images-client` |

## Done (harness, `_c8e-harness-g5`)
Gap held (ruler + hint), lifted card (tag + slot + pills), object menu on the SELECTED button with Layers hide/lock rows, picker row
highlighted with the page slid clear of the panel, instance placed in a frame with its text overridden (dot, "1 change from Button · Reset",
"Update Button for every canvas…"), text in edit mode (Language Čeština line), Datum frame, real Shape (Shape section: Kind, W/H, four corners),
text style "Title · changed" + Reset, crop mode on an asset photo (Fit Crop, Zoom 128 %, Adjust rows), pen path in point editing (Path
inspector "Pen · 4 points"), edge-huge inside the page (sticky name, minimap, "You're looking at …"). No AI-run outline in ed-shape / ed-text-style.

## ed-edge-ai / ed-edge-tereza (the D5 frames, not opened by the critic) — do NOT match
- ed-edge-ai: the board outlines only the footer ("AI is drawing the footer"), the headline is yours and the inspector says "AI is changing Footer in this
  artboard. Everything else stays yours." The shot has the stub AI run's "AI is working" outline on ALL THREE artboards, zoom 28 %, the headline
  selected with no AI note in the card. The stub run has no element scope, so the footer-only state is not reachable here (e2e).
- ed-edge-tereza: the board is a second person's ring on See pricing with the read-only card "Tereza is editing See pricing…". The shot is the
  local project with See pricing selected by you, fields editable, no second person. Unreachable without a second session (e2e).

## Open
1. ed-lay-auto: the "3 cards, each Fills the width." summary line (needs the children's sizing in the inspector payload); the Gap token menu and Convert row are side states.
2. ed-comp-pick: the picker covers the artboard centre on wide pages — the shot slides the page; a product answer would anchor the panel off-centre.
3. ed-pen: clicking a point in point editing drops the selection (the shot stops at the Path inspector; no Smooth/Sharp chip, no "Click here to close" ring, no Point section: Corner Sharp/Smooth, X · Y).
4. ed-edge-paste: the artboard-growth tag still reads "image · new section" over a picture placed on the page; "Make editable needs Figma Dev Mode" note (S8.17 decision).
5. ed-text-style: only the "changed" state is shot; Uses / Detached are side states. ed-text-edit: typed ties for one-letter words are not drawn.
6. ed-comp-instance: one override (text), the board shows two; the Variant flyout is a side state.
7. ed-edge-huge: the artboard, not the Tým section, is selected (the section line "You're looking at …" lives in the artboard card).
