# copy-critic — 03 AI Chat · phase 8 stage B

_2026-10-22 · board `.design/ui/v2/03 AI Chat.tsx` (+ `_kit.tsx` AIPanel / ConnectSheet) · impl = release client, pairs in `.claude/worktrees/agent-a45b4750975bd8337/.scr/pairs/03-ai-chat/` · voice: CONTRACT §3 words + §4 voice (quiet pro; AI describes the result, never itself; what happened · what is safe · one verb; "Retry <name>") · strings reviewed ≈ 260_

**Themes.** Copy is the same in both themes. I read every dark pair and spot-checked light (ai-permission-light has the same strings). Each row covers **D·L**.
**Fixture and harness.** These are not findings: the fake-agent words (INDEX "H": "Edit the canvas", "The canvas did not change.", "You · changed outside the app"), the project being local ("YO · Local project"), artwork and names (Combine-kampan stand-in), and the C1 title bar.

## TL;DR

**Blockers: 15** · Warnings: 28 · Verdict: **fix-and-retry**

The happy path reads like the board: Undo / Keep going, the waiting card, the quit dialog, the attach menu, the connect sheet. Where AI asks or fails, the words come from the tool call instead of the work. A file name with a programmer verb (`Edit Combine-kampan.tsx?`, and `Delete` in the verb table) replaces "Replace 4 team photos?". Every uncoded failure says "the connection to Claude was interrupted" and offers "Try again". Artboard names fall back to ids ("post"). The canvas-side words "Made by AI" and "Copied from … before …" are missing.

## Per artboard (D·L)

