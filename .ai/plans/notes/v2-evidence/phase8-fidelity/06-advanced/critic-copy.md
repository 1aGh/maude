# copy-critic — 06 Advanced · phase 8 stage B

_2026-10-22 · board `.design/ui/v2/06 Advanced.tsx` · impl = release client, pairs in `.claude/worktrees/agent-a45b4750975bd8337/.scr/pairs/06-advanced/` · voice: CONTRACT §1 menu, §3 words (Advanced = the disclosure; Diagnostics = a submenu), §4 voice (never names itself), §6 C34 · strings reviewed ≈ 340_

**Themes.** Copy is the same in both themes. I read the dark pairs; each row covers **D·L**.
**Fixture.** Not findings: the local project (C2, so Share and Version history show local variants), `/var/folders/…` paths, versions `1.9.1` vs `2.0.0`, raw server log lines, and the `Someone` author on the seeded commit.

## TL;DR

**Blockers: 7** · Warnings: 27 · Verdict: **fix-and-retry**

Most folds carry the board's words: `Advanced · Code, tokens, CSS`, `12 of 12 shown · updated just now · Refresh`, `All Advanced sections are open. · Close all`, the ⌘K path chips, `Kept 7 days on this Mac · Help › Report a bug can attach the last 200 lines.` The voice breaks in a few places. The app names itself ("Maude checks in the background…", "Once this is a Maude project…"). A v1 migration note ships in Diagnostics. Diagnostics is a tabbed sheet in tab order Logs → Sync, though CONTRACT §1 makes it a submenu in the order Sync · Server · AI setup. The broken-canvas card says `Show details` where the board says `Advanced`, and it drops the provenance.

## Per artboard (D·L)

