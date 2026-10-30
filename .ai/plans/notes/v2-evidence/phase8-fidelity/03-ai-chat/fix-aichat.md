# P8 C6 ai-chat — fix report (stage C, partial; converged early on the lead's budget call)

Branch `p8-c-aichat` (from feat/maude-v2 0f6b1242b). Harness copy + fake agents: scratchpad `p8/aichat-h/` (scenario `s03a.mjs`, `sattr.mjs`
= the attribution check, `fake-agent-cli.mjs` = REAL `maude design hook` processes incl. Stop). "after" frames: `after/` (dark + light,
1100 px) for ai-open · ai-working · ai-same-artboard · ai-attach · ai-two-artboards · ai-chat-list. No INDEX "after" column, no full pair regen.

## EXTRA — real-hook AI attribution (verified end to end)
- A run made through the real hooks (CLI `maude design hook prompt|pre-edit|post-edit|stop`, the path Claude takes in the ACP panel) lands as ONE
  AI action: undo-stack entry `who: ai`, artboard "Made by AI" (solid ring + tag), Version history row "Made by AI", the result card has Undo /
  Keep going, **one ⌘Z** puts the file back. Same through the in-process hook.
- The fidelity lane's "changed outside the app" was a **harness artefact with one real hardening**: the scratch project sat under macOS `/var/…`
  (a symlink) while the agent reports real paths (`/private/var/…`), so `acp/index.ts keyFor` judged the edit outside the design root, the run's stage
  never began, and the edit was published by nobody. Claude reports `process.cwd()`'s real path, so a project behind a linked folder (~/git, /tmp)
  hit the same. Fixed: `keyFor` falls back to real paths (commit bcce5f6a6, test `acp-run-stage.test.ts`, red then green).
- `markDone` (runs-store.js) has no caller by design now: the settled ring comes from made-by-ai.js (`project:action`). Not wired (a rejected publish
  would otherwise show a false "Made by AI"). The Before / After wipe pills and the "point" ring are `artboard-activity-overlay.tsx` (canvas side) — OPEN, C5's file.
- `run.doing` is wired: set at ask from the first verb of the ask ("Make it greener" -> "AI is making it greener"); studio-local, never in `publicRun`,
  ring tags unchanged; no verb we know (a question, Czech) -> stays "AI is working". `ai/run-doing.ts`, `test/ai-run-doing.test.ts`.
- FINDING (not fixed, patch for the lead): `cli/lib/design-hook.mjs` posts `/_api/agent/edit/touched` with `timeoutMs: 300`. A cold node start + a busy studio
  can miss it: in 1 of 3 CLI runs the run's `touched` stayed empty, so the result card lost Undo / Keep going (the AI action and Made by AI still landed, from the
  stage). Suggest 300 -> 900 ms there (hooks.json allows 5 s) or merging the stage outcome's `touched` into the run record at publish.

## Done (commit 99add8f3d / c0830f834 / the P8-C6 panel commit)
| board item | state |
|---|---|
| transcript bubbles 14 px, you right/bg-4, AI bg-3, no role label, no tool cards in the feed (only thinking/verbose views) | fixed |
| composer one row, chip inside, send 28 px radius-md + DS disabled look, no divider, multi-line wraps above | fixed |
| field stays during turns (R3) | fixed |
| header: spark vermilion, no dot, chevron icon not ▾, count chip with chevron, Hide chevron-down | fixed |
| width 340 (420 when full), hugging height | fixed (`v2/ai/panel.css`; pinned 420 / left-panel collapse NOT done) |
| single working line: streaming reply hidden while the line is up; no line beside a Waiting card | fixed |
| empty hint left-aligned; suggestion strip: 22 px chips, lead chip glyph, why line fg-2 | fixed (strip needs open comments to be reachable) |
| scope chip: kit chip inside field, check icons, kit menu material | fixed (label shows the artboard id only because the fixture has no `.meta.json` sidecar: harness stub still to add) |
| attach chip collapse | fixed (`flex:none`; the fixture picture is itself a thin stripe) |
| quit dialog padding 24 / radius-xl / bg-2 | fixed |
| folded corner spark vermilion + presence dot | fixed |

## Open (not done — for the next builder)
- permission card thumbnails + "Always for this canvas"; neutral card ring + help glyph (R7); choice swatches + hints; problem card without Advanced fold.
- needs-you rings only on affected artboards (`runs-model.js` ringsFor, `leases` of a whole-canvas scope); point ring + Before/After wipe pills (overlay.tsx, C5).
- Connect sheet as centred modal; needs-you toast one-line pill; chat list single header + 22 px state disc; run-list popover; advanced selects; slash-menu mono names;
  assistant hover Retry row; day divider / sent thumbs / jump pill / resize tooltip; pinned layout (left panel collapse, 420, Share overlap); ⌘/ opens the panel per board;
  copy caption + dashed link; scope menu "Choose artboards…" (code exists, needs sidecar).
- 01 / 02 / 05: not touched (C11 owns them).
- Stage D: pairs + INDEX "after" column not regenerated; harness fixture additions needed: Combine-kampan `.meta.json`, 3 open comments on Post.

## Shared-file commits
`apps/studio/client/styles/_index.css` (one import line, own commit). Everything else in my files (`client/v2/ai/*`, `panels/ChatPanel.jsx`, `chat-header.jsx`,
`transcript-view.js`, `styles/6-acp-chat.css`).

## Tests
`p8-c6-ai-panel.test.tsx` (header, hint, bubbles, strip, working-line gate, quit/corner/attach pins), `ai-run-doing.test.ts`, `acp-run-stage.test.ts` (symlink).
Run with the 9 related suites: 154 pass. Wider AI/shell sweep: 1181 pass; the 4 failures are not mine (`p8-b2-css-pins` pinned-panels pin on 3-shell-maude.css, gen-actions
manifest, `p8-backspace-clip`, acp permission-flood).

## Round 2 (p8-c2-chatshare)
See `fix-chatshare.md` in this directory: permission strip + neutral card, needs-you rings on touched artboards only, connect sheet floating, one chat-list header + 22 px disc, pill toasts are DONE; the rest stays open.
