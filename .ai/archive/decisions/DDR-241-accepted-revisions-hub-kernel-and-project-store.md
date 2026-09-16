# DDR-241 — Accepted revisions: one hub-owned kernel, one store schema, two durable homes

- **Status:** Accepted — 2026-09-15
- **Plan:** `.ai/plans/archive/feature-reliable-project-multiplayer.md` (closes the T8 selection gate; governs T9–T14)
- **Supersedes:** nothing. **Extends:** DDR-064 (shared doc — now an accepted *replica*), DDR-102 (cold start — base-aware), DDR-226 (file plane stays the project-file lane), DDR-054 (hub content is untrusted to peers)
- **Evidence:** `.ai/plans/notes/reliable-project-multiplayer-spikes.md` (T6 contract, T7 publication barrier, T8 SQLite/workerd/S3/DO-R2 probes), `docs/architecture/project-transactions.md`

## Context

The audit (2026-09-13) showed that no single boundary accepts a user's change: studio projectors, the hub
workspace agent and file imports all mutate the same Yjs documents and checkout, and "saved" meant only that
a socket was open. T7 proved a publication barrier on the installed Hocuspocus 4.3 / Yjs 13.6 (read-only
client content, kernel-written accepted docs, retained candidates). T8 measured the storage candidates: local
SQLite and workerd DO SQLite pass the shared conformance corpus; an R2-first hot path failed the latency gate
(coordinator 337/444 ms) while the DO-SQLite hot path passed (42–49 ms coordinator, 91–96 ms client ACK).
The source validator cannot run natively in a Worker (no `dlopen`, no WASI binding) and the pure-JS parser
falsely accepts invalid cases, so validation must run where OXC runs: in Node.

## Decision

1. **The kernel runs in the hub process, in both distributions.** Self-host runs it in the hub container;
   cloud runs the *same* hub image inside the cell container. There is exactly one acceptance implementation
   (`apps/hub/src/project-transactions/`), which validates with the studio's own `sourceError` (T3) and
   applies accepted lanes to Hocuspocus documents with a server origin. Nothing else writes accepted content.
2. **One store schema, two durable homes.** `project-store-core.mjs` is runtime-neutral ESM over a tiny
   synchronous SQL interface (`exec`, `transaction`).
   - *Self-host:* better-sqlite3 in the hub's persistent data volume, `journal_mode=WAL`,
     `synchronous=FULL`. RPO 0 for acknowledged actions across hub restart and replacement of the
     renderer/checkout (`/repo`) disk. Loss of the data volume is a disaster case with its own RPO/RTO
     (backups; optional S3 object-journal mirror — the T8 conditional-head candidate), never claimed by the
     commit path.
   - *Cloud:* the cell Durable Object's SQLite storage (`MaudeCellB` is already a SQLite class). The hub
     reaches it through `@cloudflare/containers` **`outboundByHost`**: a request from the container to
     `http://project-store.internal/` is handled inside the Worker, which calls an RPC method on *this
     container's own* DO (`ctx.containerId`) — no public hop, no shared credential, tenant-scoped by
     construction. One DO `transactionSync` commits head + log + payload + idempotency result; the hub ACKs
     only after it returns. Container or disk replacement rebuilds accepted documents from the DO at boot.
     R2 keeps blobs and archived payloads (T8 bounded retirement), never the hot path.
3. **The studio server is the transaction client.** Desktop sidecars and the cell's studio child propose;
   browsers keep talking to their studio (DDR-054 origin split unchanged). On the client, **disk is the
   working candidate** and the hub-fed Y.Doc is the **accepted replica**; a durable outbox under the
   runtime-state `_state/` tree holds exact proposal bytes until a result arrives.
4. **Operations v1** (`POST /api/projects/:project/v1/proposals`): `lane.replace`
   (`html|css|meta|annotations|comments`, proven `baseHash`), `doc.create|move|delete` (manifest entries with
   generations), `dir.create|move|delete` (first-class empty folders), `history.undo|redo|restore`. Actions
   group operations across documents atomically (AI multi-file). The server derives every footprint.
5. **Base ≠ head is merged, not refused, when edits are independent.** Per-lane three-way merge: source
   (`html`, `css`) character-level (`sync/source-merge.ts`, T2); `meta` by key (artboards by id);
   `annotations` by element id; `comments` by comment id. Overlap returns `base-conflict` with the current
   head, so a client holding a *semantic* operation (inspector CSS, text edit) re-applies it on the accepted
   source — ordinary same-property edits then follow server acceptance order — and a client holding only a
   file (external editor) preserves the candidate and surfaces a conflict.
6. **Effects make undo peer-safe.** Each accepted lane change records an effect id and before/after content
   hashes; a head remembers its last effect. `history.undo` compensates an effect directly only while the head
   still carries it; otherwise it three-way-reverts (`base=after, ours=before, theirs=current`) and applies
   only independent parts, listing the rest. Equal-looking values from a later peer effect are therefore never
   erased (ABA-safe at lane granularity). Restore is always a new action.
7. **Fencing.** A persistent `{mode, epoch}` per project. In `transactions` mode every content connection is
   read-only (re-asserted in `beforeHandleMessage`, T7), awareness stays bounded, and an epoch change closes
   older sockets. The hub workspace agent becomes a projector of accepted revisions only. Legacy mode is
   unchanged until migration (T30); both modes never write concurrently.
8. **Project files keep the file plane.** Non-canvas files (assets, DS styles, modules) stay on the DDR-226
   journal with its compare-and-swap door; directories become journal entries; in cloud its durable commit
   moves to the same DO store (T10/T18).

## Rejected

- *Kernel inside the Worker/DO:* needs a Worker-grade validator; the pure-JS parser fails the corpus and a
  remote validation service would put a second network hop and a second failure domain on every edit.
- *Gatekeeping raw Yjs updates in `beforeHandleMessage`:* keeps CRDT bytes as the proposal, so a rejected
  U1 poisons dependent U2 (T7) and there is still no durable ACK or effect identity for undo.
- *R2-first commit:* fails the latency gate (T8).
- *Periodic SQLite backup as durability:* not a commit; RPO would equal the backup interval.

## Consequences

- The hub gains `transaction-store`, a kernel and gateway routes; the studio gains `transaction-client` +
  outbox and routes every writer through them in `transactions` mode (T13–T17).
- Cloud gains an outbound handler and DO RPC methods in `apps/cells`; the DO class stays the lifecycle
  owner.
- Bench/verify gates: the shared store conformance runs against better-sqlite3 and against the DO code path
  under workerd; T32 repeats the crash oracle on real AWS and Cloudflare.