| id | difference | spec (board) | impl | owner | sev |
|---|---|---|---|---|---|
| ad-map · ad-why · ad-trace | documentation boards | — | — | — | n/a |
| ad-inspector | ✓ fold row `Advanced · Code, tokens, CSS`, `Export 2 files`, `Copy as PNG ⇧⌘C`, `Export… — every option ⇧⌘E`, "Preview plays it; Edit shows the link while this is selected." The fold's rows (`Element · Tag · Classes · Selector · Element id · Used in · Tokens bound · CSS`, `Copy style · Paste style · Copy CSS · Copy code`) are below the 840 px crop | as board | — | harness crop | warning |
| ad-left | an extra row not on the board | Folder · Design system | adds `Open canvas .design/ui/Combine-kam…` + Copy | `client/v2/left-panel/canvases-advanced.jsx` | warning |
| ad-left | ✓ `Show file names` · `Show hidden files` · `Folder … Copy` · `Trash Empty · Open` · `12 of 12 shown · updated just now · Refresh`. The row menu (Reveal in Finder · Open in editor · View code · Copy file path · Rename file…) and the Layers fold (`Show tags and ids` · `15 artboards · 214 layers` · `Select by selector`) weren't driven | — | — | — | warning |
| ad-left | **board is stale**: `Show hidden files` carries an `H` key cap | CONTRACT §2: "H toggle hidden files → the Canvases › Advanced switch (no key)" | no key ✓ | board | warning |
| ad-left | **board is stale**: panel search `Search ⌘K` | CONTRACT §2: Search canvases → **/** | `Search canvases… /` ✓ | board / kit `CanvasesPanel` | warning |
| ad-ai | the fold says `Connecting…` and shows an empty `AI may` heading | Model · Effort · Fast mode · Ask before · Show in chat · Images, video and voice · This chat (Context used · 5-hour limit · Session) · Raw log · Copy transcript · Open in terminal | `Connecting…` · Show in chat · Suggestions · `AI may` with no switch beneath it · `Folders AI may read None` · `This chat` (empty) | `client/v2/ai/Advanced.jsx:287` (Connecting… on a fresh chat), `:367` (sub-heading drawn with no rows) | blocker |
| ad-ai | Model / Effort / Fast mode / Images rows need a connected agent with config (H) | — | — | — | — |
| ad-share | ✓ `Share Combine-kampan` · `Move "Alligators brand" to the cloud?` · Cancel · `Move to cloud` (the title asks with the button's verb) · `Only need a file? Menu › Export… ⇧⌘E` · `Other ways in` · `App link` · `This Mac only` · `Invite by GitHub username` · Invite | — | — | `client/v2/share/move-to-cloud.jsx:36` | — |
| ad-share | Advanced hint wording | `Links, link rules, sync` | `Link rules, other ways in, where it syncs` | share sheet Advanced | warning |
| ad-share | app link shows a raw query path with `.tsx` | `maude://alligators/combine-kampan` | `maude://open/project?open=ui/Combine-kampan.tsx` | `client/share-link.js` | warning |
| ad-timeline | **unreachable**: needs a video canvas with a timeline in this lane (fixture) | — | — | — | warning |
| ad-export | ✓ title and button share the verb (`Export "Combine-kampan" — 5 artboards` → `Export 5 artboards ↵`) · scope chips · `RGB — the print shop converts to CMYK…` (§7) · `5 files · about 24 MB · about 20 seconds on this Mac` (computed) · `{canvas} — {artboard}@{scale}` | — | — | `client/v2/export/export-copy.js` | — |
| ad-export | the `From the terminal` command block isn't visible | `maude design export png --scope artboard --option scale=2` + Claude Code lines | not in the frame | export sheet Advanced | warning |
| ad-history | the app names itself in running copy | §4 "never names itself in running copy" | `Not versioned yet. Once this is a Maude project, your changes show up here.` | `client/v2/history/git-model.js:56` | blocker |
| ad-history | button word drifts | `Compare` | `Compare pictures` | `client/v2/history/` Advanced fold | warning |
| ad-history | ✓ `Version history ⌥⌘H` · `Now · Saved` · `Name this version…` · fold hint `Branch, git, changed files`. The git rows (Branch · Drafts · Remote · Changed in this version · Save a version with a note… · Publish 2 versions · Add to main · opens a pull request) need a git project | — | — | fixture | — |
| ad-ds | **unreachable**: no Design system canvas in this lane (the wave-B seeds don't make one) | — | — | — | warning |
| ad-menus | **unreachable**: native menu bar | — | — | — | warning |
| ad-diag | Diagnostics is its own sheet with tabs, not the Menu submenu | §1: "Diagnostics › Sync · Server · AI setup · Logs · Reload canvas ⌘R · Check AI setup again · Advanced ▸ … (a SUBMENU — never its own window)" | a tabbed sheet `Diagnostics · Logs · Server Running · AI setup Needs setup · Sync Local project`, with `Reload canvas` / `Check AI setup again` not visible | `client/v2/diagnostics/diagnostics-sheet.jsx` | blocker |
| ad-diag | a v1 migration note shipped as product copy | none in the menu | `Was the status bar's live dot and version, the IDLE · CANVAS · SYSTEM stamp and the empty canvas's port line.` | `diagnostics-sheet.jsx:231-234`. **The board's ad-logs Server box carries the same line**, so the board is stale too | blocker |
| ad-diag | `Showing` shows a path | `Canvas · Combine-kampan` | `Canvas · .design/ui/Combine-kampan.tsx` | `diagnostics-sheet.jsx` Server rows | warning |
| ad-logs | ✓ `Logs` · `All · Sync · Server · AI · Export` · `Filter` · `Copy all` · `Show in Finder` · foot line. The impl adds `Refresh` | no Refresh | `Refresh` | `diagnostics-sheet.jsx` Logs | warning |
| ad-logs | AI setup rows (`Claude Code installed · Found at · Signed in · Plugins ready`) and the `Combine-kampan reloaded.` toast are on another tab / not driven | — | — | — | warning |
| ad-syncd | ✓ local wording: "This project isn't linked to the cloud, so there is nothing to sync. Everything is on this Mac." The cloud trouble card (Get latest · Keep mine / Use theirs / Keep both · Compare · `Sync stopped — the sign-in to the cloud ran out.` · Sign in again) needs a hub | — | — | `diagnostics-sheet.jsx:382` | warning |
| ad-settings | the app names itself in a hint | §4 | `Maude checks in the background and stages a new build.` | `client/v2/settings/advanced-section.jsx:68` → "Checks in the background and stages a new build." | blocker |
| ad-settings | `the AI` with an article | §3 "AI (a name, no article)" | `Design decisions are kept with the project, so the AI remembers why.` | `advanced-section.jsx:233` | warning |
| ad-settings | `Restart now` is shown (disabled) while Up to date | `2.0.1 is ready · Restart now` | `Up to date · Restart now · Check for updates` | `advanced-section.jsx:79-89` (hide it when not staged) | warning |
| ad-settings | **board is stale (C34)**: `Send anonymous usage data`, `Faster canvas engine (preview)`, and a `Remember design decisions` switch | CONTRACT §6 C34: not built; Decision memory shows a count or "Not set up" with no switch | impl ✓ (`In this project · Not set up`, no such rows) | board `06 Advanced.tsx:1603,1616,1630` | warning |
| ad-pinned | `Connecting…` contradicts `Session · Starts with your first message` in the same fold | — | both shown | `Advanced.jsx:106,287` | warning |
| ad-pinned | ✓ empty hint, `Raw log · Copy transcript · Open in terminal`, "Open in terminal continues this exact chat in Claude Code…". The Inspector / Canvases pinned with `Drag · double-click resets · ← → move 8` wasn't driven | — | — | — | warning |
| ad-search | ✓ `Actions · 43 hidden tools`, path chips `AI chat panel › Advanced`, `Menu › Diagnostics › Advanced`, `Also`, `18 results`, `↑ ↓ move · ↵ open` | — | — | `client/command-palette-match.js` | — |
| ad-search | a long path chip is cut | `Canvases › Advanced` | `Canvases panel › Advanced › row menu › Copy file…` | ⌘K row path (`actions/` `where`) | warning |
| ad-open-all | ✓ `All Advanced sections are open.` · `Close all` | — | — | — | verified |
| ad-code | ✓ `Copy code · Inspector › Advanced`, `Open in editor`, `View code`, `Handoff to production · Menu › File · ⇧⌘H`, `Import from Figma… · Menu › File`. The code panel (`Read only` · Copy · Open in editor · `From the terminal — this canvas` · `In Claude Code`) wasn't opened | — | — | — | warning |
| ad-edge-sync | **unreachable**: cloud project in trouble (hub) | — | — | — | warning |
| ad-edge-syntax | the disclosure is named differently | `Advanced` (§3: the disclosure is Advanced) | `Show details` | `client/v2/code/canvas-error-card.jsx:217` | blocker |
| ad-edge-syntax | provenance dropped | "Its code was changed outside the app 2 min ago and stops halfway on line 212. Other canvases are fine; the last good version is in Version history." | "Its code stops halfway on line 9. Other canvases are fine; …" | `canvas-error-card.jsx:63` (no "changed outside the app <when>" clause) | blocker |
| ad-edge-syntax | ✓ `<name> can't be drawn right now.` · `Ask AI to fix it` · `Open in editor · Copy error · Last good version` · Where `… · line 9, column 30 · Copy`. The impl adds a fourth action, `Reload canvas` | 3 actions | 4 | `canvas-error-card.jsx` | warning |
| ad-edge-hub | **unreachable**: hub-linked project | — | — | — | warning |
| ad-edge-where | **unreachable**: browser viewer / role / offline contexts | — | — | — | warning |
| ad-edge-remember | **unreachable**: a per-Mac preference story over days | — | — | — | — |

## Board is stale (CONTRACT wins)

- `ad-settings` still draws C34's dropped rows: usage data, a faster engine, a decision-memory switch.
- `ad-left` draws an `H` key on Show hidden files and `Search ⌘K` in the canvases search. §2 removes the H key and gives canvas search **/**.
- The `ad-logs` Server box draws the v1 "Was the status bar's…" line. The impl copied it from there. It is history, not product copy, so drop it from both.

## Root causes

1. **The app names itself in running copy** (§4): `advanced-section.jsx:68` and `git-model.js:56`. Hits ad-settings and ad-history.
2. **Diagnostics became a tabbed sheet**, against §1's submenu and its order. It carries migration notes. Hits ad-diag, ad-logs and ad-syncd.
3. **The AI fold renders headings and states without content.** `Connecting…` shows with no session, and the `AI may` heading has no rows under it. Hits ad-ai and ad-pinned.
4. **Disclosure and label words drift from the board:** `Show details`, `Compare pictures`, the Share fold hint, `Open canvas`. Hits ad-edge-syntax, ad-history, ad-share and ad-left.
5. **The board lags CONTRACT §2/§6:** C34 rows, the H key, the ⌘K canvas search. Hits ad-settings and ad-left.

```json
{"canvas":"06 Advanced","critic":"copy-critic","blockers":7,"warnings":27,"verified_ids":["ad-open-all-dark","ad-open-all-light"]}
```
