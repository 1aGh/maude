# P8 stage C round 6 — AI chat surfaces (`p8-c6-aisurf`) — 03 + the AI ids of 01

Branch `p8-c6-aisurf` (from feat/maude-v2 4fc89c1a4). Checklist: `critic-final-d3.md` of 03 and 01, `fix-c5-aichat.md`, `fix-c3-ai.md`.
Verified: tsc clean, `p8-c6-aisurf` + the AI / right-island / toast batteries green, red-checked once (every fixed file put back to the base version: the new tests go red), release rebuild, harness re-shoot (03 all reachable ids, 01 AI ids, both themes).

## Done (per root cause)
| RC | what changed | files | state |
|---|---|---|---|
| 1 Inspector on an ask | An artboard pick with the AI chat open is the ask scope, not an edit: the follow rule skips it (`askingAi`). The canvas re-announces the same selection after an AI reload (the file changed): that is not a new pick (`lastFollowPickRef`), so it neither opens the Inspector the first pick left shut nor reopens one the person closed. Elements with an id still follow with the chat open (01 cf-select-tweak). | `client/v2/shell/inspector-follow.js`, `client/hooks/use-shell-core.jsx` | fixed (ai-done, ai-hero, ai-open, ai-scope, ai-permission, ai-needs-hidden, ai-panel-closed: no Inspector) |
| 2 Finished frames | The file-write rim + wash (`.dc-activity-rim`, `.dc-activity-scan`) hide while the AI ring layer speaks for a run of yours (`data-maude-ai-live` on `<html>`, 4 s tail): one spark outline on Post, no dashed ring on every artboard the run touched, no salmon fill on 01 cf-ai-done. A terminal agent's edit has no ring and keeps both. | `inspect.ts`, `artboard-activity-overlay.tsx` | fixed (re-shot) |
| 2b "What AI did" / "Because…" | ONE follow-up row under a finish: "Same on <artboard>" + a variation of the ask ("A darker shade" for colour, "A bit larger" for text) — the board's `chips`. The suggestion strip's last-ask context (and its "Because you last asked …" line) yields to it (`result-shown.js`). "What AI did · N steps" folds only a run of 4+ steps (the board draws it on the 4- and 6-step recap runs only). | `client/v2/ai/{run-model,suggest-why,Suggest,RunSurface,result-shown}`, `client/panels/ChatPanel.jsx` | fixed (re-shot) |
| 3 panel-closed done toast | Harness: a real finish while the panel is hidden shows "Done — Post 1:1 is greener. The logo stays white. Undo" (01 cf-ai-done rule: a changed run says Undo, an answer-only run says Show). | `_c6-harness-g2/s03e.mjs` | in the frame now |
| 3 drop overlay + chips | Harness drives photo + footage + PDF and a `dragenter` with Files: "Drop to attach — AI can use it in this chat" shows. | `s03a.mjs` | shown; the chips sit behind the overlay in the frame |
| 5 History | Version history shot alone (chat hidden first — the AI chat is its own island by decision V2-4.4b, it is not closed by a main panel). Tabs stay All / Named / Made by AI / People (CONTRACT keeps Named). | `s03e.mjs` | not stacked now; row actions + Compare open |
| 6 Permission / needs-you copy | A tool title that already reads as the work ("Replace 4 team photos in Uniformy-2027") is the question, never "Allow — …?"; the button names the work ("Replace 4 team photos"). The needs-you toast is "AI needs you on <canvas> — replace 4 team photos?" on one line; the toast's × shows on hover / keyboard focus only. | `needs-you.js`, `notifications.tsx` (shared) | fixed (re-shot); canvas is Combine-kampan (fixture) not Uniformy-2027 |
| 7 / 01 | Camera Fits while an AI run of yours draws and an artboard lands (cf-ai-drafting.tablet: Desktop + Tablet at 39 %); the chat is titled from the first clause of the ask while it runs ("Make it greener", not "New chat"); the hugging island is unchanged (it hugged already in the re-shoot). | `use-fit-while-ai-drafts.js`, `app.jsx` (shared), `chat-list-model.js`, `ChatPanel.jsx` | fixed (re-shot) |

## Decisions
- `decision:maude/v2-p8-c6-ask-scope-pick-no-inspector` — see hand-back.
- `decision:maude/v2-p8-c6-activity-rim-yields-to-ai-rings` — see hand-back.
- `decision:maude/v2-p8-c6-one-followup-row` — see hand-back.

## Open (named)
- 01: the Mobile ghost and the ring + "AI is drawing Tablet" tag on the artboard being drawn: a run on a blank canvas holds no artboard, so the ring layer is not live and the file-write rim (violet, "AI's new Desktop — shown live") is what shows while drafting. Needs the shell to tell the canvas "a run of yours is live" without a hold (a `dgn-protocol.ts` change, not mine).
- ai-suggest (the comments / clips / shared strips need fixture state), consent card ("Let AI read …"), chip-kinds column, run-list popover (needs two live chats and a click on the "N" chip), copy caption + "Keep the copy" row frame, Copy / Retry hover row, chat-list groups + search results + row menu, resize tooltip / jump pill / day divider, Advanced "AI may" switches / persona / images-voice group / meters (no capability behind them: decision of S5.17b), history row actions ("Undo this chat" / Restore) + Compare bar, the other four not-ready panels.
- 01: the generic follow-up row after a multi-artboard finish ("Same on the other artboards / Try a variation") still comes from the strip (a multi-artboard run has no per-artboard "Same on").
