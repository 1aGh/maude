# design-critic: 03 AI Chat, stage B (V2-8.5)

_2026-10-22 · board `.design/ui/v2/03 AI Chat.tsx` (+ `03 AI Chat.css`, `_kit.css`, DS `maude-v2`) · pairs `.claude/worktrees/agent-a45b4750975bd8337/.scr/pairs/03-ai-chat/` (58 read; panel crops made 1:1 from the full-size pairs) · opt_out: palette_

**Lens:** layout, spacing, sizes, typography, colour and tokens, material, iconography, and every state the board draws (working, waiting, needs-you, failed, result, empty, connect).
**The question:** is it really built like this? I am not judging whether it looks nice.

**What doesn't count as a finding:** INDEX C1-C5 (title bar, tabs, left-panel default, Share cluster faces, artwork and camera) and harness limits H: the generic working words, no second person, Version history saying "changed outside the app", the done ring and the Made-by-AI tag not firing because the fake agent never writes a `project:action`, and the missing "Always for this canvas" box (the fake agent offers no `allow_always`). C6 (the chip says `post`, not "Post 1:1") is a copy finding, so I only point to it here.

**Already being fixed (C0, named once and not repeated below):** the shell still runs on v1 tokens and v1 buttons. That covers the periwinkle primary and send fills in dark, the v1 `.btn` sizes, the island material on the corner icon and the panel body, and the native toasts.

**Severity:** a **blocker** means the impl is visibly different from the board, a state is missing, or a token is used in the wrong role. A **warning** means the structure is the same and only a value drifted (radius, height, glyph).
**Themes:** each row applies to **both** themes unless it says dark or light. The light pairs flip the same tokens. I found no theme-only drift.

---

## Root causes (hit several artboards; per-artboard rows reference them)

