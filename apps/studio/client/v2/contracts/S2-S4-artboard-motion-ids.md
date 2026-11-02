# S2 ↔ S4: artboard motion and element ids for bound annotations

Status: **contract** (Phase 5 contracts spike, 2026-10-18). Writer: S4 planner, aligned with S2.1 as built
on branch `s2-1` (`S2-edit-ops.md`, frozen; `editing/edit-op.ts` `runEditOp`; `DragStateBus` in
`canvas-lib.tsx` unchanged by S2.1). Where S2.1 had not decided, this note decides and **S2 follows**
(marked ▶). Consumers: **S4.10** (ride with the artboard + live re-route), **S4.11** (arrow binds), **S2.7–S2.10**
(artboard drag, resize, arrange, Tidy, menu), **S4.2** (built: `annotations/hosts.ts`, `route.ts`).
Binding: `S4-slices.md` Q3 (membership, one ⌘Z), Q4 (≤ 4 ms routing per frame), Q12 (stamp before bind);
V2-1.4 §4.8 (bind hosts), rule 3 (never a computed id in a durable ref); V2-1.5 (one action = one ⌘Z).

## 1. Live motion: `DragStateBus` gains two members (additive)

Today (`canvas-lib.tsx`):
`interface DragStateBus { current: DragState; setCurrent(s); commitPositions(moved, opts?) }` — `current` is
React state, so a consumer re-renders on every pointer move. A layer that must move 200 stickies at 60 fps
cannot live on that. ▶ S2 adds, keeping the three existing members as they are:

```ts
interface DragFrame {
  phase: 'start' | 'move' | 'end' | 'cancel';
  /** Every artboard the gesture moves (leader + followers), in WORLD units from its start rect, after snapping. */
  moved: Array<{ id: string; dx: number; dy: number }>;
  /** Start rects of the moved artboards (world), the same object for every frame of one gesture. */
  startRects: Readonly<Record<string, { x: number; y: number; w: number; h: number }>>;
  /** ⌥-drag duplicates: the originals stay, so their members must NOT follow. */
  alt: boolean;
}
interface DragStateBus {
  current; setCurrent; commitPositions;                 // unchanged
  /** Synchronous, at most once per animation frame, outside React. Returns the unsubscribe. */
  subscribeFrames(fn: (f: DragFrame) => void): () => void;
  /** Riders for the commit (§2). Returns the unsubscribe. */
  onCommit(fn: (moved: MovedArtboard[], undoGroup: string) => AnnotationOp[] | null): () => void;
  /** The committed layout: meta positions + JSX sizes, world units (what `initialArtboards()` merges). */
  layoutRects(): ReadonlyArray<{ id: string; x: number; y: number; w: number; h: number }>;
}
type MovedArtboard = { id: string; x: number; y: number; dx: number; dy: number }; // final position + delta
```

- `start` fires when the drag leaves `pending` (the threshold), `end` right before `commitPositions`, `cancel`
  on esc / lost pointer (members snap back on screen; nothing was written).
- The frame is emitted from the drag hook's own rAF update (`use-artboard-drag.tsx`), **before** the React
  `setCurrent`, so subscribers draw in the same frame as the ghost.
- Keyboard nudges, align / distribute and Tidy have no frames; they reach S4 through §2 only.

**What S4.10 does with it** (S4's side, recorded so S2 knows what it must not break):
- Members are annotations with `parentArtboard ∈ moved` (sections own their members; a locked item follows).
  During the gesture the layer translates them on screen with a transform. It writes nothing.
- **Artboard rects** come from `layoutRects()` plus the frame's `dx/dy` for moved ids.
- **Element rects** are read **once, at `start`**, from one `window.__maudeCanvasRects()` snapshot (the S4.2
  `HostRects` manifest) and cached **relative to their artboard's origin**. Each frame an `el:` host box is
  `startRects[artboard] + (dx, dy) + rel`. No DOM measurement inside a move frame.
- The re-route runs through S4.2's `createArrowRouter` within the Q4 budget (≤ 4 ms of routing per frame,
  grid 40 while dragging, settle at grid 20 on `end`).

## 2. The commit: one write, one action, one ⌘Z

S4 Q3: the artboard move and the moves of its members are **one** undo record. In op-log projects that means
**one kernel proposal**. ▶ S2 routes **every** artboard-position commit made from the canvas — drag, ⌥-less
keyboard nudge, align, distribute, Tidy (S2.9), "Reset position" (S2.10) — through
`DragStateBus.commitPositions`, so riders always run. Duplicates (⌥-drag, ⌘D, S2.10) do not run riders:
annotations are not duplicated with an artboard in v2.0.

```ts
interface CommitPositionsOptions {
  label?: string;            // unchanged
  undoGroup?: string;        // NEW: the write id the layout and its riders share; minted by the bus when absent
}
```

Inside `commitPositions(moved, opts)` the bus:
1. mints `undoGroup = opts.undoGroup ?? 'ab-move-' + random(10)` (`/^[A-Za-z0-9_-]{1,96}$/`);
2. calls every `onCommit` rider **synchronously** with `(moved, undoGroup)` and concatenates the ops they
   return (S4.10 returns `update` ops for members' `x`/`y` and the bound arrows' cached `start`/`end` +
   `box`);
3. sends **one** request: `PATCH /_api/canvas-meta { file, patch: { layout }, annotations?: { ops,
   actionId: undoGroup } }`.

