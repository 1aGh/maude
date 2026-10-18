# Annotations v2 — the element model

The whiteboard layer over a canvas (stickies, text, shapes, arrows, pen, images,
links, media references and sections). Decision: [DDR-242](../../.ai/archive/decisions/DDR-242-annotations-v2-element-model.md),
which extends DDR-100 / DDR-223 / DDR-241. Plan:
`.ai/plans/feature-annotations-v2-element-model.md`. Code: `apps/studio/annotations/`.

## Storage

One file per canvas: `<designRoot>/<slug>.annotations.json`. It is versioned, and
it is in the DDR-115 runtime-state lists and the file-membership classifiers.

```json
{"format":"maude.annotations","v":2,"elements":[
{"id":"s_a1","type":"section","index":"a0","x":0,"y":0,"w":1200,"h":800,"label":"Now"},
{"id":"s_b2","type":"sticky","parent":"s_a1","index":"a0","x":40,"y":60,"w":200,"h":200,"text":"make it bigger"},
{"id":"s_d4","type":"arrow","index":"a1","start":{"el":"s_b2"},"end":{"x":300,"y":110}}
]}
```

- **One element per line, deterministic.** Elements are sorted by depth, then
  parent, then `(index, id)`. Keys follow registry order, default-valued keys are
  left out and numbers are rounded to 2 decimals. The same board is the same bytes
  on every machine (`schema.ts` `serializeBoard`).
- **Record:** `{id, type, parent?, index, …type fields, groups?, author?, locked?,
  …extension fields}`. The types are `sticky | text | shape | arrow | pen | image |
  link | mediaref | section`, plus format 2's `stamp | vote | ballot` (below).
  A shape carries `kind` (rect, ellipse, diamond, triangle, triangle-down) and an
  embedded `label` record.
- **Containment is explicit.** A child names its section in `parent`, and its
  `x`/`y` (and its pen points or free arrow points) are relative to that parent.
  Nesting depth is capped at 8, and cycles are cleared on validation.
- **Z-order:** `index` is a fractional key among siblings (`fractional-index.ts`),
  with ties broken by id.
- **Parameters only.** An arrow end is `{el}` (auto-facing), `{el, nx, ny}`
  (pinned magnet) or `{x, y}` (free). Endpoints, arrowheads and wrapped text are
  derived when rendered and never stored.
- **Empty means zero elements** (`elements: []`), never a byte-length heuristic.
  The accepted-revisions lane value is `''` for an empty board (`board-text.ts`).

### Format-2 fields and types (S4.1, V2-1.12 R1–R7)

The file stays `"v": 2` — format 2 only ADDS (R7 would bump `v` and the project
`formatVersion` together). Every addition is an **extension field** or a **new
type**, so a 1.x peer (V2-2.14 lossless readers) keeps all of it and draws what it
knows:

| Field | On | Shape | Meaning |
| --- | --- | --- | --- |
| `parentArtboard` | every type | artboard id | membership: rides with that artboard. `x`/`y` stay WORLD (R2) |
| `source` | every type | `{kind, author?}` | where it came from — `figjam`, `comment`, `template`, … (open word) |
| `timeRange` | every type | `{artboard, start, end}` (s, `end ≥ start`) | a time pin on a video artboard |
| `resolved` | sticky | `{by, at}` (ISO UTC) | resolved, by whom, when; absent = open |
| `folded` | section | `true` | folded to its chip (shared — it is in the file) |
| `startHost` / `endHost` | arrow | `{ref, nx?, ny?, label, box?}` | an end bound to `ab:<artboard>` or `el:<artboard>/<id>[#occ]`. `start` / `end` stay free points caching the last resolved endpoint, so a 1.x peer draws the arrow frozen. Dangling is derived, never stored |
| `sticker` | image | `{pack, id, flip?}` | placed from the Stickers gallery |

| Type | Fields | Rule |
| --- | --- | --- |
| `stamp` | box, `kind`, `pack?`, `target?` | id `stampId({spot, author, kind})` — one per person, kind and spot (`spot` = target id/ref, or the 40 px world cell). A second stamp is an upsert |
| `vote` | `targets`, `title`, `perVoter` (3), `state` (`open`/`ended`), `startedBy/At`, `endsAt`, `endedAt`, `votersDone`, `tallies` | metadata (no geometry, never drawn); its surface is the vote bar. Result section id `voteResultId(id)` |
| `ballot` | `vote`, `voter`, `picks {target: n}`, `castAt` | one per voter, id `ballotId(vote, voter)`, so concurrent voters never write the same element. Others' ballots are hidden in the UI until `state: 'ended'` (`visibleBallots`) — anyone with the FILE can read them. Cloud votes keep ballots on the hub |

- **Byte rule (R5).** Extension fields serialize after `groups`/`author`/`locked`,
  sorted by key, interleaved with any still-unknown keys; a format-2 type
  serializes every non-head key sorted (`sortedKeys`) — the order a 1.x reader
  keeps an unknown type in. A 1.x peer therefore writes the exact bytes a v2 peer
  wrote, and DDR-241 lane hashes agree. Nested values are sanitizeJson fixed points.
