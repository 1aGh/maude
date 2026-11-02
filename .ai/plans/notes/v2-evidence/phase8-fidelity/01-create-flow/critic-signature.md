# signature-moment-critic — 01 Create Flow (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/01 Create Flow.tsx` · impl = release v2 client (stage-A frames, `full-size-path.txt`) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 3.0/5** · Specificity: pass (with 2 raw-string findings) · Verdict: **fix-and-retry**

Two of the board's moments come through almost unchanged. **Home's question** keeps the spark, "What shall we make?", the prompt card with the target chip, the starters and "Start with an empty canvas ⌘N". The **empty canvas** keeps the spot art and "Your canvas is ready.". The moment the board is built around does not: **AI drafting in the open**. The lane shows no dashed spark outline round the artboard being drawn, no ghost where the next one lands, no "AI is drawing Tablet" tag and no "Made by AI" in the label row. A whole Desktop page appears at once. Behind that:

- The ring layer exists but needs run leases a whole-canvas draft never takes.
- The ring tag wording is fixed to "AI is working".
- Nothing in the code produces the ghost.

The render-error card has the right words, but it lost its anchor, the dimmed last good picture with "Go back to 14:05". A live syntax break still shows the v1 Czech dev bar. "The copy lands in line" lost its 144 px accent measure. The result toast offers Show where the board offers Undo.

Dark: the board is drawn light only (INDEX). The dark impl re-themes cleanly and repeats every light finding. One dark-only warning: the ink "dark hero" artboard loses its edge on the dark canvas (cf-undo-before).

Not findings (fixture / lane, per INDEX "Systematic differences"): no native window chrome or tab strip, no bottom-left zoom chip (off by default), "Local project" + YO in place of "Saved" + faces, fixture names and flat covers in place of Studio site / Alligators data, and the agent's own sentences (the fake ACP agent writes "Drafting the landing page…" and a tool titled "Edit the canvas").

## Per artboard (a "both" row counts once per theme in the totals)

### cf-home-prompt — the signature: Home's one question
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Spark, question, sub-line, prompt card + "Starts a new canvas in Studio site" chip, ↵ to send, three starters, "Start with an empty canvas ⌘N" | `_kit` `Home` | match | `client/home/HomeAsk.jsx:113` | verified (element) |
| both | Home sits on a flat surface, not the canvas dot field | `<Canvas>` (dots) under `Home` | `--canvas-bg`, no dots | `client/home/home.css:18` | warning (the boards disagree: 11 `pn-home` uses `Canvas dots={false}`) |
| both | No "Recent projects" row of fanned cover stacks + dashed "Open project… Any folder works" tile. Replaced by a Shared-with-you ghost shelf + a Projects list, side by side | Home `projects` row | two-column shelves | `client/home/home-app.jsx:927`, `client/home/Shelves.jsx:145` | warning (the impl follows 11 `pn-home`; 01/02/05 draw the row) |
| both | Top right is a wide "Search canvases and artboards… ⌘K" field, not the compact search button | icon + ⌘K island | 300 px field | `client/home/home-app.jsx:1350` | warning |
| both | The Home pill has no chevron (no Home menu; see 02 ob-edge-whats-new) | "Home ⌄" | "Home" | `client/home/home-app.jsx` (pill) | warning |

### cf-ai-drafting — the signature: AI drafts in the open
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No dashed spark outline on the artboard being drawn | `Artboard aiWorking` → 1.5 px dashed `--spark` ring round Tablet | none | ring layer `apps/studio/artboard-activity-overlay.tsx:129`, fed by `client/v2/ai/runs-model.js:205-219`. It draws only the run's `leases`, and a whole-canvas draft held none | blocker |
| both | The ring tag would not name the piece | "AI is drawing Tablet" | fixed `TAG_WORKING` "AI is working" | `client/v2/ai/runs-model.js:175`, `:216` | blocker |
| both | No ghost where the next artboard lands | dashed spark ghost 109 × 236 + "✦ Mobile — next" | nothing. No producer exists (`artboard-ghosts-overlay.tsx` draws trashed boards only) | new: run progress → ghost rect (canvas-lib world layer) | blocker |
| both | No "Made by AI" on the finished Desktop | spark "Made by AI" right of the label | none | `client/v2/ai/made-by-ai.js` + overlay `:147`. It fires on `project:action` with artboards. The fake agent's direct file write produced none: **unproven in the lane** | blocker |
| both | The whole page appears at once (no piece-by-piece) | Desktop done, Tablet half-drawn (headline cut, CTA grey) | Desktop complete at +3.5 s, Tablet complete at +10 s | agent-paced (no choreography layer, see 02 ob-sig-draw) | warning |
| both | Camera zoomed onto the first artboard | fit, 28 %, all three in view | ~70 % on Desktop | `client/v2/create/first-draft.js` (opens; no fit after the draft) | warning |
| both | Panel working line "AI is working · Edit the canvas · 0:03" | "AI is drawing Tablet · Desktop done · Mobile next" | — | `run.doing` comes from the agent (`client/v2/ai/run-model.js:62`) | not-a-finding (agent text) |
| both | Canvases row "Untitled canvas · AI is working" | spark + "AI is drawing" | close | `client/v2/canvases/canvases-panel.jsx` | verified (element) |

