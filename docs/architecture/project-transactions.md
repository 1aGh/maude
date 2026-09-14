# Project transactions

Status: T6 working contract, 2026-09-14. This document specifies the destination
of `feature-reliable-project-multiplayer`; it does not describe a deployed API.
T7 must prove the publication barrier and dependency replay. T8 must select and
verify storage, validation runtime, limits and the idempotency retention horizon
before production integration. No project is switched by adding this document.

## User-visible guarantees

An edit appears immediately in its author's working view. The app records it in
a durable local outbox before claiming it is saved locally. Other users receive
the accepted action after the coordinator durably commits it. Preview gestures
may arrive earlier, but must never appear in saved history or overwrite accepted
content. Ordinary editing cannot depend on refreshing, reopening or manual sync.

An accepted action survives process restart and replacement of every renderer
and checkout disk. Disaster loss of canonical storage has a separate documented
recovery policy. A socket acknowledgment, Yjs `synced`, successful file write or
scheduled backup does not establish this guarantee.

History groups logical user actions. Undo targets the author's effects, subject
to their current identities; it cannot erase a subsequent peer assignment, even
when that assignment has the same visible value. Restore creates a new action.

## Authorities and identity

Each project has a stable project ID, persistent write epoch and monotonically
increasing revision. Each document has an opaque stable ID and a generation.
Paths belong to manifest entries and are not document identities. Rename retains
identity; delete retires the generation. Recreating the same path creates a new
generation which cannot receive old pending edits.

The coordinator owns accepted revisions. A single projector owns each managed
checkout. Renderers consume a complete revision manifest, never an arbitrary mix
of files left by a partially completed projection. User working files and pending
candidates are separate from that immutable serving snapshot.

The server derives actor identity and capabilities from authenticated membership.
Device/session IDs identify an origin; they do not grant permissions. Candidate
payloads cannot choose roles, trust anchors, physical landing paths or a different
tenant. Every accepted mutation rechecks membership and epoch, including replay
from an existing connection. User, device and project switching partition outboxes.

## Proposal and result shapes

The versioned request contains:

```text
ProposalV1 {
  protocol: 1,
  projectId, epoch,
  transactionId,
  origin: { deviceId, sessionId },
  base: { revision, manifestHash },
  dependsOn: [transactionId],
  action: { kind, label, operations: [OperationV1] },
  reads: [ReadCondition],
  writes: [WriteTarget],
  blobs: [{ sha256, size, mediaType }]
}

ReadCondition { documentId, generation, target, expectedEffectId?, expectedHash? }
WriteTarget   { documentId, generation, target }

AcceptedV1 {
  protocol: 1, projectId, epoch, transactionId, proposalHash,
  revision, parentRevision, manifestHash,
  actorId, origin, actionId, effects: [EffectV1], committedAt
}

RejectedV1 {
  protocol: 1, projectId, epoch, transactionId, proposalHash,
  code, currentRevision, targets?, retryAfterMs?
}
```

Integers must be safe nonnegative integers; strings, arrays, payload bytes and
dependency depth have server-advertised finite caps. Validation rejects unknown
protocol versions, malformed IDs and unsupported operations before storage.
T8 records concrete caps and the validation cost envelope.

`proposalHash` is SHA-256 of the exact validated request bytes retained by the
client outbox. A retry sends those same bytes. The coordinator scopes deduplication
by project, authenticated actor and transaction ID. Same key and hash returns the
original result; a different hash returns `transaction-id-reused`. Rebase creates
a new transaction ID linked to the original candidate, never a mutated retry.
Neither a transport timeout nor a dropped acknowledgment permits a fresh ID for
the same unknown-outcome request: query its result first.

The operation union separates user intent from whole-file replacement:

| Operation family | Required identity/precondition and effect |
|---|---|
| `source.text.assign`, `source.css.assign`, `source.attribute.assign` | Document/generation, stable element target and supported property; retain untouched source bytes and record a property effect |
| `source.replace` | Exact proven base content hash and immutable candidate payload; reject an unproven or conflicting whole-file replacement |
| `source.structure` | Supported insert/duplicate/delete/reorder operation, stable targets/parent, generation and dependency checks; no arbitrary mutation script |
| `manifest.create`, `manifest.move`, `manifest.delete` | Entry identity/generation, explicit parent/path conditions and referenced payloads; directory operations include descendants atomically |
| `layout.assign` | Canvas/artboard identity and persistent property; camera, selection and viewport excluded |
| `annotation.create`, `annotation.update`, `annotation.delete` | Stable annotation identity, generation and operation/effect identity; returning to an earlier value is a valid new action |
| `comment.create`, `comment.reply`, `comment.update`, `comment.delete` | Stable thread/comment identity with capabilities checked per operation; never raw Yjs write permission |
| `photo.assign`, `timeline.edit` | Asset/clip identity, supported edit fields and source/media dependencies; a reset/delete has explicit action identity |
| `history.restore`, `history.undo`, `history.redo` | Reference to retained revision/action/effects; server constructs and validates the compensating operation against current state |

