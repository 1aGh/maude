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
