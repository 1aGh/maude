# Reliable project multiplayer — executable spike evidence

Updated 2026-09-14. **T6, T7 and T8 remain open.** These experiments advance the
planned architecture without enabling it in the current product. No production
storage adapter, rollout or remote deployment is approved by these results.

## T6: executable wire contract

`scripts/dev/sync-e2e/contracts/` contains a strict JSON Schema 2020-12 factory,
wire validator, finite review limits, result/event shapes and generated corpus.
125 in-repository tests pass. All 25 named families have representative schemas;
69 operation/proposal variants produce 146 valid and 24 invalid corpus records.
The source-backed footage/EDL cases also pass the current production structural
validators. Eleven concrete writer-to-variant bindings are checked; the full
93-row inventory is `docs/architecture/project-writer-registry.md`.

This is not 93 migrated writers or complete supported variant coverage. Residual
variants, permissions, server-derived footprints, effects and inverse eligibility
are explicit in `coverage.mjs` and the contract README. The byte parser rejects
duplicate JSON keys, malformed UTF-8 and excessive depth/size, retains exact wire
bytes for hashing, and rejects unknown operation fields. Limits are proposed
finite review values, not measured production limits. Runtime Ajv code generation
still needs Worker review or a generated standalone validator.

The registry investigation also found that the current file classifier does not
admit `.footage.json` or `.edl.json`. This remains an actual surface/migration gap;
the schema experiment does not repair its product sync path.

## T7: publication barrier and retained candidates

`scripts/dev/sync-e2e/accepted-candidate-spike/` has four passing real
Hocuspocus/Yjs socket and subprocess tests. Before-message readOnly enforcement
blocks client SyncStep2/Update via both Sync/SyncReply, including an existing
connection whose cached permission is deliberately loosened, loopback and a
new poisoned handshake. Unknown document allocation and revoked/old-epoch sockets
are fenced. Bounded awareness still works. A removed-gate negative control in
the original temporary evidence directory fails on rejected source leakage.

`scripts/dev/sync-e2e/accepted-candidate-browser/` adds a passing cohesive test
with the actual Chromium provider SDK and two independent browser contexts.
Accepted and optimistic documents are separate. U1 is rejected; dependent U2
cannot repair acceptance by replaying its CRDT delta. Exact request, snapshot and
delta survive IndexedDB commit and reload. An explicit proven-base U3 with a
fresh ID creates one revision/history record and exact retries return that
result. Real IndexedDB transactions aborted with injected quota/abort errors
show Unsaved, commit no candidate and submit no request. The private candidate
remains visible. This is not real disk exhaustion or eviction evidence.

Chosen experimental representation: immutable exact request + full candidate
Yjs snapshot + delta, partitioned separately from accepted state; semantic/proven
base operations determine rebase, never blind rejected CRDT replay. Full native
outbox, undo context, receipts, logout fencing, WKWebView crash recovery and all
operation families remain T13/integration work. The browser fixture is test UI,
not the proposed designer-facing interface.

The browser server compiles the unchanged production source validator with Bun
and loads its installed OXC binding through Node. It passes on Node 22.13.1 and
Chromium 149.0.7827.55 without dependency changes. The original four-case runner
still uses Node 24's direct TS import. The plan's normal hub test entry and actual
deployment packaging remain pending; no production minimum Node version changed.

## T8: two local storage primitives

`scripts/dev/sync-e2e/durable-store-spike/` contains executable local workerd/DO
and SQLite probes. The self-host probe has 13 passing cases over the actual
installed SQLite binding, including real SIGKILL after action/result/head writes,
before/after ACK, retained-result retry, actor-scoped ID reuse, live old-owner
fencing, real SQLITE_BUSY/SQLITE_FULL and independent empty checkout replay.

The cloud probe has three passing cohesive cases using SQLite-backed DO storage
in real local workerd: rollback after each partial write, concurrent base claims,
epoch fencing, project isolation, exact retry, and process-group SIGKILL after
storage sync but before ACK. Reconstructed runtime returns the retained action
once, and a fresh renderer directory is reconstructed from the stored action.
Both databases live outside the replaceable checkout fixture.

