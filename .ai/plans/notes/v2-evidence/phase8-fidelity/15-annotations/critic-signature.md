# signature-moment-critic — 15 Annotations (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/15 Annotations.tsx` (+ `15 Annotations.css`, `preview/_components.css` `.sticky`) · impl = release v2 client (stage-A frames, `full-size-path.txt`) · opt_out_scope: palette · READ-ONLY_

## TL;DR

**Aspiration (impl vs board): 3.3/5** · Specificity: pass · Verdict: **fix-and-retry**

Half of the board's annotation moments come through:

- **N** opens Preview with the sticky in hand and the colour row above the toolbar.
- Stickies sit quietly on and between artboards, tilted a little, in the rounded face.
- The sticky's own toolbar has its colours, size, Resolve and lock.
- The **Stickers gallery** (E) is a near match: Stamps row, four packs with "+N" tiles, keyword search with chips, credits.
- The marker popover, the vote sheet, the Layers person chips, "Not printed" on print and the AI spark marks on AI paper are all there.

The other half is plainer:

- **Arrows** are 1 px straight lines that cut across artboards. The model defaults to `straight` (`annotations/elements/arrow.model.ts:75`), and routing runs only for elbows. The board's "a new arrow is curved with a filled head" and "around, never through" do not appear.
- **Placed stickers and stamps render as a broken-image icon.** This hits an-stk-drop, an-stamps and an-ai-stickers.
- **Standalone text, shape labels and section titles are set in mono** (`annotations/ui/text-style.ts:14` `TEXT_FONT`), against the DS rule "Mono only in Advanced and code".
- **S does not open Templates.**
- The **LOD colour blocks** (an-crowd) were not reached: the drive stopped at 37 %, and the mosaic starts below 25 %.

**Coloured stickies** (yellow / sky / pink / green paper, numbered badges, "Tereza · 2 h ago") are **fixture**. Every seeded note came through the AI verb, so it is AI paper with a spark edge, which is the board's own AI look (`.an-st--ai`). Person-coloured paper is reachable through the colour row but was not driven.

Dark: the stickies and stickers keep their own colours; the chrome follows the theme. The only dark-only difference is the washed light toolbar pill, the same as 13 and 14.

## Axis scores (IMPL)

| Axis | Score | Weight | Weighted | Verdict |
|---|---|---|---|---|
| Signature moment per artboard | 3/5 | 1.5 | 4.5 | Gallery, sticky toolbar, quiet layer, AI marks carried; arrows, stickers, templates and LOD plainer or missing |
| Brand prominence | 3/5 | 1.0 | 3.0 | Spark edge + glyph on AI paper carries Maude's AI identity; the playful object colours are absent (fixture) |
| Mock fidelity | 2/5 | 1.0 | 2.0 | Stickers are broken images; text objects in mono; sticker size chip falls back to serif |
| Restraint | 4/5 | 1.5 | 6.0 | Quiet in Edit as designed; no colour overload |
| Negative space | 4/5 | 1.0 | 4.0 | Notes sit around the work without crowding it |
| **Specificity gate** | **pass** | — | — | Seeded copy is real ("Tighter, please", "Is this the right CTA?", "Image too tall") |

Weighted total 19.5/30 → **3.3/5** (mock fidelity < 3).

## Per artboard (a "both" row counts once per theme)

### an-enter
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | N in Edit → Preview with Sticky in hand, 5 colours + "+5" above the toolbar, "Previewing … esc to edit" pill | — | match | `tool-palette.tsx`, `toolbars/tool-panel.ts` | verified (element) |
| both | No tool letters under the Preview toolbar icons | H N C M A R T E S captions | icons only | `tool-palette.tsx` / `toolbars/toolbar-css.ts` | warning |

### an-place — the signature: stickies where the thought belongs
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Stickies on and between artboards, quiet in Edit, tilted | — | match | `annotations/ui/element-node.tsx`, `annotations/ui/text-style.ts:18` (rounded face) | verified (element) |
| both | Paper colours, numbered badges, author lines | yellow/sky/pink/green + "Tereza · 2 h ago" | AI paper | AI-seeded fixture | not-a-finding |
| both | The AI edge is a thin 1 px coral outline, and the "AI" author line under the sticky is not visible | `.an-st--ai`: `inset 0 0 0 2px var(--spark)`, `--shadow-md`, "AI" in `--spark-text` | 1 px edge, small shadow, no author line | `annotations/ui/ai-marks.tsx:3,47-60` | warning |

### an-sticky
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The selected sticky's toolbar: colours +5, size, list, Resolve, lock, trash | — | match | `annotations-context-toolbar.tsx` | verified (element) |
| both | "Turn into a comment" is a toolbar word-button; the board puts it first in the sticky's menu and keeps the bar to colours · size · list · lock · more | menu row | toolbar button | `annotations-context-toolbar.tsx:321,1701` | warning |

