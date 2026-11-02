# copy-critic — 01 Create Flow — V2-8.5 stage B

_2026-10-22 · board `.design/ui/v2/01 Create Flow.tsx` (+ `_kit.tsx`) · DS `.design/system/maude-v2/CONTRACT.md` §3 words, §4 voice · pairs `01-create-flow/INDEX.md` + full-size PNGs + raw impl frames (`.scr/impl-raw/01`) · voice POV: calm studio-grade tool, plain words, AI described by its result, never "we"/"I"_

**Lens.** I compared every visible string on the board with the same state in the app, and checked both against CONTRACT §3–§4. Where a board disagrees with CONTRACT, CONTRACT wins and the row says **board is stale**. Where two boards disagree (01 vs 08 / 11 / 14, or a later decision), it is a **warning that needs a ruling**, not a blocker.

**Themes.** Copy does not change with the theme. I put every dark impl frame in one contact sheet and checked them against the light ones: same states, same strings. So each row covers **light and dark**, and I count it once per artboard. Fixture-only differences (names Campaign01…, "Local project" + YO, no Tereza, e2e-fixture) are not findings.

## TL;DR

**Blockers: 12** · Warnings: 23 · Verdict: **fix-and-retry**

The AI copy breaks first. `run.doing` has no writer anywhere, so the working line is always "AI is working". The step under it is the agent's raw tool title. The done toast quotes the reply's *first* sentence, and its action is "Show", not "Undo". Raw DOM leaks into the UI: `div`, `h1.dc-text-editing` and "Desktop (1280px)" show up as names. One v1 Czech string still renders.

## Per artboard

