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
