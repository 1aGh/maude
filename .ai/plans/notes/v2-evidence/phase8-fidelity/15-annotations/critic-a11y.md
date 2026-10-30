# a11y-critic — 15 Annotations (V2-8.5 stage B)

_2026-10-22 · board `.design/ui/v2/15 Annotations.tsx` (+ `.css`) · impl frames `.claude/worktrees/agent-a55262287b808e562/.scr/impl/15-annotations/` (lossless PNG, 1440×900) · standard: WCAG 2.1 AA (no project a11y-rules skill) · opt_out_applied: n/a — a11y enforces at every scope_

**Method.** Same as 13/14: every pair was read, contrast comes from impl pixels, and roles/keys/motion come from code. The impl stickies are cream "AI-authored" paper made by the verb, so their colour and tilt are fixture. Sticky words drawn at 37 % canvas zoom are zoom-scaled and not a contrast finding.

**The board's a11y intent.** Annotation keys work from Edit: N Sticky · C Comment · M Marker · A Arrow · E Stickers · S Section (`15 Annotations.tsx:733`). Edit shows the layer quiet, "faded paper, readable words" (`:1593`). ⇧P hides and one line says how to bring it back (`:635`). Resolved is "struck through in place" (an-vs table). Reduced motion: "the route jumps, nothing eases" (an-follow).

## What matches (verified in code)

- Toolbar `role="toolbar"` "Canvas tools". Tool buttons are `aria-label` + key hint (`apps/studio/tool-palette.tsx:584-650, 738-739`). Popovers are `role="menu"` / `menuitemradio` with labelled swatch fieldsets (`:214-240, 262-369, 545-556`).
- Context toolbars are labelled `role="toolbar"` (sticker, image, link, media, lock), and each button has a `:focus-visible` ring (`annotations-context-toolbar.tsx:234-349, 862-1170`).
- Selected annotations: arrows nudge 1/10 px and ⌫ removes (`annotations-layer.tsx:4609-4640`). ↵ opens a sticky's editor (`:4307-4320`). ⌘↵ chains the next one (`:4299`).
- Layers rows are `<button>`s with `aria-current`, a sr-only "Locked", and a labelled person-chip group (`client/v2/annotations/annotation-list.jsx:96-125, 179-189`). They are the keyboard route to a sticky in Preview.
- Sticker gallery: `role="dialog"` `aria-modal`, labelled search (focused on open), Esc and Close, labelled "+N" and stamp buttons, chips `aria-pressed` (`stickers-gallery.jsx:118-122, 182-381`).
- Vote sheet: modal with Tab containment and focus return, labelled inputs, `role="alert"` error (`vote-sheet.jsx:35, 95-177`).
- On-canvas resolved badge is `role="img"` "Resolved" / "Resolved by AI" (`annotations/ui/element-node.tsx:382-383`).
- Reduced motion: toolbar morph (`toolbars/toolbar-css.ts:215-218`), context toolbar (`:449`), LOD, time pins and ride/settle each carry a `prefers-reduced-motion` block.

## Root causes (count once each)

| # | cause | spec | impl (measured / code) | owner | sev |
|---|---|---|---|---|---|
| A1 | **Dark: the toolbar island and its tool popovers render light, with pale ink** (same as 13 D1 / 14 E1). The marker popover's "Highlighter / Eraser" labels and the toolbar glyphs fail. Hits every reachable artboard in dark (the annotate toolbar, the sticky colour row, the marker / shape popovers). | dark island (board `Toolbar`, `Pal`) | glyphs `#b7bbc0` on `#dee1e2` **1.47:1** (3:1). Popover labels `#b7bbc0` on `#fbfdff` **1.89:1** (4.5:1). Light: 9.0:1. | `apps/studio/toolbars/toolbar-css.ts:23-24, 125` | blocker |
| A2 | **Annotation creation needs a pointer.** The sticky tool (N), gallery stickers, stamps and templates either wait for a canvas click or "follow the pointer until you click". `PlacementGhost` handles only Escape. There is no ↵ "place at the middle of the view", the counterpart of 14's "R T F then ↵". `isCreateTool` excludes annotation tools, and the ↵ handler needs an existing selection. No keyboard route was found for drawing an arrow either. 2.1.1. Hits an-enter, an-place, an-stk-gallery, an-stk-search, an-stk-drop, an-stamps, an-plan, an-arrow-bind. | 14 `ed-edge-keys`: "A tool, then ↵ — adds one at its default size" | click only | `apps/studio/annotations/ui/placement.tsx:60-92`, `editing/focus-model.tsx:153-154`, `annotations-layer.tsx:2064-2077, 4307-4320` | blocker |
| A3 | **Resolved is colour-only in Layers.** A resolved row only turns `--fg-2`, with no strike-through and no text. The canvas badge has a name, but the row does not. 1.4.1 / 1.3.1. Hits an-layers, an-ai-apply ("Tighter, please" is resolved). | "struck through in place" | `--fg-2` 5.77 L / 5.86 D vs `--fg-0` 9.2 / 9.4; no sr text | `client/v2/annotations/annotation-list.css:110-112`, `annotation-list.jsx:93-125` | blocker |

