# Adding an annotation element type

Annotations are v2 elements ([DDR-242](../../.ai/archive/decisions/DDR-242-annotations-v2-element-model.md)).
A type is **one definition**. Validation, the board file, ops and merge, the Yjs
replica, the hub lanes, hit-testing, moving, selecting, the AI verbs
(`read-annotations`, `annotate`) and rendering all dispatch through the registry.
None of them branches on the type name.

## The definition

A type is an `ElementDef` (`apps/studio/annotations/types.ts`). Put it in
`apps/studio/annotations/elements/<type>.model.ts`:

```ts
export const stamp: ElementDef = {
  type: 'stamp',                        // /^[a-z][a-z0-9-]{0,31}$/
  fields: { ...BOX_FIELDS, glyph: str({ max: 8, plain: true }) }, // canonical key order
  caps: { box: true, rotatable: false, resizable: true, bindable: true,
          container: false, textSlot: null },
  bounds: (el) => boxOf(el),            // PARENT space, unrotated
  hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol),
  translate: translateBox,              // field patch
  resize: resizeBox,                    // field patch fitting a box
  meaningful: (el) => boxOf(el).w >= 8, // false = a mis-tap, discarded
};
```

- **Fields.** Use the helpers in `annotations/fields.ts` (`num`, `str`, `color`,
  `oneOf`, `text`, `record`, …). A value that fails its spec becomes the default
  or rejects the element, so a peer can never inject markup, script URLs or
  prototype keys. Defaults are omitted on disk.
- **Coordinates.** They are relative to `parent` (a section). The scene
  (`annotations/scene.ts`) resolves world space, so moving a section moves its
  contents with no ops on them.
- **Text.** Set `caps.textSlot` (`'text'` field, `'label'` record, `'title'`
  string) and concurrent typing merges 3-way, drafts sync while typing, and the
  one textarea editor opens on double-click.

## Wiring it in

1. Add it to `DEFS` in `annotations/registry.ts`. A plugin or a test registers it
   at runtime with `registerElementType(def)` instead.
2. Give it a view in `annotations/ui/element-node.tsx` (`VIEWS`), or call
   `registerElementView(type, View)` at runtime. Wrap the view in `ElementBox`
   (the positioned node). Without a view it still draws, as a labelled
   placeholder.
3. Add a sample record to `SAMPLES` in
   `apps/studio/test/annotations-v2-registry-conformance.test.ts`. The suite fails
   until you do. It checks that the spec round-trips, that hostile input is
   refused, that bounds, translate and resize agree, the hit test, ops with
   their inverse, AI read and write, the whiteboard round trip, and the render.

The whiteboard's editing tools work on a world-space view of each element.
A type without a legacy stroke form rides that view as an `ElementStroke`
(`tool: 'element'`), and its geometry comes from the definition, so select,
move, marquee, copy/paste, delete and undo work unchanged. The conformance
suite's `stamp` proves this end to end.

## What an older build does with your type

It keeps the element verbatim, bounded and sanitized
(`validateElement` → unknown type). It draws the element as a placeholder, never
drops it, and never lets its own writes erase it. Ship the type freely: peers
on older versions stay safe.
