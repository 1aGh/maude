# DDR-242 — Annotations v2: a parametrized JSON element model, synced per element

- **Status:** Accepted (direction). Implementation plan: `.ai/plans/feature-annotations-v2-element-model.md`
- **Date:** 2026-09-30
- **Scope:** `repo:maude`, `dept:dev`
- **Extends:** [DDR-100](./DDR-100-annotations-figjam-v3-data-model.md), [DDR-223](./DDR-223-annotations-get-a-per-lane-edit-stamp-and-emptiness-never-beats-content.md), [DDR-241](./DDR-241-accepted-revisions-hub-kernel-and-project-store.md)
- **Amends:** DDR-100 §3, where `update` was deliberately left out of the write verb. This DDR adds it. It also amends DDR-054's table of hub-mutable file types: `<slug>.annotations.svg` becomes `<slug>.annotations.json`.
- **Related:** DDR-029, DDR-050, DDR-054, DDR-067, DDR-088, DDR-089, DDR-091, DDR-115, DDR-151, DDR-158, DDR-165, DDR-226

## Context

An annotation board is stored as ONE sanitized SVG string: the `.design/<slug>.annotations.svg` sidecar, mirrored as the
single value `Y.Map('annotations').svg`. As of 2026-09-29 this has five costs:

- **Sync cost grows with the board.** Every commit PUTs the whole SVG, and the server replaces the Yjs value wholesale.
  The cap is 1 MB, which is about 4–5k stickies.
- **False conflicts and silent reverts.** The hub's DDR-241 merge splits SVG by regex and compares elements as *text*.
  A recomputed arrowhead, or an element written by an older serializer, therefore looks changed on both sides. Both the
  T31 silent revert and the DDR-223 eraser (the empty wrapper is 72 non-empty bytes) came from treating storage bytes as
  the model.
- **Derived data is stored as if the user authored it.** This covers arrowhead polylines with 15–17-digit floats,
  bound-arrow endpoints rewritten on every host move, the sticky's unwrapped `<text>`, and the shape label as a separate
  element linked by `anchorId`.
- **Containment is implicit geometry.** Section membership is recomputed at a few call sites, which is the source of the
  nudge, nesting, Alt-duplicate and marquee bugs.
- **AI agents pay twice.** They read through a second, regex-based parser, and write through delete + recreate, which
  changes ids and breaks comment anchors and bindings.

## Provenance

The direction was chosen by `flow:debate-protocol` (reduce tier, 2026-09-29), with four seats voting blind:

| Seat | Verdict |
| --- | --- |
| BUILDER | parametrized JSON |
| USER-ADVOCATE | parametrized JSON |
| SHIPPER | keep SVG, slim it down |
| BREAKER | keep SVG, slim it down |

All four agreed on these points:

- reject the Excalidraw engine
- reject a two-file JSON + SVG hybrid
- store parameters only, never derived geometry
- add an `update` op
- give every element a stable id

The owner resolved the 2:2 split: migrating the few existing boards is cheap (one idempotent script on start), and the
priority is future scale, so JSON is the source of truth. BREAKER's guardrails are adopted in Decisions 5–6. Its
dissent, quoted: *"a format flip across a mixed-version fleet: an old peer reading JSON sees zero strokes and its next
save can erase every annotation."*

## Decisions

1. **Element record + per-type registry.**
   - Every element is a flat JSON record: `id`, `type`, `parent`, `index`, `x`/`y`/`w`/`h`, `rot`, plus type fields.
   - Types are `sticky | text | shape | arrow | pen | image | link | mediaref | section`.
   - `rect` / `ellipse` / `polygon` merge into `shape` with a `kind` field. The ellipse becomes a box like every other
     shape.
   - A shape label is an embedded `label` field, not a separate element.
   - Sections are containers: children carry `parent` and coordinates relative to the parent. Nesting depth is capped at 8,
     and cycles are rejected.
   - Z-order is a fractional `index` scoped per parent, with ties broken by `id`.
   - `groups` stays a flat tag array, as in DDR-100.
   - An arrow stores its binds `{el, nx, ny, pinned?}` or a free point `{x, y}`, never its computed endpoints.
   - No derived geometry is stored anywhere. Numbers are rounded to 2 decimals.
   - An unknown `type` round-trips untouched and renders as a placeholder, so a newer peer's new element type is never
     erased by an older peer.
   - A registry entry per type owns its field spec, geometry, capabilities, renderer, toolbar controls and AI projection.
     Headless consumers import the React-free half.