| id | difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|---|
| ai-hero | no "Made by AI" tag after the finish | `aiMade="Made by AI"` on Post 1:1 | no tag; ring / wipe absent | `client/v2/ai/made-by-ai.js` (tag not painted after the hook-attributed edit) | blocker |
| ai-hero | extra fold under the result | result = line + Undo · Keep going | adds `What AI did · 1 step · 1 s` (`run-model.js:167`). Consistent with ai-long, which does draw it | `client/v2/ai/RunSurface.jsx` / `Result.jsx` | warning |
| ai-hero | consent card + attach chips not driven | `Let AI read "Combine 2026 fotky" (48 files)?` · Not now · Let AI read | — (strings exist in `Consent.jsx`) | harness did not attach a folder | warning |
| ai-open | ⌘/ opens an in-place ask bar, not the panel; chip is generic | panel opens; chip `◆ Post 1:1` | extra frame: ask bar `1 element` · `Ask AI…` over the Inspector | `client/v2/ai/ask-selection.js:38`, `use-ask-selection.js` | blocker |
| ai-open | empty-state hint split into title + sub | one line: "Ask for a change, a few variants, or an answer. AI works on what the chip says." | same words on two lines (bold + sub) | `client/v2/ai/Suggest.jsx:20-24` | warning |
| ai-open | no suggestion chips or why line | `Resolve 3 comments · Three variants · English version` + "Because Tereza left 3 comments on Post 1:1" | none (the fixture has no comments) | `suggest-why.js:91-98` | warning (fixture) |
| ai-suggest | last-ask chips and why are generic | `Same for the story · A darker green · Same on all 21` · "Because you last asked for a greener post" | `Same on the other artboards · A darker shade · Apply it everywhere` · "Because you last asked about colour" | `client/v2/ai/suggest-why.js:141-167` | blocker |
| ai-suggest | comments context, chip 2 | `Reply to Tereza` | `Reply to the comments` | `suggest-why.js:95` | warning |
| ai-suggest | clips context, chip 2 | `Czech captions` | `Add captions` | `suggest-why.js:112` | warning |
| ai-scope | chip and menu row show the artboard **id** | `◆ Post 1:1` · menu `Post 1:1 · Combine 2026` | `post` | `client/v2/ai/scope.js:175-178` (`labelOf` falls back to id), `use-ai-scope.js:30-66` (labels come only from `.meta.json`, never from the JSX `label=`) | blocker |
| ai-scope | `Choose artboards…` missing | Whole canvas · Post 1:1 · Choose artboards… · — · No canvas — just ask | no Choose row (same cause: an empty artboard list) | `scope.js:251` | (counted) |
| ai-working | step line is a raw tool title | `Background done · badge next` | `Edit the canvas 0:02` (H words). The step slot shows `activityLabel(tools)`, which falls back to the tool name | `RunSurface.jsx:227` | warning |
| ai-done | no "Made by AI" | `postMade="Made by AI"` | absent | `made-by-ai.js` | blocker |
| ai-done | follow-ups carry a why line; chips generic | follow-ups `Same on Story 9:16 · A darker green` with no reason (Note 3: "Follow-ups under an answer need no reason") | strip + "Because you last asked about colour" | `suggest-why.js:141-167`, `Suggest.jsx` strip | warning |
| ai-done | result line ✓ · `Undo` ✓ · `Keep going` ✓ | — | — | — | — |
| ai-attach | only an image chip; no footage or PDF chip, no drop overlay | `Footage · 0:42`, `PDF · 12 pages`, "Drop to attach · AI can use it in this chat" | thumbnail chip. Overlay words exist (`DropOverlay.jsx:87-88` ✓) | harness | warning |
| ai-attach-menu | ✓ Attach files… · Choose a folder… · From Assets · Paste a screenshot ⌘V · Or drag files here | — | — | `AttachMenu.jsx` | verified |
| ai-question | `Waiting for you` tagged on every artboard while a question is open | no tag (a question leaves the canvas as it is) | azure `Waiting for you` on all five | `client/v2/ai/runs-model.js:215,305` (needs-you tag on every artboard in scope) | blocker |
| ai-question | follow-up chips + `9 pt` point tag absent | `Make the date line 14 pt · Check LetakA6 too` | none | — | warning |
| ai-long | `Jump to latest · 2 new`, edge tip, in-transcript attachment chips not in frame | as board | strings exist (`jump-model.js:44`, `BigChat.jsx:26`) | harness | warning |
| ai-long-pinned | ✓ pin tooltips (`BigChat.jsx:32-33` "Unpin — float over the canvas") | — | — | — | — |
| ai-two-artboards | no running list with `Working` rows | count chip opens `Make it greener · Post 1:1 · Combine 2026 · Working` / `Translate the poster · …` | the count's chevron opens the Chats list | `client/v2/ai/RunList.jsx` (not wired to the `✦ 2` chip) | blocker |
| ai-two-artboards | one verb for both artboards | `AI is making it greener` / `AI is translating to English` | `AI is working` ×2 (H) | `run-model.js:64` | — (H) |
| ai-same-artboard | ✓ "Waiting for "…" to finish on A4 · plakát. Starts by itself, on top of its result." · `Run on a copy` | — | — | `runs-model.js:420-430` | — |
| ai-same-artboard | holder name is the prompt, cut | `Waiting for "Make it greener"…` | `"…"` (attachment header leak, see ai-chat-list) | `runs-model.js:426` (`heldBy.label`) | warning |
| ai-copy | caption missing | `Copied from Post 1:1 before "Make it greener"` | no such string anywhere in `client/` | missing (`client/v2/ai/` copy surface) | blocker |
| ai-copy | result `Undo · Keep the copy`, divider "Ran on a copy — Post 1:1 was busy" not reached (frame is mid-run) | — | code ✓ `run-model.js:140,251` | — | warning |
| ai-queue-rule | documentation board | — | — | — | n/a |
| ai-other-tab | **unreachable**: needs Maude's own tab strip with two projects open (desktop lane, V2-3.7). Toast `Alligators brand — Post 1:1 is greener. 1 chat still running there.` · Show is unverified | — | — | — | warning |
| ai-tereza | **unreachable**: needs a hub project and a second person. `Tereza's AI · shorter headline`, "On this canvas" list unverified | — | — | — | warning |
| ai-chat-list | chat title leaks the attachment header | `Make it greener` | `Make it greener hang [maude-…` | `apps/studio/acp/transcript.ts:318-323` (`deriveTitle` → `stripAttachmentBlock` misses this header shape) | blocker |
| ai-chat-list | ✓ `Chats` · `Search chats` · `Running 3` · `3 chats · kept with the project`. The `Earlier` groups, `Needs you`, and the row menu (Open · Rename… · Copy transcript · Archive · Move to trash, `chat-list-model.js:213-222` ✓) weren't driven | — | — | — | warning |
| ai-panel-closed | done toast not captured | `Done — Post 1:1 is greener. The logo stays white.` · Show | code ✓ `needs-you-toast.js:68` | harness | warning |
| ai-quit | ✓ "Quit while AI is working?" · "2 chats stop where they are. Everything AI finished so far…" · Cancel / Quit | — | — | `stopped.js:51-58` | verified |
| ai-quit | n = 1 grammar (not in frame) | — | `1 chat stops where they are` | `client/v2/ai/stopped.js:56` → "1 chat stops where it is" | warning |
| ai-needs-hidden | toast names a file and a tool verb | `AI needs you on Uniformy-2027 — replace 4 team photos?` · Open | `AI needs you on Combine-kampan — edit Combine-kampan.tsx?` · Open · × | `client/v2/ai/needs-you.js:96-102` (title from tool kind + target file) → `needs-you-toast.js:41-44` | blocker |
| ai-needs-hidden | `Waiting for you` on all five artboards | only the affected ones | all five | `runs-model.js:305` | blocker |
| ai-needs-tab | **unreachable**: desktop tab strip. "AI needs you on Uniformy-2027 in Alligators brand" unverified | — | — | — | warning |
| ai-needs-away | **unreachable**: macOS notification + Dock badge (native) | — | — | — | warning |
| ai-permission | title and verb come from the tool, not from what changes | `Replace 4 team photos in Uniformy-2027?` · Not now · **Replace 4 photos** | `Edit Combine-kampan.tsx?` (+ detail line) · Not now · **Edit** | `needs-you.js:23-31,96-102` (`VERB_BY_KIND`) | blocker |
| ai-permission | the verb table has `delete: 'Delete'` | §7 "moved to the trash, never deleted"; §6 C17 | `Delete <file>?` / `Delete` would render | `needs-you.js:25` → `Move to trash` | blocker |
| ai-permission | thumbnail strip `Obrana, útok, speciální týmy, trenéři` absent; `Always for this canvas` only when the agent offers allow_always | as board | — | `PermissionCard.jsx:115-120` | warning |
| ai-permission | non-simple fallback title names Claude | — | `Claude needs your OK` | `needs-you.js:104` → "AI needs your OK" (§3) | warning |
| ai-choice-fail | every uncoded failure gets one fixed cause | "Couldn't finish — the footage file is missing. Nothing changed." + detail | "Couldn't finish — the connection to Claude was interrupted. Nothing changed." for any error | `client/v2/ai/needs-you.js:214-226` (`failureModel` ignores `raw`) | blocker |
| ai-choice-fail | the verb isn't the fixing verb or "Retry <name>" | `Pick another clip`; §4 a retry is **"Retry <name>"** | `Try again` | `needs-you.js:223` | blocker |
| ai-choice-fail | names Claude in running copy | §3 "AI" | "the connection to Claude" | `needs-you.js:222` | warning |
| ai-choice-fail | choice rows have no sub-line (agent-supplied, H) | `from the Alligators design system` | — | — | — |
| ai-not-ready | ✓ `Connect your Claude account?` · lead · `Claude Pro or Max` · Cancel / Connect · "Your prompt waits here and runs as soon as it's connected." | — | — | `ConnectSheet.jsx:15-31` | — |
| ai-not-ready | offline / setting up / used up / almost used up not reachable. The strings match the board in code (`gate-lines.js:16-18`) | — | — | needs network-offline + quota states in the lane | warning |
| ai-advanced | `default` wraps under "Replace or move to the trash" | `Replace or move to the trash` (note `default` beside it, in 28) | two lines | `advanced-model.js:41` + `Advanced.jsx` row | warning |
| ai-advanced | Model / Effort / Fast mode / This chat meters absent (no agent config, H) | — | — | — | — |
| ai-adv-edges | ✓ slash menu `/design:critic · Review this canvas` …; `More… 27 more` is extra | 3 rows | 4 + More | `panels/slash-commands.js` | warning |
| ai-adv-edges | mode list, "AI is set to suggest only. The canvas won't change." · Allow changes, and the Copy/Retry hover weren't driven. The hover tooltip differs in code | `Retry — ask again for a new answer` | `Retry — re-send the last message` | `client/v2/ai/Feed.jsx:388` | warning |
| ai-history | the impl has an extra `Named` tab | `All · Made by AI · People` | `All · Named · Made by AI · People` | `client/v2/history/use-versions.js:19`. **Board is stale** against 11 / the impl | warning |
| ai-history | `Made by AI` badge, `Undo this chat` · `Restore`, the Compare bar `Side by side · Overlay` and `3 changes · background, badge, button` weren't reached (H attribution) | — | — | — | — |

