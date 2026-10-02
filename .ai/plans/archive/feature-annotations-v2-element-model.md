# Feature: Annotations v2 — parametrized element model, per-element sync, rebuilt text + containment

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.
The line numbers below were taken on 2026-09-29 (HEAD `612ba084`). Re-grep before you edit: `~/git` is a Syncthing tree with concurrent sessions.

## Description

Today an annotation board (stickies, text, shapes, arrows, pen, images, links, media, sections) is stored as a single
sanitized SVG string: the `.design/<slug>.annotations.svg` sidecar, mirrored as one LWW value in
`Y.Map('annotations').svg`. Every edit re-sends the whole board. The hub merges by regex-splitting SVG text. Derived
geometry (arrowhead polylines with 15–17-digit floats, bound-arrow endpoints, sticky `<text>` copies) is stored as if the
user had authored it. Containment in sections is recomputed from geometry at each call site. Four text editors each
follow different commit rules.

This feature replaces the storage and transport with a **parametrized JSON element model** (one validated record per
element, stable ids). The records are synced **per element**, by field-level ops, in both sync modes (legacy shared doc and
accepted revisions). A **one-shot migration** runs on app/hub start. On top of the new model it rebuilds the three
weakest UI areas: **text editing**, **section containment / marquee / selection**, and a **per-type element registry**,
so a new object type is one file instead of ~18.

Origin: `flow:debate-protocol` run on 2026-09-29 (BUILDER · SHIPPER · BREAKER · USER-ADVOCATE, reduce tier). All four seats
rejected the Excalidraw engine and the two-file hybrid, and agreed on "params only, no derived geometry", an `update` op
and stable ids. The seats split 2:2 on whether the container should be JSON or slim SVG. The owner resolved it: migration
is cheap (few users, one script on start), optimise for future scale → JSON source of truth. BREAKER's guardrails are
kept (versioned lane, capability gate, no-erase rule, unknown-type passthrough).

## User Story

As a designer drawing on a Maude canvas with teammates and AI agents, I want annotations to feel exactly like today, but
faster and without lost edits. I want to type in a sticky or shape without glitches, move a section with everything in it,
and have an agent patch one sticky without the board flickering, so that the whiteboard stays trustworthy at any board
size.

As an AI agent, I want to read a compact JSON projection and write single-element patches, so that reading and editing a
board costs tokens proportional to what I touch, not to the board size.

## Problem

Evidence is from research on 2026-09-29. File refs are relative to `apps/studio/` unless noted.

1. **Sync cost grows with the board.** Every commit PUTs the whole SVG (`annotations-layer.tsx:1233-1283`). The server
   replaces `Y.Map.svg` wholesale (`sync/codec.ts:294-340`). The cap is 1 MB (`sync/limits.ts:18`), roughly 4–5k stickies.
2. **False conflicts and silent reverts.** The hub merge (`apps/hub/src/project-transactions/lanes.mjs:157-235`) splits SVG
   by regex and compares element *text*. A recomputed arrowhead, or an element written by an older serializer, therefore
   looks edited on both sides. This caused the silent-revert fix in `annotation-edit-base.ts` (DDR-241 T31) and the DDR-223
   "eraser" (the empty wrapper is 72 non-empty bytes).
3. **Derived data is stored as authored data.** Bound-arrow endpoints are rewritten whenever a host moves
   (`annotations-bindings.ts` `recomputeBoundArrows`). Arrowhead polylines, the sticky's unwrapped `<text>`, and the shape
   label as a separate `text` element (`anchorId`) are all stored too. Under per-element sync each of these becomes extra
   writes and extra conflicts.
