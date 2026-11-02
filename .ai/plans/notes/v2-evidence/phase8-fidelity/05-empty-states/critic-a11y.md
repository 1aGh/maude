# a11y-critic — 05 Empty States (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/05 Empty States.tsx` (+ `05 Empty States.css`) · impl frames `.claude/worktrees/agent-af49de751057c2ee5/.scr/impl-raw/05/` (lossless PNG) · standard: WCAG 2.1 AA. There is no project a11y-rules skill, so the WCAG defaults apply. · opt_out_applied: n/a — a11y enforces at every scope_

**Method and severity** are the same as in `01-create-flow/critic-a11y.md`. The empty kit (`client/v2/empty/empty.css`) is lifted from the board with tokens only. Under reduced motion it drops the landing spring and the arriving pulse outright (`:37-50`, plus `[data-reduced-motion]`), so it does not merely shorten them. The confetti is `aria-hidden` and does not take the pointer.

## Root causes

| # | cause | spec | impl | owner | sev |
|---|---|---|---|---|---|
| R8 | A canvas that is not on this Mac dims its **name** to 55 % opacity. The board dims only the thumbnail. | `.es-row-off .k-thumb { opacity: .45 }` (`05 Empty States.css:268`); name 5.77 L / 6.62 D | name **2.83 L / 3.64 D** | `client/v2/canvases/canvases.css:154-157` (`.cv-row.is-dim .cv-name`) | blocker |
| RO3 | The Connect sheet is clipped inline in the AI panel (see 02 RO3). Its source fix (`e1c8dea26`) is not in `dist/styles.css`, so it needs a re-capture. | centred sheet | Cancel / Connect out of view | `client/v2/ai/NeedsYouSlot.jsx:217`, `client/v2/ai/needs-you.css:5-22` | blocker |
| R3 | The canvas dock's buttons are 32 px where the board has 40 (es-canvas-ai, es-artboard-new, es-filter, es-search-panel, es-timeline, es-project-new). | 40 × 40 | 32 × 32 | `apps/studio/toolbars/toolbar-css.ts:48-62` | blocker |
| R4 | The undo / redo / zoom pill is not on canvas frames. | drawn | off by default | `client/v2/shell/menu-runner.js:468` | warning |
| R1 | The shell is on the v1 ladder (01 R1). The empty kit's Ask AI is white on #3a5ad7 = 5.69 L and dark ink on #698fff = 6.38 D, against the board's white on azure 4.89 / 4.74. Both pass. | — | — | `client/styles/1-tokens-maude.css` | (cause) |

## Per artboard