An AI or paste/duplicate action groups these operations in one proposal; it does
not introduce another write API. A runtime operation registry must define the
exact payload schema, permission, preconditions, touched spans/records, resulting
effect and inverse eligibility for every supported variant. This draft's family
names are not yet that executable registry; T23–T26 must prove source fidelity
and map existing controls to its concrete variants.

The manifest lists directories explicitly, including empty ones. File entries
contain document ID/generation, normalized logical path, exact content hash,
size, kind and dependency references. Required modules, styles and media must
be durable before a reference is accepted. Credentials and local runtime/trust
state never enter the manifest. Existing path classifiers remain authoritative.

## Acceptance sequence and failure semantics

1. Authenticate, authorize the action and validate epoch. Resolve a retained
   idempotency result before applying a duplicate action.
2. Validate the envelope, document generations, read/write sets and dependencies.
   A missing or rejected parent cannot be bypassed with dependent CRDT bytes.
3. Apply supported operations against accepted state in a private candidate.
   Validate resulting source without executing its imports or canvas code.
4. Verify every immutable payload and required blob is durably available.
5. Atomically commit head, ordered action record, manifest reference, effect
   provenance and idempotency result under the coordinator's current fence.
6. Return the durable result and publish its revision event. A crash between
   these steps is repaired by result lookup and ordered revision replay.

Steps 1–4 do not mutate public Yjs documents, serving files or accepted history.
Storage failures return an unresolved/retryable outcome unless the durable result
can be read. Storage adapters must prove this boundary; an asynchronously uploaded
SQLite backup is not a substitute. No network operation is held inside a
Cloudflare Durable Object concurrency lock.

The server computes each supported operation's actual read/write footprint and
checks its preconditions; a client cannot bypass conflict or permission checks by
omitting a target from its declared sets. Unsupported arbitrary mutation code is
not an operation. Runtime files such as `_comments/` stay outside the shared file
manifest; canonical comment records persist in accepted document metadata and
can be projected into that runtime format for existing consumers.

Distinguish a durable terminal rejection from a retryable attempt. A terminal
base/source/generation rejection retains its result; repair is a new proposal.
A transient storage/capacity failure does not become a permanent rejected result
that would prevent retrying identical bytes. A received/pending receipt, if exposed,
is explicitly not an accepted revision and cannot produce a shared-saved claim.
The chosen adapter must document how an admitted pending ID remains bound to its
payload and how expired outcomes are distinguished from never-admitted requests.

Clients apply events in revision order. A gap triggers bounded replay; a hash
mismatch triggers snapshot verification. Duplicate events do nothing. An epoch
change fences every previous writer, including already-open sockets and projectors.

Idempotency results remain reconstructible for the advertised offline-replay
horizon. After that horizon the server refuses to treat an old unknown transaction
as new; the client retains the candidate and requests reconciliation. Snapshot
compaction must preserve this guarantee and effect provenance required by undo.

## Candidates, source fidelity and dependencies

Accepted state and optimistic state use separate documents/stores. Only the
server replayer writes accepted Yjs content. All client content writes, including
raw Update and SyncStep2 packets and loopback clients, are fenced. Awareness is a
separately bounded capability and cannot carry persistent application content.

Instrumented UI and AI edits carry an exact base token. Text/CSS/attribute edits
target existing stable element IDs; structural changes retain untouched TSX bytes.
No universal TSX-to-scene reconstruction is part of this protocol.

For independent operations with a proven base, retain both authors' effects.
Ordinary assignments to the same property follow accepted server order, preserving
authorship. Missing targets, retired generations and invalid dependencies require
rebase or an explicit candidate conflict. A whole-file replace requires its exact
base hash; it is not equivalent to an assignment to one property.

An arbitrary external editor can save a stale buffer after remote projection.
The latest disk hash does not prove that buffer's base. Preserve original candidate
bytes and the accepted version. Import only with a proven base and validated merge,
or explicit resolution; do not silently interpret untouched stale text as deletions.
The local receipt/API used by instrumented writers must survive a process restart.

If U2 was authored on top of pending U1 and U1 is rejected, hold the dependent
chain, rebuild the accepted replica and rebase semantic operations with their
original preconditions. Preserve candidates and undo context. Raw Yjs U2 replay
is forbidden because it can depend on rejected U1 structures.

## API surfaces

