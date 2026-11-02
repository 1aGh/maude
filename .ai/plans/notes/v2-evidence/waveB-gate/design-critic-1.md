# design-critic — wave-B gate, part 1 of 2 (canvases 01 · 02 · 05 · 06 · 07)

_2026-10-21 · read-only review · opt_out_scope: palette (full DS enforcement) · evidence: `.claude/worktrees/agent-a5de2e4530a4c4c05/.ai/plans/notes/v2-evidence/waveB-gate/shots/` (branch `gate-b-shots`, base `feat/maude-v2` 0ac68fb3d, release-built client, Playwright Chromium 1600×1000 with a `window.__TAURI__` stub, **dark and light**). 116 frames read for these five canvases (dark at full size, light as 2×2 contact sheets with zoomed crops where something looked off). The Tauri lane was not shot._

Same method as the wave-A gate. Spec: `.design/ui/v2/{01,02,05,06,07}*.tsx` + `.css`, `_kit.css`, `_video.css`, `.design/system/maude-v2/{README, CONTRACT §1–§7, colors_and_type.css, preview/_components.css}`. I did not render the canvases (no server booted), so "what the canvas draws" comes from canvas source. Source lines in `apps/studio/**` are from the checkout at 6fc8cacb0, which is newer than the shots' base. A fix that landed between the two is not in these pictures, and a cited line may have moved a little.

## TL;DR

| Area | Canvas | Score | Blockers | Gate (≥ 4.0, 0 blockers) |
| --- | --- | --- | --- | --- |
| Create flow | 01 | **3.6** | 5 | fail |
| Onboarding | 02 | **3.5** | 4 | fail |
| Empty states | 05 | **3.6** | 5 | fail |
| Advanced | 06 | **3.7** | 5 | fail |
| Video editing | 07 | **3.1** | 8 | fail |

**Blockers: 27 on the five canvases, 19 distinct · Warnings: 31 · Verdict: fix-and-retry.**

The v2 shell is right: the project pill and the one menu (CONTRACT §1, word for word), the Canvases panel, ⌘K with "where it lives" paths, the Home question, the exact empty-state lines, the Trash words and the Diagnostics status words. Light theme matches dark almost everywhere. What fails the gate:
- **sheets and panels that render in mono** (Share, Export, Exports, the ⌘K empty block);
- **the v1 AI "not ready" diagnostic** where CONTRACT §7 wants a normal panel plus one Connect sheet;
- **v1 surfaces that were never replaced**: the comment composer, Settings › General, the first-run tour, the sequence-lane timeline.

07 has four layout and legibility defects of its own. Six root causes cover 15 of the 27 blockers.

### Root causes worth fixing once (they hit several canvases)

