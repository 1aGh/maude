# Phase 8 stage C round 7 — 13 Design system (branch p8-c7-ds) — budget-capped

Nothing below is marked matched; the lead's critic judges. Re-shot (impl, light + dark) with `.scr/chain-c7.sh` (the D4 harness + the c7 patches).

## Done (product)

| what | ids | proof (red → green) |
|---|---|---|
| **"Used in N canvases" under every swatch** — the usage index is lazy and the board reads its persisted file when its module compiles, so a first-opened board drew nothing. `warmDsUsage` builds the index ~1.2 s after boot for a project with systems (the file is a board dependency, so the board recompiles when it lands); the line wraps instead of an ellipsis; the hero has room above the Logo block. | ds-board-studio / -dark / -gator, ds-edit-colour | `p8-c7-ds-usage-warm.test.ts` (new fn; http.ts glue is a separate commit) |
| **A waiting review is the whole inspector place** — the system block ("Which way changes flow", Advanced) no longer rides under the outside / conflict card. | ds-truth-outside, ds-truth-conflict | `v2-ds-truth.test.tsx` (red on HEAD → green) |
| **Conflict sides never read raw oklch** — a side with no name of its own says the colour in words ("Deep blue"). `colour-words.js`. | ds-truth-conflict | `v2-ds-truth.test.tsx` (red → green) |
| **Review / master / switch sheets wear the canvas's own picture** (`use-covers.js`: the Canvases panel's index cover, and the cover pass is asked for). | ds-edit-review, ds-edit-master, ds-multi-switch | `p8-c7-ds-covers.test.ts`, `v2-ds-switch-sheet.test.tsx` (red → green) |
| **Review pair in words** — a colour nobody named reads "Deep blue › Dark green" (only when the sides differ); **master before \| after pair** beside "Corners 10 → 6" (`dsr-mpair`). | ds-edit-review, ds-edit-master | `p8-c3-dsboard-review.test.ts`, `v2-ds-review-sheet.test.tsx` |
| **Update available on a left-out instance** — `leftOutOf` now finds the canvas by its design-root path (the real index keys by tree path `.design/…`). | ds-edit-instance | `v2-ds-update-available.test.tsx` (red → green) |

## Harness (not product)

- `dsboard.mjs` waits 9 s so the board crop is taken after the usage file landed.
- `s13.mjs` G=e: the four ui canvases get `designSystem: maude-v2` in their meta (without it the switch sheet read "Follows no system yet" on every row — "none can switch"); the menu is opened on the last pinned row; the sheet waits until the ui canvases have their covers (`waitCovers`).
- `s13.mjs` G=h: Pricing's Buy is a real `@maude/ds` Button instance; the page is reloaded after the CLI publish (the shell reads `canvasDsRevs` once per load).
- `s13.mjs` G=c: wheel-zoom to ~34 % so the "Changed outside" tags read; the pointer parks on empty canvas (no scroll panel).
- New lane `s13p.mjs` (ds-multi-panel): two systems in use, the older one made before the schema (amber dot), a button selected with the "Uses maude" door scrolled into view.

## Open (by priority)

