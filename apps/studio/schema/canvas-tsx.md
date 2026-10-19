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
| A link is `data-cd-link="<target>"` on an element that has a literal `data-cd-id`: `#<artboard>`, `<canvas>.tsx#<artboard>` (designRoot-relative, the artboard optional) or an `https://` address. It is the element's On click, canvas-only metadata (stripped by every export) and the one `data-cd-*` you may write; keep it when you keep the element, and a copy keeps it. Format: `apps/studio/client/v2/contracts/S3-links-format.md` §2. | `link-format` · `link-no-id` (errors) · `link-dangling` (warning); changing one is not `cd-attr-changed` | fast |
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

## Element id rename (S2.2b)

The inspector's **Element id** field runs `element.set-id` (`apps/studio/edit-ops/set-id.ts`). Afterwards the
file holds the new literal in place of the old one, `data-cd-id="book-call"`, and nothing else in the `.tsx`
changes. In the same request the studio moves every durable reference to the old id on that canvas: an element
comment's `selector` (`[data-cd-id="…"]`) in `_comments/<slug>.json`, and every `el:<artboard>/<id>[#n]` host on
the board (`startHost.ref` / `endHost.ref`, a stamp's `target`, a vote's `targets` and `tallies`, a ballot's
`picks`). One undo restores the source and the references. Refused: a new id that breaks the grammar, that
another element has, or that a detached comment or arrow still holds; a locked element; an element (or new id)
an AI run holds; and, on a project in accepted-revisions mode, a rename that has references to move.

An agent does not rename ids: `maude design check` reports the old id as `id-lost`, and agents never write the
comments file. Ask the person to use Element id.
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

## Tidy up artboards: the same result by hand (S2.9)

"Tidy up" on the align bar over 2+ artboards (and ⌘K `artboard.tidy`) writes only positions: `x` / `y` of each
artboard in the canvas's `.meta.json` (`layout.artboards[]`) — never a prop in the `.tsx`, never the per-user camera
file. The arithmetic (`apps/studio/edit-ops/tidy.ts`), whole pixels:

1. Sort the selected artboards left to right by `x` (ties keep the order they are listed in).
2. Every board's `y` is the **largest** `y` of the set — the lowest board's line; nothing climbs.
3. The first board keeps its `x`. Each next board's `x` is the previous one's `x + width + gap`.
4. `gap` is the mean of today's edge-to-edge gaps between neighbours (rounded); if any two boards overlap or
   stack in a column it is 80.
5. Sizes are not touched. A board that would not move is not written.

Annotations that belong to a moved artboard move with it (their `x` / `y` in the board file), as for align.

## Duplicate an artboard: the same result by hand (S2.10)

⌘D on a selected artboard, the ⌥-drag, the artboard menu's "Duplicate" and "Duplicate at another width ▸" (the ops
`artboard.duplicate` / `artboard.duplicate-at-width`, `edit-ops/duplicate-at-width.ts`) write one copy:

1. **The JSX.** Copy the whole `<DCArtboard …>…</DCArtboard>` and put it right after its source. The copy gets a new
   `id` (a number appended: `desktop` → `desktop-2`; for a width copy `desktop-390`), a new `label` (`Desktop` →
   `Desktop 2`, `Příběh` → `Příběh 2` — accents stay; a width copy is `Desktop (390px)`), and, for a width copy,
   the new `width={N}` (64–8192). Everything else — `height`, `kind`, `fixed`, the children — is copied as it is.
2. **No ids come along.** Delete every `data-cd-id` and `data-cd-locked` inside the copy (a copy starts unlocked and
   its elements are named again when something first needs them). Never leave one id on two elements.
3. **Its place** is `layout.artboards[]` `{ id, x, y }` in the canvas's `.meta.json`, not a prop. ⌘D uses the right
   edge of the source plus the gap the source's row already uses (the gap to its left neighbour, else to its right
   neighbour, else 80), on the source's top edge; if another board stands there, the copy goes past it at the same
   gap. The ⌥-drag puts it where it was dropped. Boards that have no `layout.artboards[]` entry yet sit on the
   default grid by their order in the file, so inserting a copy shifts them — give each of them an entry at the
   place it is drawn before you insert.
4. **Annotations are not copied** with an artboard (v2.0).

"Rename" is the `label` prop (up to 80 characters). "Reset position" removes the board's `layout.artboards[]` entry.

## Draw a frame or a shape; round a corner: the same result by hand (S2.13)

