# S5 kernel foundation — the one op log under S1, S2 and S5

Cross-lane contract written by **S5.1a** as its first commit (S5-slices §2 D1, cross-lane contract 1).
Consumers: **S1** (local Version history, Trash, links — S1.6, S1.7, S1.12, S1.13, S1.18), **S2** (the ⌘Z
projection) and the rest of **S5** (S5.1b, S5.2, S5.3, S5.5, S5.15). It fixes what the kernel and the
store core give every project — hub, cell and local — so none of them builds a second log.

Sources: V2-1.5 §5.1–§5.2 and §5.6, V2-1.9 §5.2–§5.3, V2-1.15 §5.2, S1-slices §2 (Q1, Q2, Q3, Q6),
decisions `v2-V2-1.5-one-op-log`, `v2-S1-op-log-foundation-in-S5`, `v2-S1-trash-derived-from-store`,
`v2-S5-kernel-file-order`.

## 1. File order (binding)

`apps/hub/src/project-transactions/kernel.mjs` and `store-core.mjs` are edited by one builder at a time,
in this order: **S5.1a → S5.2 → S1.6**. S5.1b (studio side) never edits them; it imports them. One hub
release (lead, the V2-2.18 procedure, before any rc) carries S5.1a + S5.2 (+ S1.6 when ready).

## 2. What the kernel gives (S5.1a — hub, additive, v1-compatible)

| Piece | Shape | v1 client sees |
| --- | --- | --- |
| Envelope origin keys | `origin.runId`, `origin.chatId` (`/^[A-Za-z0-9_-]{1,64}$/`), `origin.madeAt` (safe integer ≥ 0, ms, the person's clock). Anything else under those names is dropped, not refused. | nothing new; `deviceId`/`sessionId`/`client` unchanged |
| Multi-target undo/redo | `{ op: 'history.undo' \| 'history.redo', actionIds: string[] }` — 1–50 distinct ids, every one the caller's own. `actionId` and `actionIds` together → `invalid`; a malformed list → `invalid`; an unknown id → `dependency-missing`; a foreign id → `forbidden` | never sends it |
| Result of a multi-target undo | ONE action, `kind: 'undo' \| 'redo'`, `undoes: actionIds`, `skipped?: [{ doc, lane?, reason, conflictWith? }]` | — |
| `undoes` on a history row | `string` for a single-target undo (as today), `string[]` for a multi-target one, `null` otherwise. **Readers accept both.** | unchanged for its own rows |
| `actions.run_id`, `actions.chat_id` | additive nullable columns + indexes, filled from `origin` at commit | ignored (`SELECT *` extras) |
| `store.history({ chat?, run?, actor?, kind? })` | additive filters on the existing `history` method (newest first, as today) | — |
| Blob codec | `createStoreCore(sql, { codec })` (§4 C4) | — |

**Multi-target semantics** (V2-1.5 §5.2). For each `(entry, lane)` any target touched: start from the
before-content of the **oldest** target effect on that lane, then rebase it three-way through every later
effect on that lane **except the targets' own**. A conflict skips that lane only (`skipped`, with
`conflictWith` = the action whose effect conflicted, so the studio can say "changed by your AI since").
Manifest and directory effects are compensated newest target first, effects in reverse, as today. Nothing
applies → `undo-conflict`. The redo of that undo is the ordinary single-target redo of the one undo action,
so ⌘Z after "Undo this chat" re-applies the whole chat at once.

A single `actionId` keeps its v1 answer: the same result keys (no `undoes`, no `conflictWith`) and the
same stored `undoes` string. One deliberate change applies to both: manifest and directory effects now
compensate **before** lane effects (an action's effects come back from the store ordered by random effect
id, so the order used to be arbitrary). A document the undo deletes keeps its lanes as they stand, so its
redo revives it whole; a document the undo revives is live before its lanes revert.

The hub's `GET …/history` route still forwards only `before`/`limit`/`entry`; exposing the new filters
(and a capability line so a v2 studio can tell an old hub without trying) is a follow-up patch on
`hub-integration.mjs` (S5.1a hand-back, taken by S5.2).

## 3. What the store gives (unchanged guarantees S1 builds on)

- `docs.entry` is the stable identity of a canvas; it survives `doc.move` (S1 Q6: the link id).
- A deleted canvas keeps its `docs` row: `retired = 1 AND moved_to IS NULL` is "in the trash"; its
  `@manifest delete` effect gives who and when (S1 Q2). Nothing here deletes a row or a body.