| # | root cause | spec | impl | owner |
|---|---|---|---|---|
| R1 | **The transcript still uses the v1 chat recipe.** The user's turn sits flush left on bg-3 with a 1 px border at 12 px. The AI reply has no bubble and runs 12 px fg-1, which breaks CONTRACT §5 ("AI chat replies: --type-base (14), never 12"). A v1 mono uppercase "✦ AI" role label sits above every reply. Tool calls render as mono bordered cards ("Edit the canvas"). | `.k-ai-msg` 8/12 px padding, radius-md, `--type-base`, fg-0 (`_kit.css:340`). `--you` is flex-end, max 86 %, bg-4, no border (`:342`). `--ai` is bg-3 (`:341`). There is no role label. Tool steps live only behind "What AI did" (`Steps`). | v1 `chat-msg*` | `styles/6-acp-chat.css:441-461` (bubbles), `:427-436` + `v2/ai/Feed.jsx:343-348` (role label), `v2/ai/Feed.jsx:110-128` + `styles/6-acp-chat.css:720-732` (tool card) |
| R2 | **The composer is the v1 box, not the one-row `.ask`.** It is a textarea (min 54 px) plus a toolbar, about 95 px tall. The well is bg-3 with radius 6 and a 1 px border. The scope chip sits on its own row **above** the field. The send button is radius-sm, and when empty it fades to `opacity .45` instead of the DS disabled look. A 1 px border-top divides the composer from the feed. | `.ask` (`_components.css:132`): one row about 36 px, radius-lg (14), bg-2, 0.5 px inset border. Order inside the field: 📎 · `◆ chip--accent` · text · send (`03 AI Chat.tsx:198-209`). Send is 28 px radius-md (`_components.css:143`). Disabled is bg-3/fg-3 (`:229`). There is no divider. | v1 `chat-box` | `styles/6-acp-chat.css:1187-1191, 1238-1263, 1333-1354`, `v2/ai/Composer.jsx:524-566` (chip outside `.chat-box`) |
| R3 | **The field disappears while a turn runs.** `ThreadPrimitive.If running={false}` hides the chip and the field, and nothing is left under the working line, the waiting card or an open question. | Every running, waiting or needs-you board keeps `Composer` (chip + "Ask AI…") under the card (`ai-working`, `ai-two-artboards`, `ai-same-artboard`, `ai-question`, `ai-permission`). | field missing | `v2/ai/Composer.jsx:518` |
| R4 | **The header is a v1 mix.** The spark is azure. A v1 status dot (green when idle, vermilion when busy) sits before the title, which is followed by a text caret "▾". The title isn't in the rounded face. The count chip is azure and bordered. Hide uses chevron-right. | `.k-ai-hd` spark is `--spark` (`_kit.css:322`). The title is `--font-rounded`, type-sm, semibold, with a 12 px chevron icon in fg-2 (`:355-357`). There is no dot. `.k-ai-count` is spark glyph + fg-0 number + chevron (`:358-360`). Hide is the chevron glyph (`03 AI Chat.tsx:268`). | v1 trigger | `styles/6-acp-chat.css:1816-1819` (accent), `:1840-1856` (count), `panels/ChatPanel.jsx:895-899` (chat-dot + ▾), `styles/6-acp-chat.css:202-214`, `panels/chat-header.jsx:62` |
| R5 | **Panel geometry.** The island is about 288 px wide (304 px slot). Its height is a fixed `--ai-h` 460 px rather than hugging the content. Short chats leave a large empty gap, and long ones clip the earlier bubble under the header (ai-hero, ai-done). The long and pinned states keep the narrow width. | The chat panel is 340 px (`_kit.css:352`) and hugs its content up to `max-height: calc(100% - 96px)` (`:321`). Big and pinned are 420 px (`03 AI Chat.css:483`). | 288 / 460 fixed | `hooks/use-shell-core.jsx:341` (def 304), `v2/shell/floating-panels.css:123-127` (`--ai-h` 460px) |
| R6 | **Canvas ring model.** A needs-you ask on a whole-canvas scope tags **every** artboard "Waiting for you". The done ring has a sweep line but no Before / After pills. There is no "point" ring kind at all. The ring CSS copies oklch literals instead of tokens. That copy is justified (the canvas iframe has no host tokens) but it has to track `colors_and_type.css` by hand. | The needs ring goes only on what will change (one group ring + one tag, `Uniformy ring`, `03 AI Chat.tsx:496`). The done state is a solid ring plus wipe with **Before / After** labels (`Wipe`, `03 AI Chat.css` `.ai-wipe-lab`). The point state is a small spark ring with a value tag (`.ai-ring--point`). | | `artboard-activity-overlay.tsx:94` (`AiRingState` has no `point`), `:156-160` (sweep, no labels), `:104-128` (literals); `v2/ai/runs-model.js:226-236` (needs-you per artboard) |
| R7 | **Inline cards (needs-you) are drawn as "the azure one".** The permission and choice cards carry an inset 1 px **accent** ring (2 px when focused). Their leading glyph is the **Spark**, not the help "?". | `.ai-card` has an inset 1 px `--border-default` (`03 AI Chat.css:17`). `.ai-card-ic--ask` uses `Icon name="help"` (`03 AI Chat.tsx:119, 134`). | | `v2/ai/needs-you.css:41-47`, `v2/ai/ChoiceCard.jsx:113`, `v2/ai/PermissionCard.jsx:71` |
| R8 | **The empty state is v1 `.chat-empty`.** It is centred vertically and horizontally, with a bold 14 px fg-0 title and a 12 px sub-line. | `.ai-hint` is one left-aligned paragraph at type-sm fg-2 with 4 px padding (`03 AI Chat.css:4`), directly above the suggestion strip. | | `styles/6-acp-chat.css:319-341`, `v2/ai/Suggest.jsx:18-31` |

---

## Per artboard (dark = light unless a row says otherwise)

