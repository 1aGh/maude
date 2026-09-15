# Project transactions

Status: contract + **implemented protocol v1** (2026-09-15, DDR-241). The
sections after "Implemented protocol v1" are the full destination; where they
name richer operations (semantic `source.*.assign`, structural ops by stable
id) those are T23–T25 refinements of the implemented lane operations, not a
second protocol. No deployed project is switched by this document — a project
enters accepted revisions only by an owner's explicit mode switch.

## Implemented protocol v1 (DDR-241)

Code: `apps/hub/src/project-transactions/` (kernel, store core, SQLite and remote
stores, hub integration, baseline import), `apps/cells/project-store*.mjs`
(Durable Object home), `apps/studio/sync/{transaction-client,accepted-link,
accepted-cold-start,projection}.ts` (client), `sync/writer-registry.ts`
(executable writer registry).

**Routes** (`/api/projects/:project|current/v1/…`, authenticated as the hub's
token/session/cell-secret actors): `GET bootstrap` (mode, epoch, revision,
manifest docs with lane heads, dirs, capabilities, `you`), `POST proposals`,
`GET transactions/:id`, `GET revisions?after=&limit=`, `GET history?before=&limit=&entry=`,
`GET blobs/:hash`, `GET|POST mode` (owner/admin only).

**Envelope**: `{protocol:1, projectId, epoch, transactionId, dependsOn?, origin,
action:{kind,label,operations}}`. Idempotency is (actor, transactionId): the same
bytes answer the retained result, other bytes answer `transaction-id-reused`.
Terminal rejections are retained; `retryable` is not.

**Operations**: `lane.replace {doc, lane, content, base | baseContent, writeId?}`
over the five canvas lanes (html, css, meta, annotations, comments) — the hub
merges three-way from the base (char-level for source, by `data-id` for
annotations, by id for comments, by key for meta) or rejects `base-conflict`;
`doc.create/move/delete`, `dir.create/move/delete` (folders are manifest entries,
empty ones included; a folder delete/move carries its canvases in the same
action); `history.undo/redo` (effect-aware: a revert is rebased through later
effects on the same entry, so it never erases a peer's later assignment; ABA
safe); `history.restore`.

**Durability**: one store schema (`store-core.mjs`) in two homes — better-sqlite3
WAL + `synchronous=FULL` in a self-host data volume, or the tenant's
`ProjectStore` Durable Object (its own class, never the container class) reached
by the container through `http://project-store.internal/`. Head, action,
effects, payloads and the idempotency result commit in one transaction before
the answer. A hub whose data directory is disposable (`MAUDE_DATA_EPHEMERAL=1`)
and has no remote store refuses the mode switch (`store-not-durable`).

**Publication**: only the kernel writes documents (Hocuspocus direct connection).
In `transactions` mode every connection is read-only, decided per message from
the mode and the credential's own right (so already-open sockets are fenced, and
a switch back restores exactly the write access tokens had). The studio's own
collab rooms refuse browser persistent writes too; a tripwire counts any local
write that still reaches an accepted replica.

