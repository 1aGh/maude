# Archive and retention contract

This extends the existing T8 Cloudflare adapter experiment. It is not a product
history API and does not change the previously measured remote bundle.

## Implemented and exercised locally

Small accepted proposals and source values enter the same SQL transaction as
head/action/result. The archive operation captures at most 16 references and
1 MiB of immutable payload bytes synchronously. Metadata selection precedes BLOB
loading, so references beyond the byte budget do not load their bodies. No SQL
cursor or transaction spans object-store IO. A hash index on live document
references avoids scanning the entire document table for each retirement check.

Each selected body is SHA-256 checked, conditionally written to its content
address in R2, then read back and verified. After all selected objects resolve,
one SQL transaction rechecks membership, coordinator epoch and draining state,
records archive references and removes only eligible inline copies. Current
document hashes stay inline. The byte counter and retirement are atomic; two
archivers retiring the same batch cannot decrement the counter twice. A failed
object read or rollback retains the inline batch; unreferenced objects left by
an interrupted upload can be reused by an exact retry.

Historical reads use retained action metadata and exact proposal/source hashes.
They read inline data when present, otherwise a verified archive reference.
Missing or corrupt archive data fails explicitly; it never returns an empty or
invented revision. Deduplication results remain in SQL, so an old transaction
retry does not require R2 availability. No history, action, receipt, or archived
R2 body expires in this experiment.

Snapshot capture is an immutable revision, not a request for the current head
to stop changing. After object IO, publication checks current epoch/member and
advances the snapshot pointer monotonically. A later accepted revision does not
invalidate the capture. A newer completed snapshot fences an older completion.
Retained actions bridge snapshot to head. If an old captured source has already
been retired from inline storage, snapshot construction reads its verified
archive copy. This prevents edits or payload retirement from starving snapshots.

## Failure model

| Boundary | Recovery |
| --- | --- |
| Before archive IO | Inline body and exact receipt remain canonical. |
| After objects, before SQL retirement | Inline body remains; retry verifies/reuses the same objects. |
| Inside reference/retirement/counter transaction | All SQL changes roll back together. |
| After durable retirement, before response | Archived history and SQL receipt survive a workerd restart. |
| R2 unavailable before retirement | No bytes retire; accepted live source stays usable while inline capacity remains. |
| R2 missing/corrupt after retirement | Historical content read fails explicitly; live inline source and dedup receipt remain available. |
| New edit during archive | Retire against current references; preserve newly accepted payloads. |
| Stale epoch/member after IO | Refuse retirement; uploaded objects are harmless retained candidates. |
| Two concurrent archivers | Idempotent archive references and exact live-row byte accounting. |

## Production implementation requirements

This experiment establishes payload retirement and snapshot progress, not all
retention. `actions`, `results` and `archived` metadata still grow with accepted
history (and rejected receipt count). The 32-MiB inline limit bounds payload bytes
only. A large live working set cannot be solved by discarding historical bytes;
large immutable asset references and paging belong in the production adapter.

The production background worker must be durable and independent of renderer or
user presence. Acceptance must atomically leave archive work discoverable; a
scheduled alarm/worker resumes bounded batches with backoff after failures. It
must expose age/bytes of the oldest unarchived revision, archive throughput and
capacity pressure. No user should run an archive command. Scheduling is not
implemented in this operator-only storage probe and no automatic retry guarantee
is inferred from calling the command repeatedly in tests.

Do not delete action/dedup metadata merely because a document snapshot exists.
Metadata compaction needs immutable revision segments plus a durable index for
(actor, transaction ID, exact hash, original result), including retained rejection
results. Publish the verified segment/index root before retiring SQL rows; retain
snapshot references and any tail needed by active reads. An exact old retry must
return its original result after compaction and restart. The self-host journal's
paged receipt index is existing evidence for that pattern, not a ready-made DO
implementation. The full metadata compaction/replay corpus remains required.

Default product history must remain recoverable; user-visible history retention
and explicit deletion need an actual product policy before any age-based expiry.
Object garbage collection must prove absence from published snapshots, history
segments, current documents and in-progress jobs, with a crash-safe grace period.
It cannot infer liveness from R2 listing or the current document table alone.
No R2 deletion or production retention configuration is introduced here.

Loss of canonical DO SQL storage is a distinct disaster-recovery scenario.
Archiving bodies alone does not restore the action/dedup index or acknowledged
tail. State a separate disaster RPO/RTO, backup strategy and restore proof before
claiming that guarantee. The existing workerd SIGKILL tests prove process-restart
recovery with durable SQL intact; they are not regional disaster tests.

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
