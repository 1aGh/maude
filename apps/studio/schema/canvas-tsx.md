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