- **RC-A · v2 surfaces inherit v1 type and tokens.** The Share sheet (`v2/share/share.css:13` `.v2sh-sheet`), the Export sheet (`v2/export/export.css`), the Exports panel (`v2/export/exports-panel.css`) and the ⌘K empty block set no `font-family`, so they pick up the mono face of the v1 ancestor they are mounted under. In the palette the Empty block's `.es-sit` asks for `var(--font-rounded)` (`v2/empty/empty.css:64-73`), but that token doesn't exist in the v1 palette's scope, so the declaration falls back to the mono parent. The same scope split explains the near-black clip names on navy in dark: the v1 lane `.tl-seq-name` uses `var(--fg-0)` (`styles/3-shell-maude.css:6391-6400`) and gets the v1 ink, not the v2 dark value. It hits 02, 05, 06 and 07, and very likely 09 and 10 in part 2. **Fix:** give every v2 sheet and panel root `font-family: var(--font-body)`, and mount v2 surfaces inside the `.maude-v2` token scope (one wrapper) rather than under v1 hosts.
- **RC-B · the inspector's "Uses <system>" link is unreadable.** It renders as a saturated azure bar with grey text: about 2.4:1 in dark, about 3.4:1 in light. It appears in every inspector frame (`v2/ds/uses-link.jsx:29-42`, `v2/inspector/inspector.css:93-108`) and hits 01, 06 and 07. The CSS asks for `--accent-muted` + `--accent-text`, so something in the cascade overrides it. **Fix:** make sure the token pair wins. CONTRACT §7 also says this should read as a quiet link.
- **RC-C · the v1 `NotConnected` AI panel.** It says "AI editing isn't ready yet. Claude Code is installed, but Maude couldn't read its sign-in state… Claude Code (the \`claude\` CLI)" and has trust rows: "Maude never sees your credentials", "Never metered API billing" (`panels/ChatPanel.jsx:119-150`). CONTRACT §7: "Ask AI looks the same as always. The first time it's used, one sheet asks to connect…". The sheet exists already (`v2/onboarding/ConnectAiSheet.jsx`, `v2/ai/ConnectSheet.jsx`) but the panel doesn't use it. It hits 01, 02, 05 and 06, names the app and the CLI, and fills the AI panel so its Advanced fold can't show (06).
- **RC-D · AI send buttons are filled vermilion.** CONTRACT §7: "send / Ask AI buttons are azure with a white spark glyph… vermilion fills only for AI presence". The DS has it right (`preview/_components.css:143` `.ask .send { background: var(--accent) }`). The build gets it wrong in `client/home/home.css:985-994` (`.home-ask-send`) and `client/v2/create/empty-project.css:52-62` (`.ep-ask-send`). It hits 01 (and 02/05 once a prompt is typed).
- **RC-E · dead classes and controls without a size.** This continues wave-A RC2/RC3. `.insp-ro` has no rule anywhere, so the video inspector's values render at about 15 px (`v2/inspector/kinds/artboard-video.jsx:28-48`, 07). The "Found on your PATH" line in AI setup renders at about 15 px too (06). From source only: `.tl-inout` is 9 px at weight 700 (`v2/timeline/timeline.css:166-174`), which is off the ladder and above 600.
- **RC-F · v1 strings that name the tool, the app or a design board.** "a 60-second tour of the canvas browser" (02), "Maude Cloud", "while Maude is closed", "Bright/Dim shell chrome", "How the CSS panel labels controls" (02, 06), "You · changed outside Maude" (05), "Claude Code (the \`claude\` CLI)" with literal backticks (01, 02, 05, 06), and "the link shows on the canvas… — as in 04 Modes." (07). CONTRACT §4: the app never names itself in running copy, and a design board is never named in the product.

Still showing from wave A (not counted again): annotation section labels and text annotations draw in mono ("Seed section", "Standalone seed" on every Smoke frame; wave-A RC1 / 15-B2). The Preview toolbar is the small monochrome strip.

---

## 01 Create Flow — 3.6

