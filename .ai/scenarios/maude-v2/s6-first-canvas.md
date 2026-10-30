# S6.16 — the first-canvas journey

One person, one sentence, one canvas. This is the 01 Create Flow path from Home to a saved, commented design,
walked on the desktop app with a **fake ACP agent** (no model is reached). An agent-driven variant of the same
path is S12's.

Spec: `apps/desktop/e2e/scenarios/first-canvas.e2e.ts` · config: `apps/desktop/e2e/wdio.first-canvas.conf.ts`
(Home's world + the fake agent, `fixtures/fake-acp/first-canvas-agent.mjs`, and `claude-stub.sh` for the
connected-gate probe) · run: `pnpm --filter @maude/desktop-e2e e2e:first-canvas` (debug app, an unlocked screen and
the machine's e2e lock). Evidence and the ledger proposals: `.ai/plans/notes/v2-evidence/S6.16-*`.

## Steps

| # | Do | Expect | 01 row |
| --- | --- | --- | --- |
| 1 | On Home pick a project in the target chip, type "A calm landing page for my studio", ↵. | That project's tab comes forward (Home stays pinned). The sentence is in no URL. A new canvas exists, named from the sentence, and the AI draws Desktop · Tablet · Mobile on it. | (S6.3 / S6.4, not these rows) |
| 2 | Click the Desktop artboard's name. | Desktop is the selection; the Inspector arrives on its own (View › Advanced › Open inspector on select) and its Preset names Desktop. | cf-select-tweak |
| 3 | Esc, then F with nothing selected. Pick Laptop in the size picker. | The size picker opens above the toolbar. A 1280 × 800 artboard is added, a fixed App screen. | cf-add-artboard |
| 4 | Right-click Desktop › Duplicate at another width › Laptop. | A copy `desktop-1280` at width 1280 with the content, no inherited element ids, a place of its own in the layout lane, and it is the selection. One ⌘Z takes the whole copy back. | cf-duplicate-width, cf-duplicate-done |
| 5 | Double-click the Desktop headline, type "Software that stays calm", click away. | The words are written into the file, in place. Tablet and Mobile keep the old words. The element id survives. | cf-frames-text |
| 6 | N. Click on the board. | Preview opens with Sticky in hand. A sticky is stored in the canvas's `*.annotations.json`. | cf-sticky-comment |
| 7 | Esc, C, click the button. Type "Could the button say “Book a call”?" and send. | A composer opens at the click and names where. The comment is stored under `_comments/`. | cf-sticky-comment |
| 8 | Read the Share cluster. | One word, "Local project" for an unlinked project. It is not a button, and no Retry or Resync sits beside it. | cf-status-words |

## What this scenario does not claim (named gaps)

- **cf-select-tweak.** The 01 board shows the Canvases panel folding and the canvas sliding left when the
  inspector arrives. Neither is built: the panels float, and `bridge/canvas-mode-store.ts` says an inset change
  alone never moves the camera (I1). Selection, the Inspector arriving and the Preset/Size rows are built.
- **cf-duplicate-done.** The 01 board shows the copy under the source with a toast "Duplicated at Laptop — 1280
  wide." and Undo. Built: the copy lands right of the row at its gap (14 ed-ab-menu, `duplicate-rhythm.ts`) and
  is selected, ⌘Z undoes it, and only a refusal toasts. 14 ed-ab-menu is the topic canvas for placement; the
  success toast has no home yet.

## Run notes

- The spec drives the canvas by synthetic events inside the same-origin frame (the pilot runs with the origin
  split off), the way `edit-artboards` and `edit-text` do. Steps 6 and 7 go through the annotation and comment
  layers' own listeners; a failure there is the first thing to look at when the lane runs.
- The fixture world is Home's: two seeded projects, a loopback control-plane stub, throwaway cloud files. Nothing
  reaches cloud.maude.sh or a model.
