

# whiteboard — the FigJam-style AI read/write surface

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Separate from element-pinned comments (`skill design` § Comments): the FigJam-style **draw layer** (stickies, text, shapes, arrows, pen, images) persisted as `<designRoot>/<slug>.annotations.json`. It is a **two-way medium** — the user sketches/brainstorms on it, and the agent both reads it (with artboard AND element context) and writes to it (stickies, labelled shapes, bound connectors, whole tidy templates). Every verb below goes through `maude` (DDR-062), never a raw bin path.

**Storage (DDR-242).** The board file is `{"format":"maude.annotations","v":2,"elements":[…]}`, one element per line. Each element is a flat record `{ id, type, parent?, index, …type fields }`. The types are `sticky | text | shape | arrow | pen | image | link | mediaref | section`; a shape's `kind` is rect/ellipse/diamond/triangle/triangle-down, and its label is an embedded `label` field. Sections are containers: a child names its section in `parent`, and its `x`/`y` are relative to that section. `index` is a fractional z-order key among siblings. Arrows store their binds (`{el}`), never computed endpoints. Don't hand-edit the file, and don't parse it yourself — `read-annotations` gives the world-coordinate view and `annotate` writes through the same ops as the canvas. A legacy `<slug>.annotations.svg` is converted at server boot; the original is kept under `_history/<slug>/pre-annotations-v2/` and `_trash/annotations-v1/`.

Most of the drawing primitives already existed before this skill (DDR-100, FigJam v3): `create sticky/shape/text/section/arrow`, `connect` (magnetic binds), `group`, `delete`, and `--flow` (auto-laid-out node/edge diagrams). This skill adds the piece that was missing — **element-level read context**, **coordinate-free placement**, and a **template engine** — so the agent never hand-computes a coordinate and never has to guess whether "the button" means an artboard or a DOM element.