**Mode switch** (safety order): persist mode+epoch → stateless `maude.mode`
notice on every document socket → one grace round trip → fence → baseline import
(documents the store lacks → `doc.create`; legacy-interval changes →
`lane.replace` from the head; checkout folders → `dir.create`; invalid bodies
fall back to the checkout's last valid source or are reported) → reconcile.
Proposals wait for the switch.

**Client**: every proposal is written to `<designRoot>/_state/outbox/`
synchronously before it is queued, delivered strictly in order, resolved by
transaction id after a lost answer, and rebased as a new transaction on
`epoch-stale` (dependents re-pointed). An edit on top of an unanswered edit
depends on it (U1→U2). API writes announce their base (`activity:suppress`,
comment/annotation/meta hooks); watcher imports use the last agreed value.
Comments and annotations are never proposed from file events (their files have
a second writer — the room projection). A rejection keeps the candidate on
disk, reports the conflict, and bases the resolving save on the version that
won. Cold start decides per lane: agreed / materialize / propose / hold.

**Revision visibility (T14)**: the hub stamps each document a revision writes
with `acceptedRevision` and `acceptedCohort` (how many documents the revision
writes). A receiving studio's projections hold a multi-document revision until
every document of it has arrived — including one created in the same action
and pulled — and write them in one tick (`sync/revision-barrier.ts`); a
document the peer never gets releases the rest after 1.5 s. The first stamp a
projection sees is its starting state and is never held. One writer owns each
checkout: the studio projection on a desktop, the studio child in a cell (the
workspace agent stops writing the checkout once accepted revisions are on).

**AI and multi-file actions (T16)**: an agent turn in the app's chat (from its
first canvas edit to the end of the turn) and a `/design:edit` run
(`/_api/ai/start` … `/_api/ai/end {outcome}`) are each ONE project action. The
file changes tools make meanwhile are staged (`sync/action-stage.ts`), not
proposed; a clean end proposes them as one transaction (`kind: 'ai'`, labelled
with the request) — the first base and the last content per lane. A cancel,
error, refusal, token limit or a silent heartbeat HOLDS them: kept on disk and
in `_state/ai-stage.json` (so a crash never becomes a partial publish at the
next cold start), unpublished, until the person chooses *Publish* or *Discard*
in the Sync panel (`/_api/project/ai-action`). The person's own UI edits are
never swallowed into the agent's action; one made on top of a staged file
waits behind it (dependency). A new canvas the agent creates is added at once
(nothing refers to it until the staged edit that uses it publishes).

**Large media (T18)**: one project-file ceiling for every lane
(`apps/hub/src/file-limits.mjs`: 2 GiB by default, `MAUDE_MAX_PROJECT_FILE_BYTES`
up to 8 GiB). A file past one `PUT /api/file/<rel>` (95 MiB) goes up as an
upload session (`/api/file-uploads`): created with its size and whole-object
hash, quota reserved up front, parts of 8 MiB streamed and hash-checked,
completed under the file door's per-path lock and compare-and-swap into the
same journal receipt. Creation is idempotent for (person, path, bytes), so a
restarted app resumes by asking again and sending only the missing parts; a
lost completion answer replays; a whole-object mismatch lands nothing; an
abort or 24 h expiry returns the reservation. Downloads stream to
`_state/downloads/<hash>.part` past 32 MiB and resume with `Range`
(`/_project-file` answers 206/416); hashing is chunked everywhere; the bucket
mirror uploads large files as S3/R2 multipart (aborting on failure) and a
cell's boot restore streams objects to disk. Canvas actions reference a file
only by its path; the bytes land in the checkout only complete and verified.
Nothing in the file plane deletes a bucket object (a delete is a journal
tombstone and a quarantine), so current, historical and pending references
all keep their bytes; only backup-generation retention deletes keys.

**Per-domain commands bound to actions (T26)**: the shell's Cmd+Z / Cmd+Shift+Z
of a canvas edit (inspector, structural and timeline ops all log a whole-file
before/after) undoes the ACTION that edit became when the project saves
through accepted revisions — `acceptedActionForContent` maps the edit's
resulting content to the accepted action id — so a teammate's later change
elsewhere in the canvas neither blocks the undo (a whole-file swap refuses
once the file moved on) nor is reverted with it; redo reverts that undo.
Comments keep their thread/resolve semantics as a lane merged by comment id;
an annotation gesture saves the whole layer once at its end (one action); a
photo transform is one PhotoEdit sidecar write through the file plane; a
timeline operation is one API op, one action. The shell's private undo stack
remains the fallback when no accepted action is known (legacy mode, or an edit
still in flight).

### Rights and project entry (T20–T22)

A **designer** is the project role `member` (cloud project role, or a hub
account role `member`; a hub `admin` account is the project's `owner` —
`role-matrix.mjs` `projectRoleForAccount`). The kernel rechecks the
credential's right on every proposal, including one replayed from an outbox.