### ai-hero
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-hero | both | The done wipe has no Before / After pills. The ring and Made-by-AI tag not firing is harness (H). | `Wipe` with `.ai-wipe-lab--b/--a` pills | sweep line only, no labels | `artboard-activity-overlay.tsx:156-160` | blocker |
| ai-hero | both | The AI result has no bubble. | `.k-ai-msg--ai` bg-3 bubble | plain 14 px text (`.ai-result-line`) | `v2/ai/ai-run.css:70-75` | blocker |
| ai-hero | both | The suggestion chips sit in the composer zone below a divider, not inside the result block. The chip style is a bordered bg-2 at 24 px. | the `Result` block holds the 2 follow-ups as `.chip` (22 px, bg-3, no border) | `.ai-chip` 24 px, 1 px border, bg-2 | `v2/ai/ai.css:160-188`, `v2/ai/Suggest.jsx:89` | warning |
| ai-hero | both | The Undo / Keep going chips are pills 28 px tall, and the Keep-going spark is fg-1. | `.chip.ai-act` 22 px, radius-sm, spark glyph in `--spark` (`03 AI Chat.css:14-16`) | radius-pill, 28 px, glyph fg-1 | `v2/ai/ai-run.css:110-126, 144-146` | warning |
| ai-hero | both | Header R4, composer R2, geometry R5 (the earlier user bubble is clipped under the header). | | | see R2/R4/R5 | blocker |
| ai-hero | both | The folder consent card and attach chips in the same panel aren't shown in this frame. Not driven: `Consent` exists in `v2/ai/Consent.jsx` and is placed above the field (`Composer.jsx:535`) rather than in the transcript as the spec draws it. | consent card in the feed above the field | consent card above the field | `v2/ai/Composer.jsx:535-537` | warning |

### ai-open
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-open | both | Empty state R8: a centred bold title instead of the quiet left-aligned hint. | `.ai-hint` type-sm fg-2 | `.chat-empty` centred, 14 px semibold fg-0 | `styles/6-acp-chat.css:319-341` | blocker |
| ai-open | both | The suggestion strip is missing on the empty chat, and so is the lead chip's context glyph (the comment pin "T"). | 3 chips + why line + lead glyph (`Suggest`, `03 AI Chat.tsx:244-253`) | none (the strip only derives after a run, and the glyph moved to the why line) | `v2/ai/suggest-why.js` (derivation), `v2/ai/Suggest.jsx:85-119` (glyph on the why line, not the lead chip) | blocker |
| ai-open | both | The panel is a tall fixed island (about 315 px) with empty space, where the spec hugs its content at about 190 px. | content-hug | `--ai-h` 460 | R5 | blocker |
| ai-open | both | Selecting the artboard opens no Inspector card next to the panel. | `Inspector` "Post 1:1 · Combine 2026 / Artboard" | none | inspector-follow (`v2/shell/inspector-follow.js`); belongs to 08 too | warning |
| ai-open | both | Composer R2 (the chip is above the field), header R4. | | | R2/R4 | blocker |

### ai-suggest
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-suggest | both | Only the last-ask context is reachable. Comments-open, clips-selected and just-shared aren't driven (harness), although `deriveSuggestions` has them. | 4 contexts | 1 | `v2/ai/suggest-why.js` | warning |
| ai-suggest | both | The why line is `--fg-3` (the disabled role) on running text. | `.ai-why` fg-2 (`03 AI Chat.css:451`) | `color: var(--fg-3, var(--fg-2))` | `v2/ai/ai.css:194-201` | blocker |
| ai-suggest | both | The lead chip has no context glyph and no bg-2 / strong-border emphasis. The glyph sits on the why line instead. | `.ai-sugg-lead` (`03 AI Chat.css:449-450`) | every chip is the same `.ai-chip` | `v2/ai/Suggest.jsx:89-104` | warning |
| ai-suggest | both | The chips are 24 px with a 1 px border on bg-2. | `.chip.k-sugg` 22 px, bg-3, no border | `.ai-chip` | `v2/ai/ai.css:166-188` | warning |

