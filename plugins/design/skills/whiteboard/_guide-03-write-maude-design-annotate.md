## WRITE — `maude design annotate`

```bash
maude design annotate "<rel-path>" [--ops <file|-> | --flow <file|-> | --board <file|->]
                       [--near <artboardId>] [--in <artboardId>] [--pin <cdId|selector>]
                       [--no-pointer] [--canvas-state <path>] [--rects <path>] [--dry-run]
```

Everything renders through the canonical serializer + allowlist sanitizer — the verb can never emit a shape the canvas wouldn't. Every created stroke is stamped `data-author="ai"`; the verb prints `{ ok, via, file, refs }` (`via:"server"` = a live dev-server applied it and open canvases update in real time; `"file"` = direct write). The write is **last-write-wins over the whole SVG** — read before you write, and don't interleave with a user who is actively drawing.

### Effortless placement — never hand-compute a coordinate

- `--near <artboardId>` — place beside the artboard (outside it, to the right). Pre-existing.
- `--in <artboardId>` — place INSIDE the artboard (top-left + a 40px inset). Needs `--canvas-state` or `--rects`; an unknown artboard id is a hard error (never a silent mis-place).
- `--pin <cdId|selector>` — place beside a specific ELEMENT resolved from a `--rects` manifest ("drop a note next to the CTA button"). Unknown target = hard error. A created sticky/text also gets a **pointer arrow** to the element's edge by default (suppress with `--no-pointer` or a per-op `"pointer": false`) — a visual snapshot, not a magnetic bind (a DOM element isn't an annotation stroke, so it can't be a bind host).
- Any `create` op may carry its own `"in"`/`"near"`/`"pin"` field (+ `"pointer": false`) to override placement for just that op — the same resolution rules, scoped to one card in a batch.

```jsonc
// Pin a labelled callout on a real button, with a pointer arrow:
{ "ops": [
  { "op": "create", "type": "sticky", "text": "make this the primary action", "color": "#fce8a6" }
] }
```
```bash
maude design annotate "ui/Checkout.tsx" --rects /tmp/rects.json --pin a1b2c3d4 --ops -
```

### Raw ops vocabulary (typed, never raw SVG)

```jsonc
{ "ops": [
  { "op": "create", "type": "sticky", "ref": "@a", "text": "…", "color"?, "x"?, "y"?, "w"?, "h"?, "in"?, "near"?, "pin"?, "pointer"? },
  { "op": "create", "type": "shape", "shape": "rounded|rect|ellipse|diamond|triangle|triangle-down", "ref"?, "label"?, "x"?, "y"?, "color"?, "fill"? },
  { "op": "create", "type": "text", "text": "…", "x"?, "y"?, "fontSize"? },
  { "op": "create", "type": "section", "label": "…", "x"?, "y"?, "w"?, "h"?, "color"? },  // organizing container
  { "op": "connect", "from": "<id|@ref>", "to": "<id|@ref>", "label"? },  // BOUND arrow — follows its hosts
  { "op": "group", "ids": ["@a", "s_…"] },
  { "op": "delete", "id": "s_…" },
  { "op": "move", "id": "<id|@ref>", "x": N, "y": N },
  { "op": "set-text", "id": "<id|@ref>", "text": "…" },       // patches a section's "label" instead, when that's the tool
  { "op": "set-color", "id": "<id|@ref>", "color": "#…" }
] }
```

`move`/`set-text`/`set-color` are **id-preserving** — the target is read through the canonical parser, patched, and re-serialized, so every OTHER attribute (custom fontSize, bold/italic/dashed, rotation, groupIds, cornerRadius, …) survives untouched. DDR-100 deliberately omitted a general `update` for LWW honesty; these three stay narrow and still whole-file LWW like every other op. Not every tool supports every op — arrows/pen have no single position, anchored text has no independent position, image/link/mediaref have no single color/text field. Unsupported combinations fail loud (exit 2); the fallback for anything these three don't cover is `delete` + `create`.

### `--flow` — auto-laid-out node/edge diagrams

```jsonc
{ "nodes": [{ "id", "label", "shape"? }], "edges": [{ "from", "to", "label"? }] }
```
Layered left→right auto-layout, connected with BOUND arrows. `--near`/`--in` places the whole diagram relative to an artboard. Round-trips: `read-annotations --graph` returns the same nodes/edges.

### `--board` — the universal template generator (the "make me a FigJam board" surface)

```jsonc
{
  "title"?: "…",
  "layout"?: "columns" | "grid" | "lanes" | "radial" | "flow",   // default "columns"; "grid"/"lanes" alias it
  "groups"?: [ { "title": "…", "color"?: "#…", "cards": ["plain string", { "text": "…", "color"?: "#…" }] } ],
  "nodes"?: [...], "edges"?: [...],                              // only for layout:"flow" — same shape as --flow
  "connections"?: [ { "from": "@sec0", "to": "@sec1", "label"? } ]
}
```

