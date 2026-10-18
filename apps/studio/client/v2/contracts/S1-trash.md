# S1 trash — the shared Trash, on the one op log

Cross-lane contract written by **S1.6** as its first commit (S1-slices §2, cross-lane contract 2).
Consumers: **S1.7** (the Trash service + routes), **S1.12** (Version history rows and names), **S2**
(⌫ on an artboard lands the artboard-trash action, C17), **S9** (the `co-trashed` banner, the L18
canvas-only filter), **S12** (`/design:trash`). It fixes the artboard-trash action shape, the item
ids, the four additive kernel ops S1.6 adds and the two additive tables they write.

Sources: S1-slices §2 Q2–Q4 + Q6, S5-kernel-foundation §2–§6, V2-1.9 §5.1, §5.4, §5.8, §5.12, §5.15,
V2-1.5 §5.1 (kinds), V2-1.7 §5.2 (`trash` / `delete`), V2-1.16 L4 / L18. Decisions
`v2-S1-trash-derived-from-store`, `v2-S1-clear-out-kernel-op`, `v2-V2-1.9-named-versions-kernel-op`,
`v2-V2-1.9-kept-aside-versions`.

## 1. What is in the Trash (derived, never a second store)

| Item | Is in the Trash while | Item id | Who / when |
| --- | --- | --- | --- |
| **Canvas** | its `entry` has a `@manifest delete` effect and **no live doc carries that entry**, and that newest delete is not cleared | `canvas:<entry>` | the newest delete effect's action (`actor`, `committedAt`), `path` = its `beforePath` |
| **Artboard** | an action of `kind: 'trash'` names it in `origin.trashed`, and `(entry, artboard, rev)` is not cleared | `artboard:<actionId>/<artboardId>` | that action |

- `entry` is the stable canvas id (S1 Q6). It survives a move; a move is never trash (`@manifest move`,
  not `delete`). An undone create (⌘Z of "AI made this canvas", V2-1.5 U15) is a delete, so it lands
  in the Trash — by design.
- "No live doc carries the entry" (not `docs.retired = 1 AND moved_to IS NULL`): a new canvas created
  at the same path reuses the transport doc name and overwrites that `docs` row, so the row alone
  would lose the trashed canvas. The effect log never loses it.
- The store does not know whether an artboard came back since (a ⌘Z of the trash action, or S1.13's
  "Restore only <artboard>" splice). **S1.7 drops an artboard item whose id is in the canvas's head
  source** — the store lists the record, the studio decides it is still gone.
- Reader: `store.trash({ entry? })` → `{ canvases: CanvasItem[], artboards: ArtboardItem[] }`, newest
  first, cleared items left out. `store.trashCleared({ entry? })` → the cleared rows.

```ts
interface CanvasItem   { id: `canvas:${string}`; entry: string; doc: string; path: string;
                         rev: number; actionId: string; actor: string; at: number }
interface ArtboardItem { id: `artboard:${string}/${string}`; entry: string; doc: string | null;
                         artboard: string; label: string | null;
                         rev: number; actionId: string; actor: string; at: number }
```

## 2. The artboard-trash action (S2 lands it; the kernel stores it)

One proposal, `action.kind: 'trash'`, `action.label: "Moved “<label>” to the trash"`, the
`lane.replace` operations that remove the artboard (tsx range, meta `layout.artboards[id]`, the
annotations whose `parentArtboard` is it), and in the envelope origin:

```ts
origin.trashed: Array<{ artboard: string; label?: string }>   // 1–200 entries
```

- `artboard`: 1–128 characters, no `/`, no control characters. `label`: a string, cut to 200.
- Kept only on a `kind: 'trash'` action and only when every entry is well formed; otherwise dropped,
  never refused (the origin rule — a v1 client sends none of it).
- The item's `entry` is the entry of the action's first lane effect. Deleting a whole canvas is
  `doc.delete` (any kind; V2-1.5 names it `trash`) and needs no `origin.trashed`.

## 3. Kernel ops (additive, v1-compatible)

Each is the **only** operation of its proposal (`invalid` otherwise). A v1 client never sends any of
them; a v2 studio against an older hub gets `invalid` (`unsupported operation …`) and shows "… needs
the team server to be updated". The hub advertises them in `bootstrap.capabilities.operations`.

| Op | Body | Needs | Commits | Refused |
| --- | --- | --- | --- | --- |
| `history.name` | `{ doc, revision, name: string \| null }` | `edit` | one action `kind: 'name'`, `label: name`, one `@name` effect (no lane effect), upserts `names` | `invalid` (bad name / revision > head / no version of this canvas at or before it), `dependency-missing` (doc not live) |
| `history.aside` | `{ doc, lane, content, label? }` | `edit` | one action `kind: 'aside'`, one `@aside` effect `op: 'aside.<lane>'` (`beforeHash` = head, `afterHash` = the kept body), the body as a blob; **no head moves** | `source-invalid`, `dependency-missing`, a body equal to the head → accepted no-op |
| `trash.restore` | `{ entry }` | `trash` | one action `kind: 'restore'`: the canvas comes back with the **same entry** — in place (same doc, generation + 1, lanes as they stood) or, when its path is taken, at `<name> 2.tsx` (`3`, … `99`) with the lanes as they stood at the trash revision | `cleared` (409, final), `dependency-missing` (`not in the trash`), `path-conflict` (no free name) |
| `trash.clear` | `{ items?: string[] }` (absent = everything in the Trash; 1–500 distinct ids) | `delete` (owner, project-level) | one action `kind: 'trash.clear'`, one `@trash` effect per item (`op: 'trash.clear'`), `trash_cleared` rows; result `cleared: ids`, `skipped?: [{ id, reason }]` | `forbidden` (not the owner), `not-in-scope` (any canvas-only session), `invalid` (bad ids); nothing left to clear → accepted no-op |