## Per artboard

| id | theme | difference | spec | impl | owner file:line | sev |
|---|---|---|---|---|---|---|
| an-enter | L/D | N arms Sticky in Preview. "Previewing Homepage · esc to edit" pill matches. **No key letters under the tool glyphs.** The letters exist only in `aria-label`, so sighted keyboard users don't see them. A2: the next step (placing) needs a click. | letters H N C M A R T E S | glyph only | `tool-palette.tsx:584-602` | warning, (A2), D (A1) |
| an-place | L/D | Stickies sit quiet on and between artboards. Their paper keeps readable words (`quietPaper`). A2. | — | — | — | (A2), D (A1) |
| an-sticky | L/D | Sticky toolbar: labelled `toolbar`, ring on swatches. Swatches are 20 px (board draws the same). Order differs (content). | — | — | `annotations-context-toolbar.tsx:211-236` | D (A1, bottom toolbar) |
| an-today | L/D | Sticky, shape and arrow present. The other cards are specimen. | — | — | — | D (A1) |
| an-arrow-bind | L/D | Arrow toolbar: Straight/Curved/Elbow seg, heads, lock. Its selected seg has a fill + weight. The azure target ring and chip are not drawn. A2 (drawing). | — | — | — | (A2), D (A1) |
| an-follow | L/D | Drag pill shown. No elbow routing, so there is no route animation to reduce. | — | — | — | D (A1) |
| an-arrow-kinds | L | Same toolbar as an-arrow-bind. Passes. | — | — | — | none |
| an-arrow-kinds | D | A1 | — | — | — | (A1) |
| an-marker | L | Popover has Marker / Highlighter / Eraser `aria-pressed`, a labelled swatch fieldset, and a thickness fieldset. 9.04:1. | — | — | `tool-palette.tsx:280-369` | none |
| an-marker | D | **A1 measured here.** Popover labels 1.89:1, glyphs 1.47:1. | — | — | — | (A1) |
| an-section | L/D | **The section title is faded with the layer in Edit.** "Tereza's feedback" is drawn at 0.45 opacity, so it is not the "readable words" the board decides on. Stickies get `quietPaper`, but sections, arrows and labels get plain opacity. | readable in Edit (`:1593`) | title `#c0c3c8` on `#edeff1` **1.53:1**, over the artboard image `#86b69b` on `#84d59f` **1.31:1** (L and D alike) | `apps/studio/annotations-layer.tsx:655-659` | blocker |
| an-plan | L/D | Kanban generated by the verb. The column labels ("Doing 1") are faded the same way as an-section (A-section cause, counted there). A2 for the cards. | — | — | — | (an-section), (A2), D (A1) |
| an-stk-gallery | L/D | Gallery matches in lens (dialog, labels, focus to search). A2: a picked sticker follows the pointer. | — | — | — | (A2), D (A1) |
| an-stk-search | L/D | Chips `aria-pressed`, results `<button>` with `<img alt={word}>`. A2. | — | — | `stickers-gallery.jsx:64-74, 367-381` | (A2), D (A1) |
| an-stk-drop | L/D | Sticker placed with its toolbar. **The sticker art renders as a broken image** (asset URL on the canvas origin), so there is no visible content and its name depends on `el.alt`. | sticker art | broken-image icon | `annotations/ui/element-node.tsx:717-727` (+ sticker asset route) | warning, (A2), D (A1) |
| an-stamps | L/D | **The vote bar's live region contains the countdown.** `role="status" aria-live="polite"` wraps the "1:59" timer, so a screen reader re-reads the bar every second. The stamp row and popover are not reached. | quiet bar | announces each tick | `client/v2/annotations/vote-bar.jsx:46, 56-67` | blocker |
| an-vote | L/D | Start-a-vote sheet passes (labels 5.0 / 5.9, inputs 14:1). **The sheet is see-through**: Tablet content shows through the 88 % island with no backdrop blur. That is noise behind the text; the text itself still passes. | frosted, "never peek-through" (DS `colors_and_type.css:117-118`) | content visible through | `client/v2/annotations/vote.css:11-19, 87` | warning |
| an-vs | L | Comments panel tabs and empty state. Passes. | — | — | — | none |
| an-vs | D | A1 | — | — | — | (A1) |
| an-convert | L | "Turn into a comment" is a labelled toolbar button (the board has it in the menu: content). | — | — | — | none |
| an-convert | D | A1 | — | — | — | (A1) |
| an-ai-apply | L/D | A3 (resolved row). No AI run (signed out). | — | — | — | (A3), D (A1) |
| an-ai-stickers | L/D | Broken sticker image, as in an-stk-drop. | — | — | — | (an-stk-drop), D (A1) |
| an-ai-write | L/D | Notes + arrows. The AI spark edge is not visible, so AI-authored is not marked. The text "AI" chip is missing too, which means authorship is not conveyed at all. | spark edge + "AI" chip | neither | `annotations/ui/element-node.tsx` (author mark) | warning, D (A1) |
| an-layers | L/D | A3 measured here. Person chips `aria-pressed`. Section grouping is absent (none exist). | — | — | — | (A3), D (A1) |
| an-visibility | L/D | ⇧P: the frame still shows the stickies (driving). The "Press ⇧P to bring them back" line cannot be checked. | — | — | — | D (A1) |
| an-dangling | L/D | Dangling ends render as small rings. The "Pointed at … — moved to the trash · Point to…" card is missing, so the only cue is a 1 px shape. | card with text + button | ring only | `annotations-layer.tsx` (dangling state) | warning, D (A1) |
| an-crowd | L/D | 200 stickies render. LOD colour blocks are not reached at 37 % (LOD starts below 25 %). | — | — | — | D (A1) |
| an-video | L/D | Sticky over clip. No time pin or timeline (needs the artboard selected). | — | — | — | D (A1) |
| an-print | L/D | "Not printed" tag present. Passes. | — | — | — | D (A1) |
| an-figjam | L | Import sheet: labelled link field, Connect, Cancel / Import. Passes. | — | — | — | none |
| an-figjam | D | Not captured (INDEX: not reachable in dark). | — | — | — | n/a |

## Unreachable (spec-only)

| id | what makes it reachable | sev |
|---|---|---|
| an-templates | S arms Section only. The templates popover (`client/v2/annotations/templates-panel.jsx`) needs its own entry from the toolbar (⌘K / the verb reach it today). When reached, note that its prompt field sets `outline: none` (`templates-panel.css:320`), so check that a replacement ring exists. A2 applies to placing. | blocker |
| an-ai-read | A signed-in AI lane (the Ask AI chip on selected stickies + answer card). | blocker |
| an-rebind | An AI rewrite of the canvas source so a bound arrow re-targets ("Pointed at the old … replaced by AI" card). | blocker |
| an-viewer | A share-grant session opened as a viewer (Can comment: Hand + Comment only). Check that disabled tools are absent rather than present-but-inert. | blocker |

```json
{"canvas":"15 Annotations","critic":"a11y-critic","blockers":9,"warnings":5,"verified_ids":["an-arrow-kinds·light","an-marker·light","an-vs·light","an-convert·light","an-figjam·light","an-sticky·light","an-print·light","an-today·light","an-follow·light","an-crowd·light","an-video·light"]}
```