All routes below are proposed under `/api/projects/:projectId/v1` and share the
same authenticated project resolver. Cloud routing must not add a second protocol.

| Route | Contract |
|---|---|
| `GET /bootstrap` | Authorized manifest/snapshot, head, epoch, capabilities, finite limits and replay horizon; no trust settings or secrets |
| `POST /proposals` | Submit exact retained proposal bytes; return accepted/rejected result or an explicit unknown outcome |
| `GET /transactions/:id` | Resolve outcome scoped to authenticated actor; distinguish absent, expired and retained results |
| `GET /revisions?after=:revision` | Bounded ordered replay with cursor and explicit snapshot-required response |
| `GET /events?after=:revision` | Live ordered notifications; reconnection resumes through the replay contract |
| `GET /history` | Bounded logical action history with provenance, paging and restore/undo eligibility |
| `POST /uploads` | Create a scoped resumable upload session with declared hash, size, type and expiry |
| `PUT /uploads/:id/parts/:part` | Idempotent bounded part transfer with integrity checks |
| `POST /uploads/:id/complete` | Verify the complete immutable payload; advertise readiness only after durable storage |
| `GET /uploads/:id` | Resume/query authoritative part receipt and final readiness |

Common result codes are `base-conflict`, `source-invalid`, `dependency-missing`,
`forbidden`, `epoch-stale`, `generation-stale`, `capacity`, `retryable`,
`transaction-id-reused` and `result-expired`. Each carries structured recovery data;
designer-facing copy describes the work's state and next action, not transport terms.
The outbox survives rejection and loss of permissions without replaying across users.

Cold media references cannot strand a mounted player after an early 404. Accepted
blob readiness and client-local decoder readiness are different states. Downloads
are resumable, hash-verified and prioritized for the visible canvas. Asset arrival
must activate the existing view without requiring refresh, reopen or manual `load()`.
GC honors references from accepted heads, retained history and active upload leases.

## Existing writers and integration owners

The concrete 93-row call-site inventory is in [project-writer-registry.md](project-writer-registry.md). Executable strict representative schemas and 11 checked writer bindings now live in `scripts/dev/sync-e2e/contracts/`; 125 tests pass. This table groups integration owners. T6 remains incomplete until their entire
call graph, additional direct writes and corresponding conformance cases are
enumerated in a machine-checked registry. A row is not proof of migration.

| Writer / inspected entry point | Target ownership and required assertion |
|---|---|
| Hub Hocuspocus mutation paths in `apps/hub/src/server.mjs`; shared rooms and loopback in `apps/studio/sync/index.ts` | T7/T12: reject client content before public mutation, including SyncStep2, Update and existing sockets |
| `api.ts` `suppressedEdit`, `editText`, `editCss`, `editAttr`; HTTP `/_api/edit-text`, `/_api/edit-css`, `/_api/edit-attr` | T15/T24: exact base/read conditions, one action, no write→watch→second author |
| `sync/fs-mirror.ts` `createFsReader`; `sync/projection.ts` `applyFromFs` | T15: proven-base receipt or retained candidate, ordinary and atomic saves |
| `api.ts` `createCanvas`, `deleteCanvas`, `deleteFolder`, `moveCanvas`, `moveFolder`, `createFolder` | T17: manifest transaction, explicit empty directories and generation retirement |
| `api.ts` `patchCanvasMeta`; artboard insert/duplicate/resize/style/guides/print/delete operations | T17/T25: persistent layout only, per-user camera excluded, structural dependencies preserved |
| `api.ts` `commentsAdd`, `commentsAddReply`, `commentsPatch`, `commentsDelete`, `publishComments` | T17/T26: authenticated capabilities and persistent comment operations; no arbitrary body mutation via comments |
| `api.ts` `saveAnnotations`; `annotations-layer.tsx` collaboration observer and PUT chain | T26: action/effect identity, valid A→B→A and concurrent intake; no content-history deduplication |
| HTTP `/_api/photo-edit` → photo store `savePhotoEdit` | T26: grouped photo action and peer-safe reset, decoded receiving pixels |
| HTTP `/_api/footage`; `api.ts` `editArraySrcOp`, `reorderSequenceOp`, `reorderRevert`, `compClips` | T16/T26: declared multi-file action, source and media references consistent |
| `api.ts` `saveAsset`, `saveAssetFromStream`; hub `handleFileDoor`; file plane `push`, `pushDelete`, `materialize` | T18/T20: durable blobs and authorized manifest entries, resumable large files, hash verification |
| `workspace-agent.mjs` `onDocumentStored`; `workspace-files.mjs` `filesForCanvas`, `committableLanes`; `autocommit.ts` | T14/T27: one projector and history from accepted revisions, stale process cannot write |
| `history.ts` `rollback`; `sync/migrate-seed.ts` `migrateSeed`; legacy sync agent and repair paths | T27/T30: restore as a new action or fenced read-only reconstruction |
| AI/ACP/CLI direct writers and source mutation routes | T16/T6: concrete call sites are now in the linked 93-row registry; full writer-to-variant/permission/effect conformance remains incomplete |