- **Typed, not trusted.** A v2 reader parses each field with its spec; an invalid
  value is dropped like any invalid field. A 1.x reader keeps it opaque.
- **No new shapes in old fields (R3).** `start` / `end` never take an `ab:` / `el:`
  host (a 1.x reader would drop the whole arrow, probe B).
- **What a 1.x peer does with it.** Keeps every field and type, renders the arrow
  frozen, never draws a vote or ballot (unknown types render as a placeholder —
  a stamp included), and edits what it knows. A hub-less transport whose v1 peer
  strips unknown keys loses membership and binds (accepted; contract S4 risk 2).
- **`maude migrate v2 --reverse --strip`** removes every extension field and every
  format-2 type and reports each in `lost` (`migrate/steps.ts` `annotations.check`).
  A plain `--reverse` keeps them.
- Pinned by `test/annotations-v2-fields.test.ts`, `test/sync-annotations-v2-mixed.test.ts`
  (both directions, in memory) and `test/annotations-migrate-strip.test.ts`.

## Registry and validator

`registry.ts` lists one `ElementDef` per type (`elements/*.model.ts`): its field
spec in canonical order, its capabilities (box, rotatable, resizable, bindable,
container, text slot) and its geometry (bounds, hit-test, translate, resize,
meaningful). This half is React-free and DOM-free, so the studio, the hub kernel
(Node 24 type-stripping) and the `bin/` verbs all import the same code.
Rendering and toolbar controls live in `annotations/ui/`.

Validation is total and works per element (`registry.ts` `validateElement`,
`schema.ts` `validateElements`):

- A bad element is dropped and reported, never the whole board.
- It applies type and field allowlists, clamps, and the `assets/` and http(s)
  URL rules. It strips prototype keys, and control, bidi and zero-width
  characters.
- It enforces caps: 20k elements, 256 KiB per element, 4 MiB per board.
- An **unknown `type`** is kept verbatim (bounded, sanitized) and renders as a
  placeholder, so an older peer never erases a newer peer's element.

Every board that crosses a trust boundary is peer-authored (DDR-054). This covers
the canvas origin, Yjs peers, hub pushes and files on disk, so every read goes
through this validator.

## Ops and the merge rule

A change is a list of ops (`ops.ts`):

| Op | Shape |
| --- | --- |
| `put` | `{op:'put', el}` — create, or replace wholesale |
| `patch` | `{op:'patch', id, set?, unset?, expect?, strict?}` |
| `delete` | `{op:'delete', id}` |

Move, reparent and reorder are all a `patch` of `x`/`y`/`parent`/`index`; there is
no separate move op. `applyOps` returns `{state, applied, inverse, rejected,
touched}`. The same function runs in the studio (local and legacy shared-doc
mode) and in the hub kernel (accepted revisions), so the merge rule is identical
everywhere:

- different elements never conflict; different fields of one element never conflict
- the same scalar field follows acceptance order, last write wins (DDR-241 §5)
- the same **text** field merges 3-way at character level against `expect`
  (`sync/source-merge.ts`; at most 50 merges per batch, and past that acceptance
  order decides)
- a patch on a missing element is rejected as `gone`, and the client offers to
  restore it; it is never re-created silently
- a `strict` patch (undo) touches only fields that still hold the `expect` value

Structural fix-ups are emitted as ordinary ops, so undo and peers see them.
Deleting an element freezes the arrow ends bound to it into free points.
Deleting a section re-parents the children that are not deleted with it, keeping
their world position.

**Transport.** The canvas sends `POST /_api/annotations/ops` with
`{file, actionId, ops}` and gets back `{ok, changed, rejected[]}`. The route is
canvas-origin reachable and is listed in both allowlists (`http.ts`
`CANVAS_SAFE_API` and the `server.ts` routes). `GET /_api/annotations` returns
the canonical board. A whole-board `PUT /_api/annotations {file, board | svg}` is
kept for imports, restore and headless writers; an `svg` body goes through the
migration. In accepted-revisions mode, the `annotations` lane merges a proposal
by replaying its `base → ours` element diff (`diffToOps`) onto the head with
`applyOps` (hub `project-transactions/lanes.mjs`). The hub advertises the
`annotations-v2` capability.

## Replica

`replica.ts` holds the one codec every Yjs writer uses: the collab room, the
studio sync agent and projection, and the hub kernel.

```
Y.Map('annotations2')   element id → Y.Map(field → JSON value)
  '~v'      = 2          format marker
  '~action' = <actionId> the action behind the last write (echo suppression)
```

- **A new type name on purpose.** A v1 peer keeps writing
  `Y.Map('annotations').svg`, which v2 reads only through the lazy migration,
  and only until `~v` is set. A stale peer therefore cannot erase a v2 board.
- **Writes are diffs.** Only the elements and fields that changed become Yjs
  updates, in one transaction.
- **Reads validate**, because the doc is peer-writable in legacy mode.
- `annotationsEditAt` (DDR-223) is stamped in the same transaction.