These experiments support keeping the two SQLite primitives as candidates.
They do **not** select production adapters. The sibling `conformance/` corpus now passes 22 shared local tests. Still
required: actual Cloudflare DO/R2 and AWS/S3 journal/conditional head probes;
separate-volume stale writer fencing; durable blob readiness; snapshot/compaction
and bounded replay; validation-runtime decision; realistic ACK and payload cost;
disaster restore and deployment/package/runbook evidence. Local process crash
is not host/volume loss or remote storage verification. No T9–T12 production
integration may bypass these gates.

## T8: source-validation runtime evidence

The integrated `scripts/dev/sync-e2e/validation-runtime-spike/` builds the unchanged
production validator and probes its actual runtimes. Node 22 and Bun each match
17/17 source cases, including existing duplicate declaration/export failures and
an import/side-effect canary that is never executed. Actual local workerd rejects
native `process.dlopen`; the installed OXC WASI entry cannot bundle because its
optional binding is absent. The existing pure-JS TypeScript parser runs in
workerd but its parse-only mode falsely accepts six of the same invalid cases.
It is not a valid drop-in replacement. A separately evaluated WASI or richer
portable implementation is still possible; this experiment did not install one.

A loopback dedicated Node validator process passes two integrated tests: removed
renderer checkout and empty cwd, production source cap, bounded concurrency with
no queue, hard child timeout/SIGKILL, crash/schema/hash fail-closed behavior and
responsive HTTP health. Evidence is in `/tmp/maude-validation-integration-proof/`;
`/tmp/maude-validation-spike-in-repo.log` records the integrated execution.
The child-per-request implementation has measurable startup cost. It is not yet
an authenticated multi-tenant service, warm parser health check, hard OS/native
memory sandbox or selected cloud deployment. Compare warm-pool/remote cost and
full parser parity before choosing the actual T8 validation runtime.

## Retained product checkpoint

Native run `2026-09-14T11-12-06.584Z` completed with 32 pass, 0 fail and 232
not-run. It covers all selected three-way canvas create/move/delete checks,
text editing and uploaded photo/reset regression rows. Source audit: 123 parsed,
zero syntax errors, nine exact final source matches. The fixture now isolates
canvas move/delete setup from known failing empty-directory operations.

Metadata-only discovery notifications bypass the legacy heavy-file cooldown,
including the cell-owned control-provider bus. Native delete observations now
finish within 637 ms in this run. New canvas discovery still takes roughly
1.85–3.19 seconds and remote moves roughly 3–4 seconds. Text hub-to-native render
was 1.67 seconds. One sample is not a qualified p95/p99 and these timings do not
meet the full live UX target. Empty folders, full surface/no-regression matrix,
media scale, history/personal undo and both real backend scenarios remain open.

## 2026-09-14 — shared storage contract, warm validation and current infrastructure

Integrated `scripts/dev/sync-e2e/durable-store-spike/conformance/`: one strict
ProposalV1 corpus over actual SQLite WAL/FULL and local workerd SQLite-backed DO.
Final run has 22 pass, 0 fail, 0 skip in 2.90 seconds. Evidence:
`/tmp/maude-storage-conformance-final/evidence.json`; command output:
`/tmp/maude-storage-conformance-final.log`. Ten cases per adapter cover exact whole
bytes, scoped deduplication, changed-byte ID reuse, retained accepted/rejected
results, authorization before lookup, epoch transitions, base conflicts,
transaction rollback, competing base claims, schema rejection and restart/replay.
Exact retained outcomes remain readable after epoch advance without reapplication.
These use fixture authorization, one source-text action and text projection;
actual production auth/effects/TSX rendering are not asserted. Separate existing
SIGKILL probes remain the process-crash evidence. No deployed DO/R2 claim.

The temporary Worker startup failure was a Miniflare module-root error: its
implicit root produced parent-relative module names for the `/tmp` entry.
Setting `modulesRoot` explicitly fixed the unchanged storage corpus. This was a
harness failure, not evidence against SQLite DO durability.

