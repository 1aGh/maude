# P8 stage C round 7 — AI chat (`p8-c7-ai`) — 03 (+ the AI ids of 01, not touched)

Branch `p8-c7-ai` (from feat/maude-v2 6f503db82). Checklist: `critic-bar2.md` of 03, `fix-c6-aisurf.md`, `fix-c5-aichat.md`.
Verified: tsc clean, biome clean on touched files, AI battery (p8-c7-ai, p8-c6-aisurf, p8-c5-aichat, p8-c3-ai-copy, p8-c2-chatshare, s5-17b-fidelity, v2-ai-*, chat-context) green, red-checked (Advanced.jsx + chat-list-model.js, needs-you-toast.js put back to HEAD: the new tests go red), release rebuild, harness re-shoot (03, both themes).

## Done
| MUST row | what changed | state |
|---|---|---|
| Inspector on the Post pick (ai-hero/done/working/…) | verified on the merged tip: the c6 fix holds (no Inspector in ai-done, ai-hero, ai-working, ai-panel-closed). ai-open / ai-suggest now pick Post FIRST then open the panel on purpose (the board draws Canvases + Inspector there) | fixed + harness |
| Chat titles from the ask | `shownChatTitle` (chat-list-model.js): a title that is only the start of the typed ask (the transcript derives 60 chars) reads as its first clause — "Make it greener" in ai-done / ai-working / ai-two-artboards | fixed (re-shot) |
| Panel-closed done toast | quotes both sentences ("Done — Post 1:1 is greener. The logo stays white.") and offers **Show** for an ask about named artboards (03 owns it); a whole-canvas draft (scope `*`, 01 cf-ai-done) keeps Undo | fixed (re-shot) |
| Advanced › AI may | Change canvases (= the ask-before mode as a switch) · Use Assets and footage · Search the web (a per-Mac choice, said to the agent with every ask as `[maude-may no-assets no-web]`, `ai-may.js`; nothing is sent while both are on) · Write outside this project "Asks every time"; "Ask before" now sits after Fast mode (board order) | fixed (re-shot) |
| Persona | the agent's own option renders under "From the agent" (fake agent now offers one) | harness |
| Suggestion strip (ai-open, ai-suggest) | harness seeds Tereza's three open comments: "Resolve 3 comments · Reply to the comments · List what changed · Because 3 comments are open on this canvas" | harness (re-shot) |
| Attach chips + drop overlay | real fixtures (42 s mov, photo, 12-page PDF; the old 1-byte stubs were rejected by the attach route and drew an error chip); `ai-attach` (board 7) = the drop overlay with the chips behind it, the chips-only frame is `ai-attach-dark/light` in impl-out | harness (re-shot) |
| ai-same-artboard / ai-copy | the second ask is on POST 1:1 (the board's), then Run on a copy: "Post 1:1 · Combine 2026 · copy" + Before/After | harness (re-shot) |
| History | the "Make it greener" row is selected, so its **Compare · Undo this chat · Restore this version** row shows (the product already drew them; the harness never picked a row) | harness (re-shot) |
| Permission | generated Uniformy-2027 (4 jerseys + 4 photo artboards), the four photos picked, the ask: four ringed artboards with "Waiting for you", strip names "Obrana, útok, speciální týmy, trenéři" (`willNames`, wrapped) | fixed + harness (re-shot) |
| ai-scope | nothing picked = "Whole canvas" (board's main case) | harness |
| ai-question | an element picked, so the point ring path runs | harness (ring not confirmed in the frame) |

## Decisions
- `decision:maude/v2-p8-c7-ai-may-told-not-enforced` — see hand-back.
- `decision:maude/v2-p8-c7-panel-closed-toast-show-for-scoped` — see hand-back.

## Open (named)
- "Copied from Post 1:1 before …" caption + dashed link between original and copy: canvas-side (needs the copy relation in `ai-runs`/a new dgn message — not started).
- Point ring chip text ("9 pt"): the tag is the element's humanised id; the fixture's ids differ.
- Advanced: "Always allowed on this canvas · Reset" (Claude Code's own session rule, no Maude store) and "Images, video and voice" (no persisted default) stay out; usage meters need usage state (harness has none).
- ai-long: day divider, sent thumbnails, Before/After pair, "Jump to latest"; run-list popover; attach "+1" drag chip; chat-list canvas groups.
- ai-needs-hidden: canvas is Combine-kampan (fixture), the board's is Uniformy-2027; the Needs-you row in the Canvases panel.
- 01 cf-ai-drafting (stacked tags, Tablet/Mobile ghost) — a hold for a run on a blank canvas needs a dgn change; not started, 01 not re-shot this round.
