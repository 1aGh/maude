# P8 stage C round 5 — AI chat surfaces (`p8-c5-aichat`)

Branch `p8-c5-aichat` (from feat/maude-v2 acb712da0). Checklist: `critic-final.md` of 03 and 01 (AI ids), `fix-aichat.md`, `fix-chatshare.md`, `fix-c3-ai.md`.
Stopped on the token budget; the open list below is for the next builder. Verified: tsc clean, biome clean on touched files, AI battery (p8-c5-aichat, p8-c3-ai*, p8-c2-chatshare,
p8-c6-ai-panel, v2-ai-*, s5-17b-fidelity, s5-18-slash-menu: 190 pass), release rebuild, harness `s03c` (new, `_d2-harness-g2/`).

## Done (per id)
| id | what changed | state |
|---|---|---|
| ai-scope | the menu was clipped by the chat card (dock slot + body are `overflow` boxes): it is `position: fixed`, placed from the field's rect, 8 px over it — all four rows show. `ScopeChip.jsx` | fixed (re-shot) |
| ai-attach-menu | anchored to the FIELD (left edge + top of `.chat-box`), not the paperclip: no floating gap. `AttachMenu.jsx` | fixed (re-shot) |
| ai-permission | the fake agent now asks about a non-file tool (kind `other`; the bridge strips `allow_always` for write-shaped calls by design — Decision D — so an edit-shaped ask can never show it): "Always for this canvas" shows, from the agent's own option. The tool title that heads the card is not repeated as its detail. `needs-you.js`, `_d2-harness-g2/fake-agent.mjs` | fixed (re-shot); thumbnails: tiles only (no per-artboard picture in the index, as in round 2) |
| ai-choice-fail | the missing FILE is named: "Couldn't finish — the footage file is missing. Nothing changed." + detail "trenink-0412.mov was moved or renamed. Put it back in Assets to try again, or pick another clip." + verb "Pick another clip" (opens Assets, not a retry of a file that is gone); no Advanced fold when the card already says everything (an unnamed failure keeps "Try again" + the fold). The fake agent's failure is a JSON-RPC error with the real message, and no "Trying —" ghost line. `needs-you.js` `failureModel/missingFile`, `Feed.jsx` | fixed (re-shot) |
| ai-advanced | selects no longer cut to 62 % ("Replace or move to the trash" in full); the agent's own id ("default") no longer sits on its own line; Effort is a segmented control (Low · Medium · High), Fast mode a switch, Model a select — rows come from the agent's `configOptions` (the fake agent now offers model / effort / fast). A list that is long, many or not off/on stays a select. `Advanced.jsx`, `ai-list-advanced.css` | fixed (re-shot); "AI may" toggles, persona, images/voice rows, meters: open |
| ai-long-pinned | the pinned column overran the window edge when the Inspector was open (the slot took the Inspector's 264 and the chat is 420): the slot is the wider of the two, the open panel keeps its own width (`--dock-main-w`), the column pads 12 px like the island, and the canvas Fits to the room left of it (see decision below). `panel-layout.js`, `dock.jsx`, `app.jsx`, `use-fit-on-ai-pin.js`, `panel.css` | fixed (re-shot, nothing selected so no Inspector, as the board) |

## Decisions
- `decision:maude/v2-p8-c5-fit-all-via-run-action` — the brief asked for a new parent-gated `fit-all` dgn. There is none: `run-action {id:'view.zoom-fit'}` (⌘0) already exists, is parent-gated (`canvas-shell.tsx`: `e.source === window.parent`, `v: 1`) and answers with `zoomController.fit()`, no payload. A new message would widen the bridge's attack surface for nothing; `p8-c5-aichat.test.ts` pins that `bridge/dgn-protocol.ts` has no `fit-all` and that the canvas side is the existing one.
- `decision:maude/v2-p8-c5-permission-fake-nonwrite` — "Always for this canvas" can only appear for a non-write tool (bridge `classifyWrite` strips `allow_always` for every write-shaped call, in or out of the project; a named in-project write auto-approves). So the fake agent's permission ask is a non-file tool; the harness shows the box the way a real "replace Assets" ask would.

## Open (named)
- 01 cf-ai-drafting: camera fit-all (28 %) + the in-page "AI is working" hold tags where the board draws none (`hold-rings.tsx` / `artboard-activity-overlay.tsx` — canvas side; not started).
- ai-suggest strips (need open comments on the fixture), consent card ("Let AI read …": needs a folder-attach driven in the harness), attach chips + drop overlay (thumbnails of footage / PDF), run-list popover ("N" chip), "Copied from …" caption + dashed link, Copy / Retry on hover, Made-by-AI history row actions + Compare, history not stacked with the chat (4 tabs vs 3), needs-you toast one line (round 2 did the pill; the re-shoot of ai-needs-hidden is not redone), jump pill / resize tip / day divider: not started.
- The permission card's thumbnails: the project index has no per-artboard picture.
- s03b's sequential flow leaves a hung poster chat running before the permission step ("Waiting for …" instead of the ask); `s03c.mjs` drives the changed ids from clean chats — fold the rest of s03b into that shape.

## Shared-file commits
`client/app.jsx` (one import line, the `useFitOnAiPin` call, `mainWidth` on the right dock slot) and `client/shell/dock.jsx` (`mainWidth` prop → `--dock-main-w`) — one commit, `ac9ce1cda`. No kit CSS, shell CSS, icons.jsx, notifications.tsx, canvas-lib.tsx, dgn-protocol.ts, dist.
