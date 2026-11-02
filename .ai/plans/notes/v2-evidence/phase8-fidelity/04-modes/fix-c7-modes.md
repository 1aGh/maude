# fix-c7-modes — round 7, p8-c7-modes (04 Modes continuation)

Branch `p8-c7-modes` from feat/maude-v2 `297ed9a35`.

## Done
Product (each with a red-then-green test)
- md-present-menu: the Present menu draws `Presenter view on another display` for an editor on every Mac; greyed (`aria-disabled`) with the sub line `Needs a second display` when there is no second display, live (check + display name) when there is. Decision `maude/v2-p8-c7-presenter-row-greyed` EXTENDS `maude/v2-p8-owning-board-wins`. (`mode-switch.jsx`; tests presenter-view / mode-toggle; e2e modes-present reads the greyed row as "nothing to drive")
- md-edge-ai: the file-write overlay now wears the AI's pointer — a spark arrow and a `+ AI` pill (`artboard-activity-overlay.tsx`, CSS in `inspect.ts`; test artboard-activity-overlay red without the markup).
Harness (see INDEX "after (round 7)"): md-edit, md-inspect, md-present-menu, md-present-full, md-edge-mixed, md-draw, md-keys, md-edge-ai.

## Open
- md-present-video: the extra `esc Back to the canvas` chip is NOT dropped: board 07 (`ve-fullscreen`, `.ve-full-esc`) draws it and owns video Present; 04 does not. Lead to decide (owning board 07 vs this brief). The deck counter / kind name / `esc to leave` of 04's pill are not on the video transport (S7.19 `video-present.jsx`).
- md-edit-image: filenames under the tiles are 12's call (`ia-tile-tip`, hover/focus; owning board 12 wins). The Image slot has no pressed state while its Assets panel is open (panel-first slot; needs a shell -> canvas "panel open" message) — not done. Hero picture in the fixture is a gradient div, so the selected object is a Frame, not an image.
- md-keys: shot is the View menu; the board's glyph legend / per-mode toolbar rows with key caps have no product surface (hover is a native title).
- md-edge-mixed: five of the board's six kinds (fixture has no Reels clip / Banner letterbox).
- md-edge-ai: the AI pointer is world-sized, so it is small at a many-board zoom (like the existing badge); the panel AI's live run still shows only the S5.11 ring (c6: the file-write overlay is hidden while a run of yours is live).
- md-comment: the extra `All` tab stays (CONTRACT word).
- md-edit-component: not touched (p8-c7-edit2 owns the picker).