### ai-scope
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-scope | both | The menu has no "Choose artboards…" row, though it is in the model comment. | 4 rows + separator | 3 rows | `v2/ai/scope.js:233` / `v2/ai/ScopeChip.jsx:150-215` | blocker |
| ai-scope | both | The tick is a text "✓" (`.ai-scope-check` is a font glyph) and the rows are short and tight. | kit `Menu` row with the check icon, 28 px rows | text ✓, about 26 px rows | `v2/ai/ai.css:140-152` | warning |
| ai-scope | both | The chip is outside the field, and the remove "×" sits outside the chip (R2). | the chip lives inside `.ask` | separate row | `v2/ai/Composer.jsx:524-533` | blocker |
| ai-scope | both | The folded corner (spark in an island with an "Ask AI ⌘/" tooltip) and the multi-artboard count chip aren't driven. | | | corner R-hidden (see ai-panel-closed) | warning |

### ai-working
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-working | both | R1: a v1 "✦ AI" role label, a mono "Edit the canvas" tool card and interim 12 px prose sit above the working line. | only the user bubble, then the working line | 3 extra v1 blocks | R1 | blocker |
| ai-working | both | R3: the composer is gone while it runs, leaving about 200 px of empty panel. | Composer under the working line | none | `v2/ai/Composer.jsx:518` | blocker |
| ai-working | both | The user bubble is flush left at 12 px (R1). | flex-end, 14 px, bg-4 | flex-start, 12 px, bg-3 + border | R1 | blocker |
| ai-working | both | The working line matches: spark-muted fill, spark-text, Stop ghost-sm, step on a second line. | `.k-ai-working` | `.ai-working` | `v2/ai/ai-run.css:7-48` | verified |
| ai-working | both | The canvas ring and tag match: dashed spark ring, vermilion tag with dark ink. | kit `aiWorking` | `.dc-ai-ring[data-state=running]` | | verified |

### ai-done
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-done | both | The result line has no bubble (R1). | bg-3 bubble | plain text | `v2/ai/ai-run.css:70-75` | blocker |
| ai-done | both | An extra "What AI did · 1 step · 4 s" fold appears under a short result. ai-done doesn't draw it; ai-long does. | none on the short result | `.ai-fold` | `v2/ai/Result.jsx:110-125` | warning |
| ai-done | both | The follow-ups sit in the composer zone instead of the result block (as on ai-hero). | in `Result` | below the divider | `v2/ai/Suggest.jsx` mount | warning |
| ai-done | both | The wipe has no Before / After pills (R6). | `.ai-wipe-lab` | none | `artboard-activity-overlay.tsx:156-160` | blocker |
| ai-done | both | Act chips are pill-shaped and the Keep-going spark is fg-1. | `.ai-act` + spark | | `v2/ai/ai-run.css:110-146` | warning |
| ai-done | light | Same as dark. The send button shows the v1 fade (C0/R2). | | | R2 | (counted in R2) |

### ai-attach
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-attach | both | **The image chip collapses to about 30×6 px** (a sliver with ×) instead of a 40×40 thumbnail. Probable cause: `.ai-ask-chips-wrap` shrinks inside the `overflow:hidden` flex column `.chat-box`. The same sliver shows on ai-advanced. | `.ai-ach--img` 40×40, radius-md | collapsed | `v2/ai/attach.css:55-60` (no `flex: none`), `styles/6-acp-chat.css:1238-1247` | blocker |
| ai-attach | both | The drop overlay, footage chip and PDF chip aren't driven (harness), though `DropOverlay.jsx` and `AChip` exist. | | | | warning |
| ai-attach | both | The panel shows the empty-state title above an attached field (R8) and R2 geometry. | | | R2/R8 | blocker |

### ai-attach-menu
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-attach-menu | both | The rows, order and ⌘V key match. "Or drag files here" uses a download-arrow glyph instead of `insert`. | `icon: "insert"` (`03 AI Chat.tsx:221`) | download glyph | `v2/ai/AttachMenu.jsx` | warning |
| ai-attach-menu | both | The paperclip doesn't show the pressed state while the menu is open. | `.k-pressed` on `.ai-clip` | no pressed fill | `v2/ai/AttachMenu.jsx` | warning |
| ai-attach-menu | both | The menu covers the field's top edge rather than sitting above it. | menu bottom-anchored above `.ask` | overlaps the field | `v2/ai/attach.css` menu anchor | warning |

