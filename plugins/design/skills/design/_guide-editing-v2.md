# Editing in Maude v2 (S2): what the person does, and the same result by hand

The person edits objects with menus, keys and the inspector; each gesture is one write to the canvas `.tsx` (one
`edit-op`). **You edit the file** — never call `/_api/edit-op`. Keep every `data-cd-id`. The per-op file
conventions are in `apps/studio/schema/canvas-tsx.md` ("Object operations").

## Object menu, order, lock, hide (S2.6)

- **Frame selection (⌥⌘G, ⌘G in Edit)** wraps sibling objects in `<div data-cd-id="frame" style={{ display: 'flex', flexDirection: 'column' }}>`.
  To do the same: wrap the elements where the first one stood, indent them one level, give the wrapper a new
  readable id, leave the children's ids alone.
- **Remove frame (⇧⌘G)** is the reverse and only for a plain element that holds nothing but objects.
- **Order (⌘] ] [ ⌘[)** is source order among siblings. To bring something to the front, move its JSX after its
  last sibling.
- **Lock (⇧⌘L)** is `data-cd-locked` on the element. It is shared with everyone and means "the person does not
  want this changed". Do not edit a locked element, and never remove the attribute.
- **Hide** is `display: none` plus `data-cd-hidden="<previous display>"`; it stays in the file and in Layers.
- In **Preview**, the same chords belong to the whiteboard (`annotation.*`): ⌘G groups, ⇧⌘L locks annotations.

## Several objects: align, distribute, rotate (S2.7)

- The **align bar** appears over two or more objects ("3 objects") or artboards ("4 artboards"). **Align** sets
  `left` (or `top`) in px on each object's inline `style` so the edges or middles match the selection's own
  bounds; **Distribute** (three or more) keeps the outer two and spaces the rest evenly. Only objects placed
  freely (`position: absolute`) can be aligned. Artboards: change `x` / `y` in `.meta.json`.
- **Rotate** is `rotate(<n>deg)` in `style.transform` (the handle outside a corner, ⇧ snaps to 15°; also the
  Rotation row). Keep other transform functions; 0° removes the rotate.

## Layout: auto layout, reorder, free placement (S2.11)

- **Gap and padding** are `style.gap` / `style.padding*` on the frame (a Design-system space token when the system
  has the stop). **Reorder** is moving the card's JSX among its siblings — in an auto layout the order in the code
  is the order on the canvas; a copy (⌥-drag) is a duplicate without `data-cd-id` / `data-cd-locked`.
- **Place freely** = `position: "absolute"` plus `left`, `top`, `width`, `height` in px on the card (and
  `position: "relative"` on a static frame). Plain CSS, never a `data-cd-*` attribute. **Constraints** keep edges:
  `right` / `bottom` carry the distance to the frame's edge instead of `left` / `top`; both edges drop `width`.
  Datum with `right: 64px; top: 64px` stays 64 from the corner at every artboard size.

## Text: styles and Czech (S2.12)

- A **style** is a type role of the system: the class `t-<role>` from `components.json` `typeRoles`
  (`className="t-heading"`). **Changing one thing** is an inline declaration over it (`style.fontSize`); **Reset**
  deletes the inline `fontFamily` / `fontSize` / `fontWeight` / `lineHeight` / `letterSpacing` / `textTransform` /
  `fontStyle`. **Detach** inlines the style's values and removes the `t-*` class.
- **Case AA** is `textTransform: "uppercase"`. **Language** is `lang="cs"`; for Czech the copy gets a no-break space
  (U+00A0) after every one-letter word (v k s z o u i a …) and „quotes“ — not inside a URL, an address or `code`.

## Artboard menu: duplicate, duplicate at another width, rename, reset position (S2.10)

- **⌘D / Duplicate** copies the selected artboard to its right, at the gap the row already uses, and selects the copy
  ("Desktop" → "Desktop 2"; press again to keep the rhythm). **⌥-drag** copies to where you drop it. **Duplicate at
  another width ▸** (Laptop 1280, Tablet 834, Mobile 390, Custom) makes the copy with that `width` and the label
  "Desktop (390px)". To do the same by hand: copy the `<DCArtboard>` JSX after its source with a new `id`, a new
  `label` and, for a width copy, the new `width`; **delete every `data-cd-id` and `data-cd-locked` inside the copy**;
  add its `x` / `y` to `layout.artboards[]` in `.meta.json`. Annotations stay with the original.
- **Rename** is the `label` prop (double-click the name, ↵ saves, esc cancels, Tab opens the next artboard's name).
- **Reset position** removes the artboard's `layout.artboards[]` entry: it returns to the default grid.
- Full recipe: `apps/studio/schema/canvas-tsx.md` ("Duplicate an artboard").

## Frames, shapes, corners (S2.13)

- **F / R / More (Line · Ellipse · Polygon)** are drawn with a `<div>` as the last child of the artboard or frame:
  `position: "absolute"` with `left`, `top`, `width`, `height` in px, a **token** for the colour
  (`var(--bg-1)` frame, `var(--accent)` shape, `var(--fg-0)` line). A shape also has `data-shape="rectangle|ellipse|line|polygon"`.
  A circle is `borderRadius: "50%"`, a polygon `clipPath: "polygon(…%)"`, a line a 0-high `borderTop` rotated about `0 0`.
  F on empty canvas is a new `<DCArtboard kind="digital" fixed>` with its place in `layout.artboards[]`.
- **A corner** is `style.borderRadius`: one value while the four are equal, four in CSS order (↖ ↗ ↘ ↙) when they differ;
  prefer a `--radius-*` token. Remove the `border-*-radius` longhands.
- **Export area** writes nothing; export the rectangle with `maude design export`.
- Full recipe: `apps/studio/schema/canvas-tsx.md` ("Draw a frame or a shape").
