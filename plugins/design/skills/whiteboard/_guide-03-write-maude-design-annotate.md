## WRITE — `maude design annotate`

```bash
maude design annotate "<rel-path>" [--ops <file|-> | --flow <file|-> | --board <file|->]
                       [--near <artboardId>] [--in <artboardId>] [--pin <cdId|selector>]
                       [--no-pointer] [--canvas-state <path>] [--rects <path>] [--dry-run]
```

Every request becomes the same **element ops** the canvas itself sends (`put | patch | delete`, DDR-242), built from the element registry — so the verb can never write an element the canvas wouldn't accept, and a new element type needs no change here. Every created element is stamped `author: {kind: "ai"}`. The verb prints `{ ok, via, file, created, updated, deleted, refs }`:

- `via: "server"` — a live dev-server applied the ops (`POST /_api/annotations/ops`) and every open canvas updated in real time. Only a loopback server is ever contacted.
- `via: "file"` — no server: the resulting board was written directly (canonical, atomic).

**Writes merge; they don't replace the board.** An `update` is a field patch that carries the value you read, so a concurrent human edit to a *different* field or element is kept, and a concurrent edit of the same text merges. Still read before you write — the ids you target come from `read-annotations`.

A board file that exists but isn't a readable board is **never written over** (exit 2). Any invalid request — unknown id/ref, unknown field, a value the type can't hold, a non-section parent — fails loud (exit 2) and writes nothing. `--dry-run` prints `{ dryRun: true, ops }` without writing.

### Effortless placement — never hand-compute a coordinate

- `--near <artboardId>` — place beside the artboard (outside it, to the right).
- `--in <artboardId>` — place INSIDE the artboard (top-left + a 40px inset). Needs `--canvas-state` or `--rects`; an unknown artboard id is a hard error (never a silent mis-place).
- `--pin <cdId|selector>` — place beside a specific ELEMENT resolved from a `--rects` manifest ("drop a note next to the CTA button"). Unknown target = hard error. A created sticky/text also gets a **pointer arrow** (suppress with `--no-pointer` or a per-op `"pointer": false`): its start is bound to the note (it follows the note), its end is a fixed point on the DOM element's edge — a DOM element isn't a board element, so it can't be a bind host.
- Any `create` op may carry its own `"in"`/`"near"`/`"pin"` to override placement for just that op. Without x/y and without any of these, creates line up right of the existing board.

```jsonc
// Pin a callout on a real button, with a pointer arrow:
{ "ops": [ { "op": "create", "type": "sticky", "text": "make this the primary action" } ] }
```
```bash
maude design annotate "ui/Checkout.tsx" --rects /tmp/rects.json --pin a1b2c3d4 --ops -
```

### Ops vocabulary (typed, never raw file content)

Coordinates are **world** coordinates — the ones `read-annotations` prints. Targets are ids, or `@refs` minted earlier in the same batch.

```jsonc
{ "ops": [
  { "op": "create", "type": "sticky", "ref": "@a", "text": "…", "color"?, "x"?, "y"?, "w"?, "h"?,
    "parent"?: "<section|@ref|null>", "in"?, "near"?, "pin"?, "pointer"? },
  { "op": "create", "type": "shape", "shape"?: "rounded|rect|ellipse|diamond|triangle|triangle-down", "text"?: "label", "fill"?, "color"? },
  { "op": "create", "type": "text", "text": "…", "fontSize"? },
  { "op": "create", "type": "section", "text": "title", "w"?, "h"?, "color"? },
  { "op": "create", "type": "arrow", "from": "<id>", "to": "<id>" }       // or x1/y1/x2/y2 for free ends
  { "op": "connect", "from": "<id|@ref>", "to": "<id|@ref>", "label"? },  // bound arrow; label = text at its midpoint
  { "op": "update", "id": "<id|@ref>", "text"?: "…", "color"?: "#…", "bold"?: true, "x"?, "y"?, "w"?, "h"?, "<field>": null },
  { "op": "move", "id": "<id|@ref>", "x": N, "y": N },        // or "dx"/"dy"
  { "op": "reparent", "id": "<id|@ref>", "parent": "<section id|null>" },
  { "op": "reorder", "id": "<id|@ref>", "to": "front|back|forward|backward" },  // or "before"/"after": "<sibling id>"
  { "op": "group", "ids": ["@a", "s_…"] },
  { "op": "delete", "id": "s_…" },
  { "op": "set-text", "id": "…", "text": "…" }, { "op": "set-color", "id": "…", "color": "#…" }   // = update
] }
```

- **Fields come from the registry** (`maude design annotate --help` lists every type and its fields). `text` always means the type's own text — a sticky/text body, a shape's label, a section's title. `color` on a sticky is its paper (`fill`). `null` resets a field to its default. An unknown field or an invalid value is an error, never silently dropped.
- **`create`** without `"parent"` joins the section its centre lands in — where a person dropping it would put it; `"parent": null` keeps it at top level.
- **`update`** patches only the fields you name — every other field (fontSize, bold, rotation, groups, label style…) is untouched. Structure has its own verbs: `parent` → `reparent`, paint order → `reorder`.
- **Locked elements are refused.** An element read back with `locked: true` was pinned by a person: `move`, `update`, `reparent` and `delete` on it — or a `delete` of a section holding one — fail the whole request with a `… is locked` error. Unlock with `{ "op": "update", "id": "…", "locked": false }` **only when the user asked for that element to change**; `"locked": true` pins one. Paint order (`reorder`) and `group` still work on a locked element.
- **`move`** puts the element's world box at `x`/`y` (or shifts it by `dx`/`dy`), then it belongs to the section it landed in (`"keepParent": true` to stay). Moving a section carries its members. An arrow moves only its free ends — one bound at both ends follows its hosts and refuses to move.
- **`reparent`** moves an element into a section (or to top level with `null`) keeping its world position; it refuses a non-section or the element's own subtree.
- **`reorder`** changes one element's order among its siblings; no neighbour is renumbered.
- **`delete`** of a section keeps its members (they move up a level, in place); an arrow bound to a deleted element keeps its end where it was.

A single-element update is a few dozen bytes whatever the board size:

```jsonc
{ "ops": [{ "op": "update", "id": "s_b2", "text": "shipped" }] }
```

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

- **`layout: "columns"`** (default) — one titled section per `groups[].title`, its cards stacked inside as stickies — the section's children, so they read back as its `members` and move with it. An empty `cards: []` still gets a clean, evenly-spaced blank section — a board the team fills in live (a real retro). Card refs are `@sec<i>card<j>`, section refs are `@sec<i>` (0-indexed by group order) — use them in `connections[]`.
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