2. **Canonical file `.design/<slug>.annotations.json`.**
   - The file is `{"format":"maude.annotations","v":2,"elements":[…]}`, written with one element per line, keys in
     registry order, and a deterministic sort.
   - An empty board is `elements: []`. Emptiness means zero elements, never a byte-length heuristic.

3. **One in-house validator, shared by studio, hub and bin.**
   - It is registry-driven: type and field allowlists, clamps, caps, the `assets/` regexes, proto-key strip, and a cycle
     and depth check.
   - It is type-strippable TypeScript so the Node 24 hub can import it.
   - Validation is per element: a bad element is dropped and reported, never the whole board.
   - valibot was considered and rejected: the hub is the DDR-054 "untrusted to peers" component with a frozen lockfile, and
     about 200 lines of registry-driven validation needs no new supply-chain edge.

4. **Ops, not blobs.**
   - The ops are `put | patch | delete | move`, batched into an action carrying an `actionId`. One gesture is one action and
     one undo record.
   - Undo is the inverse batch. It is peer-safe per field: a field is reverted only while it still holds this action's
     value.
   - Merge rule, identical in every path:
     - different elements never conflict
     - different fields of one element never conflict
     - the same scalar field follows acceptance order (DDR-241 §5)
     - the same text field is merged 3-way at character level (`sync/source-merge.ts`)
     - a `patch` on a deleted element returns `gone`, and the client offers to restore it
   - The echo guard is keyed per `actionId`.

5. **Transport: one replica shape, a new type name.**
   - The replica is `Y.Map('annotations2')`, holding `Y.Map<id, Y.Map<field, value>>`. It deliberately does not reuse
     `annotations`, so an old peer writes a map that v2 never reads.
   - The browser sends `POST /_api/annotations/ops` to its studio. The route is listed in both canvas-origin allowlists
     (DDR-088).
   - In local and legacy shared-doc mode, the studio applies ops in one transaction and stamps `annotationsEditAt`
     (DDR-223) in the same transaction.
   - In accepted-revisions mode, a new kernel operation `annotations.apply` implements Decision 4. `lane.replace` still
     accepts the canonical JSON for bulk, import and restore.
   - Gesture previews travel over awareness. The op commits once, at gesture end.
   - The hub advertises the `annotations-v2` capability and a `minStudioVersion`. A v2 studio will not link a v2 project
     to a hub that lacks the capability. A v2 hub rejects SVG lane content from clients.

6. **Migration: idempotent on every start, never destructive.**
   - `.annotations.svg` without a `.annotations.json` is converted:
     1. parse with the legacy parser and sanitizer
     2. run the pure `v1ToV2`
     3. write atomically
     4. snapshot the original to `_history/<slug>/pre-annotations-v2/`
     5. move the SVG to `_trash/annotations-v1/`
   - This runs at studio boot, in the hub workspace agent, and on hub document load (a `MIGRATION`-origin conversion).
   - Legacy SVG blobs in the hub history are upconverted lazily, so undo and restore across the upgrade keep working.
   - A `.annotations.svg` that reappears next to a `.json` goes to `_untrusted/`. It is never imported silently.

7. **Text system.**
   - All object text renders as HTML in a world-transformed layer. It never uses SVG `<text>` or `foreignObject`.
   - Text is edited in a `<textarea>` that shares the display box, so wrapping is the same in both modes by construction.
   - An IME guard handles WebKit's event order, where `compositionend` fires before the Enter keydown.
   - Every text slot uses one commit policy. The session base snapshot is taken at edit start.
   - A draft patch is sent every 600 ms while idle.
   - A remote edit made while you type shows a chip and is merged on commit. A remote delete offers to restore your text.

8. **Interaction.**
   - One pointer pipeline drives an explicit tool state machine. It replaces about 12 document-level capture listeners and
     the custom-event bus.
   - One selection store handles group and section expansion.
   - Sections act as subtrees for nudge, align, distribute, delete, copy, duplicate and Alt-drag.
   - A marquee started inside a section selects only that section's children.
   - Each element renders through a per-id memoized node.
   - Drag previews use a CSS transform and never touch the store.