- **`layout: "columns"`** (default) — one titled section per `groups[].title`, its cards stacked inside as stickies. An empty `cards: []` still gets a clean, evenly-spaced blank section — a board the team fills in live (a real retro). Card refs are `@sec<i>card<j>`, section refs are `@sec<i>` (0-indexed by group order) — use them in `connections[]`.
- **`layout: "radial"`** — a central shape (labelled by `title`) with every group's cards ringed around it. Refs: `@center`, `@idea<i>`.
- **`layout: "flow"`** — needs `nodes[]`/`edges[]` instead of `groups[]`; delegates straight to the SAME auto-layout as plain `--flow`, so a user-flow diagram is not a separate implementation.
- `--near`/`--in`/`--pin` position the WHOLE board as a unit, exactly like a single create op.
- Mutually exclusive with `--ops`/`--flow`.

**This engine is generic — the named templates below are fixtures YOU compose, not flags the CLI understands.** Fill in real content (the user's actual retro items, actual social posts, actual flow steps) — never placeholder/lorem text.

#### Preset fixtures (fill in real content, then pass via `--board`)

**Retro** — pick the ritual the user asked for. Color-code the columns (green/amber/blue reads at a glance) and give Action items an owner + due date convention (there's no separate metadata field per card — encode both in the card text itself, e.g. `"Fix the flaky deploy step — @owner: Sam, due: Fri"`):
```jsonc
{ "groups": [
  { "title": "What went well", "color": "#bbf7d0", "cards": [] },
  { "title": "What to improve", "color": "#fef08a", "cards": [] },
  { "title": "Action items", "color": "#bfdbfe", "cards": [] }
] }
```
Alternatives: *Start / Stop / Continue*; *Mad / Sad / Glad* — same 3-column color treatment, different titles. Leave `cards: []` for the team to fill live during the meeting, or seed them if the user already gave you the items (a sprint retro request like "team sprint retro" or "vytvoř mi team sprint retro" with no specifics yet still gets this ritual + color treatment, just blank). If the user wants a "warm start" rather than a cold blank board, seed ONE lightweight facilitation prompt per column instead of a real item (e.g. `"💬 What made this sprint feel good?"` in *What went well*) — visually distinct from real content (a different color or a leading `💬`), never counted as the user's own retro item. **Card count:** 3–5 per column is typical for a focused retro; don't over-seed a board the team is about to fill live.

**Kanban** — color cards by priority (red/amber/green) when the user's backlog implies urgency, not by column:
```jsonc
{ "groups": [
  { "title": "To do", "cards": [ /* real backlog items — { text, color? } for a priority tag */ ] },
  { "title": "Doing", "cards": [] },
  { "title": "Done", "cards": [] }
] }
```

**Social-media content calendar** (one column per day, seed with the user's real post ideas — one card per planned post is typical, empty days stay `cards: []` rather than padded with placeholders):
```jsonc
{ "groups": [
  { "title": "Mon", "cards": ["…"] }, { "title": "Tue", "cards": ["…"] },
  { "title": "Wed", "cards": ["…"] }, { "title": "Thu", "cards": ["…"] },
  { "title": "Fri", "cards": ["…"] }, { "title": "Sat", "cards": ["…"] },
  { "title": "Sun", "cards": ["…"] }
] }
```

**Roadmap** (one column per quarter/milestone; color by theme/workstream if the user's items imply one, e.g. all "platform" items one color):
```jsonc
{ "groups": [
  { "title": "Q1", "cards": ["…"] }, { "title": "Q2", "cards": ["…"] },
  { "title": "Q3", "cards": ["…"] }, { "title": "Q4", "cards": ["…"] }
] }
```

**Brainstorm** (radial — a topic with radiating ideas):
```jsonc
{ "title": "How do we grow retention?", "layout": "radial",
  "groups": [ { "cards": ["idea 1", "idea 2", "idea 3", "…"] } ] }
```

**Checklist** (one section, cards as check items):
```jsonc
{ "groups": [ { "title": "Pre-launch checklist", "cards": ["…", "…", "…"] } ] }
```

**User flow / flowchart:**
```jsonc
{ "layout": "flow",
  "nodes": [ { "id": "landing", "label": "Landing" }, { "id": "signup", "label": "Sign up" },
             { "id": "done", "label": "Onboarded", "shape": "ellipse" } ],
  "edges": [ { "from": "landing", "to": "signup" }, { "from": "signup", "to": "done", "label": "verified" } ] }
```