Layers: Task 4.5 (Home's one question, ⌘N, F, ⌘K are all obvious) · IA 4 · States 3 (render-error card good, but fit-to-view runs under the toolbar and the composer is v1) · Interaction 3.5 · Microcopy 4 (the CONTRACT lines are exact) · Parity dark↔light 4 · A11y 3.

**Blockers**
1. **[ds-accent]** `cf-home-typed`, `cf-home-target`: the Home send button turns solid vermilion once text is typed. CONTRACT §7 and DS `.ask .send` say azure with a white spark. `client/home/home.css:985-994`. (RC-D) Fix: `background: var(--accent); color: var(--accent-fg)`.
2. **[ds-aesthetic]** `cf-home-target` (both themes, zoom crop): the "starts a new canvas in…" menu is see-through, and "A portfolio page" reads through it. README: "frosted (~88 % opaque, never peek-through)". The menu (`.island.home-target-menu`, `home.css:1052`) is nested inside the backdrop-filtered `.home-ask-card` (`home.css:942`), so its own frost can't sample what's behind the card. Fix: render the menu outside the card (a portal) or give it `--island-bg-strong`.
3. **[a11y · contrast]** `cf-select-tweak`: the "Uses project" bar is about 2.4:1 (dark) and about 3.4:1 (light). (RC-B)
4. **[ds-typography · ds-aesthetic]** `cf-sticky-comment`: the comment composer is v1. Header "NEW COMMENT" is mono uppercase with a raw id `cd:566b4b33`. Buttons "CANCEL / SAVE" are mono uppercase. The panel is square (2 px) and near-black, with hex fallbacks. `client/comments-overlay.tsx:1455-1495`, `client/comments-overlay.css:88-163`. Canvas 10 owns the v2 composer, so part 2 will hit this too.
5. **[ux · microcopy]** `cf-ai-panel`: the AI panel shows the v1 not-ready diagnostic. (RC-C)

**Warnings**
- **[ux]** `cf-open-big`: ⌘0 doesn't keep the window's chrome clear. The last row of the 21 artboards sits under the toolbar (y ≈ 940–977).
- **[ux · ds-accent]** `cf-panel-search`: every hit carries an azure-marked folder chip ("campaign"), 16 × 2 azure marks. 01 puts the folder in the quiet sub line and marks only the matched words. The search field shows two clear buttons (a bold ✖ and ×), and a clipped "Project…" line peeks under the foot.
- **[ia]** Kind chips include a zero chip ("▯ 0"), which filters to nothing.
- **[microcopy]** `cf-render-error`: "Its code stops halfway on line 3." is developer detail in the default view (01: "The last change has a mistake the canvas can't show"; the technical part only under Show details). "Go back to 14:05" is missing. The fixture may have no good version, so verify.
- **[ux]** The selection tag "div · 480 × 258" covers the artboard name (only "…DER" shows).
- **[ux]** ⌘K canvas rows show a document glyph, not the canvas picture (01: "Canvases come first, with pictures").
- **[ds]** Inspector colour reads `rgb(17, 17, 17)`, a raw value where 01 draws a token name ("Ink"). Native `<select>` chevrons on Width/Height/Size (wave-A warning, still there).
- **[ux]** Share looks disabled whenever no canvas is open (`cf-big-tree`, `cf-panel-search`). A project can still be shared.

Not reached (from INDEX): ai: `cf-ai-drafting`, `cf-ai-done`, `cf-undo-before`, `cf-undo-ai` · hub: `cf-busy` · desktop/offline: `cf-offline-create` · not shot: `cf-duplicate-width`, `cf-duplicate-done`, `cf-frames-text`. `cf-status-words` shows only "Local project" (one word of four). `cf-add-artboard` shows 08's size picker rather than 01's preset list; that is accepted, because 08 is the later spec.

## 02 Onboarding — 3.5

Layers: Task 4.5 (`ob-first-launch` matches 02: question, prompt, the cloud card, "Advanced options ›") · IA 4.5 (the project menu matches CONTRACT §1 exactly) · States 3 · Interaction 4 · Microcopy 2.5 · Parity 4 · A11y 4.

**Blockers**
1. **[ux · microcopy]** `ob-ai-connect`: 02 draws a ready panel and one sheet at first send ("Connect your Claude account to let AI draft this." → Connect, Cancel). The build shows the v1 diagnostic, which names "Claude Code", "the \`claude\` CLI" and "Maude". (RC-C)
2. **[ux · microcopy]** Every in-project first-run frame (`ob-adv-open`, `ob-first-canvas`, `ob-local-share`, `ob-project-menu`, `ob-edge-whats-new`) carries a top callout: "New here? Take a 60-second tour of the canvas browser. [Start]". 02 says "no wizard, no card, no tour", and the tour lives at Menu › Help › Take the tour. "Canvas browser" is a v1 name, and the callout uses the spark glyph for something that isn't AI. `client/v2/shell/callouts-model.js:265-285`.
3. **[ds-typography]** `ob-local-share`: the Share sheet is entirely mono: title, "Move "e2e-fixture" to the cloud?", body, "Only need a file? Menu › Export…". The title "Share Smoke.tsx" shows a file name with its extension (`v2/share/share-model.js:126` uses `target.label`). The words match 02 exactly; the face doesn't. (RC-A)
4. **[microcopy · ds]** `ob-settings`: Settings › General is the v1 panel. "Maude Cloud", "a mention while Maude is closed", "Light / Bright shell chrome", "Dark / Dim shell chrome" (and no Auto), "Inspector vocabulary — How the CSS panel labels controls" with "Advanced · Raw CSS property names" selected, and a "Done" button. 02 draws Account (You · Plan · Manage on cloud.maude.sh · the five links) plus Look (Light · Dark · Auto). `client/panels/SettingsPanel.jsx:1158-1230`. 06 says the vocabulary switch became the inspector's Advanced fold.

**Warnings**
- **[ux]** `ob-edge-whats-new`: a callout card in the project reads "What's new — Fixed-size artboards keep their full height… no longer loses its bottom 24 px to the label…" (engineering wording), stacked with the tour callout. 02: Home shows one quiet line once, and Menu › Help keeps the dot.
- **[ds-accent]** Both callouts ("You're in Edit", What's new) carry a solid azure left stripe. Azure is for acting, and this is decoration.
- **[ux]** `ob-adv-open` shows Canvases › Advanced, not 02's Home "Advanced options" list beside the card. 02's artboard is not evidenced.
- **[ux]** `ob-first-canvas` has no counterpart artboard in 02 (closest: `ob-local-first`). The mode hint "You're in Edit — Click selects. Switch to Preview (top right)…" is fine.

Not reached: hub `ob-signin-browser`, `ob-home-new`, `ob-invite-page`, `ob-invite-landed`, `ob-home-team`, `ob-local-moved`, `ob-edge-timeout`, `ob-edge-other-mac`, `ob-edge-accounts` · ai `ob-first-draw`, `ob-sig-draw`, `ob-edge-ai-missing` · desktop `ob-local-name`, `ob-local-first`, `ob-edge-offline` · not shot `ob-adv-sheets`.

## 05 Empty States — 3.6

Layers: Task 4 · IA 3.5 · States 3 · Interaction 4 · Microcopy 4.5 · Parity 3 (light stuck on Opening) · A11y 4.

The strong part is the copy: "Your canvas is ready. Ask AI for a first draft, or start drawing." (CONTRACT §6 exactly, with Ask AI ⌘/ and New artboard as 05 draws), "Nothing called "zzzz". Try another word, or ask AI to find it.", "Searched 1 canvas and its artboards", "Trash is empty… until you clear them out.", and Comments teaching "Press C" in the sentence.

**Blockers**
1. **[ux · states]** `es-project-new`: the panel side is right ("No canvases yet.", New canvas, "Folders appear when you make one."), but the canvas centre is blank. 05 draws "Portfolio 2026 has no canvases yet. Describe the first one and AI drafts it — or start blank." with the prompt and "Start with an empty canvas ⌘N". `client/v2/create/empty-project.jsx` exists but isn't on screen (`use-project-empty.js` gating).
2. **[ds · microcopy]** `es-search-panel`, `es-artboard-new`: under the no-hit message, panel search lists "Project · No matches." and "Runtime files 6 · No matches." That is developer chrome in the default view. `client/tree/tree.jsx:748-754` (`SECTION_META`). The v2 filter (`v2/canvases/tree-model.js:41` `canvasGroups`) isn't applied on the search path.
3. **[ds-typography]** `es-search-k`: "Nothing called "pricng". Try another word, or ask AI to find it." renders in mono inside ⌘K. `es-panels-make-exports`: "Exports / No exports yet. / Every export of this project lands here…" is all mono. (RC-A)
4. **[ux · states]** Light run, `es-canvas-ai-light` and `es-panels-canvas-light`: a new empty canvas is stuck on "Opening Untitled canvas… Still working — large canvases take a moment to build." The hint only shows after 4 s (`client/shell/viewport.jsx:326-352`), so this is not a capture race. "Large… build" is also the wrong sentence for an empty canvas. Hold this blocker until a repro clears it (memory: "a shell stuck on Opening…" was real before).
5. **[ux · microcopy]** `es-ai-panel` (and the AI half of `es-panels-make`): the not-ready diagnostic where 05 draws Pricing-specific chips and a normal panel. (RC-C)

**Warnings**
- **[ux · microcopy]** `es-history`: 05 wants "nothing to restore, so no button". The build lists "Changed this canvas · 15:52 · You · changed outside Maud…" for a canvas made in the app with ⌘K. It names the app, the wording is wrong and it is truncated. The lone "+" corner button overlaps the history foot ("Branch, git, changed fi…").
- **[ds]** The Comments panel is a full-height column for an empty state (README: "no full-height sidebars by default").
- **[ds-objects]** The empty-canvas spot is monochrome outlines. 05's spot has the three object-coloured stickies that land on the spring.
- **[ux]** `es-artboard-new` doesn't show 05's state: no on-artboard hint, no Layers, no inspector. A previous step's panel search ("zzzz") and Version history are still open. Re-shoot.
- **[ux]** `es-search-more`: the fixture has 0 assets, so the "247 assets, none match" state isn't evidenced (the frame shows the no-assets drop zone, which is correct for 0).
- **[ux]** Share looks disabled with no canvas open (`es-project-new`, `es-panels-make-*`).

Not reached: hub `es-home-cloud`, `es-home-shared`, `es-viewer`, `es-arriving`, `es-edge-panels` · desktop `es-offline-uncached` · not shot `es-landing`, `es-canvas-three`, `es-timeline`, `es-filter`, `es-all-trashed`. `es-home-local` is the same frame as `ob-first-launch`. 05 draws a compact Home without the cloud card for this case, but 02's first launch is the more specific spec, so I don't count it against 05.

## 06 Advanced — 3.7

Layers: Task 4 (⌘K "advanced" lists the hidden tools, each with its path: "Menu › Diagnostics › Advanced", "AI chat panel › Advanced", "Timeline › Advanced") · IA 4 · States 3.5 · Interaction 3.5 · Microcopy 3.5 · Parity 4 · A11y 3.5.

The Diagnostics views are close to 06's Logs, Server and AI-setup islands: source filters, Refresh / Copy all / Show in Finder, the status words "Running", "Needs setup" and "Local project", and Copy on every value. Canvases › Advanced has the switches, the folder with Copy, "Trash · Empty · Open" and "10 of 10 shown · updated just now · Refresh". Mono is used only where 06 allows it.

**Blockers**
1. **[ds-typography]** `ad-export`: the whole Export sheet is mono, front and back: title "Export "Smoke" — 1 artboard", Scope, Format, Size, Annotations. Only the Advanced "same export from a terminal" commands may be mono. (RC-A) Also hits 07 and 09.
2. **[ds-typography]** `ad-share`: Share › Advanced labels are mono ("Other ways in", "App link", "Opens the folder on this Mac only.", "Invite by GitHub username"). The links in the inputs may be mono; the labels and the sheet front must be sans. Same fix as 02-B3. (RC-A)
3. **[microcopy · ds]** `ad-settings`: the frame shows the v1 General tab (02-B4). 06's board is Settings › Advanced (This Mac, Claude Code, Decision memory, Engines, Privacy, This project, Experimental, Reset); it is not shot, so it is not evidenced.
4. **[a11y · contrast]** `ad-inspector`: "Uses project" bar. (RC-B)
5. **[ux · microcopy]** `ad-ai`: the AI panel's Advanced is open, but no rows are visible. The not-ready diagnostic fills the panel, so Model / Effort / Ask before can't be seen, although ⌘K points to "AI chat panel › Advanced". (RC-C) Re-shoot scrolled, or with the diagnostic gone.

**Warnings**
- **[ds-tokens]** Light theme: the Canvases › Advanced switch thumbs are black (`v2/left-panel/left-panel.css:467-475` uses `--fg-0`). The DS switch thumb is `--bg-2` + `--shadow-sm` (`preview/_components.css` `.switch::after`).
- **[ux]** The Canvases › Advanced foot wraps to two lines ("• 10 of 10 shown" / "· updated just now"). 06 widens the panel to 300 px when the fold is open; the build stays at 236 px.
- **[ds-status]** Logs: stderr warnings ("[acp-adapter]… Warning…", "[maude:github] no token…") are drawn in error red. 06 draws warn lines in the warn colour. The CSS is right (`v2/diagnostics/diagnostics.css:295-299`); the level mapping is wrong.
- **[microcopy]** AI setup: "Re-check" and "Check again" do the same thing on one panel. Literal backticks in "(the \`claude\` CLI)". "Maude ran \`claude auth status --json\`…" names the app (light frame). "Found on your PATH:" renders at about 15 px. (RC-E)
- **[ux]** ⌘K: the group header "Actions 43 hidden tools" disagrees with "18 results". Every row has the same chevron tile instead of the tool's icon. "code" fuzzy-matches "Fast mode" and "Model".
- **[ux]** Export › Advanced: the "Colour profile" label wraps to two lines (label column too narrow). "Background" is a native `<select>`.
- **[ux]** Not evidenced although a frame was taken: `ad-diag` (the Menu › Diagnostics submenu; the frame shows the Server view instead), `ad-inspector`'s Advanced rows (below the panel's fold), `ad-code` (⌘K row only).

Not shot: `ad-map`, `ad-why`, `ad-trace`, `ad-timeline`, `ad-history`, `ad-ds` (ds-board), `ad-menus`, `ad-pinned`, `ad-open-all`, `ad-edge-*`.

## 07 Video Editing — 3.1

Layers: Task 3.5 (selecting a video artboard brings the timeline out of its bottom edge with the notch) · IA 3 · States 3 (the "Missing — no device has it / Relink…" state is as designed) · Interaction 2.5 · Microcopy 3.5 · Parity 4 · A11y 2.5.

**Blockers**
1. **[a11y · contrast]** `ve-cut`, `ve-music`, `ve-trim-split`, `ve-reframe` (dark): clip names inside the timeline blocks are near-black on navy, about 1.3:1, and read as black bars (zoom crop). This is the v1 lane renderer: `.tl-seq-name` in mono at 10 px, `color: var(--fg-0)` resolving to v1 ink (`styles/3-shell-maude.css:6391-6400`). (RC-A) Light is legible.
2. **[ux · interaction]** `ve-select`, `ve-captions`, `ve-trim-split`: with the inspector open, the timeline runs under it. Expand, ×, the zoom slider's end and the "Frames, keyframes, the cut…" foot are hidden. `client/v2/timeline/anchor.js:20-26` clamps to `viewportW` and ignores the right panel. Fix: clamp to the free canvas rect.
3. **[ux · ia]** Track model. CONTRACT §6 [C35] and 07 `ve-select`: "Four tracks, top covers bottom: text, graphics, video, music." `ve-cut`, `ve-music` and `ve-trim-split` show v1 per-sequence lanes ("beat-…", "oslava", "logo", "title", "song.mp3", mono, ƒ glyphs), with a three-beat `TransitionSeries` drawn as a staircase across three lanes. `ve-captions` does show Text / Graphics / Video headers, so the build has two models. `client/v2/timeline/Timeline.jsx:896-912` (band projection) and the v1 lanes.
4. **[ux]** `ve-fullscreen` (both themes): the full-screen video is cropped. The frame starts at x = 160 and stops at x = 1440 with no right border, in a 1600 window. A white outline sits round it, and none of the chrome `video-present.jsx` describes (format switch, "esc Back to the canvas", transport) is on screen. If the chrome hides when idle, the crop is still a defect. `client/v2/present/video-present.jsx`, `video-present.css`.
5. **[microcopy]** `ve-trim-split`, `ve-reframe` clip inspector: "Preview plays it; the link shows on the canvas while this is selected — as in 04 Modes." names a design board (`client/v2/inspector/sections/interaction.jsx:191`). It also says "This object has no id yet. Edit element id… gives it one." and "Give this object an id first (Advanced › Element id).", and offers PNG · 2× / SVG export presets for a timeline clip. 07 draws the clip inspector as Fit / Fill / Reframe, Length and Speed. (RC-F)
6. **[ds-typography]** Video artboard inspector: "0:01", "0:00", "None yet" render at about 15 px beside 12 px rows. `.insp-ro` has no rule anywhere (`client/v2/inspector/kinds/artboard-video.jsx:28-48`). (RC-E)
7. **[ds-typography]** `ve-export`: the export sheet is mono, as in 06-B1. (RC-A)
8. **[a11y · contrast]** "Uses project" in every video inspector frame. (RC-B)

**Warnings**
- **[ux]** `ve-none`: the label reads "Clip · 320×180" without the length. 07: "Its length rides on the label". VideoFormats does show "Recap · Reels · 0:03", so the two are inconsistent.
- **[microcopy]** "No clips on clip yet." (the template `No clips on {artboard} yet.`, `v2/empty/empty-copy.js:144`, fed a lower-cased artboard name). The readout says "0:00 / 0:00" on a 0:01 artboard. The Formats chip has an empty name ("· this one") on `ve-select`.
- **[ds-typography]** The ruler, the timecodes, the "0.00s" playhead tag and the track labels are mono. 07 keeps mono for Advanced only (`07 Video Editing.css:3`, `_video.css:103` `.ve-tick--mono` is the Advanced ruler).
- **[microcopy]** `ve-export`: "Sound · Music, mixed as on the timeline" for an artboard whose Sound is "None yet". The range ticks read "0:00 0:00 0:01 0:01 0:01".
- **[ux]** These were reached but don't show their state: `ve-formats` (one unselected artboard, not three linked formats), `ve-reframe` (generic clip inspector, no 9:16 window), `ve-captions` (no transcript strike, no caption style in the inspector), `ve-play` (no loop range or frame step), `ve-music` (beat marks and "120 BPM", but no ducking line, volume or Snap to the beat).
- **[ds-typography]** From source: `.tl-inout` uses 9 px at weight 700 (`v2/timeline/timeline.css:166-174`). (RC-E)

Not reached: media `ve-drop`, `ve-footage`, `ve-render`, `ve-fit-fill`, `ve-long`, `ve-advanced` · ai `ve-ai-cut`, `ve-ai-watch`, `ve-ai-scrub`, `ve-ai-proposal`, `ve-ai-adjust` · hub `ve-together` · not shot (timeline clicks timed out) `ve-move-transition`, `ve-transition`, `ve-text`; `ve-trim-split` shot as the artboard only.

---

## Pass B quick scan (all five)
- **Hardcoded values:** the new `v2/*` CSS is on tokens (`--space-*`, `--type-*`, `--radius-*`). The exceptions are the v1 surfaces still on screen (`comments-overlay.css:88-163` with hex fallbacks and `border-radius: 2px`; v1 lanes at 10 px), `timeline.css:166-174` (9 px / 700) and, outside these canvases, `v2/present/order-notes.css:19` (`border-radius: 14px`).
- **Type roles:** the Home question, panel titles and empty-state lines are right (rounded where 05 says). RC-A mono leaks in sheets, palette and lanes. RC-E has sizes with no rule.
- **Surfaces and radii:** islands, controls and chips are on the ladder. One frost failure (the Home target menu).
- **Icons:** line, monochrome. The spark is misused once (the tour callout). No emoji.
- **Status:** Missing / Running / Needs setup / Local project are paired with words. Log warnings are drawn red (warning only).
- **Accent:** one solid azure per surface mostly holds. Exceptions: decorative callout stripes and the azure marks in panel search. Vermilion send (RC-D) is a blocker.
- **Hard stops:** glass pass · gradient pass · pastel pass · neumorphism pass · 3D pass · mascot pass.
- **Motion:** can't be judged from stills.

## Verdict

```json
{
  "agent": "design-critic",
  "iter": 1,
  "gate": "wave-B part 1",
  "scores": { "01-create-flow": 3.6, "02-onboarding": 3.5, "05-empty-states": 3.6, "06-advanced": 3.7, "07-video-editing": 3.1 },
  "gate_bar": 4.0,
  "areas_passing": [],
  "blockers": 27,
  "blockers_distinct": 19,
  "warnings": 31,
  "top_blockers": [
    { "category": "ds-typography", "area": "02,05,06,07", "file": "apps/studio/client/v2/share/share.css:13 + v2/export/export.css + v2/export/exports-panel.css + v2/empty/empty.css:64", "summary": "RC-A: Share/Export sheets, Exports panel and the ⌘K empty block render in mono (no font-family; v2 tokens undefined under the v1 host)", "fix": "font-family: var(--font-body) on every v2 sheet/panel root; mount v2 surfaces inside the .maude-v2 token scope." },
    { "category": "ux", "area": "01,02,05,06", "file": "apps/studio/client/panels/ChatPanel.jsx:119", "summary": "RC-C: v1 'AI editing isn't ready yet… Claude Code (the `claude` CLI)' panel instead of CONTRACT §7's normal panel + one Connect sheet", "fix": "Panel looks as always; first send opens v2/ai/ConnectSheet; diagnostic moves to Menu › Diagnostics › AI setup." },
    { "category": "a11y", "area": "01,06,07", "file": "apps/studio/client/v2/ds/uses-link.jsx:29 + v2/inspector/inspector.css:93", "summary": "RC-B: 'Uses project' link ~2.4:1 dark / ~3.4:1 light", "fix": "Make --accent-muted bg + --accent-text win (or a quiet text link)." },
    { "category": "ds-accent", "area": "01", "file": "apps/studio/client/home/home.css:985 + v2/create/empty-project.css:52", "summary": "RC-D: AI send buttons filled vermilion", "fix": "Azure fill, white spark (DS .ask .send, CONTRACT §7)." },
    { "category": "ds-aesthetic", "area": "01", "file": "apps/studio/client/home/home.css:1052", "summary": "Home target menu is see-through (nested inside the backdrop-filtered ask card)", "fix": "Portal the menu out of the card or use --island-bg-strong." },
    { "category": "ds-typography", "area": "01 (+10)", "file": "apps/studio/client/comments-overlay.css:88-163", "summary": "v1 comment composer: mono caps, raw id cd:…, 2px radius, hex fallbacks", "fix": "Replace with the v2 composer (canvas 10)." },
    { "category": "ux", "area": "02", "file": "apps/studio/client/v2/shell/callouts-model.js:265", "summary": "First-run tour callout 'canvas browser' on every first-run frame; 02 says no tour", "fix": "Drop the offer; tour stays in Menu › Help." },
    { "category": "microcopy", "area": "02,06", "file": "apps/studio/client/panels/SettingsPanel.jsx:1158-1230", "summary": "Settings › General is v1: 'Maude Cloud', 'shell chrome', CSS vocabulary in General, no Auto", "fix": "Build 02 ob-settings General (Account + Look: Light · Dark · Auto)." },
    { "category": "ux", "area": "05", "file": "apps/studio/client/v2/create/empty-project.jsx", "summary": "Empty project: canvas centre blank, no prompt / ⌘N way out", "fix": "Mount the empty-project block (05 es-project-new)." },
    { "category": "ds", "area": "05", "file": "apps/studio/client/tree/tree.jsx:748", "summary": "Panel search shows 'Project' and 'Runtime files 6' groups", "fix": "Apply canvasGroups() on the search path." },
    { "category": "ux", "area": "05", "file": "apps/studio/client/shell/viewport.jsx:326", "summary": "Light run: new empty canvas stuck on 'Opening… large canvases take a moment to build' (>4 s, 2 frames)", "fix": "Repro; clear only on a re-shot frame." },
    { "category": "a11y", "area": "07", "file": "apps/studio/client/styles/3-shell-maude.css:6391", "summary": "Timeline clip names near-black on navy in dark (~1.3:1), v1 lane renderer", "fix": "v2 lane with v2 tokens; sans --type-xs." },
    { "category": "ux", "area": "07", "file": "apps/studio/client/v2/timeline/anchor.js:20-26", "summary": "Timeline clamps to the window and runs under the inspector (Expand, × hidden)", "fix": "Clamp to the free canvas rect." },
    { "category": "ia", "area": "07", "file": "apps/studio/client/v2/timeline/Timeline.jsx:896", "summary": "Per-sequence lanes ('beat-…') instead of Text · Graphics · Video · Music (C35); two models in one build", "fix": "One track model per CONTRACT §6." },
    { "category": "ux", "area": "07", "file": "apps/studio/client/v2/present/video-present.jsx", "summary": "Full-screen video cropped at x=1440, white outline, no chrome visible", "fix": "Fit to the real viewport; show the format switch / esc / transport." },
    { "category": "microcopy", "area": "07", "file": "apps/studio/client/v2/inspector/sections/interaction.jsx:191", "summary": "Clip inspector copy says 'as in 04 Modes' and offers PNG/SVG presets for a clip", "fix": "Clip inspector per 07 (Fit/Fill/Reframe, Length, Speed); drop the board reference." },
    { "category": "ds-typography", "area": "07", "file": "apps/studio/client/v2/inspector/kinds/artboard-video.jsx:28-48", "summary": "RC-E: .insp-ro has no rule; values ~15px", "fix": "Add .insp-ro { font-size: var(--type-sm) }." }
  ],
  "root_causes": ["RC-A v2 surfaces inherit v1 mono/tokens", "RC-B Uses-link contrast", "RC-C v1 NotConnected AI panel", "RC-D vermilion send", "RC-E dead classes / unsized controls", "RC-F v1 strings naming app/tool/board"],
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