9. **AI surface on the registry.**
   - `read-annotations` returns the compact v2 projection: absolute coordinates, computed arrow endpoints, and section
     members in reading order.
   - `annotate` gains `update`, `move`, `reparent` and `reorder`, sent through the same ops path.
   - AI writes stay stamped `author.kind = 'ai'` and never enter a user's undo stack.

## Alternatives rejected

- **The Excalidraw engine or its packages.** `@excalidraw/element` is published only as a snapshot, and it failed
  `Bun.build`. Its element set has no sticky, section, mediaref or link. It uses a two-sided bind index, which DDR-100
  rejected. It would add a React-coupled dependency to the `bun --compile` path (DDR-176 class). Its hit-testing and text
  metrics would change what users see.
- **The tldraw SDK.** Production use needs a licence key, and without one it stops rendering after five seconds. It also
  keeps a second store next to Yjs. We take ideas only (`parentId` + `index`, HTML text in shapes).
- **Konva, Fabric, Paper, Leafer or PixiJS.** Each would replace the SVG/DOM renderer and own the model, and each still
  edits text through a textarea overlay.
- **JSON plus a derived SVG, as two committed files.** The two would drift, and every edit would double the diff.
- **Slim SVG only** (SHIPPER + BREAKER). It is the correct *minimum*, but it keeps the regex merge, whole-blob sync and the
  byte-canonical trap. Once migration is cheap, it is superseded.
- **Y.Text per element.** It works only in legacy mode, because accepted mode makes client Yjs read-only (DDR-241 §7). A
  character-level 3-way merge plus draft patches serves both modes with one mechanism.
- **Rich text** (TipTap or ProseMirror, 58–122 kB gz). Not until there is a product need.

## Execution amendments (2026-09-30, Milestones A–B)

Decided while implementing. These refine the decisions above:

- **The lane value treats an empty board as `''`.** The accepted-revisions lane value (`annotationsLaneValue`) is the
  canonical board text, except that an empty board is `''`, the lane's "no value". Studio and kernel produce it
  byte-identically because it is the DDR-241 base hash. File content still carries the full empty-board JSON.
- **Legacy SVG is upconverted, not refused (refines §5).** The kernel converts legacy SVG (history blobs, v1 clients)
  through the migration. Undo and restore across the upgrade keep working, and a v1 client's edit still lands as a
  per-element diff. Mixed-version safety comes from the capability plus the new replica name, not from refusal.
- **A section adopts only elements it painted under in v1.** An element becomes a section's child only if, in v1, it was
  painted above that section. Otherwise a backing shape under a section would start painting over it (found by the
  Figma-import test).
- **Only real SVG takes the legacy path.** `canonicalAnnotations` treats text as legacy only when it starts with
  `<svg`. Any other markup is refused rather than turned into an empty board; one malformed PUT would otherwise have
  erased a board.
- **One legacy parser everywhere.** Every v2 host parses legacy SVG through `annotations/legacy/mini-dom.ts`, never a
  browser DOMParser, so migration is identical on studio, hub and CLI. Tests assert it matches DOMParser on every
  fixture.
- **No separate `move` op (refines §4).** Move and reparent are a `patch` of `parent` / `index` / `x` / `y`.
- **Arrow ends store magnets only when pinned (refines §1).** An auto end is stored as `{el}`: the magnet facing the
  other end is derived, not stored.
- **Headless verbs and Figma import were bridged early.** They write the v2 board through `v1-bridge-io.ts`; a write
  to `.svg` would have been quarantined by the boot migration. Their full move onto the registry is plan Task 27.

## Consequences

- The sidecar name changes. It must be updated in all four runtime-state lists (DDR-115) and in both file-membership
  classifiers, or the file plane classifies `.annotations.json` as `'never'`.
- The unsanitized doc→file writes (`sync/agent.ts` `writeAnnotationsIfChanged`, hub `workspace-files.mjs`) must run the v2
  validator. This closes a pre-existing DDR-054 gap.
- Stable element ids unblock anchoring comments to annotations (issues #134 and #136).
- A new element type becomes one registry file plus a conformance test, instead of about 18 files.