### Structural operation seams inspected on 2026-09-14

Empty folders currently use `api.ts:createFolder` to create an OS directory and
`.gitkeep`; `classifyProjectFile("ui/Empty/.gitkeep", {canvasGroups:["ui"]})`
returns `never`. There is no directory entry transported by that marker. T17
must create durable manifest directory entries with identity/generation, rather
than representing a folder by an incidental canvas or relaxing dotfile policy.

The current canvas move path calls `retireCanvasForMove` → sync runtime
`retireForMove`, stamps the old Y.Doc with `movedTo`, waits for local unsynced
changes (up to 1.5s, or a 400ms grace without the probe), and releases the room.
This is not a server durable acceptance acknowledgment. A passive peer's
`onRetirementSeen` waits up to 60s for the destination, quarantines the old files,
and previously emitted a bare `canvas-list-update`. The containment repair now
emits `{action: "moved", fromRel, rel}` after the old body is gone and the new
path has materialized. The shell consumes it through a current-handler ref, and
all server inspector sessions retarget their context. Incoming tombstones emit
`removed` after body quarantine; the shell closes that canvas and the inspector
forgets its selection. These events describe observed local projection, not a
durable accepted action. T17 must replace that authority with the accepted move
or deletion event and document generations; missing destinations preserve work.

Canvas deletion emits `canvas-deleted` after local trash movement. The runtime's
`noteToHub` sends a best-effort `stateDocumentGone` HTTP request, retaining a
process-local tombstoned set. This inspected path does not durably queue a failed
statement; the helper's prose about later retries is not proof of an outbox.
Incoming tombstones release the provider and quarantine files; the open-view
lifecycle and active inspector require explicit accepted deletion handling.
These entries document migration seams, not completion of T13/T17 or attribution
of every structural E2E failure.

### Compatibility boundary: annotation echo IDs

The interim annotation PUT carries an optional bounded `writeId` through
`saveAnnotations` → `onAnnotationsChanged` → `syncRoomFromAnnotations`.
It prevents repeated-content undo/delete from being mistaken for a previous
self echo and preserves suppression of delayed local PUTs. The registry changes
`svg` and `writeId` in one Yjs transaction; external imports clear the old ID.
No SVG sidecar schema changes. This metadata is client supplied and grants no
rights. It is not a project transaction ID, idempotent result or durable ACK.

The annotation document projector now uses a separate disk-only API sink with
an after-IO freshness check and synchronous final rename. It never calls the
mutation publication hook. This closes the reproduced stale-flush republish
race, but does not fence the independent hub writer or arbitrary external files;
T14 still owns that stronger cross-process/revision boundary.

T26 must replace this compatibility identity with accepted action/effect IDs.
Legacy file-mediated/two-document paths cannot promise to preserve transport
metadata; their parity and retirement remain explicit migration gates. Whole-SVG
replacement still cannot safely merge concurrent independent stroke edits.
The new accepted representation must handle those edits by stable stroke IDs.

## End-to-end action example

Alice edits a title at accepted revision 40. The client persists the semantic
operation and base receipt, then renders the optimistic title. The coordinator
checks Alice's designer capability and the element generation, validates the new
source and commits revision 41 with effect E41. Bob receives 41, verifies its
manifest and sees the title in the already-open canvas. His local camera stays put.

Alice's undo proposes a compensating action conditioned on the current effect
being E41. If Bob subsequently assigned that title with effect E42, Alice's undo
cannot undo E42 even if its text equals E41's value. The failed undo retains its
stack entry and candidate; an explicit resolution is a separate action. Redo
targets the accepted undo effect, not an unacknowledged optimistic stack advance.

## Open gates

- T6: complete the 93-row writer-to-variant binding, residual strict operation variants and example corpus,
  final finite limits/horizon contract and protocol review.
- T7: real socket/process and Chromium publication/U1/U2 proofs now pass in the isolated fixtures; normal hub test entry, deployment packaging, native candidate recovery and production writer integration remain open. See [spike evidence](../../.ai/plans/notes/reliable-project-multiplayer-spikes.md).
- T8: actual cloud/self-host durability, fencing, validation-runtime and latency
  evidence; storage choice and deployment/restore instructions.
- T14/T15/T27: immutable serving snapshots, precise external-import semantics and
  accepted-content Git export. Current in-memory write guards do not prove atomic
  cross-process projection, restart-safe conflict retention or durable acceptance.