F, R and More (Line · Ellipse · Polygon) draw by dragging; one drag is one write (`object.insert-shape`, or
`artboard.draw` for F on empty canvas). Everything is plain TSX; a v1 peer reads it as it reads any `<div>`.

| Gesture | What the file looks like afterwards |
| --- | --- |
| F, drag inside an artboard or a frame | A new last child `<div data-cd-id="frame" style={{ position: "absolute", left: "40px", top: "24px", width: "216px", height: "216px", background: "var(--bg-1)" }} />` (`left` / `top` are px from the container's padding edge; a click draws 100 × 100). The id is readable and unused: `frame`, `frame-2` … |
| R, drag | The same `<div>` with `data-shape="rectangle"` and `background: "var(--accent)"`. `data-shape` is an inert data attribute: the inspector's "Shape" chip and the selection read it, nothing else does. |
| More › Ellipse | `data-shape="ellipse"` and `borderRadius: "50%"` on the same box. |
| More › Polygon | `data-shape="polygon"` and `clipPath: "polygon(50% 0%, 93.3% 75%, 6.7% 75%)"` — N points of a regular polygon on the box's inscribed ellipse, the first at the top (6 sides by default, 3–12). |
| More › Line | `data-shape="line"`: `left` / `top` at the first point, `width` = the length, `height: "0"`, `borderTop: "2px solid var(--fg-0)"`, and — unless it is horizontal — `transform: "rotate(<deg>deg)"` with `transformOrigin: "0 0"`. |
| F on empty canvas | A new `<DCArtboard id="artboard-N" label="Artboard N" kind="digital" width={w} height={h} fixed>` after the last artboard (at least 64 px, at most 8192), and its place — world px of the drag's top-left — in `layout.artboards[]` of the `.meta.json`, never a prop. |
| More › Export area | **Nothing is written.** The Export sheet opens with the world rectangle. |

Colours are tokens, never hex. If the container is not placed (`position: static`), give it `position: "relative"` so
`left` / `top` mean what they say (the artboard body already is). A container the file computes (`style={styles.x}`)
is refused.

### Corner radius (the dot inside each corner; `object.set-corner-radius`)

Dragging a corner dot writes `style.borderRadius`, the same as the inspector's Corners row: **one value** while the four
corners are equal (`"8px"`, `"var(--radius-md)"`), **four values in CSS order** ↖ ↗ ↘ ↙ when they differ
(`"8px 0 0 0"`, `"var(--radius-md) 4px 0 var(--radius-sm)"`). The per-corner longhands (`borderTopLeftRadius` …) are
removed, and 0 on all four removes the declaration. A radius that lands on a `--radius-*` stop of the system is the
token; anything else (⌘ held) is `px`. While the four are equal a drag rounds all four; when they differ, or with ⌥,
only that corner changes and the other three keep what they had.

## Place, replace and crop an image: the same result by hand (S2.15)

A tile dropped on a frame (or placed with ↵), Replace…, and Fill · Fit · Crop · Tile are three edit-ops
(`image.place`, `image.replace`, `image.crop`; `edit-ops/image-fit.ts`, `edit-ops/crop.ts`). A picture is a plain
`<img src="assets/<sha8>.<ext>">` — the `src` is always `assets/<flat name>` (import the file first with the asset import;
no `..`, no scheme). Edits are attributes of this one `<img>`, never of the asset ("edits apply to this use only").

| Gesture | What the file looks like afterwards |
| --- | --- |
| Drop a tile on an empty frame (`mode: "fill"`) | A new last child `<img data-cd-id="img" src="assets/ab12cd34.jpg" alt="" style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }} />` — cropped to fit. |
| Drop on a frame that holds one picture, or on a picture | Only that `src` changes; the box, the fit and the crop stay. A `data-photo-edit` / `data-photo-asset` on it is removed (a per-use edit belongs to the old picture). |
| Place on an artboard, `mode: "fill"` | The same `<img>`, first child, `position: "absolute"; left: "0"; top: "0"; width: "100%"; height: "100%"; objectFit: "cover"` — behind the content. |
| `mode: "loose"` (↵ on a selected artboard) | A last child `<img … style={{ display: "block", width: "<natural>px", maxWidth: "100%", height: "auto" }} />` — in the flow, never wider than its container. |
| `mode: "fill-in-order"` / `"grid"` | In order: the n-th `<img>` inside the target takes the n-th asset, extra assets are placed loose. Grid: one `<div style={{ display: "grid", gridTemplateColumns: "repeat(ceil(√n), 1fr)", gap: "var(--space-2)" }}>` with a square `aspectRatio: "1 / 1"; objectFit: "cover"` `<img>` each. |
| Figma paste | The same `<img>` plus the inert `data-source="figma"` and `data-source-name="Hero / v3"` (the frame’s name, when Figma said it). It is Figma’s exact picture, not layers. |
| Replace… | `src` (a tile: `data-image-tile` and `backgroundImage`) only. |
| Fit ▸ Fill | `objectFit: "cover"`; `objectPosition`, `transform`, `transformOrigin` and `data-image-fit` removed. |
| Fit ▸ Fit | `objectFit: "contain"`, the rest removed as above. |
| Fit ▸ Crop (double-click, drag, ↵) | `objectFit: "cover"`, `objectPosition: "X% Y%"` (the point of the picture that stays put), `data-image-fit="crop"`; and past 100 % `transform: "scale(Z)"` with `transformOrigin: "X% Y%"` and `overflow: "hidden"` on the frame that holds the picture so the zoom is clipped. Zoom 1–8, X and Y 0–100. |
| Fit ▸ Tile | The `<img>` becomes `<div role="img" aria-label="<alt>" data-image-tile="assets/…" data-image-fit="tile" style={{ …box, backgroundImage: "url(\"assets/…\")", backgroundRepeat: "repeat", backgroundSize: "auto" }} />` (an empty alt gives `aria-hidden="true"` instead of the label). Any other Fit turns it back into an `<img>`. |

A source or a style the file computes (`src={photo}`, `style={fit}`) is refused. Over HTTP the same results:
`POST /_api/edit-op {op: "image.place", targets: [frame?], params: {asset | assets, mode, artboard?, natural?: {w, h}, alt?, from?: {name}}}`,
`{op: "image.replace", targets: [picture], params: {asset}}`,
`{op: "image.crop", targets: [picture], params: {fit?, zoom?, x?, y?}}`.

## Remove an artboard: the same result by hand (S2.10b)

⌫ on a selected artboard and the artboard menu's "Move to trash" (the op `artboard.trash`,
`edit-ops/artboard-trash.ts`) remove the whole `<DCArtboard id="…">…</DCArtboard>` element and its
`layout.artboards[]` entry in the `.meta.json`, and (S2.10c) the artboard's annotations from the canvas's
`.annotations.json`: the elements whose `parentArtboard` is it, whatever sits in those sections, and an arrow with
no `parentArtboard` whose every bound end is on them or on the artboard. A canvas keeps at least one artboard. In
the studio this is one project action, "Moved “<label>” to the trash": the Trash lists the artboard, one ⌘Z
brings it back at its place with its annotations, and the Trash's Restore does too. Removed by hand, the change
is an ordinary edit of the files (Version history still has the board).

