# fix-c7-oboard — round 7, p8-c7-oboard (02 Onboarding · 04 Modes · 05 Empty states)

Branch `p8-c7-oboard` from feat/maude-v2 `6f503db82`. Checklist = the MUST rows of `critic-bar2.md` of 02 / 04 / 05.

## Done (product, each with a red-then-green test)

02
- ob-adv-sheets (Import from Figma, Home): the sheet now asks the **Figma link** (shape-checked, `figmaLinkKind`) and has a collapsed
  **Advanced · Access token** fold. The link rides to the project window as the `import-figma` intent prompt and prefills the
  window's own sheet once (`import/figma-prefill.js`, taken once; anything that is not a Figma link is dropped). The token is NOT asked
  on Home (it lives with the project's server): the fold says so — no credential field, the page never holds a token.
- ob-settings: Connections gains **AI — your Claude account** (Pro or Max, or an API key · Connected / Not connected · Change… / Connect…,
  the one Connect sheet in the row, `connectClaude({force})` for Change…); rows reordered to the board (cloud, hub, Claude, Figma, GitHub,
  then the AI-images row); a description line under each row; Figma without a token reads **No token** + a collapsed **Add token…** that opens the field.

04
- md-preview-combine: Preview no longer eases onto one board when the canvas has several boards and **no links**
  (`preview-camera.tsx` `holdOverview`); with links it still steps onto the board in view (md-preview / md-motion).
- md-edge-ai: the activity tag sits above-right of the artboard (not a chip in the corner); the rim carries no per-agent presence colour
  — the spark token (`canvas-lib.tsx`, shared; separate commit).

05
- es-project-new: ONE "New canvas" row — the host's row (and its folder button) waits for the first canvas; the project row leads the block
  (the `order: -1` that put the block above the project row is gone).
- es-timeline: the empty comp keeps the timeline anatomy — ruler 0:00–0:30, one dashed drop track (icon + line + chip), Captions and Music lanes.
- es-filter: the chip that is on keeps its whole word + count and shows a ×; "Clear filter" is the board's ghost button with its ×; the
  "N other artboards are dimmed" foot is not stacked under the block; no layer tree under the empty block while the filter matches nothing.
- es-offline-uncached / es-arriving: the card centres on the free canvas (`--es-cx` from the insets store), like the empty-canvas block.

## Open (not done, or a question)
- md-present-menu: the "Presenter view on another display" row is **absent with one display** by the S3.6b decision; the board draws it. Lead's call:
  show it greyed ("needs a second display") instead of absent? Not changed.
- md-present-full / md-present-video: the controls pill (`3 / 14 · name · esc to leave`) fades after 2 s and the shot fixture has no fixed-size
  artboard, so the dark stage is not shown; the extra `esc Back to the canvas` chip on video is still drawn. Harness (shoot within 2 s on a digital
  artboard) + a product change for the chip are open.
- md-inspect (Inspect island after ⌘-click), md-edit (Canvases panel fold on selection; handles/size tag over the link chip),
  md-edit-component (picker anchored above the armed Components slot + variant seg), md-edit-image (Image tool + filenames),
  md-keys / md-draw / md-edge-mixed harness states, md-comment "All" tab (CONTRACT: the extra All tab is a CONTRACT word, 05 said so too) — not started.
- 04 was not re-shot (budget): preview-combine and md-edge-ai need the 04 harness (`_d4-harness-g2` layers).
- es-landing dark frame: harness finds the first frame by the blue Ask AI button (kept from D3) — see the shoot notes.

## Shoot (stage D)
02 + 05 re-shot with `_d-harness-g1-d3` repointed to this worktree (`.scr/h`), plus: run.mjs dismisses `.maude-notice-close` right before each shot;
home2.mjs `es-home-local` registers no project (the board's "No projects on this Mac yet." card).

## Round 8 (p8-c8-misc)

| id | what | where | tests |
|---|---|---|---|
| md-edit-component | the Components slot is pressed while the picker is open (`shell-panels` dgn gains `components`); the picker was already centred on the slot (checked: slot x 825-865, panel 696-996, anchored above); harness folds Canvases first | `shell-panels-relay.js`, `shell-panels.ts`, `dgn-protocol.ts`, `canvas-shell.tsx`, `app.jsx`; harness `_c8-harness-g2/impl/s04a.mjs` | `p8-c8-misc`, `dgn-protocol-gates`, `p8-c7-g15b-shell-panels-relay` |
| md-draw | the AI chat opened during Preview's fold shows by itself; Canvases stay folded (`panelOpenDecision` `aiInFold`, corner spark no longer calls `onShow` under the fold alone) | `panel-layout.js`, `corner-icons.jsx`, `app.jsx` | `p8-c8-misc` |
| md-inspect | harness: ⌘0 fit before the ⌘-click | `_c8-harness-g2/impl/s04a.mjs` | - |
| md-edge-mixed | harness: a Banner 1200 x 300 artboard added in `prepare`, sixth part of the contact sheet (checked locally: letterbox bars above and below) | `_c8-harness-g2/impl/s04d.mjs` | - |

Open: stage D re-shoot of 04 not run (budget).