Integrated `validation-runtime-spike/warm-pool/`: fixed two ready parser children,
production parser self-check and 17-case corpus, source/job/generation/hash
correlation, no queued overflow, fail-closed crash/timeout recovery and drain.
Three cohesive tests pass under Node 22.13.1; original log and failure retained in
`/tmp/maude-warm-validator-integrated.log`, pool evidence under the matching
`/tmp/maude-warm-validator-integrated/` directory. Tests no longer overwrite source
fault fixtures; output goes to temporary evidence directories.

The first integrated benchmark failed with a cold per-request child HTTP 504 at
the unchanged 2-second limit. Concurrent host load was observed; causation is not
proven. The benchmark now captures attempted samples on failure, fingerprints
sources before execution, cleans up startup failures and still exits nonzero.
A separate final run completes 50 alternating samples with unchanged limits:
`/tmp/maude-warm-validator-benchmark-final/benchmark-evidence.json`. Warm/cold
median milliseconds: 1 KiB 0.77/161.93; 1 MiB 16.38/178.50; 4 MiB 73.24/229.97;
5,000 JSX elements (287,813 bytes) 113.90/320.04. Two-worker warmup: 152.01 ms.
These exclude HTTP ingress, network and peer render and are not p95/p99/SLO or
sustained-load acceptance. Native/RSS/CPU isolation, service auth, fairness,
bounded diagnostic retention and real deployment remain open.

The preceding S3 implementation block adds optional signed conditional metadata
PUT and same-response GET+ETag to `apps/hub/src/s3.mjs`, bounded to 1 MiB and a
10-second default I/O deadline. It never retries as an unconditional PUT; lost
ACK requires read resolution. Existing call paths remain unchanged. The retained
58-test S3/backup/assets run passes (`/tmp/maude-s3-conditional-tests.log`). This
turn's hub bundle build and cold Node24 import pass. The HTTP S3-shaped fixture
is not AWS/S3 evidence and does not implement the durable project head/journal.
Final scoped static check covers 15 files: zero errors, six style warnings.

Read-only live infrastructure evidence updates the old audit:

- AWS shared host `i-0e484a007adbf57a5` runs hub and render image tags `v1.2.0`
  (SSM command `8b351cad-674c-448b-a391-8cb1e5f92a2a`, Success). A tag alone is
  not an exact source fingerprint.
- SSM command `33f3d504-7e09-4e7b-abfb-b50a77ea9d4b` confirms local Docker volumes
  `maude-hub_hub-data` at `/data` and `maude-hub_hub-repo` at `/repo`; render has
  no mounts. Allowlisted config names the S3 bucket
  `studyfi-shared-euc1-design-assets`, region `eu-central-1`. The final `findmnt`
  command exited 1, so the compound SSM result is Failed despite those successful
  reads; exact backing-device mapping and host-loss recovery remain unverified.
- Cloudflare cells version `fc766cf7-005b-4625-87b4-ed2ef0740eb9` has
  `CELL_LIVE_PAIRING=alligators`, `MAUDE_CELL=MaudeCellB` and bucket
  `maude-cloud-assets`. Bucket info reports EEUR, 5,190 objects, 8.46 GB; this is
  whole-bucket information, not a complete eligible Alligators inventory.

T8 remains open. Next cohesive architecture block is the replayable object-store
journal plus conditional head and ambiguous-ACK/fenced-owner failure oracle,
followed by the remaining blob/snapshot/runtime evidence needed to select actual
adapters before T9–T12. No production protocol activation, remote writes,
commit, push or deploy. Current product source behavior was not switched by
these experiments; the last native result remains 32/0 with 232 unrun cells and
its recorded latency misses. Full T1–T35, all surfaces, native, and real two-backend
acceptance remain required.

## 2026-09-14 — object journal CAS and real AWS S3 failure proof

Implemented the bounded `durable-store-spike/object-journal/` candidate using the
production S3 conditional client. One immutable content-addressed entry retains
exact ProposalV1 bytes, actor, receipt and previous-entry hash; a conditional
ETag head update is the commit point. Lost ACKs resolve from the authoritative
chain, never by unconditional retry. Epoch changes are also journal entries;
old owners keep a fixed epoch. Terminal accepted/rejected receipts are retained,
while orphaned losing branches cannot become accepted history. The shared fixture
receipt policy was extracted without changing outcomes; SQLite/workerd's shared
22-test corpus remains green (`/tmp/maude-journal-policy-conformance.log`).