## Migration (legacy `.annotations.svg`)

`migrate-boot.ts` `migrateAnnotationsV2` is idempotent and never throws or
deletes. It runs at studio boot (`server.ts`), in the sync bootstrap and in the
hub workspace agent:

- **SVG without a JSON board.** It is parsed with the one legacy parser
  (`legacy/mini-dom.ts`), converted by the pure `migrate-v1.ts` `migrateSvg`, and
  written atomically. The original is snapshotted to
  `_history/<slug>/pre-annotations-v2/` and moved to `_trash/annotations-v1/`.
- **SVG next to an existing board.** The SVG is stale (an old branch or a v1
  peer). It is quarantined to `_trash/annotations-v1/stale-…` and never merged.

A lock under `_state/` serializes concurrent boots. Legacy SVG in hub history
blobs and v1 clients' lane writes is converted lazily
(`board-text.ts` `canonicalAnnotations`: only text starting with `<svg` takes the
legacy path; other markup is refused rather than read as empty). This keeps undo
and restore working across the upgrade. The legacy SVG is peer-authored,
untrusted input: it goes through the same sanitizer and validator.

## UI

- **`ui/board.ts` `BoardStore`.** One store per canvas holds the board as last
  applied: the server state plus this tab's optimistic ops. During a gesture it
  also holds a preview overlay, which never reaches storage. `scene()` gives the
  world-space view (parents resolved, world boxes, arrow endpoints) and is cached
  per version. The layer reads it through `useSyncExternalStore`.
- **Gestures are op batches.** A drag, resize, draw or edit commits once, at
  gesture end, as one batch with one `actionId`. While it is in progress it is a
  local preview (never stored), and collaborators see it over awareness. A
  replica snapshot is rebased onto this tab's batches still in flight, so a
  collaborator's change never hides an edit not yet echoed back.
- **Undo** stores the inverse batch returned by `applyOps`. Replaying it as a
  `strict` patch reverts only fields that still hold this action's values. A
  text undo merges back through the 3-way rule, so a collaborator's later typing
  survives. AI writes never enter a user's undo stack.
- **Per-element projection.** `ui/element-node.tsx` renders every element as its
  own memoized, absolutely positioned node in paint order, so a change re-renders
  only that element. Geometry is a small world-space SVG, and text is HTML in the
  same node (never SVG `<text>` or `foreignObject`), so z-order stays exact.
- **Text.** It is edited in a `<textarea>` that shares the display box
  (`ui/text-editor.tsx`), with an IME guard. `ui/text-session.ts` sends a draft
  patch after about 600 ms of idle typing, and the commit is one undo record,
  from base to final.
- **Input.** One pointer pipeline (`ui/pointer-pipeline.ts`) drives an explicit
  tool state machine. Section-as-subtree semantics (nudge, align, delete, copy,
  Alt-drag, marquee) come from `ui/containment.ts`.
- **Clipboard.** The payload is `{"maudeElements":2,"elements":[…]}` in world
  coordinates. A paste mints new ids.
- **The editing view.** The tools (select, drag, snap, marquee, handles, eraser,
  connectors, the context toolbar) work in world space on a `Stroke` view of each
  element, projected per element and cached by record identity
  (`ui/world.ts` → `v1-adapter.ts` `elementStrokes`). A commit diffs the view
  back into element ops (`strokesToElementMap` + `diffToOps`), so only what
  changed is sent. A type with no stroke form of its own rides the view as an
  `ElementStroke` whose geometry comes from its registry definition — see
  [adding an element type](annotations-v2-adding-an-element-type.md).
  `ui/edit-actions.ts` holds the same edits written directly as element ops, for
  code that works on the board without the view.

## AI surface

Both verbs are reached through `maude design <verb>` (DDR-062) and are built on
the registry, not on a text parser. Spec: `plugins/design/skills/whiteboard/`.

- **`read-annotations`** (`bin/read-annotations.mjs` → `ai-read.ts`) prints
  `{untrusted, elements}`:
  - `box: [x,y,w,h]` in world coordinates, and computed arrow `pts` plus
    `from`/`to`
  - `text` from the element's text slot
  - sections nest their `members` in reading order
  - flags: `--in <section|artboard>`, `--type`, `--rects`, `--canvas-state`,
    `--graph`, `--full`
- **`annotate`** (`bin/annotate.mjs` → `ai-write.ts` `AiBatch`) turns world-coordinate
  requests into `put`/`patch`/`delete`:
  - the ops are `create`, `connect`, `update`, `move`, `reparent`, `reorder`,
    `group` and `delete` (`set-text` and `set-color` are aliases of `update`)
  - it also takes `--flow` and `--board` templates, plus `--near`/`--in`/`--pin`
    placement and `--dry-run`
  - updates carry `expect`, so they merge with concurrent human edits, and
    created elements are stamped `author: {kind: 'ai'}`
  - it writes through a loopback `/_api/annotations/ops` when a server is up, and
    otherwise writes the board file atomically (`board-io.ts`); an unreadable
    board is never written over
