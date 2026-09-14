# T8 immutable object journal and conditional project head

This candidate uses the existing production `apps/hub/src/s3.mjs` client. It is an
isolated experiment, not a production route or selected adapter. The current app
does not import it. It shares the same strict ProposalV1 validator and fixture
receipt policy as the SQLite/workerd conformance corpus; the latter still passes
22 cases after extracting that pure policy.

## Snapshot follow-through

The candidate now uses a version-2 snapshot pointer, a bounded immutable LRU and
indexed receipt pages. See [SNAPSHOTS.md](SNAPSHOTS.md) for 9 new local checks,
7 actual AWS checks, bounded request counts, retained history, remaining capacity
limits and the observed latency gap. The original experiment below is retained
as its earlier evidence; it is not a current full-chain hot-path description.

## Run locally

```sh
/path/to/node24 --test scripts/dev/sync-e2e/durable-store-spike/object-journal/journal.test.mjs
```

The HTTP fixture binds loopback, persists synthetic objects on a separate disk
directory and verifies signed conditional headers and payload digests. It does
not implement full S3 SigV4 authentication or emulate AWS durability. Evidence
uses a fresh temporary directory unless `MAUDE_SPIKE_EVIDENCE_DIR` is provided.
Eleven tests pass, including four actual OS SIGKILL boundaries. Competing owners
run in distinct processes/cwds; the fixture survives their death.

## Actual AWS probe

This command **writes and deletes synthetic objects** in a new random prefix.
Use an authorized target; it is never an automatic unit-test step.

```sh
MAUDE_SPIKE_EVIDENCE_DIR=/path/to/evidence \
/path/to/node24 scripts/dev/sync-e2e/durable-store-spike/object-journal/aws-probe.mjs \
  --scratch-write <aws-profile> <bucket> <region> <expected-account>
```

The probe verifies the caller account and bucket owner, generates its own
`maude-sync-conformance/<uuid>` prefix, checks it is empty, and keeps credentials
only in process memory/isolated child IPC. Cleanup lists only that prefix,
refuses an unexpected count over 64, deletes exact created version IDs and
verifies zero versions/delete markers remain. No existing project objects,
services, deployments, permissions or lifecycle settings are changed. An
interrupted parent may leave its prefix for explicit subsequent cleanup; the
initial evidence file records its exact identity before writes begin.

Verified 2026-09-14 12:21 UTC with Node 24.13.0 in account 797601398300, bucket
`studyfi-shared-euc1-design-assets`, eu-central-1. All three live cases pass:
separate owner processes race on one head, a live stale owner loses a held write
after epoch handoff, and a process is killed after the real S3 head response but
before its ACK. A fresh owner resolves exactly one retained action and recreates
a synthetic renderer file. Cleanup deleted 16 exact versions, then found zero.
Evidence: `/tmp/maude-real-s3-journal-proof/evidence.json`; prefix
`maude-sync-conformance/4070a86e-37d5-4ed7-95a2-0925d359756e`.
This is real S3 evidence, not a Cloudflare R2/DO or full native UI result.

## Commit sequence

1. Read one head response including its ETag. Replay and validate its reachable
   chain. Identity comes from a trusted fixture caller, not the proposal.
2. Resolve an existing project/actor/transaction identity before proposing a new
   write. Identical bytes return the original receipt; changed bytes cannot
   replace it. A retained outcome is read-only even after an epoch handoff.
3. Check the owner's fixed epoch and strict proposal base. Generate the shared
   deterministic fixture receipt; rejected outcomes are retained too.
4. Encode one immutable entry containing exact proposal bytes, actor, receipt,
   previous hash and monotonically increasing sequence. Upload under its SHA-256
   with `If-None-Match: *`. A lost response is resolved by reading identical bytes.
5. Advance the head with `If-Match` on the observed ETag. Its tail points to the
   complete immutable entry. No acknowledgment occurs before this succeeds.
6. On conflict/unknown response, read the authoritative chain once and resolve the
   original identity. If it cannot establish the outcome, return unresolved/error.
   Never retry an unconditional write. A later explicit retry rechecks all bases.

The S3 head, not a local SQLite commit or backup timer, is the authority in this
candidate. SQLite materialization/index caching is not implemented here. A lost
race can leave an unreachable immutable entry, which is not replayed as history.
Epoch transitions are themselves linked entries and use the same head CAS.

The expected service behavior follows AWS's [conditional writes documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
and [S3 consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel).
Those describe service primitives; the live test above is the implementation evidence.

## Failure evidence and limits

| Failure | Proven outcome | Evidence scope |
| --- | --- | --- |
| SIGKILL before payload or after payload/before head | Revision remains zero; retry produces one action | Local HTTP, real killed owner |
| SIGKILL after head/before ACK | Fresh owner returns one original action after deleting its old cwd | Local HTTP and actual S3 |
| Two processes prepare from one head | One CAS winner; loser retry records base rejection and preserves winner | Local HTTP and actual S3 |
| Old owner pauses before handoff | Its eventual old-ETag write fails; fixed old epoch cannot append new work | Local HTTP and actual S3 |
| Lost payload/head HTTP response | Exact read resolution; failed resolution never claims acceptance | Local HTTP socket destruction |
| 503/507 payload refusal, 409 head refusal | No accepted head advance; later explicit retry has one result | Injected HTTP statuses, not real S3 quota |
| Corrupt/missing retained object | Replay and append fail closed | Local object corruption/removal |
| Hung read, replay capacity exhausted | Deadline/error or capacity, no new accepted write | Local HTTP and configured fixture bounds |

The original version-1 read path walked the full chain: **O(N) object GETs**, with no snapshots,
compaction or indexed dedup lookup. Version 2 bounds the suffix and uses snapshots/indexes; see the follow-through above for the remaining production gates.
Bounds are 1 MiB per entry via the production client, 128 entries and 8 MiB per
replay by default, and 10 seconds per storage request. The fixture operation has
a schema text cap of 65,536 characters. Bounds are experimental, not product
limits. There is no end-to-end deadline or whole-loop performance acceptance.
Actual network ACK/restore cost still needs representative repeated measurements;
the live run's elapsed time is not a peer-render latency sample.

Production also requires immutable-prefix IAM/conditional-write enforcement,
validated lifecycle/retention, explicit initialization vs missing-head recovery,
verified snapshots and garbage collection, bounded indexed warm/cold reads,
transactional local cache recovery, blob availability, auth, deployment packaging
and the complete source/effect/kernel contract. Read-only inspection of this AWS
bucket found versioning enabled, 90-day noncurrent-version expiration and 3-day
incomplete multipart cleanup, and no bucket policy. That is not proof of required
immutable-prefix enforcement or a full IAM audit. No settings were changed.

The tests use one text operation with schema-valid synthetic manifest/effect
receipts and a trusted actor/authorization flag. They do not validate or render
TSX, publish to peers, implement personal undo, survive canonical S3 loss, test
power loss, or prove metadata+media recovery. `initialize()` is only for a new
project; existing owners use `read()` and fail if the head disappears. Historical
backup/disaster RPO/RTO remains a separate obligation. T8 and T1–T35 remain open.

## Latest follow-through

This file retains the original journal proof. Current document snapshot format,
progressive recovery and bounds: [DOCUMENTS.md](DOCUMENTS.md). Actual AWS-local
coordinator measurement: [REGIONAL.md](REGIONAL.md). Earlier indexed snapshot
crash and S3 evidence: [SNAPSHOTS.md](SNAPSHOTS.md). None selects or deploys the
production transaction adapter; the full T8 gate and T1–T35 plan remain open.