### an-today
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Standalone text, shape labels and "Add text" are set in mono ("Hero v2", "Hero v2 — stays") | text in the body / display face, sizes Small … Huge | `ui-monospace` | `annotations/ui/text-style.ts:14` (`TEXT_FONT`), `annotations-layer.tsx:5647` | blocker |

### an-arrow-bind — the signature: an arrow to the thing you mean
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Arrows are 1 px straight lines; the board's arrow is a 2 px curve with a filled head into the button | curved, filled head | straight hairline | `annotations/elements/arrow.model.ts:75` (`line: oneOf(ARROW_LINES, 'straight')`), the verb's default too | blocker |
| both | No azure ring + "Button · See the work" tag on the bound target | ring + tag | end handles only | `annotations/ui/arrow-cards.tsx` `AimOverlay`: drawn while aiming, not on a selected bound arrow | warning (unproven) |

### an-follow — the signature: around Mobile, never through
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | While the artboard moves, the arrows stay straight and cross the Tablet artboard; no orthogonal route around | elbow route + "never through" | straight lines through artboards | `annotations/route.ts` + `annotations/ui/rest-route.ts` (`routeElbowsAtRest`, `annotations-layer.tsx:5212`) route only `elbow` lines; the default is `straight` | blocker |

### an-arrow-kinds · an-marker · an-vote · an-vs
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Line toolbar Straight · Curved · Elbow + heads + label; Marker/Highlighter/Eraser popover with inks + widths; Start a vote sheet; Comments panel beside the layer | — | match | `annotations/ui/arrow-kinds.ts`, `toolbars/marker-tip.ts`, vote sheet, comments panel | verified (element) |

### an-section
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The section is a pale frame with a faint mono title; the board draws a tinted section with a semibold name pill and Fold / Ask AI | lilac fill + pill | faint mono title | title slot via `text-style.ts:14`; faint = Edit's quiet layer | warning |

### an-templates
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | S arms Section, but no Templates panel opens (Kanban, Retro, Flowchart, Content calendar, Roadmap, Brainstorm, Checklist, Blank + prompt) | panel above the toolbar | none | `toolbars/tool-panel.ts:47-52` says Section opens `templates` when the tool was something else; the shell panel did not show (`client/v2/shell/tool-panels.js`) | blocker |

### an-plan
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The kanban from `annotate --board kanban` has empty cream cards, no channel colours, stamps or arrows to artboards | filled, colour-coded | empty columns | `annotations/templates.ts` (the verb fills nothing without AI) | warning |

### an-stk-gallery · an-stk-search
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Gallery: header "Stickers · E", search, Stamps row, packs with "+N", credits; search chips "All 6 · done 4 · almost done 2 …" and six results | — | match | stickers panel (`toolbars/tool-panel.ts`) | verified (element). No "Recent" row = fixture |

### an-stk-drop — the signature: a sticker is a picture on the layer
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The placed sticker renders as a broken-image icon; box, handles and Replace… · Flip · Duplicate are right | sticker art at 160 px | broken image | `annotations/ui/element-node.tsx:717-728` (`href={resolveAsset(str(el.href))}`) after the shell's `/_api/asset` upload (`annotations-layer.tsx:2055-2075`) | blocker |
| both | The "160 × 160" size chip falls back to serif (Times) | UI face, tabular | serif | `annotations/ui/placement.tsx:208-217` (`<text>` has no `fontFamily`) | warning |

### an-stamps
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The vote bar "Vote · 1 artboard · 3 left of your 3 · 1:59 · End vote" | — | match | `annotations/elements/vote.model.ts`, vote bar | verified (element) |
| both | No stamp-faces row above the toolbar, no "5 stamps on Směr B" popover | stamp row + popover | not reached; a stray broken sticker on the canvas (counted on an-stk-drop) | `annotations/ui/stamps.tsx` | warning (unproven) |

### an-convert
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | The converted thread "From Jonas's sticky · turned into a comment · Undo" is not shown | thread + Undo | not reached | `annotations-context-toolbar.tsx:1701` | warning (unproven) |

### an-ai-stickers · an-ai-write
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (stickers) | DONE! / FLAGGED stickers with a coral spark badge: the image is broken, so the badge has nothing to sit on | stickers + spark dot + "AI" chip | broken tile | `element-node.tsx:725`; badge `ai-marks.tsx:5` | blocker |
| both (write) | AI review notes are small text boxes with hairline straight arrows; the board draws spark-edged cards ("AI" chip) with curved arrows to each spot | `.an-st--ai` cards + `.an-arr--ai` curves | text + straight lines | `annotations/ai-write.ts` (notes kind), `arrow.model.ts:75` | blocker |

### an-layers · an-visibility
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (layers) | Annotations listed with Everyone / You / AI chips; no grouping under the section ("Zpětná vazba Tereza · 4"), no lock row, no "Hidden by the filter…" footer | grouped | flat | `client/v2/annotations/annotation-list.jsx` | warning |
| both (visibility) | ⇧P left the stickies visible in the frame | hidden | quiet but visible | `use-annotations-visibility.tsx` (the drive may have toggled it twice) | warning (unproven) |

