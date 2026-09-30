# Code review — worktree-annotations-v2 (uncommitted, base fa3290bf)

**Verdict: NEEDS FIXES**

Scope: the uncommitted diff plus the new untracked `apps/studio/annotations/**`, sync/collab/api/http/server,
the layer changes, the hub lanes/workspace/manifest and the bins. Reviewed against DDR-242 and the plan's Execution Log,
including the recorded deviations: no `move` op, undo through the v1 snapshot diff, SVG upconverted instead of refused,
and `minStudioVersion` deferred. Two findings were reproduced with a scratch script: the nested-delete jump (M1), and
`canonicalAnnotations` returning `null` for a conflicted or v3 file (H2). The rest come from reading the code paths.

The core is solid:

- The pure model is well separated: registry, schema, ops, scene.
- `diffToOps` puts patches before deletes, so the adapter path never hits the container fix-up ordering bug below.
- The lane `''` semantics agree between the studio codec (`annotationsLaneValue`) and the hub kernel (`checkLane` /
  `readLane`), and the kernel merge is diff-based.
- Accepted mode never proposes annotations from a file event (`projection.ts:937-945`), which keeps the stale-disk
  problem in H1 out of that mode.

The two HIGH findings are both "whole board from a stale or unreadable source" paths, the DDR-223 class this feature
exists to end.

---

## HIGH

### H1 — The op path reads its base from DISK, then overwrites the live doc wholesale, so peers' edits are reverted in legacy shared-doc / pinned-room mode

`apps/studio/api.ts:2197-2222` (`applyAnnotationOps` → `loadBoardElements` → `writeBoardFile` →
`onAnnotationsChanged`), `apps/studio/server.ts:129-131` (`syncRoomFromAnnotations`), `apps/studio/collab/registry.ts:120-131`,
`apps/studio/sync/agent.ts:436-444` (`applyFromFs` → `applyAnnotationsToDoc`).

**Scenario.** A v2 hub without a journal runs in legacy shared-doc mode: the capability is advertised without `ledger`
(`hub/src/server.mjs:906`).

1. Peer B adds sticky P. It lands in the provider/room doc at once. The disk copy follows only after the 800 ms
   debounced flush (`sync/agent.ts:23`, `collab/persistence.ts:170`), and every further doc update re-arms that timer.
2. Within that window the local user drags a shape.
3. `applyAnnotationOps` loads the stale file (no P), applies the patch and writes the file.
4. `syncRoomFromAnnotations` then runs `writeReplica(room.doc, staleBoard+op)`. `writeReplica` makes the replica hold
   *exactly* that set, so P is deleted.
5. The file watcher then runs `applyAnnotationsToDoc(providerDoc, …)` with the same set. The deletion reaches the hub
   and every peer.

While B keeps drawing, the window never closes: each of the local user's commits erases everything B did since the
last flush.

