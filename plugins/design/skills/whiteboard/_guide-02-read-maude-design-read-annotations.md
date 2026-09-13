## READ — `maude design read-annotations`

```bash
maude design read-annotations "<rel-path>" [--canvas-state <path>] [--rects <path>] [--graph]
```

- Emits a JSON array: `{ tool, id, x, y, w, h, text, color, z }` per stroke, plus `groupIds` (deepest→shallowest), `author` (`"ai"` = created by the annotate verb; absent = human), and on arrows `from`/`to` — the host ids of magnetically **bound** endpoints.
- `--canvas-state <layout.json>` (artboard rects only — the pre-existing lane) adds per stroke: `artboard` (overlap id), `rel: {x,y}` (artboard-relative coords — what survives an artboard move), and a W3C-style `target { source, selector, geometry }` anchor.
- `--rects <manifest>` (the `canvas-rects` output — **this is the new capability**) adds ELEMENT-level context: `element: { cdId, selector, index, artboard, rect, tag, text }` when the annotation's center falls inside an element's rect (deepest/smallest match wins when elements overlap — a card and the button inside it both qualify; the button's smaller rect is picked), or `element: null` for a floating note or one that misses every element. Also supplies the artboard tagging above when `--canvas-state` isn't separately given (a `canvas-rects` manifest already carries `artboards`). When an element resolves, the W3C `target.selector` upgrades from `AnnotationIdSelector` to `{ type: "CssSelector", value: <element.selector> }` — this is the answer to "which element is this annotation drawn over."
- `--graph` wraps the output as `{ annotations, graph: { nodes, edges } }` — bound arrows become edges, the shapes/stickies they connect become labelled nodes. **A user-drawn flow diagram reads back as a graph.**
- **Section membership + reading order** (feature-whiteboard-annotation-improvements) — every `section` annotation additionally carries `members: [{ id, tool, order, x, y, w, h, href? }]`: every OTHER annotation whose center falls inside the section's rect (same smallest-containing-rect convention `--rects` uses for elements, applied to section rects instead), in **spatial** reading order — top-to-bottom, then left-to-right — NOT paint/document order (`z`). This is the answer to "what's in this section, and in what order": a common flow is the user drops several media/stickies **into a section**, then asks "make a video from this" or "turn this into an Instagram carousel" — read the section's `members` rather than hand-computing containment or guessing order from raw x/y. Image members' `href` is the same relative `assets/<sha8>.<ext>` path used everywhere else (resolve it against the design root to read the file). No flag needed — `members` is always present on a `section` annotation, computed from the base parse (works with or without `--rects`/`--canvas-state`).

**Example — understanding a sketch with full context:**

```bash
maude design canvas-rects "ui/Checkout.tsx" --root "$REPO" > /tmp/rects.json
maude design read-annotations "ui/Checkout.tsx" --root "$REPO" --rects /tmp/rects.json
# → [{ tool:"sticky", text:"make this bigger", artboard:"cart-step",
#      element:{ cdId:"a1b2c3d4", tag:"button", text:"Continue" }, ... }]
```
Now the agent knows: this note is about the "Continue" button specifically, on the "cart-step" artboard — not just "somewhere on this artboard."