| id · theme | difference | spec (board) | impl | owner file:line | sev |
| --- | --- | --- | --- | --- | --- |
| cf-home-prompt · L+D | starters | "A pricing page · with a yearly toggle", "Three logo ideas · for Alligators brand", "An onboarding flow" | "A design system · for Studio site", "A pricing page", "An onboarding flow". S10.16c replaced the logo starter with the design-system one, so the **board is stale** vs S10.16c | `client/home/home-starters.js:131-136` | W |
| cf-home-prompt · L+D | lower shelf | "Recent projects" cards + "Open project… · Any folder works", "See all" | "Projects · 2 projects", "You · you@studio.cz", "4 canvases · this Mac only", "New project… ⇧⌘N", "Open project… ⌘O", plus an "All projects" filter. Impl follows canvas 11 `pn-home`, so this needs a ruling | `client/home/home-app.jsx:864,927-945` | W |
| cf-home-prompt · L+D | Shared shelf (not on board) | — | "Shared with you · canvases from other people's projects" / "Nothing shared with you yet." (copy fine; extra block vs board) | `client/home/Shelves.jsx:185` | W |
| cf-ai-drafting · L+D | working line | "AI is drawing Tablet" · "Desktop done · Mobile next" | "AI is working" · "Edit the canvas · 0:10". `workingText` only names the work when `run.doing` is set, and nothing in `apps/studio` ever sets it. The step is `activityLabel(tools)`, i.e. the raw ACP tool title ("1 subagent running" / "N tasks running" otherwise). A real Claude run would show tool titles like file edits here | `client/v2/ai/run-model.js:61-67`, `client/v2/ai/RunSurface.jsx:225-227`, `client/panels/acp-runtime.js:60-66` | **B** |
| cf-ai-drafting · L+D | on-canvas AI words | "AI is drawing Tablet" tag on the artboard, "Mobile — next" ghost label, "Made by AI" tag in the label row | none (may be partly the fake agent writing the file directly; `MADE_BY_AI_TAG` exists but is never drawn here) | `client/v2/ai/made-by-ai.js:21` | **B** |
| cf-ai-drafting · L+D | chat title | "A calm landing page ⌄" | "New chat" while working, then the truncated prompt "A calm landing page fo…" | AI panel header (`client/v2/ai/AiChatIsland.jsx`) | W |
| cf-ai-drafting · L+D | tool card in the feed | none (prose only) | mono card "Edit the canvas": the agent's tool title shown as UI copy | `client/v2/ai/Feed.jsx:448` | W |
| cf-ai-drafting · L+D | Canvases row slot | "AI is drawing" | "AI is working" (same root cause: no `doing`) | `client/v2/ai/row-slots-lane.js:24` | W |
| cf-ai-done · L+D | toast action | "Done — Desktop, Tablet and Mobile are on the canvas." **Undo** | "…" **Show** + × | `client/v2/ai/needs-you-toast.js:68` | **B** |
| cf-ai-done · L+D | toast line source | the result sentence | "Drafting the landing page — Desktop first, then Tablet and Mobile." `doneLine` takes the first sentence of the whole reply, not of the final message. A real Claude reply that opens with "I'll…" would put "I" in a toast (CONTRACT §4) | `client/v2/ai/needs-you-toast.js:53-63` | **B** |
| cf-select-tweak · L+D | selection name | title "Desktop" (artboard) | selection tag "div · 1440 × 996", crumb "Desktop › div", title "div" + chip Frame. When there is no label it falls back to the HTML tag; CONTRACT §3 says "frame" | `client/v2/inspector/model.js:54,62`, `inspect-overlay.tsx:73-78` | **B** |
| cf-select-tweak · L+D | colour values | Fill "White", Colour "Ink" (token names) | "rgb(255, 255, 255)", "rgb(17, 17, 17)" as the default view (no token match in the fixture, but raw CSS sits outside Advanced) | `client/v2/inspector/sections/fill.jsx`, `color-control.jsx` | W |
| cf-select-tweak · L+D | DS link | — | "Uses project": the system's slug, not a name | `client/v2/inspector/frame.jsx:216` | W |
| cf-select-tweak · L+D | artboard rows | Preset "Custom" · Size · Fill · Corners · Clip content · Export "PNG · 2×" | not reached: the click selects the page div. Fix in the product: a click on an artboard's page selects the artboard | `client/v2/inspector/kinds/frame.jsx` | W |
| cf-sticky-comment · L+D | one-time hint | — | "⌘Enter commits and creates the next one beside it." CONTRACT §2 requires the ↵ glyph (⌘↵); "commits" is git jargon. Fix: "⌘↵ adds the next sticky beside it." | `annotations-layer.tsx:2776` | **B** |
| cf-sticky-comment · L+D | Tereza's bubble, written stickies | "Could the button say “Book a call”?…" | own compose "Add a comment — @ mentions someone" (fixture: no second person) | — | — |
| cf-undo-before · L+D | suggestion chips | "Try it on Tablet", "Lighter dark" | "Same on the other artboards", "A darker shade", "Apply it everywhere" + "Because you last asked about colour". It is a fixed colour set: two chips say the same thing, and it offers *darker* right after "went too far" | `client/v2/ai/suggest-why.js:143-145` | W |
| cf-undo-ai · L+D | undo toast | "Undone — the dark hero by AI." **Redo** | unreachable: ⌘Z / ⌘K Undo do not revert the agent's file write. The nearest code says "Undid this chat — one new version. ⌘Z brings it back." (wrong key: redo is ⇧⌘Z; wording differs). Fix in the product: put agent edits on the edit-op undo stack (A10 "one AI run is one undo step") | `client/v2/ai/ChatUndo.jsx:20-28` | **B** |
| cf-blank · L+D | second action | only "Ask AI ⌘/" (CONTRACT §6 line ✓ exact) | + "New artboard". W7 "no door" decision, so the **board is stale** vs W7 | `client/v2/empty/empty-canvas.jsx:9`, `empty-copy.js:76` | W |
| cf-add-artboard · L+D | preset vocabulary | Web (Desktop 1440 × 900 · Laptop · Tablet · Mobile) / Social (Post 1080 × 1080 · Story) / Print (A4 · A5 · Letter) / Video (Landscape 16:9 · Vertical 9:16) | App "Fixed size" (Desktop 1440 × 1024…) / Web page "Grows as you add" / Social (Post 4:5, Story 9:16 (still), FB event cover) / Print "mm, with bleed" / Video "Has a timeline" (Reels 9:16 (moving), Square 1:1). Impl follows 08, so 01 is stale vs 08; needs a ruling | `kinds/presets.ts:162,262`, `client/v2/kinds/size-picker-model.js:20-21` | W |
| cf-add-artboard · L+D | parentheticals | "Story" | "Story 9:16 (still)", "Reels 9:16 (moving)": brackets explaining a kind belong in the group chip | `kinds/presets.ts:162` | W |
| cf-duplicate-width · L+D | menu words | "Ask AI about Desktop"; submenu "Laptop  1280" (number right-aligned) | "Ask AI about “Desktop”" (follows 14 `ed-ab-menu`); "Laptop — 1280" | `editing/artboard-menu.tsx:82,107` | W |
| cf-duplicate-width · L+D | rows | Copy ⌘C · Paste ⌘V | missing (no artboard clipboard yet, by design); adds "Add comment C", "Start a vote…", "Advanced ▸". CONTRACT §1 Edit has Copy/Paste. Product work: an artboard clipboard | `editing/artboard-menu.tsx:15-16,98-128` | W |
| cf-duplicate-done · L+D | copy's name | "Desktop — Laptop" | "Desktop (1280px)": a developer unit inside a name. The toast "Duplicated at Laptop — 1280 wide." + Undo is ✓ | `canvas-edit.ts:5002` | **B** |
| cf-frames-text · L+D | inspector title | "Calm software, made in Brno" · Text | "h1.dc-text-editing" · Text: the layer label is `tag.class`, including the internal editing class. Crumb "Desktop › div › Calm software, ..." | `canvas-shell.tsx:439-449` → `client/v2/inspector/model.js:50` | **B** |
| cf-frames-text · L+D | Layers / Type words | Layers tree "Nav · Hero · Hero copy…", Font "SF Pro Display", Colour "Ink" | not reached (flat fixture page); Font "Inherited", Colour "Inherited", "No style" | — | W |
| cf-big-tree · L+D | nothing open | Combine-kampan open | "No canvas open" / "Open a canvas from the Canvases panel, or start a new one." / **Start quick setup**: v1 placeholder, and the verb doesn't match what it says (it opens setup, not a canvas) | `client/shell/viewport.jsx:167-178` | **B** |
| cf-big-tree · L+D | "Recent" | a "Recent" block of canvases (Uniformy-2027 · 1 h ago) | "Recent ⌄" is the sort control: same word, other meaning; no recents block | `client/v2/canvases/sort.js:19` | W |
| cf-panel-search · L+D | result second line | "2026/combine", "print · “Náborový leták A6…” and 3 more" | inline chip "campaign"; foot "16 results · ⌘K searches every project" ✓ pattern | `client/v2/canvases/tree-model.js:552` | W |
| cf-search-k · L+D | groups / meta | "Tools and settings — not on screen, found by search" with "Menu › View › Advanced"; meta "Alligators brand · 2026/combine · Tereza, yesterday" | only "Canvases"; groups are "Tools" / "Settings" / "Actions" separately; meta "e2e-fixture · campaign · 1 artboard"; "29 results" ✓ | `client/v2/search/search-model.js:35-43` | W |
| cf-open-big · L+D | panel / zoom words | "Panels hidden. Press ⌘\ to bring them back." (CONTRACT §4) + "Zoom to fit · 10%" | not exercised (⌘\ not pressed); the string exists ✓; no zoom word (chip off by default) | `client/v2/shell/panel-layout.js:16` | W |
| cf-busy · L+D | whole state | legend + "AI is making it greener" · "Background done · the logo stays white" | **unreachable**: needs hub peers (Tereza, Jonas). Even then the working line can't say "making it greener" without a `doing` writer | `client/v2/ai/run-model.js:61` | **B** |
| cf-status-words · L+D | words | Saved · Syncing… · Offline — kept on this Mac · Local project | only "Local project" reached ✓; all five CONTRACT §6 words exist in code ✓. Needs a hub-linked project to verify the rest | `client/v2/shell/save-status.js:32-36` | W |
| cf-render-error · L+D | live-break notice | the v2 card | "⏸ build error — držím poslední funkční verzi" (Czech; CONTRACT §4 A20 English only), tooltip "Holding last working render — …" | `canvas-comment-mount.tsx:661-670` | **B** |
| cf-render-error · L+D | card body | "The last change has a mistake the canvas can't show. Behind this card is the last good version, from 6 Oct, 14:05 — nothing is lost…" + **Go back to 14:05** | "Its code stops halfway on line 3. Other canvases are fine; the last good version is in Version history." + "Ask AI to fix it". The line number is the technical part, and the board note puts that only under Show details. The last-good case wasn't reached (text exists, `:60`) | `client/v2/code/canvas-error-card.jsx:56-63,181,200` | W |
| cf-offline-create · L+D | door / queued | one button; "Queued — sends when this Mac is online." | "AI is back when this Mac is online." ✓, "Untitled canvas 2" ✓ (CONTRACT §3); + "New artboard" (as cf-blank); queued line not exercised (exists `empty-copy.js:87`) | `client/v2/empty/empty-canvas.jsx:9` | W |

