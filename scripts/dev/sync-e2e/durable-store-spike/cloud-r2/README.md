# Coupled Durable Object / R2 experiment

The code now follows the [durable SQL hot-path revision](HOTPATH.md). The report
below preserves the earlier R2-first experiment and its measured failure.

This is the existing Cloudflare T8 candidate extended to actual R2 payloads,
transactional accepted metadata, and paged snapshots. No product imports these
files. **The historical R2-first append was not suitable for the live product:** its
actual remote coordinator median is 337–444 ms, already above the 300-ms peer
render budget before rendering or source validation is included.

## Historical R2-first contract

A SQLite-backed DO owns one project. Proposal validation runs inside the Worker,
using build-time Ajv standalone output from the same T6 schemas and the same
wire/semantic checks. No host-side prevalidation or runtime dynamic code
generation is required. The remote interface has an operator-only random secret,
a one-hour write expiry, and a disposable-only cleanup guard. Actor membership
is fixture SQL state, not the production account/invitation system.

The small fixture operation is `source.text.assign`. Its exact proposal bytes and
JSON-encoded source value are written to project-scoped, content-addressed R2
keys using conditional create and a SHA-256 checksum. After verifying them, the
coordinator atomically commits head, action/reference, current document and exact
accepted/rejected result in `transactionSync`, then awaits `storage.sync()`.
Membership, owner epoch, base and dedup are checked again after external I/O.
R2 waits do not hold a concurrency lock. Old exact receipts are readable after an
epoch change if current membership permits; they do not authorize a new write.

This deliberately exposes the latency of two R2 PUTs plus two reads per accepted
proposal. Checking existence just before a SQL transaction is not atomicity
across R2 and DO, and cannot defeat an unrelated administrator deleting a body
immediately afterward. Immutable retention/access policy is still a prerequisite.
Missing/corrupt content fails retrieval explicitly rather than inventing data or
rolling back the canonical head. Failed SQL writes leave unaccepted R2 orphans.

Snapshots capture bounded SQL document references synchronously, upload pages
of 64 references and an immutable root, then publish the pointer only if head,
epoch and membership still permit it. They do not add an accepted action or
advance revision. Snapshot reads can restore old document values while the live
head receives later edits; paginated callers carry the expected snapshot hash.
A changed published pointer returns `snapshot-changed` instead of mixing pages.

Current experiment bounds: 262,144-byte HTTP envelope, 1-MiB R2 object,
4,096 snapshot documents, 64 pages, 32 live inventory rows per request.
Snapshot pages contain references, not whole-project source. These are fixture
bounds, not a certified large-project capacity. No receipt expiry, SQL log pruning,
background snapshot scheduler, media resumability or production source parser.

API behavior was checked against the official
[SQLite transaction/storage reference](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
and [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
The documentation is not a substitute for the evidence below.

## Local validation

```sh
bun --no-env-file scripts/dev/sync-e2e/durable-store-spike/cloud-r2/build.mjs
MAUDE_MINIFLARE_ENTRY=/path/to/installed/miniflare/dist/src/index.js \
  /path/to/node24 --test scripts/dev/sync-e2e/durable-store-spike/cloud-r2/probe.test.mjs
```

Uses installed Node 24.13.0, Miniflare 5.20260831.0-alpha, workerd 1.20260831.1,
and Bun 1.3.3; no dependency installation. Build artifacts under `dist/` are
ignored. The process harness uses real local workerd, SQLite DO and persisted
R2 binding, with all HTTP listeners on loopback. Local R2 remains an emulation of
remote R2, not evidence of Cloudflare regional durability by itself.

Final run: **15 pass / 0 fail / 0 skip**, 14.95 seconds. The actual Worker accepts
146 valid shared corpus fixtures and rejects 24 invalid fixtures with the same
codes. Tests include exact retries, cross-project/member rejection, three SQL
rollback boundaries, missing/corrupt R2, controlled base/epoch/member changes
during external I/O, three append SIGKILL boundaries and three snapshot SIGKILL
boundaries. Each kill targets a verified private process group containing actual
workerd, then restarts against the same durable storage from a new process.

An 80-document / 5-MiB fixture restores every source value from two snapshot
pages after cold restart. A later live edit leaves that captured snapshot intact.
The exact remote-case runner also runs locally, including cleanup isolation and
persistent drain fencing. Cleanup only deletes the chosen disposable project's
objects and metadata; other synthetic project content is checked to survive.

Evidence: `/tmp/maude-cloud-r2-final-proof/evidence.json` and
`/tmp/maude-cloud-r2-final-proof.log`. Scoped checks cover nine files, zero errors
and nine style warnings: `/tmp/maude-cloud-r2-verification.log`.

## Actual Cloudflare diagnostic — 2026-09-14

An isolated Worker and equally named empty R2 bucket were created in account
`b5b596efe65abb732777c7171dc18145`: `maude-sync-probe-e286c7e8d6d0`.
No product bindings or custom-domain routes were present. Bucket hint was `eeur`;
observed HTTP edge was FRA, which is not proof of the DO's exact placement.
The tested bundle hash matched the deployed file. Initial deployment version:
`e1e4c5bb-41b4-46f4-a53d-8479c51a9c53`; the diagnostic secret was added afterward.
Wrangler reported 1,711.38 KiB upload, 141.05 KiB gzip and 3-ms Worker startup.

Run: 13:35:26–13:36:09 UTC. Two projects accepted twenty source changes each,
restored snapshot values and exact old receipts, fenced stale owners, retained
epoch rejection, and enforced membership revocation. A third project accepted
exactly one of two concurrent base claims and rolled back three deliberately
interrupted SQL transactions. Managed Cloudflare process crashes were not
injected; those failure boundaries were exercised in the local workerd lane.

| Payload | Samples | Coordinator median | Coordinator sample p95 | Client ACK median | Client ACK sample p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 KiB | 20 | 337 ms | 675 ms | 405.42 ms | 758.92 ms |
| 64 KiB | 20 | 444 ms | 605 ms | 603.76 ms | 716.36 ms |

Only first submissions are counted; retries/rejections are excluded by project
and transaction identity. Coordinator timing covers the DO RPC/R2/SQL call,
excluding the preceding Worker wire/schema validation. Client ACK includes the
development-host HTTP path. Neither includes OXC source validation, publication
or peer UI. Twenty samples are descriptive, not qualified product p95/p99.
AWS and Cloudflare measurements also have different timing boundaries, so they
must not be presented as a controlled backend performance comparison.

Correctness passed; **performance is a failed gate**. Next revise this same
DO/R2 candidate so small accepted operations and their recoverable payload live
in one durable SQL transaction, with R2 snapshot/archive work off the live path.
Large payloads still need validated immutable references before acceptance.
That revision must repeat crash/retry/retention and real regional measurements;
it is not assumed correct merely because it should avoid the measured R2 waits.

All **64 R2 objects** were removed (29 + 29 + 6), then the Worker and empty bucket
were deleted. Read-only follow-up confirms Worker 10007/not-found, bucket absent,
and zero matching DO namespaces across the complete four-namespace account list.
The private diagnostic token file is deleted. Evidence, source, manifest and
latency summary: `/tmp/maude-cloud-r2-staging/`. No existing production Worker,
Alligators data, StudyFi service or account settings were modified.

T8 remains open for the revised hot path, retention/compaction policy,
validation-service isolation and final adapter selection/runbook. Full T1–T35
native multiplayer, all writers, media, history/undo, onboarding and rollout
acceptance remain required.