Local object-journal suite: 11 pass / 0 fail / 0 skip. Two real owner processes
with separate cwd directories race on the HTTP store; a live old owner is paused
while its epoch advances. Four additional real SIGKILL cases target before
payload, after payload, after head and before ACK. Empty owner/renderer recovery
returns exactly one original action. Other cases cover byte identity, scoped
retention, revoked access before storage, HTTP payload/head response loss,
unavailable result lookup, 503/507 refusal, 409 head conflict, missing/corrupt
objects, capacity and hung-read deadlines. HTTP faults are injected, not claims
about actual S3 quota. Final evidence: `/tmp/maude-object-journal-final/`; log:
`/tmp/maude-object-journal-final.log`.

Then ran the explicit `aws-probe.mjs --scratch-write` against actual AWS S3 in
account 797601398300 / `studyfi-shared-euc1-design-assets` / eu-central-1 using a
new synthetic prefix, with no project/service/deployment/config changes. Caller
account and bucket owner were checked before writes. Three live cases passed:

- Two independent owner PIDs 44758/44759 prepared entries from one head; only one
  conditional head won, and the loser retained a base-conflict on explicit retry.
- Live old owner PID 44767 resumed a held write after durable epoch advance and
  could not overwrite current authority; the new owner retained stale rejection
  and accepted a fresh-epoch action.
- Owner PID 44779 was SIGKILLed after a real S3 head response, before an ACK file
  or parent result. The deleted owner cwd was not reused; a new owner resolved
  one retained action and reconstructed a synthetic renderer file.

Live evidence: `/tmp/maude-real-s3-journal-proof/evidence.json`; run 12:21:18–29 UTC.
Prefix `maude-sync-conformance/4070a86e-37d5-4ed7-95a2-0925d359756e` was empty before
writes. Cleanup deleted all 16 exact created object versions and independently
listed zero remaining versions/delete markers. Credentials remained in process
memory/child IPC and are absent from evidence. The probe never deploys anything
or edits IAM/lifecycle. No commit or push.

Read-only AWS config: versioning Enabled; lifecycle expires noncurrent versions
after 90 days and aborts incomplete multipart uploads after 3 days; no bucket
policy exists. This is not a full IAM or immutable-prefix enforcement proof.

This closes the missing *small actual S3 CAS/crash experiment*, not T8 or the
product. The current journal reader is O(N) full-chain replay and lacks snapshots,
compaction, indexed durable dedup and local SQLite caching. It must not become
the product hot path as-is. Limits: 1 MiB entry, 128 entries/8 MiB replay defaults,
10-second per-I/O deadline; no whole-loop SLO. Next block is bounded indexed
snapshot/replay with retention and crash oracles, then actual DO/R2/blob/runtime
and representative cost/latency evidence needed for adapter selection. All native
surfaces, history/undo, onboarding, large media and T1–T35 rollout acceptance
remain open. No production sync authority was switched by this experiment.

## 2026-09-14 — bounded snapshot/index/cache and actual S3 replay proof

The object-journal experiment now has a version-2 head with an immutable snapshot
pointer, a 256-shard receipt index, bounded immutable-byte LRU and bounded suffix
replay. Snapshot publication uses head ETag CAS without changing logical revision
or sequence. A late snapshot cannot overwrite concurrent work; old owners are
fenced. Historical exact accepted/rejected results remain indexed. Immutable old
entries are retained and read through bounded, accepted-anchor HMAC cursor pages;
per-instance cursors expire on restart. This compacts replay work, not retention
storage. There is no object deletion/TTL or production protocol migration here.