This is a regression against v1. The v1 layer PUT the browser's view, and that view was kept current from the room.
v2 moved the base to the file. It also contradicts DDR-242 §4 ("different elements never conflict") and §5 ("the
studio applies ops in one transaction" to the replica).

**Fix.**

- When a live doc exists for the slug (a room, or a pinned provider doc), apply the batch with
  `applyOpsToReplica(doc, ops, origin, {actionId})` and stamp `annotationsEditAt` in the same transaction.
- Let the existing persistence/agent write the file.
- Keep the disk read-modify-write only for the no-doc case.
- In accepted mode, keep proposing, but take `baseText` from `readLaneFromDoc` / the replica, not from disk.
- Add a test: seed the doc with P, leave disk stale, POST an op for another element, assert P survives in the doc.

### H2 — An unreadable board is treated as an EMPTY board, so the next op or agent write erases it

`apps/studio/api.ts:2127-2144` (`loadAnnotations` returns `null` for "exists but not a board";
`loadBoardElements` maps that to `[]`), `apps/studio/http.ts:2416` (GET turns `null` into an empty board),
`apps/studio/annotations/v1-bridge-io.ts:45` (`?? ''`), `apps/studio/bin/annotate.mjs` (`boardFile.elements.length ? … : ''`).

`canonicalAnnotations` returns `null` for three kinds of file (the first two were verified with a scratch script):

- a `.annotations.json` holding git conflict markers. The file is versioned with one element per line, so a merge
  conflict in it is a realistic event.
- a board from a newer client (`"v":3`).
- a truncated or hand-broken file.

Every consumer then collapses `null` into `[]`:

- The canvas shows an empty board.
- The first sticky the user draws POSTs a `put`. `applyOps([] , put)` → `writeBoardFile` replaces the whole file with
  that one element, and the change is broadcast to the room/hub.
- `maude design annotate` does the same through the bridge. It writes the agent's strokes over the file, or sends them
  as a whole-board PUT.

`sync/codec.ts:317` has the same collapse on the cold-start side (`canonicalAnnotations(local) ?? local`, which is then
"empty"). There the hub wins, which is survivable. The API and bin paths are not.

**Fix.**

- Make "file present but not a board" a distinct state, e.g. `loadAnnotations` → `{ state: 'absent' | 'ok' | 'unreadable' }`.
- `applyAnnotationOps` / `saveAnnotations` / `readBoardFile` must refuse with a surfaced error (409/422, and the layer
  shows it). They must never apply onto `[]`.
- GET should return an error status, so the layer does not render an empty board it will later diff against.
- Add a regression test: write conflict markers into the file, POST a put, assert the file is unchanged and the
  response is an error.

---

## MEDIUM

### M1 — Deleting nested containers in the order parent-then-child leaves a dangling `parent`, and the child jumps

`apps/studio/annotations/ops.ts:174-188`, `apps/studio/annotations/scene.ts:53-67`, `apps/studio/annotations/schema.ts:104-128`.

**Reproduced.** The board is section P ⊃ section X ⊃ sticky S (S at world 160,160). The batch is
`[delete P, delete X]`.

1. Deleting P skips X, because X is in `deleting`.
2. Deleting X then builds a Scene in which X's parent P no longer exists. `effectiveParent(S)` walks up to the missing
   P and returns `null` for S, so `childrenOf(X)` is empty and S is never re-parented.

Result: S keeps `parent:"X"`, which now dangles. It renders at (10,10) instead of (160,160), and no op reports a
rejection. In the order `[delete X, delete P]` the batch is correct.

A related inconsistency:

- `Scene.effectiveParent` drops the WHOLE ancestor chain when any link is broken.
- `validateElements` clears only the broken link.

So after a reload (validation), the same stale record renders at a different place than it did live.

The v1 adapter is not affected (its patches precede its deletes). It is reachable through `POST /_api/annotations/ops`
(canvas-origin, untrusted), and it becomes the normal path once the v2 UI and Task 27's `annotate` send deletes
directly.

**Fix.**

- Resolve re-parenting against the nearest ancestor that is not being deleted, summing the origins of the containers
  that are, using a Scene built once from the input state.
- Or process deletes deepest-first.
- Make `effectiveParent` agree with `validateElements`: stop at the first missing link and use the ancestors that
  still exist.

### M2 — Skipping the author's own echo hides server-side results the author never saw

`apps/studio/annotations-layer.tsx:1196-1202`.

On an own `actionId`, the layer updates `elementsRef` but not the strokes. The write carrying our id can contain more
than our ops:

- (a) a character-level text merge with a peer's concurrent edit (`ops.ts:95`);
- (b) in accepted mode, the kernel's `applyLane` writes the *merged head*, peers' concurrent changes included, tagged
  with our `writeId`;
- (c) `~action` is a single last-writer-wins Yjs key, so a peer's concurrent transaction can surface under our id.

In each case the peer's content stays invisible until some unrelated foreign write arrives. There is no data loss,
because diffs are stroke-before/after, but the canvas shows a different board than disk and than peers.

**Fix.** On an own echo, reconcile when `elements` differs from the optimistic state (compare the `changed` ids), rather
than returning early.

### M3 — Peer annotation-selection halos no longer refresh on annotation changes

`apps/studio/cursors-overlay.tsx:358` still observes `collab.doc.getMap('annotations')`, the v1 map that v2 never writes.
The comment above it says this is what re-resolves `[data-id]` bounds when a peer moves or resizes a stroke. Only the
250 ms selection poll is left.

**Fix.** Use `getMap(REPLICA_TYPE).observeDeep`, or `observeReplica`.

### M4 — Forward compatibility holds for new element TYPES, but not for new FIELDS or enum values on known types

`apps/studio/annotations/registry.ts:109-112`, `apps/studio/annotations/fields.ts:285-298`, `apps/studio/annotations/replica.ts:136-147`.

`parseFields` silently drops unknown keys and resets unknown enum values to the default (`kind:'star'` → `rect`).
Every whole-board `writeReplica` (room sync after an op, `applyAnnotationsToDoc` from the file watcher, the hub's
`applyLane`) then deletes those keys from every inner `Y.Map` whose element it rewrites. One write from an older v2
peer therefore strips a newer peer's additions across the whole board. That is the field-level version of BREAKER's
dissent, which DDR-242 §1 claims to handle only for types.

**Fix.**

- Either preserve unknown keys on known types (a bounded `sanitizeJson` passthrough in a canonical tail position), or
  make `writeReplica` never delete a field that the incoming set simply does not model.
- Also document the enum-downgrade rule.

### M5 — Whole-board writers still replace exactly, and a v1 tab left open across the upgrade reverts v2 edits

`apps/studio/http.ts:2436-2450` (`PUT {svg}` accepted, "a v1 tab still open across an upgrade"), `apps/studio/api.ts:2172-2190`,
`apps/studio/bin/annotate.mjs` (server PUT of the full board).

The PUT handling:

- A v1 tab observes `Y.Map('annotations')`, which v2 never writes. Its view is frozen at load.
- Its next save is a whole SVG. `saveAnnotations` migrates it and writes it as the board.
- In local and shared-doc modes it then reaches the room via `writeReplica`, again an exact-set write.

Everything other clients changed since that tab loaded is reverted, or deleted. `annotate`'s server write has the same
shape, with a smaller window (read → PUT).

**Fix.**

- In non-accepted modes, when `base` is present, run the kernel's own merge (`applyOps(current, diffToOps(base, ours))`)
  instead of replacing.
- Consider refusing `svg` from a canvas-origin PUT once the board is v2. DDR-242 §5 says the hub refuses it.

### M6 — Ops that fail on the hub (`gone`) disappear silently, and the client does not surface rejections

`apps/hub/src/project-transactions/lanes.mjs:191-199` ignores `r.rejected`. `annotations-layer.tsx` only
`console.warn`s the `rejected` list returned by `/ops`.

Example: a patch to an element a peer deleted is dropped, so the user's edit vanishes. DDR-242 §4 says "the client
offers to restore". This is acceptable while the adapter is in place, but it needs to be tracked for Task 26, and at
minimum surfaced in the UI rather than the console.

### M7 — A second migration of the same slug overwrites the first backup

`apps/studio/annotations/migrate-boot.ts:99-105`.

Both the `_history/<slug>/pre-annotations-v2/<name>` snapshot and `_trash/annotations-v1/<name>` use fixed names.
Suppose a board is migrated, then an old branch checkout or git revert brings the `.svg` back with the `.json` gone.
The second run overwrites both earlier originals. That contradicts "never deletes: every original survives".

**Fix.** Add a `stamp()` to both names, as the stale-quarantine path already does.

---

## LOW

- **Char vs byte caps.** `api.ts:2179/2214/2228` and `schema.ts:146` compare `text.length` (UTF-16 units) to
  `MAX_ANNOTATIONS_BYTES`, while `sync/codec.ts:348` and the hub compare UTF-8 bytes. A non-ASCII-heavy board near the
  cap is accepted and written locally, then refused by sync and the hub. It stays local with only a console warning.
  Use `byteLengthUtf8` everywhere.
- **Concurrent label edits.** In `ops.ts:97-102`, the shape-label merge spreads `{...cur, ...next}`. When a peer has
  concurrently touched the label, the author cannot *remove* a label sub-field (for example `bold`), because it is
  resurrected from `cur`. Merge sub-fields against `base` the same way the top-level fields are merged.
- **Delete fix-up performance.** `ops.ts:156-173` builds a new `Scene` and resolves `arrowWorld` for EVERY arrow on
  every delete, O(deletes × elements). Bulk deletes on large boards will be slow on the hub and studio hot paths.
  Check the binding (`e.el === id`) before resolving the endpoints, and reuse the Scene across the batch.
- **Re-canonicalized file writes.** In `sync/agent.ts:445`, `lastAnnotations = str` stores the raw file text while
  `writeAnnotationsIfChanged` compares canonical text. A hand-formatted but valid file is therefore rewritten in
  canonical form on the next doc update. Harmless, but surprising; store the canonical form.
- **Adapter keeps stale parents.** `v1-adapter.ts:356-360` keeps the parent of an unmoved element even when a section
  resize has left its centre outside the section. The element is then a child the v1 UI will not move with the
  section, but the v2 UI will. Acceptable during the adapter phase; note it for Task 26.
- **Silently dropped ops.** `parseOps` reports `dropped`, but `http.ts:2475` discards the count. Malformed ops vanish
  without being echoed in `rejected`.
- **Test hook.** `data-selection` (`annotations-layer.tsx:3936/3976`) subscribes `AnnotationsSvg` to the selection
  context although it already receives `selectedStrokes`. Derive the value from the prop instead.
- **Agent-facing docs still say `.annotations.svg`.** Examples:
  - `plugins/design/references/edit/07-3-…md:35` tells the agent to read `[data-id=…]` from `<slug>.annotations.svg`,
    which no longer exists after migration.
  - `plugins/design/commands/board.md`
  - `skills/whiteboard/_guide-00-overview.md`
  - `templates/brief-board.tsx.template`
  - `site/content/docs/hub/linking.mdx`

  Update them with Task 27, or now for the edit reference, because it breaks comment-anchored edits.
- **Label ids are not element ids.** The v1 label stroke ids (`<id>~label`, `v1-adapter.ts:36`) are not v2 element ids.
  A comment anchored on a shape label's text gets an `annotationId` that resolves to nothing.

## Dead code / simplification

- `apps/studio/annotations-sync.ts`: `createAnnotationEchoGuard`, `observeAnnotationSnapshots` and
  `ANNOTATION_WRITE_ID` have no remaining callers. Only `validAnnotationWriteId` is used.
- `apps/hub/src/project-transactions/lanes.mjs:38-39`: the `ANNOTATION_WRITE_ID` export is unused. Its comment points at
  the v1 echo mechanism.
- `sync/codec.ts`:
  - `isEmptyAnnotationsSvg` is now a pass-through to `isEmptyBoardText` with a misleading name;
    `annotationsFromDoc` is a pass-through to `replicaBoardText`. Rename them or inline them.
  - `Y_TYPES` is still imported for comments only.
- `annotations/board-text.ts:13-22`: two stacked JSDoc blocks. The first describes `canonicalAnnotations` but sits on
  `annotationsLaneValue`.
- The two `canonicalAnnotations → parseBoard → validateElements` round trips (`readLaneFromDoc`,
  `applyAnnotationsToDoc`) re-validate a board that `readReplica` already validated. Compare element sets directly.
- `api.ts` keeps `sanitizeAnnotationSvg` re-exported for external callers. Check whether anything outside the bins still
  needs it from `api.ts`.

---

## Resolution (fix pass before commit)

**Verdict after fixes: PASS WITH SUGGESTIONS.**

| Finding | Status | Where / how | Test |
|---|---|---|---|
| H1 live room revert | fixed | `collab/registry.ts` `applyOpsToRoom` applies the batch to the live replica, with the `annotationsEditAt` stamp in the same transaction. The room's persistence projects it to disk. It is wired through the `applyAnnotationOpsLive` api hook, and skipped in accepted mode, where the hub kernel merges against the base. A never-populated replica falls back to the disk path. | `collab-annotations-bridge.test.ts` (peer edit survives) |
| H2 unreadable board treated as empty | fixed | `api.ts` `readBoard` distinguishes absent from invalid or oversized. GET returns 409, `/ops` returns 409 `unreadable`, and PUT refuses. `v1-bridge-io.ts` `readBoardFile.unreadable` makes `annotate` and `read-annotations` refuse. | `annotations-api.test.ts` (a conflicted file stays byte-identical) |
| M1 nested delete jump | fixed earlier | ancestor walk plus deferred patches | `annotations-v2-ops.test.ts` |
| M2 own echo hides server merges | fixed | The echo of the *newest* own action is applied. An unmerged echo keeps the same state object, so there's no re-render under an open editor. | E2E suite |
| M3 halos watch v1 map | fixed | `cursors-overlay.tsx` deep-observes `REPLICA_TYPE`. | — |
| M4 unknown fields on known types | deferred | Belongs to Task 26 (registry-native editing). Documented in the DDR-242 amendments. | — |
| M5 whole-board PUT replaces | fixed | With a `base`, the PUT becomes `diffToOps(base, ours)`, applied to the live room or merged onto disk under the one merge rule. | `annotations-api.test.ts` |
| M6 silent `gone` | deferred | UI surfacing, with Task 26. | — |
| M7 re-migration overwrites backups | fixed | `freshPath` timestamps a taken name. | `annotations-v2-migrate-boot.test.ts` |
| LOW docs `.svg` | fixed | All plugin docs point at `.annotations.json`. Ingest step 6b hashed the old file (a functional bug) and now hashes the board. | — |
| Dead code | partly | `annotations-sync.ts` is reduced to `validAnnotationWriteId`, and `ANNOTATION_WRITE_ID` is dropped from `lanes.mjs`. Codec renames wait for Task 26. | — |

**Found by the E2E re-run after the fix pass:** with H1, the room writes the file itself, and the watcher's echo of an
*older* projection re-seeded the room over a newer op. Delete → ⌘Z lost the undo. This race already existed for browser
peers; H1 made it deterministic. Fix: the room records what it projects (`onAnnotationsProjected`), and
`collab/index.ts` treats a matching watcher echo as its own and does not re-seed from it (consumed once). Scenario R5
"Delete … ⌘Z brings it back" is red without the fix and green 4 out of 4 runs with it.