## Root causes (several artboards)

1. **No writer for `run.doing`.** Every "AI is <verb> <thing>" line is impossible, and the step slot is filled with raw ACP tool titles instead. Hits cf-ai-drafting, cf-busy, cf-ai-done (row slot), and 02 ob-first-draw / ob-sig-draw. Files: `run-model.js:61`, `RunSurface.jsx:227`, `acp-runtime.js:60`.
2. **DOM tag/class names used as names.** `canvas-shell.tsx:439-449 layerLabel` (tag.class), `model.js:54` (tag fallback), `inspect-overlay.tsx:78`, and `canvas-edit.ts:5002` ("(1280px)"). The UI should fall back to the element's own text, then the kind word ("Frame", "Text").
3. **Done toast built from the wrong text.** `doneLine` takes the first sentence of the reply, and the action is "Show". It should be the final result sentence + Undo.
4. **v1 residue in shipped paths.** The Czech HMR toast (`canvas-comment-mount.tsx:670`) and "No canvas open / Start quick setup" (`viewport.jsx:167`).
5. **Boards 01 / 08 / 11 / 14 disagree** on starters, the Home lower shelf, the size picker, menu quotes and the empty-canvas door. The impl follows the later boards and decisions (S10.16c, W7). Board 01 needs a refresh pass, or Michal needs to rule.

```json
{"canvas":"01 Create Flow","critic":"copy-critic","blockers":12,"warnings":23,"verified_ids":[]}
```