### ai-question
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-question | both | **The point ring is missing.** It's the small spark ring with the "9 pt" tag on the date line, and the board's answer-in-words state needs it. `AiRingState` has no `point`. | `.ai-ring--point` + `.ai-ring-tag--point` | not implemented | `artboard-activity-overlay.tsx:94` | blocker |
| ai-question | both | The follow-up chips under a prose answer don't show. `ai-followups` exists in `Result.jsx:127`, but there's no follow-up row after a plain answer (see ai-long). | 2 chips under the answer | none | `v2/ai/Result.jsx:127-140` / `v2/ai/Feed.jsx` text path | blocker |
| ai-question | both | The choice card (board 25 content) is ringed in azure and leads with a Spark (R7). | neutral border, help "?" | 1-2 px accent ring, spark | R7 | warning |
| ai-question | both | Every artboard carries "Waiting for you" while a question is open (R6). | no canvas ring for a question | 5 tags | `v2/ai/runs-model.js:226-236` | blocker |
| ai-question | both | R3: no composer while the question waits. | Composer | none | `v2/ai/Composer.jsx:518` | blocker |

### ai-long
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-long | both | At full height the panel stays about 288 px wide instead of 420 px. | `.ai-big` 420 (`03 AI Chat.css:483`) | 288 | R5 | blocker |
| ai-long | both | No "Yesterday, 18:20" day divider, no sent-attachment thumbs (`Sent` 56 px) and no Before / After pair in the result (`.ai-ba` exists, not driven). | `Divider`, `YouWith`, `.ai-sent-img` | text-only | `v2/ai/Feed.jsx` (DayDivider exists, `:307`) | warning |
| ai-long | both | No edge-resize affordance: no 2 px accent line, grip or tooltip on hover. | `.ai-resize*` (`03 AI Chat.css:490-494`) | v1 `.st-grip` without the accent line or tooltip | `v2/shell/floating-panels.css:154-166` | warning |
| ai-long | both | R1 in a long feed: a role label on each reply, user bubbles flush left. | | | R1 | blocker |
| ai-long | both | The "Jump to latest · N new" pill isn't driven (it exists at `v2/ai/BigChat.jsx:120`, styled at `ai-run.css:226-255`, and matches the spec values). | | | | warning |

### ai-long-pinned
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-long-pinned | both | **When pinned, the left Canvases panel collapses** to its header, search and Trash, with an empty list. | spec folds the left panel to its icon; when it's open the list stays | collapsed body (layout bug) | `v2/shell/floating-panels.css:139-141` (`display: contents` on the pinned inner) | blocker |
| ai-long-pinned | both | The Share cluster and the top-right settings icon stay over the pinned column's header. The spec moves the cluster left of the column. | the cluster ends at the column edge | it overlaps the column header | `v2/shell/share-cluster.css` / pinned layout | blocker |
| ai-long-pinned | both | The pinned column is 288 px, not 420 px, and the canvas does not re-fit into the remaining area. | 420, re-fit | 288, no re-fit | R5, `hooks/use-shell-core.jsx:341` | blocker |
| ai-long-pinned | both | The pin button's pressed state matches (bg-3). | | | `v2/ai/ai-run.css:262-265` | verified |

### ai-two-artboards
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-two-artboards | both | The ✦ N run-list popover isn't driven (the harness clicked the title). `RunList.jsx` exists. | `.k-ai-runs` popover with Working rows | the chat list | | warning |
| ai-two-artboards | both | R1/R3: a tool card plus role label, and no composer. | | | R1/R3 | blocker |
| ai-two-artboards | both | Both canvas rings and tags match the spec shape (verbs are H). | | | | verified |