Local evidence: snapshot suite 9 pass / 0 fail / 0 skip, including three actual
SIGKILL boundaries and fresh renderer reconstruction. The prior normal journal
suite remains 11/0 after the changed head/cache. Tests establish cold state in
2 GETs, old receipt in 3 GETs, warm append in GET+PUT+PUT, bounded LRU, multiple
snapshot generations, old accepted/rejected retry, complete history, cursor
forgery rejection, snapshot/append race, storage refusal and corrupt/missing
snapshot/index. Sixteen 64-KiB synthetic documents exceed the inline snapshot
cap and fail without changing head or publishing a partial pointer. Evidence:
`/tmp/maude-snapshot-final-proof/snapshot-evidence.json` and
`/tmp/maude-snapshot-journal-regression/`, with matching `/tmp/*.log` outputs.

Actual S3 snapshot mode ran 12:39:18–49 UTC against the same verified AWS account
797601398300, bucket `studyfi-shared-euc1-design-assets`, region eu-central-1.
Seven reported cases pass: cold restore/index, five warm append measurements,
a real separate snapshotter racing a new action, SIGKILL before objects/after
objects/after pointer, and complete history of 13 accepted synthetic entries.
The oldest exact result remains unchanged. All 53 exact created object versions
were removed and the random prefix listed empty afterward:
`maude-sync-conformance/5b3f302d-c5d8-4174-8eb2-795d5dbd5df0`.
Evidence: `/tmp/maude-real-s3-snapshot-proof/evidence.json`.

Measured from this development host: cold state 237.73 ms (2 GETs). Warm appends
322.71, 321.18, 376.07, 375.70, 444.67 ms (each 1 GET + 2 PUTs; median 375.70 ms).
These are synthetic coordinator-to-S3 timings, not editor/source validation,
publication or peer render. Five samples are not p95/p99. They do not establish
the final live SLO; measure an AWS-local coordinator and complete product pipeline
before selecting or claiming performance. The full-history network cost is removed,
while each immutable cache assumes enforced storage retention and cold recovery
still verifies digests. Cold integrity tests intentionally clear the cache.

Next T8 work: blob-backed snapshot/materialization beyond the current 1-MiB root,
real DO/R2 counterpart, per-region cost/latency, immutable retention enforcement,
persistent local index and compaction/expiry policy, and chosen validation isolation.
Snapshots currently retain receipts indefinitely within bounded pages; page-cap
or suffix-cap capacity is explicit, not an invented successful save. Original
history/undo/onboarding/media/native/two-backend T1–T35 scope remains intact.
No production sync authority, project data, deployment, IAM or lifecycle changed.

## 2026-09-14 — AWS-region ACK measurement and paged document recovery

Actual in-region coordinator probe passed on StudyFi host i-0e484a007adbf57a5
(account 797601398300, eu-central-1), using its exact existing hub image and
Node 20.20.2 in a disposable read-only container capped at one CPU and 256 MiB.
Twenty synthetic appends per payload size gave medians **91.38 ms (1 KiB)** and
**98.93 ms (64 KiB)**; sample p95 values were 106.81 and 109.12 ms. Every append
used one GET and two conditional PUTs. This measured the prior inline snapshot
format, not the final document-page format or editor-to-peer latency. Source,
bundle and measurements are retained at `/tmp/maude-aws-regional-proof-v2/`;
SSM command 7c10eabb-35bc-407b-9e05-3f7d794494b6 is terminal Success. All 139
created versions were deleted and the prefix is empty. The first attempt's
unprivileged-container directory permission failure occurred before sync ran;
its single object was also cleaned. No hub/render restart or product deployment.

The current prototype replaces inline snapshot document strings with immutable
bodies and bounded document-index shards (snapshot version 2, head version 2).
Metadata reads, appends, epoch changes, initialization and receipts do not hydrate
unrelated documents. Cold metadata uses two GETs; a selected document adds only
its page and body. Full convenience reads have an explicit 8-MiB default cap;
progressive enumeration handles larger projects. JSON string encoding preserves
all accepted code units, including escaped lone surrogates that raw UTF-8 would
silently replace. Body/page/root publication precedes the same fenced head CAS.
The earlier disposable snapshot format is not a product migration contract.

