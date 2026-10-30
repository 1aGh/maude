# critic-d - 04 Modes - V2-8.5 stage D re-check

_2026-10-24 - one critic, four lenses (design, copy, a11y, signature). Board `.design/ui/v2/04 Modes.tsx`. Shots: stage D on tip 6d19daa9a (IMPL re-shot, SPEC reused). Read-only; nothing edited, no server booted. Every re-shot id was read in dark (spec + impl full size); light was read for every id I marked `match` and for the chrome-only differences that decide a verdict (the remaining blockers are theme-independent unless noted)._

Fixture differences are not blockers (INDEX C1-C6: no title bar or tab strip, "YO - Local project" cluster, stand-in Homepage / Pricing / Combine-kampan, camera numbers, note strips). Board text that CONTRACT overrides is not a blocker (md-keys "still proposed", md-comment filter row without All).

## What stage C fixed (seen in the stage D shots)

R1 Edit chrome in Preview: the selection rim, name tag, size tag, badges 1.1-1.3 and rotate handle are gone on md-annotate, md-preview, md-preview-follow, md-preview-combine, md-inspect. R3 toolbars: Edit 40 px dock, Preview 48 px with the coloured sticky / marker / stickers glyphs and the divider after Hand (md-model, md-annotate). R4 panel fold holds on md-preview-follow, md-preview-combine. R5 Present pills are the island material (lift, canvas). R2 pins, link chip, AI rim (dashed orange spark) are drawn in the board's vocabulary.

## Remaining differences, by root cause (rows cite X1-X9)

| # | lens | root cause | spec | impl | owner |
|---|---|---|---|---|---|
| X1 | design | **Preview still draws Edit's breakpoint / growth chip** "<= 1440px" (and "<= 834px") at every artboard's top-right corner, plus a **right-corner sliders icon** over the canvas edge and the **panel-right toggle drawn pressed** with no panel open | Preview shows only the design, the annotation layer and pins; panel-right is unpressed | chip + icon + pressed toggle on md-annotate, md-preview, md-preview-follow, md-preview-combine, md-comment, md-draw, md-inspect, md-edge-ai | `artboard-growth-tag.tsx` via `canvas-lib.tsx:109` (fix-chrome "growth tag stays"), `client/v2/shell/corner-icons.jsx:101-117`, `share-cluster.css` panel-right pressed rule |
| X2 | design / signature | **Edit's object chrome survives in two Preview tools**: Comment tool still draws the hover rim + `556 x 40` tag on the heading (md-comment); a placed sticky shows edit-style round resize handles, a dashed artboard rim and the "On Tablet - moves with it" tag (md-draw) | none of these | drawn | `editing/` selection for annotation targets, `annotations-layer.tsx` sticky handles |
| X3 | design | **Panels unfold again after an AI prompt**: md-edge-ai has the Canvases panel open over the previewed artboard (R4 fix claims the prompt no longer unfolds) | folded to its corner icon | open (260 px, over the Made-by-AI artboard) | `app.jsx` `panelOpenDecision` / `use-canvas-mode-lane.js:52` (AI-prompt path) |
| X4 | design / copy / a11y | **Preview does not open Inspect on cmd-click** (R6 never fixed): only the measure tag `97 x 35` | Inspect island: Size and spacing, Colour and type, Export PNG 1x / 2x / SVG / Handoff, Copy code, Advanced CSS | no panel | `inspect-host.jsx:34`, `inspect-model.js:131`, `inspect-canvas.ts:33` |
| X5 | design / copy | **Edit's Inspector is the full docked panel, not the board's compact card**; breadcrumbs are truncated raw frames (`Des... > Fr... > Fr... > Fr...`), On click is below the fold; on md-edit-component the Inspector is open behind the picker on a Section frame, and the picker's variant control is small text chips, not the `.seg` Primary / Secondary / Ghost; the picker floats top-right, far from the Components slot, which is not drawn armed | compact property card with On click row focused; picker anchored above the armed Components slot, placed `Button - Secondary` chip | full panel, picker 300 px wide at the right | `client/v2/inspector/` (fix-inspector: "followed 14, kept full sections"), `inspector/component-picker.jsx`, `inspector/crumbs.jsx` |
| X6 | design | **Assets panel is not the board's grid**: 3 columns, no filenames, "Not used" chip, two "+" buttons and a `cmd-K` hint in the field (fix-assets says no `cmd-K`); Image tool not armed; no photo placed, no `Hero image - fills, cropped to fit` chip | 2 columns with filenames, selected thumb ringed, count right, armed Image slot, accent chip on the hero | as listed | `client/v2/left-panel/assets-panel.jsx:592` and grid, image drop path |
| X7 | design | **Present menu is shot in the wrong state** (Preview, a sticky and the `cmd-Enter commits...` toast still up, mode glyph not Edit), the menu is 300 px not 352, and the first row has no accent-muted highlight | opened from Edit with Post 1:1 selected, first row highlighted | as listed | `share-cluster.css:302`, `mode-switch.jsx:322-339`, `annotations-layer.tsx:2776` (hint outlives the mode) |
| X8 | design / copy / signature | **AI live tag speaks as a file name**: `editing - Combine-kampan.tsx` on both artboards; no `AI's new ... shown live` tag in spark; "Made by AI" sits above-right of the label row | spark tag in AI's voice | v1 badge text | `artboard-activity-overlay.tsx:68` (fix-chrome "still open") |
| X9 | design | **Comment surfaces**: no Comments panel (spec docks it with Open / Mine / Resolved), composer head is the artboard name only with an x, no Resolve, square send; mode pill shows two highlighted segments after esc (Preview keeps a focus ring) on md-esc | Comments panel + thread with Resolve; one pressed segment | as listed | `comments-panel.jsx` (not opened by the lane), `canvas-comment-mount.tsx`, `share-cluster.css:290-295` |