### ai-same-artboard
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-same-artboard | both | **The waiting chat also shows an "AI is working · 0:04" line** above its own Waiting card. The queued chat reads as running. | only the Waiting card (clock icon) | working line + Waiting card | `v2/ai/RunSurface.jsx` / `v2/ai/Working.jsx:33` (shown for a queued run) | blocker |
| ai-same-artboard | both | The Waiting card matches: bg-2, inset border, clock disc, ×, "Run on a copy" btn-sm. The detail is 12 px, as in the spec's `--meta`. | `.ai-card.ai-wait` | `.ai-wait` | `v2/ai/runs.css:149-` | verified |
| ai-same-artboard | both | R3: no composer. The card is pushed to the panel foot with an empty gap above it (R5). | | | R3/R5 | blocker |

### ai-copy
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-copy | both | **There's no "Copied from … before …" caption** under the copy, and no dashed link from the original. | `.ai-copy-from` + `.ai-copy-link` (`03 AI Chat.css`) | none (only the feed divider "Ran on a copy …") | canvas side; `v2/ai/run-model.js:245-251` is feed-only | blocker |
| ai-copy | both | The copy lands at about 20 px from the Story artboard, and its label collides with the Story frame. | right beside the original, on the same row | below Story, touching | copy placement (run-on-copy action) | warning |
| ai-copy | both | The "Ran on a copy" divider matches `.ai-mark` (11 px fg-2 centred). | | | `v2/ai/runs.css:44` | verified |
| ai-copy | both | R1/R3 apply. | | | | blocker |

### ai-chat-list
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-chat-list | both | **The list nests under the chat header.** "New chat ⌄ ✦3 + pin >" stays above the "‹ Chats" header, where the spec's list replaces the panel and has its own single header. | one header `ai-cl-hd` | two headers | `panels/ChatPanel.jsx:875-916` | blocker |
| ai-chat-list | both | The row state is an 8 px dot instead of the 22 px `AIRunIcon` disc (spark-muted + spark; help for needs; idle spark). | `k-ai-sst` 22 px disc (`_kit.css:329-332`, `_kit.tsx:962-965`) | 8 px dot | `v2/ai/ChatList.jsx:45-47`, `v2/ai/ai-list-advanced.css:172-187` | blocker |
| ai-chat-list | both | The rows aren't indented under a canvas group, and the "Earlier" group with canvas thumbs isn't driven. | `.ai-cl-row` padding-left 24 px, `ai-cl-canvas` with thumb | flat | `v2/ai/ai-list-advanced.css` rows | warning |
| ai-chat-list | both | The title, the "Alligators brand" chip, search, the "Running 3" count and the footer type match. | | | | verified |

### ai-panel-closed
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-panel-closed | both | **The folded spark is neutral (fg) with an azure busy dot.** The spec draws a vermilion spark with a `--presence-agent` dot. | `.k-iconbtn--ai` spark + `.k-ai-dot` presence-agent (`_kit.css:274-279`) | fg glyph, `--accent` dot | `v2/shell/floating-panels.css:198-207`, `v2/shell/corner-icons.jsx:38-54` | blocker |
| ai-panel-closed | both | The busy fold has no breathing spark-muted halo. | `.ai-fold-busy` box-shadow 2 px spark-muted | none | `v2/shell/corner-icons.jsx` | warning |
| ai-panel-closed | both | The "Done … Show" pill toast isn't in the frame (another chat finished). It uses the v1 notification card (see ai-needs-hidden). | | | | warning |

### ai-quit
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-quit | both | **The dialog has no inner padding.** The title, body and buttons touch the card edge. | `.k-dialog` padding 24, radius-xl, bg-2, 0.5 px island edge (`_kit.css:629-646`) | `.gi-dialog` (bg-1, 1 px border, radius-lg, **no padding**) + `.ai-quit-dialog` width only | `v2/ai/quit.css:4-6`, `styles/3-shell-maude.css:7870-7881` | blocker |
| ai-quit | both | The title is type-md 600 (matches), and the body is 14 px where the spec uses `--type-sm` 12. | `.k-dialog-b` type-sm | inherits 14 | `v2/ai/quit.css:12-15` | warning |
| ai-quit | both | The "next launch" half (Stopped divider + "half done" + Undo / Keep going) isn't driven. `StoppedDivider.jsx` and `.ai-stopped*` exist. | | | | warning |

