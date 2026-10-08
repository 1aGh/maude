# Implementation inventory — 03 AI Chat · 04 Modes · 05 Empty States

Source: `.design/ui/v2/03 AI Chat.tsx` (+meta), `04 Modes.tsx` (+meta), `05 Empty States.tsx` (+meta), `_kit.tsx`, `CONTRACT.md`, `.ai/plans/notes/v2-feature-inventory.md` (= "INV §n"), `v2-open-questions.md` (= "OQ").
Legend: **EXISTS** (restyle/relocate; INV ref) · **NEW** · **PROPOSED** (canvas or OQ marks it proposed / Michal to confirm).

---

## 03 AI Chat (`03 AI Chat.tsx`, 29 artboards, 7 sections)

Brief: simple-by-default AI chat that feels autonomous; every ACP capability still reachable under the panel's **Advanced** or **⌘K**. Today's base = INV §12 `ChatPanel` (Assistant, ⇧⌘A, N-only).

### 1. Surfaces / components

- **AI chat panel (canonical header)** — floating island bottom-right, **340 wide** (kit `AIPanel chat=`). EXISTS (`ChatPanel`) → restyle + relocate.
  - Header: spark · **chat title ⌄** (opens chat list) · compact **"✦ N"** count chip = YOUR running chats only (title attr "N chats running") · **+ New chat** · **Hide** chevron ("Hide the AI chat panel").
  - Count dropdown (kit `AIRunList`) [ai-two-artboards][ai-tereza]: group "Yours" (only shown when "On this canvas" exists) → rows `icon · title · where · state word` (Working / Waiting / Needs you / Done); group **"On this canvas"** = other people's AI on this canvas, row shows their avatar and the word **"View only"**, never counted in ✦ N; footer row **"All chats 41"** (hidden when `all:false`). Click a row → jump to that artboard/chat. NEW (today: chat switcher w/ status dot per chat).
  - Messages feed: You bubble, AI reply (`--type-base` 14px, never 12), dividers (`ai-mark`) e.g. "Yesterday, 18:20", "Ran on a copy — Post 1:1 was busy", "Stopped when the app quit · 6 Oct, 18:12", "Continued from the terminal · 6 Oct, 18:20".
  - **Working line** (`Working`): breathing spark · same words as artboard tag ("AI is making it greener") · step detail ("Background done · badge next") · **Stop** button.
  - **Result card** (`Result`): AI's one-line description + action chips, Undo first: default **Undo · Keep going**; variants **Undo · Compare** [ai-long], **Undo · Keep the copy** [ai-copy]. Optional inline before → after thumbs [ai-long]; folded **"What AI did · 6 steps · 41 s"** steps disclosure (raw log lives under Advanced).
  - Follow-up suggestion chips under an answer ("Same on Story 9:16", "A darker green") — no "why" line.
  - **Prompt / Composer**: one row = 📎 paperclip · scope chip `◆ <scope>` · text · azure send button with white spark. Attachments sit inside the field above the row; multi-line wraps above the row, grows to **6 lines** then scrolls [ai-long]. Placeholder "Ask AI…".
  - Footer: quiet **Advanced** disclosure row.
- **Folded AI panel** = spark icon bottom-right (kit `PanelIcon at="ai"`); `dot` = AI busy [ai-panel-closed]; **FoldNeeds** = azure ring + count badge, wins over busy dot [ai-needs-hidden]. Tooltip "Ask AI ⌘/" [ai-scope].
- **Scope chip menu** [ai-scope]: `Whole canvas ✓ · <selected artboard> · Choose artboards… · — · No canvas — just ask`. Chip values: artboard short name (long names truncated, never wrapped), "Whole canvas" (nothing selected), "N artboards" (hover lists names), "4 clips", canvas name, section name (04 md-draw). NEW menu (today "◆ selection" chip / "Editing: <canvas>").
- **Suggestions block** (`Suggest`) above field [ai-open][ai-suggest]: max 3 chips, one line each; lead chip carries a context glyph (comment pin dot / video / view / history); one quiet **why** line ("Because Tereza left 3 comments on Post 1:1"). NEW (today: static quick-actions row + contextual "Implement N comments").
- **Empty-chat hint**: "Ask for a change, a few variants, or an answer. AI works on what the chip says."
- **Paperclip menu** (`AttachMenu`, 232 w) [ai-attach-menu]: Attach files… · Choose a folder… · From Assets · Paste a screenshot ⌘V · — · "Or drag files here" (disabled hint row).
- **Attachment chips** (`AChip`): Photo = thumbnail only, name on hover; Footage = thumb + play + "Footage · 0:42"; File = icon + name + "PDF · 12 pages"; Folder = icon + name + "48 files"; Screenshot = like photo. Every chip has ×. Sent versions (`Sent`) read-only, no ×, shown above the You bubble (`YouWith`).
- **Drop overlay** over whole panel [ai-attach]: video glyph · **"Drop to attach"** · "AI can use it in this chat"; drag ghost card ("trenink-0412.mov · Footage · 0:42", "+1" count).
- **Folder consent card** (`Consent`): "Let AI read “Combine 2026 fotky” (48 files)?" / "Asked once for this folder. AI only reads it — nothing on disk changes." / **Not now** · **Let AI read**. Folder chip shows a waiting state until answered.
- **Big chat** (`BigChat`) [ai-long]: full window height, **420 wide**, left edge resize (tooltip "Drag to resize · double-click for full height"), header adds **Pin to the side** button; **"Jump to latest"** pill with "2 new".
- **Pinned column** [ai-long-pinned]: docked full-height right column, canvas shrinks to make room, drag handle between; pin button pressed, tooltip "Unpin — float over the canvas". Same as Menu › View › Advanced › Pin panels to the side, for this panel only.
- **On-canvas AI presence** (one visual idea, "the ring"):
  - Working: dashed spark outline + spark-led tag under the artboard (`aiAt="below"` everywhere in this canvas) + AI cursor parked on the fill it changes. Tag words = panel working words; queue suffix "· 1 waiting" [ai-same-artboard].
  - Done: outline closes to **solid spark ring once** (spring), a **before → after wipe** (~1 s) passes with "Before"/"After" labels, then settles to quiet **"Made by AI"** mark in the artboard label row [ai-done][ai-hero].
  - Needs you: **dashed azure ring** around affected artboards with tag "Waiting for you · Replace 4 photos?"; affected artboards labelled "will change" [ai-permission].
  - Point: small spark ring with tag ("9 pt") on the exact spot AI talks about; disappears on click [ai-question].
  - Other person's AI: same dashed outline + tag led by spark + their avatar: "Tereza's AI · shorter headline"; their cursor fill = presence-agent, stroke = their tone [ai-tereza][ai-hero].