Not-driven states (not product work, but the shot does not show the board's state): md-keys hover tooltip (native `title` only), md-present-full pointer dot and trail (controls had faded), md-edge-mixed per-kind Present run (canvas mode shot), md-annotate stages 1-3 and 5, md-esc rows 2-11, md-draw section / arrows / AI layer-read.

## Per id (dark | light verdict identical unless noted)

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| md-model | dark, light | **match** | none. Mode switch, Edit dock (40 px, 18 px glyphs, divider before More) and Share cluster are the board's. Warnings only: extra Comments bubble in the cluster, no key caps under the tools (the board draws them only in the `keys` legend variants) |
| md-keys | dark, light | differs | design/a11y: the hover on the mode glyphs shows no word or key (native `title`, never rendered; not on keyboard focus); the board's legend with caps (V H F R P T I, cmd-alt-P ...) has no live counterpart in the shot (cannot confirm the caps; the board's "still proposed" text is overridden by CONTRACT) |
| md-edit | dark, light | differs | X5 (full Inspector, On click and Uses-link below the fold, raw breadcrumbs); the selection cluster on "See pricing" is a jumble of overlapping handles and the `See pricing - 126 x 46` tag overlaps the `Go to Pricing` chip; no 112 gap measure (not driven) |
| md-edit-image | dark, light | differs | X6 |
| md-edit-component | dark, light | differs | X5 (picker anchor, variant control, open Inspector, Components slot not armed, no placed chip) |
| md-motion | dark, light | unreachable | storyboard |
| md-annotate | dark, light | differs | X1; board stage 5 (N in Edit: sticky armed with its colour strip) and the 0 / 40 / 140 ms frames not shown. The stage-4 toolbar itself matches (48 px, glyph colours, divider) |
| md-preview | dark, light | differs | X1 (breakpoint chip, sliders icon, pressed panel-right). The Preview pill, toolbar, panel fold and a clean artboard match |
| md-preview-follow | dark, light | differs | X1 only (back chip, `Previewing Pricing`, folded panel all match) |
| md-preview-combine | dark, light | differs | X1; camera dives to A4 at 65 % from an overview where the board stays on all 15 (`preview/preview-camera.tsx:100-112`, still open since stage B; not a fixture, the board says "you pan across all 15") |
| md-present-menu | dark, light | differs | X7 |
| md-present-lift | dark, light | **match** | none in the lenses. End state is the board's frame 3: island pill `1 / 3 - Desktop - esc to leave`, radius-lg, body-face kbd, no chrome. The 0 / 40 % frames are motion (same class as md-motion) and the dark stage is not visible because the fixture artboard fills the window; stage B rated both warnings |
| md-present-full | dark, light | differs (cannot confirm) | the shot has no controls pill (faded by capture time) and no pointer dot / trail, so the board's state is not shown; re-shoot at about 1 s with the L pointer on |
| md-present-video | - | unreachable | needs a footage-backed 9:16 video artboard in the fixture (`video-present.jsx` exists) |
| md-present-canvas | dark, light | **match** | none. Pill `Presenting the canvas - N % - esc to leave` is the island (blur, radius-lg, body-face kbd; in light it sits on the page so reads lighter than the spec's pill over dark tiles, same token), no chrome, no pins. Zoom and tiles are fixture/C6 |
| md-presenter | - | unreachable | needs the desktop shell with a second display (a desktop e2e scenario) |
| md-present-link | - | unreachable | needs a hub-backed cloud project with a viewer link |
| md-comment | dark, light | differs | X9, X2 (hover rim + `556 x 40` tag in Preview), X1; Canvases panel no longer open (R4 held) |
| md-comment-only | - | unreachable | needs a Can comment role (hub, second person) |
| md-draw | dark, light | differs | X2 (resize handles, dashed rim, `On Tablet - moves with it`), X1, hint toast `cmd-Enter commits and creates the next one beside it.` still plain-key wording, sticky tool falls back to Hand so no colour strip; section, arrows and AI layer-read not driven |
| md-inspect | dark, light | differs | X4 |
| md-edge-ai | dark, light | differs | X3, X8; the Before / After pills and dashed spark rim are in (stage C), "Made by AI" label placement and spark-fg tags still open |
| md-edge-viewer | - | unreachable | needs a cloud project with a viewer role (hub) |
| md-edge-mixed | dark, light | differs (cannot confirm) | the shot is Present-the-canvas (pill matches); the six per-kind Present - Artboards treatments are not shown; needs a Present - Artboards walk on a mixed-kind Combine-kampan fixture |
| md-edge-offline | - | unreachable | needs the desktop shell Presenter view offline |
| md-esc | dark, light | differs | X9 (two segments read as on after esc: Edit pressed + Preview focus ring); ten of eleven rows not driven |

## Lens counters

- design: X1-X9 above. Biggest effect: X1 touches 8 ids and decides md-preview / md-preview-follow, which are otherwise exact.
- copy: stage-B blockers still open: Inspector titles by raw tag / `Uses project` (X5, below the fold or truncated, cannot confirm closed), `editing - <file>` (X8), Inspect words (X4). Closed: none confirmable from the shots.
- a11y: M1 (seg chosen state by tint only) and M2 (Present-menu row focus) are not visible in the shots; fix files do not claim them. md-inspect is a blocker until X4 lands. Unreachable ids stay blockers by reachability.
- signature: the Preview frames no longer carry Edit's selection (root cause 1 closed); remaining blockers are md-edge-ai (X8, no live tag) and md-preview-combine (camera).

```json
{"canvas":"04 Modes","dir":"04-modes","match":["md-model","md-present-lift","md-present-canvas"],"match_one_theme":{},"differs":["md-keys","md-edit","md-edit-image","md-edit-component","md-annotate","md-preview","md-preview-follow","md-preview-combine","md-present-menu","md-present-full","md-comment","md-draw","md-inspect","md-edge-ai","md-edge-mixed","md-esc"],"unreachable":["md-motion","md-present-video","md-presenter","md-present-link","md-comment-only","md-edge-viewer","md-edge-offline"]}
```