- Lane bodies are content-addressed (`blobs.hash` = sha256 of the raw lane text) and never pruned in v2.0.
- One commit writes head + action + effects + payloads + result in one transaction.

## 4. The local home (S5.1b — studio, `apps/studio/sync/local-kernel.ts`)

The same `createKernel` + `createStoreCore` run in-process over `bun:sqlite` at
`<designRoot>/_state/project-store.sqlite` (V2-1.5 §5.6). Acceptance validates with the studio's own
source checks; there is no projection, the disk already holds the content. S1's four conditions
(V2-1.9 §5.3) are part of the foundation:

- **C1 — one machine per store.** `store_meta.machine` = this install's stable id (never per project copy).
  A store whose `machine` differs (a Syncthing / Dropbox / iCloud copy, a `cp -R`) is never written: it is
  renamed `_state/project-store.<machine>.sqlite` (machine id sanitised to `[A-Za-z0-9_-]{1,64}`), opened
  read-only, and listed in Version history › Advanced as "History from <Mac name>". A fresh store starts
  with a baseline (C3).
- **C2 — one writer.** `_state/project-store.lock` holds `{ pid, bootId, at }`. A second studio on the same
  folder opens the store read-only and its edits wait ("Another Maude window is saving this project"). A
  lock whose pid is gone or whose boot id differs is taken over. `journal_mode=WAL`, `synchronous=FULL`.
- **C3 — baseline.** The first v2 boot of a local project imports every canvas as one
  `kind: 'migration.import'` action per canvas (`baseline.mjs` shape). That row reads "Version history
  starts here".
- **C4 — gzip codec.** `createStoreCore(sql, { codec })`, `codec = { encode(text) → string | Uint8Array,
  decode(stored) → string }`, default identity. It is applied to `blobs.body` and to every
  `blob_parts.body`; `hash` and `size` always describe the raw text, so deduplication and the part split
  are codec-blind. `decode` must accept a value written before the codec existed (a plain TEXT row). The
  hub and the cell keep identity until their own release decides (V2-1.9 Q4); the local home passes gzip.
  The store tests run with both codecs.

None of `_state/project-store.sqlite`, `project-store.<machine>.sqlite` or `project-store.lock` is a new
runtime class: `_state/` is already ignored in all four DDR-115 lists (the S5 P5 tripwire fixture rows).

## 5. The one shared `syncControl` surface

A local project answers through **the same** methods on `ctx.syncControl.current()` that a linked
project uses today (`apps/studio/sync/index.ts`): `acceptedHistory(q)`, `acceptedVersion(repoRel,
revision)`, `acceptedRestore(repoRel, revision)`, `acceptedUndo(actionId, redo?)`. No route or client
learns which home answered; `/_api/project/{history,undo,restore}` stop answering `legacy` for local
projects (S5.1b done-when). Extensions land on these same methods, never beside them:

- S5.5: `acceptedUndo` takes `{ actionId } | { actionIds } | { chatId }` (+ `redo`), and the bus event
  `project:action` (V2-1.5 §5.3). `{ chatId }` resolves to the caller's own actions of that chat through
  `store.history({ chat, actor })`, then sends one `actionIds` proposal.
- `AcceptedHistoryRow.undoes` widens to `string | string[] | null`.
- S1.6 (after S5.2): `history.name` + a `names` table, `history.aside`, `trash.restore { entry }`,
  `trash.clear { items }` + `trash_cleared`, per-op role gate — additive kernel ops on the same log.

**Watcher writes are `kind: 'outside'`.** A change on disk that no open AI run claims (V2-1.5 §5.5) is
proposed by the studio's watcher as an ordinary action with `kind: 'outside'`; for a git operation Maude
ran, one `outside` row labelled by that operation (V2-1.9 §5.2).

## 6. Compatibility rules

- A v1 studio never sends `actionIds` or the new origin keys; every v1 envelope is accepted and stored
  exactly as before. `test/kernel-multi-undo.test.mjs` pins it.
- A v2 studio against an old hub gets `invalid` for `actionIds` and shows "Undo this chat needs the team
  server to be updated" (V2-1.5 Q2). There is no sequential fallback.
- Old hubs opening a store migrated by the new one keep working: the new columns are nullable and every
  old `INSERT` names its columns.