### an-dangling
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | Dangling ends are small rings; no dashed line, no "Pointed at "Book a call" — moved to the trash · Point to…" card | dashed + card | rings | `annotations/ui/arrow-cards.tsx` `HostMarks`: the card shows for a SELECTED arrow; none was selected | warning (unproven) |

### an-crowd — the signature: colour first, words when legible
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | 200 stickies drawn one by one at 37 %; no colour-block mosaic, no section counts, no "Nápady · 84 stickies" hover card | mosaic below 25 % | stickies | `annotations/ui/lod.tsx` (`inMosaic`, `annotations-layer.tsx:5294-5300`); the drive stayed above the threshold | warning (unproven) |

### an-video · an-print
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both (video) | No "0:12" time pin on the sticky, no timeline sticky marks | pin chip + marks | sticky over the clip | `annotations/ui/time-pins.tsx`, `annotations/time-marks.ts` (the timeline needs the artboard selected) | warning |
| both (print) | "Not printed" tag | — | match | `element-node.tsx:309` | verified (element) |
| both (print) | The sticky outside the print area is full strength, not faded | faded | full | `element-node.tsx:309` (fade) | warning |

### an-ai-read · an-ai-apply · an-rebind · an-viewer · an-figjam
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| both | AI reads/applies, AI rewrite rebinding, viewer role, FigJam import | — | not reachable | signed-out AI / no viewer session / no Figma connection (`annotations/ai-read.ts`, `arrow-cards.tsx` rewritten ring, `annotations/figjam-into.ts` exist) | unverified (lane) |

### dark (all frames)
| theme | difference | spec | impl | owner | sev |
|---|---|---|---|---|---|
| dark | The Preview / Edit toolbar is a washed light pill with faded glyphs on the dark window | solid dark island | light, low contrast | `toolbars/toolbar-css.ts:23` (`--island-bg` fallback); cause unconfirmed | warning |

## Root causes that hit several artboards

1. **New arrows are straight.** `arrow.model.ts:75` defaults `line` to `straight`, and the router (`route.ts` / `rest-route.ts`) acts only on elbows. So arrow-bind, follow and ai-write all show hairlines through artboards, where the board has curves and routes around (its note: "A new arrow is curved with a filled head").
2. **Sticker pictures do not resolve on the canvas.** The shell uploads the gallery sticker to a project asset, then `<image href={resolveAsset(…)}>` (`element-node.tsx:725`) paints a broken image. This hits stk-drop, stamps and ai-stickers.
3. **Annotation text is mono.** `TEXT_FONT` (`text-style.ts:14`) is used for standalone text, shape labels, "Add text" and section titles. The DS says "Mono only in Advanced and code"; stickies already use the rounded face (`STICKY_FONT`). The same root cause as 14's HUD.
4. **SVG HUD text without a font family** falls back to serif (`placement.tsx:208-217`, the sticker size chip).
5. **The S → Templates panel does not open** in the shell, although `tool-panel.ts:47-52` asks for it.
6. **Several moments appear only under a gesture the drive did not make:** the mosaic below 25 %, a selected dangling arrow, mid-aim rings, ⇧P. Stage B needs a re-drive before they can be called present.

## What's working (preserve)

- The Stickers gallery and keyword search. These are the closest-to-board surfaces on the canvas.
- AI paper + spark glyph (`ai-marks.tsx`): AI never gets a sixth sticky colour, as the board insists.
- The quiet-in-Edit layer and the sticky's own small toolbar; "Not printed" on print artboards.

---

## Verdict

```json
{
  "agent": "signature-moment-critic",
  "iter": 1,
  "blockers": 1,
  "warnings": 2,
  "aspiration_score": 3.3,
  "axes": {
    "signature_moment": { "score": 3, "weight": 1.5 },
    "brand_prominence": { "score": 3, "weight": 1.0 },
    "mock_fidelity": { "score": 2, "weight": 1.0 },
    "restraint": { "score": 4, "weight": 1.5 },
    "negative_space": { "score": 4, "weight": 1.0 }
  },
  "specificity": "pass",
  "specificity_findings": [],
  "top_blockers": [
    { "category": "aspiration-mock_fidelity", "line": null, "summary": "mock_fidelity 2/5: stickers render as broken images; text objects in mono; size chip in serif", "fix": "Resolve gallery-sticker hrefs on the canvas origin; set TEXT_FONT to the body face; give SVG HUD text the UI font." }
  ],
  "opt_out_applied": "palette",
  "passed": false
}
```

```json
{"canvas":"15 Annotations","critic":"signature-moment-critic","blockers":14,"warnings":31,"verified_ids":["an-arrow-kinds·light","an-marker·light","an-vote·light","an-vs·light","an-stk-gallery·light","an-stk-search·light"]}
```
