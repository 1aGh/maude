# Implementation inventory: v2 canvases 00 · 01 · 02 · 11

Sources read in full: `.design/ui/v2/{00 Index,01 Create Flow,02 Onboarding,11 Projects and Navigation}.tsx` + `.meta.json`, `.design/system/maude-v2/CONTRACT.md`, the `_kit.tsx` header and the pieces these canvases use (Window, ProjectPill, ProjectMenu, CanvasesPanel, ShareCluster/ModeSwitch, AIPanel, Home, SearchPalette, ConnectSheet, Toast, Dialog, ALLIGATORS_*), `.ai/plans/notes/v2-feature-inventory.md`, `.ai/plans/notes/v2-open-questions.md` and `.ai/plans/feature-desktop-project-tabs-and-identity-profiles.md` (the "tabs plan").

Legend: **EXISTS** = today's app has it (restyle or move it) · **NEW** = not built today · **PROPOSED** = the canvas marks it Proposed or as an open question for Michal. Artboard ids are in `[brackets]`.

---

## 00 · Index (`ix-*`)

00 is a reading board, not product UI. Nothing in it ships. It is the source of the rule list and the scope checklist the plan must track.

### Surfaces
- `[ix-map]`: Michal's request, quoted verbatim in Czech, checked against the canvases. There is a card per canvas for 01–13: the question it answers, its artboard and section counts, three artboards to start with, and its file path.
- `[ix-rules]`: 32 rules in 8 groups (AI · Sharing and roles · Video · Modes · Design system · Export · Assets · Words). Each rule is tagged *Settled · CONTRACT §x* or *Proposed — Michal to confirm* (§7 rules and Q-sourced rules), and points at the artboard that draws it.
- `[ix-questions]`: 8 product-model questions, 6 new ones (13 Design System and 03), a scope checklist titled "Drawn as if it exists — keep in scope for v2.0?" (9 rows), and 11 smaller calls on words, keys and placement.
- `[ix-kit]`: the kit's component groups, the glyphs, thumbnails, kinds and status words, `_video.tsx` exports, conventions (1440×980 app artboard, `.k-fixed` keeps user work light, a project is a rounded square and a person is a circle, id prefixes), and known issues.