| id | theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|---|
| es-home-cloud | L/D | None in this lens. The words match, the ghost cards are `aria-hidden`, and every line is ≥ 5.5. | — | — | `client/home/Shelves.jsx:15` | ✓ |
| es-home-local | L/D | None in this lens. Top-right Sign in 7.9 / 9.62. The shelf lists the registered project (fixture). | — | — | — | ✓ |
| es-home-shared | L/D | None in this lens. The layout and the people-less ghost words are design/copy findings. | — | — | — | ✓ |
| es-project-new | L/D | **The prompt field collapses to about 110 px and clips its own hint** ("A one-page portfolio with…"). The board's field is 520 px. It does have an aria-label, and Send is 36 × 36 with `aria-disabled`. | 520 px card | ~110 px | `client/v2/create/empty-project.css:18-22`, `client/v2/create/empty-project.jsx:38-60,93` | blocker |
| es-project-new | L/D | The board says "No toolbar yet — there's nothing to draw on", but the impl shows the dock. Tab reaches tools that have nothing to act on. | no dock | dock | `apps/studio/tool-palette.tsx:733-741` | warning |
| es-canvas-ai | L/D | Ask AI and New artboard pass (01 cf-blank). R3 and R4 apply. | — | — | — | (root) |
| es-landing | L/D | None in this lens. The real frames follow the spec timing, and reduced motion shows the final frame at once (code). | — | — | `client/v2/empty/empty.css:23-50` | ✓ |
| es-canvas-three | L/D | RO3. The offline line passes. The drafting and queued cards were not captured (lane). | — | — | — | (root) |
| es-artboard-new | L/D | **The empty-artboard hint card is missing**: "Empty artboard. Draw a frame with F, place an image I … + Ask AI to fill Tablet". The component exists, but its `artboard-empty` trigger never fired in the lane. The Layers empty line passes. | hint card | none | `client/v2/empty/artboard-hint.jsx:17-30`, `client/v2/empty/empty-host.jsx` | blocker |
| es-artboard-new | L/D | The artboard inspector (Preset Tablet · W 834 · H 1194) is not reached because selection lands on the page element. Same as 01 cf-select-tweak. | compact inspector | — | `apps/studio/input-router.tsx` | warning |
| es-panels-canvas | L/D | The words and spot art match ("Nothing in 2027 yet", "No comments on…", "All done." with confetti, history). The tabs and counts pass. R3 is behind. | — | — | — | (root) |
| es-panels-make | L/D | **The empty AI chat has no suggestion chips** (board: "Ask about Pricing." plus Add a yearly toggle · Write three FAQ answers · Make a dark version, and a spot picture). The impl has one generic line, so those three controls do not exist. Assets, Exports and Trash pass. | 3 chips | none | `client/v2/ai/Suggest.jsx` (`ChatEmpty`) | blocker |
| es-timeline | L/D | The empty timeline has no ruler, no clip-track drop zone and no Captions / Music lanes; only "No clips on reel yet." shows. Transport passes (8.89 / 5.80). The "Cut 15 s…" chip is fixture (it needs 38 clips). | ruler + 3 lanes | bar only | `client/v2/timeline/Timeline.jsx` | blocker |
| es-timeline | L/D | The video-artboard inspector (Preset Reels 9:16 · Length · Frame rate) is not reached; selection lands on the page element. | — | — | `apps/studio/input-router.tsx` | warning |
| es-search-k | L/D | None in this lens. The words, the Ask AI row (13.8 / 11.5) and the foot (fg-2 5.56 / 5.41) pass. "Did you mean Pricing" is fixture. | — | — | — | ✓ |
| es-search-more | L/D | None in this lens. ⌘K "Nothing opened yet" plus Start here passes. The Assets no-hit falls back to the generic empty because the fixture has no assets. | — | — | — | ✓ |
| es-search-panel | L/D | The search field shows **two clear ×**: the native `type=search` cancel plus "Clear search". Home hides the native one; the panel does not. | one × | two | `client/tree/tree.jsx:1399-1419` vs `client/home/home.css:263` | warning |
| es-filter | L/D | The active "Print 0" chip has no × affordance. Its title says "press to clear" and it carries `aria-pressed` and `aria-label`. The card and "Clear filter" pass. | "Print 0 ×" | no × | `client/v2/kinds/KindChips.jsx:36-47` | warning |
| es-filter | L/D | Zero-count chips use `--fg-3`, which measures 3.98 L / 4.02 D on 11 px numerals. The token is 4.83 / 4.66, so this is anti-aliasing near the line. | ≥ 4.5 | near | `client/v2/kinds/kind-filter.css:11-60` | warning |
| es-viewer | L/D | **Unreachable.** It needs a view-only or comment-only member session, with a hub or cell vouching the role (`MAUDE_WORKSPACE_MODE`). | — | — | hub roles | blocker |
| es-arriving | L/D | **The foot has no progress bar** and no programmatic progress. "Getting … · 41 of 93 canvases" is a plain `<p>`: no `role=progressbar`, no `aria-live`. Ghost rows pass (5.77 / 5.86). The skeleton artboards need known sizes and the "Syncing…" word needs a hub (lane). The one-card fallback for a canvas is in the board's note. | bar + live count | text only | `client/v2/canvases/canvases-panel.jsx:615-622`, `client/v2/empty/arriving.jsx:135` | blocker |
| es-offline-uncached | L/D | R8. The main card passes ("Smoke isn't on this Mac yet.", Show canvases on this Mac). | — | — | — | (root) |
| es-all-trashed | L/D | **Unreachable.** The UI refuses to trash the last artboard, so the state only comes from a peer or a sync. It needs the dashed outlines, "Restore 4 artboards" and "Jonas moved all four…". | card | "Your canvas is ready." | `client/v2/empty/all-trashed.jsx` (no trigger in lane) | blocker |
| es-edge-panels | L/D | Chat search with no hits passes. The "only you on Studio site so far" Share sheet needs a cloud project. | sheet | — | hub | blocker |

## Verdict

```json
{"canvas":"05 Empty States","critic":"a11y-critic","blockers":11,"warnings":7,"verified_ids":["es-home-cloud·light","es-home-cloud·dark","es-home-local·light","es-home-local·dark","es-home-shared·light","es-home-shared·dark","es-landing·light","es-landing·dark","es-search-k·light","es-search-k·dark","es-search-more·light","es-search-more·dark"],"opt_out_applied":"n/a — a11y enforces at every scope"}
```