## Artboard props that Maude 2 adds (S7)

Both props are literal values on `<DCArtboard>`. Maude 1.x ignores them and still draws the artboard correctly
(V2-1.12 R1–R3).

| Prop | Shape | What a 1.x peer sees |
| --- | --- | --- |
| `print={{ …, sizeMm: [w, h] }}` (custom print size) | `sizeMm` is the trim in mm, width × height, each side 10–5000. `paper` is still a preset id: the **smallest preset that holds the trim** (`kinds/print-custom.ts` `nearestLargerPreset`), never `"custom"`. `orientation` is the one that makes the preset hold it. `bleedMm` is always written. The JSX `width`/`height` are the trim plus 2 × bleed in px, as for every print artboard. Example: `print={{ paper: 'dl', orientation: 'portrait', sizeMm: [99, 210], bleedMm: 3 }}`. | The preset's name in its Paper select and the same guides, because the guides come from the artboard's px size less the bleed. Its prop reader drops the array, and `paper: "custom"` would make it throw. |
| `safeZones="<preset>"` (e.g. `"instagram-reels"`) | One preset id from `kinds/safe-zones.ts` (S7.22). "Show on canvas" is per-person runtime state in `_canvas-state/<slug>.view.json` `overlays.safeZones`, never in the file. The bands are never exported. | Nothing. The prop is unknown to it and has no effect on rendering. |

Write a custom size with `customPrintProp([w, h])`, or hand-write the same shape. Both props follow DDR-181:
artboard intent lives in the JSX.