### cf-ai-done — the result, in one line
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "Made by AI" tags on Desktop / Tablet / Mobile | three tags in the label rows | none | as cf-ai-drafting (`made-by-ai.js`) | blocker |
| both | The toast's one action is Show, not Undo, and it is a bordered card with ×, not the spark pill | "✦ Done — … on the canvas. **Undo**" pill | card with a left rule, "Show", × | `client/v2/ai/needs-you-toast.js:65-68` (`doneNotice`) | blocker |
| both | Toast text is the agent's first sentence | — | "Drafting the landing page…" | `needs-you-toast.js:59` quotes the reply | not-a-finding (fake agent) |

### cf-select-tweak — the view makes room
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The inspector arrives as a full-height column of every section, not the compact card (Preset · Size · Fill · Corners · Clip · Export) | floating card 6 rows | Position / Size / Layout / Fill / Border / Effects / Type… | `client/v2/inspector/sections.js` | blocker |
| both | The Canvases panel did not fold when the inspector arrived | panel folds to its corner icon | stayed open (folded by hand) | `client/v2/shell/inspector-follow.js:28-36` (`createCanvasesFold`) | blocker |
| both | The canvas does not slide | slides left | — | deliberately not built (`inspector-follow.js:22`, I1) | warning (decided gap) |
| both | The click selects the page div, label "div · 1440 × 996" | artboard selected, "Desktop 1280 × 900" | element | selection layer | warning |

### cf-sticky-comment
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No colour-dot row above the Sticky tool | five swatches over the Preview toolbar | full annotate toolbar, no swatch row | `client/v2/annotations` toolbar | warning |
| both | Tereza's bubble, written stickies | — | own empty sticky + compose | needs a second person | not-a-finding (lane) |

### cf-undo-before
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "Made by AI" on the changed Desktop | tag | none | `made-by-ai.js` | blocker |
| dark | The ink hero artboard loses its edge on the dark canvas | edge visible | edge lost | artboard frame stroke (canvas-lib) | warning |

### cf-undo-ai — not reachable
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | ⌘Z / palette Undo do not revert the AI edit. No "Undone — the dark hero by AI · Redo" toast | toast + light hero back | dark hero stays | The undo projection reads `project:action` (`client/app.jsx:859`), and a direct file write gave none. **Product work:** attribute the agent's file writes as an `ai` action (or route them through edit-op) | blocker |

### cf-blank
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Spot art + "Your canvas is ready." + Ask AI ⌘/ | — | match | `client/v2/empty/empty-canvas.jsx` | verified (element) |
| both | A second button, "New artboard" | Ask AI only | Ask AI + New artboard | `empty-canvas.jsx:9` (W7) | not-a-finding (05 `es-canvas-ai` draws both: the boards disagree) |

### cf-add-artboard
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | F opens the size-picker panel + dashed size ghost. The board draws the artboard landed, with a Preset list in the compact inspector | landed artboard + Preset dropdown | picker + ghost | `client/v2/kinds/SizePicker.jsx` | warning (08 `ak-picker` is the newer spec of this moment) |

### cf-duplicate-width
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The submenu shows sizes as "Laptop — 1280", not a name with the number right-aligned | "Laptop  1280" | inline | `apps/studio/editing/artboard-menu.tsx` | warning |

### cf-duplicate-done — the copy lands in line
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The copy lands right of Mobile. No 144 px gap measure in the accent | under Desktop, left edges aligned, accent "144" tag | right of the row, no measure | `apps/studio/editing/duplicate-rhythm.ts:1-14` (rightward by rule) | blocker (14 Editing says "to the right": the boards disagree, but the measure tag is missing either way) |
| both | The toast is the bordered card with Undo below the text, not the pill | pill "⧉ Duplicated at Laptop — 1280 wide. Undo" | card + × | shell toast (kind success) | warning |

### cf-frames-text
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No "Hero copy · frame" tag under the text selection, no compact Type card | accent frame tag + 5-row card | full Type column | `client/v2/inspector/sections.js` | warning |

### cf-big-tree
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Opening a project shows the v1 "No canvas open — Start quick setup" card | the last canvas open (Combine-kampan) | v1 card | `client/shell/viewport.jsx:167-178` | blocker |
| both | Tree thumbnails blank | covers | grey squares | — | not-a-finding (fixture has no covers) |

