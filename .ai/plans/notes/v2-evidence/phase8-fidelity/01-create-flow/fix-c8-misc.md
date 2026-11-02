# fix-c8-misc — phase 8 stage C round 8, 01 Create flow (branch p8-c8-misc)

MUST items of `critic-bar3.md`, one row each.

## Done (product)

| id | what | where | tests (red -> green) |
|---|---|---|---|
| cf-open-big | the panels' hide key folds the project pill (mark only), the share cluster (zen: the panels button alone) and the canvas toolbar (one pressed tool glyph, `view-chrome {zen}`); "Panels hidden…" is an app-state notice at the TOP | `app.jsx`, `share-cluster.jsx/.css`, `tool-palette.tsx`, `toolbar-css.ts`, `use-chrome-visibility.tsx`, `dgn-protocol.ts` (view-chrome + zen), `canvas-shell.tsx`, `use-canvas-bridge.jsx` (seed on load), `panel-layout.js` | `p8-c8-misc-zen` (toolbar fold, dgn gate, placement top, source pins), `v2-panel-layout` |
| cf-search-k | the pinned Ask AI row reaches the list edge (sticky `bottom: -padding`), so the next group's header no longer scrolls through a 4 px strip under it | `v2/search/search.css` | `p8-c7-palette-css` |
| cf-render-error | the card keeps ONE verb ("Go back to <time>"); "Ask AI to fix it" is a chip in the AI panel while the card shows (`repair-offer.js` store -> `Suggest.jsx` / `suggest-why.js` context `repair`) | `v2/create/render-error.jsx`, `repair-offer.js`, `ai/Suggest.jsx`, `ai/suggest-why.js`, `panels/ChatPanel.jsx`, `shell/viewport.jsx` | `v2-render-error`, `p8-c8-misc` |

## Done (harness `_c8-harness-g1/s01b.mjs`)

- cf-select-tweak / cf-add-artboard: the AI chat and Canvases are folded before the click, so the Inspector's artboard card arrives and the view slides left (checked locally: `cf-select-tweak-light`).
- cf-sticky-comment: two filled stickies ("Shorter headline?" / "Services as three cards"), the Comments panel closed, Canvases tab back.

## Open

- cf-sticky-comment colour row still reads "+5": product follows 15/04 (five papers, "+5" for the rest); board 01 draws five dots. Board debt, not changed.
- cf-ai-drafting: status-line progress words, Desktop "Made by AI" while Tablet draws, the extra in-page tag - run-plan dependent (as in fix-c7-cf08b); not touched.
- Stage D re-shoot of 01 not run (budget): see the hand-back `## Continue`.
