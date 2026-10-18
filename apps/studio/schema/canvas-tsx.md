# `canvas-tsx` — the canvas file convention

Contract V2-1.11 §5.2. A canvas is TSX, not data. Its "schema" is this convention plus the lint rules
`maude design check` runs. There is no JSON Schema for it. The design skill teaches it in
`design:design` `_guide-02` (the hard contract).

**Files.** Every `<designRoot>/**/*.tsx` outside `system/`. Runtime folders (`_*`) are never checked.

| Rule | Checked by | Tier |
| --- | --- | --- |
| The file parses (oxc, TSX). | `check` → `parse` | fast (every write) |
| Every `<DCArtboard>` has a plain-string `id`, unique in the file. | `artboard-id-missing` · `artboard-id-expression` · `artboard-duplicate` | fast |
| Every lockable, bindable or commentable element keeps its `data-cd-id`. Ids are never renamed, reused or computed (V2-1.4). | `checkIds` vs the pre-edit snapshot → `id-lost` · `id-duplicate` · `id-expression` · `id-format` · `locked-changed` · `cd-attr-changed` | fast |
| A hover is `data-hover="<preset>"` on an element (a plain string literal): `lift-resting`, `lift-floating`, `lift-sheet`, `darken` or `underline`. It is design, not canvas-only metadata: it sits outside `data-cd-*`, survives every export and writes `:hover` CSS there. Format: `apps/studio/client/v2/contracts/S2-hover-format.md`. | rule set injected by canvas-lib; a value outside the set matches no rule | — |
| Imports come only from `@maude/canvas-lib` and `@maude/ds` (plus the canvas's own siblings). | canvas build in the sandbox | stop |
| Under `dsFidelity: strict`, colours, spacing and type use `var(--…)` tokens. | `ds-check --canvas` S-rules (warnings) | fast (warning) / stop |
| A `kind="web"` artboard has no absolute positioning (flow layout). | `artboards-lint` | stop |
| An artboard's size is its JSX `width`/`height`. Its position lives in `.meta.json` `layout.artboards[]`. | `canvas-rects` / meta schema | — |
| Edit existing canvases with `Edit`, never a whole-file `Write` (over 40 lines). | PreToolUse `whole-file-rewrite` deny | pre-edit |

`errors` block the write, and the PostToolUse hook restores the file. `warnings` go back to the model and never
block. Run it yourself with `maude design check <file> --strict [--against <before>]`.

## Object operations: the same result by hand (S2.6)

The object menu, the keys and the Layers padlock / eye run `edit-op`s (`apps/studio/edit-ops/`). An agent never
calls the route: it edits the TSX and gets the same bytes. Ids never change; a new frame gets a new readable one.

| Menu row | What the file looks like afterwards |
| --- | --- |
| Frame selection ⌥⌘G | The selected siblings (direct children of one parent) are wrapped, in source order, at the first one's place: `<div data-cd-id="frame" style={{ display: 'flex', flexDirection: 'column' }}>…</div>`. Children are indented one level; every child keeps its `data-cd-id`; the id is `frame`, `frame-2`, … (never taken). Objects inside a `.map()` or a `{cond && …}` are not framed. |
| Remove frame ⇧⌘G | A plain element that holds only elements is replaced by its children, in order, one level out. Its own attributes go. A component, an element with loose text or `{expr}` children: not applicable. Frame then Remove frame is byte-identical. |
| Bring to front ⌘] · Bring forward ] · Send backward [ · Send to back ⌘[ | The selected siblings' JSX moves among their parent's children (a later sibling paints above; in auto layout it is also the layout order). Only the order changes; every byte of every sibling is kept. Already at the end: nothing changes. |
| Lock ⇧⌘L | `data-cd-locked` is added to (or removed from) the element, next to `data-cd-id`. Shared by everyone; an agent never removes it. |
| Hide | `style={{ display: 'none' }}` plus `data-cd-hidden="<the previous inline display, or empty>"`. Show restores the display from the marker and drops it. The object stays in the file and in Layers; it never exports. |
| Select matching | A selection, not an edit: same tag, same `className` set and same inline `style` declarations (any order). An agent greps for them. |

## Align, distribute and rotate: the same result by hand (S2.7)

The align bar (2+ objects or artboards), the rotate handle and the Rotation row run `edit-op`s
(`apps/studio/edit-ops/{align,distribute,rotate}.ts`). An agent edits the file and gets the same bytes.

| Bar / handle | What the file looks like afterwards |
| --- | --- |
| Align left · horizontal centres · right | Objects placed freely (`position: absolute` or `fixed`): `style.left` is set in px so every box shares the leftmost left edge / the middle of the selection's horizontal extent / the rightmost right edge (left = edge − width, or middle − width/2). `top` is not touched. Boxes are the visual boxes (a rotated object counts as its bounding box). An object that sits in a layout is not aligned: convert it first (Advanced ▸ Convert children to absolute position). |
| Align top · vertical middles · bottom | The same on `style.top`. |
| Distribute horizontally · vertically (3+) | The leftmost/topmost and the rightmost/bottommost stay; the ones between get `style.left` (or `style.top`) so the gaps between neighbours are equal. The other axis is not touched. |
| Align / distribute artboards | `x` / `y` of the artboards in the canvas's `.meta.json` (`layout.artboards[]`), by the same arithmetic. Annotations that belong to a moved artboard move with it (their `x` / `y` in the board file). |
| Rotate handle · Rotation row · Rotate 90° | `rotate(<n>deg)` inside the element's inline `style.transform` (any other transform functions stay), n in −180…180, two decimals. 0° removes the `rotate(…)`, and the `transform` itself when nothing else is left. Each object turns about its own centre. A `transform` the file computes is left alone. |

## Auto layout, reorder and free placement: the same result by hand (S2.11)

The gap bands, the token ruler, the reorder slot, Place freely and the constraints run `edit-op`s
(`apps/studio/edit-ops/{place-freely,constraints,reorder}.ts`) or the Layout section's CSS writer. An agent edits
the file and gets the same bytes.

| Gesture | What the file looks like afterwards |
| --- | --- |
| Drag a gap (clicks onto the system's space stops; ⌘ any number; ⌥ every gap of that size in the frame) | `style.gap` on the frame, in px (`var(--space-N)` when the system names the stop). Padding is `style.padding*`. |
| Drag a card to a new slot · ← → · move earlier / later | The card's JSX moves among its siblings: in an auto layout the order in the code is the order on the canvas (and in Layers). One move, nothing else changes. |
| ⌥-drag | The card is duplicated into the slot; the copy keeps no `data-cd-id` or `data-cd-locked`. |
| Place freely (or drag out of the frame) | On the card: `style.position: "absolute"`, `left`, `top`, `width`, `height` in px as it sits now (inside its frame's padding box, margin taken off). A frame that was `static` gets `position: "relative"`. CSS only — no `data-cd-*` is added. A `style` the file computes is left alone. |
| Constraints (Position › Pins) | On a freely placed object: Right replaces `left` with `right: <distance to the frame's right edge>`, Bottom likewise with `bottom`; Left & Right sets both and drops `width`; Center is `calc(50% ± Npx)`; Scale is percentages. Datum pinned Right and Top keeps `right: 64px; top: 64px` in every size of the frame, so a story made with Duplicate at another width still shows it there. |
| Convert children to absolute position | Each child gets `position: "absolute"` with `left` / `top` / `width` / `height` as rendered, and a static frame `position: "relative"` (its own size is frozen when it would collapse). The children no longer take part in the layout, so the frame stops arranging them. |

## Text: style, case, language and the Czech ties — the same result by hand (S2.12)

Editing the copy in place, the Type section's Style / Case / Language, Reset and Detach run `edit-op`s
(`apps/studio/edit-ops/{text-copy,text-style-ops,text-detach,czech-ties}.ts`). Everything they write is plain TSX that
a v1 peer reads as it is — no new attribute, `data-cd-id` untouched.

| Gesture | What the file looks like afterwards |
| --- | --- |
| Double-click, type, click away (`text.set`) | The element's single text child is the new copy (`{ } < > &` escaped). In a Czech element (a `lang="cs"` on it or on an ancestor) the copy is set as Czech sets it, below. |
| Style "Heading" (`text.use-style`) | `className` holds the system's class for that role, `t-heading` (`system/<ds>/components.json` `typeRoles`), replacing any other `t-*` class; the other classes stay in order. The inline `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `textTransform` and `fontStyle` are taken out, so the style is what shows. |
| Changing one thing | An ordinary inline declaration on the element (`style.fontSize: "20px"`). It is an override of the style, not a different style: Reset (`text.reset-style`) deletes those seven inline declarations. |
| Detach (`text.detach-style`) | The style's values are written inline for every one of the seven the element does not already set — as the design system wrote them (`fontSize: "var(--type-xl)"`, not `28px`), so a detached text still follows the tokens — and the `t-*` class is removed. A property the style's rule does not declare is written as the value it computes to. The look is identical; a later change to the style itself no longer reaches it. |
| Case AA / As typed (`text.set-case`) | `style.textTransform: "uppercase"`; As typed deletes it (writes `"none"` when the style itself sets a case). |
| Language Čeština (`text.set-language`) | `lang="cs"` on the element, and the copy set as Czech sets it: **U+00A0 (no-break space) in place of the space after every one-letter word** (v k s z o u i a, any case, any other single letter), and „double quotes“ for straight "…" and English “…” quotes (`„` opens, `“` closes). Never inside a URL, an e-mail address or a `` `code` `` span. Another language writes `lang` only; the copy is not changed. |

Over HTTP: `POST /_api/edit-op {file, op, targets, params}` with `op` one of `text.set` (`params.text`, `before?`,
`lang?`), `text.set-language` (`lang`), `text.set-case` (`case: "upper"|"typed"`, `explicit?`), `text.use-style`
(`role: "t-heading"`), `text.reset-style` (`props?`), `text.detach-style` (`values: {"font-size": "var(--type-xl)", …}`). One
request is one write and one undo step.
