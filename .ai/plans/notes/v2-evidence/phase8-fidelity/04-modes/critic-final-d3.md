# critic-final-d3 - 04 Modes - V2-8.5 stage D3 (merged tip 63592219a)

_2026-10-25 - one critic, four lenses. Read-only. Every reachable id read fresh in the D3 pairs (both themes read for every id called match; for differs ids one theme at minimum, the second theme only where it showed a different state). Lead decisions applied: contract-over-board, owning boards, toast dock, Connect no API-key row, Inspector full per 14, comment tool docks the panel. Fixture differences are not blockers._

## Per id

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| md-model | dark, light | match | none |
| md-keys | dark, light | differs (cannot confirm) | mode-glyph hover word / key and the legend with caps are not shown in the shot; hover is native title only |
| md-edit | dark, light | differs | Canvases panel stays open with the selection (spec: folded); handle pile on "See pricing" at 31 % and the `See pricing - 126 x 47` tag overlaps the `Go to Pricing` chip; no 112 gap measure. Full Inspector instead of compact card is overruled by 14 |
| md-edit-image | dark, light | differs | Assets: 3-col tiles without filenames, no selected ring, "Not used" chip, Image tool not armed, no placed photo / `Hero image - fills, cropped to fit` chip |
| md-edit-component | dark, light | differs | picker floats top-right on a Frame selection, not anchored above an armed Components slot; no `Primary / Secondary / Ghost` seg; no placed `Button - Secondary` chip; list starts with Brand, not "Studio site system" |
| md-motion | - | unreachable | storyboard; needs a recorded 0 / 40 / 140 / 220 ms frame series |
| md-annotate | dark, light | differs (cannot confirm: stage 5) | stage-4 toolbar matches; stage 5 (N in Edit: sticky armed, colour strip above toolbar) not shown, Hand stays armed |
| md-preview | dark, light | match | clean artboard, pill, toolbar, folded panels (seeded annotations / camera are fixture) |
| md-preview-follow | dark, light | match | back chip, Previewing Pricing, panels folded (closed since D2); Pricing content is stand-in |
| md-preview-combine | dark, light | differs | camera lands on A4 at 65 % instead of the 14 % overview of all boards; no Playing badge / sticky. `preview/preview-camera.tsx:100-112` |
| md-present-menu | dark, light | differs | panels now folded, but shot state is Preview with Hand armed and the `cmd-Enter commits...` toast up (spec: Edit, selected artboard, undo/redo island); menu has no `Presenter view on another display` row and `Copy presentation link` is disabled "in a cloud project" |
| md-present-lift | dark, light | match | end state: island pill `1 / 3 - Desktop - esc to leave`, no chrome (lift motion is md-motion class) |
| md-present-full | dark, light | differs (cannot confirm) | no controls pill, no pointer dot / trail, no dark stage; web artboard fills the window |
| md-present-video | dark, light | differs | top-right `esc Back to the canvas` chip the board does not draw; transport is a wide scrub bar with loop button, no deck counter / kind name / `esc to leave`; 16:9 blue test clip, not the 9:16 Reel |
| md-present-canvas | dark, light | match | pill `Presenting the canvas - N % - esc to leave`, no chrome, no pins |
| md-presenter | - | unreachable | second display / desktop shell (desktop e2e scenario) |
| md-present-link | - | unreachable | hub-backed cloud project with a viewer link |
| md-comment | dark, light | differs | Comments panel now docks (closed since D2) but has an extra `All` tab and an empty "No comments" state; composer is a new-comment card on Homepage with no thread, replies, Resolve or @ suggest (needs seeded thread fixture; `extra-impl-md-comment-thread` shows only a one-row list) |
| md-comment-only | - | unreachable | Can comment role (hub, second person) |
| md-draw | dark, light | differs | wrong state: a placed sticky selected with Edit-style handles, selection toolbar (colours / Medium / lock / trash), dashed artboard rim, `On Desktop - moves with it` tag, `cmd-Enter commits...` toast; no section, arrows, AI chat, colour strip |
| md-inspect | dark, light | differs | only the `97 x 35` measure tag; Inspect island (Size and spacing, Colour and type, Export, Copy code, Advanced CSS) not on screen |
| md-edge-ai | dark, light | differs | AI tag a tiny chip inside the artboard's top-right (spec: spark pill above-right); light rim is purple not spark orange; no `+ AI` pointer label; spark corner icon has no dot; Combine-kampan stand-in |
| md-edge-viewer | - | unreachable | cloud project with a viewer role |
| md-edge-mixed | dark, light | differs (cannot confirm) | shot is Present-the-canvas; the six per-kind Present - Artboards treatments are not shown |
| md-edge-offline | - | unreachable | desktop Presenter view offline with a missing clip |
| md-esc | dark, light | match | after-esc state: Edit, one pressed segment, no stray focus ring |

## Root causes of the remaining differences
1. Inspect island absent after cmd-click in Preview (md-inspect); entry or harness timing, stage-B a11y / copy blocker still open.
2. Preview camera dives to one artboard instead of the overview (md-preview-combine, `preview-camera.tsx:100-112`).
3. Comments: panel docks now, but thread / replies / Resolve / @ suggest not drivable on the fixture; extra `All` tab (`comments-panel.jsx`, `canvas-comment-mount.tsx`).
4. AI tag / rim: in-artboard 7 px chip, purple light rim, no `+ AI` label (`artboard-activity-overlay.tsx`).
5. Edit selection: Canvases panel stays open, handle pile + tag over link chip (md-edit, md-edit-component).
6. Assets grid / component picker anchor + variant seg, tools not armed (`assets-panel.jsx`, `component-picker.jsx`).
7. Present: menu lacks Presenter-view row and shot is in Preview state; video transport and chip differ; full / mixed per-kind states not driven.
8. Harness states not reached: md-draw (sticky tool + AI chat), md-annotate stage 5, md-keys hover.

```json
{"canvas":"04 Modes","dir":"04-modes","match":["md-model","md-preview","md-preview-follow","md-present-lift","md-present-canvas","md-esc"],"match_one_theme":{},"differs":["md-keys","md-edit","md-edit-image","md-edit-component","md-annotate","md-preview-combine","md-present-menu","md-present-full","md-present-video","md-comment","md-draw","md-inspect","md-edge-ai","md-edge-mixed"],"unreachable":["md-motion","md-presenter","md-present-link","md-comment-only","md-edge-viewer","md-edge-offline"]}
```