## Board is stale (CONTRACT wins)

- `ai-history` draws no `Named` tab. The 11 board and the impl (`use-versions.js:19`) have it.
- The DS README's Voice examples ("Ask AI for a first **screen**", "Panels **tucked away**") contradict CONTRACT §6 ("first draft") and §4 ("Panels hidden…"). The board itself follows the contract.

## Root causes

1. **Ask / permission / failure copy is built from the tool call, not the work** (`needs-you.js`). That gives file names, programmer verbs (incl. `Delete`), one fixed failure cause, and `Try again` in place of "Retry <name>". It hits ai-needs-hidden, ai-permission and ai-choice-fail.
2. **Artboard names come only from `.meta.json`** (`use-ai-scope.js` / `scope.js labelOf`). Ids leak into the chip and the menu, and Choose artboards… disappears. It hits ai-scope, ai-open and ai-same-artboard.
3. **The canvas-side result words are missing:** `Made by AI`, `Copied from … before "…"`. Hits ai-hero, ai-done, ai-copy.
4. **`Waiting for you` tags every artboard in scope** (`runs-model.js:305`), not just what will change. It also fires for a plain question. Hits ai-question, ai-needs-hidden, ai-permission.
5. **Suggestion copy is generic** (`suggest-why.js`). There are no artboard names or counts, and follow-ups carry a why line. Hits ai-suggest and ai-done.
6. **Attachment header leaks into chat titles** (`transcript.ts deriveTitle`). Hits ai-chat-list and ai-same-artboard.

```json
{"canvas":"03 AI Chat","critic":"copy-critic","blockers":15,"warnings":28,"verified_ids":["ai-attach-menu-dark","ai-attach-menu-light","ai-quit-dark","ai-quit-light"]}
```
