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
| es-home-local | the first-run sign-in card shows on the first launch only: Home keeps a per-Mac flag in its own `home.json` (`GET/POST /_home/first-run`, app-owned state dir, never the project); afterwards a signed-out Mac with no project shows 05's "No projects on this Mac yet." shelf + the quiet "Sign in to cloud.maude.sh" pill, and the pill still opens the card (kg v2-p8-c8-first-run-card-once) | `home/routes.ts`, `home/home-api.js`, `home/home-app.jsx` | `home-first-run`, `home-page`, `p8-c8-misc` |
| es-arriving (3) | the panel foot carries the board's 4 px progress bar ("41 of 93" as a share) | `empty/arriving.jsx`, `canvases-panel.jsx`, `empty.css` | `v2-arriving-rows` |

Open: es-arriving (1) skeleton artboards + "N artboards on their way" tag. The hub listing carries no artboard sizes, and the board composes a canvas that is PARTLY arrived (one artboard drawn, four skeletons) - the product has no per-artboard arrival state, a canvas file lands whole (Q13 fallback card stays). Needs a sync-layer answer first. Stage D re-shoot of 05 not run (budget); the harness's home2.mjs es-home-local now needs the first-run flag set (state dir) to shoot the shelf.