4. **Text editing is the buggiest surface.** There are four `contentEditable` editors with different blur, outside-click and
   snapshot rules (`annotations-layer.tsx:4376/4535/4679/5410`). None handles IME: there are zero `composition` or
   `isComposing` references, and WKWebView fires `compositionend` before the Enter keydown. Read view and edit view use
   different layouts: labels and standalone text render as SVG `<text>` without wrapping while the editors wrap, so text
   jumps. Peer-overwrite (issue #106 C3) is still live for standalone text and section titles (`:4152`, `:4833`). A peer
   deleting the element you are editing drops your text (`:2974-2978`). There is no live persistence while typing, so a
   crash loses the edit.
5. **Sections are implicit geometry.** Membership is centre-in-box, computed only at drag start (`:2482-2498`) and in
   `bin/read-annotations.mjs:690-747`. Confirmed bugs:
   - Nudge, align, distribute and group-resize leave the contents behind (`:1356`).
   - Nested sections break (`:2491`, `:2189`).
   - Alt-duplicate moves the *original's* children (`:2462-2497`).
   - A marquee started inside a section selects the section (`:2643-2653`).
   - Delete, copy and duplicate ignore the contents.
   - The chip hit area exists in three drifting copies (`annotations-model.ts:1820`, `annotations-layer.tsx:606`, `:5373`).
6. **No element registry.** Adding a kind touches about 18 files and 60+ sites. There are two SVG parsers (`svgToStrokes` and
   the regex reader in `bin/read-annotations.mjs:473-497`) and a duplicated bindable list (`bin/annotate.mjs:288` vs
   `isBindable`), which have already drifted.
7. **Render and interaction cost.** One 6.2k-line component and about 12 document-level capture listeners. Drag re-maps
   every stroke and re-renders the whole layer on each pointer move (`:2535-2568`). `StrokeNode` isn't memoized. The store
   identity changes on every tick (`:1459`). Undo stores full before/after array snapshots, which aren't peer-safe
   (`commands/annotation-strokes-command.ts:62-93`).
8. **AI surface.** `annotate` has no `update` (DDR-100 §3, delete+recreate). That flickers for peers, breaks comment
   anchors (#134/#136 need stable `annotationId`) and breaks arrow binds. Agents read through a second, regex-based
   parser.

## Solution

### Architecture decisions (record as DDR-2xx in Task 1)

**AD1 — Element record, one registry.** Every element is a flat JSON record validated against its type's spec:

```jsonc
{ "id": "st_8f2k", "type": "sticky", "parent": "sec_1", "index": "a1V",
  "x": 40, "y": 50, "w": 200, "h": 160, "rot": 0,
  "fill": "#ffe27a", "text": "ship it", "fs": 14, "align": "left",
  "groups": ["g_a"], "author": { "kind": "ai" } }
```

- `type` ∈ registry: `sticky | text | shape | arrow | pen | image | link | mediaref | section`. The three shape kinds merge
  into **`shape` + `kind`** (`rect|ellipse|diamond|triangle|triangle-down|…`), so kind conversion is a field change, not a
  cast (`annotations-model.ts:378-425`). The ellipse becomes a box (x, y, w, h), like every other shape.
- **Shape labels are an embedded `label` field on the shape** (Excalidraw "bound text"). There is no separate `text`
  element with `anchorId`. "One label per shape" is enforced by construction.
- **`parent` + parent-relative coordinates for containment** (tldraw model). A section is a container, and nesting is
  allowed with a depth cap of 8 and cycle rejection. Moving a section is **one write**, whatever it contains. Reparenting
  happens at gesture end (drop into / out of a section), never from geometry at read time.
- **`index`** is a fractional index (vendored `fractional-indexing`, CC0) scoped per `parent`, with ties broken by `id`.
  Concurrent reorders therefore converge without rewriting neighbours.
- **`groups`** stays a flat tag array (DDR-100 §1). It maps 1:1 onto per-element records.
- **Arrow binds store no derived geometry**: `start` / `end` = `{ el, nx, ny, pinned? }` *or* `{ x, y }` when free.
  Endpoints are computed at render time and in the AI projection. A host move writes only the host.
- **No derived geometry anywhere.** No arrowheads, no polygon vertices, no link-card layout, no list markers. Numbers are
  rounded to 2 decimals. Pen points become a flat `[x0,y0,x1,y1,…]` array, capped by the existing
  `maxAnnotationPoints: 8192` (`scripts/dev/sync-e2e/contracts/limits.mjs:19`).
- **Unknown `type` round-trips untouched.** It renders as a labelled placeholder box and is never dropped (BREAKER: a newer
  peer's new tool must not be erased by an older one).

A **registry entry** (`apps/studio/annotations/elements/<type>.ts[x]`) owns everything about a type:
- `spec` (fields, clamps, defaults, v1-migration)
- geometry (`bounds`, `hitTest`, `translate`, `resize`, `rotate?`)
- capabilities (`bindable`, `container`, `textSlot`, `resizable`, `rotatable`, `aspectLock`)
- `Render` (memoized)
- toolbar controls
- the AI projection (`toAi` / `fromAiOp`)

Headless consumers import the React-free half (`*.model.ts`), and the canvas imports the `*.view.tsx` half (the DDR-067
single-source rule applied per type).

**AD2 — Canonical file `.design/<slug>.annotations.json`.**

```jsonc
{"format":"maude.annotations","v":2,
"elements":[
{"id":"sec_1","type":"section",...},
{"id":"st_8f2k","type":"sticky",...}
]}
```

- One element per line. Keys are in the registry's field order. Elements are sorted by `(parent-depth, parent, index, id)`.
- The byte form is deterministic, so git diffs show exactly which element changed and git merges are usually line-clean.
- The empty board is `"elements":[]`. Emptiness is "zero elements", never a byte-length heuristic (this retires the DDR-223
  wrapper trap by construction).

**AD3 — One in-house validator, shared studio ↔ hub ↔ bin.**
- `apps/studio/annotations/schema.ts` is React-free, DOM-free, and plain type-strippable TS (no enums or parameter
  properties), so the Node 24 hub can import it the way the Dockerfile already COPYs `annotations-model.ts`
  (`apps/hub/Dockerfile:79-84`).
- It is registry-driven: type allowlist, field allowlist, numeric clamps, string caps, the `assets/<sha8>` href/src regexes
  carried over from `ASSET_IMAGE_HREF_RE` / `ASSET_MEDIA_SRC_RE`, `__proto__` / `constructor` / `prototype` stripping (DDR-054
  §2g), a parent-cycle / depth check, and a per-element byte cap plus an element-count cap.
- *valibot was considered.* The research measured it at 1.2 kB gz, but the hub is the DDR-054 "untrusted to peers" component
  with a frozen lockfile, and a registry-driven validator of about 200 lines needs no new supply-chain edge. Swap it in
  later only if the specs outgrow hand validation.

**AD4 — Ops, not blobs. Same op shape everywhere.**

`AnnotationOp = put(el) | patch(id, fields, expect?) | delete(id) | move(id, parent, index, x, y)`

- An **action** is an ordered op batch with an `actionId`. One user gesture is one action and one undo record.
- **Undo is the inverse op batch**, not a full snapshot. It is peer-safe at field granularity: undo reverts only the fields
  this action set, and only while they still hold this action's value; otherwise it reports "changed by someone else"
  (DDR-241 §6 effect semantics, per element).
- **Field-level merge rule** (identical in the legacy Y path, the kernel, and cold start):
  - Different elements never conflict.
  - Different fields of one element never conflict.
  - The same scalar field follows acceptance order: last accepted wins, as DDR-241 §5 specifies for ordinary same-property
    edits.
  - The same **text** field is merged 3-way at character level, reusing `apps/studio/sync/source-merge.ts` `mergeSource`
    with `expect` as the base.
  - `patch` on a deleted element returns `gone`. The client surfaces it and offers "restore", and never re-creates silently.
- The echo guard becomes per-`actionId` (it replaces the whole-SVG `writeId` + string compare in `annotations-sync.ts`).

**AD5 — Transport per sync mode, one replica shape.**
- **Replica:** new Y type **`annotations2`** = `Y.Map<id, Y.Map<field, value>>`. Scalars are stored natively; arrays and
  objects (points, binds, groups) are stored as frozen JSON values. A **new name, not the old `annotations` map**: old clients
  keep writing `annotations.svg` into a map new clients never read. A stale peer therefore cannot erase a v2 board, which is
  the DDR-223 failure class removed by construction.
- **Browser → studio:** `POST /_api/annotations/ops {file, actionId, ops}`. It replaces `PUT /_api/annotations {svg}` and
  must be added to **both** `CANVAS_SAFE_API` (`http.ts:5852`) and the `startCanvasServer` routes map (`server.ts:~520`),
  guarded by a `GET → 405` test (CLAUDE.md two-allowlist rule, DDR-088). `GET` returns the canonical JSON.
- **Local-only / legacy shared-doc mode:** the studio server validates, then applies ops to `annotations2` in one
  `transact` with the per-lane `annotationsEditAt` stamp (DDR-223 §1), then projects the file.
- **Accepted-revisions mode (DDR-241):** new kernel operation **`annotations.apply {doc, ops, base?}`** implementing AD4's
  merge rule in `apps/hub/src/project-transactions/`. `applyLane` writes per-element keys with a server origin. The store
  keeps the lane blob as canonical v2 JSON, so `lane.replace` for annotations still works (bulk / import / restore), with
  merge-by-id upgraded to merge-by-field.
- **Gesture previews never hit storage.** An in-progress drag, resize or draw streams over **awareness**, so peers see live
  motion. The op commits once at gesture end, which also keeps Y.Map tombstone growth bounded (y-utility finding). This is
  the one visible UX *gain*.
- **Capability gate:**
  - The hub advertises `annotations-v2` in `/health` `capabilities` (`apps/hub/src/server.mjs:906`) and in accepted
    bootstrap `capabilities.lanes/operations` (`hub-integration.mjs:650-660`), and adds `minStudioVersion`.
  - A v2 studio refuses to link a v2 project to a hub without the capability, with a clear message and no degraded write
    path.
  - A v2 hub fences `annotations.apply` / `lane.replace` carrying SVG from a v1 client (`checkLane` rejects `<svg`).
  - The studio reads `minStudioVersion` and shows "update required".
  - There is no gate today (research, 2026-09-29). This task creates it, for this and all future format changes.

**AD6 — Migration: one idempotent step on every start, never destructive.**
`migrateAnnotationsV2(designRoot)` does the following for each `*.annotations.svg` with no `.annotations.json`:
1. Parse with the existing `svgToStrokes` + `sanitizeAnnotationSvg`.
2. Apply the pure `v1ToV2` transform:
   - anchored text → host `label`
   - rect / ellipse / polygon → `shape`
   - section membership computed **once** from today's centre-in-box rule → `parent` + relative coords
   - array order → fractional `index`
   - bound-arrow stored endpoints dropped
   - legacy `tool` names mapped
3. Write JSON atomically (tmp + rename).
4. Snapshot the original to `_history/<slug>/pre-annotations-v2/`.
5. Move the SVG to `_trash/annotations-v1/`.

Log one line per file. It never throws, and the steady state is a no-op. This mirrors `sync/migrate-flat-fallback.ts:1-97`
and `sync/migrate-seed.ts:458-475`.
- **Studio:** a new general boot hook in `server.ts`, because today's migrations only run inside the linked sync runtime. It
  is skipped under `cellPairing`, where the hub owns the checkout (`sync/index.ts:2227-2237`).
- **Hub / cells:**
  - The workspace agent migrates the checkout.
  - On document load, a `MIGRATION`-origin transaction converts a persisted `annotations.svg` into `annotations2` (SQLite
    Hocuspocus persistence, `server.mjs:717`) and stamps `syncMeta.annotationsFormat = 2`.
  - The kernel upconverts legacy SVG history blobs lazily in `checkLane` / `readLane`, so undo and restore keep working.
    Today `opRestore` silently `continue`s on a blob that fails `checkLane` (`kernel.mjs:683-706`).
  - The studio `.ydoc.bin` cache is discarded when its `annotationsFormat` is below 2.
  - Queued SVG proposals in `_state/outbox/` are upconverted before send (`transaction-client.ts:138,218`).
- A **reappearing** `.annotations.svg` next to an existing `.json` (a stale peer or old git branch) is never imported
  silently. It goes to `_untrusted/` with an index entry (`sync/untrusted.ts:123-147`), and the user can import it
  explicitly.

**AD7 — Text system: one component, HTML text layer, textarea editor.**
- **All object text renders as HTML** in a world-transformed layer sibling to the SVG ink layer. It never uses SVG `<text>`
  and never `foreignObject`, whose WebKit transform bugs (WebKit 23113 / 165516) are the reason DDR-158 moved editors out.
  Display and editor share **one** CSS box and class (`white-space: pre-wrap; overflow-wrap: anywhere`, explicit px font,
  identical padding), so wrapping is identical by construction.
- **Editing uses a plain `<textarea>`** that replaces the display box in place (Excalidraw `textWysiwyg` pattern). It gives
  native IME, caret, selection, spellcheck and undo in WKWebView. `contenteditable` and the custom caret are removed for
  object text. Whole-element bold / italic / strike / underline and list type stay element fields (DDR-091 list markers stay
  display-only); rich text is out of scope.
- **IME guard:** `composingRef` is set on `compositionstart` and cleared one tick after `compositionend`. Treat
  `isComposing || keyCode === 229 || composingRef` as composing: no commit, no remote apply, no Enter handling.
- **Auto-grow:** on each `input`, set `height:auto`, read `scrollHeight`, and apply it to the local preview. The sticky / shape
  height commits with the text. Grow-only for stickies, as today, so the UX doesn't change.
- **One commit policy for every text slot** (sticky, text, shape label, section title):
  - Enter commits, Shift+Enter inserts a newline, Esc cancels, and blur or an outside click commits.
  - A single guard prevents double commit.
  - The session snapshot of the base text is taken at edit start: this closes issue #106 C3 for all slots, including
    standalone text and section titles, where it is still live.
  - **Draft persistence:** the text is patched with `expect` = session base every 600 ms idle and on commit. Peers see
    typing land in about 1 s, a crash loses under 1 s, and each patch is one small op.
- **Remote changes while editing:**
  - A remote edit to the same field is shown as a small "edited by X" marker and is not applied to the textarea.
  - On commit the three-way character merge (AD4) combines both edits.
  - A peer delete keeps the editor open with "deleted by X — keep my text?", which offers restore; it never drops text.
- **Zoom:** the editor is CSS `scale(zoom)` like the world. Below an editing-zoom floor (0.5), double-click first zooms to
  the element so the caret stays visible (Mozilla 865930 class).
- **Headless measurement** (`read-annotations`, the `canvas-rects` static fallback, export): committed `h` is stored, so no
  measurement is needed. Standalone text stores measured `w` / `h` at commit instead of today's character-count estimate
  (`annotations-model.ts:2105`). `@chenglou/pretext` (0.0.9) is **not** adopted: it is pre-1.0 and doesn't support
  `system-ui` fonts.

**AD8 — Interaction: one pointer pipeline + explicit tool state machine.**
- Replace the ~12 document-level capture listeners and `CHROME_SELECTOR` races with **one** pointer pipeline on the
  annotation root, feeding a small explicit state machine:
  `idle → pointing → {dragging | marquee | resizing | rotating | drawing | connecting} → idle`, plus `editingText`. Each state
  owns its handlers and cleanup (tldraw state-chart *idea*, no dependency).
- Replace the document custom-event bus (`maude:chain-create`, `bind-hint`, `resize-info`, `enter-text-edit`,
  `editor-format*`, the `setTimeout(0)` handshake at `annotations-layer.tsx:3163`) with store actions.
- **Selection store:** one store holding `selectedIds`, `focusGroup` and `focusParent`.
  - It prunes ids when elements vanish.
  - Group and section expansion happens in one function, not at each call site.
- **FigJam-parity containment rules (kept UX, bugs fixed):**
  - A click inside a section selects the child, as today.
  - The section is grabbed by its ring or chip, as today.
  - Nudge, align, distribute, delete, copy, duplicate and Alt-drag all act on the section **as a subtree**, because children
    are relative to it.
  - Dropping an element whose centre lands in a section reparents it at gesture end; dragging it out unparents it.
  - A marquee started on empty canvas selects top-level elements it touches, as today. A marquee started **inside** a
    section selects only that section's children, never the section.
  - A new section is inserted **above** the section it is drawn inside (the nesting fix).
  - The section chip hit area comes from **one** registry function in screen space; the three copies are deleted.
- **Render performance:**
  - `ElementNode` is memoized per id and subscribes to its own record via `useSyncExternalStore` selectors, so a change
    re-renders only the changed element.
  - Drag applies a CSS transform to the selected nodes and bound arrows **without touching the store** until gesture end.
  - Chrome (handles, toolbar) reads the store and camera through a single rAF-coalesced subscription instead of per-frame
    `querySelector` / `getBoundingClientRect` (`annotations-context-toolbar.tsx:547-587`).
  - `rbush` (4.0.1, MIT) is added **only if** the 5k-element perf row shows hit-test or marquee above budget. A linear AABB
    scan is fine below about 2k.

**AD9 — AI surface on the registry.**
- `read-annotations` returns the compact v2 JSON: absolute coords projected, computed arrow endpoints, section members in
  reading order, and optional `--in <section|artboard>` / `--type` filters. It imports the registry model (no regex parser).
  `annotate` gains `update {id, …fields}`, `move`, `reparent` and `reorder`, sends ops through the same
  `/_api/annotations/ops` path (or direct file write when no server runs), and drops happy-dom (`bin/annotate.mjs:641-690`).
- Every AI op stays stamped `author:{kind:'ai'}` and never enters a user's undo stack (DDR-100 §3).
- The bindable list, the creators and the help text come from the registry, which removes the duplicated list at
  `annotate.mjs:288`.
- Token benchmark (Task 30) is an acceptance gate: ≥ 3× smaller read on the fixture board, and a single-element write
  ≤ 40 tokens whatever the board size.

### Explicitly rejected (keep in the DDR)

- **The Excalidraw engine or its packages.** `@excalidraw/element` is snapshot-only and failed `Bun.build`. Its element set
  lacks sticky, section, mediaref and link. It would bring a two-sided bind index (rejected in DDR-100) and a React-coupled
  dependency in the `bun --compile` path (DDR-176 class). Its hit-test and text-metric changes would be visible to users.
- **The tldraw SDK.** A production license key is required, and without one it stops rendering after five seconds. It also
  has a second store beside Yjs. We take ideas only.
- **Konva, Fabric, Paper, Leafer, PixiJS.** Each would replace SVG/DOM rendering and own the model (a rewrite). They still use
  a textarea overlay for text.
- **JSON + derived SVG as two committed files** (drift, doubled diffs).
- **Slim SVG only** (SHIPPER + BREAKER). It is the right *minimum*, but it keeps regex merge, whole-blob sync and the
  byte-canonical trap. It is superseded once migration is cheap.
- **Y.Text per element for concurrent typing.** It only works in legacy mode, because accepted mode makes client Yjs
  read-only (DDR-241 §7). The character-level 3-way merge on commit and draft patches serve both modes with one mechanism.
- **Rich text (TipTap/ProseMirror, 58–122 kB gz)** until there is a product need.
- **perfect-freehand for the pen:** it would change the pen's look (a UX change). It is a candidate only behind a visual
  parity decision, out of scope here.

## Metadata

- **Ticket**: none (tracker `github`). Related open issues:
  - [1aGh/maude#134](https://github.com/1aGh/maude/issues/134) and [1aGh/maude#136](https://github.com/1aGh/maude/issues/136)
    need stable annotation ids for comment anchors; this plan provides them.
  - [1aGh/maude#106](https://github.com/1aGh/maude/issues/106): the C3 residue is closed by AD7.
- **Type**: Refactor + Enhancement (storage, transport, UI architecture)
- **Complexity**: High. Cross-package: studio, hub, cells, CLI bins, plugins docs, desktop e2e; data migration.
- **App/Package**: `apps/studio` (primary), `apps/hub`, `apps/cells`, `cli/`, `plugins/design`, `scripts/dev/sync-e2e`, `apps/desktop/e2e`
- **Affected Systems**: annotation model and render, text editing, selection and interaction, undo, studio API, collab
  bridge, sync agent, projection, cold start, accepted-revisions kernel and store, workspace agent, file plane membership,
  git grouping, gitignore taxonomy, AI verbs, FigJam import, perf harness, multiplayer surface rig.
- **Dependencies**: vendored `fractional-indexing` (CC0, ~1.5 kB, copied with its license header into
  `apps/studio/annotations/fractional-index.ts`; no new npm edge in the hub). Optional, gated: `rbush@4.0.1` (studio only).
  No other new deps.
- **Relation to open plans**:
  - `followup-multiplayer-parity-issues.md` Tasks 3–4 (comment anchors to `annotationId`, world coords) should land
    **after** Milestone B, so they anchor to v2 ids. Its perf-fixture slug fix is absorbed into Task 3 here.
  - `feature-post-1.0-hardening-backlog.md`: check for overlapping annotation items before starting.

---

## Context References

### Must-Read Files

> When consuming this section during `/flow:execute`, **read every file listed here in parallel in a single assistant message**.

- `apps/studio/annotations-model.ts`. Why: the Stroke union (86-332), serializer (1014-1271), parser + clamps (1369-1600),
  hit/bbox/translate (1743-2111) and sanitizer (2158-2275). These are the v1→v2 source of truth and the migration input.
- `apps/studio/annotations-layer.tsx`, in sections. Why:
  - load/observe/save: 1160-1283
  - commitStrokes/undo: 1305-1459
  - pointer pipeline: 1863-2229, 2353-2700
  - editors: 2792-3272, 4107-4840, 5410-5440
  - render: 5263-5950
- `apps/studio/annotations-context-toolbar.tsx` (490-790, 1017-1131). Why: capability matrix and setters to re-express
  from the registry.
- `apps/studio/annotations-bindings.ts`, `annotations-groups.ts`, `annotations-snap.ts`, `annotations-align.ts`. Why:
  pure helpers that move behind the registry.
- `apps/studio/use-annotation-resize.tsx` (154-449, 711-763), `use-annotation-selection.tsx`, `text-caret.ts`,
  `input-router.tsx` (66-201), `use-tool-mode.tsx` (87-102). Why: resize math, selection, and the tool vs kind confusion.
- `apps/studio/commands/annotation-strokes-command.ts`, `undo-stack.ts` (120, 270). Why: the snapshot undo to replace, and
  the 512 KB sessionStorage cap.
- `apps/studio/annotations-sync.ts`, `annotation-edit-base.ts`. Why: the echo guard and base semantics being retired.
- `apps/studio/sync/codec.ts` (294-340, 426-455, 599-624), `sync/limits.ts`, `sync/agent.ts` (344-356 is an
  **unsanitized** doc→file write, 416-490, 586-618), `sync/migrate-seed.ts`, `sync/cold-start.ts` (202-290),
  `sync/projection.ts` (716-729, 945, 1155-1166), `sync/accepted-cold-start.ts`, `sync/transaction-client.ts` (17-57, 138,
  218, 314), `sync/index.ts` (496-507, 2227-2237, 2380-2387, 3871-3880), `sync/file-membership.ts` (222-241),
  `sync/file-plane.ts:2324`, `sync/untrusted.ts` (123-147), `sync/migrate-flat-fallback.ts`, `sync/source-merge.ts:80`.
- `apps/studio/api.ts` (2067-2155, 2970-2976), `http.ts` (2402-2451, 5852), `server.ts` (116-131, ~520),
  `collab/persistence.ts` (19-26, 222-305), `collab/registry.ts` (115-130), `collab/index.ts` (82-142),
  `collab/origins.ts:55`, `canvas-artifacts.ts` (114-119), `git/watch.ts:33`, `client/panels/git-grouping.js`,
  `client/app.jsx` (12670-12681).
- `apps/hub/src/project-transactions/lanes.mjs` (11-309), `kernel.mjs` (144, 251, 297-345, 578-590, 683-706),
  `hub-integration.mjs` (122-189, 595-660), `baseline.mjs`, `store-core.mjs` (19-118), `apps/hub/src/workspace-files.mjs`
  (117-263, an **unsanitized** write), `workspace-agent.mjs` (400-622), `file-membership.mjs` (135-147), `server.mjs`
  (717, 906), `apps/hub/Dockerfile` (79-84).
- `apps/studio/bin/read-annotations.mjs`, `bin/annotate.mjs`, `bin/_import-figma.mjs` (556-586, 1102-1107),
  `figma/to-strokes.ts`.
- `cli/lib/gitignore-block.mjs`, `cli/lib/gitignore-drift.mjs`, `cli/lib/design-link.mjs` (804-868), `.gitignore`
  (11, 124-126).
- `plugins/design/skills/whiteboard/` (SKILL.md, `_guide-02`, `_guide-03`, `_guide-05`),
  `plugins/design/references/new/17-6b-*.md` (the `ANNOT_SHA` ingest trigger), `commands/board.md`.
- `scripts/dev/sync-e2e/contracts/schemas.mjs` (224-254, a draft `annotation.create/update/delete` contract), `limits.mjs`.
- `apps/desktop/e2e/multiplayer/surface.e2e.ts` (28, 494, 645-661, `stickyDisk()`), `scenarios/canvas-text-editing.e2e.ts`,
  `fixtures/project/.design/ui-smoke.annotations.svg`.
- Decisions: DDR-029, 050, 054, 060, 067, 089, 091, 100, 102, 115, 151, 158, 165, 223, 226, 241. Use `kg search` first;
  the full text is in the graph.
- RCAs: `.ai/logs/rca/issue-106.md`, `.ai/logs/rca/issue-dogfood-feedback-2026-08-12-whiteboard-and-splash.md`.

### Files to Create

- `apps/studio/annotations/schema.ts`: element record types, the generic field-spec validator, caps, canonical
  serializer / parser for AD2.
- `apps/studio/annotations/registry.ts`: type registry, capability queries, unknown-type placeholder.
- `apps/studio/annotations/elements/{sticky,text,shape,arrow,pen,image,link,mediaref,section}.model.ts` + `.view.tsx`.
- `apps/studio/annotations/ops.ts`: op types, `applyOps`, `invertOps`, the field-merge rule (AD4), `diffToOps`.
- `apps/studio/annotations/store.ts`: client element store, selectors, action / undo integration.
- `apps/studio/annotations/replica.ts`: the `annotations2` Y.Map codec (read / apply / observe / emptiness / stamp).
- `apps/studio/annotations/fractional-index.ts`: vendored with its CC0 header.
- `apps/studio/annotations/migrate-v1.ts`: pure `v1ToV2(strokes)` + `migrateAnnotationsV2(designRoot)` boot step.
- `apps/studio/annotations/text/{TextBlock.tsx,TextEditor.tsx,ime.ts,draft.ts}`: AD7.
- `apps/studio/annotations/interaction/{machine.ts,pipeline.ts,selection-store.ts,containment.ts}`: AD8.
- `apps/hub/src/project-transactions/annotations-apply.mjs`: the `annotations.apply` op + field merge. It imports the
  shared schema / ops.
- `apps/studio/test/annotations-v2-*.test.ts` (schema, ops, migrate, replica, store, text, containment),
  `apps/hub/test/annotations-apply.test.mjs`.
- `apps/studio/test/fixtures/annotations-v2/` (golden v1 → v2 pairs from `phase-20/21-annotations.svg`,
  `figjam-v3-groups-bindings.svg`, `ui-smoke.annotations.svg`, plus nested-sections and bound-arrow boards).
- `.ai/scenarios/annotations-v2/spec.md` + `covers.json`.
- `.ai/archive/decisions/DDR-2xx-annotations-v2-element-model.md` (Task 1).

### Design canvases

No `.design/**/*.meta.json` canvas is tagged or named for annotations, whiteboard or sticky. This feature is studio chrome,
not a designed surface. **UX reference = the current behaviour.** Before Task 4, capture golden screenshots of the fixture
boards at zoom 0.5, 1 and 2 in light and dark themes. Task 34's visual-parity gate compares against them.

### Documentation

- [Excalidraw textWysiwyg](https://github.com/excalidraw/excalidraw/blob/master/packages/excalidraw/wysiwyg/textWysiwyg.tsx). Why: textarea overlay positioning, container auto-grow and the IME guard (AD7).
- [tldraw rich text / shapes](https://tldraw.dev/sdk-features/rich-text). Why: the HTML-text-in-shape pattern, and `parentId` + fractional `index` (ideas only; the SDK licence is incompatible).
- [rocicorp/fractional-indexing](https://github.com/rocicorp/fractional-indexing) and [vlcn: fractional indexing](https://vlcn.io/blog/fractional-indexing). Why: equal keys under concurrent inserts, hence the tie-break by id.
- [yjs/y-utility YKeyValue](https://github.com/yjs/y-utility). Why: Y.Map overwrite history growth, hence commit at gesture end and previews over awareness.
- [Liveblocks Yjs best practices](https://liveblocks.io/docs/guides/yjs-best-practices-and-tips). Why: nested-map granularity and transaction batching.
- [contenteditable plaintext-only baseline](https://web.dev/blog/contenteditable-plaintext-only-baseline) and [cline #14114](https://github.com/cline/cline/pull/14114). Why: WebKit IME ordering, and why we pick `<textarea>`.
- [WebKit bug 23113](https://bugs.webkit.org/show_bug.cgi?id=23113). Why: foreignObject transform bugs (no foreignObject for text).

### Patterns to Follow

- **Boot migration:** `apps/studio/sync/migrate-flat-fallback.ts:1-97` (best-effort, never throws, quarantine not delete,
  one log line per move, no-op steady state) and `sync/migrate-seed.ts:458-475` (pre-migration snapshot into `_history`).
- **Per-lane stamp:** `sync/codec.ts:599-624` `stampAnnotationsEdit`, stamped in the **same** transaction (DDR-223 §1).
- **Kernel op + merge:** `apps/hub/src/project-transactions/lanes.mjs` `mergeById` (reuse and extend to fields);
  `kernel.mjs:297-345` `opLaneReplace` (op skeleton, footprint, effects).
- **Capability advertisement:** `sync/journal-client.ts:187-218` reads `/health` `capabilities` (DDR-226 §10).
- **Canvas-origin route:** add to both `CANVAS_SAFE_API` and the `startCanvasServer` routes map, and assert `GET → 405` in
  `test/canvas-origin-gate.test.ts` (DDR-088).
- **React-free model for headless consumers:** `annotations-model.ts` is imported by `bin/annotate.mjs` and the hub
  Dockerfile. Keep `*.model.ts` free of React and DOM.
- **Runtime-state taxonomy:** four lists + mirror (CLAUDE.md, DDR-115). `.annotations.json` is VERSIONED, and
  `_trash/annotations-v1/` is already runtime (`_trash/`).

---

## Design Decisions

### Components (from registry)

| Component | Source | Notes |
| --------- | ------ | ----- |
| Canvas world + portal | `apps/studio/annotations-layer.tsx` (DDR-029 portal into `.dc-world`) | Kept. The SVG ink layer and the new HTML text layer are siblings under the same world transform. |
| Context toolbar | `annotations-context-toolbar.tsx` | Kept visually. Controls become a projection of registry capabilities. |
| Tool palette, cursors, icons | `tool-palette.tsx`, `canvas-cursors.ts`, `canvas-icons.tsx` | Unchanged visually. Entries come from the registry. |
| Resize handles | `use-annotation-resize.tsx` | Kept visually. Per-kind math moves to `registry.resize`. |

### Existing screens / blocks reused

No new screens. The annotation layer, context toolbar, palette, comments pins and presence cursors are reused as they are.
The user-visible target is **pixel parity** with the golden screenshots, except for the intended fixes: wrapping text in
labels and standalone text now matches the editor; a section moves with its contents; live drag previews from peers
appear.

### Icons

No new icons. A placeholder for unknown types reuses the existing generic-file glyph from `canvas-icons.tsx`.

### Tokens

Studio chrome tokens are unchanged (`apps/studio/client/styles/*`). One fix: a new shape label defaults to the
theme-aware foreground token instead of the hard-coded `#1a1a1a` (`annotations-layer.tsx:2859`), which vanishes on dark.

### Custom Components Needed

| Component | Reason | Extends |
| --------- | ------ | ------- |
| `TextBlock` / `TextEditor` | One display+edit box for every text slot (AD7) | replaces 4 editors + 3 read renderers |
| `ElementNode` | Memoized per-id renderer dispatching to `registry[type].Render` | replaces `StrokeNodeBase` chain |
| `UnknownElement` | Placeholder that round-trips unknown types | new |
| "Edited by X" / "Deleted by X — keep my text?" chips | Remote-change feedback while editing | existing toast/chip styles |

---

## Tasks

Execute in order. Milestones are shippable checkpoints: A–B land storage **under the current UI** through an adapter, so
users see nothing change until C–E replace the UI internals piece by piece. Every task ends with `/flow:utils-verify`.
**Run the `apps/studio` `bun test` suite alone**, never alongside the hub suite (memory: parallel runs fabricate
failures). Check `git status apps/studio/dist/` before and after every studio test run (CLAUDE.md dist-clobber rule).

### Milestone 0 — Decision, baseline, safety net

### Task 1: ADD DDR + kg decision for annotations v2

- **Do**: Write `.ai/archive/decisions/DDR-2xx-annotations-v2-element-model.md` containing AD1–AD9, the rejected list and
  the debate provenance (seats, split, owner resolution). Mark it as extending DDR-100, DDR-223 and DDR-241, and **amend**
  DDR-100 §3 ("`update` deliberately absent" is superseded) and DDR-054's hub-mutable file table (`.annotations.json`).
  Then run `maude kg import --dry-run` followed by `maude kg import`.
- **Validate**: `kg search "annotations v2"` returns the node with SUPERSEDES / EXTENDS edges.

### Task 2: ADD characterization tests of today's behaviour (must pass on the current code)

- **Do**: Before touching anything, pin today's semantics that v2 must keep or deliberately change:
  - hub annotations-lane merge cases: independent edits merge, same element conflicts (none exist today; only `html` is
    tested, `apps/hub/test/project-transactions.test.mjs:625-671`)
  - section membership centre-in-box, including edge-on-border
  - sticky grow-only
  - group expansion to the outermost group
  - bound-arrow facing-anchor
  - undo of a multi-select move
- **Gotcha**: Tests that encode a *bug* (nudge leaves children, marquee selects the section, Alt-duplicate) are written as
  `test.todo` with the RCA reference. They flip to real assertions in Milestone D.
- **Validate**: `cd apps/studio && bun test test/annotations-*.test.ts`; `pnpm --filter @maude/hub test`.

### Task 3: UPDATE perf + fixture tooling and record baselines

- **Do**:
  - Fix the perf fixture slug (`perf-canvas.mjs` writes `ui-perf_fixture.annotations.svg`, the server reads
    `ui-perf-fixture`).
  - Add a **mixed** generator (all kinds, bound arrows, nested sections, in view) at 200, 1000 and 5000 elements.
  - Record `perf.sh --fixture` baselines for Chromium and Safari (load time, drag p95, React renders during drag).
  - Record the surface rig baseline: `node scripts/dev/sync-e2e/surface-run.mjs --mode baseline` over L09 / L10.
  - Capture the golden screenshots (see Design canvases).
- **Validate**: The baseline JSON and screenshot paths are recorded in the plan's Execution Log.

### Milestone A — Model, registry, validator, migration transform (pure, no I/O)

### Task 4: CREATE `annotations/schema.ts` + `registry.ts` + `fractional-index.ts`

- **Do**:
  - Implement AD1–AD3: the element types, the generic field-spec validator (type and field allowlists, clamps, caps,
    `assets/` regexes, proto-key strip, parent cycle / depth ≤ 8, per-element ≤ 64 KB, ≤ 20 000 elements, whole file
    ≤ 4 MB), and the canonical serialize / parse (one element per line, registry field order, sort key).
  - Implement the registry API and `UnknownElement` passthrough.
  - Vendor fractional-indexing with its CC0 header, plus `indexBetween(a, b, tieId)`.
- **Pattern**: `annotations-model.ts` sanitizer clamps (~1369) and `ASSET_*_RE`.
- **Gotcha**: The code must be type-strippable TS for Node 24 in the hub: no `enum`, `namespace` or parameter properties.
  Validation is **total**: a single bad element is dropped and reported, never the whole board (the DDR-223 lesson).
- **Validate**: `bun test test/annotations-v2-schema.test.ts`, which covers fuzzed hostile input (proto keys, NaN, huge
  arrays, cycles, `javascript:` hrefs), golden canonical bytes, and parse(serialize(x)) = x.

### Task 5: CREATE element models for all 9 types (`elements/*.model.ts`)

- **Do**: For each type, write the spec, defaults, `bounds`, `hitTest`, `translate`, `resize`, `rotate` and capabilities,
  ported from `annotations-model.ts` (hit/bbox/translate/canRotate/applyDrawModifiers), `use-annotation-resize.tsx:374-449`
  and `annotations-bindings.ts` / `annotations-align.ts`.
  - `shape` absorbs rect, ellipse and polygon.
  - `section` gets a **single** chip-geometry function in screen space.
  - `arrow` computes endpoints from binds (the `facingAnchor` logic).
- **Gotcha**: Keep the existing numeric behaviour: the Task 2 characterization tests must pass against the registry
  functions through the adapter in Task 8.
- **Validate**: `bun test test/annotations-v2-elements.test.ts`, plus the Task 2 tests re-pointed at the registry.

### Task 6: CREATE `annotations/ops.ts` (apply / invert / field-merge / diff)

- **Do**:
  - Implement AD4:
    - `applyOps(state, ops) → {state, effects, rejected}`
    - `invertOps`
    - `mergeField(base, ours, theirs, kind)`, where text uses `sync/source-merge.ts` `mergeSource`
    - `diffToOps(before, after)`, used by the adapter
    - move / reparent semantics that convert absolute ↔ relative coords
  - These are pure, React-free and shared with the hub.
- **Validate**: `bun test test/annotations-v2-ops.test.ts`, as a table test covering:
  - different elements
  - different fields
  - same scalar field
  - same text field (both inserts survive)
  - patch-after-delete → `gone`
  - reparent vs move
  - concurrent `indexBetween`
  - undo when a peer changed the field since (reports, doesn't revert)

### Task 7: CREATE `annotations/migrate-v1.ts` pure transform `v1ToV2`

- **Do**:
  - anchored text → `label`
  - rect / ellipse / polygon → `shape`
  - sections: compute membership once with today's centre-in-box rule, deepest containing section wins, then convert to
    relative coords
  - array order → `index`
  - drop bound endpoints
  - map legacy tools and attributes (DDR-089 corners, DDR-090 highlighter flag, DDR-091 lists)
  - An unmappable v1 element becomes a `pen` / `shape` best effort, or a reported drop. **Never a silent drop.**
- **Validate**: `bun test test/annotations-v2-migrate.test.ts` with the golden pairs in
  `test/fixtures/annotations-v2/`. For every fixture, the **render-geometry parity** check must hold: v1 `strokeBBox` ==
  v2 absolute `bounds` within 0.01, arrows connect the same hosts, text is identical, z-order is identical.

### Milestone B — Storage + transport + migration (current UI via adapter)

### Task 8: CREATE `store.ts` + Stroke ⇄ Element adapter; route `commitStrokes` through ops

- **Do**:
  - Build the client element store (`useSyncExternalStore`, per-id selectors).
  - Build a temporary adapter that projects v2 elements into today's `Stroke[]` and turns
    `commitStrokes(next, before)` into `diffToOps(before, next)`.
  - Undo records become inverse op batches (replacing `annotation-strokes-command.ts` snapshots). The undo stack's
    sessionStorage stores ops, so the 512 KB cap stops biting large boards.
- **Gotcha**: The adapter is deliberately temporary. Mark it `// v2-adapter: removed in Task 26` so it can't become
  permanent.
- **Validate**: `bun test test/annotations-layer.test.ts test/annotation-strokes-command.test.ts test/annotations-v2-store.test.ts`.

### Task 9: CREATE `replica.ts` (`annotations2` Y codec) + UPDATE `sync/codec.ts`, `limits.ts`

- **Do**:
  - Implement `readReplica`, `applyOpsToReplica` (one `transact`, same-transaction `annotationsEditAt` stamp),
    `observeReplica` (per-key events → store), `isEmptyReplica` (zero keys), and `syncMeta.annotationsFormat = 2`.
  - Extend `laneValueFromFile` / `readLaneFromDoc` to canonical JSON.
  - Redefine the caps per AD3.
- **Gotcha**: Never write the old `annotations.svg` key from v2 code. Read it **only** in the migration step (Task 14).
- **Validate**: `bun test test/annotations-v2-replica.test.ts test/sync-codec.test.ts`.

### Task 10: UPDATE studio API + routes + collab bridge to ops

- **Do**:
  - `api.ts`:
    - `annotationsPath` → `.annotations.json`
    - `loadAnnotations` / `saveAnnotations` / `projectAnnotations`: validate, atomic write, `announceWritten`
    - duplicate-canvas copy (2970-2976)
  - `http.ts`: `GET /_api/annotations` (JSON) and `POST /_api/annotations/ops`, in **both** allowlists plus `server.ts`
    routes, with a `GET → 405` test on `/ops`.
  - Replace `onAnnotationsChanged`'s whole-SVG propose with `applyOps` (legacy) or `proposeAnnotations` (accepted, Task 12).
  - `collab/persistence.ts`, `collab/registry.ts` and `collab/index.ts` switch to the new filename regex and per-element
    seed / persist.
  - The echo guard moves to per-`actionId`.
- **Gotcha**: The **unsanitized** doc→file writes (`sync/agent.ts:344-356`, `apps/hub/src/workspace-files.mjs`) must run the
  v2 validator. This closes a pre-existing DDR-054 gap; note it in the DDR.
- **Validate**: `bun test test/annotations-api.test.ts test/collab-annotations-bridge.test.ts test/canvas-origin-gate.test.ts test/annotations-persist-race.test.ts`.

### Task 11: UPDATE sync runtime (agent, projection, cold start, seed, file plane)

- **Do**:
  - `agent.ts`: fs ↔ replica apply, adopt and cold-start table.
  - `projection.ts`: `laneOfPath` / `pathOfLane`; `accepted-cold-start.ts`; `migrate-seed.ts` (`docIsEmpty` reads the
    replica); `cold-start.ts` `decideAnnotationsColdStart`, where emptiness = zero elements and the DDR-223 table is kept
    verbatim.
  - `index.ts` descriptors, relay (3871-3880) and scan.
  - `tombstone-apply.ts`, `materialize.ts`, `untrusted.ts`.
  - `file-membership.ts` **and** the byte-identical `apps/hub/src/file-membership.mjs`: `.annotations.json` → `canvas-owned`
    (flat and in-group). Without this, the file plane classifies it as `'never'`.
  - `file-plane.ts:2324`: the asset scan covers `.annotations.json`.
- **Validate**: `bun test test/sync-annotations-cold-start.test.ts test/sync-file-membership.test.ts test/sync-agent.test.ts test/sync-tombstone-apply.test.ts test/shared-doc-*.test.ts test/sync-accepted-projection.test.ts` (the full `test/sync-*.test.ts` lane is the CI `quality.tests` gate).

### Task 12: ADD kernel op `annotations.apply` + JSON lane in the hub

- **Do**:
  - New `annotations-apply.mjs`: validate with the shared schema, merge with the shared `ops.ts` field rule, footprint,
    and effects per element (DDR-241 §6).
  - `lanes.mjs`:
    - `checkLane`: JSON validate, and **reject `<svg` from clients**
    - `mergeLane`: per-field over parsed elements, replacing `splitSvg` / `mergeSvg`
    - `applyLane`: per-element `annotations2` keys, server origin, stamp
    - `readLane`: canonical JSON
    - **legacy SVG blobs upconvert lazily** in `checkLane` / `readLane` through `v1ToV2`
  - `kernel.mjs`: undo and restore over upconverted blobs (no silent `continue`).
  - `hub-integration.mjs`: bootstrap `capabilities`.
  - Studio `transaction-client.ts`: `proposeAnnotations(ops)`, with outbox upconvert of queued SVG proposals.
  - Dockerfile: COPY the new shared modules. Check `apps/hub/Dockerfile` builds frozen (CLAUDE.md).
- **Validate**: `pnpm --filter @maude/hub test` (new `annotations-apply.test.mjs`: independent, same-field, text-merge,
  gone, undo-ABA, restore of a pre-v2 blob), and `bun test test/sync-transaction-client.test.ts test/sync-accepted-*.test.ts`.

### Task 13: ADD capability + min-version gate

- **Do**:
  - Hub `/health` gets `capabilities += 'annotations-v2'` and `minStudioVersion`. The accepted bootstrap gets
    `capabilities.lanes` / `operations`, and the studio's `Bootstrap` type now reads them.
  - Studio: refuse to link a v2 project to a hub lacking the capability (clear UI message, no degraded write path), and
    show "update required" when below `minStudioVersion`.
  - Cells: nothing beyond the hub image version (`apps/cells` tests: route paths only).
- **Validate**: `bun test test/sync-*.test.ts` plus a new `test/annotations-v2-capability.test.ts`, with the four
  combinations {old|new hub} × {old|new studio}. The old-studio case is simulated by writing `annotations.svg` into the old
  map: assert that v2 peers are unaffected and nothing is erased.

### Task 14: ADD migration step (studio boot, hub/cells, caches)

- **Do**:
  - `migrateAnnotationsV2(designRoot)` per AD6. It needs a new boot call in `server.ts` (all modes) and stays skipped
    under `cellPairing`.
  - Hub:
    - the workspace agent migrates checkout files
    - on document load, a `MIGRATION`-origin transaction converts `annotations.svg` into `annotations2` and stamps the format
    - store `migrate()` needs no schema bump, because blobs upconvert lazily. If a bump proves necessary, use
      `STORE_SCHEMA_VERSION = 2` with `schema-version.mjs` downgrade detection.
  - Studio: `.ydoc.bin` with format < 2 → discard and rebuild from file or hub.
  - Reappearing `.annotations.svg` next to `.json` → `_untrusted/` + index entry, plus an explicit import action.
  - The design-link adopt manifest (`cli/lib/design-link.mjs:804-868`) moves to the new filename.
- **Gotcha**:
  - Order matters: migrate **before** the canvas scan and before any cold-start decision, or a cold start could compare a
    v1 hub against a v2 local.
  - It must be idempotent under concurrent start, so use a lock file under `_state/`.
  - The `ANNOT_SHA` ingest trigger (`plugins/design/references/new/17-6b-*.md`) will see a new file. Hash the canonical
    JSON and note in the step doc that the first run after migration re-ingests once, by design.
- **Validate**: `bun test test/annotations-v2-migrate-boot.test.ts`. It runs on `ui-smoke.annotations.svg`, the phase-20/21
  fixtures and this repo's 14 `.design/*.annotations.svg` copied to a temp dir, then runs again (no-op) and runs
  concurrently (single winner). Then a hub test migrates a persisted legacy doc.

### Task 15: UPDATE repo taxonomy lists, git, CLI

- **Do**: Add `*.annotations.json` as VERSIONED everywhere and keep the `.svg` entries for the migration window:
  - `.gitignore` (11, 124-126)
  - `cli/lib/gitignore-block.mjs` + test
  - `cli/lib/gitignore-drift.mjs` `VERSIONED_PATTERNS` + test
  - `cli/commands/doctor.mjs:183`
  - `git/watch.ts:33` `isVersionable`
  - `git/endpoints.ts:400`, `client/panels/git-grouping.js` `ANNOT_RE`
  - `canvas-artifacts.ts:114-119`
  - `apps/studio/git/service.ts` comment
  - `CLAUDE.md` taxonomy paragraph
- **Gotcha**: `.json` next to `.meta.json` triggers `fs:json` HMR (`fs-watch.ts:59`). Make sure `.annotations.json` goes to
  the annotations path, not a meta reload.
- **Validate**: `pnpm test` (CLI node tests), `bun test test/git-*.test.ts test/canvas-artifacts.test.ts`.

### Task 16: MIGRATE this repo's and the e2e fixture's committed sidecars

- **Do**:
  - Run the migration on this repo's 14 `.design/*.annotations.svg` and on `apps/desktop/e2e/fixtures/project/.design/ui-smoke.annotations.svg`,
    and commit the `.json` files.
  - Update `fixture-guard.ts` to the new file.
  - Keep the old SVG fixtures under `test/fixtures/` as migration inputs.
- **Validate**: `git show HEAD --stat` lists only the intended files. Desktop e2e `canvas-text-editing` still passes after
  Task 22 (run it now to catch fixture breakage).

**Milestone B exit gate:** the full studio suite (alone), the hub suite, the surface rig in `--mode candidate --baseline`
over L09 / L10 (no cell that passed in the baseline may fail now), and the golden screenshots equal. Users on the current
UI see no change.

### Milestone C — Text system

### Task 17: CREATE the HTML text layer + `TextBlock` for display

- **Do**:
  - Add a world-transformed HTML layer, a sibling of the SVG ink, below the chrome.
  - Build `TextBlock` for sticky body, standalone text, shape label and section title, sharing one CSS box / class.
  - Remove the SVG `<text>` / `foreignObject` text renderers (`annotations-layer.tsx:5263-5602`).
- **Gotcha**:
  - Exports: the capture hides the annotations layer through `[data-mdcc-annotations]` (`exporters/capture-chrome.ts:73`,
    `canvas-lib.tsx:2770`), and research found the live layer may not emit this attribute. Verify it, and put the
    attribute on **both** layers.
  - The hit-testing root must include the text layer.
- **Validate**: Golden screenshots. Sticky pixels match; labels and standalone text now wrap as their editor does, which is
  the intended diff, reviewed by eye and recorded.

### Task 18: CREATE `TextEditor` (textarea) + IME guard + one commit policy

- **Do**: Implement AD7:
  - the in-place textarea with the same class
  - `ime.ts` guard
  - the unified Enter / Shift+Enter / Esc / blur / outside-click policy
  - a single double-commit guard
  - the session base snapshot at start
  - zoom floor → zoom-to-element
  - keep ⌘B / I / U through `useEditorFormat`, rebound to store actions, and the formatting toolbar for **all** slots,
    including a pending new text and section titles (`annotations-layer.tsx:3717-3725`)
  - Bold on a selected shape applies to its label (`annotations-context-toolbar.tsx:522-524`)
  - Delete the 4 old editors, `text-caret.ts` custom caret for object text, and the zero-width-space trick.
- **Gotcha**:
  - Keep every entry path: double-click, Enter on selection, auto-edit after drawing a sticky or shape, ⌘Enter chain-create,
    and Text-tool click on existing text (`annotations-layer.tsx:2792-3272`).
  - Chain-create becomes a store action, not a custom event plus `setTimeout(0)`.
- **Validate**: `bun test test/annotations-v2-text.test.ts`, as a jsdom/happy-dom state-machine test that includes a
  composition sequence with WebKit ordering (`compositionend` → keydown Enter keyCode 229 must NOT commit).

### Task 19: ADD draft persistence + remote-change policy while editing

- **Do**:
  - `draft.ts`: a 600 ms idle patch with `expect` = session base, plus the final commit patch.
  - Remote same-field change → "edited by X" chip, and a 3-way character merge on commit.
  - Remote delete → "deleted by X — keep my text?" with restore (a `put` with the same id and new text).
  - Selection pruning when the element vanishes and no editor is open.
- **Validate**: A two-store simulation test in `test/annotations-v2-text.test.ts`: A types, B types, both texts survive; A
  types, B deletes, A keeps the text.

### Milestone D — Containment, selection, interaction

### Task 20: CREATE `selection-store.ts` + `containment.ts`

- **Do**:
  - Implement the single selection store (ids, `focusGroup`, `focusParent`, prune on vanish) and one expansion function for
    groups and sections.
  - Containment: reparent at gesture end by centre-in-section (deepest wins); subtree operations; the nested-insert-above
    rule.
- **Validate**: The Task 2 `test.todo`s flip to passing assertions: nudge, align, distribute, group-resize,
  delete / copy / duplicate subtree, Alt-duplicate moves only the copy, marquee inside a section excludes the section, and
  nested sections move together.

### Task 21: CREATE the pointer pipeline + tool state machine; retire document listeners

- **Do**:
  - Implement AD8: `pipeline.ts` (one root pointer handler with capture) → `machine.ts` states.
  - Port select, drag (CSS-transform preview, commit at end), marquee, resize / rotate (registry math), draw tools,
    connect (bind dots), eraser, hover hints, the context menu, and paste.
  - Replace the ~12 document capture listeners, `CHROME_SELECTOR` and the custom-event bus with store actions.
  - Keep the artboard / canvas pass-through behaviour (`annotations-layer.tsx:2358`, `:2609` shift-marquee on artboards).
- **Gotcha**:
  - Past regressions came from listener ordering: 3db83a8a (select-drag lost to artboard drag) and ce641b18 (resize handle
    missing from the chrome skip-list).
  - Write a test per past regression before deleting the listener that fixed it.
- **Validate**: `bun test test/annotations-v2-interaction.test.ts test/use-annotation-resize.test.ts test/annotations-draw-modifiers.test.ts test/annotations-snap.test.ts`,
  plus the desktop e2e `canvas-text-editing`.

### Task 22: ADD awareness gesture previews

- **Do**: While dragging, resizing or drawing, publish `{actionId, ids, transform | partialPoints}` over awareness (bounded
  and sanitized like the existing `annotationSelection`, DDR-054 §2d). Peers render the ghost transform and clear it on
  commit or timeout.
- **Gotcha**: Follow the render budget from `followup-multiplayer-parity-issues.md` (foreign awareness must not re-render
  unrelated overlays), and reuse its `useForeignAwareness` equality fix if it has landed.
- **Validate**: `bun test test/presence-*.test.tsx` plus a new preview test. Perf: the idle-peer render count stays
  unchanged.

### Milestone E — Registry takeover, render performance, AI surface

### Task 23: CREATE `elements/*.view.tsx` + memoized `ElementNode`; delete `StrokeNodeBase`

- **Do**:
  - Give each type a `Render`.
  - `ElementNode` memoizes per id and subscribes per id. Bound arrows subscribe to their hosts' bounds.
  - The context toolbar controls come from registry capabilities, and setters dispatch `patch` ops.
- **Validate**:
  - Golden screenshots equal (minus the Task 17 intended diff).
  - `perf.sh --fixture` 1000-element drag: React renders during the gesture ≤ selected + bound count (today it is the whole
    layer).

### Task 24: UPDATE palette, input router, tool mode, resize to read the registry

- **Do**:
  - Separate *tools* from *element types*: `Tool` becomes palette-only, and the `tool` field is gone from records.
  - `input-router.tsx:66-201`, `use-tool-mode.tsx:87-102`, `tool-palette.tsx:274-284`, `canvas-cursors.ts:180` and the
    resizable lists (`use-annotation-resize.tsx:154-163`) come from the registry.
- **Validate**: `bun test test/use-annotation-*.test.ts*`.

### Task 25: ADD a registry conformance test + "adding a type" guide, proven with a throwaway type

- **Do**:
  - Write `test/annotations-v2-registry-conformance.test.ts`, which iterates over every registered type and asserts:
    - spec round-trip
    - hostile-input rejection
    - `bounds` / `hitTest` / `translate` / `resize` consistency
    - `toAi` / `fromAiOp` round-trip
    - an unknown-type passthrough
  - Prove the claim with a test-only `stamp` type registered in the test. It must work end to end (render, select, move,
    sync, AI read / write) by adding **one** file.
  - Write the guide: `plugins/design/skills/whiteboard/_guide-06-adding-an-element-type.md` for maintainers, or
    `docs/architecture/annotations-v2.md`, whichever the docs convention prefers; check `docs/architecture/`.
- **Validate**: The conformance test passes; the `stamp` type touches exactly one source file.

### Task 26: REMOVE the v1 adapter and the dead v1 paths

- **Do**:
  - Delete the Task 8 adapter, the `Stroke` union, `strokesToSvg`, `annotation-edit-base.ts`, the whole-SVG echo guard in
    `annotations-sync.ts`, `splitSvg` / `mergeSvg`, and the dead `saveTimerRef` (`annotations-layer.tsx:1084`).
  - **Keep** `svgToStrokes` + `sanitizeAnnotationSvg`, moved under `annotations/legacy/`, for migration and history
    upconvert only.
  - `annotations-layer.tsx` shrinks to composition.
- **Validate**: `bunx tsc --noEmit && bash scripts/check-tsc-coverage.sh`; grep finds no remaining `strokesToSvg` outside
  `legacy/`.

### Task 27: UPDATE AI verbs on the registry

- **Do**:
  - `read-annotations.mjs` returns the v2 compact projection (absolute coords, computed arrow endpoints, section members in
    reading order, `--in`, `--type`), backed by the registry model; delete the regex parser.
  - `annotate.mjs` gets `update`, `move`, `reparent` and `reorder` ops (the existing create / connect / group / delete /
    move / set-text / set-color map onto them), and goes through `/_api/annotations/ops` or a direct file write; drop
    happy-dom.
  - `_import-figma.mjs` + `figma/to-strokes.ts` emit v2 elements.
  - `canvas-rects` static fallback: `_canvas-rects-static.mjs` reads v2 bounds.
- **Validate**: `bun test test/read-annotations.test.ts test/annotate-write.test.ts test/figma/*.test.ts test/import-figma.test.ts`.

### Task 28: UPDATE plugin docs, site docs, architecture docs, contracts

- **Do**:
  - `plugins/design/skills/whiteboard/{SKILL.md,_guide-00,_guide-02,_guide-03,_guide-05}` (schema, op vocabulary including
    `update`, trust model "annotation JSON is peer-authored")
  - `skills/design/_guide-06-strokes…`, `commands/board.md`, `references/new/{02-modes,17-6b}`,
    `templates/brief-board.tsx.template`
  - `site/content/docs/hub/linking.mdx`
  - `docs/architecture/{project-transactions,project-writer-registry}.md`
  - `scripts/dev/sync-e2e/contracts/schemas.mjs`: replace the draft `annotation.*` contract with the v2 op schema
  - `harness.mjs` `annotationSvg` → a v2 builder; `scenarios.mjs`, `t32-scale.mjs`
- **Validate**: `pnpm --filter @maude/site gen:reference && pnpm --filter @maude/site build`; `pnpm test:harness`.

### Milestone F — End-to-end verification

### Task 29: CREATE scenario `annotations-v2` + extend the surface rig

- **Do**:
  - Write `.ai/scenarios/annotations-v2/spec.md` + `covers.json`, and extend `surface.e2e.ts` / `surface-catalogue.mjs`
    with the new rows below.
  - Replace `stickyDisk()` SVG snapshots with model-aware assertions: parse the JSON and compare records, plus the DOM
    `[data-id][data-type]`.
  - Every row runs in all three directions (browser → desktop A/B, desktop A → browser/B, desktop B → browser/A), in **both**
    sync modes (legacy shared doc, accepted revisions), and on **both** backends (self-host hub, cloud cell via
    `wdio.cloud.conf.ts` / f3 runners).
  - Memory rule: sync must be tested both directions, because cloud and desktop are not symmetric.

  | Row | Asserts |
  | --- | --- |
  | V1 parity | Every L09 / L10 row passes against the Task 3 baseline (`--mode candidate --baseline`) |
  | V2 concurrent different elements | A moves sticky 1 while B recolors sticky 2 at the same moment → both survive everywhere |
  | V3 same element, different fields | A moves, B recolors the same sticky → both survive |
  | V4 same text field | A and B type in the same sticky → both insertions present; no silent revert |
  | V5 delete while editing | B deletes the sticky A is typing in → A sees the chip, restores, the text survives |
  | V6 section subtree | A moves or nudges a section while B edits a child's text → children move, text survives |
  | V7 marquee in section | A marquee started inside a section selects only its children; Alt-duplicate copies the subtree |
  | V8 nested sections | Create inner inside outer; move outer → inner + contents follow; inner renders above |
  | V9 IME | A native row types via composition (Czech diacritics via dead keys; Japanese IME in the WKWebView manual step) → Enter during composition doesn't commit |
  | V10 migration | Start the app on the legacy fixture → JSON written, SVG in `_trash/annotations-v1/`, render equals the golden screenshot; restart = no-op |
  | V11 hub migration | Hub with a persisted legacy doc + history → after upgrade, board intact, undo of a pre-upgrade edit and restore of a pre-upgrade revision both work |
  | V12 mixed version | Old studio against a v2 project: the old peer's write can't erase v2 elements; the new studio against an old hub shows "hub needs update" and doesn't write |
  | V13 stale sidecar | A `.annotations.svg` reappears (git checkout of an old branch) → quarantined as `_trash/annotations-v1/stale-…` (DDR-242 §6, amended), board unchanged |
  | V14 AI round trip | `annotate update` on a sticky while a peer has it selected → no flicker (same id), the comment anchor survives, and it isn't in the user's undo |
  | V15 live previews | A drags; B sees the ghost moving before release; B's own undo is untouched |
  | V16 offline / outbox | A edits offline (accepted mode), reconnects → ops accepted; queued pre-upgrade SVG proposals upconverted |

- **Gotcha**:
  - The canvas iframe is unreachable by DOM from the shell when origin split is on. Use `__maudeE2EFrameProbe` or
    coordinates (memory `maude-canvas-iframe-unreachable-by-dom`).
  - Use `--notes shared|isolated` as the rig supports.
- **Validate**: `bash .ai/scenarios/reliable-project-multiplayer/runners/local-e2e.sh --mode candidate --baseline <Task-3 dir>`,
  plus the new rows. **0 regressions against the baseline.** The known pre-existing failures listed in the runners README
  are tracked, not newly broken.

### Task 30: ADD perf + token benchmarks (acceptance gates)

- **Do**:
  - `perf.sh --fixture` mixed 200, 1000 and 5000 elements (Chromium and Safari lanes):
    - load time
    - drag p95 frame time
    - React renders during drag
    - bytes sent per edit
    - Y update size per edit
  - A token bench script: `read-annotations` output size versus the v1 reader on the same boards, and bytes of a
    single-element `annotate update`.
- **Gates**:
  - bytes per edit do not depend on board size (±10 % from 200 to 5000)
  - drag p95 at 1000 elements is no worse than baseline, and renders during drag ≤ selected + bound
  - AI read ≥ 3× smaller
  - single write ≤ 40 tokens
  - Add `rbush` only if 5000-element marquee or hit-test exceeds 8 ms.
- **Validate**: The report is committed under `.ai/plans/notes/annotations-v2/perf.md`, with deltas against the Task 3
  baselines. Remember that headless timings are noisy (perf.sh prints the spread); only deltas larger than the spread count.

### Task 31: RUN desktop e2e, bundle gates, security pair

- **Do**:
  - `pnpm test:e2e:desktop:build && pnpm test:e2e:desktop` (`canvas-text-editing`, `shell-parity`,
    `sidecar-respawn-canvas-switch`).
  - Rebuild the committed client bundle release-minified: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release`.
  - Before any release: `apps/desktop/scripts/check-bundle-completeness.mjs <app> --smoke` and `check-client-boots.mjs <app>`.
  - `/flow:validate-security` on the new trust boundaries:
    - the JSON validator
    - `/_api/annotations/ops` (canvas origin)
    - `annotations.apply` in the hub
    - awareness previews
    - the untrusted sidecar import
    - the previously unsanitized agent and workspace-files writes
- **Validate**: 0 blockers from the attacker + defender pair.

### Task 32: ADD What's New + close-out

- **Do**:
  - Add a pending What's New entry via the `whats-new-entry` skill, covering smoother text editing (IME, wrapping, no lost
    text), sections moving with their contents, live drag previews from teammates, and faster large boards.
  - Regenerate the roadmap if plans moved (`pnpm --filter @maude/site gen:roadmap`).
  - Record the retro.
  - Reference [1aGh/maude#106](https://github.com/1aGh/maude/issues/106) C3 as closed, and unblock the comment-anchor tasks
    in `followup-multiplayer-parity-issues.md`.
- **Validate**: `/flow:validate`.

---

## Validation

Run these commands to confirm zero regressions (from `quality` in `.ai/workflows.config.json`):

1. **Format**: `pnpm format`
2. **Lint**: `pnpm lint`
3. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && bash scripts/check-tsc-coverage.sh`
4. **Tests**:
   - `pnpm test` (CLI node tests)
   - `cd apps/studio && bun test`, **run alone**, checking `git status apps/studio/dist/` before and after
   - `bun test test/sync-*.test.ts --timeout 20000` (the CI gate)
   - `pnpm --filter @maude/hub test`, run separately
   - `pnpm test:harness`
5. **Build**: `pnpm --filter @maude/site build`; hub image builds frozen (`docker build apps/hub`); studio release bundle rebuilt.
6. **Parity / tarball / tokens / site-content**: `bash scripts/check-version-parity.sh`, `bash scripts/check-tarball-shape.sh` (the new `apps/studio/annotations/` dir ships via `apps/studio/`, already in `files`), and the site-content regen gate.
7. **Cross-platform scenario**: spawn `scenario-runner` for `annotations-v2`, `canvas-annotations`, `canvas-annotations-figjam`, `canvas-text-editing`, `whiteboard-ai-loop` and `canvas-figjam-feel`.
8. **Multiplayer surface rig**: Task 29 matrix, candidate against the Task 3 baseline, both modes, both backends, all three directions.
9. **Desktop E2E**: Task 31.
10. **Design System Guard** + **A11y**: `design-system-guard` and `a11y-auditor` over the canvas with annotations (focus order of the text editor, the textarea's aria-label taken over from `"Edit sticky note text"`, chip announcements).
11. **Manual**:
    - Japanese / Chinese IME in the packaged WKWebView app
    - trackpad pinch while editing
    - a 5000-element board on a low-end machine
    - opening a migrated project on a second Mac via Syncthing (the `~/git` tree itself)

---

## Scenario Coverage (UI tasks — required)

**Existing scenarios covering affected flows:**

| Scenario | Covers | Status |
|----------|--------|--------|
| `canvas-format-tsx/canvas-annotations` | pen / rect / arrow / eraser, hide, reload, per-canvas file | ✅ existing. Update the file assertions to JSON |
| `canvas-format-tsx/canvas-annotations-figjam` | shapes, halo, toolbar, drag, text in shape, reload | ✅ existing. Update |
| `canvas-text-editing` (native) | sticky / text / section editors | ✅ existing. Extend with IME, wrap parity and remote-edit chips |
| `whiteboard-ai-loop` | canvas-rects → read → annotate round trip | ✅ existing. Add `update`, and an automated runner |
| `canvas-figjam-feel` | feel / interaction | ✅ existing. Re-run for parity |
| `reliable-project-multiplayer` (surface rig L09 / L10) | three-direction multi-peer annotation ops | ✅ existing. Baseline + candidate |
| `annotations-v2` | V1–V16 (Task 29) | 🆕 new |

**New scenario to create:**

- `annotations-v2`: flows V1–V16. Personas: designer and teammate (two peers), plus an agent (CLI). Fixtures: the
  legacy `ui-smoke.annotations.svg`, a nested-sections board, a bound-arrows board, the mixed 1000-element perf board, and a
  hub with a persisted legacy doc and history.

---

## Acceptance Criteria

- [ ] All tasks completed; the adapter and dead v1 paths removed (Task 26) — *all tasks worked; the adapter survives as the editing view (deviation, see the Execution Log); Tasks 23/24 partial*
- [x] `/flow:utils-verify` passes after each task (Edit-Verify Loop, max 3 iterations)
- [ ] `/validate` passes overall: static, tests (studio alone + sync lane + hub + harness + CLI), build
- [ ] Surface rig: 0 regressions against the Task 3 baseline; V1–V16 green in both sync modes, both backends, all directions — *L09/L10: 0 regressions vs a v1 baseline run (a25a75d2) and `L09.v2.*` 28/28, all three directions, legacy save mode on a local hub; accepted mode and the cloud backend not run*
- [x] Golden screenshot parity (except the recorded intended text-wrap diff) — side by side against `main` in Task 17
- [ ] Perf / token gates from Task 30 met — *all but AI read (2.86× vs ≥ 3×)*
- [x] Migration idempotent, non-destructive, with a quarantine for reappearing SVG; the hub keeps undo and restore across the upgrade
- [x] A stale or old peer cannot erase a v2 board (V12 / V13)
- [x] Adding an element type = one file (Task 25 proof)
- [ ] `scenario-runner`: 0 blockers, parity_ok
- [ ] `design-system-guard` and `a11y-auditor`: 0 blockers
- [x] Security pair: 0 blockers on the new boundaries — after the fix pass (`36c02e2a`), each fix proven by a red-first test
- [ ] DDR recorded (Task 1) and ingested; DDR-100 §3 and the DDR-054 table amended
- [x] What's New entry pending; the committed client bundle rebuilt `--release`

## Risks

1. **Sync blast radius.** The change reaches codec, agent, cold start, projection, kernel, store and the workspace agent,
   all paths with a history of data-loss fixes. *Mitigation:* Milestone B lands under an unchanged UI via the adapter; the
   Task 2 characterization tests come first; the DDR-223 table is kept verbatim; a new Y type name means stale peers write
   somewhere v2 never reads; the V10–V13 rows.
2. **Text-layer visual diff.** Moving labels and standalone text from SVG `<text>` to HTML changes wrapping (intended) and
   possibly baseline or kerning (not intended). *Mitigation:* golden screenshots at 3 zooms × 2 themes; the Task 17 review.
3. **Interaction rewrite regressions** (listener ordering was the historical bug source). *Mitigation:* one test per past
   regression before a listener is deleted (Task 21), and the surface-rig baseline.
4. **Hub history upconvert.** A malformed legacy blob must not silently vanish from restore. *Mitigation:* lazy upconvert
   with explicit reporting; V11.
5. **Scope and duration.** This is multi-week work. *Mitigation:* the milestones are independently shippable; A + B alone
   deliver the sync and AI gains.

## Execution Log

Worktree `.claude/worktrees/annotations-v2`, branch `worktree-annotations-v2` (from `origin/main` `fa3290bf`). The root
`pnpm-lock.yaml` diff comes from a local `pnpm install --no-frozen-lockfile`, the same drift the main checkout already had.
Do not commit it.

### 2026-09-30

- ✅ **Task 1**: `DDR-242-annotations-v2-element-model.md` written and ingested into kg (`maude/DDR-242`, EXTENDS
  DDR-100/223/241). The worktree has no kgai install identity, so ingest targets the main checkout's store.
- ✅ **Task 2** (subagent):
  - `test/annotations-characterization.test.ts`: 73 pass, 9 `todo` (the section/editing bugs that Milestone D flips).
  - `apps/hub/test/annotations-lane.test.mjs`: 31 pass.
  - Findings that shaped v2:
    - (a) the reader and the layer disagree on section membership for standalone text. Migration uses the layer's rule
      (bbox centre, inclusive), since that is what the user sees move.
    - (b) the hub merge silently drops a z-order change.
    - (c) move + recolour of one element conflicts in the hub.
    - (d) `''` and the 72-byte wrapper never compare equal.
- ⏳ **Task 3** (subagent):
  - Done: perf fixture slug fix and mixed generator; `test/fixtures/annotations-v2/mixed-200.v1.svg` committed-size.
  - Pending: the baseline run (resumed after a network drop).
  - Surface-rig baseline: deferred to the Milestone B gate. It needs the native test build, and it measures `main`, so it
    can run from any checkout of the base commit.
- ✅ **Task 4**: `annotations/{fields,types,constants,registry,schema,fractional-index,scene}.ts`.
  - Deviation: the field engine lives in `fields.ts`, and the world-space view in `scene.ts` (not named in the plan).
    `types.ts` avoids import cycles.
  - Verified: loads under Node 24 type-stripping, the hub's runtime.
  - Bug found by test: `str()` truncated over-long patterned values (ids) before regex-testing them. Patterned values now
    reject instead of truncating.
- ✅ **Task 5**: `annotations/elements/{sticky,text,shape,arrow,pen,media,section}.model.ts`. `media.model.ts` holds the
  three card types (image, link, mediaref), because they share one factory.
  - Arrow ends: `{el}` = auto (facing), `{el,nx,ny}` = pinned, `{x,y}` = free. Non-pinned v1 `nx`/`ny` were derived data
    and are dropped.
  - Hit-test parity with v1 is checked on a probe grid over every fixture element. A mutation check proved the test can
    fail. It found a real gap: v1 cards have a 2 px minimum grab tolerance (`CARD_MIN_TOL`), standalone text has none.
- ✅ **Task 6**: `annotations/ops.ts` (`put | patch | delete`).
  - Deviation: no separate `move` op. Move and reparent are a `patch` of `parent`/`index`/`x`/`y`; the caller converts
    coordinates.
  - Fix-ups travel as ordinary ops: a deleted host freezes its bound arrow ends, and a deleted container re-parents
    survivors without moving them.
  - A child `put` before its parent in the same batch is deferred and retried.
  - 15 table tests.
- ✅ **Task 7**: `annotations/migrate-v1.ts` + `annotations/legacy/mini-dom.ts`.
  - `svgToStrokes` was split into `svgToStrokes` (DOMParser) + `strokesFromDocument` (any `SvgDocLike`). The change is
    behaviour-neutral: existing roundtrip, stable-id and characterization suites stay green.
  - Every v2 host parses legacy SVG through the mini-DOM, so migration is identical on studio, hub and CLI. A test asserts
    `mini-dom == DOMParser` on all fixtures.
  - Section membership: bbox centre inclusive, smallest containing section wins. Visually nested sections now nest.
  - Paint order: preserved among siblings. A top-level element that sat between a section and its member in the v1 array
    now paints above the member. It only shows if they overlap; this is documented.
  - 81 tests: parity (geometry, text, labels, binds, sibling paint order, hit-test grid) on the phase-20/21 and figjam-v3
    fixtures, mixed-200, the e2e `ui-smoke` board, and all 14 repo `.design/*.annotations.svg`.

**Milestone A exit:** all v2 suites green; the v1 roundtrip, stable-id and characterization suites are unaffected;
`bunx tsc --noEmit` is clean.

### 2026-09-30 (cont.) — Milestone B

- ✅ **Task 3 (rest)** (subagent):
  - Baselines moved from the ephemeral scratchpad to `.ai/plans/notes/annotations-v2/baselines/`.
  - Chromium, mixed 200: p95 16.8 ms.
  - Chromium, mixed 1000 with `--fit-all`: p95 33.4 ms and 1 long task. This is where v1 degrades.
  - The v1 1 MB cap bites at about 3,750 mixed elements.
  - Still pending: Safari lanes, golden screenshots, surface-rig baseline.
- ✅ **Task 8 (adapter + layer IO)**: `annotations/v1-adapter.ts`.
  - `elementsToStrokes`, and `strokesToElements`, which keeps the parent of an unmoved element, keeps sibling keys (LIS) and
    carries unknown types over.
  - `annotations-layer.tsx` loads the JSON board, observes the replica (`observeReplica`, echo by `actionId`) and sends
    `diffToOps(before, next)` to `POST /_api/annotations/ops`.
  - Identity (`elements → strokes → elements`) holds on every fixture.
  - Deviation: undo still replays v1 snapshots through the adapter diff. Only the fields that differ are sent, so the
    peer-safety gain is already there. True inverse-op records land when the adapter is removed (Task 26).
- ✅ **Task 9**: `annotations/replica.ts`.
  - `Y.Map('annotations2')`: element → `Y.Map(field)`, plus `~v` (format) and `~action` (echo).
  - Writes are diffs, and a field edit's Yjs update does not depend on board size (measured: < 120 B for 2 vs 2002
    elements).
  - Legacy `svg` is read lazily; a stale v1 peer can't erase a v2 board.
  - `sync/codec.ts`: `canonicalAnnotations` / `readLocalAnnotations`. The lane value comes from `annotationsLaneValue`
    (an empty board is `''`), identical in studio and kernel, because it is the DDR-241 base hash.
  - The cap is 4 MB (`MAX_ANNOTATIONS_BYTES == MAX_BOARD_BYTES`, pinned).
- ✅ **Task 10**:
  - `api.ts`: `.annotations.json`, a per-file write chain, `applyAnnotationOps`, and a legacy read fallback.
  - `http.ts` + `server.ts`: `/_api/annotations/ops` in both canvas allowlists; `PUT {board|svg}`.
  - collab `registry` / `persistence` / `index` moved to the replica.
  - `writer-registry` gained an S23 row.
  - Bug found by the test port: `canonicalAnnotations` turned ANY `<…>` text into an empty board, so `PUT {svg:'<p>'}`
    would erase a board. The SVG branch is now `<svg` only; other markup is refused. The test was `test.failing` before
    the fix.
- ✅ **Task 11**:
  - agent / migrate-seed / accepted-cold-start / index paths now use `.json` with a legacy fallback.
  - `file-membership`, studio and hub mirror: `.annotations.json` **and** `.svg` are canvas-owned.
  - file-plane asset scan, git watch/grouping, `canvas-artifacts` (a legacy `.svg` still travels on move).
- ✅ **Task 12** (hub):
  - `lanes.mjs`:
    - `checkLane` upconverts SVG. Deviation from plan AD5: SVG is upconverted instead of refused, so history blobs and v1
      clients land as diffs.
    - `mergeLane` = `applyOps(head, diffToOps(base, ours))`, so it never raises a conflict.
    - `applyLane` / `readLane` go through the replica.
    - `boardElements()` upconverts SVG history blobs so undo/restore can never read them as an empty board.
    - `splitSvg` / `mergeSvg` removed.
  - `workspace-files.mjs`: `.json` sibling, reads the validated replica. This closes the unsanitized write.
  - Dockerfile: `COPY apps/studio/annotations`.
- ✅ **Task 13 (partial)**:
  - The hub advertises `annotations-v2` in `/health` and `annotationsFormat: 2` in bootstrap.
  - The studio warns loudly when a linked hub lacks it.
  - Deferred: `minStudioVersion` (needs the release version, Task 32) and hard refusal to link. The capability plus the
    new replica name already make mixed versions non-destructive.
- ✅ **Task 14**: `annotations/migrate-boot.ts`.
  - Boot hook in `server.ts` (skipped in workspace mode) and in the sync runtime next to `migrateFlatFallback`.
  - Hub workspace agent migrates its checkout after autocommit starts, and notes both paths.
  - Lock under `_state/`; a stale `.svg` is quarantined to `_trash/annotations-v1/stale-*`.
  - Not done: the `.ydoc.bin` explicit discard. Unneeded, because `readReplica` reads a legacy cache lazily and
    `persistJson` rewrites v2.
  - Not done: outbox upconvert. `checkLane` upconverts queued SVG proposals.
- ✅ **Task 15**: the gitignore-drift VERSIONED list, gitignore-block / `.gitignore` / git-service comments, design-link
  adopt.
- ✅ **Task 16**:
  - The repo's 14 `.design/*.annotations.svg` and the e2e `ui-smoke` fixture were converted in place
    (`annotations/migrate-cli.ts --in-place`).
  - The legacy e2e board is kept as the test input `test/fixtures/annotations-v2/ui-smoke.v1.svg`.
  - `canvas-text-editing.e2e.ts` guards the `.json`.
  - The surface rig (`surface.e2e.ts`, 15+ `.svg` refs) is deferred to Task 29.
- **Shims (pulled forward from Task 27):**
  - `annotate` / `read-annotations` / `_import-figma` read and write `.annotations.json` through
    `annotations/v1-bridge-io.ts`. Without this, an agent write would have been quarantined as a stale `.svg`.
  - A size check now runs before reading: a peer-written file over the cap never reaches a parser.
  - `read-annotations.sh` prefers bun.
- **Found by the Figma-import test:** the migration and the adapter adopted an element painted UNDER a section (a backing
  paper) as its child, so it would have painted over it. Rule added: a section adopts only elements that painted above it
  in v1. Regression test added.
- **Removed:** `annotation-edit-base.ts` and its test. Dead since the layer diffs ops; the v2 merge makes base-canonical
  text irrelevant.
- **Test port** (subagent): 16 files, 257 tests.
  - Cold-start eraser coverage was proven by reverting `isEmptyAnnotationsSvg` to the v1 check: 10 tests went red.
  - `sync-accepted-runtime`: a pre-existing macOS case-insensitivity test bug, fixed test-side (listing check).
- **Suites** (run alone, `dist/` clean before and after):
  - studio: 6,243 pass. The remaining fails are 7 known load-flaky tests that pass alone (lazy-bundle, canvas-lib
    resolver, ACP bridge, DS theme probe, notifications, video-comp, export zip).
  - hub: 1,051 / 1,051. CLI: 409 / 409. harness: 26 + 1.
  - `tsc` clean; biome clean on touched files (warnings only, pre-existing classes).
- **Live check** (scratch project, v1 `mixed-200` board, Chromium): the server booted and migrated (161 elements = 200
  strokes − 39 labels merged into shapes); the board rendered.
  - Dragging a sticky sent one op, and the disk diff was exactly one `patch {x, y}`; the sticky kept its nested parent.
  - ⌘Z brought the disk back to identical.
  - A sticky text edit produced one `patch {text}`.

### 2026-09-30 (cont.) — user test report → browser E2E + fixes

- New browser E2E suite: `apps/studio/test/e2e/{harness,fixtures,annotations-ui.e2e}.mjs`.
  - It uses a real studio server on a temp project, Playwright headless Chromium in the canvas iframe, and asserts on both
    the DOM and the board on disk.
  - `STUDIO_DIR=<checkout> E2E_LEGACY=1` runs the same scenarios against a pre-v2 baseline (board as v1 SVG).
  - Hook added for DOM-driven E2E / tooling: `.dc-annot-svg[data-selection]`.
  - 17 scenarios pass.
- Bugs from the report. All four were confirmed pre-existing on `main`, not v2 regressions:
  - **Shift+Enter caret.** The editors are `pre-wrap` plaintext, so after Shift+Enter the caret sits before a trailing
    "\n" and has no client rect. `text-caret.ts` then painted it at the editable's top-left. Fix: when there is no rect
    for a non-empty editor, show the native caret (`caret-color`) and hide the painted one.
  - **Marquee over section content selected the section.** Fix: a section is selected only when the marquee encloses it
    entirely; other elements are still selected by touch.
  - **Shift+click did not deselect.** Fix: new `AnnotationSelection.remove`. Shift+click on an already-selected element
    removes it and starts no drag.
  - **Double-click on a shape's label text.** It fell through to the canvas `fit()` (the handler skipped anchored text).
    Fix: it is routed to the host shape.
  - The user's "double-click jumps to the first object" was NOT reproduced: centre, edge, no-label shape, shape over an
    artboard and empty section interior were all tried, on both v2 and `main`. Asked the user for exact steps.
- Found by the suite:
  - **Double-click on standalone text never opened its editor.** Pre-existing on `main`. Cause: `canvas-lib` `pointerenter`
    auto-focus stole focus from the editor that had just mounted under the pointer; blur commits, so the editor closed
    about 5 ms after opening. Fix: `pointerenter` never takes focus from a contentEditable or input.
- Regression proof: with the marquee and shift fixes disabled, R3 and R4 go red.
- User follow-up. The "view jumps top-left" report came from **double-clicking a word inside an open editor** (to select
  it).
  - The editors sit over the world, not over an artboard, so `canvas-shell`'s dblclick-empty → `fit()` fired mid-edit.
    Pre-existing on `main`.
  - Fix: `fit()` ignores double-clicks inside `[data-annot-editor]`, contentEditable, input, textarea and select.
  - Scenario R2b covers sticky, shape label and text.
  - The scenario pans first: a stray `fit()` from the already-fitted view moves nothing, so the first version of the test
    passed against the bug. It is red on `main`.
- The suite now has 20 scenarios, all green.

**Milestone B exit gate: open.** The surface-rig `--mode baseline` / `--mode candidate` runs need the native test build
(Task 29 infrastructure) and have not run yet.

### 2026-09-30 (cont.) — `/flow:done` interim close (Milestones A–B + editing fixes)

The plan stays **active**: Milestones C–F remain. This close commits A–B, the editing fixes and the review fix pass on
`worktree-annotations-v2`.

- **Review fan-out.**
  - Code review: NEEDS FIXES → PASS WITH SUGGESTIONS after the fix pass (`.ai/logs/code-reviews/worktree-annotations-v2.md`).
  - Security defender and attacker: `.ai/logs/security-reviews/annotations-v2-{defender,attacker}.md`.
- **Fixes landed.**
  - H1: the op path goes to the live room replica.
  - H2: a board that exists but can't be read is refused, never read as empty.
  - M1, M2, M3, M5, M7.
  - Defender #1 (linear mini-dom scanner plus a legacy-SVG cap), #2 (per-batch indexes plus a merge budget) and #3
    (migration: `lstat`, size cap, realpath containment checked before `mkdir`).
  - F4.
  - `DANGEROUS_KEYS`, the key cap for unknown types, plugin doc paths, and dead echo helpers.
- **Deferred with reasons.**
  - M4 and M6 go to Task 26.
  - F1–F3 predate v2. Binding `file` to the Referer is bypassable with `history.replaceState`, so the fix needs a
    per-iframe capability shared with comments and canvas-meta. Spun off as a separate session task, together with the
    accepted cold start that materializes over an unreadable local board.
- **Lesson.** The review found a doc path that was a *functional* bug (the ingest sha hashed a file that no longer
  exists), not just stale prose. Grep the plugin docs for a renamed artifact path in the same change that renames it —
  that is Task 28's job, but a path rename can't wait for it.
- **Found by the E2E re-run after the fixes.** H1 made a latent race deterministic: the room's own file projection came
  back through the watcher and re-seeded the room over a newer op (Delete → ⌘Z lost). The room now recognises its own
  projection echo. A unit test of the new registry function passed while the integrated behaviour was broken — only the
  browser E2E caught it.
- **Gates.**
  - tsc and tsc coverage: green (303 files).
  - biome: 0 errors.
  - Studio suite, full: 11 failures, all load-flaky. Each passes alone: lazy-bundle / canvas-build (pixi,
    dom-to-svg, canvas-lib-resolver, video-comp), ACP bridge timings, the ds-theme probe, and a sonner toast after
    teardown.
  - Affected studio tests alone: 1907/1907.
  - Hub: 1051/1051.
  - Browser E2E: 18/18.
  - Skipped (interim close, per plan): cross-platform scenario, desktop E2E, bundle gates. These are Task 29–31 in
    Milestone F.

### 2026-09-30 (cont.) — Milestones C–E after the merge (#138)

PR #138 (Milestones A–B plus the editing fixes) was squash-merged to `main` as `731c64ca`. Everything below builds on it,
on `worktree-annotations-v2`.

- ✅ **Tasks 17 + 18** (`e77ce766`):
  - Every element is its own DOM node in paint order. Geometry is a small world-space SVG, and text is HTML
    (`annotations/ui/{element-node,scene,text-style}.tsx`).
  - One `<textarea>` editor serves every text slot. It has native IME, the caret and word selection work, there is one
    commit policy, and composition never commits.
  - Below 0.5 zoom, a double-click zooms in first.
  - Visual parity with `main`: identical, except standalone text shifts by about 2 px.
- ✅ **Task 19** (`ddf8d00e`):
  - Drafts are sent after 600 ms idle. A commit expects what the session last sent.
  - Undo is one step and merges back.
  - The editor shows a notice when a collaborator edits or deletes the element; Enter restores it with the same id.
- ✅ **Task 20** (`54f15488`):
  - One expansion rule (groups, then section subtrees) governs nudge, drag, align, distribute, delete, copy, ⌘D and
    Alt-drag.
  - A marquee selects elements by touch; a section is selected only when fully enclosed.
  - A section drawn inside another one nests.
  - The seven characterization todos are now real assertions.
- ✅ **Task 21** (`a7052132`): one pointer pipeline, with stages by priority, one owner per gesture, and the state as
  `data-annot-state`. The chrome skip-list is now one stage. The event bus is replaced by store actions and a typed
  editor channel.
- ✅ **Task 22** (`ca879b84`): `annotationGesture` on awareness, sanitized. Peers draw a ghost that fades after 3 s.
- ✅ **Task 27** (subagent, `11351c49`): `read-annotations` / `annotate` / `import-figma` run on the registry. The v1
  bridge and the regex parser are gone.
- ✅ **Task 26** (`8f079c5e`, `3c32e9d0`).
  - **Done:**
    - The board is the element store (`ui/board.ts`, `BoardStore`).
    - Every edit is one op batch, applied optimistically, sent, and recorded as ONE undo step whose undo is the batch's
      inverse.
    - A text session's undo merges back, so a collaborator's typing survives the undo.
    - Replica snapshots are rebased onto this tab's batches still in flight.
    - The snapshot undo (`annotation-strokes-command.ts`, the `strokesPutFn` sink) is deleted.
    - `reconcileCommit` / `reconcileForeignEcho` are deleted.
    - The engine flag and the v1 layer copy are deleted: the element-native layer is the only one, still at
      `annotations-layer.tsx`.
    - The clipboard carries v2 elements (`{"maudeElements":2}`).
  - **Deviation.**
    - *What the plan said:* delete the `Stroke` union, `strokesToSvg` and the adapter.
    - *What was done:* the editing tools (select, snap, marquee, handles, eraser, connectors, the context toolbar;
      about 10k lines) keep working on a world-space `Stroke` VIEW, projected per element and cached by record identity
      (`ui/world.ts` → `elementStrokes`). A commit diffs that view back into element ops.
    - *Why:* persistence, sync and undo are element-native, so the gains the plan wanted are there: minimal ops,
      peer-safe undo, and only the changed nodes re-render (Task 30). Rewriting 10k lines of tool code was the riskier
      path, and both behaviour suites guard the view instead.
    - `strokesToSvg` and `svgToStrokes` stay in `annotations-model.ts`. The migration, legacy fixtures and a pre-v2
      paste still need them.
    - `ui/edit-actions.ts` (element-op edits written directly) is tested but not yet used by the layer.
- ✅ **Task 23** (partial): memoized per-element nodes, with identity kept by the projection. Measured in Task 30: a
  drag re-renders only the dragged node. Toolbar controls driven by registry capabilities were NOT done; the context
  toolbar still switches on the stroke kind.
- ✅ **Task 24** (partial): records never carried `tool` (it is a palette concept). Resize handles and arrow binding
  consult the registry for types without a stroke form (`ElementStroke`). The palette, input router and cursors are
  unchanged; they are palette-owned lists of tools, not element types.
- ✅ **Task 25** (`0361d276`):
  - `registerElementType` / `registerElementView`.
  - `ElementStroke`: a registered type with no stroke form rides the view, and its geometry comes from its definition.
  - A conformance suite over every type, plus a `stamp` declared in the test file alone that works end to end (render,
    hit, move, resize, bind, sync, AI read/write). Proven red: with the element projection disabled, 4 tests fail.
  - Guide: `docs/architecture/annotations-v2-adding-an-element-type.md`.
- ✅ **Task 28** (subagent, `3292dad0`, `32f85ab6`):
  - Updated: plugin docs, site `hub/linking.mdx`, `docs/architecture/{annotations-v2,project-transactions,project-writer-registry}.md`.
  - The sync-e2e contracts now use the v2 op schema (131/131); the harness has a v2 board builder; `pnpm test:harness`
    is green.
  - DDR-242 §6 was amended to match the code: a stale `.svg` goes to `_trash/annotations-v1/stale-…`, not `_untrusted/`.

### Milestone F

- ✅ **Task 30** (`2f35089c`, report `.ai/plans/notes/annotations-v2/perf.md`), on mixed boards of 200 / 1000 / 5000:
  - bytes per edit: 174 → 176 B (constant);
  - a drag re-renders only the dragged node;
  - drag p95 is about 18 ms at every size;
  - a single write is about 12 tokens.
  - **❌ AI read is 2.86× smaller, short of the 3× gate.** The remaining bytes are the schema's computed arrow
    endpoints. Whether to drop them is left to the owner.
  - The Safari lane was not run (it needs `safaridriver --enable`).
- ✅ **Task 31**:
  - Bundle gates: `check-bundle-completeness --smoke` and `check-client-boots` are green on the debug `.app`. kgai was
    not staged (`MAUDE_SKIP_KG_SYNC`).
  - Client bundles rebuilt release-minified (`e9257d16`).
  - Security pair (`36c02e2a`): verdict NEEDS FIXES, then everything fixed with red-first tests. The HIGH finding was an
    element typed `constructor` that blanked every peer's canvas. Also fixed: `annotate`'s stale file fallback,
    pastejacked authorship and link domain, the `--rects` strings, undo records bound to their canvas, the clipboard
    size cap, the placeholder clamp, and symlink-safe `board-io`. Deferred as structural: the AI trifecta, confirmation
    for destructive `annotate` verbs, and a diff-based disk→room reseed.
  - Desktop E2E on the native debug build:
    - **Found:** every scenario that opens a canvas from the Files panel was red on `main` since #124 (the tree starts
      collapsed). Fixed with `helpers/tree.ts` `canvasRow()` (`33b481ba`).
    - `app-boots` ✓, `sidecar-respawn` ✓.
    - `canvas-text-editing`: the annotation phases were ported to the v2 DOM and are 7/7 ✓.
    - **Pre-existing, split out:** the artboard persistence step waits for `.dc-media-toast`, which is gone since the
      sonner move (d50954df). The `shell-parity` ⌘⇧I Inspector step is also red on a pre-v2 build.
- ✅ **Task 29**:
  - Scenario `.ai/scenarios/annotations-v2/{spec.md,covers.json}`.
  - The rig was ported to the JSON board (subagent) and gained the `L09.v2.*` rows V2, V3, V5, V6, V8, V14 and V15.
    V4, V7 and V9–V13 are covered by the browser, unit and hub suites, as mapped in the spec.
  - The rig reveals tree rows (#124).
  - **Rig results** (native debug build + local hub, `--only L09.v2.`):
    - Run 1: 22 pass / 7 fail. It found two real bugs, fixed in `0ca58542` with red-first tests:
      - `annotate` posted ops under a doubled `.design/.design/…` path, so every op was refused as `gone`.
      - Moving a section re-parented what sat on a nested section inside it. Also, a section drawn around an element
        inside another never adopted it. The rule is now the v1 one: the smallest section under an element's centre
        that it paints above holds it.
    - Run 1 also showed that the A2 security fix had closed the in-cell agent's file channel. A cloud workspace
      (`MAUDE_WORKSPACE_MODE=1`) takes the file path again.
    - Run 2: 25 / 4. The failures were in different rows than run 1, and in them no gesture had been executed at all
      — intermittent synthetic-gesture flakiness on the native lane.
    - Run 3: **28 pass / 0 fail.** One row was not run by design: V14 on the hub writes the file inside a workspace.
- ✅ **Rig regression check against a v1 baseline (Task 29 V1).**
  - **Baseline.** The old rig and old code at `a25a75d2`, just before #124, taken with `git archive` into a scratch
    repo. It ran against a pre-v2 native debug build: `--mode baseline --only L09,L10` gave **368 pass / 0 fail**.
  - **v2 before the fixes: 260 pass / 107 fail.** About 130 rows regressed: deletes, toolbar edits, undo and eraser.
  - **Root cause 1** (`875da2b5`, `c29881da`, both proven red first):
    - *What happened:* the file event of an older board projection was imported into the shared doc as a replacement
      (`applyAnnotationsToDoc`). It overwrote newer per-field edits.
    - *Why:* v1 moved one SVG blob, so the race rarely showed.
    - *Where it was traced:* debug logging on the peer and on the cell studio.
    - *Fix:* each doc now notes the board that disk last agreed with. Importers apply only the change from that board
      (`importAnnotationsFromDisk`), and so does the collab disk→room reseed.
  - **Root cause 2:** Shift+click now removes an element that is already selected (the user-reported fix). The rig
    re-selected the same three elements by click plus Shift+click, so every second align row failed. The rig now presses
    Esc before each selection (`test(multiplayer)` commit).
  - **Result:**
    - Full run after the sync fix: **382 pass / 12 fail**. Against the baseline, the only regressions were those 12
      align rows.
    - After the rig fix, `L09.context-control` + `L09.selection-align` gave **80 / 0**.
    - Net: **0 regressions vs the v1 baseline on L09/L10** (legacy save mode, local hub, all three directions).
    - The 27 candidate-only rows are the new `L09.v2.*`.
  - **Not run:** accepted save mode, and the cloud backend (`wdio.cloud.conf.ts`).
- ✅ **Task 32**: a pending What's New entry (`f79d0bdc`). `minStudioVersion` needs the release version, so it stays with
  the release flow.

## Retro (interim — Milestones A–B)

- **Worked.** Pure model first (registry / schema / ops / scene) with characterization tests against v1. The review found
  no model bugs beyond M1; every HIGH was at an I/O edge (disk vs room vs file watcher).
- **Worked.** A real-browser E2E harness against the real studio server. It caught the focus steal, the stray `fit()`
  and the room self-echo, none of which unit tests saw. Every E2E scenario is proven red first (R2b initially passed
  against the bug because the view was already fitted).
- **Didn't.** Changing *where* a write lands (disk → room) is a sync-topology change, not a local refactor. Plan the
  echo paths (watcher, persistence, hub lane) explicitly whenever a write path moves.
- **Change for `/plan`.** A storage-format rename must include "grep every doc/agent reference to the old path" in the
  same task. The ingest step hashed a file that no longer existed.
- **Change for `/execute`.** Run the browser E2E after every review fix pass, not only after features.

## Closed 2026-10-02

Shipped in v1.5.0 (`731c64ca` #138, `2dd5fd83` #139, fix `87dac924`); DDR-242 recorded and ingested. The unchecked acceptance criteria above are not lost: adapter decision, Tasks 23/24, the AI-read perf gap, the remaining surface-rig matrix, a full `/flow:validate` and the DDR-100/054 amendments are carried as F1–F6 in [`../followup-annotations-v2.md`](../followup-annotations-v2.md).