Final local suite: **23 pass / 0 fail / 0 skip**, 12.31 seconds. It includes a
160-document **10-MiB** fixture across ten snapshots, exact progressive cold
reconstruction, oldest receipt retry, independent later edit, pinned older read
views, 128-KiB LRU, bounded eager-read refusal, missing/corrupt objects/pages,
507/lost body ACK, exact Unicode roundtrip, and existing CAS/epoch/SIGKILL cases.
Evidence: `/tmp/maude-document-index-final-tests.log` and
`/var/folders/t_/kf80xz3j79sfmkrq4snj2qk00000gn/T/maude-document-index-oBE1BT/evidence.json`.
Final standalone Node 22 bundle test: one pass, zero failures, from empty cwd
with no installed dependencies. Scoped static checks: 11 files, zero errors,
eight style warnings. No native UI behavior changed or native E2E rerun this block.

Actual S3 final document-page suite: **eight cases passed**, 13:09:41–13:11:17 UTC.
Includes concurrent snapshot/action CAS, three actual SIGKILL/recovery boundaries,
13-entry history with exact oldest receipt, and sixteen distinct 64-KiB documents
whose encoded aggregate exceeded the old inline snapshot cap. Cold metadata,
selected document and complete content parity were verified. Evidence and exact
source copies: `/tmp/maude-real-s3-document-pages-final/`. All **148 exact versions
were deleted**, zero remain under
`maude-sync-conformance/49dc89bc-f2e8-43f3-a6e4-06c9b84fbce0/`.
The preceding pre-code-unit-fix run also passed eight cases and cleaned its
148 versions; its evidence remains separate at `/tmp/maude-real-s3-document-pages-proof/`.

This closes the demonstrated AWS-region latency uncertainty and inline snapshot
capacity limitation. It does not close T8: actual Cloudflare DO/R2 parity,
production source-validation isolation, retention/expiry and immutable-prefix
policy, background compaction, persistent indexing and an explicit final adapter
selection/runbook remain gates before T9–T12. Per-object bounds still apply;
10-MiB source reconstruction is not large-media resumability or the Alligators
inventory test. Source semantics, all persistent writers, managed onboarding,
history/personal undo, complete native surfaces, migration and the absolute
peer-render SLO remain full T1–T35 requirements. All task checkboxes remain open.

## 2026-09-14 — coupled DO/R2 correctness passes; actual cloud latency fails

The existing Cloudflare T8 candidate now runs strict wire/schema/semantic
validation inside the Worker using Ajv standalone output generated from the
same T6 schemas. The actual local Worker accepts 146 valid fixtures and rejects
24 invalid fixtures with matching codes; no Node-side prevalidation or runtime
code generation. One SQLite DO owns each project. R2 stores content-addressed
exact proposals and JSON-string source bodies, while a synchronous SQL transaction
owns head/action/current-document/exact-result metadata. Membership, epoch, base
and dedup are rechecked after external I/O. Indexed snapshot pages capture old
source values and publish only against their still-current head/epoch.

Final local suite: **15 pass / 0 fail / 0 skip**, 14.95 seconds, Node 24.13.0,
Miniflare 5.20260831.0-alpha and workerd 1.20260831.1. The test process groups
contain actual workerd. Six controlled SIGKILL boundaries cover before/after R2
and after SQL commit, for both append and snapshot. Other checks cover exact
accepted/rejected retry, project/member separation, three SQL rollback stages,
missing/corrupt R2 content, deterministic competing base/epoch/member changes
across R2 awaits, consistent snapshot paging, and 80 documents / 5 MiB restored
from cold storage with exact source parity. The exact remote runner and scoped
cleanup/drain behavior also pass locally. These are storage tests, not native UI.
Evidence: `/tmp/maude-cloud-r2-final-proof/` and matching `.log`.

A temporary diagnostic Worker and separate R2 bucket were created under the
verified personal account b5b596efe65abb732777c7171dc18145. Name:
`maude-sync-probe-e286c7e8d6d0`; no product routes or bindings. The bundle hash
matched the local tested file. Initial deployment version was
e1e4c5bb-41b4-46f4-a53d-8479c51a9c53; a one-hour, randomly generated diagnostic
secret was supplied afterward. Bucket location hint was eeur; observed HTTP
edge was FRA, not proof of the DO's exact location. Product deployments, existing
R2 buckets, Alligators content and StudyFi services were unchanged.