- **Waiting card** (`Waiting`) [ai-same-artboard]: clock · "Waiting for “Make it greener” to finish on Post 1:1." · meta "Starts by itself, on top of its result — about a minute." · **Run on a copy** · quiet × ("Cancel this ask").
- **Copy artboard** [ai-copy]: "Post 1:1 · copy" placed right beside original, connector line, caption "Copied from Post 1:1 before “Make it greener”".
- **Permission card** (`Permission`, inline, never modal) [ai-permission]: help icon + title "Replace 4 team photos in Uniformy-2027?"; detail = 4 thumbs + "Obrana, útok, speciální týmy, trenéři"; checkbox **"Always for this canvas"**; **Not now** · **Replace 4 photos** (title verb = button verb).
- **Choice card** (`Choice`) [ai-choice-fail]: "Which green?" options with swatch + hint ("Club green — from the Alligators design system", "Lighter green — reads better on print", "Darker green — for night photos", "Something else…" = type your own); picked state.
- **Problem card** (`Problem`): "Couldn't finish — the footage file is missing. Nothing changed." / "trenink-0412.mov was moved or renamed. Put it back in Assets to try again, or pick another clip." / one primary verb **Pick another clip**.
- **Chat list** (`ChatList`, replaces panel body; back chevron) [ai-chat-list]: header "Chats" + project chip "Alligators brand" + "+"; search field "Search chats" (full-text, matched words highlighted, match snippet "… match the dres venku stripes …"); group **"Running N"** first, then **"Earlier"** grouped by canvas (thumb + canvas name + "9 chats" + "7 more"); row = state icon · title · where · (avatar if someone else's) · time / **"Needs you"** / "Stopped · Monday"; hover row → ⋯ menu: **Open · Rename… · Copy transcript · — · Archive · Move to trash**; foot "41 chats · kept with the project" / "3 results".
- **Tab marks** [ai-other-tab][ai-needs-tab]: project tab carries a breathing spark while AI runs there (still under reduced motion); becomes an **azure question mark** when a chat there needs you; tab tooltip "Alligators brand · AI is translating A4 · plakát" / "Alligators brand · AI needs you on Uniformy-2027".
- **Toasts** (one action each): "Alligators brand — Post 1:1 is greener. 1 chat still running there." **Show** · "Done — Post 1:1 is greener. The logo stays white." **Show** · "AI needs you on Uniformy-2027 — replace 4 team photos?" **Open** · "AI needs you on Uniformy-2027 in Alligators brand" **Open**.
- **Quit dialog** [ai-quit]: "Quit while AI is working?" / "2 chats stop where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time." / Cancel · **Quit**. Same ask when closing a project tab.
- **macOS notification + Dock badge** [ai-needs-away]: "Maude · now / **AI needs you on Uniformy-2027** / Alligators brand · Uniformy-2027 — “Replace 4 team photos?”"; Dock count "1". Off switch in Settings › General.
- **Not-ready states** [ai-not-ready]: ConnectSheet (kit) · queued line · setting-up card with progress bar · used-up card + **See usage** · allowance meter above field.
- **Advanced (opened)** [ai-advanced] — all rows in §5 table below. Plus **Raw log** island (title "Raw log" + chat chip; mono lines `Read …`, `Edit … +14 −6`, `Bash maude design screenshot --screen post-1x1`, `Done 41 s · 3 tool calls · claude-opus`).
- **Slash menu** in the simple field [ai-adv-edges]/[ai-advanced]: typing `/` opens "Slash commands" menu, e.g. `/design:critic — Review this canvas`, `/design:edit — Change the selection`, `/design:screenshot — Capture an artboard`, `/design:export — Export this canvas`, `/flow:plan — Your own commands too`.
- **Suggest-only banner** above field: "**AI is set to suggest only.** The canvas won't change." + **Allow changes**.
- **Message hover actions**: Copy · Retry (tooltip "Retry — ask again for a new answer").
- **Version history panel (AI-aware)** [ai-history]: header "Version history" + close; segment **All · Made by AI · People**; rows: "Now · Combine-kampan · Saved"; AI rows with spark dot + chip "Made by AI" ("Make it greener · Post 1:1 · 14:32"; "Bigger date · Story 9:16 · 14:05 · Tereza's AI"); people rows with avatar; selected row actions **Undo this chat** · **Restore** (primary). Compare on canvas: "Before · 14:31" / "After · 14:32 · Made by AI" artboards + bar with segment **Side by side · Overlay** and "3 changes · background, badge, button".

### 2. User flows

- **Simple ask** [ai-open→ai-done]: 1) select artboard 2) ⌘/ (or click spark) → panel opens, focus in field, chip = selection, ≤3 contextual suggestions + why 3) type / click chip → send 4) artboard gets dashed outline + tag; panel shows Working + Stop; user keeps working elsewhere; save status may read "Syncing…" 5) done → ring + wipe → "Made by AI"; panel Result "Done — …" + Undo · Keep going + follow-up chips 6) Undo reverts the whole run (one undo step).
- **Question, no change** [ai-question]: ask → text answer ending "The canvas didn't change." → point ring on spot → fix offered as chip ("Make the date line 14 pt").
- **Attach** [ai-attach][ai-attach-menu]: drag files onto panel (overlay) / paste ⌘V screenshot / paperclip → Attach files… (macOS picker) / Choose a folder… (picker → consent once per folder) / From Assets (opens left panel Assets tab to pick) → chips in field → send; attachments also land in Assets for later chats. Folder "Not now" keeps the chip and sends without it.
- **Long chat** [ai-long]: panel grows full height → drag edge wider / double-click full height → scroll up (earlier turns' steps folded) → "Jump to latest · 2 new" → optional Pin to the side → docked column [ai-long-pinned].
- **Two artboards** [ai-two-artboards]: ask on Post 1:1, then new chat on A4 → both run, each with outline+tag; ✦ 2 lists both; click row jumps.
- **Same artboard** [ai-same-artboard]: second ask on busy artboard → Waiting card, tag "· 1 waiting" → auto-starts on top of first result; or **Run on a copy** [ai-copy] → duplicate (from state BEFORE busy chat) placed beside → AI works on copy → Result Undo (removes copy) / Keep the copy (replaces original; original kept in Version history); × cancels the queued ask.
- **Whole-canvas ask** [ai-queue-rule]: starts on all free artboards now ("13 free artboards now"), takes each busy one as it frees.
- **Other project tab** [ai-other-tab]: switch tabs → AI continues; tab spark breathes; on finish → toast with Show → switches tabs + opens result.
- **Tereza's AI** [ai-tereza]: her run visible on canvas + under "On this canvas" (View only); her chat stays hers (cannot open/steer).
- **Panel hidden** [ai-panel-closed]: ⌘\ or chevron → spark with dot; outlines stay; per-chat done toasts; only Stop stops.
- **Quit mid-run** [ai-quit]: ⌘Q → dialog → Quit → runs stop; finished work saved as versions → next launch chat shows "Stopped when the app quit · <date>" + Result "Post 1:1 is half done — …" + Undo · Keep going (Keep going resumes).
- **Needs you, out of sight** [ai-needs-hidden][ai-needs-tab][ai-needs-away]: chat hits a question → folded spark azure + count / tab ? mark / canvases-panel row "Needs you" / chat-list row "Needs you" / toast Open / (app in background) Mac notification + Dock badge → any of them → lands on [ai-permission]: canvas opened, question open in panel, azure ring on what will change. Count persists until answered; never times out; other chats keep running.
- **Permission** [ai-permission]: Replace 4 photos → runs; Not now → no change; "Always for this canvas" checkbox → remembered (reset in Advanced).
- **Choice** → pick option or "Something else…" to type; **Failure** → Problem card → one verb.
- **Not connected** [ai-not-ready] (CONTRACT §7): Ask AI looks normal → first send → panel dims + ConnectSheet → Connect (browser sign-in, Claude Code set up) → waiting prompt runs; Advanced › "Use an API key instead"; Cancel keeps prompt.
- **Offline**: send → "Queued — sends when this Mac is online." + "AI is back when this Mac is online." → auto-send on reconnect.
- **Setting up**: "Setting up AI on this Mac. About a minute — keep drawing meanwhile." + progress bar; prompt kept in field.
- **Used up**: "AI’s allowance is used up until 18:40. Your prompt is kept and sends then." + See usage; auto-send at reset.
- **Almost used up**: meter above field "90% of this 5-hour allowance used · resets 18:40" while working.
- **Terminal hand-off** [ai-adv-edges]: Advanced › Open in terminal → continues the exact chat (same session/history) in Claude Code; `/design:chat` in a terminal brings it back → divider "Continued from the terminal · …".
- **History** [ai-history]: ⌥⌘H → Made by AI filter → select AI version → compare Side by side / Overlay → Restore or Undo this chat (takes back one chat out of order).

### 3. States & edge cases (key copy verbatim)

- Panel: empty-chat hint · suggestions · working · waiting (queued behind other run) · needs-you (permission/choice) · done · failed · stopped-by-quit · not connected (dim + sheet) · offline queued · setting up · used up · near limit · suggest-only mode banner · drop-hover · folder-consent pending · long/scrolled-up · pinned.
- Run states word set: **Working / Waiting / Needs you / Done**, list extras **"Stopped · <when>"**, **"View only"** for others' runs.
- Done copy pattern: "Done — <artboard> is greener: background, badge and button. The logo stays white." (result, not self; no "I").
- Copy-run copy: "Done — Post 1:1 · copy says COMBINE. It started from Post 1:1 before “Make it greener”, so each shows one idea."
- Long-chat sample answers: "Six shots picked — they're in Assets › Combine recap, sharpest first. Two more were close; they're marked." · "Two things differ from the brief: … The canvas didn't change."
- Suggest-only answer ends "Nothing changed."
- When AI asks first: ONLY when a change would **replace something you made or move it to the trash** (photos, footage, your text). Restyling (colour/type/layout, any number of artboards) never asks — Undo takes it back.
- Status in Share cluster while AI works may show "Syncing…".
- Many chats: 41 chats, grouped by canvas with "N more".
- Reduced motion: tab spark still visible (no breathing); ring/wipe should degrade (ring "settles once" — implement 1 ms per DS).
- A11y [ai-needs-away]: one **polite live region per panel** announces Working, Waiting, Done, Needs you once each; **⌘/ moves focus into the field; esc gives it back**.

### 4. Keys & menu paths

- **⌘/** Ask AI — opens panel, focuses field, attaches current selection (CONTRACT §2). NEW key (today ⇧⌘A toggles Assistant).
- **⌘\** hides all panels incl. AI (AI keeps running). **⌘V** in field pastes screenshot as chip. **/** in field → slash menu. **esc** returns focus from field. **⌥⌘H** Version history. **⌘Z / ⇧⌘Z** include AI changes (one run = one step). **⌘K** finds every Advanced item by name ("model", "raw log", "terminal") with chip "AI chat panel › Advanced".
- Menu › Diagnostics › AI setup (details for not-ready); Menu › Diagnostics › Check AI setup again (CONTRACT §1). Menu › View › Advanced › Pin panels to the side. Settings › General (needs-you notifications off). Settings › Connections (image keys).

### 5. Classification

| Feature | Class | Today → v2 |
| --- | --- | --- |
| AI chat panel shell, feed, Send/Stop | EXISTS | INV §12 `ChatPanel` → floating 340 w island bottom-right; ⌘/ |
| Chat switcher / New chat / per-chat ⋯ (Rename, Archive, Copy transcript, Delete) | EXISTS | header title ⌄ → chat list; Delete → **Move to trash**; add Open |
| ✦ N running count + Yours / On this canvas / All chats | NEW | — |
| Chat list grouped by canvas, Running first, full-text search | NEW | (OQ: per-canvas chat grouping) |
| Scope chip + scope menu (No canvas — just ask, Choose artboards…) | EXISTS partly | "◆ selection" chip → scope menu |
| Contextual suggestions w/ why (comments/clips/shared/last ask) | NEW (partly EXISTS "Implement N comments") | quick-actions row removed; `/design:*` buttons → slash menu |
| Paperclip menu, drag-and-drop onto panel, folder consent, From Assets, attachments → Assets | NEW (pasted path/URL chips EXIST) | OQ "drag-and-drop attachments" |
| On-canvas dashed outline + tag per artboard, AI cursor | NEW (INV §3 AI activity banner `S/ai-banner.tsx` exists) | banner → per-artboard ring |
| Done ring + before→after wipe + "Made by AI" mark | NEW | — |
| Point ring (AI references a spot) | NEW | — |
| Result card Undo / Keep going / Compare / Keep the copy | NEW (Message Copy/Retry EXIST) | — |
| One AI per artboard queue, Waiting card, auto-start on result | NEW · PROPOSED (OQ 4) | — |
| Run on a copy | NEW · PROPOSED | — |
| Whole-canvas ask taking free artboards first | NEW · PROPOSED | — |
| Big chat (full height, resize, Jump to latest), Pin to the side | NEW | — |
| Tool-call cards | EXISTS (`P/ToolGroup.jsx`) | → folded "What AI did · N steps · T"; raw under Advanced › Raw log |
| Other tab spark / ? marks, cross-tab toasts | NEW (depends on native project tabs, OQ 1) | — |
| Other people's AI visible on canvas + "On this canvas" | NEW | — |
| Panel hidden keeps running | EXISTS (panel stays mounted) | + busy dot, done toasts |
| Quit / close-tab dialog + resume "Keep going" | NEW · PROPOSED (OQ 5) | — |
| Needs-you ladder (fold, tab, row, ring, toast) | NEW | — |
| OS notifications "needs input"/"finished" | EXISTS (INV §12, 30 s cooldown) | copy → "AI needs you on <canvas>"; **Dock badge NEW**; toggle in Settings › General |
| `PermissionPrompt` | EXISTS | → inline Permission card + azure ring; "+N more waiting" → count |
| `ElicitationPrompt` | EXISTS | → Choice card (swatches, hints, "Something else…") |
| Connection `ErrorCard` / rate-limit banner | EXISTS | → Problem card; used-up card; allowance meter |
| `ReadinessList` / not connected | EXISTS | → ConnectSheet (CONTRACT §7); details → Menu › Diagnostics › AI setup |
| Offline prompt queue | NEW · PROPOSED (OQ) | — |
| Prompt kept & auto-sent after setup / allowance reset | NEW | — |
| CapabilityBar (Permission mode, Model, Effort, Fast) | EXISTS (`P/CapabilityBar.jsx`) | → Advanced rows |
| View select (normal/thinking/verbose/summary) | EXISTS | → Advanced › "Show in chat" |
| Chat info popover (context %, tokens, rate window) | EXISTS | → Advanced › This chat (Context used, 5-hour limit, Session id) |
| `ModeBanner` | EXISTS | → suggest-only banner "Allow changes" |
| Slash popover (16 static + live) | EXISTS (`P/slash-commands.js`) | stays in simple field |
| Suggestions On/Off; AI may: Change canvases / Use Assets and footage / Search the web; Folders AI may read; Always allowed on this canvas · Reset | NEW | Advanced |
| Write outside this project "Asks every time" | EXISTS (out-of-project path list in PermissionPrompt) | Advanced row |
| From the agent: Agent persona + agent-added options auto-listed | NEW (ACP session config options) | Advanced |
| Images, video and voice: Provider (Gemini), Shape (As the artboard), Place on the canvas | EXISTS partly (BYOK keys in Settings, INV §11) | Advanced; keys stay in Settings › Connections |
| Raw log, Copy transcript, Open in terminal | Copy transcript EXISTS; Raw log NEW view; **Open in terminal NEW** (OQ) | Advanced buttons |
| `/design:chat` terminal→app | EXISTS (design:chat skill) | divider copy |
| Version history with Made by AI filter, Undo this chat, compare Side by side/Overlay | History EXISTS (INV §7 GitPanel Restore/Undo) | → Version history panel; AI filter + compare NEW |
| ⌘Z includes AI, Tereza's never in your ⌘Z | NEW (per-user undo stack) | — |
| Live-region a11y, ⌘/ focus | NEW | — |

### 6. Backend / native needs

- **Artboard attribution of AI runs**: map ACP tool calls (file edits to canvas `.tsx`) to artboard ids → drive outline/tag/ring, "where" strings, Made-by-AI provenance (persist per artboard + in versions). Needs canvas-lib/dev-server instrumentation and a server-side run registry (run id, chat id, artboards, state, owner).
- **Human progress text** (working words + step line) from agent stream — agent prompt contract (plugin/system prompt) to emit "AI is …" + step + result line in CONTRACT voice (no "I", describe result).
- **Multi-session runtime**: N concurrent ACP sessions per project, across project tabs; survive panel hide; per-run Stop.
- **Per-artboard lock/queue scheduler** (one AI per artboard; queued asks auto-start on result; whole-canvas asks fan out to free artboards) — applies across users ⇒ needs hub/cloud-side coordination for shared projects (Tereza's AI). Cancel queued ask.
- **Run on a copy**: duplicate artboard from the version **before** the busy run, place beside, run there; Keep the copy = replace + version; Undo = remove copy.
- **Per-run versioning**: every AI run = one version, one undo step; "Undo this chat" out of order (inverse patch / revert of one run's commits); per-user ⌘Z stacks (exclude collaborators' changes). Touches git/history service + sync.
- **Remote AI presence**: broadcast other users' runs (title, artboard, state, avatar) via hub; View only.
- **Chat persistence "kept with the project"**: chats stored per project, grouped by canvas, 41+ entries, full-text search over titles + every message, archive, move to trash (Trash integration), rename. Decide sync of chats to collaborators (list shows Tereza's chat "Three Story variants" with her avatar ⇒ chats are visible to project members?).
- **Attachments**: file/folder picker (Tauri dialog), drag-drop on webview, clipboard image paste, ingest into project Assets, folder read grant persisted per folder (read-only; listed in Advanced), video duration / PDF page count probing.
- **Permission policy**: classify operations as "replace your work / move to trash" vs restyle → maps to ACP permission modes; "Always for this canvas" grant store + Reset. Ask-before list ↔ ACP modes: default / auto / acceptEdits / plan / dontAsk / bypassPermissions; only show modes the agent offers; bypass only where agent allows.
- **Offline queue**: persist queued prompts per chat, auto-send on reconnect; same for "setting up" and "used up until HH:MM" (needs allowance reset time from ACP/rate-limit info).
- **Quit / close-tab interception** (Tauri `CloseRequested` / app quit) when runs active; persist "stopped" marker + resumable session for Keep going.
- **Native**: Dock badge count, macOS notifications (exists) with deep link to canvas + open question; per-tab marks (native window tabs — OQ 1 A/B decides feasibility; native tabs can't show custom glyphs easily ⇒ risk).
- **Terminal hand-off**: Open in terminal → launch Terminal with `claude --resume <session>` (same session id); reverse via `/design:chat`.
- **ConnectSheet**: browser OAuth for Claude Pro/Max + auto-install Claude Code; API-key alternative.
- **Suggestion engine**: derive context (open comments on selection, selected clips, recently shared canvas, last ask) → ≤3 chips + why; off switch.
- **⌘K index** of Advanced controls.

### 7. Dependencies

- Kit: `AIPanel` (chat/count/runs/advanced/attach/banner/above/drop/free/dim), `AIRunList`, `AIRunIcon`, `ConnectSheet`, `PanelIcon`, `Toast`, `Dialog`, `Menu`, `Artboard` (aiWorking/aiAt/aiCursor/aiMade), `Cursor agent`, `ShareCluster`, `CanvasesPanel` (row meta "Needs you"), `Window` tabs. Kit candidates listed in canvas header: Working, Result, Waiting, Permission, Choice, Problem, ChatList, TheirAi, Wipe, Ring, FoldNeeds, tab marks, Clip glyph (`GLYPHS.attach`), Composer, AChip, AttachMenu, Consent, Suggest, BigChat.
- Other canvases: 10 Collaboration (co-mention-notify — same notification + Dock pair), 01/08/11 (Combine-kampan canvas), 12 Assets (From Assets, Assets › folders), 07 Video (captions/cut), Version history canvas, 04 md-edge-ai (AI deferral in Preview), 05 AI empty states, 02 Onboarding (Connect).

---

## 04 Modes (`04 Modes.tsx`, 26 artboards, 8 sections)

Decision: one **mode switch Edit · Preview · Present** (Viewing for read-only) in the **Share cluster**, top right; modes have their own glyphs; two toolbars, one per mode; Comment / Annotations / Inspect are tools, not modes.

### 1. Surfaces / components

- **Mode switch** (kit `ModeSwitch`, inside `ShareCluster`) [md-model][md-keys]: 3 segments `[Edit|Viewing] · Preview · Present⌄`. Glyphs (24 grid, 2.25 stroke, mode-only): Edit = pencil-ruler, Preview = eye in a frame, Present = easel, Viewing = reading glasses. Present segment has a chevron opening the Present menu. Title attr "Mode"; tooltips = word. Click pointer ring shown on press frame.
  - Cluster contents: faces · save status (or access word "Can view"/"Can comment") · switch · Hide panels (⌘\) · Share (or **Ask to edit** for read-only).
  - In Preview cluster is **compact**: faces + status hidden, switch/Hide panels/Share stay exactly in place.
- **Edit toolbar** (kit `Toolbar mode="edit"`): Select V · Hand H · Frame F · Shape R · Pen P · Text T · Image I · Component ⇧I · More (Line · Ellipse · Polygon · Crop · Export area — no letters, ⌘K finds them). Tool descriptions in [md-model] `EDIT_DO`.
- **Preview toolbar** (kit `Toolbar mode="annotate"`, buttons 48 px, "a size bigger"): Hand H · Sticky N · Comment C · Marker M · Arrow A · Shape R · Text T · Stickers E · Section S. Sticky colours row (5 up front of ten: yellow coral green sky lilac) and Marker ink row with **Marker · Highlighter** tips open above the tool. Hand rests: click uses the design, drag pans.
- **ToolbarMorph** [md-annotate]: Edit set sinks/fades (40 ms), island widens, new set rises (140 ms), done at 220 ms.
- **PreviewBar** (top centre island) [md-preview]: Preview glyph (or **‹ <previous canvas>** back button after following a link) · "Previewing **Homepage**" · "esc to edit" (Viewing variant: "esc for Viewing").
- **ZoomOnly** island (zoom % only; no undo/redo) in Preview/Viewing.
- **Folded project pill** (mark only) in Preview.
- **Inspector — Edit** [md-edit]: rows Size, Fill, Border, **On click** (select "Go to Pricing"), **On hover** ("Fill with Ink"), Advanced CSS (border, border-radius, href).
- **Link chip on canvas** while a linked element is selected: link glyph + "Go to Pricing" with connector stub.
- **Measure overlay** (hold ⌥, point at neighbour): line + number label (e.g. 112, 48, 20, 64) — Edit and Inspect.
- **Image tool** [md-edit-image]: left panel switches to **Assets** tab ("Search assets", "Photos 6", grid with names, row "From this Mac…"); drag photo onto frame → drop target highlight + tag "Hero image · fills, cropped to fit".
- **Component picker** [md-edit-component] (popover above toolbar, 272 w): "Search components" · group "Studio site system" · Button "3 variants" expanded with variant tiles Primary / Secondary / Ghost · Card "2 variants" · Nav bar · Price card "3 variants" · Footer · Badge "4 variants" · — · "Open Design system". Placement ghost + insertion gap + tag "Button · Secondary".
- **Present menu** [md-present-menu] (352 w, from switch chevron): group "Artboards, one by one": **Present from “Post 1:1 · Combine 2026”** ⌥⌘↵ · **Present from the start** ⇧⌥⌘↵; group "The canvas, pan freely": **Present the canvas** (note "no chrome, no pins"); — · **Presenter view on another display** ✓ (note "LG UltraFine") · **Order and notes…**; — · **Copy presentation link** (note "follows you live").
- **Present controls** (Artboards) [md-present-full]: ‹ · "3 / 14" · › · (video: pause · "0:06 / 0:15" · sound) · artboard label · presenter-view button · "esc to leave". Appear on mouse move, fade after 2 s (reduce motion: just hide).
- **Pointer (L)**: ringed dot in your presence colour with a short trail.
- **Canvas pill** (Present the canvas) [md-present-canvas]: easel glyph · "Presenting the canvas" · zoom "21%" · "esc to leave"; fades.
- **Presenter view** [md-presenter] (Mac screen): top "Combine-kampan" + chip "Presenter view"; clock "12:48 elapsed" + wall time "14:05"; "Audience on LG UltraFine"; **End** esc. "Now · 5 of 14 · <label>" big box (with pointer); **Previous** / **Next** (primary); hint "← → space or a clicker · L pointer · only you see this screen"; "Next · <label>" box; "Notes" (per-artboard text); "Order · 15 artboards · 1 skipped" = **order map drawn as the canvas layout**, numbered, current highlighted, skipped shown with eye-off and dimmed; legend "The order follows the canvas: row by row, left to right. Click any artboard to jump there." / "Skipped — it stays on the canvas, out of the run." / "Order and notes… changes it."
- **Presentation link viewer** (browser, `alligators.cloud.maude.sh/present/combine-kampan`) [md-present-link]: slide; follow bar: "Live" indicator (off when drifted) · Tereza avatar · "Tereza is on **6 of 14** · you're on 5" · **Catch up**; watchers "6 watching" faces (+4).
- **Comment thread popover** [md-comment]: header "Pricing · Desktop" + **Resolve**; messages (avatar, name, relative time, text); composer with **@ mention** popover row "Jonas · Can edit"; send.
- **Comments panel** (⇧⌘M) takes the Canvases panel's slot: title "Comments" + close; segment **Open 3 · Mine 1 · Resolved 2**; rows avatar · "Pricing · Desktop" · text · "2 h ago · 1 reply".
- **New comment composer** (comment-only) [md-comment-only]: text field · "@ to mention" · Cancel · **Post**.
- **Annotation layer** [md-draw]: section frame titled "Feedback od trenérů", stickies, marker loops, highlight, arrows; Tereza's presence cursor.
- **Inspect panel** [md-inspect] (right, 300 w): "Book a call" + chip "Button"; groups **Size and spacing** (Size 150 × 48 · Padding 12 · 24 · Corners Round · Gap to About 48), **Colour and type** (Fill Ink · Text "SF Pro Text · 19 · Semibold" · Text colour Page), **Export** (PNG 1× · PNG 2× · SVG · Handoff…); **Copy code** (primary) · **Edit ↵**; Advanced "CSS" (padding, border-radius, background, font, color). Selection = outline without handles + size tag.
- **Viewer project menu** (browser, Can view) [md-edge-viewer]: Search ⌘K · View › · Help › · — · Version history ⌥⌘H ("to look") · Export… ⇧⌘E · — · Sign in…. Only allowed rows listed (not greyed).
- **AI-deferred tag** [md-edge-ai]: "AI has a new hero — it lands when you move off" on the hovered artboard; folded spark with busy dot.
- **Offline presenter notice** [md-edge-offline]: StatusWord warn "Offline — kept on this Mac" (replaces "Audience on …"); on Now box: "Clip isn't on this Mac — the audience sees its first frame" + **Skip**.

### 2. User flows

- **Edit → Preview** [md-motion]: 1) click Preview (or ⌥⌘P proposed; or press N/C/M/A/E/S) 2) 220 ms `--dur-panel` `--ease-out`: Canvases + AI panels fold toward their corner icons, pill folds to mark, toolbar morphs, faces/status fade, camera eases onto the artboard you were on (same canvas place), PreviewBar fades in 3) Preview live. Back to Edit = same frames reversed. Reduce motion: 1 ms cut.
- **Set up a link** [md-edit]: select "See pricing" → Inspector On click = Go to Pricing (target can be another canvas's artboard) → link chip shows on canvas while selected.
- **Image** [md-edit-image]: I → Assets tab opens → drag photo onto frame (fills, cropped to fit) · or select frame + ↵ (or tile ↵ per CONTRACT §7) · or drop on empty canvas → becomes own frame · "From this Mac…" for files.
- **Component** [md-edit-component]: ⇧I → picker → Button → Secondary → click into CTA row → joins auto-layout row, stays linked to Design system.
- **Follow link in Preview** [md-preview-follow]: click "See pricing" → Pricing canvas opens in Preview on linked Desktop artboard → PreviewBar "‹ Homepage" → back.
- **Present** [md-present-menu→md-present-lift→md-present-full]: select artboard → click Present (or ⌥⌘↵) → artboard lifts out of its slot to full screen (280 ms `--dur-route`) while chrome/other artboards sink to dark → controls → → ← space / clicker step in canvas order (row by row, L→R, skipping skipped) → videos autoplay with sound, click pauses, → / space skip mid-clip → esc reverses lift; selection, zoom, panels restored exactly.
- **Present from the start** ⇧⌥⌘↵; **Present the canvas** (no lift; camera stays; pan/zoom freely; esc back to same view).
- **Presenter view**: menu toggle "Presenter view on another display" → audience display gets slide, Mac gets presenter UI → click order-map cell to jump → End/esc closes both.
- **Order and notes…**: edit order, skip artboards, per-artboard notes (dialog not drawn — NEW).
- **Copy presentation link** → cloud viewers follow live; viewer presses ← → drifts → bar offers **Catch up** → rejoins; in browser first esc leaves browser full screen. "A Share link opens the canvas instead."
- **Comment** [md-comment]: C in Edit → switches to Preview with Comment → click to pin → thread opens beside pin → reply, @ suggests people with role → Resolve (hides from Open) → ⇧⌘M lists; filters Open / Mine / Resolved.
- **Comment-only** [md-comment-only]: shared canvas opens with Viewing slot; toolbar Hand + Comment only; Comment → composer → Post; Ask to edit → request to owner.
- **Annotate & AI** [md-draw]: N → Preview with Sticky (green) → stickies/arrows/section on layer → ask AI "Do what the stickies in Feedback od trenérů ask" (scope chip = section) → AI applies, then asks via inline question "“Logo větší?” — make the crest bigger, or the whole lockup?" **The crest** / The lockup. ⇧P hides the layer.
- **Inspect** [md-inspect]: in Preview ⌘-click element (instead of following link) / in Viewing plain click → outline + Inspect panel → ⌥ measure → Copy code / Export / Handoff… / **Edit ↵** (switches to Edit with element selected).
- **AI edits while previewing** [md-edge-ai]: AI finishes on artboard under pointer → held (hover state kept) with tag → applies when pointer leaves; other artboards update live.
- **View-only link** [md-edge-viewer]: opens in Preview (browser) → Viewing one click away for specs → menu limited → Version history opens read-only (no Restore).
- **Offline present** [md-edge-offline]: local assets play; missing clip holds first frame on audience screen; presenter sees reason + Skip; Copy presentation link waits for connection.

### 3. States & edge cases

- **"What stays, what hides"** table [md-model] (implement literally):

| | Edit | Preview | Present · Artboards | Present · Canvas |
| --- | --- | --- | --- | --- |
| Clicks on design | Select | Use it — links, hovers, video | Next artboard | Pan and zoom |
| Toolbar | Making tools | Annotation tools only | Hidden | Hidden |
| Canvases panel | Shown | Folded to its icon | Hidden | Hidden |
| Inspector | On selection | ⌘-click → Inspect | Hidden | Hidden |
| Hold ⌥ and point | Measures | Measures | Off | Off |
| AI chat panel | Shown | Folded — opens from the spark | Hidden | Hidden |
| What AI changes | Shows live | Live — never under your pointer | Lands when you move on | Shows live, unmarked |
| Stickies & annotations | Quiet (faded, readable) · N C M A E S switch to Preview | Drawn here · ⇧P hides | Hidden | Hidden |
| Comment pins | Shown | Shown | Hidden | Hidden |
| Project menu | Project pill | Folded pill (mark) | esc first | esc first |
| esc | Steps back | Back to Edit | Artboard settles back | Back to the same view |

- **Viewing** (Can view / Can comment): clicks select for specs, nothing edits; editing controls **hidden, never greyed**; no AI chat panel; access word in status slot; Ask to edit.
- **Mixed kinds in Present** [md-edge-mixed] (no settings, rule per kind): Web fills width, starts at top, scrolls with trackpad · Post 1:1 fits height, centred on dark stage, never cropped · Reels 9:16 pillarboxed, plays with sound, click pauses · A4 print at the trim, bleed off-screen, print guides show if on · Banner 1200×300 letterboxed full width · 16:9 video edge to edge, holds last frame at end, → moves on. Skipped artboards excluded from counter (15 artboards → "of 14").
- Preview on canvas without links [md-preview-combine]: videos play with sound, web artboard scrolls inside itself, pan all 15; nothing movable.
- Present link drifted: "Live" indicator off; Catch up.
- Offline: presenter StatusWord; first-frame hold; link copy waits.
- **esc ladder** [md-esc] (menus/sheets/Search close first, then one step per mode, never out of project, never discards work):
  - Edit: deselect / close menu / leave tool for Select; nothing selected → nothing.
  - Preview: close menu/overlay inside design first → back to Edit on the artboard in view.
  - Present · Artboards: back to canvas, artboard settles; presenter view closes too. Present · Canvas: same view, panels as they were.
  - Image/Component: close picker, nothing placed → 2nd esc Select.
  - Comment: close thread, half-written reply kept → 2nd Hand → then Edit.
  - Annotation tools: tool → Hand (items stay) → Edit (also when N C M A E S brought you).
  - Inspect: clear selection → Edit.
  - Viewing: Preview → Viewing; Present → back to where you came from.
  - Switching mid-drag: drag set down where it is; half-drawn arrow kept.
  - Browser: first esc leaves browser full screen.
  - esc never stops AI (Stop is its own button).

### 4. Keys & menu paths

- CONTRACT §2 tool keys (both toolbars). In Edit **N C M A E S** → switch to Preview with that tool; esc steps back.
- **PROPOSED** (md-keys "Proposed keys" chip, OQ 7): **⌥⌘P** Preview · **⌥⌘↵** Present from selected artboard (or the one in view) · **⇧⌥⌘↵** Present from the start · Present the canvas = no key (⌘K) · **L** pointer · **Viewing** as slot word.
- Present: → ← space (space moves on even on video; click pauses), clicker support, L pointer, esc leave.
- Space: in Edit a tap plays a selected video, hold = Hand (CONTRACT §7).
- ⌥ hold = measure (Edit + Inspect); ⌘-click = Inspect in Preview; ↵ in Inspect = Edit that element; ⇧P annotations; ⇧⌘M Comments; @ mention.
- **Menu › View amended** [md-keys] (new/renamed rows): Hide panels ⌘\ · Comments ⇧⌘M · Assets · Annotations ⇧P · — · **Preview ⌥⌘P** · **Present ⌥⌘↵** · **Present from the start ⇧⌥⌘↵** · Present the canvas · — · zoom rows · — · Advanced ›. Present menu lists same rows/keys.

### 5. Classification

| Feature | Class | Today → v2 |
| --- | --- | --- |
| Mode toggle Preview/Edit/Present | EXISTS (DDR-223, toolbar mode group `S/tool-palette.tsx:518`) | → Share cluster switch, own glyphs |
| Viewing slot for read-only | NEW (today "VIEW ONLY" stamp, `?ro=1` boots Preview) | → switch first slot + access word |
| Two toolbars (Edit / annotate) + morph | EXISTS partly (13 tools `DEFAULT_TOOLS`) | Split; Browse/Eraser dropped; key remaps Pen B→P, Highlighter I→Marker M tip, Section ⇧S→S, E Eraser→Stickers |
| Frame F, Image I, Component ⇧I, More (Line/Ellipse/Polygon/Crop/Export area) | NEW (Insert Div/Text/Image EXISTS; AssetPicker EXISTS) | — |
| Image fills frame cropped / own frame on empty canvas | NEW | AssetPicker → Assets tab |
| Linked Design-system component instances | NEW · PROPOSED (13 Design System) | DS view `SystemView` → Design system canvas |
| On click / On hover interactions, links between artboards & canvases | NEW · PROPOSED (OQ) | — |
| PreviewBar + back after link | NEW | — |
| Preview = live canvas (links, hover, video, scroll) | EXISTS (browse/preview, DDR-187/223) | restyle |
| Annotation layer tools, sticky colours, marker/highlighter, sections, stickers | EXISTS (INV §5, sticker picker) | → Preview toolbar; Stickers gallery (see 15 Annotations) |
| Annotations quiet in Edit | NEW | — |
| ⇧P hide annotations | EXISTS | View › Annotations |
| AI reads annotation layer, section as scope | EXISTS partly (pin-to-element flow) | section scope chip NEW |
| Present · Artboards one by one, lift animation, controls, kind fit rules | NEW | — |
| Present the canvas | EXISTS (DDR-117 Presentation mode) | restyle pill "Presenting the canvas" |
| Presenter view (2nd display), notes, order map, skip | NEW · PROPOSED (OQ) | — |
| Order and notes… dialog | NEW (not drawn) | — |
| Presentation link + live follow + Catch up + watchers | NEW · PROPOSED (OQ) | — |
| L pointer | NEW · PROPOSED | — |
| Comments panel ⇧⌘M (filters) | EXISTS (`CommentsPanel` All/Open/Resolved) | → Open / Mine / Resolved; takes left slot |
| Comment pins, threads, Resolve | EXISTS | thread popover beside pin |
| @mentions with role | NEW · PROPOSED (10 Collaboration) | — |
| Comment-only toolbar (Hand + Comment) | NEW (viewer role today "viewer can comment" in hub) | — |
| Inspect (read-only specs) | EXISTS (Inspect tab `C/app.jsx:9835`, Copy CSS, Export, Handoff) | → Inspect panel; ⌘-click in Preview; Copy CSS → Copy code; Edit ↵ NEW |
| ⌥ measure | EXISTS (measure/snap guides) | Edit + Inspect |
| AI deferred under pointer | NEW · PROPOSED (OQ 8) | — |
| Viewer menu subset, Version history read-only | EXISTS partly (viewers get 6 items) | rows per [md-edge-viewer] |
| Offline presenting first-frame hold | NEW | — |
| esc ladder | EXISTS partly (esc exits presentation) | full ladder NEW |

### 6. Backend / native needs

- Mode state machine owned by shell, mirrored into canvas iframe (postMessage bridge like DDR-117 chrome-visibility) incl. toolbar set, pointer semantics, panels fold/hide, compact cluster.
- **Interactions model**: persist On click / On hover per element (canvas source or `.meta.json`), cross-canvas link targets (canvas + artboard id), runtime navigation in Preview incl. history stack for back.
- **Component instances**: placement inserts DS component as linked instance into auto-layout row; link back to Design system canvas (13) — codegen + update propagation.
- **Present**: fullscreen window(s) via Tauri; **multi-display** detection + audience window on 2nd display; clicker keys; per-canvas run order + skip flags + per-artboard notes (persist in `.meta.json`, versioned? decide); kind-aware fit renderer; video autoplay with sound inside iframe.
- **Presentation link**: hub route `/present/<canvas>`, realtime presenter position broadcast, viewers' follow state, watcher count, works in browser for cloud viewers; needs cloud (queues when offline).
- **Offline media**: know which assets are local; first-frame poster for missing clip.
- **AI-under-pointer deferral**: hot-reload gate per artboard keyed on hover; apply on pointer leave (canvas runtime + dev-server reload granularity per artboard).
- **Per-role capability gating** (Can view/Can comment/Can edit) from hub roles → UI hides controls; Ask to edit request flow to owner; viewer Version history without Restore. Hub today: owner/member/viewer (OQ 6).
- Mentions → notifications/e-mails (10).

### 7. Dependencies

- Kit: `ModeSwitch`, `ModeGlyph`, `ShareCluster mode/canEdit/access`, `Toolbar mode/only/swatches/keys/inline`, `ToolbarMorph`, `AnnotateIcon`, `TOOLS/ANNOTATE_TOOLS/MORE_TOOLS`, `easeOut`, `Inspector`, `CanvasesPanel tab="assets"`, `AIPanel question`, `StatusWord`. Local kit candidates: ModeGlyph, InspectGlyph, MdCluster(compact), PreviewBar, ToolCard, PresentControls, CanvasPill, PresenterView, OrderMap, Thread, CommentsPanel, InspectPanel, Measure, DrawSection, ComponentPicker, AssetPhotos, BrowserWin.
- Canvases: 13 Design System (components, "Uses <DS>"), 14 Editing (object keys, auto layout, editing same object), 15 Annotations (sticker gallery), 10 Collaboration (mentions, roles, follow), 12 Assets, 07 Video (timeline/space), 08 Artboard Kinds (print guides, kinds), 09 Export (Handoff), 03 (AI panel/question), 05 es-viewer (same comment-only view).

---

## 05 Empty States (`05 Empty States.tsx`, 20 artboards, 4 sections)

Rule: every empty state = **what's missing · why it's fine · ONE next step** (often an AI chip/spark button + one action); panels sit the block in the upper third; **no button when there's nothing to do**; spot art + SF Rounded for playful moments; no "Oops", no "!"; "nothing is deleted" (Trash + Version history always exist).

### 1. Surfaces / components

- **Empty block** (`Empty`, kit candidate): optional spot art (240 canvas / 176 panel) or glyph · situation line (`es-sit`) · next line (`es-next`) · chips row · actions row; sizes panel/canvas; align center/left; `quiet` = half-strength spot (offline).
- **Spot art set** (`Spot`): `canvas`, `none`, `ai` (lifted from `system/maude-v2/assets/organic/spot-*`) + composed `comment`, `image`, `done` (DS candidates — redraw via draw-agent). Token fills only; follow app theme.
- **AskBtn**: azure spark button (white spark) for AI next steps, optional key hint; **Sugg** chips = things you'd say.
- **Confetti** pattern (`mv2-pattern-confetti`) — only behind Comments "All done.".
- **Ghost cards** for empty Home shelves.
- **Panel shells**: PanelShell (Canvases/Layers/Assets) and SidePanel (Comments, Version history, Exports, Trash, Chats) with title, optional chip, back chevron, close.
- **EmptyTimeline**: transport (disabled play), "0:00 / 0:00", artboard name, **Expand** button; ruler 0:00–0:30; drop zone; Captions lane; Music lane.
- **NoResultsPalette / NoRecentsPalette** (⌘K variants).
- **KindChips** filter (All · digital · web · print · video with counts; active chip ×).
- **Skeleton artboards** (`SkelBoard`) + arriving rows (pulsing thumbs) + progress foot.
- **Ghost artboards** (dashed outlines with labels) + **RestoreBracket** + trash card.
- **Share sheet (alone)**.

### 2. Flows + states per artboard (copy verbatim)

- [es-home-cloud] Home (only Home tab), signed in, no projects: Home compact (kit) — "What shall we make?", prompt placeholder "A landing page for a small café, warm and simple", chip "Starts a new canvas in **a new project**", starters (A pricing page · Three logo ideas · A matchday poster), **"Start with an empty canvas ⌘N"**; shelf "Your projects" (where: cloud glyph "cloud.maude.sh") with 3 ghost cards + "No projects yet." / "Your first canvas starts one — and everyone you invite sees it here." No button.
- [es-home-local] Not signed in, local: target "a project on this Mac"; placeholder "A one-page portfolio, six projects, calm and light"; top-right **"Sign in to cloud.maude.sh"** (ghost); shelf where "On this Mac" (laptop glyph): "No projects on this Mac yet." / "Your first canvas starts one. Already have a folder of work? Any folder opens." + **Open project… ⌘O**.
- [es-home-shared] Your project card ("Studio site · 4 canvases · Tereza, 2 min ago", S avatar) + shelf "Shared with you": ghost cards + "Nothing shared with you yet." / "When Tereza or Jonas share a project with you, it shows up here." No button.
- [es-project-new] New project tab (Portfolio 2026, local tab): **no toolbar, no zoom**; canvas centre: ai spot (lands) · "Portfolio 2026 has no canvases yet." / "Describe the first one and AI drafts it — or start blank." + large prompt (placeholder "A one-page portfolio with six projects, calm and light") + "Start with an empty canvas ⌘N"; left panel: no search field, "Portfolio 2026 · 0 canvases", glyph "No canvases yet." / "Each canvas holds as many artboards as you like." + row "New canvas"; foot "Folders appear when you make one."; Share cluster status **Local project**, no faces.
- [es-canvas-ai] New canvas "About us" (row meta "now"): canvas spot lands once; **"Your canvas is ready."** / "Ask AI for a first draft, or start drawing." + AskBtn **Ask AI ⌘/**; Edit toolbar visible under it; zoom 100%.
- [es-landing] Landing motion: only stickies move; `--dur-spring` 420 ms · `--ease-spring`; stagger 48 ms (= `--dur-flip` × 0.4); drop 34 px, untilt 8°, scale from 86 %, overshoot 104.5 %; words + Ask AI present from frame 1; reduced motion → 1 ms (final frame). Frames 0/90/200/520 ms.
- [es-canvas-three] Same line + Ask AI in all three: **Online** → after send AI slice "Drafting About us…"; **Offline** (status "Offline — kept on this Mac", spot quiet) adds "AI is back when this Mac is online." → after send "Queued — sends when this Mac is online."; **AI not connected** → line unchanged → first send opens ConnectSheet once → waiting prompt runs.
- [es-artboard-new] After New artboard (Tablet 834×1194, selected, blank): hint floating on artboard "Empty artboard." / "Draw a frame with **F**, place an image **I** or a component **⇧I**, or let AI start it from Desktop." + AskBtn **Ask AI to fill Tablet ⌘/**; hint leaves the moment you draw; Layers tab: title "Tablet" + "No layers on Tablet yet." / "Anything you draw or drop on it shows up here, in order."; inspector auto-opened (Preset Tablet, Size, Fill White, Clip content).
- [es-panels-canvas]: **Empty folder** (2027 open, count 0): "Nothing in 2027 yet." / "Drag canvases in, or start one here." + row **New canvas in 2027** · **Comments none**: comment spot · "No comments on Homepage yet." / "Press **C**, then click anywhere on the canvas to leave one." + **Share for feedback** · **All resolved**: segment Open 0 · Mine 0 · Resolved 4, confetti, done spot lands, "All done." / "Every comment on Pricing is resolved. They stay under Resolved, with their replies." (only celebration) · **Version history before first change**: row "Now · About us · made by You, 1 min ago" + "Versions appear here as you work." / "Every change is kept on its own. There's nothing to save." No button.
- [es-panels-make]: **AI chat no chats** (legacy header "AI" + new/hide): ai spot · "Ask about Pricing." / "AI sees what you've selected, so “make this calmer” just works." + chips "Add a yearly toggle" · "Write three FAQ answers" · "Make a dark version"; field chip "◆ Whole canvas", placeholder "Ask AI about Pricing…" · **Assets** (left panel 3rd tab): drop zone, image spot, "No images or footage yet." / "Drop photos, logos, video or music here — or anywhere on the canvas." + AskBtn **Generate an image** · **Exports**: "No exports yet." / "Every export of Studio site lands here, ready to save again." + **Export… ⇧⌘E** · **Trash** (back chevron, chip "Studio site"): "Trash is empty." / "Canvases and artboards you move to the trash wait here until you clear them out." No button.
- [es-timeline] Select empty video artboard "Reels · nábor 2027" (1080×1920, placeholder "9:16 · 0:00") → timeline appears (CONTRACT §7): "No clips on Reels · nábor 2027 yet." / "Drag footage here from Assets or Finder. 38 clips from Combine 2026 are ready in Assets." + AskBtn **Cut 15 s from those clips**; inspector kind Video: Preset "Reels 9:16", Size, Length **"Set by its clips"** (read-only), Frame rate "30 fps".
- [es-search-k] ⌘K "pricng": spot none + "Nothing called “pricng”." / "Try another word, or ask AI to find it." → group **Did you mean** → Pricing (selected; meta "Studio site · Tereza, 2 h ago"; ↵ opens) → **Ask AI to find “pricng”** — it looks inside canvases too ⌘↵; foot "0 results · 1 close match".
- [es-search-more] ⌘K day one: Recent → "Nothing opened yet." / "Canvases you open show up here, newest first."; **Start here**: New canvas ⌘N (selected) · Open project… ⌘O · Import from Figma… · Keyboard shortcuts ?; Ask AI — "type what to make, or what to find" ⌘↵; hints "↑↓ move · ↵ run"; foot "Every tool is here — type its name". **Assets search no hits** ("logo bílé"): "Nothing called “logo bílé”." / "Try another word — search reads names and tags." + AskBtn **Let AI describe your pictures** + fine print "So search finds what's in them. Once for Alligators brand, on your Claude account."; panel foot "Searched 247 assets — names and tags".
- [es-search-panel] Canvases panel search "sponzoři 2024" over 93 canvases: spot + "Nothing called “sponzoři 2024”." / "Try another word, or ask AI to find it." + AskBtn **Ask AI to find it**; foot "Searched 93 canvases and their artboards" (name search covers artboard names too).
- [es-filter] Layers tab with kind filter carried from previous canvas: chips All 5 · digital 4 · web 1 · print 0 (active, ×) · video 0; "No print artboards in Combine-invite." / "The Print filter is still on from Combine-kampan. All 5 artboards here are digital or web." + **Clear filter**; artboards stay on canvas, dimmed.
- [es-viewer] Can comment on Uniformy-2027 (tab account label "Alligators — can comment"): cluster Viewing + "Can comment" + **Ask to edit**; toolbar Hand + Comment only (rests on Hand); no AI chat panel; zoom-only island; Comments side panel: "No comments on Uniformy-2027 yet." / "Press **C**, then click anywhere on the canvas to leave one. Jonas and Tereza see it right away."
- [es-arriving] New Mac pulling Alligators brand: tab shows syncing; status **Syncing…**; downloaded artboards render, others are skeletons with name + kind glyph + real size, pulsing; canvas tag "4 artboards on their way"; panel lists every canvas by name (arrived = normal, pending = dimmed pulsing thumb; top-level folders pulsing); foot "Getting Alligators brand · 41 of 93 canvases" + bar. Never an "empty project". Order = "the order you'll need it".
- [es-offline-uncached] Offline, canvas never downloaded: **no toolbar, no zoom**; glyph offline · "Combine-video-AI isn't on this Mac yet." / "It opens by itself when this Mac is back online. Nothing in it is lost — the cloud copy is safe." + **Show canvases on this Mac** (filters list); not-local rows dimmed with cloud glyph; status "Offline — kept on this Mac".
- [es-all-trashed] All 4 artboards of LetakA6 moved to trash: dashed ghost outlines with labels keep places; dashed bracket to card; trash glyph · "LetakA6 has no artboards left." / "Jonas moved all four to the trash 10 min ago. Restore puts them back where they were; every earlier version is in Version history too." + **Restore 4 artboards** (primary).
- [es-edge-panels] **Chat search no hits** (Chats header w/ back, chip, +): "No chat mentions “tabulka výsledků”." / "Searched 41 chats in Alligators brand — titles and every message." + AskBtn **Start a chat about it**; foot "41 chats · kept with the project". **Share sheet alone**: title "Invite people to Studio site"; field "Email, comma-separated" + role select "Can edit"; row You · Owner; "Only you on Studio site so far." / "People you invite see Studio site right away and can edit, comment and download, or look only."; link row "Anyone with the link · Can view — look only" + **Copy link**; Cancel · **Invite** (primary).

### 3. Keys & menu paths

- ⌘N empty canvas (Home + new project + Search), ⌘O Open project…, ⌘/ Ask AI, ⌘K Search (↵ open/run, ⌘↵ Ask AI), ⇧⌘E Export…, ? Keyboard shortcuts, C comment (switches to Preview per 04), F / I / ⇧I in empty-artboard hint, esc.

### 4. Classification

| Feature | Class | Today → v2 |
| --- | --- | --- |
| Home empty shelves (cloud / local / shared) + Start with empty canvas | NEW (Home is v2) · OnboardingWizard EXISTS | — |
| New project empty (panel + canvas prompt) | NEW (today empty state `C/app.jsx:4805` w/ localhost line, "Start quick setup") | replace |
| Empty canvas line + spot + spring | EXISTS partly (empty state) → copy per CONTRACT §6 | NEW motion |
| Offline / not-connected variants | NEW (CONTRACT §7, PROPOSED) | — |
| Empty artboard hint + empty Layers | NEW | — |
| Empty folder w/ "New canvas in <folder>" | NEW | — |
| Comments empty / All done | EXISTS panel → copy + spot + confetti NEW; "Mine" filter NEW | — |
| Version history empty ("Nothing to save") | EXISTS (GitPanel empty states "Nothing to save") → reworded; auto-versions | — |
| AI chat no chats + contextual chips | EXISTS (`ChatPanel` empty: "Create new design system" + 3 suggestions) → canvas-specific chips | — |
| Assets tab empty + Generate an image | NEW tab (Assets, CONTRACT §7); generation EXISTS (INV §11) | — |
| Exports panel | NEW panel (recent exports list EXISTS inside export dialog INV §10) | — |
| Trash panel empty | EXISTS (Sync panel Trash restore/prune INV §8) → own panel | — |
| Timeline empty + AI cut | EXISTS ("drop video clips here") → copy + AI chip NEW | auto-summon on select (CONTRACT §7) |
| ⌘K no results + Did you mean + Ask AI to find | EXISTS palette; fuzzy "Did you mean" + AI find NEW | — |
| ⌘K no recents "Start here" | NEW | — |
| Assets search names/tags + AI picture descriptions opt-in | NEW · PROPOSED (OQ, CONTRACT §7) | — |
| Panel search over canvases + artboards, AI find | EXISTS partly (tree search) | artboard names + AI NEW |
| Kind filter in Layers, carried across canvases | NEW (08) | — |
| Comment-only view | NEW (see 04) | — |
| Arriving skeletons + progress | NEW (sync progress exists in Sync panel) | — |
| Offline uncached canvas + "Show canvases on this Mac" | NEW (SyncBanner offline EXISTS) | — |
| All-trashed ghost outlines + Restore N artboards | NEW (artboard-level trash) | Delete artboard → Move to trash |
| Chat search no hits | NEW | — |
| Share sheet invite + link row | EXISTS (`ShareDialog` links; GitHub invite) → unified sheet NEW | Primary Invite, Copy link secondary (CONTRACT §6) |

### 5. Backend / native needs

- **Home data**: cloud project list, "Shared with you" list, local projects list (recent folders) per sign-in state; collaborator names for empty copy.
- **New project without canvases** must be a valid state (server today fails loud without `.design/` — project scaffold must create `.design/` with zero canvases; boot must not require a canvas).
- **Version history auto-versioning** ("There's nothing to save") — every change kept automatically (hub/git service), "made by You" attribution.
- **Exports history store** per project ("ready to save again" ⇒ keep files or re-export recipe).
- **Artboard-level trash** with original position, actor, time; Restore N artboards to exact places; trash never auto-empties ("until you clear them out"; pruning user-triggered — already `apps/studio/sync/trash.ts`).
- **Sync manifest-first**: hub sends canvas names, artboard names/kinds/sizes before content; prioritized download order; per-canvas local-availability flag (offline uncached detection); progress "41 of 93".
- **Search**: fuzzy close-match suggestions; search over artboard names; asset names + tags index; opt-in per-project AI picture descriptions (Claude account; falls back to names when not connected); AI "find it" that looks inside canvases; full-text chat search (titles + messages).
- **Kind filter persistence** across canvases (state store).
- **Timeline**: auto-show on video artboard select; know "38 clips from Combine 2026 in Assets" (asset query by folder/tag/kind).
- **Roles**: Can comment rendering (hide AI, editing); Ask to edit request.
- **Connect / offline queue** as in 03.

### 6. Dependencies

- Kit: `Home` (compact, target, placeholder, starters, emptyStart), `CanvasesPanel` (tab assets, search, empty, foot), `Toolbar`/`mode="annotate" only`, `ShareCluster` (status local/offline/syncing, access, mode viewing), `ConnectSheet`, `Inspector`, `Artboard page={false}`/`dim`, `Window` tabs (`syncing`, `account`, `local`), `Veil`, `PanelIcon`; `_video.tsx` `VIcon`. Kit candidates: Empty, Spot, AskBtn, Sugg, Confetti, PanelShell, SidePanel, EmptyTimeline, NoResultsPalette, NoRecentsPalette, KindChips, SkelBoard, ArrivingRow, GhostBoard, RestoreBracket, MusicGlyph, MiniDock.
- Canvases: 01 Create Flow / 02 Onboarding (Home, EmptyShelf), 03 (AI chat, chat list), 04 (md-comment-only = es-viewer), 06 Sync (arriving/offline status words), 07 Video (timeline), 08 Artboard Kinds (KindChips, print), 09 Export (Exports), 10 Collaboration (Share sheet, roles), 12 Assets (tab, AI descriptions), Version history.

---

## Cross-cutting notes

### Contradictions / inconsistencies

- **Two AI panel headers in use.** 03 is canonical (chat title ⌄ · ✦ N · + · hide, 340 w, paperclip in field). 04 [md-draw]/[md-motion] and 05 [es-panels-make]/[es-canvas-three] still render the legacy header ("AI" name, no paperclip). Implement only the canonical one; legacy is a drawing artifact.
- **Stickers vs Stamp naming**: kit tool id `stamp`, kit header comment says "Stamp E"; CONTRACT §2 + 04 say **Stickers (E)**. UI copy must say Stickers.
- **Menu › View**: CONTRACT §1 View lists only "Present the canvas"; 04 [md-keys] adds Preview ⌥⌘P / Present ⌥⌘↵ / Present from the start ⇧⌥⌘↵ rows (proposed). CONTRACT needs the amendment if accepted.
- **Comments filters**: today All/Open/Resolved (default Open); 04/05 draw **Open · Mine · Resolved** (no All). Decide whether "All" is dropped.
- **Comments panel placement**: 04 [md-comment] takes the Canvases panel's (left) slot; 05 [es-viewer] draws Comments as a right-side panel (`es-vcm`), and 05 SidePanels are generic. Pick one slot.
- **Empty AI chat copy differs**: 03 new-chat hint "Ask for a change, a few variants, or an answer. AI works on what the chip says." + suggestions with why; 05 "Ask about Pricing." + chips without why, placeholder "Ask AI about Pricing…". Define: first-ever chat (05) vs new chat (03), and whether 05 chips need the why line.
- **Assets empty copy**: kit default "Drop photos, video or sound here." vs 05 "Drop photos, logos, video or music here — or anywhere on the canvas." Use 05.
- **"Delete" vs trash**: today chat ⋯ has Delete; v2 = "Move to trash" (CONTRACT §7). Chats therefore need Trash support.
- **⇧⌘A** (today Assistant) has no v2 role; ⌘/ replaces it. Check ⇧⌘A vs CONTRACT "Select all annotations ⇧⌘A" — **key collision with today's binding**; remove the old one.
- **Single-letter key collisions with today's shell keys** (INV §19): T toggles tree, H hidden files, S Design system view, N new board composer, I highlighter, E eraser, B pen, ⇧S section, ⇧⌘G Changes, ⇧⌘R refresh tree. v2 reassigns T/H/S/N/I/E/P. All old shell single-letter bindings must be removed or they'll fire alongside tools.
- **⇧⌘T** is Timeline today vs CONTRACT "Keep timeline open"; ⇧⌘I Inspector stays under View › Advanced.
- **Space**: CONTRACT tap = play selected video (Edit), hold = Hand; Present space = next even on video. Preview behaviour for space on a video artboard is unspecified (click pauses).
- **Version history for viewers**: 04 says opens to look without Restore; 03 history shows Restore/Undo this chat for editors only — gate by role.
- **Exports and Trash panels have no entry point** in CONTRACT §1 menu (Trash header has a back chevron, implying it opens from somewhere — maybe Canvases panel foot or Diagnostics). Must decide where they open (Menu › File? Canvases panel Advanced?).
- **Chat visibility across people**: 03 chat list shows a chat with Tereza's avatar inside "your" project list ("Three Story variants", who: tereza) yet 03 says "her chat stays hers" / View only. Decide whether others' chats are listed/readable in Chats (and search hits) or only their running state.
- **Queue rule vs "Undo this chat"**: a queued run "starts on top of the result" — undoing the first chat out of order must handle a dependent later run on the same artboard (conflict semantics undefined).
- **Panel widths**: kit AI panel 340; BigChat 420 default; pinned column width user-sized. Persist per user?

### Ambiguities an implementer must decide

- How an AI run is mapped to artboards (needed for outlines, queue, Made by AI, "where"). Whole-canvas runs touching unknown artboards.
- What counts as "replacing something you made" for the permission gate (photos/footage/text authored by the user vs AI-made content).
- "About a minute" ETA in Waiting card — source of estimate.
- Chat storage location ("kept with the project") and sync to cloud; size limits for 41+ chats with attachments.
- Folder consent scope (per folder path, per project, per Mac?) and revocation UI (Advanced lists, no remove control drawn).
- Attachments "also land in Assets" — which folder (e.g. "Assets › Combine recap" created by AI), dedupe.
- Present order model: canvas order "row by row, left to right" vs explicit order from "Order and notes…" — which wins after edits; where notes live; skip flag storage.
- Presenter view when only one display (menu item checked/greyed?).
- Presentation link auth (who may follow; cloud-only).
- Kind filter carry-over: per user, across canvases — when does it reset?
- "Always for this canvas" permission scope per chat or per canvas for all chats.
- Proposed keys (⌥⌘P, ⌥⌘↵, ⇧⌥⌘↵, L) not yet in CONTRACT — confirm before wiring.
- Cloud AI: quitting stops local AI; whether cloud projects keep AI server-side (OQ 5).

### Easy to forget

- Live-region a11y + ⌘/ focus / esc return [ai-needs-away]; reduced motion for every animation (ring/wipe, toolbar morph 1 ms, lift 1 ms, spring 1 ms, controls hide instead of fade, tab spark static).
- Tag text must equal panel working words; queue suffix "· N waiting".
- ✦ N counts only YOUR runs; others' are "View only".
- Needs-you count persists until answered and wins over busy dot; never times out.
- Chat list row shows "Needs you" / "Stopped · <when>" instead of time.
- Prompt is **never lost**: not connected (waits in sheet), offline (queued), setting up, used up (sends at reset).
- Notifications toggle in Settings › General; Dock badge shared with mentions.
- Closing a project tab while AI runs asks the same as quit.
- Hidden ≠ greyed for roles (editing tools, AI panel absent for Can view/Can comment).
- Cluster stays in place across modes (compact hides faces/status only).
- AI changes in Preview never under the pointer; in Present they "land when you move on"; in Present · Canvas "Shows live, unmarked".
- esc never discards work, never stops AI; drafts (comment, arrow) survive.
- Annotations render "quiet" in Edit.
- Present counter excludes skipped artboards ("of 14" for 15).
- Video in Present plays with sound automatically when its turn comes; 16:9 holds last frame.
- Empty states: no button when nothing to do (Version history, Trash, Home shared shelf); only one celebration (Comments "All done." with confetti); spot art stays theme-aware (token fills), user designs stay light (k-fixed).
- New project / uncached canvas: **no toolbar** (and no zoom) drawn.
- Search foot copy must say what was searched ("Searched 93 canvases and their artboards", "Searched 247 assets — names and tags", "Searched 41 chats … — titles and every message").
- Times: relative first, absolute "6 Oct, 18:12" (24 h); counts with real plural nouns ("1 chat"/"9 chats").
- Session id, model name (claude-opus), raw tool names appear ONLY under Advanced / raw log; agent mode names (acceptEdits, plan…) shown grey as secondary notes.
