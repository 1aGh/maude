# fix-c7-cf08b — phase 8 stage C round 7b, 01 Create flow + 08 Artboard kinds (branch p8-c7-cf08b)

Continuation of `fix-c7-cf08.md`: its "Open" list, MUST items only.

## Done

| id | what | where | tests (red -> green) |
|---|---|---|---|
| 01 cf-big-tree | a desktop project opens the canvas it was last on (this Mac's opened-here stamp, `_canvas-state/_recent.json` via `/_api/pins`, once, never when `?open=` or a cloud cell, never in a project nobody has opened a canvas in); the Canvases panel gets a **Recent** block (8+ canvases: the last three opened, newest first, "1 h ago"; the open and the pinned ones do not repeat) | `client/v2/canvases/last-canvas.js`, `hooks/use-tabs.jsx`, `tree-model.js`, `canvases-panel.jsx` | `p8-c7-last-canvas` (3 Recent tests red on the old tree-model) |
| 01 cf-open-big | "Zoom to fit · N%" while the camera sits on the last fit: the canvas keeps the fit target and reports `fit` with `viewport-zoom` (dgn commit `05d14b9f1`); any pan or zoom drops it | `viewport-fit.ts`, `canvas-lib.tsx`, `undo/zoom-undo.jsx`, `preview/zoom-only.jsx` | `p8-c7-viewport-fit`, `dgn-protocol-gates` (2 red before the schema change) |
| 01 cf-add-artboard | the picker stays 08's; the board's state is AFTER the pick (artboard drawn + selected, picker gone) — harness shoots that, stale toast closed | harness `s01b.mjs` | — |
| 01 cf-duplicate-done | a menu duplicate draws the dashed shared left edge + the measured gap pill for 6 s (kept in the frame's sessionStorage: the copy's file write reloads the frame); the toast wears the copy glyph (also "Mobile is beside Desktop") | `artboard-gap-mark.tsx`, `editing/artboard-actions.ts`, `use-canvas-bridge.jsx` | `p8-c7-gap-mark` (red without the mount) |
| 01 cf-ai-drafting | an artboard prints one AI hold tag (outlines stay); the camera fit shows "Zoom to fit" | `editing/hold-rings.tsx` | `p8-c7-hold-tags` |
| 08 Layers names | an unnamed text reads its words, a picture its alt or file ("Hero photo"); a Frame stays Frame | `layer-name.ts`, `canvas-shell.tsx` | `p8-c7-layer-display-name` |
| 08 ak-advanced | Look and layout ends with Grid tracks · Edit tracks… and Layout · Convert to absolute… | `inspector/kinds/artboard-print-advanced.jsx` | `v2-inspector-print` (red on the old file) |
| 08 ak-web-hug | the new section is framed and named ("Rozpis zápasů · new section"), the growth tag is screen-sized and both survive the reload the added section causes (height + section fingerprints in sessionStorage) | `artboard-new-section.tsx`, `artboard-growth-memory.ts`, `artboard-growth-tag.tsx` | `p8-c7-new-section`, `p8-c7-growth-memory` |

## Not done / open

- **01 cf-ai-drafting: the faint Mobile ghost.** The canvas cannot know which artboard the AI draws next; a ghost would need the run's plan. The Tablet ring + "AI is drawing Tablet" and the camera fit are real.
- **08 Edit tracks…** is drawn disabled (no print-board track editor exists; the Frame's own grid editor is element-level).
- **08 Layers**: Frame rows stay "Frame" (a container is not named after what it holds); the fixture's picture is a hash file name, so its Image row stays "Image".
- cf-undo-before dark stale toast, cf-status-words / offline-create / busy: UNREACHABLE or the AI lane, unchanged.

## Decisions

- `decision:maude/v2-p8-c7b-last-canvas-from-recent`: a project opens its last canvas from `_recent.json` (via `/_api/pins`). Rejected: a new pref file (a second per-Mac list for the same fact); restoring in the Tauri shell (the browser lane and the tab restore differ).
- `decision:maude/v2-p8-c7b-fit-flag-on-viewport-zoom`: `viewport-zoom` gains an optional `fit` boolean. Rejected: a new dgn message; guessing "fitted" in the shell from the percent.
- `decision:maude/v2-p8-c7b-canvas-marks-survive-reload`: transient canvas marks born from a file write (gap mark, growth tag, new-section frame) keep their baseline in the frame's sessionStorage. Rejected: module memory (the write reloads the frame).
- `decision:maude/v2-p8-c7b-one-ai-tag-per-artboard`: object-hold outlines all stay, one tag per artboard. Rejected: hiding the outlines (the hold is enforced server-side).