1. **Rename…** in a system's menu (+ drop "Check the system" from it, which the board does not draw): needs `POST /_api/ds/rename` (`routes/ds.ts` op + table row, `ds/rename.ts` writing `config.json` `designSystems[].label` like `ds/default.ts`), `ds.rename` in `actions/defs/ds.ts` + `actions/agents.ts` (CLI `maude design ds rename <ds> <label>` in `ds-verb.ts`), `writer-registry.ts`, `test/_acl-route-classes.ts`, `test/_role-refusals.ts`, `test/ds-routes-roles.test.ts`, `node scripts/gen-actions.mjs`; client: the row's inline rename. Menu tests: `v2-ds-switch-sheet`, `v2-ds-upgrade-sheet`, `v2-ds-pinned-render`.
2. **Swatch selection ring** instead of artboard handles + size tag (editing/index.tsx selection layer for `[data-ds-token]`) — ds-edit-colour, ds-edge-contrast; framed at ~60 %.
3. **Reach view** (ds-edit-reach): lines from the swatch to canvas spots and the card-with-review flow — `reach-view.jsx` is mounted, the shot shows the review sheet only; "Used in N canvases · Show" row in the token inspector.
4. **Convert sheet** per-section map ("42 pages fold into 7 sections") + the multi-folder sheet (ds-edge-migrate, ds-multi-migrate: the sheet is not opened in the lane — plain canvas shown).
5. **"Falls short in N canvases · Show"** row + two-surface contrast warning (ds-edge-contrast).
6. **Advanced** (ds-advanced): used-by row, CSS | JSON toggle, token block, Files tree, check card — Advanced is collapsed in the shot; open it and run Check in the harness.
7. **Hero outside the Brand frame**: the board's header is page chrome around the artboards; the product draws it inside Brand (a canvas artboard body clips, and a hero artboard would change every converted board).
8. Review sub-lines "14 places — buttons, links, cards" and the left-out row with its update dot (data: the fixture's usage has few places).

# Round 7 continuation — p8-c7-ds2 (Opus; budget-capped)

## Done (product)

| what | ids | proof (red → green) |
|---|---|---|
| **Rename… a system, end to end.** `POST /_api/ds/rename` (`routes/ds.ts` op + table row, main origin, `readOnly: refused`; Can edit on the whole project — viewer / commenter 403, a canvas-scoped grant gets the no-such-system 404) writes `config.json` `designSystems[].label` atomically (`ds/rename.ts`); canvases pin the system by its id, so nothing else moves. `ds.rename` registry row + agent path `maude design ds rename <ds> <new name>` (`--reset` = show the id again), writer-registry file-plane row, ACL / role classes, hub studio-manifest edit row, agent-parity case, regen (`gen-actions`, plugin `system.md`). | ds-multi-menu | `ds-rename.test.ts` (red: no route / unknown sub-verb → green), `ds-routes-roles`, `ds-agent-parity`, `access-*`, `studio-manifest.test.mjs` |
| **A system's menu per the board** — Open · Use for new canvases · Switch… · (Preview in…) · Rename…; "Check the system" left the menu (Advanced button + ⌘K keep it). Rename… turns the pinned row's name into a field (↵ renames, esc keeps, empty / > 64 / a name another system shows is refused in place); the toast carries Undo (the previous label, same writer). | ds-multi-menu | `v2-ds-pinned-render.test.tsx` (red on HEAD's menu → green; revert-checked) |
| **A swatch / master selected on the Design system canvas is itself** — `hoverTargetToSelection` named a board token (no `data-cd-id`) by its artboard's selector, so the eight artboard handles + size tag drew and Delete / ⌘C saw a whole-artboard pick. Now the selector is the section-scoped `data-ds-token` / `data-ds-master` and the selection carries no artboard: the selection ring sits on the swatch. | ds-edit-colour, ds-edge-contrast | `p8-c7-ds2-token-select.test.ts` (red → green) |

## Harness

- `s13.mjs` `frameColour()`: zoom to the Colour section (`view.zoom-to-artboard ds-colour`) and one step out before selecting the swatch (ds-edit-colour, ds-edge-contrast) — the board frames the swatch, not the 29 % / 9 % whole board.
- `s13.mjs` ds-multi-menu: the menu is opened on the system that is NOT the default (the board's "Use for new canvases · now …"), not on the last row.
- `chain-c7ds2.sh`: groups a, e, f light + dark; only the three ids above are copied into the pairs.

## Open (by priority)

1. **Preview in… in the multi-system menu** — the board's ds-multi-menu draws no Preview row, but it is the only door to the preview in a project with several systems (ds-many-switch draws the preview as the row's own menu in a one-system project). Kept; lead call needed (drop it / keep it).
2. **Contrast line words** (ds-edit-colour): board "5.6:1 on white · 4.8:1 on the dark page"; product "Light 4.8:1 · Dark 4.7:1" (`client/v2/ds/contrast.js` pass line). Fail line (ds-edge-contrast) names every short surface in both modes; the board names the two surfaces in the mode being edited, plus a "Role · Text on green — hints" row.
3. **Selection ring weight** — the generic halo is 1.5 px, tight; the board's ring is 2 px at a 4 px offset (polish).
4. Reach view (ds-edit-reach), convert sheet section map + multi-folder sheet (ds-edge-migrate, ds-multi-migrate), "Falls short in N canvases · Show" (ds-edge-contrast), Advanced (used-by row, token block, Files tree, check card) — untouched this round; see the list above.
