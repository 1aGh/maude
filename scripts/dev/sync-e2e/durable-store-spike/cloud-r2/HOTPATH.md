# Durable SQL hot path — T8 revision

The subsequent [archive and retention revision](RETENTION.md) adds bounded payload
retirement and snapshot progress; remote measurements below predate that revision.

This revises the same DO/R2 candidate after the actual R2-first path measured
337–444 ms coordinator medians. The prior measurements remain in README.md and
`/tmp/maude-cloud-r2-staging/`; they are not results for the revised code.

For the existing small `source.text.assign` fixture, the DO now stores exact
proposal bytes and JSON-string source bytes in an immutable SQL payload table.
Payloads, usage counter, document reference, action, head and result commit in
one synchronous SQL transaction. A digest preparation await precedes that
transaction; current membership, base and epoch are still rechecked inside it.
The acceptance response awaits DO storage sync. There is **no R2 call on append
or current-document read**. This does not authorize large external payloads
without validation; that operation family is still outside this small fixture.

Snapshots copy captured document payloads from SQL to immutable R2 objects, then
publish pages/root using the existing guarded snapshot pointer. Snapshot reads
use R2 so they independently exercise archive integrity. A missing or corrupt
snapshot body fails the snapshot read while the accepted live source remains
readable from SQL. Exact accepted results and source survive without an R2
binding and after a real workerd process restart.

The inline payload budget defaults to 32 MiB, configurable only for the diagnostic
up to 64 MiB. The counter and new bytes share the acceptance transaction. A
capacity response leaves no new payload, action, result or head change; old
receipts remain readable. This is a payload-byte guard, not a total SQL storage
or memory bound. Results/metadata have separate backend limits. Obsolete inline payloads can now retire to verified R2 archives (RETENTION.md).
History and metadata are not expired; this budget is not production retention policy.

Snapshot scheduling remains explicit in this experiment. It is not a finished
background archive/outbox system, log compactor, full proposal-history export,
or disaster backup. Bounded inline retirement, snapshot progress across editing and archive restart
recovery now have local proof (RETENTION.md). Automatic scheduling, complete
metadata compaction, cost/retention and recovery runbooks remain T8 integration gates.
Old disposable R2-first stores are not migrated by this change; all previous
remote namespaces were already removed. No product data uses this schema.

Local validation: **17 pass / 0 fail / 0 skip**, Node 24.13.0, 27.02 seconds.
The shared 146-valid/24-invalid Worker corpus remains covered. Four SQL rollback
boundaries include the newly inserted payloads and usage counter. Three append
SIGKILL boundaries now cover before preparation, before SQL commit and after
durable commit; three snapshot SIGKILL boundaries remain. Other cases retain
membership/epoch/base races, exact retries, 80-document/5-MiB cold snapshot
reconstruction, archive faults, exact cleanup isolation, absent-R2 restart and
capacity refusal with unchanged state. Local durations are not latency SLOs.

Evidence: `/tmp/maude-cloud-inline-proof/evidence.json` and matching `.log`.
The local tested and prepared remote bundle SHA-256 is
`66bffa14b1c6ee2ee9a91c7b80dad27bcc9dc3b924cbb0d165feea84a01b7785`.
Whole-product source parsing, publication, all writers, native rendering,
history/personal undo, onboarding and T1–T35 remain unproved by these storage tests.

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
