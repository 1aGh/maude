# critic-d3 - 04 Modes - V2-8.5 stage D re-check after round 3

_2026-10-24 - one critic, four lenses. Read-only. Round-3 pairs read at full size from `.scr/pairs/04-modes/` of worktree agent-a79ab1936d7f7e854 (md-model, md-annotate, md-preview, md-preview-follow, md-preview-combine, md-inspect, md-comment, md-draw, md-present-menu, md-edge-ai, md-esc; dark + light). Ids not re-shot in round 3 are carried from critic-d.md._

## What round 3 closed (seen in the shots)
X1 closed: no breakpoint / growth chip, no sliders corner icon, panel-right toggle unpressed in Preview (md-annotate, md-preview, md-preview-follow, md-preview-combine, md-inspect, md-edge-ai). X3 closed in the board's own state (md-edge-ai: panels folded). X9 mode switch: one segment on after esc (md-esc). X8 partly: the tag now speaks as AI ("AI's new A4 - plakat - shown live").

## Per id

| id | theme | verdict | remaining blockers |
|---|---|---|---|
| md-model | dark, light | match | none |
| md-keys | dark, light | differs (carried from stage D) | hover shows no word / key; legend caps not shown |
| md-edit | dark, light | differs (carried) | X5 full Inspector, jumbled selection cluster / tag overlap |
| md-edit-image | dark, light | differs (carried) | X6 Assets grid |
| md-edit-component | dark, light | differs (carried) | X5 picker anchor / variant control / Components slot not armed |
| md-motion | - | unreachable | storyboard; needs a recorded motion frame series |
| md-annotate | dark, light | differs (cannot confirm: stage 5) | X1 closed and stage-4 toolbar matches; board stage 5 (N in Edit: sticky armed, colour strip above the toolbar) is not shown (sticky tool falls back to Hand) |
| md-preview | dark, light | match | clean artboard, pill, 48 px toolbar, folded panels. Seeded annotations / pointer are fixture; camera 81 % / Tablet is C6 |
| md-preview-follow | dark, light | match | back chip, "Previewing Pricing", folded panel, no chip / icon |
| md-preview-combine | dark, light | differs | camera lands on A4 at 65 % from an overview; spec shows all artboards (14 %), Playing badge, sticky; `preview/preview-camera.tsx:100-112` |
| md-present-menu | dark, light | differs | dark: panel open, no undo / redo / zoom island bottom-left (spec has it), no "Presenter view on another display" row, no pointer to selected artboard; light: shot in the wrong state (Preview, sticky, `cmd-Enter commits...` toast still up, mode glyph not Edit) |
| md-present-lift | dark, light | match (carried) | none |
| md-present-full | dark, light | differs (cannot confirm, carried) | controls pill and pointer dot / trail not shown |
| md-present-video | - | unreachable | needs a footage-backed 9:16 video artboard |
| md-present-canvas | dark, light | match (carried) | none |
| md-presenter | - | unreachable | needs desktop shell with a second display (e2e) |
| md-present-link | - | unreachable | needs hub-backed cloud project with a viewer link |
| md-comment | dark, light | differs | no Comments panel (Open / Mine / Resolved), composer head is the artboard name with an x, no Resolve, square send, no thread with replies / @ suggest; board is on Pricing |
| md-comment-only | - | unreachable | needs a Can comment role (hub, second person) |
| md-draw | dark, light | differs | placed sticky still shows Edit-style round resize handles, selection toolbar (colours / Medium / lock / trash), dashed artboard rim and `On Tablet - moves with it` tag; plain-key hint toast `cmd-Enter commits ...` still up; no section / arrows / AI layer-read, no AI chat |
| md-inspect | dark, light | differs (cannot confirm) | shot shows only the `97 x 35` measure tag, no Inspect island (Size and spacing, Colour and type, Export, Copy code, Advanced); fix-c3 says it opens on this tip but the round-3 shot does not show it; re-shoot after the panel entry animation |
| md-edge-ai | dark, light | differs | tag is a 7 px chip inside the artboard's top-right (spec: spark pill above-right, outside) ; brown band across the top of both artboards; no `+ AI` pointer label; spark corner icon has no dot; Combine-kampan A4 stand-in instead of Homepage (fixture) |
| md-edge-viewer | - | unreachable | needs a cloud project with a viewer role |
| md-edge-mixed | dark, light | differs (cannot confirm, carried) | per-kind Present - Artboards run not shown |
| md-edge-offline | - | unreachable | needs desktop Presenter view offline |
| md-esc | dark, light | match | after-esc state shows one pressed mode segment (Edit), no focus ring; the table rows are behaviour documentation, not UI (C5) |

```json
{"canvas":"04 Modes","dir":"04-modes","match":["md-model","md-preview","md-preview-follow","md-present-lift","md-present-canvas","md-esc"],"match_one_theme":{},"differs":["md-keys","md-edit","md-edit-image","md-edit-component","md-annotate","md-preview-combine","md-present-menu","md-present-full","md-comment","md-draw","md-inspect","md-edge-ai","md-edge-mixed"],"unreachable":["md-motion","md-present-video","md-presenter","md-present-link","md-comment-only","md-edge-viewer","md-edge-offline"]}
```
