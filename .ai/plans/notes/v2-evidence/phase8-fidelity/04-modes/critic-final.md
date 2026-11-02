# critic-final - 04 Modes - V2-8.5 stage D2 (merged tip d3881fe41)

_2026-10-24 - one critic, four lenses (design, copy, a11y, signature). Read-only. Every reachable id was read fresh in both themes (committed pairs, impl-only frames at native size where a detail decided). Lead decisions applied: contract-over-board, owning board wins (Inspector full per 14, so a compact-card difference is not a blocker), toast dock/top rule, Connect modal, '+ New canvas' row. Fixture differences (no title bar / tab strip, "YO - Local project" cluster, stand-in Homepage / Pricing / Combine-kampan, camera numbers, note strips, seeded annotations) are not blockers._

## Per id

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| md-model | dark, light | match | none (switch, 40 px Edit dock, Share cluster; extra Comments bubble is a warning) |
| md-keys | dark, light | differs (cannot confirm) | mode-glyph hover shows no word / key (native title only, nothing in the shot); legend with caps not shown live |
| md-edit | dark, light | differs | Canvases panel stays open with the selection (spec: folded to its icon); selection cluster on "See pricing" at 31 % is a pile of overlapping handles and the `See pricing - 126 x 47` tag overlaps the `Go to Pricing` chip; no 112 gap measure. (Full Inspector instead of the compact card is overruled by 14.) |
| md-edit-image | dark, light | differs | Assets panel: 3-col tile grid without filenames, no selected-thumb ring, "Not used" filter chip, two "+" buttons; Image tool not armed; no photo placed, no `Hero image - fills, cropped to fit` chip. `assets-panel.jsx` grid + image drop path |
| md-edit-component | dark, light | differs | picker floats top-right 300 px, not anchored above an armed Components slot (slot not armed); variant control missing the `Primary / Secondary / Ghost` seg; no placed `Button - Secondary` chip; Inspector open behind on a Frame; list lists Brand first, not "Studio site system" + Button open. `inspector/component-picker.jsx` |
| md-motion | - | unreachable | storyboard; needs a recorded frame series (0 / 40 / 140 / 220 ms) from the morph |
| md-annotate | dark, light | differs (cannot confirm: stage 5) | stage-4 toolbar and clean artboard match; board stage 5 (N in Edit: sticky armed, colour strip above the toolbar) and the 0 / 40 / 140 ms frames are not shown |
| md-preview | dark, light | match | clean artboard, pill, 48 px toolbar with the divider, folded panels, no chip / selection. Camera 65 % Tablet and absent seeded sticky / circle / arrow are fixture / C6 |
| md-preview-follow | dark, light | match | back chip `< Homepage`, `Previewing Pricing`, esc to edit, folded panel. Pricing content is the stand-in |
| md-preview-combine | dark, light | differs | camera dives to A4 at 65 % from an overview; spec keeps all 15 boards at 14 % with the `Playing` badge and a sticky. `preview/preview-camera.tsx:100-112` |
| md-present-menu | dark, light | differs | dark: Canvases panel open over the menu's canvas, no `Presenter view on another display` row, `Copy presentation link` shown disabled, no undo/redo island state match; light: shot in the wrong state (Preview-style sticky groups on the canvas, `Cmd-click groups the selection` toast up, mode glyph not Edit-on-selection) |
| md-present-lift | dark, light | match | end state of the board's frame 3: island pill `1 / 3 - Desktop - esc to leave`, no chrome. 0 / 40 % frames are motion (md-motion class), not a state |
| md-present-full | dark, light | differs (cannot confirm) | no controls pill, no pointer dot / trail, no dark stage visible (web artboard fills the window); the board's state is not shown |
| md-present-video | dark, light | differs | newly reached, but: top-right `esc Back to the canvas` chip the board does not draw; transport is a wide scrub bar, not the board's compact pill with deck counter `9 / 14`, kind name and `esc to leave`; 16:9 clip, not the 9:16 Reel. `present/present-controls.jsx` |
| md-present-canvas | dark, light | match | pill `Presenting the canvas - N % - esc to leave`, no chrome, no pins; zoom / tiles are fixture |
| md-presenter | - | unreachable | needs desktop shell with a second display (desktop e2e scenario) |
| md-present-link | - | unreachable | needs a hub-backed cloud project with a viewer link |
| md-comment | dark, light | differs | no Comments panel docked (Open / Mine / Resolved); composer head is the artboard name only, no thread with replies, no Resolve, no @ suggest, square send; board is on Pricing. `comments-panel.jsx`, `canvas-comment-mount.tsx` |
| md-comment-only | - | unreachable | needs a Can comment role (hub, second person) |
| md-draw | dark, light | differs | wrong state in both themes: dark is Edit with Canvases panel open and no Preview / sticky colour strip / AI chat; light shows the Templates picker over the canvas. No section, arrows, AI layer-read |
| md-inspect | dark, light | differs | the shot shows only the `97 x 35` measure tag; no Inspect island (Size and spacing, Colour and type, Export PNG 1x / 2x / SVG / Handoff, Copy code, Advanced CSS). Reproducible stage-B a11y / copy blocker. `inspect-host.jsx` |
| md-edge-ai | dark, light | differs | AI tag is a ~7 px chip inside the artboard's top-right, not the spark pill above-right; rim is purple (spec orange spark); no `+ AI` pointer label; brown band across the top of the artboard; Combine-kampan stand-in |
| md-edge-viewer | - | unreachable | needs a cloud project with a viewer role (hub) |
| md-edge-mixed | dark, light | differs (cannot confirm) | shot is Present-the-canvas; the six per-kind Present - Artboards treatments are not shown. Needs a Present - Artboards walk on a mixed-kind fixture |
| md-edge-offline | - | unreachable | needs desktop Presenter view offline |
| md-esc | dark, light | match | after-esc state: one pressed mode segment (Edit), no stray focus ring; the 11-row table is behaviour documentation (C5), not UI |

## Root causes of the remaining differences
1. Preview camera: preview-combine dives to one artboard instead of the overview (`preview/preview-camera.tsx:100-112`).
2. md-inspect: the Inspect island is not on screen after cmd-click in Preview (entry / harness or product; stage-B blocker open).
3. Comment surfaces: no docked Comments panel, composer lacks thread / Resolve / @, round send (`comments-panel.jsx`, `canvas-comment-mount.tsx`).
4. AI tag / rim: tiny in-artboard chip, purple not spark orange, no `+ AI` label (`artboard-activity-overlay.tsx`).
5. Edit selection at low zoom: handle pile + tag over the link chip; Canvases panel stays open on selection (md-edit, md-edit-component).
6. Assets / component picker: Assets grid (names, ring, filter chips), picker anchor + variant seg, tools not armed (`assets-panel.jsx`, `component-picker.jsx`).
7. Present: menu lacks the Presenter-view row and wrong shot state; video transport differs; full / mixed per-kind states not driven.
8. Harness states not reached: md-draw (Preview + sticky + AI chat), md-annotate stage 5, md-keys hover.

```json
{"canvas":"04 Modes","dir":"04-modes","match":["md-model","md-preview","md-preview-follow","md-present-lift","md-present-canvas","md-esc"],"match_one_theme":{},"differs":["md-keys","md-edit","md-edit-image","md-edit-component","md-annotate","md-preview-combine","md-present-menu","md-present-full","md-present-video","md-comment","md-draw","md-inspect","md-edge-ai","md-edge-mixed"],"unreachable":["md-motion","md-presenter","md-present-link","md-comment-only","md-edge-viewer","md-edge-offline"]}
```