| Accepted operation | owner | member (designer) | viewer |
|---|---|---|---|
| `lane.replace` html / css / meta / annotations | yes | yes | no (`forbidden`) |
| `lane.replace` comments | yes | yes | through the browser door's studio (`/_api/comments/`, the one write a viewer holds) — not from a desktop credential |
| `doc.create/move/delete`, `dir.*` | yes | yes | no |
| `history.undo/redo` | own actions | own actions (desktop; refused through a cell's browser door, where every browser editor shares the studio's credential) | no |
| `history.restore` | yes | yes | no |
| `GET|POST mode` | yes (owner / hub admin) | no | no |
| invite, remove people, delete the project | owner (cloud dashboard / hub admin API) | no | no |

**Design-system dependencies** travel as project files (`system/**`) through
the file plane with the same member right; a managed copy installs no package
dependencies — canvases resolve `@maude/canvas-lib`, relative modules and the
project's own design system. Code-execution trust stays local (DDR-054): joining
a project never grants it.

**Project manifest** (what a new copy is declared from, `GET bootstrap`):
`projectId`, `mode`, `epoch`, `revision`, `canvasGroups` (the project's declared
groups, when the hub serves a checkout), manifest `docs` with lane heads and
`dirs`, `capabilities`, and `you {actor, readOnly}`. It carries no credential and
no local trust decision.

**Entry, one contract for both families.** Cloud: invited on the dashboard →
account → the app's device sign-in → `/_api/cloud/projects` lists only projects
the account belongs to → *Open* → `/_api/projects/prepare {kind:'cloud'}` mints
the project credential → `managed_project_open` creates or reuses the copy under
the app's data folder, keyed by (server, project id), and switches to it.
Self-host: invited by the hub (`/join/<token>` sets a password) → the app's
*Your team's own server* form (address, email, password) →
`prepare {kind:'hub'}` (`POST /auth/login`, the password is never stored) → the
same native open. A `maude://open/<project>?code=` handoff opens the project as
its own copy (`prepare {kind:'handoff'}`, the claimed name checked against what
the code opens). A token-only hub (`maude design link`) remains the explicit
legacy path.

**Renewal and revocation.** Cloud credentials renew silently from the device
session; a self-hosted sign-in expires (`HUB_USER_TOKEN_TTL_HOURS`, 30 days by
default). An expired, rotated or revoked credential shows the refused state with
*Sign in again* (Sync panel), which re-mints the credential and reopens the same
copy. Disabling an account revokes its tokens and kicks its sockets; a proposal
it had queued is neither applied nor dropped — it stays in the outbox and on
disk, and is delivered after a new sign-in only if the right is back
(`sync-accepted-runtime.test.ts`, "a designer removed while editing").

### Readiness and observability (T19/T29)

The coordinator is served by the hub process itself, so bootstrap, proposals and
history answer before (and independently of) the renderer — a studio child that
is restarting does not stop a project from saving, and a managed copy opens from
the manifest without waiting for media. `/health` reports them apart:
`coordinator {ready, mode, protocol, durable}` publicly; with the cell secret
also `epoch`, `revision`, `proposals {accepted, replayed, rejected{code:n}}`,
`ackMs {p50, p95, p99, n}` (submit → durable answer) and `lastProposalAt`. A
project in accepted revisions whose store cannot be read is unhealthy (503) even
when its renderer is fine. The studio's `sync:status` carries `accepted {pending,
oldestPendingAt, ackMs, rejected}`; while anything is pending the status reads
*Saving N changes…* (kept on this device), never *Saved*. Media completeness stays
the file plane's own counts (`files`, `assets`) in the same payload. Within a
pass the file plane pulls what a canvas references first, then smallest first,
so one large master never holds back the images a canvas needs; *Download all*
in the Sync panel (`POST /_api/sync/offline`) runs passes back to back until
the whole project is on the device (explicit offline preparation).

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