Actual run 13:35:26–13:36:09 UTC: two projects each accepted twenty 1-KiB/64-KiB
changes, restored snapshot source and retained exact receipts, enforced epoch
and membership changes, and a third project accepted one of two concurrent base
claims while rolling back three partial SQL transactions. Correctness passed.
No managed Cloudflare process/host crash was injected; that proof remains limited
to the local workerd lane. **Performance failed the gate**: coordinator medians
337/444 ms, sample p95 675/605 ms; client ACK medians 405.42/603.76 ms, sample p95
758.92/716.36 ms. Twenty first-submission samples per size; retries/rejections
excluded. Median averages both middle observations; p95 uses nearest rank.
Coordinator timing includes DO RPC/R2/SQL but excludes preceding Worker wire
validation; client timing adds the development-host HTTP path. Neither includes
OXC source validation, publication or peer rendering, so this already exceeds
the final 300-ms peer budget and must not be integrated unchanged. These are
small descriptive samples, not qualified product percentile evidence, and their
timing boundary differs from the AWS probe.

The slow path currently waits for two R2 PUTs and two reads per accepted action.
Revise this same DO/R2 candidate so small operations and their recoverable payload
commit atomically in DO SQLite, with R2 archival/snapshots outside the live ACK
path. Large payloads still need validated immutable references. Repeat the
crash/retry/retention corpus and actual cloud measurement before selecting the
adapter; a predicted speedup is not evidence. Immutable retention, compaction,
validation-service isolation and final deployment/runbook selection remain T8
gates. The proposed change is not yet implemented in this checkpoint.

All 64 diagnostic R2 objects were removed (29 + 29 + 6), then the Worker and
empty bucket were deleted. Read-only verification found Worker 10007/not-found,
no matching bucket, and zero matching DO namespaces in the complete four-namespace
account list. The temporary token file is removed. Evidence/source/manifest,
latency summary and teardown verification: `/tmp/maude-cloud-r2-staging/`.
No test resources remain. Implementation documentation is
`scripts/dev/sync-e2e/durable-store-spike/cloud-r2/README.md`.
All T1–T35 checkboxes remain open; no commit, push, product migration or release.

### 2026-09-14 — DO SQL hot path passes actual remote correctness and storage latency probe

The existing Cloudflare candidate now atomically stores exact proposal/source
bytes, payload usage, action, head, document reference and dedup result in DO
SQLite before acknowledging. Append/current-source reads do not call R2;
snapshots archive source to immutable R2 objects. This changes the same candidate,
not the product sync or its deployment. Local workerd tests: 17 pass, 0 fail,
0 skip (27.02 s), including four SQL rollback boundaries, six append/snapshot
SIGKILL boundaries, no-R2 acceptance/restart, archive corruption, 80-document
cold reconstruction and bounded inline-capacity refusal without partial state.
Evidence: `/tmp/maude-cloud-inline-proof/evidence.json` and matching `.log`.

The first actual run failed before samples with a JSON parse error. Its original
HTTP status was not captured, so its cause remains unproved. The runner now
records HTTP status/content type and bounded redacted response detail before
JSON decoding. Explicit `--resume-empty` preserves the failed evidence, reuses
the private diagnostic token and requires all three projects to have epoch 1,
revision 0, zero actions/results/documents and zero payload bytes before writes.
All three readiness assertions passed; no unknown accepted writes were replayed.

Actual run 14:01:22–14:01:39 UTC passed: twenty first submissions each at 1 KiB
and 64 KiB, snapshot restoration, exact receipt retry, ID reuse rejection,
membership/epoch fencing, one accepted concurrent base claimant and three SQL
rollback injections. Coordinator median/sample p95: 49/58 ms (1 KiB), 42/62 ms
(64 KiB). Client ACK median/sample p95: 91.40/132.21 ms and 96.21/152.41 ms.
The prior R2-first coordinator medians were 337/444 ms. This is a promising
storage result, not a controlled speedup estimate: the observed edge changed
from FRA to PRG, DO location is unknown, and each size has only 20 observations.
Timing excludes OXC validation, accepted publication and peer UI rendering;
no native latency SLO or managed host crash guarantee is proved by this run.