- **Name snapping** (V2-1.9 §5.4): a `revision` that did not change the canvas snaps to the newest
  revision ≤ it that did — an action with a lane effect (`html css meta annotations`) or a
  `@manifest` effect on the canvas's entry, of a kind other than `name` / `comment`. The result
  carries `revision` of the name action and `named: { entry, rev, name }`. `name` is trimmed,
  1–80 characters, no control characters; `null` removes it (the `name` action stays in the log).
- **The log carries every fact, the tables are its index.** The kernel stamps (never the client)
  `origin.named = { entry, rev, name }` on a `name` action and `origin.cleared = [{ entry, artboard, rev }]`
  on a `trash.clear` action. `@name` / `@aside` / `@trash` effects carry `doc` + `entry`, so the L4 /
  L6 / L18 filters that drop effects of invisible canvases drop these too, with no new filter.
- **No head moves on `name` / `aside` / `clear`.** `laneAt`, `effectsAfter` and undo rebase read real
  lane names only, so these effects never change a restore, an undo or a replay.
- **Undo.** `name`, `aside` and `trash.clear` have nothing to compensate (⌘Z → `undo-conflict`;
  `name` is not in the ⌘Z projection anyway). `trash.restore` undoes like a create: back to the
  Trash. **A cleared item stays gone:** an undo whose target is a cleared artboard-trash action, or
  whose delete effect is a cleared canvas, skips it (`skipped: [{ reason: 'cleared' }]`; nothing
  left → `undo-conflict`). Nothing else about undo changes.
- **Retention (Q4 default, Michal):** clear-out deletes the per-Mac `_trash/` copies and the hub
  quarantine for those items (S1.7, from `applyAccepted`'s additive `trashCleared` list). **Store
  lane bodies stay** until the pruning DDR, which must prune cleared items first.

## 4. Tables (additive — `CREATE TABLE IF NOT EXISTS`, no schema bump)

```sql
names (entry TEXT, target_rev INTEGER, name TEXT, actor TEXT, at INTEGER, rev INTEGER,
       PRIMARY KEY (entry, target_rev))
trash_cleared (entry TEXT, artboard TEXT, rev INTEGER, by TEXT, at INTEGER, cleared_rev INTEGER,
               PRIMARY KEY (entry, artboard, rev))      -- artboard '' = the whole canvas
```

- `names.rev` / `trash_cleared.cleared_rev` = the revision of the action that wrote the row;
  `trash_cleared.rev` = the revision of the action that put the item in the Trash.
- Written by `commit()` in the same transaction as the action (`input.names`, `input.cleared`). An
  old hub opening the store ignores both tables (every old `INSERT` names its columns).
- Readers: `store.names(entry)` → `[{ entry, targetRev, name, actor, at, rev }]` (target newest
  first); `store.trash(q)`; `store.trashCleared(q)`. A store home without them (a remote store
  before its method list grows) makes the ops answer `invalid`, never `retryable`.

## 5. Access (V2-1.7 matrix, V2-1.16 L4 / L18 — all on the server)

- The kernel gates per op through `auth.can(cap)` (`'edit' | 'trash' | 'delete'`, project-level):
  `lane.replace` / `doc.create` / `doc.move` / `dir.*` / `history.*` need `edit`, `doc.delete` and
  `trash.restore` need `trash`, `trash.clear` needs `delete`. A caller that passes no `can` keeps
  today's behaviour (every non-read-only actor may do everything) **except `trash.clear`, which is
  refused** — fail closed. The hub passes `can` from the token's role (owner = `who.owner`); the local
  home passes "owner" (a local project is the owner's, S1 Q4).
- A canvas-only session (`auth.inScope`, S9.5): `history.name` / `history.aside` /
  `trash.restore` are judged on the canvas's path **before** the op can answer anything that names
  it (unknown, cleared, not in the Trash all read `not-in-scope`); a restore that lands at
  `<name> 2` is judged on the new path too. `trash.clear` is `not-in-scope` (project-level).
  `edit` ⇔ `trash` for every canvas grant (V2-1.7 R4), so the `edit` judge is the `trash` judge.

## 6. Tests

`apps/hub/test/kernel-history-name.test.mjs` (name: snap, null removes, not a row, `edit`, scope,
v1 envelope unchanged; aside: no head moves, restorable body), `apps/hub/test/kernel-trash.test.mjs`
(derivation incl. same-path re-create, restore in place / `<name> 2` / `cleared`, clear by a member
→ `forbidden`, by the owner, canvas-only → `not-in-scope`, ⌘Z after clear-out), both with the
identity and the gzip codec.
