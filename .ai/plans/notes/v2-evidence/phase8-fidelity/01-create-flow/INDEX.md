# Phase 8 fidelity — stage A evidence — 01 Create Flow

Branch `p8-fid-g1` (from `feat/maude-v2` 6d780ab1b). 20 artboards · 38 pairs (light + dark where an implementation frame exists) · 2 not reachable · 7 reachable only in part.
Evidence only — no product code changed. Pair = SPEC left, IMPL right, same height, strip `<id> · <theme>` on top; committed copies are JPEG q55 ≤ 1100 px wide, full-size PNGs are at the path in `full-size-path.txt`.

## How the frames were made
- **SPEC.** The board rendered from a scratch copy of this repo's `.design/` (`.scr/design-copy`, `linkedHub` stripped), studio booted with `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, throwaway HOME / XDG (stub `claude`), release-built client. Each `<DCArtboard>` captured through the canvas shell (capture origin, 307 from the main origin) at 100 % (⇧0, panned to the artboard), element screenshot. Stage boards are 1440 × 980 (window 1440 × 900 + a note strip): the pair crops the window (1440 × 900) so it compares like for like; other boards (close-ups, filmstrips) are shown whole. The "Note" strip text is quoted in the meta / canvas, not in the pair.
- **Light vs dark.** The boards DRAW light only (`data-theme="light"` scopes; the studio host injects the app theme's tokens on `[data-dc-screen] [data-theme]`, pinned-light pictures keep their palette). **Light SPEC** = the host rule removed, the board exactly as authored. **Dark SPEC** = the host's own dark injection (what a dark-theme studio shows) — it is NOT a designed dark artboard, so a dark-only difference is as likely the board's as the app's. IMPL dark/light = prefs `theme` + colour scheme.
- **IMPL.** Release client, Playwright Chromium 1600 × 1000, `window.__TAURI__` stub, throwaway HOME / XDG / machine file, `claude` stubbed. Screens: the e2e fixture project, a generated 93-canvas project, an empty project, a "g1" fixture (base + an empty folder, a video artboard with no clips, a two-artboard canvas), and the project-less Home server (`--home`) with route interception of Home's own APIs. AI states use the e2e FAKE ACP agent (a slowed variant of `apps/desktop/e2e/fixtures/fake-acp/first-canvas-agent.mjs`, never a provider). Intercepted: `/_home/*`, `/_api/sync/availability`; "offline" = `navigator.onLine=false` (the local server stays up) except where a row says otherwise.
- **Systematic differences (every pair, not repeated per row).** The browser lane has no native window chrome or tab strip (spec draws them); the impl left panel is a full-height column, the spec's a floating island; the spec shows a bottom-left undo / redo / zoom chip, the impl does not (Settings › Zoom controls is off by default); the status cluster reads "Local project" + avatar YO in the fixture project where the spec shows "Saved" + faces; fixtures are not the Studio site / Alligators data the boards draw (no real covers, names, collaborators).

## Not reachable (findings, not skips)
- `cf-undo-ai` — neither ⌘Z nor the palette Undo reverts the fake agent's edit (it writes the canvas file directly, not through the edit-op path); no "Undone — the dark hero by AI · Redo" toast. Whether a REAL agent's edit is undoable here is unverified
- `cf-busy` — needs other people on the canvas (presence cursors, objects in their colours, two AI chats open, Tereza in Preview) — a hub / collab peers; no local route

## Artboards
| id | state (board label) | how reached | impl reachable? | first-glance differences | pairs |
| --- | --- | --- | --- | --- | --- |
| `cf-home-prompt` | 1 · Home — one sentence | project-less Home server (`server.ts --home`) + Tauri stub; Home's own APIs route-intercepted per scene (`/_home/cloud`, `/_home/index`, `/_home/thumb`, `/_home/whats-new`, sign-in start/poll, invite peek) and `shell_state` stubbed; two local projects (Studio site, Alligators brand), the sentence typed, a signed-in account | yes | • browser lane: no window chrome / tab strip (spec draws the native window with traffic lights and project tabs)<br>• spec Home ends in a "Recent projects" row of picture cards (Studio site 4 canvases, Alligators brand 93, Open project…) plus a "See all" link; impl has no such row — a "Shared with you" ghost shelf and a "Projects" list sit side by side instead<br>• first starter is "A design system" in impl, "A pricing page" in spec; spec thumbnails are real previews with collaborator faces and "Tereza is here" presence text, impl shows my flat fixture colours without presence<br>• spec content column is wider / centred lower (prompt card 395 px vs 350 px at the same scale) | [light](cf-home-prompt-light.jpg) · [dark](cf-home-prompt-dark.jpg) |
| `cf-ai-drafting` | 2 · AI drafts on a new canvas | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider: ⌘N, AI panel, the sentence, Enter, shot ≈3.5 s and ≈10.5 s later (Desktop at t0, Tablet at +7 s) | yes (state) / partial (visual language) | • no in-canvas drafting language: no dashed spark outline round Tablet, no ghost for Mobile, no "AI is drawing Tablet" pill on the artboard, no "Made by AI" tag in the artboard label row<br>• camera sits zoomed on the first artboard, not fit-all at 28 %; no undo/redo/zoom chip bottom-left<br>• AI panel is a docked right column titled "New chat" with an "AI is working · Stop" row; spec is a floating card titled "A calm landing page ⌄" reading "AI is drawing Tablet · Desktop done · Mobile next"<br>• left panel is a full-height column, spec is a floating island | [light](cf-ai-drafting-light.jpg) · [dark](cf-ai-drafting-dark.jpg) |
| `cf-ai-done` | 3 · Done — the result toast | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; second frame: AI panel folded (ai-chat-hide) before the draft ends | yes | • toast says the agent's FIRST sentence ("Drafting the landing page …" + Show), spec: "Done — Desktop, Tablet and Mobile are on the canvas." + Undo (fake agent only emits two messages, so this may be the agent, not the app — the one-action toast itself is there)<br>• "Made by AI" tags missing on the three artboards<br>• no bottom-left undo/redo/zoom chip | [light](cf-ai-done-light.jpg) · [dark](cf-ai-done-dark.jpg) |
| `cf-select-tweak` | 4 · Select — the inspector arrives | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; click the Desktop headline | partial: the click selects the page frame (div), not the artboard, so the artboard inspector (Preset Custom · W/H · Fill · Corners · Clip · Export) is not shown | • inspector is a full-height right column (Position / Size / Layout / Fill / Effects / Type…) vs a compact floating card with Preset · Size · Fill · Corners · Clip content · Export<br>• the Canvases panel does not fold and the view does not slide when the inspector arrives (spec note 4; I folded the panel by hand for the frame)<br>• selection label reads "div · 1440 × 996" | [light](cf-select-tweak-light.jpg) · [dark](cf-select-tweak-dark.jpg) |
| `cf-sticky-comment` | 5 · A sticky and a comment | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; ⌘0, N (Preview + Sticky), click, C, click the button, type | partial: my own sticky and my own comment only — no second person, so Tereza's bubble and the coloured, written stickies are not drawn | • spec: three coloured stickies with text and a comment bubble from Tereza anchored on the button with her avatar and "Could the button say…?"; impl: one empty yellow sticky with a formatting bar and a compose popover<br>• spec toolbar shows the colour dots above the Sticky tool; impl shows the full annotate toolbar without the colour row<br>• camera zoomed to 84 % on one artboard (spec 28 %, all three artboards in view) | [light](cf-sticky-comment-light.jpg) · [dark](cf-sticky-comment-dark.jpg) |
| `cf-undo-before` | 6 · AI went too far | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; second prompt "Try a dark hero" | yes | • same panel / chrome differences as cf-ai-done<br>• suggestion chips read "Same on the other artboards / Try a variation / Explain what changed" (spec: "Try it on Tablet", "Lighter dark") | [light](cf-undo-before-light.jpg) · [dark](cf-undo-before-dark.jpg) |
| `cf-undo-ai` | 7 · ⌘Z undoes AI too | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; ⌘Z (focus on the canvas) and ⌘K › Undo | no: neither ⌘Z nor the palette Undo reverts the fake agent's edit (it writes the canvas file directly, not through the edit-op path); no "Undone — the dark hero by AI · Redo" toast. Whether a REAL agent's edit is undoable here is unverified | • frame still shows the dark Desktop; nothing to compare for the undo toast | [light](cf-undo-ai-light.jpg) · [dark](cf-undo-ai-dark.jpg) |
| `cf-blank` | 8 · ⌘N — a blank canvas | ⌘K › New canvas (browser lane, fixture project) | yes | • browser lane: no window chrome / tab strip (spec draws the native window with traffic lights and project tabs)<br>• spec empty canvas offers one button, "Ask AI ⌘/"; impl adds a second, "New artboard"<br>• spec toolbar is a wide dock with a "Frame F" tooltip and a bottom-left undo/redo/zoom chip; impl toolbar is smaller and there is no chip<br>• status word: "Local project" + avatar YO (spec "Saved" + T); left panel full-height column, spec floating island with a thumbnail row per canvas | [light](cf-blank-light.jpg) · [dark](cf-blank-dark.jpg) |
| `cf-add-artboard` | 9 · F — a new artboard, any kind | press F on a canvas | yes | • different UI: impl opens a size-picker popover (search, grouped App / Web page / Social / Print / Video tiles with pictures, "Square 1:1" highlighted, a dashed ghost preview artboard above it); spec draws the artboard ("Artboard 4 1280 × 800") and shows a Preset dropdown in a compact inspector card<br>• preset names and sizes differ: spec Web Desktop 1440×900 / Laptop 1280×800 / Tablet 834×1194 / Mobile 390×844, Social Post / Story, Print A4 / A5 / Letter, Video 16:9 / 9:16; impl App Desktop 1440×1024 …, Web page Desktop 1440 wide …, Social Post 4:5 … | [light](cf-add-artboard-light.jpg) · [dark](cf-add-artboard-dark.jpg) |
| `cf-duplicate-width` | 10 · Duplicate at another width | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; right-click the artboard label › hover "Duplicate at another width" | yes | • menu rows are close: impl adds "Add comment C", "Start a vote…", "Advanced ▸" and has no Copy ⌘C / Paste ⌘V; submenu words "Laptop — 1280 / Tablet — 834 / Mobile — 390" vs spec "Laptop 1280" with right-aligned numbers<br>• inspector is a full-height column behind the menu | [light](cf-duplicate-width-light.jpg) · [dark](cf-duplicate-width-dark.jpg) |
| `cf-duplicate-done` | 11 · The copy lands in line | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; pick Laptop, ⌘0 | yes | • the copy lands to the RIGHT of Mobile in the same row; spec puts it under Desktop with left edges aligned and the 144 gap measured in the accent (known gap S6.16)<br>• label "Desktop (1280px)" vs spec "Desktop — Laptop 1280 × 800"; copy height 996 vs 800<br>• toast "Duplicated at Laptop — 1280 wide." + Undo is there but sits lower-left and wider than the spec pill | [light](cf-duplicate-done-light.jpg) · [dark](cf-duplicate-done-dark.jpg) |
| `cf-frames-text` | 12 · Frames and text in place | signed-in AI through a FAKE ACP agent (`MAUDE_ACP_ADAPTER_ENTRY` = the e2e fake agent, slowed in steps, + the e2e `claude` stub that answers "signed in") — never a provider; double-click the headline twice, type | partial: in-place text editing works (inspector switches to Text); the Layers tab with nested frames (Nav, Hero, Hero copy, Services…) is not shown — the drafted page is flat | • spec shows Layers open with the nested frame tree, a "Hero copy · frame" tag and a Font / Size / Weight / Colour / Align card; impl shows the full Type inspector column and no Layers<br>• camera 28 % vs spec 56 % on one artboard | [light](cf-frames-text-light.jpg) · [dark](cf-frames-text-dark.jpg) |
| `cf-big-tree` | 13 · 93 canvases in folders | generated 93-canvas project (folders campaign/social/print/brand/matchday/web, a 21-artboard canvas, a broken canvas); one folder expanded | partial: no real Alligators data — names are Campaign01…, no 2026/combine hierarchy, no recents, no covers, no test files | • project opens on the v1 "No canvas open — Start quick setup" card; spec has Combine-kampan open with its artboards<br>• tree rows have blank thumbnail squares (spec: real covers) and no truncated-name tooltip<br>• no "Recent" block and no per-folder count that adds to 93 beyond the chips (All 93 · 0 · 85 · 1 · 6)<br>• Share button disabled | [light](cf-big-tree-light.jpg) · [dark](cf-big-tree-dark.jpg) |
| `cf-panel-search` | 14 · Search inside the panel | big fixture; type "campaign" into the panel search | yes | • spec flattens to a result list with thumbnails and a second line (folder or matching artboard) under each name and accent-insensitive match ("letak" finds "leták"); impl keeps the tree, marks the match inline and adds a folder chip, "16 results" in the foot<br>• no thumbnails; different query (fixture has no Czech names) | [light](cf-panel-search-light.jpg) · [dark](cf-panel-search-dark.jpg) |
| `cf-search-k` | 15 · ⌘K — canvases first, then tools | big fixture; ⌘K, type "camp" | yes | • spec shows three sections — Canvases (thumbnail, project, folder, who/when), "Tools and settings — not on screen, found by search" with each tool's menu path, and an "Ask AI — describe what you want" row; impl shows only a long Canvases list (file icons, "29 results") for this query<br>• palette is wider in impl (850 px vs 540 px at the same scale) and centred higher | [light](cf-search-k-light.jpg) · [dark](cf-search-k-dark.jpg) |
| `cf-open-big` | 16 · 21 artboards, fit to view | big fixture, open the 21-artboard canvas, ⌘0 | partial: 21 identical white cards, not the 19 social + 2 print mixed canvas | • ⌘0 leaves the last row clipped at the bottom; spec fits all 21 at 10 % with a "Zoom to fit · 10 %" label<br>• spec has panels hidden and the toast "Panels hidden. Press ⌘\ to bring them back"; impl keeps the panel open<br>• artboard labels are the plain titles, spec shows kind icon + name + size | [light](cf-open-big-light.jpg) · [dark](cf-open-big-dark.jpg) |
| `cf-busy` | 17 · Tereza, Jonas, AI and you | — | no: needs other people on the canvas (presence cursors, objects in their colours, two AI chats open, Tereza in Preview) — a hub / collab peers; no local route | — | — no pair (nothing to show) |
| `cf-status-words` | 18 · Save status, in words | fixture project, Edit mode, top-right cluster; second frame with navigator.onLine = false (network up) | partial: only "Local project" is reachable — Saved, Syncing… and Offline — kept on this Mac need a project linked to a hub | • offline emulation does not change a local project's word (identical frames); the spec lists four words with a sentence each, impl has the cluster only<br>• spec avatars (T, J) beside the word; impl avatar YO + a comment icon in the cluster | [light](cf-status-words-light.jpg) · [dark](cf-status-words-dark.jpg) |
| `cf-render-error` | 19 · A canvas that won't draw | big fixture, open Broken.tsx (syntax error); second frame: open Smoke, then a syntax error is written to its file | partial: the card is reached; the "last good version" dimmed behind it is not (Broken has none) | • card is smaller and plain: no dimmed last-good picture behind it, no "Go back to 14:05" verb, no "Last good version · 6 Oct, 14:05" line; the only action is "Ask AI to fix it" (spec puts AI repair in the panel as a chip)<br>• live break of an open canvas keeps the old picture and shows the v1 dev bar "build error — držím poslední funkční verzi" (Czech debug text) instead of the v2 card<br>• text: "Its code stops halfway on line 3. Other canvases are fine; the last good version is in Version history." vs spec "The last change has a mistake the canvas can't show…" | [light](cf-render-error-light.jpg) · [dark](cf-render-error-dark.jpg) |
| `cf-offline-create` | 20 · A new canvas with no internet | navigator.onLine = false (the local server stays reachable), ⌘K › New canvas | yes | • "AI is back when this Mac is online." line ✓ and Ask AI stays on; the spec's queued prompt ("Three reel covers… Queued — sends when this Mac is online.") is not shown because no prompt was sent<br>• status word stays "Local project" (spec "Offline — kept on this Mac", a hub-linked project)<br>• left panel is a full-height column; spec floating island with real folders | [light](cf-offline-create-light.jpg) · [dark](cf-offline-create-dark.jpg) |


## After (stage D, 2739edc35)
Re-shoot of the IMPL side on `feat/maude-v2` tip 2739edc35 (stage C round 2 merged), no product code changed. 19 artboards with pairs (light + dark), 1 without a frame. Evidence only — no match / mismatch judged here.

- **IMPL.** Same stage-A harness (`_harness-g1/`, copied and repointed; kept as `_d-harness-g1/`), fresh release client, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, Playwright Chromium 1600 × 1000. Harness adaptations (the product moved; no product code touched): the What’s new notice’s dismiss is now `.maude-notice-close` (its first button became "See all" and opened the panel over every shot); Esc no longer closes Version history, so 05 closes it by its own button (`vh-close`); the right-hand panels, Settings and the sheets moved, so the impl crops of es-panels-canvas (history), es-panels-make (AI), es-canvas-three, ob-adv-sheets and ob-settings were re-fitted to the new geometry; the dark es-landing filmstrip now finds its first frame by the blue Ask AI button (stage A picked loading skeletons).
- **SPEC.** reused (board 01 .tsx/.css unchanged since stage A — git log 04c20ad74..tip empty); light = host dark-token rule removed, dark = host injection, as in stage A.
- **Full-size pairs.** `full-size-path.txt` (stage D line); committed `<id>-<theme>.jpg` overwritten (JPEG q55 ≤ 1100 px).

| id | light | dark | note |
| --- | --- | --- | --- |
| `cf-home-prompt` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-ai-drafting` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused **Round 3 (p8-c3-ai):** IMPL re-shot after the AI-on-canvas / chat fixes; SPEC reused. |
| `cf-ai-done` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused **Round 3 (p8-c3-ai):** IMPL re-shot after the AI-on-canvas / chat fixes; SPEC reused. |
| `cf-select-tweak` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-sticky-comment` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-undo-before` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused **Round 3 (p8-c3-ai):** IMPL re-shot after the AI-on-canvas / chat fixes; SPEC reused. |
| `cf-undo-ai` | re-shot (state not reached) | re-shot (state not reached) | stage A reason stands: the fake agent writes the canvas file directly, not through the edit-op stack; stage C round 2 lists "undo of an AI edit through the shared stack" as still open (fix-navcreate.md) — no new state to reach **Round 3 (p8-c3-ai):** IMPL re-shot after the AI-on-canvas / chat fixes; SPEC reused. |
| `cf-blank` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-add-artboard` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-duplicate-width` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-duplicate-done` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-frames-text` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-big-tree` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-panel-search` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-search-k` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-open-big` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-busy` | unreachable | unreachable | needs other people on the canvas (presence, two AI chats, a second person) — a hub / collab peers; no local route; stage C did not add one |
| `cf-status-words` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-render-error` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |
| `cf-offline-create` | re-shot | re-shot | IMPL re-shot on the current tip; SPEC reused |

## Round 3 re-shoot (p8-c3-modes)

IMPL re-shot after the round-3 modes / menus fixes; the committed <id>-<theme>.jpg pairs are overwritten for: cf-duplicate-width. No match is judged here. Shot on the 04 fixture (Homepage, Desktop artboard) with the left panel folded; the SPEC image is the stage-A one.
## after (stage D, round 3 — p8-c3-shell, impl c7f1a0efd)

All rows above re-shot, IMPL side only, light + dark (SPEC reused, boards unchanged). What changed in the shell frame: the Undo · Redo · zoom % island bottom left, the Canvases panel hugs its rows (no twisty at rest), kind chips only for a mixed project. See `fix-c3-shell.md`.

## FINAL (stage D2, d3881fe41)
Final re-shoot of the IMPL side on the merged `feat/maude-v2` tip d3881fe41 (stage C rounds 1-4 merged); no product code changed. This section supersedes every per-round "after" section above. 19 artboards with pairs (light + dark), 1 without a frame. Evidence only — no match / mismatch judged here.

- **IMPL.** Stage-D harness (`_d-harness-g1/`) plus the round-3 `_c3-ai-harness/` (fake agent writes through the design plugin's hook; panel folded for the result toast), repointed to this worktree; fresh release client, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, Playwright Chromium 1600 x 1000. The AI finish moment (cf-ai-done, ob-first-draw's done frame) is shot while `[data-fresh]` is on the artboard. Undo waits 7 s for the canvas to settle. The final harness is kept in `_d-harness-g1-final/`.
- **SPEC.** reused (board 01 .tsx/.css unchanged: no `.design` commit since the stage-D spec shots).
- **Full-size pairs.** `full-size-path.txt` (the last line, "final (D2)"); committed `<id>-<theme>.jpg` overwritten (JPEG q55, <= 1100 px).

| id | light | dark | note |
| --- | --- | --- | --- |
| `cf-home-prompt` | re-shot | re-shot |  |
| `cf-ai-drafting` | re-shot | re-shot |  |
| `cf-ai-done` | re-shot | re-shot | IMPL = two frames: the panel-folded frame with the result toast shot the moment `[data-fresh]` appears (the 1.8 s finish moment), and the panel reopened ~2 s later (settled: label only) |
| `cf-select-tweak` | re-shot | re-shot |  |
| `cf-sticky-comment` | re-shot | re-shot |  |
| `cf-undo-before` | re-shot | re-shot |  |
| `cf-undo-ai` | re-shot | re-shot |  |
| `cf-blank` | re-shot | re-shot |  |
| `cf-add-artboard` | re-shot | re-shot |  |
| `cf-duplicate-width` | re-shot | re-shot |  |
| `cf-duplicate-done` | re-shot | re-shot |  |
| `cf-frames-text` | re-shot | re-shot |  |
| `cf-big-tree` | re-shot | re-shot |  |
| `cf-panel-search` | re-shot | re-shot |  |
| `cf-search-k` | re-shot | re-shot |  |
| `cf-open-big` | re-shot | re-shot |  |
| `cf-busy` | unreachable | unreachable | unreachable — needs other people on the canvas (presence, two AI chats, a second person): a hub / collab peers; no local route |
| `cf-status-words` | re-shot | re-shot |  |
| `cf-render-error` | re-shot | re-shot |  |
| `cf-offline-create` | re-shot | re-shot |  |

## After (round 5, p8-c5-panels @ 2e203e9e6)
IMPL re-shot light + dark on the round-5 tip with the stage-D harness (`_d-harness-g1/`, repointed; the Playwright cache was gone, so the shots ran on the system Chrome channel). SPEC reused. Every id with a pair above was overwritten. Evidence only; no match / mismatch judged here.

- Changed in the product for these frames: the Canvases panel is the board island (no accent Make-a-design-system row, no empty Trash row, no foot at rest, "Search ⌘K", "N canvases" on the project row, pictures on the rows), "+ New canvas" named by its words, the comment card (04 / 10 / 01 cf-sticky-comment).
- Harness drift handled (no product code): the Trash row is gone while the trash is empty, so the Trash frame opens it from Advanced; the Comments icon is drawn only with comments, so the Comments frame opens by ⌘K › Comments; the Layers frame re-opens the left panel first.

## FINAL (D3, 63592219a)
Final re-shoot D3 of the IMPL side on the merged `feat/maude-v2` tip 63592219a (stage C rounds 1-5 + bugs3 merged); no product code changed. This section supersedes every earlier "after" / FINAL section above. 19 artboards with pairs (light + dark), 1 without a frame. Evidence only — no match / mismatch judged here.

- **IMPL.** D2 harness (`_d-harness-g1-final/`, round-5 revision of the 01/02/05 scenarios) plus the bugs3 `s01ai.mjs` (waits for the run's end before ⌘Z), repointed to this worktree; kept in `_d-harness-g1-d3/`. Changes for D3: the fake agent steps every 9 s (was 7 s) so the harness's folding clicks finish before the run does; the finish moment is detected by a MutationObserver inside the canvas frame (re-armed on reload) and shot while `[data-fresh]` is on, panel folded, result toast up; the undo frame is shot while the "Undone — <label> · Redo" toast is still up. Fresh release client, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, Playwright Chromium 1600 x 1000, light + dar- **SPEC.** reused (board 01 .tsx/.css unchanged since 2026-10-18).
- **Full-size pairs.** `full-size-path.txt` (the last line, "final (D3)"); committed `<id>-<theme>.jpg` overwritten (JPEG q55, <= 1100 px).

| id | light | dark | note |
| --- | --- | --- | --- |
| `cf-home-prompt` | re-shot | re-shot |  |
| `cf-ai-drafting` | re-shot | re-shot |  |
| `cf-ai-done` | re-shot | re-shot | IMPL = two frames: the panel-folded frame with the result toast shot the moment `[data-fresh]` appears (the 1.8 s finish moment), and the panel reopened ~2 s later (settled: label only) |
| `cf-select-tweak` | re-shot | re-shot |  |
| `cf-sticky-comment` | re-shot | re-shot |  |
| `cf-undo-before` | re-shot | re-shot |  |
| `cf-undo-ai` | re-shot | re-shot | shot after the run ended (⌘Z is refused while your own AI works), while the undo toast "Undone — Try a dark hero · Redo" is up |
| `cf-blank` | re-shot | re-shot |  |
| `cf-add-artboard` | re-shot | re-shot |  |
| `cf-duplicate-width` | re-shot | re-shot |  |
| `cf-duplicate-done` | re-shot | re-shot |  |
| `cf-frames-text` | re-shot | re-shot |  |
| `cf-big-tree` | re-shot | re-shot |  |
| `cf-panel-search` | re-shot | re-shot |  |
| `cf-search-k` | re-shot | re-shot |  |
| `cf-open-big` | re-shot | re-shot |  |
| `cf-busy` | unreachable | unreachable | unreachable — needs other people on the canvas (presence, two AI chats, a second person): a hub / collab peers; no local route |
| `cf-status-words` | re-shot | re-shot |  |
| `cf-render-error` | re-shot | re-shot |  |
| `cf-offline-create` | re-shot | re-shot |  |


## Round 6 (p8-c6-aisurf, 89a794e96)

Re-shot on the p8-c6-aisurf worktree tip, both themes, committed pairs overwritten (spec left | impl right). The critic judges; this builder does not.

- Harness: `_c6-harness-g2/s01ai.mjs` (the D3 g1 script, `fake-acp` paths repointed to `.scr/impl`), run through the g2 `run.mjs` / `pairs.mjs` (impl frames are 1600x1000 jpg, spec side cropped to 1440x900).
- Product (p8-c6-aisurf): the camera Fits whenever an artboard lands while a run of yours draws (`cf-ai-drafting.tablet` shows Desktop + Tablet at 39 %); the finish frame shows the "Made by AI" label only (no ring, no wash); the chat is titled from the ask while it runs; one hugging island.
- Still open: the Mobile ghost + "AI is drawing Tablet" ring on the artboard being drawn (the ring layer has no hold for a blank-canvas run, so the file-write rim shows until the run ends); the generic follow-up row after a multi-artboard finish.

| id | dark | light |
|---|---|---|
| `cf-ai-drafting` | re-shot (round 6) | re-shot (round 6) |
| `cf-ai-done` | re-shot (round 6) | re-shot (round 6) |
| `cf-undo-before` | re-shot (round 6) | re-shot (round 6) |
| `cf-undo-ai` | re-shot (round 6) | re-shot (round 6) |

## FINAL (D4, 21c9714cf)
Final re-shoot D4 of the IMPL side on the merged `feat/maude-v2` tip 21c9714cf (stage C rounds 1-6 + bugs4 merged); no product code changed. This section supersedes every earlier "after" / FINAL section above. 19 artboards with pairs (light + dark), 1 without a frame. Evidence only — no match / mismatch judged here.

- **IMPL.** D3 harness (`_d-harness-g1-d3/`; the round-6 `_c6-harness-g2/s01ai.mjs` differs from it only in the fake-acp path, so the D3 copy ran unchanged), repointed to this worktree and kept in `_d-harness-g1-d4/` with a 01-only chain (`chain01.mjs`: s01ai, s01b, s01c, s01d, then home2 for `cf-home-prompt`) and `final-index-d4.mjs`. No scenario needed adapting to the round-6 product: every id was reached. Fresh release client, throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, Playwright Chromium 1600 x 1000, light + dark. The AI frames use the fake agent (9 s steps); the finish frame is shot inside the 1.8 s `data-fresh` window with the panel folded and the result toast up; `cf-undo-ai` waits for the run's Done, then shoots while the "Undone — <label> · Redo" toast is up.

- **SPEC.** reused: board 01 `.tsx` / `.css` unchanged since stage A (`git log` over `.design/ui/v2/01*` since 2026-10-18 is empty); the same full-size spec PNGs as D3.
- **Full-size pairs.** `full-size-path.txt` (the last line, "final (D4)"); committed `<id>-<theme>.jpg` overwritten (JPEG q55, <= 1100 px).

| id | light | dark | note |
| --- | --- | --- | --- |
| `cf-home-prompt` | re-shot | re-shot |  |
| `cf-ai-drafting` | re-shot | re-shot | IMPL = drafting frame + the tablet-landed frame (the shell fits the camera while AI drafts) |
| `cf-ai-done` | re-shot | re-shot | IMPL = two frames: the panel-folded frame with the result toast shot while `[data-fresh]` is on, and the panel reopened ~2 s later (settled) |
| `cf-select-tweak` | re-shot | re-shot |  |
| `cf-sticky-comment` | re-shot | re-shot |  |
| `cf-undo-before` | re-shot | re-shot |  |
| `cf-undo-ai` | re-shot | re-shot | shot after the run ended (⌘Z is refused while your own AI works), while the undo toast "Undone — Try a dark hero · Redo" is up |
| `cf-blank` | re-shot | re-shot |  |
| `cf-add-artboard` | re-shot | re-shot |  |
| `cf-duplicate-width` | re-shot | re-shot |  |
| `cf-duplicate-done` | re-shot | re-shot |  |
| `cf-frames-text` | re-shot | re-shot |  |
| `cf-big-tree` | re-shot | re-shot |  |
| `cf-panel-search` | re-shot | re-shot |  |
| `cf-search-k` | re-shot | re-shot |  |
| `cf-open-big` | re-shot | re-shot |  |
| `cf-busy` | unreachable | unreachable | unreachable — needs other people on the canvas (presence, two AI chats, a second person): a hub / collab peers; no local route |
| `cf-status-words` | re-shot | re-shot |  |
| `cf-render-error` | re-shot | re-shot |  |
| `cf-offline-create` | re-shot | re-shot |  |

## Round 7 (p8-c7-cf08) — after

Harness `_c7-harness-g1/` (s01b / s01c / s01d on top of `_d-harness-g1-d4/`). Re-shot light + dark: cf-select-tweak (the Desktop ARTBOARD selected, AI panel open), cf-frames-text (Layers open), cf-sticky-comment (the Sticky tool armed: colour row), cf-duplicate-width / cf-duplicate-done (the menu's copy lands under the source), cf-add-artboard, cf-big-tree, cf-panel-search (flat list, one line per canvas), cf-search-k (picture tiles, Ask AI pinned), cf-open-big (⌘0 then ⌘\: panels hidden + the toast), cf-render-error (the throwing-component variant: Go back to <time>, the dimmed last good version, details folded; the cold Broken.tsx frame is not part of the pair this round), cf-status-words, cf-offline-create, cf-blank. NOT re-shot (unchanged by this round): cf-home-prompt, cf-ai-drafting, cf-ai-done, cf-undo-before, cf-undo-ai.
Open: cf-big-tree (opens its last canvas + Recent block), the "Zoom to fit · N %" read-out, the add-artboard picker placement, the duplicate gap pill — see `fix-c7-cf08.md`.

## Round 7b (p8-c7-cf08b) — after

Harness `_c7b-harness-g1/` (s01b / s01c on top of `_c7-harness-g1/`). Re-shot light + dark: **every 01 id with a frame** (cf-home-prompt, cf-ai-drafting, cf-ai-done, cf-undo-*, cf-big-tree, cf-open-big, cf-add-artboard, cf-duplicate-*, plus the rest of the chain); cf-busy stays unreachable (presence + a second person).

| id | after (round 7b) |
|---|---|
| `cf-big-tree` | the project OPENS its last canvas (Combine campaign) — a Recent block (the last three opened here: Campaign01 · 1 h ago, Brand03 · 2 h ago, …) sits above the project head; the stray What's-new toast is closed |
| `cf-open-big` | ⌘0 on the canvas: the readout says "Zoom to fit · 44%" (the shell is told the camera sits on the last fit); panels folded with the "Panels hidden" toast |
| `cf-add-artboard` | shot after the pick: the new artboard is drawn and selected with its size tag; the picker is not over it; no leftover toast |
| `cf-duplicate-done` | the copy lands under the source with the dashed shared left edge and the measured gap pill ("80"); the toast wears the copy glyph, no success tick; Layers rows read their words ("Calm software, ma…", "Book a call") |
| `cf-ai-drafting` | an artboard prints ONE AI tag (the held objects keep their dashed outlines); Tablet wears "AI is drawing Tablet"; the readout says "Zoom to fit · 39%" (the camera fitted when Tablet landed). Not drawn: the faint Mobile ghost (the canvas cannot know what the AI draws next) |
| `cf-ai-done`, `cf-undo-before`, `cf-undo-ai`, `cf-home-prompt` | re-shot on the merged tip, unchanged by this round |

Fix list: `fix-c7-cf08b.md`.


## FINAL (D5, e37e7d82a)
Final verification re-shoot of the IMPL side on the merged `feat/maude-v2` tip e37e7d82a (stage C rounds 1-7 merged, release client); no product code changed. Supersedes every earlier "after" / FINAL section. 19 of 20 artboards with pairs (light + dark). Evidence only — no match / mismatch judged here.

- **IMPL.** `_d5-harness-g1/` (= _d-harness-g1-d4 + the round-7 / 7b scenario files, repo-relative), shot on the Mac mini through `scripts/remote-lane.sh` in Google Chrome (the mini has no Playwright chromium build; viewport 1600 × 1000), throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, release-built client. Harness deltas this round: es-home-local registers no project; s05f opens the Comments panel through ⌘K (the share-cluster icon no longer opened it); home thumbnails are committed flat JPEGs (no ImageMagick on the mini).
- **SPEC.** reused — no board 01 / 02 / 05 file (.tsx / .css / .meta.json) changed since the D3 shoot (git log 63592219a..tip empty); the spec PNGs are the D3 set (02 re-rendered then).
- **Full-size pairs.** `full-size-path.txt` (last line, "final (D5)"); committed `<id>-<theme>.jpg` overwritten (JPEG q55, <= 1100 px).

| id | light | dark | note |
| --- | --- | --- | --- |
| `cf-home-prompt` | re-shot | re-shot |  |
| `cf-ai-drafting` | re-shot | re-shot |  |
| `cf-ai-done` | re-shot | re-shot | IMPL = the finish moment (panel folded, result toast, shot when `[data-fresh]` appears) + the settled frame |
| `cf-select-tweak` | re-shot | re-shot |  |
| `cf-sticky-comment` | re-shot | re-shot |  |
| `cf-undo-before` | re-shot | re-shot |  |
| `cf-undo-ai` | re-shot | re-shot | shot after the run ended (⌘Z is refused while your own AI works), while the undo toast is up |
| `cf-blank` | re-shot | re-shot |  |
| `cf-add-artboard` | re-shot | re-shot | IMPL = the state AFTER the pick (F, then the Laptop tile — round 7b), picker frame kept as the first sub-frame |
| `cf-duplicate-width` | re-shot | re-shot |  |
| `cf-duplicate-done` | re-shot | re-shot |  |
| `cf-frames-text` | re-shot | re-shot |  |
| `cf-big-tree` | re-shot | re-shot | project opens its last canvas, Recent block in the Canvases panel (round 7b) |
| `cf-panel-search` | re-shot | re-shot |  |
| `cf-search-k` | re-shot | re-shot |  |
| `cf-open-big` | re-shot | re-shot | IMPL = project opens its last canvas (Wide), ⌘0 after focusing the canvas, panels folded with ⌘\ (round 7 / 7b) |
| `cf-busy` | unreachable | unreachable | unreachable: needs other people on the canvas (presence, two AI chats, a second person) — a hub / collab peers; no local route; no stage C round added one |
| `cf-status-words` | re-shot | re-shot |  |
| `cf-render-error` | re-shot | re-shot | second frame = the throwing-component variant (round 7: the Go back card) |
| `cf-offline-create` | re-shot | re-shot |  |


## FINAL (D6, 3d58f57df)
Final verification re-shoot of the IMPL side on the merged `feat/maude-v2` tip 3d58f57df (stage C rounds 1-8 merged, release client); no product code changed. Supersedes every earlier "after" / FINAL (incl. D5) section. 19 of 20 artboards with pairs (light + dark). Evidence only — no match / mismatch judged here.

- **IMPL.** `_d6-harness-g1/` (= _c8-harness-g1, the round-8 harness, + the Home first-run flag per scene; repo-relative), shot on the Mac mini through `scripts/remote-lane.sh` in Google Chrome (the mini has no Playwright chromium build; viewport 1600 × 1000), throwaway HOME/XDG + stub claude, `NO_OPEN=1 MAUDE_NO_AUTOBUILD=1`, release-built client. Harness deltas this round: round-8 s01b (folds before the select pick, two filled stickies, Comments closed); home2.mjs writes home.json firstRunSeen:true for es-home-local ONLY (the Mac has seen the first-run card: the quiet sign-in pill and the empty shelf) and removes it for every other scene (ob-first-launch and siblings keep the card).
- **SPEC.** reused — no board 01 / 02 / 05 file (.tsx / .css / .meta.json) changed after the D3 shoot (the last board edit, 3840271a0 = 02 chip words, precedes D3; the spec ob-first-launch frame was checked: its chip reads "a project on this Mac"); the spec PNGs are the D3 set.
- **Full-size pairs.** `full-size-path.txt` (last line, "final (D6)"); committed `<id>-<theme>.jpg` overwritten (JPEG q55, <= 1100 px).

| id | light | dark | note |
| --- | --- | --- | --- |
| `cf-home-prompt` | re-shot | re-shot |  |
| `cf-ai-drafting` | re-shot | re-shot |  |
| `cf-ai-done` | re-shot | re-shot | IMPL = the finish moment (panel folded, result toast, shot when `[data-fresh]` appears) + the settled frame |
| `cf-select-tweak` | re-shot | re-shot |  |
| `cf-sticky-comment` | re-shot | re-shot |  |
| `cf-undo-before` | re-shot | re-shot |  |
| `cf-undo-ai` | re-shot | re-shot | shot after the run ended (⌘Z is refused while your own AI works), while the undo toast is up |
| `cf-blank` | re-shot | re-shot |  |
| `cf-add-artboard` | re-shot | re-shot | IMPL = the state AFTER the pick (F, then the Laptop tile — round 7b), picker frame kept as the first sub-frame |
| `cf-duplicate-width` | re-shot | re-shot |  |
| `cf-duplicate-done` | re-shot | re-shot |  |
| `cf-frames-text` | re-shot | re-shot |  |
| `cf-big-tree` | re-shot | re-shot | project opens its last canvas, Recent block in the Canvases panel (round 7b) |
| `cf-panel-search` | re-shot | re-shot |  |
| `cf-search-k` | re-shot | re-shot |  |
| `cf-open-big` | re-shot | re-shot | IMPL = project opens its last canvas (Wide), ⌘0 after focusing the canvas, panels folded with ⌘\ (round 7 / 7b) |
| `cf-busy` | unreachable | unreachable | unreachable: needs other people on the canvas (presence, two AI chats, a second person) — a hub / collab peers; no local route; no stage C round added one |
| `cf-status-words` | re-shot | re-shot |  |
| `cf-render-error` | re-shot | re-shot | second frame = the throwing-component variant (round 7: the Go back card) |
| `cf-offline-create` | re-shot | re-shot |  |

## after (round 10, p8-c10-misc)

Re-shot light + dark on the Mac mini (Google Chrome), impl side only; spec reused.

| id | theme | after | note |
| --- | --- | --- | --- |
| `cf-render-error` | dark | re-shot | AI panel open while the card shows, so the "Ask AI to fix it" chip is on the shot |
| `cf-render-error` | light | re-shot | AI panel open while the card shows, so the "Ask AI to fix it" chip is on the shot |
