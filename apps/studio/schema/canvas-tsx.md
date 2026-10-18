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
| Resize an artboard by hand: `width={N}` and `height={N}` on its `<DCArtboard>` (64–8192, whole numbers); add the bare `fixed` prop to make the height exact (leave it out and `height` is a floor — "Fits content"). Moving it is `layout.artboards[]` `{ id, x, y }` in `.meta.json`, never a prop and never `_canvas-state`. The studio's `artboard.resize` (an edge drag, the W/H fields) writes exactly this. | `edit-ops/artboard-resize.ts` · `test/v2-artboard-resize-op.test.ts` | — |
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
