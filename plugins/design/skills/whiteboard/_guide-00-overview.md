

# whiteboard — the FigJam-style AI read/write surface

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Separate from element-pinned comments (`skill design` § Comments): the FigJam-style **draw layer** (stickies, text, shapes, arrows, pen, images) persisted as `<designRoot>/<slug>.annotations.svg`. It is a **two-way medium** — the user sketches/brainstorms on it, and the agent both reads it (with artboard AND element context) and writes to it (stickies, labelled shapes, bound connectors, whole tidy templates). Every verb below goes through `maude` (DDR-062), never a raw bin path.

Most of the drawing primitives already existed before this skill (DDR-100, FigJam v3): `create sticky/shape/text/section/arrow`, `connect` (magnetic binds), `group`, `delete`, and `--flow` (auto-laid-out node/edge diagrams). This skill adds the piece that was missing — **element-level read context**, **coordinate-free placement**, and a **template engine** — so the agent never hand-computes a coordinate and never has to guess whether "the button" means an artboard or a DOM element.