### cf-panel-search / cf-search-k
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (panel) | Results stay in the tree with inline marks. No flat list with a second line | flat list + "folder · matching artboard" | tree + chips | `client/v2/canvases/canvases-panel.jsx` | warning |
| both (⌘K) | Only a Canvases section. No "Tools and settings — not on screen" or "Ask AI" row for this query | three sections | one | ⌘K model (`client/v2/search`) | warning |

### cf-open-big
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | ⌘0 clips the last row. No "Zoom to fit · 10 %" read-out. Panels did not hide, and no "Panels hidden" toast | fit + toast | clipped, panel open | fit maths (canvas-lib); toast words exist `client/v2/shell/panel-layout.js:16` | blocker |

### cf-busy — not reachable
| — | needs peers on a hub (presence, two chats, Tereza in Preview). **Product work:** a collab peer harness in the lane | — | — | — | blocker (state not shown) |

### cf-status-words
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Only "Local project" is reachable. Saved / Syncing… / Offline — kept on this Mac need a hub link | four words | one | `client/v2/shell/share-cluster` | warning (lane) |

### cf-render-error — the card with the last good picture
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | No dimmed last good render behind the card, no "Last good version · 6 Oct, 14:05" chip, no "Go back to 14:05" primary | dimmed artboards + chip + primary | plain card, no picture | `client/v2/create/render-error.jsx:62-83` (lastGood only if THIS session drew it; cold thumb only if the index has a cover) | blocker |
| both | "Ask AI to fix it" sits on the card | AI repair is a chip in the AI panel | button on card | `client/v2/code/canvas-error-card.jsx:203-212` | warning |
| both | A live syntax break shows the v1 dev bar in Czech, not the v2 card | the card | "⏸ build error — držím poslední funkční verzi" | `apps/studio/canvas-comment-mount.tsx:670` (`HmrHoldingToast`) | blocker |
| both | The card is smaller: 18 px icon inline with the title, not the 48 px tile above it | icon tile, 17 px title | inline icon | `client/v2/code/canvas-error-card.jsx:179-184` | warning |

### cf-offline-create
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | "AI is back when this Mac is online." + Ask AI kept | — | match | `empty-canvas.jsx` | verified (element) |
| both | The queued-prompt bubble ("Queued — sends when this Mac is online.") | — | not sent | — | not-a-finding (lane) |

## Root causes (several artboards)

1. **R1: the AI-on-canvas language never fires for a drafting run.** The ring needs `leases` (`runs-model.js:205`), the tag is fixed (`:175`), and "Made by AI" / ⌘Z need a `project:action`. The fake agent's file write produced neither. This hits cf-ai-drafting, ai-done, undo-before and undo-ai, and 02 ob-first-draw / ob-sig-draw.
2. **R2: there is no "next piece" ghost, and no per-piece narration** (CONTRACT §3 "AI is drawing the footer" exists only for holds).
3. **R3: last good is session-scoped.** A cold open has no picture, and a syntax break takes the v1 HMR path (`canvas-comment-mount.tsx:670`) instead of the v2 card.
4. **R4: every inspector is the full docked column** (`sections.js`). The board's compact cards (select-tweak, frames-text, add-artboard) never appear.
5. **R5: Home and toasts follow a different board.** Home lifts 11 `pn-home` (side-by-side shelves, no dots). The done / duplicate toasts are bordered cards with Show, not the spark pill with Undo.

## What's working (preserve)

- Home's question, end to end: the spark, the rounded headline, the target chip and the starters. Made by AI is on the Home recent card.
- The empty canvas spot art, its one line and Ask AI ⌘/, plus the offline line.
- The render-error words ("can't be drawn right now", nothing is lost), and the "Duplicated at Laptop — 1280 wide. Undo" toast copy.

## Verdict

```json
{
  "canvas": "01 Create Flow",
  "critic": "signature-moment-critic",
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 31,
  "warnings": 37,
  "aspiration_score": 3.0,
  "axes": {
    "signature_moment": { "score": 2, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 3, "weight": 1.0 },
    "restraint": { "score": 4, "weight": 1.5 },
    "negative_space": { "score": 3, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": ["canvas-comment-mount.tsx:670 Czech dev string on a live break", "selection label 'div · 1440 × 996'"],
  "top_blockers": [
    { "category": "aspiration-signature_moment", "line": null, "summary": "signature_moment 2/5: AI drafting shows no dashed ring, ghost, 'AI is drawing <piece>' tag or Made by AI", "fix": "Give a drafting run per-artboard leases + progress, name the piece in the ring tag, draw the next-artboard ghost, and attribute agent file writes as an ai action." }
  ],
  "opt_out_applied": "palette",
  "passed": false,
  "verified_ids": ["cf-blank · light", "cf-blank · dark", "cf-offline-create · light", "cf-offline-create · dark"]
}
```