Server (`/_api/canvas-meta`, canvas-safe already) — ▶ S2 owns this change (it is the layout lane's writer):
- the rider's ops pass **the same validation as `/_api/annotations/ops`** (`parseOps`, caps, lock rules) and
  need `annotate` as well as the layout lane's `edit` (S4-S9 §4); a refused rider refuses the whole PATCH
  (409 / 403, nothing written) — never a moved artboard that left its members behind;
- the server writes `.meta.json` and the board, then proposes **both lanes in one proposal**
  (`proposeLanes(slug, [{lane:'meta',…}, {lane:'annotations',…}], { writeId: undoGroup, kind: 'edit',
  label })` — the method `S4-S9-votes-comments.md` §3.2 adds) → one action, one ⌘Z entry (S5.5 projection),
  one Version history row;
- **legacy link / no op log:** the iframe's DDR-050 record from `buildMoveArtboardsRecord` gets the rider's
  inverse ops as part of the same `CommandRecord`, so the local ⌘Z restores both.

Who moves members when the canvas did not: a v1 peer, an agent editing `.meta.json` by hand, or a git
checkout move the artboard **without** riders. Members stay at their world positions (R2) and keep
`parentArtboard`; S4 shows them as left behind, never as an error. Bound arrows still resolve live.

Not riders: artboard **resize** (S2.8). Members keep their world positions; bound `ab:` ends slide along the
new edge on the next frame; the arrow caches refresh with the next annotation write (open question 2).

## 3. Element ids for a bind: the stamp is an edit-op, not a new route

S4 Q12 needs an authored id on an element before an arrow binds to it (V2-1.4 rule 3). S2.1 already has the
one dispatch route (`POST /_api/edit-op`) and its relay (dgn `edit-op` c2s / `edit-op-result` s2c), and its
refusal order step 4 **stamps every target** (`ensureStamped`). So the stamp needs no route of its own:

```ts
// edit-ops/stamp.ts (▶ S2 owns, added to EDIT_OPS; "adding an op is not a contract change")
export const elementStamp: EditOp = {
  id: 'element.stamp',
  locked: 'allow',              // a locked element may still be pointed at; stamping is not editing it
  actionKind: 'stamp',          // NEW optional EditOp field (below)
  apply: (source) => ({ source }), // identity: the dispatcher's step 4 already stamped the targets
};
```

- S4.11 calls `runEditOp({ op: 'element.stamp', targets: [ref] })` (`editing/edit-op.ts`) and binds to
  `refs[0]` from the result. An already-stamped target answers `ok` with no write and `actionId: null`.
- `held-by-ai` (step 5) → S4 binds to `ab:<artboard>` with the tag "Bound to the artboard" (Q12). `stale` →
  retry once with the fresh `rev`. `forbidden` → the arrow tool is not offered (Can comment never gets here).
- ▶ **`EditOp.actionKind?: string`** (additive, optional; default `'edit'`) — the route passes it through the
  base announcement so the imported `lane.replace` is recorded with that kind. `'stamp'` is outside the ⌘Z
  projection's membership (`edit | ai | trash | restore`), so ⌘Z after drawing an arrow undoes the arrow, not
  an invisible id write. Label: `Named “<element label>” so an arrow can point at it`.
- Registry: ▶ a hidden row `element.stamp` (no menu, no ⌘K, `minRole: edit`, `agent: none` — an agent writes
  ids in the TSX itself per the design skill). Lead patch (shared registry).

**Rejected:** the `element-stamp-request` / `element-stamp-result` dgn pair named in `S4-slices.md` §2. A second
write door into the same `.tsx` would duplicate S2.1's refusal order (role, holds, locks, stale) and could
drift from it. The S4 slice table's lead-patch cell for S4.11 changes accordingly (no new dgn rows).

## 4. Tests that pin this contract

| Test | Owner | Pins |
| --- | --- | --- |
| `drag-bus-frames.test.tsx` | S2 (the slice that edits `use-artboard-drag.tsx`, S2.9) | `start → move* → end` per gesture; one frame per rAF; `cancel` on esc; `alt` set on ⌥-drag; no React render per frame for a subscriber |
| `artboard-commit-riders.test.ts` | S2 | drag, nudge, align, Tidy, Reset position all call riders; duplicates don't; one PATCH per commit carrying `annotations` |
| `canvas-meta-rider.test.ts` | S2 | rider ops validated like `/_api/annotations/ops`; a refused rider writes nothing; read-only / Can comment → 403; one proposal with `meta` + `annotations`, one action id |
| `edit-op-element-stamp.test.ts` | S2 | stamps a computed-id target; a locked target is stamped; `held-by-ai` refused; already stamped → no write; the action's kind is `stamp` and `undo-stack` does not list it |
| `annotations-ride.test.ts` | S4.10 (planned) | members move in the same action; ⌘Z restores artboard + members; loose notes stay; locked follows; section wins |
| `annotations-arrow-bind-ui.test.tsx` | S4.11 (planned) | bind after stamp; busy → `ab:` + tag |

## 5. Open questions (default the run takes)

1. ⌥-drag duplicate: should members be copied onto the duplicate? **No** in v2.0 (riders skipped).
2. Arrow caches after a resize or an element moving inside its artboard (no rider): **refresh lazily** with the
   next annotation write on that board; a v1 peer sees the arrow frozen until then (R2 accepts it).
3. Should an agent's hand edit of `.meta.json` move members? **No** — riders are a canvas behaviour; the design
   skill's "same result by hand" section says so (S12).