### ai-needs-hidden
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-needs-hidden | both | **The needs-you toast is a v1 notification card**: two text lines, Open on a third line, a close ×, and anchored to the bottom-right instead of centred over the toolbar. | one-line island pill: help glyph · text · **Open** (azure text), centred, one action (CONTRACT §4) | multi-line card + × | `apps/studio/notifications.tsx` (renderer), `v2/ai/needs-you-toast.js:32-50` | blocker |
| ai-needs-hidden | both | Every artboard is tagged "Waiting for you" (R6). | the one affected canvas/artboard | 5 tags | `v2/ai/runs-model.js:226-236` | blocker |
| ai-needs-hidden | both | The folded spark's azure ring and count badge match `FoldNeeds`, but the glyph is neutral, not spark. | spark glyph | fg glyph | `v2/shell/corner-icons.jsx` | warning |
| ai-needs-hidden | both | The canvas row's "Needs you" in accent-text semibold matches. | | | | verified |

### ai-permission
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-permission | both | **No strip of what will change**: the 4 thumbnails plus their names are missing. | `PERM_DETAIL` `.ai-perm-list` 28×22 thumbs (`03 AI Chat.tsx:500-505`) | detail text only | `v2/ai/PermissionCard.jsx:102-106` | blocker |
| ai-permission | both | The card is azure-ringed with a Spark glyph (R7). | neutral border, help "?" | accent ring, spark | R7 | warning |
| ai-permission | both | One group ring with one tag goes only on what changes. The impl tags every artboard (R6). Also missing: the "will change" pills on the affected artboards. | `Ring kind=needs` + `.ai-will` | per-artboard tags, no pills | R6 | blocker |
| ai-permission | both | R3: no composer under the card. | | | R3 | blocker |

### ai-choice-fail
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-choice-fail | both | The choice rows have no colour swatch disc (18 px) and no hint line. The picked row has no accent ring state. | `.ai-sw--*`, `.ai-opt-h`, `aria-current` ring (`03 AI Chat.css:34-45`) | label only | `v2/ai/ChoiceCard.jsx:120-133` | blocker |
| ai-choice-fail | both | The failure card carries an extra "› Advanced" fold inside it. The spec has a detail paragraph and one verb. | `Problem` = title · detail · one verb | title · Advanced fold · verb | `v2/ai/ProblemCard.jsx:26-35` | warning |
| ai-choice-fail | both | The problem glyph, its disc and the error-text colour match. | | | | verified |