### Items the implementer must carry into the plan
- **Rules that become product behaviour** (each lands in another canvas's inventory; listed here as the checklist):
  - AI offline queue: "Queued — sends when this Mac is online." · "AI is back when this Mac is online." **NEW / PROPOSED**
  - The AI-not-connected sheet on first use **NEW / PROPOSED**
  - One AI per artboard **PROPOSED**
  - Home always has "Start with an empty canvas ⌘N" **NEW**
  - Send and Ask AI buttons are azure with a white spark; vermilion is used only for AI presence **NEW styling**
  - AI copy describes the result, never itself. ⌘Z undoes AI changes **NEW**
  - Share opens on Invite, and Copy link is a secondary button **EXISTS → restyle (10)**
  - Access words "Can view" · "Can comment" + "Ask to edit" **PROPOSED**
  - Save status is shown in words, not operated **EXISTS (status bar chips) → moves**
  - Things are "moved to the trash"; editors trash, only owners clear out **PROPOSED**
  - The timeline comes with a video artboard; Space tap/hold **PROPOSED**
  - Mode switch in the Share cluster **PROPOSED**
  - AI holds still under your pointer while you Preview **PROPOSED**
  - Two toolbars, one per mode **settled §2**
  - Mode keys ⌥⌘P / ⌥⌘↵ / ⇧⌥⌘↵ / L **PROPOSED**
  - The design system is a board, with review on update **PROPOSED**
  - Lower elevation tokens **settled**
  - Export scope always visible; "Show in Finder" toast; "Exported 114 of 115" + Retry; "RGB — the print shop converts to CMYK"
  - Assets are the third tab, ↵ places a tile; search inside pictures is opt-in; "Waiting for Jonas's Mac" vs Missing; Figma imports as an exact picture; photo edits apply to one use
  - Words and voice rules (§3/§4); the empty canvas line; "Nothing called "pricng". Try another word, or ask AI to find it."; the project tab menu
- **Scope checklist** (each row is NEW; Michal must tick v2.0 vs later):
  - Links between artboards, presenter view, presentation links, per-artboard notes (04)
  - Follow, Bring everyone here, mention e-mails (10)
  - Captions, beat cut, ducking, poster frame, reframing, Sound-only, 4K, .srt (07)
  - Linked video formats (07)
  - JPG, folder batch, file-name tokens, cloud vs Mac render, colour profile, font-licence check, export a past version (09)
  - 300 dpi print default (08)
  - Search in pictures (12)
  - Brand from a website (12)
  - Offline prompt queue, drag-drop attachments, Open in terminal, chats grouped per canvas (03)
- **Known issues to fold into the plan:**
  - A `fixed` artboard loses about 24 px to its label (canvas-lib bug, spun off).
  - Export bugs (CLI ignores print-PDF options; a zip export without a scope is rejected; ⇧⌘E means two things).
  - Crash recovery and a full disk are not drawn anywhere: this is a design gap.
  - Kit glyphs (kinds, offline, lock, trash…) should move into the DS iconography.
- **Backend/native:** none of its own.
- **Dependencies:** none. It summarises every other canvas.

---

## 01 · Create Flow (`cf-*`)

Two projects: Studio site (4 canvases, plus "Landing page" once drafted) and Alligators brand (93 canvases).

### Surfaces / components
- **Home** `[cf-home-prompt]`: the kit `Home` inside a window whose Home tab is active.
  - Elements: ProjectPill reading "Home"; a ⌘K search button top right; a 48px spark; title "What shall we make?"; sub "Describe it in a sentence. AI puts a first draft on a new canvas — you take it from there."; a large prompt with an azure send button.
  - Target chip under the prompt: "Starts a new canvas in **Studio site** ⌄". It is a project picker.
  - "↵ to send" hint.
  - Three starters with thumbnails ("A pricing page / with a yearly toggle", "Three logo ideas / for Alligators brand", "An onboarding flow / four screens, mobile").
  - "Start with an empty canvas ⌘N".
  - "Recent canvases" with "See all"; cards carry thumbnail, name, "Project · time", faces, and a "Made by AI" chip.
  - "Recent projects": a stack of three thumbnails, name, "N canvases", project square avatar, laptop glyph if local, and an "Open project… / Any folder works" card.
  - **NEW** (no Home today; the closest is the empty state at `app.jsx:4805` and the OnboardingWizard).
- **AI drafting on a new canvas** `[cf-ai-drafting]`:
  - The new canvas is created and named "Landing page", and its row shows a spark ("AI is drawing").
  - Desktop is done and shows "Made by AI".
  - Tablet has a dashed spark outline and the tag "AI is drawing Tablet".
  - A ghost placeholder "✦ Mobile — next" shows where the next artboard lands.
  - The AI chat panel uses the canonical header (chat title "A calm landing page" ⌄). The working line repeats the artboard tag's words exactly, then the step "Desktop done · Mobile next" and a **Stop** button.
  - **EXISTS (partly):** ACP chat plus `/design:new` produce artboards. **NEW:** progressive per-artboard landing, ghost placeholders, working tags that sync with the panel, auto-creating the canvas from Home.
- **Result toast** `[cf-ai-done]`:
  - Copy: "Done — Desktop, Tablet and Mobile are on the canvas." with action **Undo**.
  - Shown when the AI chat panel is folded; the folded spark icon gets a dot.
  - Artboards land with a small spring and a "Made by AI" mark in the label row.
  - **NEW.**
- **Inspector on select** `[cf-select-tweak]`:
  - Selecting an artboard summons the inspector. The **Canvases panel folds to its icon and the canvas pans left** to make room.
  - Artboard rows: Preset (select; typing a width switches it to "Custom"), Size W×H, Fill, Corners, Clip content (switch), Export ("PNG · 2×" button). A quiet Advanced row sits at the foot.
  - The AI chat panel shows a scope chip "◆ Desktop" (the selection) and suggestion chips "Make it calmer" · "Tighter spacing" · "Add a pricing teaser".
  - AI reply: "Done — Desktop, Tablet and Mobile are on the canvas. Pick one to refine."
  - **EXISTS** (Inspector, ArtboardKnobs) → restyle. **NEW:** auto-fold the left panel with a camera pan, and suggestion chips.
- **Sticky + comment** `[cf-sticky-comment]`:
  - N switches to Preview with the Sticky tool. A swatch row shows above Sticky (yellow coral green sky lilac).
  - Stickies read "Shorter headline?" and "Services as three cards".
  - C pins a comment; Tereza's comment "Could the button say "Book a call"? It's what people want." waits for an answer.
  - The Share cluster mode switch reads Preview; the toolbar is the annotate toolbar. esc returns to Edit.
  - **EXISTS** (sticky N, comments C) → moves into the Preview toolbar (04 owns that).
- **AI went too far / undo** `[cf-undo-before]` `[cf-undo-ai]`:
  - Chat "Try a dark hero"; AI: "Done — the hero on Desktop is dark now, with the sun kept warm."; chips "Try it on Tablet", "Lighter dark".
  - ⌘Z gives the toast "Undone — the dark hero by AI." with action **Redo**. The chat keeps its messages.
  - AI edits sit in the same undo stack as yours and appear in Version history. **NEW** (unified undo across AI file writes).
- **Blank canvas** `[cf-blank]`:
  - ⌘N gives "Untitled canvas", which appears in the Canvases panel.
  - Empty-state spot art (dot field, page, three stickies).
  - "Your canvas is ready." / "Ask AI for a first draft, or start drawing." with an **Ask AI ⌘/** button (azure, spark).
  - The toolbar shows the Frame tooltip (`tip="frame"`). The AI panel is folded to its spark icon.
  - **EXISTS** (empty state, new canvas) → restyle and recopy. The kit candidate `EmptyCanvas` is shared with 02 and 05.
- **F: new artboard plus preset list** `[cf-add-artboard]`:
  - F drags out an artboard ("Artboard 4", selected, size tag "1280 × 800").
  - The inspector's Preset select is open, with the list grouped by kind:
    - Web: Desktop 1440×900 · Laptop 1280×800 · Tablet 834×1194 · Mobile 390×844
    - Social: Post 1080×1080 · Story 1080×1920
    - Print: A4 210×297 mm · A5 148×210 mm · Letter 8.5×11 in
    - Video: Landscape 16:9 1920×1080 · Vertical 9:16 1080×1920
  - The artboard's kind follows the preset; there is no separate mode.
  - **EXISTS** (Edit › New artboard presets, artboard kind select) → **NEW:** F-drag creation and the grouped preset list (08 owns the full picker).
- **Artboard context menu** `[cf-duplicate-width]`:
  - Items: Ask AI about Desktop ⌘/ · Duplicate ⌘D · Duplicate at another width › · Rename · Copy ⌘C · Paste ⌘V · Export… ⇧⌘E · Move to trash (danger).
  - Submenu: Laptop 1280 · Tablet 834 · Mobile 390 · Custom width….
  - **EXISTS** ("Duplicate at width (4 widths)") → restyle. "Custom width…" and "Ask AI about…" are **NEW**.
- **Duplicate result** `[cf-duplicate-done]`:
  - The copy is named "Desktop — Laptop". It lands *under* the source with left edges aligned and the content reflowed to 1280.
  - The gap guide shows "144" in the accent colour; an alignment line is drawn. Dragging measures gaps, and equal gaps snap.
  - Toast "Duplicated at Laptop — 1280 wide." with action **Undo**.
  - Placement rule, gap guides and snapping are **NEW/partial** (measure/snap guides exist).
- **Frames and text** `[cf-frames-text]`:
  - Double-click text to type in place (caret shown). Selection labels read "Hero copy · frame".
  - The left panel's Layers tab shows the nesting (Desktop › Nav/Hero › Hero copy › text rows). Rows can be locked (lock glyph) or hidden (eye-off glyph, dimmed).
  - Text inspector: Font, Size, Weight, Colour, Align (Left/Centre/Right). Advanced holds CSS (`font-size`, `font-weight`, `letter-spacing`, `line-height`).
  - Layers is the Canvases panel's 2nd tab.
  - **EXISTS** (Layers, CSS tab) → restyle. In-place text editing is detailed in 14 Editing.
- **Canvases panel, big project** `[cf-big-tree]`:
  - Header segment: Canvases · Layers · Assets, plus a fold button. Search field reads "Search" ⌘K.
  - Recent block (e.g. "Uniformy-2027 · 1 h ago").
  - Project title with its count, "93 canvases".
  - Folder tree with counts: 2026 16 › combine 6 / dresy 4 / social 6; club-web 9; print 6; social 31; legacy 27. Root junk files test / Test2 / ahoj / ahoj2 stay visible: "nothing is hidden, dimmed or tidied away".
  - Row badges: AI spark (tooltip with the working words, e.g. "AI is cutting the teaser"), faces, kind glyphs, laptop for local.
  - Truncated name with a hover tooltip showing the full name plus its folder path.
  - "+ New canvas" row; Advanced row at the foot.
  - **EXISTS** (Files panel tree, sections, counts) → restyle. Recents, pictures on rows, and the AI/faces badges are **NEW**.
- **In-panel search** `[cf-panel-search]`:
  - Typing flattens the tree. Matches are **accent-insensitive** ("letak" matches "leták").
  - It matches canvas names *and the artboards inside them*. Second line under each result: the folder, or "print · "Náborový **leták** A6 · FLAG" and 3 more".
  - Foot: "3 results · ⌘K searches every project". Empty: "Nothing called "x". Try another word, or ask AI to find it."
  - **EXISTS** (Search canvases…, / and ⌘F) → **NEW:** artboard matching, accent folding.
- **⌘K Search** `[cf-search-k]`:
  - Field placeholder "Search canvases, actions, or ask AI…" with an esc key.
  - "Canvases" group: thumbnail, project · folder · who/when, "matches "…"".
  - "Tools and settings — not on screen, found by search" group, each row with a where-chip: "Print guides · Menu › View › Advanced", "New artboard — A4 · Menu › Edit › Advanced", "Export… · ⇧⌘E". Synonym matching: via "leták → print", "PDF for print".
  - "Ask AI — describe what you want on the canvas ⌘↵" is always last.
  - Foot: "↑↓ move · ↵ open · N results". A Veil dims the canvas behind it.
  - **EXISTS** (CommandPalette, 17 actions) → **NEW:** canvas results with thumbnails, a tool index with where-paths and synonyms, Ask AI row.
- **Fit view / hide panels** `[cf-open-big]`:
  - ⌘0 fits all 21 artboards at 10% (19 fixed-size, 2 print, each with its kind glyph). A transient readout "Zoom to fit · 10%" is shown.
  - ⌘\ hides the panels: pill folded to the mark, Canvases and AI become icons, the Share cluster becomes "zen" (only the Show-panels button), and the toolbar folds.
  - Top toast "Panels hidden. Press ⌘\ to bring them back."
  - Zoom is **EXISTS**. Hide panels is **NEW** (today: presentation mode and per-panel toggles).
- **Busy canvas** `[cf-busy]`:
  - Each person is on their own object, in their colour: Jonas's presence ring and cursor on Arch 1; Tereza typing a sticky "Logo větší" in *her* Preview while you stay in Edit.
  - AI's tag "AI is making it greener" sits off the art, with an AI cursor parked on the fill it changes.
  - Status reads "Syncing…".
  - The AI chat panel's run count "✦ 2" is open, listing two of your running chats with their where-lines ("Make the post greener" — Pozvánka na combine · IG Post · 4:5, current; "Countdown story in English").
  - A legend explains who is touching what.
  - **EXISTS** (presence cursors, multiple chats) → **NEW:** per-person modes, object-level presence rings, run list.
- **Save status words** `[cf-status-words]`: the four kit states.
  - Saved — "Everything is in the cloud. Nothing to do."
  - Syncing… — "Changes are on their way up. Keep working."
  - Offline — kept on this Mac — "Every change stays on this Mac and goes up by itself once it's online."
  - Local project — "Lives only on this Mac. Share offers to move it to the cloud."
  - The word sits next to the faces and is never a button. Resync and the rest live in **Menu › Diagnostics**.
  - **EXISTS** (status-bar hub-sync chip, SyncBanner) → **moves** to the Share cluster word plus Diagnostics.
- **Render error** `[cf-render-error]`:
  - The last good version stays visible, dimmed, with the chip "Last good version · 6 Oct, 14:05".
  - Card: "Combine-kampan can't be drawn right now." / "The last change has a mistake the canvas can't show. Behind this card is the last good version, from 6 Oct, 14:05 — nothing is lost, and every version stays in Version history."
  - Primary **Go back to 14:05**; a **Show details** disclosure is the only place technical text appears.
  - The AI chat panel (scope "Combine-kampan") offers the chip "Ask AI to fix it".
  - **NEW** (today: a generic canvas error state).
- **Offline new canvas** `[cf-offline-create]`:
  - ⌘N works offline. The new canvas "Krpole-v-pohybu-2" shows in 2026/social with a laptop badge (tooltip "On this Mac — syncs when online"). Counts go 93→94 and 2026 16→17.
  - Status reads "Offline — kept on this Mac". The empty state adds "AI is back when this Mac is online." and the spot art quiets.
  - The AI prompt stays enabled; the sent message shows "Queued — sends when this Mac is online." (clock glyph).
  - **NEW:** queue, local-pending badge.

### User flows
1. **First canvas from Home (happy path)** `[cf-home-prompt]→[cf-ai-drafting]→[cf-ai-done]→[cf-select-tweak]`
   1. Type a sentence.
   2. Optionally change the target-project chip.
   3. ↵. A new canvas is created in that project and opens in its tab.
   4. AI drafts the artboards one by one (Desktop, then Tablet, then Mobile) and you can touch finished ones.
   5. Stop is available throughout.
   6. Done: "Made by AI" marks plus the toast (if the panel is folded) or the AI message.
   7. Select an artboard. The inspector arrives, the panel folds, the canvas pans.
   8. Edit size (Preset becomes Custom) or use a suggestion chip.
2. **Annotate:** N or C in Edit switches to Preview with that tool; drop a sticky or pin a comment; esc goes back to Edit `[cf-sticky-comment]`.
3. **Undo AI:** ask, AI changes, ⌘Z reverts AI's change as one step; the toast offers Redo; the history entry remains `[cf-undo-before]→[cf-undo-ai]`.
4. **Blank start:** ⌘N, empty state, then Ask AI ⌘/ or F to draw an artboard `[cf-blank]→[cf-add-artboard]`.
5. **Another width:** right-click the artboard › Duplicate at another width › Laptop. The copy lands below, aligned. Toast with Undo `[cf-duplicate-width]→[cf-duplicate-done]`.
6. **Edit text:** double-click, type in place, Layers highlights the node, the inspector switches to Text `[cf-frames-text]`.
7. **Find a canvas:** browse folders (hover shows the full name), or type in panel search (flattened, accent-insensitive), or ⌘K across projects (canvases, then tools, then Ask AI) `[cf-big-tree]→[cf-panel-search]→[cf-search-k]`.
8. **Overview:** ⌘0 fits, ⌘\ hides panels, the toast teaches the way back `[cf-open-big]`.
9. **Edge — busy:** several people and AIs on one canvas, per-person modes, Syncing… `[cf-busy]`.
10. **Edge — broken render:** the card over the dimmed last good version. Go back to 14:05 restores it; or Ask AI to fix it; or Show details `[cf-render-error]`.
11. **Edge — offline:** ⌘N creates a local-pending canvas. Ask AI queues the prompt. On reconnect the canvas syncs and the prompt sends `[cf-offline-create]`.

### States and edge cases (key strings)
- AI working tag and panel line use the same words ("AI is drawing Tablet", "AI is making it greener"), plus a step line and a Stop button.
- Toasts carry one action at most: "Done — … are on the canvas." [Undo]; "Undone — the dark hero by AI." [Redo]; "Duplicated at Laptop — 1280 wide." [Undo]; "Panels hidden. Press ⌘\ to bring them back."
- Status words: Saved / Syncing… / Offline — kept on this Mac / Local project. The kit also has "Not saved" (error), which is not in CONTRACT (see Cross-cutting).
- Long Czech names truncate with a tooltip (e.g. "Combine-kampan — varianta pro partnery a sponzory · 2026/combine"). 93 canvases; junk root files are shown as they are.
- Zoom readouts must state the real zoom (28%, 20%, 22%, 10%, 56%) using tabular figures.

### Keys / menu paths
- ↵ send on Home; ⌘N new canvas (also Home's "Start with an empty canvas ⌘N"); ⌘/ Ask AI with the selection attached; F Frame; N / C switch to Preview with that tool; esc back to Edit.
- ⌘Z / ⇧⌘Z include AI changes; ⌘D duplicate; ⌘C / ⌘V; ⇧⌘E Export; ⌘K Search; ⌘0 zoom to fit; ⌘\ hide/show panels; double-click enters text.
- Menu paths: Menu › View › Advanced › Print guides; Menu › Edit › Advanced › New artboard; Menu › Diagnostics (Resync).

### Classification summary
- **EXISTS → restyle/move:** canvas tree and folders, panel search, CommandPalette, Inspector and ArtboardKnobs, Layers, Duplicate at width, presets, stickies and comments, presence, multiple chats, empty state, zoom.
- **Save status:** status bar → Share cluster word plus Menu › Diagnostics.
- **NEW:**
  - Home
  - Home → new canvas → AI draft pipeline
  - Progressive artboard landing with ghost placeholders
  - Result toast; "Made by AI" mark
  - Unified undo for AI
  - Auto-fold of the left panel on select
  - Suggestion chips
  - "Custom width…"
  - Placement under the source plus gap guides
  - Recents in the panel; thumbnails per row; AI and faces badges
  - Accent-insensitive search that matches artboards
  - ⌘K tool index with where-paths
  - Hide panels (⌘\)
  - Per-person modes and object presence rings
  - AI run list
  - Render-error card with last good version
  - Offline queued prompt; local-pending canvas badge
- **PROPOSED:** offline queue (§7); mode switch in the Share cluster.

### Backend / native needs
- **Home:** list recent canvases across *all* projects (including not-open ones) with thumbnails, project and last-touched; a project list. This needs a shell/app-level index spanning sidecars (the tabs plan), not one project's server.
- **Create a canvas from Home in a chosen project:** the shell opens or wakes that project's tab, then creates the canvas, then starts an AI run with the prompt.
- **AI streaming per artboard:** the server must emit per-artboard progress events (drawing / done / next placeholder) and stop or cancel. It needs "Made by AI" provenance in `.meta.json`.
- **Unified undo:** AI's file writes must enter the canvas undo stack as one step each (today AI writes go through files/git and canvas undo is client-side). Undo must survive the chat continuing.
- **Thumbnails** for canvas rows, Home cards and ⌘K (rendered snapshot per canvas, cached, refreshed on save).
- **Search index:** canvas names *and artboard labels*, accent folding, across projects, plus a static tool/settings index with where-paths and synonyms.
- **Render error:** detect a canvas compile/runtime failure, identify the last good version (history snapshot/commit), restore it, and expose error details. "Ask AI to fix it" seeds a chat with the error.
- **Offline:** create a canvas locally while the hub is unreachable, mark it pending, sync it on reconnect. A persistent AI prompt queue that sends when online.
- **Presence:** per-object selection broadcast (rings), per-person mode, AI cursor and target position.
- **Save-status state machine** feeding the single word (cloud vs local vs offline vs syncing).

### Dependencies
- Kit: Home, ProjectPill, CanvasesPanel, ShareCluster + ModeSwitch, Toolbar (edit/annotate), AIPanel (canonical `chat` header, `runs`), Inspector + In*, SearchPalette, Toast, Menu, PanelIcon, ZoomUndo, the ALLIGATORS_* tree.
- `EmptyCanvas` is a kit candidate (01/02/05).
- 03 AI Chat: run list, queue, suggestions. 04 Modes: Preview toolbar and mode switch. 05: empty states. 08: preset picker. 11: ⌘K, Version history, panel search.

---

## 02 · Onboarding (`ob-*`)

Replaces, and keeps every capability of: OnboardingWizard (GitHub, folder and team-hub doors plus the success tour), OnboardingTour, CreateProject, SetupChecklist and Cloud Self Service.

### Surfaces / components
- **First-launch Home** `[ob-first-launch]`: the window has only a Home tab. ObHome = kit Home plus extras.
  - Prompt placeholder "Describe it — a poster, a landing page, three logo ideas…"; chip "Starts a new canvas in **a new project**".
  - Starters: "A landing page / calm and light", "Three logo ideas / for a new brand", "**Bring my existing brand** / logo, colours, fonts" (this starter goes to Import a brand).
  - "Start with an empty canvas ⌘N".
  - No recents or projects yet. No welcome screen, wizard or tour. **NEW** (replaces the OnboardingWizard).
- **Sign-in card** (inside Home, under the prompt). **NEW.** States `idle | waiting | timeout | offline`:
  - Header: "Keep your work on cloud.maude.sh" / "Every Mac you use, and everyone you invite, sees the same canvases."
  - Buttons: primary **Sign in to cloud.maude.sh** (cloud glyph); secondary **Just a local project** (laptop glyph).
  - Foot hint: "Opens your browser, then brings you back. 14 days free, no card."
  - Quiet link **Advanced options ›**, which opens the flyout `[ob-adv-open]`.
  - **Waiting** `[ob-signin-browser]`: "Waiting for your browser…" (busy status word) · **Cancel** · "Open the page again" · foot "Signed in on another device? **Enter a code instead**". The Advanced link is hidden while waiting.
  - **Timeout** `[ob-edge-timeout]`: "Sign-in didn't finish" + "Nothing changed on this Mac. Try again whenever you like." Buttons are live again. Triggered by app Cancel, web Cancel, or a **10-minute** timeout.
  - **Offline** `[ob-edge-offline]`:
    - Buttons swap: Just a local project becomes primary and the cloud button is disabled ("rests").
    - Line: "Offline" (warn) + "Sign-in waits until this Mac is online — the button wakes up by itself."
    - Foot: "A local project works right now, and moves to the cloud any time."
    - Prompt chip becomes "a project on this Mac"; the ↵ hint is replaced by "AI is back when this Mac is online."
- **Advanced options flyout** `[ob-adv-open]`: five rows, each opening one sheet.
  - Rows:
    - "Use a self-hosted hub" — Your team's own server — its address and your sign-in.
    - "Open a folder or a GitHub project" — Any folder on this Mac, or a project on GitHub.
    - "Connect AI now" — Your Claude account or an API key. Otherwise at the first prompt.
    - "Install the maude command" — Plus the Claude Code plugin, for the terminal.
    - "Import from Figma" — Frames arrive as exact pictures; Make editable, one at a time.
  - Foot: "Each row opens one sheet. Later they live in Settings › Connections and Settings › Advanced, and Search ⌘K finds them."
  - Closed again on next launch.
- **Browser sign-in page** `[ob-signin-browser]` (cloud.maude.sh `/sign-in`, web work):
  - Logo; "Sign in to cloud.maude.sh"; "Then this page sends you back to the app."
  - "Continue with Google" · "or" · email field · "Continue with email".
  - "New here? The same buttons make your account. The first 14 days are free — no card." · "Cancel and go back to the app".
  - The OS prompt drawn: "Open Maude?" / "cloud.maude.sh wants to open this application." / "Always allow cloud.maude.sh to open Maude" / Cancel · Open Maude.
- **Signed-in Home** `[ob-home-new]`:
  - An account avatar (circle) appears top right beside ⌘K.
  - Top toast "Signed in. What you make now lives on cloud.maude.sh."
  - Empty shelf: "Your projects · ☁ cloud.maude.sh" / "No projects yet." / "Your first canvas starts one — and everyone you invite sees it here."
  - The trial starts silently. **PROPOSED.**
- **ConnectSheet** `[ob-ai-connect]` `[ob-edge-ai-missing]`, kit, CONTRACT §7:
  - Title "Connect your Claude account?"; body "Connect your Claude account to let AI draft this."
  - Option "Claude Pro or Max / Sign in through your browser. Claude Code is set up for you."
  - Advanced "Use an API key instead".
  - Fine print "Your prompt waits here and runs as soon as it's connected."; Cancel · **Connect**. Shown over a strong Veil.
  - Triggered at the **first send**, whether from Home or ⌘/ on a team canvas. Cancel leaves a ready, empty canvas (the project and canvas already exist).
  - **NEW / PROPOSED** (BYO Claude). Today: ReadinessList and "Check AI editing readiness…".
- **First draw** `[ob-first-draw]`:
  - The new tab "Open studio" (project square "O" coral) is open on canvas "Poster" with an A4 print artboard.
  - AI message "Claude account connected. An A4 poster is on the canvas — the words are going in now."; working "AI is writing the headline" with step "3 of 4 · button next".
  - Top toast "Open studio is your first project, on cloud.maude.sh." with action **Rename**.
  - No tip card while AI works. The project is named from the sentence. **PROPOSED.**
- **Signature moment, first-draft choreography** `[ob-sig-draw]`:
  - 0 s paper and colour (artboard at A4; dashed spark marks show where the rest goes).
  - 1 s the picture (shapes with `--dur-spring`, big before small, back to front).
  - 3 s the words (headline types at the AI cursor; Stop keeps what is there).
  - 6 s done ("Made by AI" in the label row).
  - One contextual hint at the first selection: "⌘/ Select anything, then ask AI to change it."
  - Reduced motion: each piece simply appears, in the same order.
  - **⌘Z undoes the whole draft in one step.** **NEW.**
- **Invite web page** `[ob-invite-page]` (cloud.maude.sh `/invite/combine-kampan`):
  - Tereza's avatar and the logo; "Tereza invited you to Alligators brand"; "93 canvases · Tereza and Jonas work here".
  - Canvas card (thumbnail, "Combine-kampan", her quoted comment).
  - **Download Maude for Mac**; "Already installed? Open in Maude".
  - Steps "1 Download and open · 2 Sign in · 3 You're on the poster, by Tereza's comment".
  - "Just looking? See it in the browser — view only, any computer." **NEW** web.
- **Landed on the comment** `[ob-invite-landed]`:
  - The Alligators brand tab is active. The camera eases onto the poster; a focus ring sits on the pin.
  - Thread popover: Tereza, "2 h ago · on A4 · plakát", **Resolve**, comment text, reply field "Reply to Tereza" focused, "Tereza is on this canvas now", "↵ to send". Her live cursor is beside it.
  - Mode is **Preview** with the **Comment** tool.
  - Toast "Tereza invited you here — her comment is on the poster."
  - **NEW** (deferred deep link through install and sign-in).
- **Home with a team** `[ob-home-team]`:
  - The prompt chip targets "Alligators brand".
  - **Project-aware starters**: "A matchday poster / in the club's green", "Three reel covers / for Krpole v pohybu", "A sponsors post / 1:1, with all logos".
  - Recents with faces and a "Made by AI" chip; project meta "93 canvases · Tereza, Jonas".
  - **NEW.**
- **Create local project sheet** `[ob-local-name]`:
  - Title "Create a local project"; field Name; hint "Kept on this Mac, in your Maude folder. Move it to the cloud any time."
  - Advanced "Location", when opened: "Location ~/Maude/Portfolio 2026" + **Choose another folder…**.
  - Cancel · **Create project**. **NEW** (replaces CreateProject Local and the folder door).
- **First local canvas** `[ob-local-first]`:
  - Tab "Portfolio 2026" with a laptop glyph. Canvas "Untitled canvas" (meta "now").
  - Status "Local project". Empty canvas line plus Ask AI ⌘/ (connects on first use, the same way).
- **Share on a local project** `[ob-local-share]`:
  - A popover under Share: "Move "Portfolio 2026" to the cloud?" / "Sharing needs the cloud. People you invite can open it there, and so can your other Macs. It stays on this Mac too."
  - Cancel · **Move to cloud**; foot "Only need a file? Menu › Export… ⇧⌘E".
  - Nothing nags anywhere else. **NEW.**
- **After the move** `[ob-local-moved]`:
  - Tab gets a sync glyph; status Syncing…; toast "Moved to the cloud — 3 canvases are going up now."
  - Share popover: "Share "Portfolio 2026"", email field + **Invite**, row "You · Owner", link row "Anyone with the link · Can view" + **Copy link**, Advanced "Invite by GitHub username".
  - If not signed in, Move to cloud runs the browser sign-in first. **NEW** (Share itself EXISTS: ShareDialog).
- **Advanced sheets** `[ob-adv-sheets]`. Mono text is allowed only here. Each title asks with its button's verb.
  - **Connect to your own hub** (Connect):
    - Hub address with **Test connection** → "Reachable — hub 1.4".
    - Segment "Email and password | Invite link or key"; email and password fields.
    - "Projects on this hub open like cloud ones. cloud.maude.sh stays signed in too."
    - **EXISTS** (Connect to a team hub, TeamProjects "Your team's own server") → moves here.
  - **Open a folder or a GitHub project** (Open):
    - Segment "A folder on this Mac | From GitHub"; repo list with Private/Public; "Or paste a GitHub link"; "+ New project on GitHub — private by default".
    - **EXISTS** (GitHub door, CreateProject) → moves.
  - **Connect AI** (Connect):
    - Radio "Claude Pro or Max" / "API key — Pay as you go, from your Anthropic console" with an `sk-ant-…` field.
    - Status "Not connected yet — or connect at your first prompt".
    - **EXISTS** (Readiness) + **NEW** API key path.
  - **Install the maude command** (Install):
    - Rows "maude command — Start, serve and script projects from the terminal" (Not installed) and "Claude Code plugin — The design and flow commands, inside Claude Code" (Installed).
    - "Or in Terminal": `npm i -g @1agh/maude`, `/plugin marketplace add 1aGh/maude`, each with Copy. **NEW** UI.
  - **Import from Figma** (Import):
    - Figma link field; "Figma connected".
    - Fine print: frames arrive as Figma's exact picture; Make editable needs Figma Dev Mode on a paid seat.
    - Advanced "Access token". **EXISTS** (FigmaImportPanel) → restyle.
  - **Share › Advanced › Invite by GitHub username**: `@jonas-gator` + Invite; "They get access the next time they sign in with GitHub." **EXISTS** (CreateProject invite by username) → moves.
- **Settings** `[ob-settings]`: segment **General · Connections · Advanced**.
  - **General:**
    - Account: "You / Signed in to cloud.maude.sh"; Plan "Free trial · 12 days left"; **Manage on cloud.maude.sh**.
    - Link rows: People and invites · Billing and plan · Your Macs · Download everything · Delete the account (each opens the web).
    - Look: Theme Light · Dark · Auto.
  - **Connections:** rows of glyph, title, line, status word and button:
    - cloud.maude.sh — "Where your projects live." — Signed in — Sign out
    - Your own hub — Not connected — Connect…
    - AI — your Claude account — "Pro or Max, or an API key." — Connected — Change…
    - Figma — "For Import from Figma." — No token — Add token…
    - GitHub — "GitHub projects and invites by username." — Connected — Disconnect
  - **"Where every old door went"** map, which must hold in the shipped app:
    - The GitHub door → Advanced options › Open a folder or a GitHub project
    - The folder door → Just a local project · Menu › File › Open project… ⌘O
    - The team-hub door → Advanced options › Use a self-hosted hub (email + password)
    - Invite by GitHub username → Share › Advanced
    - AI setup, Claude Code → At the first prompt · Settings › Connections · Menu › Diagnostics › AI setup
    - Bring my existing brand → Home starter · Menu › File › Import a brand…
    - Figma import → Advanced options · Menu › File › Import from Figma…
    - maude command, plugin → Advanced options · Settings › Advanced
    - People, billing, Macs, download, delete → Settings › General › Manage on cloud.maude.sh
    - Sign in with a code → Waiting for your browser… › Enter a code instead
    - The success tour → Menu › Help › Take the tour
    - "Search ⌘K finds every one of these by name — "hub", "figma", "api key", "billing"."
  - **EXISTS** (Settings modal) → restructured into 3 tabs. The account is a web page. **PROPOSED.**
- **Second Mac** `[ob-edge-other-mac]`: after sign-in, cloud projects and recents arrive. Toast "Signed in — your 2 cloud projects are here." A local project stays on its own Mac until Move to cloud there.
- **Work invite in a personal app** `[ob-edge-accounts]`:
  - Sheet "Open the invite as you@work-studio.cz?" / "Tereza invited that address to Alligators brand. This window is signed in with your personal account."
  - Account rows "You · personal / This window, now" → "you@work-studio.cz / Work · a new tab" (work face: a circle with a people badge).
  - Fine print "Opens Alligators brand in its own tab, signed in as you@work-studio.cz. To switch the whole app: Settings › General › Account."; Cancel · **Open**. **NEW.**
- **No AI on a team project** `[ob-edge-ai-missing]`:
  - Poster selected, scope chip "A4 · plakát", message "Make the logo bigger, like Tereza asked", then the ConnectSheet.
  - Each person brings their own Claude account. After Connect, the waiting prompt runs.
- **After an update** `[ob-edge-whats-new]`:
  - You land where you left off, including from 1.x, signed in as before.
  - Home shows one quiet line, once: "What's new in 2.0 — one menu, calmer panels, cloud first." + **See what's new**.
  - Menu › Help › What's new keeps the dot until read (the Help row on the main menu carries the dot too). No modal, no tour.
  - **EXISTS** (WhatsNew badge and toast) → moves (no menubar badge; a Home line plus the menu dot).

### User flows
1. **Cloud first:**
   1. First launch is Home with the sign-in card `[ob-first-launch]`.
   2. Sign in to cloud.maude.sh: the browser opens `/sign-in` and the card shows Waiting `[ob-signin-browser]`.
   3. Google or email (sign-up and sign-in use the same buttons).
   4. The browser asks "Open Maude?"; the app returns to Home, signed in. Toast; empty shelf; the trial starts silently `[ob-home-new]`.
   5. Type a sentence and ↵. The project is created and named from the sentence; tab "Open studio"; canvas "Poster".
   6. First AI use: the ConnectSheet appears `[ob-ai-connect]`. Connect (browser Claude sign-in; Claude Code set up), then the queued prompt runs.
   7. The draft builds piece by piece. Toast "… your first project …" [Rename] `[ob-first-draw]`, following the choreography `[ob-sig-draw]`.
   8. First selection shows the ⌘/ hint.
   - Edge: Cancel on the sheet leaves an empty, ready canvas.
2. **Invite:**
   1. Tereza's link opens the browser invite page `[ob-invite-page]`.
   2. Download and install (or "Open in Maude").
   3. Sign in (step 2 of flow 1).
   4. The app lands on her comment, in Preview + Comment, reply focused `[ob-invite-landed]`. Reply ↵ or Resolve.
   5. Next launch, Home shows the team project, targeted starters and recents `[ob-home-team]`.
   - Alternative: "See it in the browser", view only.
3. **Local:**
   1. Just a local project opens the Create sheet. Type a name; optionally change the location under Advanced. Create project `[ob-local-name]`.
   2. Tab with a laptop glyph; empty "Untitled canvas"; status Local project `[ob-local-first]`.
   3. Later, Share opens the "Move to cloud?" popover. Move to cloud signs in first if needed `[ob-local-share]`.
   4. Upload in the background (Syncing…). Share now invites `[ob-local-moved]`.
4. **Advanced:**
   1. Advanced options › row › one sheet `[ob-adv-open]`→`[ob-adv-sheets]`: Hub (Test connection, then Connect) · Folder or GitHub (pick or paste, then Open, or New on GitHub) · Connect AI (account or API key) · Install command and plugin · Figma (link, Import, Make editable per artboard).
   2. Later, everything is reachable in Settings › Connections and › Advanced, and through ⌘K `[ob-settings]`.
5. **Edge — offline at first launch:**
   1. The local button is primary and cloud rests.
   2. The cloud button wakes when online, by itself.
   3. A prompt sent is queued `[ob-edge-offline]`.
6. **Edge — timeout:**
   1. Cancel (app or web) or 10 min with no return brings the card back.
   2. It shows "Sign-in didn't finish" and the buttons are live `[ob-edge-timeout]`.
   - Alternative path: "Open the page again"; "Enter a code instead" (device code).
7. **Edge — another Mac:** sign in; cloud projects arrive; toast. Local projects do not move `[ob-edge-other-mac]`.
8. **Edge — work invite:**
   1. The invite address differs from the signed-in account, so the sheet appears.
   2. Open adds a new tab signed in as work; other tabs are unchanged `[ob-edge-accounts]`.
9. **Edge — no AI on a team project:**
   1. ⌘/ on Tereza's poster shows the ConnectSheet.
   2. Connect, then the waiting prompt runs `[ob-edge-ai-missing]`.
10. **Edge — update:** land where you left off; one Home line; the Help menu dot `[ob-edge-whats-new]`.

### States (key strings not already listed)
- Tab states: Home tab (house glyph); local project (laptop); syncing (sync glyph). An account appears in the tab title tooltip ("Studio site — works as You").
- Plan line: "Free trial · 12 days left". The end of the trial is **undesigned** (open question 3).
- Status words used: "Reachable — hub 1.4", "Not connected yet — or connect at your first prompt", "Not installed", "Installed", "Figma connected", "Signed in", "Not connected", "Connected", "No token".

### Keys / menu paths
- ↵ send; ⌘N empty canvas; ⌘/ Ask AI; ⌘K finds Advanced items by name; ⇧⌘E Export (from the Share popover foot); esc Preview→Edit after landing; ⌘Z undoes the whole first draft.
- Menu › File › Open project… ⌘O; Menu › File › Import a brand…; Menu › File › Import from Figma…; Menu › Help › Take the tour / What's new; Menu › Diagnostics › AI setup; Settings › General / Connections / Advanced (⌘,).

### Classification summary
- **EXISTS → move/restyle:**
  - Hub connect (TeamProjects, wizard hub door)
  - GitHub open/create (CreateProject)
  - Folder open (⌘O)
  - Figma import
  - Invite by GitHub username
  - Readiness / Claude setup
  - Device-code sign-in → "Enter a code instead"
  - What's new → Home line and menu dot
  - Tours → Help menu only
  - SetupChecklist "Bring my existing brand" → Home starter and File › Import a brand…
  - Settings → 3 tabs
  - Theme toggle (status bar) → Settings › General › Look
- **NEW:**
  - First-run Home with the sign-in card
  - Browser sign-in to cloud.maude.sh (Google/email) with return via URL scheme
  - Waiting / timeout / offline card states
  - Advanced flyout
  - Silent trial
  - Project named from the sentence
  - Just-in-time ConnectSheet; API-key option
  - First-draft choreography and first-selection hint
  - Invite web page plus deferred deep link to the comment
  - Project-aware starters
  - Create local project sheet (~/Maude/<name>)
  - "Move to cloud" from Share
  - Install-command sheet
  - Settings › Connections list
  - Account as a web page
  - Work-account invite opening in a new tab
  - 1.x → 2.0 landing where you left off
- **PROPOSED:** BYO Claude; 14-day silent trial; naming from the sentence and "Untitled project" for a blank start; Account inside Settings › General (no Account tab); the account managed on the web.

### Backend / native / cloud needs
- **cloud.maude.sh web:**
  - `/sign-in` page with Google OAuth and email (magic link or password; undecided), sign-up through the same buttons, and a "Cancel and go back to the app" signal the app can observe.
  - `/invite/<canvas>` page with the comment preview, download, "Open in Maude" and a view-only web view.
  - Account pages: people, billing, Macs, download everything, delete.
- **Native:**
  - A `maude://` (or universal-link) handler that returns the sign-in token to the waiting app; single-instance routing.
  - 10-min timeout.
  - Device-code fallback (exists today).
- **Deferred deep link through install:** the invite context must survive download, install, first launch and sign-in. The server matches the pending invite to the account, then opens the canvas, camera and comment.
- **Billing:** trial auto-start at first sign-in; trial state in the account ("12 days left"); behaviour at expiry.
- **Project creation from Home:**
  - A cloud project on the hub.
  - Name from the first sentence. Note `[ob-ai-connect]` shows "Open studio" named *before* AI is connected, so naming must be non-AI (heuristic) or provisional.
  - Canvas "Poster" with an A4 print artboard chosen from "poster".
- **Local project:** create a folder `~/Maude/<name>` with `.design/`; a custom location.
- **Move to cloud:** link the local project to a cloud hub and upload all canvases (sync), keeping the local copy. Today's SyncConsent and first-link conflict logic apply.
- **Claude connect:**
  - Browser Claude sign-in plus "Claude Code is set up for you" (silent CLI install and login, DDR-177 bundled runtime).
  - API-key storage in the keychain and use by ACP.
  - Persist the pending prompt and resume after connect.
- **Per-account invite routing:** detect when the invite email differs from the signed-in account; open in a new tab bound to another profile (tabs plan T1–T4 profiles).
- **Second Mac:** list cloud projects per account (cloud API), recents synced across devices.
- **Install-command sheet:** native ability to `npm i -g` (or symlink the bundled CLI) and install the Claude Code plugin; detect installed state.
- **Hub sheet:** a "Test connection" endpoint returning the hub version.
- **What's new:** a once-only Home line keyed to the version; 1.x → 2.0 migration of last state.
- **Project-aware Home starters:** derived from project or brand. Generated or static is undecided.

### Dependencies
- Kit: Home (ObHome lifts it and adds `below`, the account face, the offline hint), ConnectSheet, Window/TABS, ShareCluster, AIPanel, Toast, Menu, CanvasesPanel, ALLIGATORS_*.
- 05 empty states (EmptyShelf `es-shelf`, EmptyCanvas). 10 Share sheet (the canonical Share sheet; 02 draws a popover variant). 11 accounts and tabs. 12 Import (Figma, brand). 03 (AI connect, queue). 06 Advanced (Settings › Advanced, Diagnostics).

---

## 11 · Projects and Navigation (`pn-*`)

Section 1 draws two tab variants. Everything after it draws **Variant A** (native macOS tabs), the plan as written and the proposed pick.

### Surfaces / components
- **Variant A: native macOS window tabs** `[pn-tab-a]` `[pn-tab-a20]`. **PROPOSED pick** (tabs plan T5/T10).
  - AppKit draws only: tab title text, close ×, +, the » overflow menu (a plain list of titles; **whether it exists is a T5 spike**; fallback Show All Tabs + ⌘K), and the Mac's tab right-click menu (Close Tab · Close Other Tabs · Move Tab to New Window · Show All Tabs).
  - With 20 tabs, titles shorten and 12 fit; » lists 8.
  - Identity moves *inside* the window:
    - **Project pill** with a **spark while AI works anywhere in this project** (`PnPill` `ai`). **NEW.**
    - **Account chip** in the Share cluster, first, "W Work ⌄". Shown only when the Mac has 2 or more accounts. **NEW.**
    - Design system row pinned in the Canvases panel.
  - AI in a tab you left becomes a **Mac notification**, e.g. "Open studio — AI needs you / Pick one of three hero variants to keep going.", and "Alligators brand — AI is done / Combine-video-AI is cut: 0:42, ready to look at." **EXISTS** (OS notifications "Claude finished" / "needs your input") → recopy, per project.
- **Variant B: Figma-style strip** `[pn-tab-b]` `[pn-tab-b20]` (only if Michal picks B).
  - Home is pinned first (icon only).
  - Each tab shows a project square, initial and name; a W face for a second account; a spark while AI works; an azure "?" when it needs you; a ring for a resting tab; a laptop for local.
  - Tooltips: "Matchday 2026 · AI is drawing the score card"; "Trenérský manuál · resting — opens in a second".
  - Overflow "10 more ⌄": "Find a tab" search; rows with square, name, where ("Alligators · cloud", "~/Maude/… · this Mac", "hub.studio-brno.cz · the studio's own hub"), account face, and state chip ("AI working" / "Needs you" / "Resting").
  - The CONTRACT §6 tab menu appears as written (Rename… · Move to a new window · Sign in as another account… · Close tab).
  - **NEW**, and it reverses tabs-plan decisions (see `[pn-ab]`).
- **Trade-off board** `[pn-ab]`. Not UI. The decision content:
  - A wins on Mac feel, Mission Control and effort. B wins on project identity, AI on the tab, CONTRACT §6 as written, and Windows/Linux. Accounts are a tie.
  - B would require: reverse "no in-page tab strip"; multiwebview or framing (reopens DDR-109); turn macOS tabbing off and rebuild drag-out, merge, Window menu and Show All Tabs; a feed of every tab's AI, account and rest state (T14 security); Home as a real route; new e2e (T13).
  - **Both variants need these plan lines:** a Home tab (⌘T); resting tabs past 5; relaunch restores all tabs.
  - A later option: a trailing spark through the native tab accessory view.
- **Tab right-click** `[pn-tab-menu]`: in A, the Mac's menu. If A wins, **Sign in as another account… moves to the account chip and Rename… moves to Home**, which amends CONTRACT §6.
- **Windows** `[pn-windows]`:
  - Drag a tab off and it becomes its own window. Window › Merge All Windows joins it back.
  - Mac Window menu: Show Previous Tab ⌃⇧Tab · Show Next Tab ⌃Tab · Move Tab to New Window · Merge All Windows · Show All Tabs ⇧⌘\ · a list of windows with a checkmark.
  - **A project opens once.** Opening it again (from Home, ⌘K or a link) switches to its tab, in whichever window holds it. Toast "Alligators brand is open in this window."
  - **NEW / PROPOSED.**
- **Accounts** `[pn-accounts]`: the account chip opens a card.
  - "Work · you@work-studio.cz / Alligators brand uses this account"
  - "Also on this Mac": "Personal · you@gmail.com / Studio site, Portfolio 2026 and 11 more"
  - **Sign in as another account…**
  - **Sign out of you@work-studio.cz…** / "Signs out every project on it: Alligators brand, Matchday 2026 and 4 more."
  - Foot "Kept on this Mac — Alligators brand opens as Work next time."
  - Account faces are circles with the label initial (W / P), never the person's "M". One form everywhere: "Work · you@work-studio.cz".
  - **NEW** (tabs plan T1–T4, T11; today IdentityBar and CloudBar are global).
- **Home, scrolled** `[pn-home]`:
  - Sticky ask bar: "Ask AI for a new canvas…" + chip "in **Studio site** ⌄" + send, and "Start with an empty canvas ⌘N". The question title scrolls away and never shrinks.
  - **Pinned** ("pin any canvas from its row or its menu"): cards with thumbnail, name, project square and project · folder. Pins span projects.
  - **Recent canvases**: filter chip "All projects ⌄", "See all". Cards: thumbnail, name, project square and name (truncates first), "folder · time", faces, "Made by AI".
  - **Shared with you** ("canvases from other people's projects · 3 new this week"): rows with thumbnail, name, owner face, "Project · Owner's · time", project square, role chip (Can edit / Can comment / Can view).
  - **Projects** ("20 projects"; "Find a project" search; sort "Recent ⌄"), grouped by account header ("W Work · you@work-studio.cz", "P Personal · you@gmail.com").
    - Rows: thumbnail, name, "N canvases · state". States: "in a tab" / "💻 this Mac only" / "☁ not on this Mac yet" (with an **Open** button). Another owner's project shows "Tereza's · 6 canvases".
    - Footer: "15 more" and "Open project… ⌘O".
  - **NEW** (beyond 01's Home).
- **⌘K on Home, empty query** `[pn-home-search]`:
  - Placeholder "Search canvases, artboards, actions, or ask AI…".
  - Groups:
    - Recent searches (clock glyph, a hint with the result count, e.g. "5 results")
    - Open tabs (project square + current canvas + AI state, e.g. "Combine-kampan · AI is cutting Combine-video-AI")
    - Recent canvases (from every project, open or not; "not open" plus the hint "opens a tab")
  - Foot "every project, open or not". **NEW.**
- **Design system location** `[pn-ds]` **PROPOSED**:
  - Three ways in:
    1. **Design system row pinned first** in the Canvases panel (system glyph, name "Design system", sub "Alligators brand system · used by 3 projects"). It never sits in a folder.
    2. ⌘K "design"/"barvy" finds "Alligators brand system — Design system · used by 3 projects" and its sections ("Colour", "Components" — "section of the Design system").
    3. The inspector's link "Uses **Alligators brand system** ›" opens the DS canvas on the style in use (Type › Display).
  - **EXISTS** (DESIGN SYSTEM section, SystemView via S) → **moves** to a pinned row. The board itself is 13.
- **Organise** `[pn-organise]`:
  - Panel order: Design system row → "Pinned" (count) → project header with a sort control "Recent ⌄" → tree → Trash row.
  - Hovering a row shows a pin toggle (Pin / Unpin) and a ⋯ More button. A pinned row shows a pin glyph when not hovered.
  - Sort menu: group "Sort by": Recently opened ✓ · Name · Kind (note "web · social · print · video"); then "Folders on top" ✓.
  - 01's Recent block *is* this sort: "Recent is a sort here."
  - **NEW** (pins, sort). The tree EXISTS.
- **Move and rename** `[pn-move]`:
  - Drag a canvas row (ghost under the cursor "ahoj2") onto a folder. The folder highlights with the tag "Move here".
  - Double-click a name for an inline rename field; "↵ rename · esc keep "Test2"".
  - Or Menu › File › Move to….
  - **EXISTS** (drag-and-drop between folders, Move to…; rename used `window.prompt`) → inline rename is **NEW**.
- **Trash** `[pn-trash]`:
  - Row context menu: Open · Pin · Rename · Duplicate · Move to… › · Copy link · Move to trash (danger).
  - Toast "“ahoj” moved to the trash." [Undo].
  - **Trash row** is the panel's last row (trash glyph, count) and is also listed in Canvases › Advanced.
  - Trash view replaces the panel body: header "‹ Trash · 3 canvases · 1 artboard". Groups Today / Earlier. Rows with sub "root · You, just now", "artboard of Combine-kampan · Jonas, 14:05", "legacy · Tereza, 3 Oct". Hover shows **Restore** (primary). **Trash holds artboards as well as canvases.**
  - Foot "Kept until you clear it out." + **Clear out…**.
  - Dialog "Clear out the trash?" / "3 canvases and 1 artboard go for good — for everyone on Alligators brand. Restore can't bring them back after this." / Cancel · **Clear out** (danger).
  - "Only an owner clears out the trash — editors see Restore only."
  - **EXISTS** (sync trash restore and prune in SyncPanel; tree delete button) → **moves and is reworded** into the panel. The owner-only rule is **PROPOSED**.
- **Artboard jump list** `[pn-jump]`:
  - A canvas row has a disclosure; expanded, its meta shows "21" and it lists all artboards with a kind glyph (the current one highlighted).
  - Click: the canvas **glides** (animated camera) and the target flashes.
  - Panel foot "21 artboards · 19 digital, 2 print". Layers lists inside one artboard.
  - **NEW.**
- **⌘K across projects** `[pn-k-across]`:
  - Once results come from 2+ projects, they group by project with a square header. Asides: "this tab" / "in another tab" / "not open — opens a tab".
  - Rows: canvases (thumbnail, "club-web · 6 artboards", "matches "Mobil · domů"") and **artboards** ("Mobil · nábor 2027 — artboard in website · club-web").
  - "Tools and settings — not on screen, found by search": "New artboard — Mobile · Menu › Edit › Advanced", "Duplicate at another width › Mobile · Right-click an artboard".
  - Selecting a result in another tab switches tabs; a closed project opens a tab. Foot "7 results". **NEW.**
- **⌘K matching** `[pn-k-close]`:
  - Multi-word, any order, accent-insensitive. Each word is marked where it matched, including in the parent canvas meta line ("artboard in **LetakA6**").
  - Typo tolerance: note "Nothing called "unifromy". Showing close matches for **uniformy**.", foot "4 close matches". A weaker match is drawn quiet.
  - The Ask AI row reads "Ask AI — find "<query>" by what it looks like" when a query is typed.
  - **NEW.**
- **Version history panel ⌥⌘H** `[pn-history]`:
  - Header: history glyph, "Version history", ⌥⌘H, close.
  - Filter segment: **All · Named · Made by AI · People**.
  - "Now — Uniformy-2027 · Saved" + **Name this version…**.
  - Grouped Today / Yesterday / date. Rows: thumbnail of *that* version, title (a change summary such as "Číslo 27 větší", or a name), sub "time · person" or "from Tereza's ask", face or spark, chip Named / Made by AI / Restored.
  - Clicking a version shows it **read-only**. A view bar: "Viewing **"Schváleno trenéry"** · 5 Oct, 18:40 · Jonas · esc back to now".
  - The Share cluster mode switch shows **Viewing** while you look.
  - Selected-row actions: **Compare** · **Restore this version** (primary).
  - Advanced fold "branch, version ids"; this is where git lives (06 › 10).
  - **EXISTS** (GitPanel History: preview, Restore, Undo; ⇧⌘G Changes) → **moves** to the ⌥⌘H panel; the git jargon goes under Advanced. **NEW:** pictures, names, AI/people filter, view bar.
- **Compare** `[pn-compare]`:
  - A and B artboards side by side with labels "A · Schváleno trenéry · 5 Oct, 18:40" / "B · Now · 6 Oct, 14:32"; segment **Side by side · Overlay**.
  - Summary "4 changes between A and B — 3 on Venkovní dres · přední, 1 on Helma z boku".
  - **Change list in words** with who and when, e.g. "Dres: černá → zelená · Made by AI, 14:32", "Číslo 27: 120 → 150 px · You, 14:05", "Logo na helmě: added · Tereza, 11:20".
  - History rows marked A and B.
  - Restore explanation: "Restores the whole canvas as it was at A, as a new version — Tereza's helmet logo goes too. Now stays in the list."
  - Buttons: **Stop comparing** · **Restore only Venkovní dres** (the narrow, single-artboard restore) · **Restore this version**.
  - Advanced "branch main · a41f9c2". **EXISTS** (DiffView) → **NEW** semantic diff in words.
- **Keyboard shortcuts overlay** `[pn-switch-ai]`:
  - Header with a "Find a shortcut" search and close.
  - Groups "Tabs and windows" (Next tab ⌃Tab · Previous tab ⌃⇧Tab · Next / previous tab, too ⇧⌘] ⇧⌘[ · New tab — opens Home ⌘T · Close this project's tab ⌘W · Show all tabs ⇧⌘\) and "Finding a canvas" (Search every project ⌘K · Open project… ⌘O · Version history ⌥⌘H).
  - Foot: "⌘W closes the project's tab, as on every Mac. Close canvas (Menu › File) has no key. A closed tab comes back from Home or ⌘K — ⇧⌘T stays Timeline."
  - **EXISTS** (ShortcutsOverlay ?) → restyle, plus search and new groups.
- **Relaunch** `[pn-relaunch]`: every tab comes back, **resting**; only the front tab runs. Toast "20 tabs reopened. Each one starts when you open it." **PROPOSED** plan amendment (v1 restores only the last project).
- **Deep link** `[pn-deeplink]`:
  - Link shape `alligators.cloud.maude.sh/c/combine-kampan#pozvanka-story` (no file path; an artboard anchor). It survives a move or rename.
  - Opening it brings the tab forward (or opens it); the canvas glides to the artboard, flashes it, and opens the comment (count 1).
  - Toast "Opened from Tereza's link — Pozvánka · story."
  - A web link opens the browser, which offers Open in the Mac app. A `maude://` app link (Share › app link) comes straight here.
  - **EXISTS** (file deep-link dialog, share links) → **NEW:** artboard anchor, stable ids, comment open.
- **Can't open** `[pn-cant-open]`:
  1. **Moved folder** (in-tab card): folder glyph, "Portfolio 2026 isn't where it was." / "It was in Desktop › Portfolio 2026. Nothing inside has changed — the folder was moved or renamed." / **Find the folder…** / "Closing the tab keeps it on Home."
  2. **Access removed** (card over the dimmed canvas): lock glyph, "You no longer have access to Brno Open 2026." / "Your last changes were saved first. If this is a surprise, ask someone on the team." / **Back to Home**.
  3. **Now Can view**:
     - Pill folded.
     - Share cluster: access word "Can view"; mode Viewing; **Ask to edit** instead of Share; no panels button.
     - Tip card "You can look at Brno Open 2026, not change it." / "Ask to edit, top right, sends a request to Tereza, who owns it."
     - Toast "Tereza changed you to Can view. Your changes were saved first."
  - All **NEW**.

### User flows
1. **Switch projects:** ⌃Tab or a click on a tab. AI in the tab you left keeps running. When done or needing input, a Mac notification arrives; click it to focus that tab `[pn-switch-ai]` `[pn-tab-a20]`.
2. **Open a project already open:** from Home, ⌘K or a link, it switches to the existing tab and window and shows the toast. There is never a second copy `[pn-windows]`.
3. **Window management (A):** drag a tab out to a new window; Window › Merge All Windows; ⇧⌘\ Show All Tabs `[pn-windows]`.
4. **New tab:** + or ⌘T opens Home in that tab. Picking a project navigates the *same* tab. One Home at a time `[pn-ab]`.
5. **Accounts:**
   1. The account chip opens the card.
   2. Sign in as another account… adds a profile.
   3. Sign out of X… signs out all its projects (confirm).
   4. The binding is per project and persists on this Mac `[pn-accounts]`.
6. **Home "where was I?":** scroll pinned, recent (filter by project), shared with you, projects by account. Open "not on this Mac yet" downloads or attaches `[pn-home]`.
7. **⌘K on Home before typing:** pick a recent search, an open tab, or a recent canvas (it opens a tab if needed) `[pn-home-search]`.
8. **Find the DS:** the pinned row, or ⌘K "design", or the inspector's "Uses …" link (deep into the section) `[pn-ds]`.
9. **Organise:** hover, pin; the Sort menu (Recently opened / Name / Kind; Folders on top) `[pn-organise]`. Drag onto a folder ("Move here"); double-click to rename (↵ / esc) `[pn-move]`.
10. **Trash:**
    1. Right-click › Move to trash. Toast [Undo].
    2. The Trash row opens the Trash view; Restore.
    3. Clear out… shows the dialog; owner only `[pn-trash]`.
11. **Jump to an artboard:** expand a canvas row, click an artboard; the canvas glides and flashes `[pn-jump]`.
12. **⌘K across projects:** results grouped by project. ↵ switches tab or opens the project, then goes to the canvas or artboard `[pn-k-across]`. Typos and accents `[pn-k-close]`.
13. **Version history:**
    1. ⌥⌘H opens the panel. Filter.
    2. Click a version: read-only view with the view bar; esc back to now.
    3. Name this version….
    4. Compare: pick A and B, side by side or overlay, read the change list.
    5. Restore this version (whole canvas, as a new version; Now stays) or Restore only <artboard> `[pn-history]→[pn-compare]`.
14. **Relaunch:** all tabs return resting; opening one wakes it in about a second `[pn-relaunch]`.
15. **Deep link from Slack:** web link → browser → Open in Mac app (or `maude://` direct). Then the tab comes forward, the camera glides to the artboard, the comment opens `[pn-deeplink]`.
16. **Edges:** moved folder → Find the folder…; removed → Back to Home; Can view → Ask to edit `[pn-cant-open]`.

### States / edge cases
- Tab count: 3 tabs and 20 tabs. **Running cap 5** (the tabs plan raises MAX_INSTANCES 3→5). Past 5, tabs **rest** (server stopped, tab kept, a click wakes it). Never rest a tab with AI working or unsent changes, and never close a tab for the user. **PROPOSED** amendment (the plan otherwise refuses a 6th).
- Project states on Home: in a tab / this Mac only / not on this Mac yet. Shared role chips: Can edit / Can comment / Can view.
- Long Czech names: "Release plan · Combine 2026 (4 týdny)", "Arch 1 · vnějšek (str. 4 + str. 1) · A4 landscape, spadávka 3 mm". Rows truncate; `title` gives the full name.
- Viewing a past version: read-only; the mode switch shows Viewing.
- Empty search: shortcut list. No results: the CONTRACT "Nothing called …" line. Typo: the close-matches note.

### Keys / menu paths
- **Tabs:** ⌃Tab / ⌃⇧Tab; ⇧⌘] / ⇧⌘[; ⌘T new tab (Home); ⌘W close the project's tab; ⇧⌘\ Show All Tabs. **NOT ⌘1–9** (⌘0/⌘1 are zoom). ⇧⌘T stays Timeline, so a closed tab is reopened from Home or ⌘K.
- **Finding:** ⌘K; ⌘O Open project…; ⌥⌘H Version history; esc leaves the version view; ↵ / esc for inline rename.
- **Menu paths:** Menu › File › Move to…; Canvases › Advanced › Trash; Mac Window menu (Merge All Windows, Move Tab to New Window); Share › app link; Menu › Version history (top level).

### Classification summary
- **EXISTS → move/restyle:**
  - GitPanel History / DiffView → Version history ⌥⌘H
  - SyncPanel Trash → panel Trash row
  - Files tree drag/move/rename
  - DS section/SystemView → pinned DS row
  - CommandPalette → ⌘K
  - ShortcutsOverlay
  - OS notifications
  - Deep-link dialog
  - RepoBranchSwitcher recents and TeamProjects → Home Projects list
  - IdentityBar/CloudBar → the account chip
- **NEW:**
  - Native per-project window tabs (tabs plan)
  - Pill AI spark; account chip and card
  - Open-once
  - Resting tabs; relaunch restores all
  - Home at scale (pinned, shared with you, projects by account with state)
  - Empty-⌘K shortcut list and recent searches
  - Cross-project and artboard search with typo tolerance
  - Pins and sort; inline rename
  - Trash view with artboards; owner-only clear-out
  - Artboard jump list with camera glide
  - Version thumbnails, named versions, filters, compare in words, single-artboard restore
  - Stable canvas links with artboard anchors
  - Moved-folder / removed / Can view states
- **PROPOSED:** A vs B (recommend A); Home tab via ⌘T; open-once; resting past 5; relaunch restore; DS pinned row; Trash in Canvases › Advanced plus owner-only clear-out; Search grouped by project; Restore = whole canvas as a new version.

### Backend / native needs
- **Rust/Tauri (tabs plan T1–T14):**
  - One WebviewWindow per project with `tabbing_identifier`; window label = hash of root (enables open-once lookup).
  - Window menu items, ⌘T Home window on the app's own page, `switch_project` on the calling window.
  - Resting: stop the sidecar but keep the window, wake on focus with a quick spinner-less resume. Reap policy: never with AI running or unsent changes.
  - Restore all windows on relaunch (persist the tab list in `app-state.json`).
  - » overflow spike (T5). Native tab accessory spark (later).
- **Profiles:** `profiles.json`, a per-project binding, per-profile keychain slots, "Sign out of X" fanning out to every project on it, and an account chip fed from the profile.
- **Notifications:** per-project "AI is done / needs you" for non-focused windows (notify.rs: "displayed" = focused window).
- **Cross-project index** for Home and ⌘K: recents, pins, recent searches, open tabs with AI state, canvases and artboards of projects that are *closed or resting*, and "not on this Mac yet" cloud projects per account. This must live in the shell or a global store, not in one sidecar, and it is a security concern (the T14 cross-origin feed).
- **Pins:** per user, across projects (where stored: local prefs vs cloud).
- **"Shared with you":** a cloud API listing canvases from other people's projects, with your role and newness.
- **Search engine:** tokenised multi-word, accent folding, fuzzy/typo match, artboard labels, a tool/settings index with synonyms, recent searches persisted.
- **Version history:**
  - A snapshot per save/commit with a thumbnail render; author attribution (person vs AI, plus "from Tereza's ask").
  - Named versions (git tag or note).
  - Read-only time-travel render of a canvas.
  - **Semantic diff** per artboard and element in words (property old → new, with who and when).
  - Restore as a new version (never rewrite); restore of a single artboard.
  - The hub/cloud history equivalent (today: "History" in the cloud GitPanel).
- **Trash:** a trash store for canvases *and artboards*, with who and when, a restore-to-original-folder path, clear-out permanent deletion synced to everyone, and an owner-only permission check on the hub (roles today: owner/member/viewer).
- **Moved folder:** detect a missing root; "Find the folder…" via a native picker that rebinds the project (keep its id, profile and recents).
- **Access changes:** hub push of role change or removal; flush local changes *before* applying ("Your changes were saved first"); Ask to edit request to the owner (10).
- **Deep links:** stable canvas ids and slugs independent of path; artboard anchors; `maude://` routing to the right window (plan v1 delivers to the focused window only, so this needs per-window routing); comment open by id.
- **Sort and pins in the panel:** per-project UI prefs persisted (by project, not port: the plan's prefs-follow-port bug).

### Dependencies
- The tabs plan (`feature-desktop-project-tabs-and-identity-profiles.md`) is the native backbone.
- 13 Design System (the DS canvas). 10 Share and Collaboration (roles, Ask to edit, co-access-ends, share links). 06 Advanced (git under Version history › Advanced, Canvases › Advanced Trash, Diagnostics). 01 (Recent becomes a sort; ⌘K basics). 02 (accounts, Home).
- Kit: CanvasesPanel `system` row, SearchPalette (11 builds PnPalette with project groups and multi-word marks; a kit candidate), ShareCluster `access`/`canEdit`/`mode="viewing"`, ModeSwitch, Dialog, Toast, ProjectPill.

---

## Cross-cutting notes

### Contradictions to resolve
1. **The tab model splits the canvases.**
   - 01, 02 and the kit `Window` draw tabs with project-initial avatars, a Home tab, and syncing/local glyphs on the tab (Variant-B-like). CONTRACT §6 specifies the initial avatar and the tab menu.
   - 11 proposes Variant A (titles only). Then the §6 tab avatar, tab menu, the "laptop on the tab" of 02 `[ob-local-share]` and the sync glyph on the tab `[ob-local-moved]` cannot ship.
   - Local, syncing and account state must then live in the pill, the Share cluster and the status word.
   - Decide A/B first; then update CONTRACT §6 and the kit `Window`.
2. **The kit `ProjectMenu` lags CONTRACT §1.**
   - It is missing Edit › Undo history…, Copy / Paste properties ⌥⌘C / ⌥⌘V, and the View › "Hide panels / Show panels" toggle label.
   - Implement from CONTRACT, not the kit.
3. **The kit has a 5th save status, "Not saved"** (error), which is not in CONTRACT §6's four words. Decide whether it ships and what it says.
4. **The native File menu today binds ⌘N = New Project.** CONTRACT says the Mac menu bar is "untouched" while v2 ⌘N = New canvas and ⇧⌘N = New project…. The native menu must be rebound or the keys clash.
5. **Account scope.**
   - 11: the account is per project, bound on this Mac.
   - 02 `[ob-edge-accounts]` fine print: "To switch the whole app: Settings › General › Account". 02 Settings shows a single "You · Signed in" account.
   - Settings › General needs a multi-account design consistent with 11's account card.
6. **Index is stale.** It says "thirteen canvases" (01–13) and computes its totals from them, but 14 Editing and 15 Annotations exist. Update 00 or treat it as historical.
7. **New-canvas naming is inconsistent.**
   - ⌘N gives "Untitled canvas" `[cf-blank]` `[ob-local-first]`.
   - The offline ⌘N gives "Krpole-v-pohybu-2" `[cf-offline-create]` (derived from the previous canvas?).
   - Home creates "Landing page" / "Poster" (from the sentence).
   - Define the rule.
8. **Project naming from the sentence happens before AI is connected** `[ob-ai-connect]`. It cannot depend on AI; it needs a heuristic or a later rename.
9. **"Go back to 14:05"** `[cf-render-error]` vs Version history semantics (Restore = a new version, Now stays). Should the error-card action create a new version too? It probably should, for consistency.
10. **Trash location.** 11 places it as the panel's last row and in Canvases › Advanced; 01's Canvases panel shows no Trash row. The kit `CanvasesPanel` has no trash prop. It needs adding to the kit.
11. **Two Share surfaces.** 02 draws Share as a popover under the button with the Invite field. 10 owns the canonical Share sheet. Use 10's, with the local-project "Move to cloud" state added.
12. **The DS row meta "used by 3 projects"** (11) implies a cross-project shared system (13's "team library"). That is open question 13-new #4 and is unresolved.

### Ambiguities the implementer must decide
- When the auto-folded Canvases panel comes back after a selection `[cf-select-tweak]`. Is this tied to View › Advanced › "Open inspector on select"?
- Whether comment pins show in Edit or only in Preview `[cf-sticky-comment]`.
- Mode is per person `[cf-busy]`. Confirm it is local client state and never synced.
- Where Pins and Recent searches persist (local vs cloud, per account).
- Trial expiry behaviour; whether email sign-in is a magic link or a password.
- The » overflow in AppKit (T5 spike) and its fallback.
- Typo-tolerance threshold and ranking; how "quiet" weak matches are.
- "Restore only <artboard>": what happens to cross-artboard references and comments.

### Easy to forget
- Exact toast copy and **one action per toast**. Dialog titles use the primary button's verb ("Clear out the trash?" → Clear out; "Create a local project" → Create project; "Open the invite as …?" → Open).
- Accent-insensitive matching everywhere (the panel search, ⌘K, mark highlighting) using the shared `fold()` helper. Multi-word marks in meta lines.
- Counts in words ("1 canvas"/"5 canvases", "N results", "4 close matches"); tabular figures for zoom and counts; times as "6 Oct, 14:05".
- Ask AI is always the last ⌘K row (with ⌘↵); its text changes with the query ("find "x" by what it looks like").
- "Start with an empty canvas ⌘N" on every Home variant, including the scrolled sticky bar.
- The offline line "AI is back when this Mac is online." is shown in three places (empty canvas, Home ask foot, queued prompt).
- The Advanced fold at the foot of panels (Canvases, AI, Inspector, Version history) is quiet and closed by default. Mono or technical text appears only inside Advanced.
- Reduced motion for every camera glide, spring and draft choreography: the order is kept and the motion is removed.
- ⌘Z undoes an entire AI draft or run as **one** step.
- After the redesign, ⌘K must find every relocated Advanced item by name ("hub", "figma", "api key", "billing", "print guides", "New artboard — A4").
- Every "old door" in `[ob-settings]` must stay reachable. Use it as the acceptance checklist for onboarding removal.
- Home's target-project chip is a picker. On a team Home its default is the team project.
- Running AI marks: the canvas-row spark (with the working words as tooltip), the pill spark (A), the AI icon dot when folded, and the Mac notification when the tab isn't focused.
- Crash recovery and a full disk are undrawn (00 known issues). Plan placeholders for them.