Tested/deployed bundle SHA-256:
`66bffa14b1c6ee2ee9a91c7b80dad27bcc9dc3b924cbb0d165feea84a01b7785`.
Fresh isolated Worker/bucket `maude-sync-probe-0115bcc93157` used no product
routes/bindings. All 18 archive objects were deleted (9 + 9 + 0), all projects
drained, then Worker and bucket deleted. Read-only checks confirm Worker 10007,
no matching bucket and no matching DO namespace in the complete four-namespace
list. Private token removed. Evidence, original failure, readiness, measurements
and teardown: `/tmp/maude-cloud-inline-staging/`.

T8 remains open for bounded retention/compaction and archive progress, validation
service isolation, adapter selection and deployable recovery/runbook requirements.
The 32-MiB inline payload guard is not a production retention policy. T7/T8 are
still hard dependencies of T9 production integration; do not bypass them because
this storage probe passes. Full onboarding, all writers/surfaces, history/personal
undo, all local native E2E rows and cloud/self-host staged matrices remain open.
All T1–T35 checkboxes remain open. No commit, push, product migration or release.

### 2026-09-14 — bounded archive retirement and non-starving snapshots

The existing DO/R2 candidate now archives at most 16 payloads / 1 MiB per call.
It loads only selected bodies, verifies SHA-256 before upload and by R2 readback,
then atomically records archive references, removes obsolete inline bodies and
updates usage. Current document hashes remain inline. Retirement rechecks epoch,
membership and drain state; concurrent batches cannot decrement usage twice.
Exact history reads resolve proposal/source hashes from inline or verified archive
storage; original dedup receipts remain SQL-resident and unchanged.

Snapshot publication now accepts its immutable captured revision while newer edits
continue, with a monotonic pointer and epoch/member fences. A captured old source
can be read from the archive after inline retirement. A slower old snapshot cannot
replace a newer completed snapshot. This removes the previous edit-induced
snapshot-raced starvation condition without deleting the log needed to reach head.

Final local actual workerd/SQLite/R2 proof: **26 pass / 0 fail / 0 skip**, 27.91 s.
This retains the strict wire corpus, previous crash/retry/isolation cases and
adds three archive SIGKILL boundaries, transactional rollback, corrupt/missing R2,
24 revisions under an 8192-byte inline budget with exact cold history/receipts,
epoch/member/edit races, overlap accounting, and 20 multibyte documents archived
in four bounded batches with exact history. The first large-batch fixture exceeded
the 65536-character operation limit and was correctly rejected. It was replaced
with valid multibyte text of the same approximate byte size; no limit was relaxed.
That failed evidence remains `/tmp/maude-cloud-archive-final-proof/`.
Passing evidence: `/tmp/maude-cloud-archive-final-proof-v2/` and matching `.log`.
Final bundle SHA-256:
`f46cb539eebf6d93d9ee7e4578315b4f6f9e864975bb0cbddafdd758740b936c`.
Scoped Biome checks had zero errors and seven existing/style suggestions.

This archive revision has not been deployed or remotely measured; do not reuse
the previous bundle's 42–49-ms Cloudflare latency as evidence for this bundle.
No external infrastructure was created this turn. No product source was changed.
The probe still has explicit operator invocation, no durable background scheduler,
and growing action/result/archive metadata. Full metadata compaction, automatic
retry, validation-service isolation and deployment/recovery decisions remain T8
gates. RETENTION.md defines retirement/crash semantics and the requirements for
metadata segments/dedup indexes, GC liveness and separate disaster recovery.
Body archival alone cannot restore the SQL action/dedup index after storage loss.

The full native surface matrix, accepted publication, all writers, personal undo,
history UX, designer onboarding and cloud/self-host staged product tests remain
open. All T1–T35 checkboxes remain open. No commit, push or product deployment.