### ai-not-ready
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-not-ready | both | **The connect sheet is clipped inside the panel.** "Your prompt waits here…" is cut off, and **Cancel / Connect are not visible** at 1440×900. | the sheet floats as its own card (radius-xl, 24 px padding) over or next to the panel, with its buttons in view | inline, clipped (`.ai-conn-sheet--inline`) | `v2/ai/needs-you.css:389-410`, `v2/ai/ConnectSheet.jsx` | blocker |
| ai-not-ready | both | The suggestion strip still renders under the sheet (the `:has` hide doesn't apply in this layout), and so does the scope chip. | nothing but the sheet + field | strip + chip | `v2/ai/needs-you.css:16-18` | blocker |
| ai-not-ready | both | The sent prompt "Three Story variants" isn't shown as a user bubble with "Queued — sends when…". | `You` + `.ai-state` line | not shown | `v2/ai/NotReady.jsx` | warning |
| ai-not-ready | both | The offline, setting-up, used-up and almost-used-up panels aren't reachable. Product work: a network-offline and quota fixture for the ACP lane (the `NotReady.jsx` QueuedState exists). | 5 panels | 1 | harness + `v2/ai/NotReady.jsx` | warning |

### ai-advanced
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-advanced | both | The selects are native `<select>` with the OS chevron and no appearance reset. The value "Replace or move to the trash" overflows and pushes "default" onto its own line. | kit `InSelect`: 30 px, bg-3, chevron icon, value + grey mode name on one line | native select at 62 % width | `v2/ai/ai-list-advanced.css:463-473`, `v2/ai/Advanced.jsx:43-60` | blocker |
| ai-advanced | both | The fold is cut by the panel height (no scroll to Raw log / Copy transcript / Open in terminal). | Advanced opens inside a scrolling panel | clipped | R5 | blocker |
| ai-advanced | both | The image-chip sliver bug shows again in the field (see ai-attach). | | | `v2/ai/attach.css:55-60` | (counted in ai-attach) |
| ai-advanced | both | Model / Effort / Fast mode / This chat meters aren't shown because the fake agent has no config (H). | | | | n/a |

### ai-adv-edges
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-adv-edges | both | The slash menu's command names are **azure** mono with the description run inline. | `.ai-slashup .k-mi-lab` mono 11 px fg-0, description right-aligned fg-2 | `--accent` names, inline descriptions | `styles/6-acp-chat.css:1588-1593` | warning |
| ai-adv-edges | both | The slash menu overlays the empty-state title, which stays visible behind it and clipped (R8). | the menu sits above the field over an empty feed | overlaps "Ask for a change…" | R8 | warning |
| ai-adv-edges | both | The Ask-before list (with grey mode names), the Suggest-only banner and Copy / Retry on hover aren't driven. `.chat-msg-actions` has Copy only, with no Retry. | Copy + Retry + tooltip (`Says hover`) | Copy only | `v2/ai/Feed.jsx:316-325` | blocker |

### ai-history
| id | theme | difference | spec | impl | owner | severity |
|---|---|---|---|---|---|---|
| ai-history | both | The Version history segment shows 4 tabs as plain text (All · Named · Made by AI · People) instead of the 3-option `.seg`. | `.seg` All / Made by AI / People | text tabs, + Named | `v2/history/` (canvas 04/V2-1.9 owner) | warning |
| ai-history | both | Version history and the AI panel stack in the right column. The spec shows Version history alone at the top right, 320 px. | `.ai-vh` 320, top 68 | 288, stacked with the chat | R5 / right-slot layout | warning |
| ai-history | both | Made-by-AI rows, "Undo this chat / Restore" and the Compare bar are harness (H: no `project:action`). | | | | n/a |

### Not reachable (findings: the state does not exist in the browser lane yet)
| id | theme | difference | what makes it reachable | severity |
|---|---|---|---|---|
| ai-queue-rule | both | A documentation graphic, not an app surface. | none needed (the rule is exercised by ai-same-artboard and ai-copy) | n/a |
| ai-other-tab | both | The project tab's breathing spark mark and the cross-tab "Done … Show" toast. | A desktop e2e scenario with two project tabs (V2-3.7 own tab strip) plus tab state marks driven from the other tab's run registry. No tab-mark code turned up for `ai-tab`/`tabmark` in the client. | blocker |
| ai-tereza | both | Another person's AI: her avatar inside the spark tag, and the "Your / On this canvas" split in the run list. | A two-peer cloud harness (hub). `runs-model.js:226-236` already derives `${name}'s AI` tags, but the avatar-in-tag and the list split need verifying. | blocker |
| ai-needs-tab | both | The tab mark turns into an azure "?". | Same as ai-other-tab (two project tabs). | blocker |
| ai-needs-away | both | The macOS notification and the Dock badge. | A native-only desktop e2e that checks the notification payload and the badge count. | warning |

---

## Verdict

```json
{
  "canvas": "03 AI Chat",
  "critic": "design-critic",
  "blockers": 49,
  "warnings": 37,
  "verified_ids": [],
  "notes": "Counts are unique (artboard x difference) rows; theme 'both' = 1. No artboard x theme is free of differences in this lens; sub-checks that DID match are marked 'verified' inline (working line, canvas running ring, waiting card, ran-on-a-copy divider, chat-list header/search/foot, pin pressed state, problem glyph, Needs-you canvas row).",
  "opt_out_applied": "palette",
  "ds_blockers_downgraded": 0,
  "passed": false
}
```
