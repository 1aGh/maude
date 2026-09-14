# T8 bounded snapshots and receipt index

Historical inline-snapshot proof below. The current prototype's paged document
format and progressive reads are described in [DOCUMENTS.md](DOCUMENTS.md).
Actual in-region measurements of this earlier inline format are recorded in
[REGIONAL.md](REGIONAL.md). Preserve the dated numbers below as their own runs.

This extends the existing object-journal candidate. The snapshot boundary compacts
**replay work**, not retained history. No accepted entry, prior snapshot, receipt
page or losing branch is deleted by the coordinator. Garbage collection and
retention expiry are deliberately separate, still-open correctness work.

## Runtime behavior

The experimental head is version 2, with a content-addressed snapshot pointer.
This changes only disposable prototype namespaces; no product data used this
schema and the prior version-1 AWS test prefix was already cleaned. There is no
claimed production migration or old-prototype reader compatibility.

A snapshot contains its verified logical base, materialized synthetic document
values and a directory of at most 256 immutable receipt shards, keyed by the
first byte of SHA-256(project-scoped actor/transaction identity). Creating the
next snapshot only rewrites pages touched by the new suffix. Exact accepted and
rejected receipts are retained, including their original proposal digest and
entry reference. Capacity never drops an old receipt or treats its ID as new.

The coordinator loads the immutable snapshot and only the bounded suffix from
its base to the current head. Normal operations use that view and indexed result
lookup. `read().entries/results/actions` describe the **suffix**;
`read().documents` includes the complete materialized fixture state. Use
`result()` for a historical receipt and `historyPage()` for retained log entries.

The immutable-byte LRU defaults to 8 MiB and is strictly bounded. New writes enter
it only after a confirmed immutable write or identical-byte resolution. Cold
reads verify SHA-256 before caching. The mutable head is always fetched afresh,
so cached bodies cannot fence out a legitimate newer head or bypass an epoch.
A warm cache assumes storage immutability/retention; integrity tests explicitly
clear it or create a new coordinator to establish cold recovery behavior.
This cache is not persistent SQLite, a whole-process/RSS bound, or an availability
check for every archival object on every keystroke.

Snapshot pages/root are uploaded before a conditional head-pointer update. The
pointer update does not change logical revision/sequence or add an undo action.
A concurrent accepted change makes the stale snapshot CAS fail. Lost publication
ACK resolves from the authoritative pointer; uncommitted snapshot objects are
harmless. The old owner must pass the same fixed-epoch fence to compact.

History is paged through the immutable accepted chain. Opaque HMAC cursors bind
the next pointer to a previously traversed accepted anchor, so caller-supplied
hashes cannot expose abandoned proposal branches as accepted history. Cursor
signing is per coordinator instance in this fixture: restart invalidates a cursor
and the caller must reopen the history query. A durable/shared gateway cursor key
and user authorization remain production work; this is not final history UX.

## Verification

```sh
/path/to/node24 --test scripts/dev/sync-e2e/durable-store-spike/object-journal/snapshot.test.mjs
# Explicitly authorized synthetic AWS prefix, with exact-version cleanup:
/path/to/node24 scripts/dev/sync-e2e/durable-store-spike/object-journal/aws-probe.mjs \
  --scratch-write <profile> <bucket> <region> <expected-account> snapshots
```

`MAUDE_SPIKE_EVIDENCE_DIR` optionally selects the output directory. Credentials
stay in memory and are never included in evidence. The AWS runner retains its
64-created-version cleanup guard and verifies an empty random prefix afterward.

Local snapshot suite: **9 pass / 0 fail / 0 skip**, Node 24.13.0, 2.22 seconds.
The earlier journal/epoch/retry/crash suite remains **11 pass / 0 fail** after
introducing the version-2 head and immutable cache. Snapshot cases cover several
snapshot generations beyond the suffix cap, old accepted/rejected exact retries,
indexed lookup, complete paged history, forged/expired cursor rejection,
concurrent compaction and append, 507 refusal, missing/corrupt snapshot/index,
lost pointer ACK, LRU eviction, stale owner, oversized materialization and three
actual SIGKILL points: before snapshot objects, after objects, after head pointer.

Evidence: `/tmp/maude-snapshot-final-proof/snapshot-evidence.json`,
`/tmp/maude-snapshot-journal-regression/`; corresponding `.log` files under `/tmp`.
A test with 16 synthetic 64-KiB documents proves the inline snapshot byte cap
fails without publishing a partial pointer or changing accepted state.

Actual AWS S3: **7 reported cases pass**, 2026-09-14 12:39:18–49 UTC, account
797601398300, bucket `studyfi-shared-euc1-design-assets`, eu-central-1. The test
includes two initial snapshot generations, bounded cold/warm reads, a separate
snapshotter process racing a new action, three real SIGKILL/recovery boundaries,
and complete preservation of 13 accepted synthetic history entries plus the
oldest exact receipt. Fresh renderer fixtures are reconstructed after each kill.

Evidence: `/tmp/maude-real-s3-snapshot-proof/evidence.json`. All **53 exact test
object versions were deleted and zero remained** under the generated prefix
`maude-sync-conformance/5b3f302d-c5d8-4174-8eb2-795d5dbd5df0`. No production project,
service, deployment, IAM or bucket lifecycle was changed.

## Cost and latency evidence

After a complete snapshot, a cold current-state read uses exactly **2 GETs**
(head + snapshot); an old receipt adds its **one** shard GET. A suffix adds its
bounded new entries and any required not-yet-cached receipt shards. Warm requests
retain immutable objects under the LRU bound. The tests assert actual HTTP counts.

On real S3, cold fixture state took **237.73 ms** from this development host.
Five warmed synthetic appends each used **1 GET + 2 PUTs** and took
**322.71, 321.18, 376.07, 375.70, 444.67 ms** (median 375.70 ms). These include
coordinator HTTP/receipt decoding/CAS, but exclude designer interaction, real
source parsing, publication and peer rendering. Five samples are not qualified
p95/p99, and a development-host-to-S3 route is not an AWS-local coordinator path.
This does **not** establish the final 300-ms peer-render goal; in-region execution
and full pipeline measurements are required before adapter selection.

## Remaining limits and gates

- The snapshot root and each receipt page are capped at 1 MiB. A page permits at
  most 1,024 rows; a directory has at most 256 pages. No expiry is implemented:
  within those limits receipts/history are retained indefinitely. A real offline
  horizon, safe ID expiry, disk/object GC and retention costs remain open.
- Materialized fixture values are currently inline in one snapshot, capped at
  256 documents and 1 MiB total. The 16-document capacity test shows this cannot
  represent full large projects yet. Blob-backed document snapshots and progressive
  materialization must replace that fixture limitation before production use.
- The default replay suffix is at most 128 entries / 8 MiB; operations return
  capacity until compaction succeeds. Automatic bounded compaction scheduling,
  persistent local indexing and graceful capacity UX remain unimplemented.
- Immutable-prefix enforcement, lifecycle exclusions, snapshots with real blob
  references, AWS-local cost/latency and actual Cloudflare DO/R2 parity remain T8
  gates. This is a viable storage experiment, not a chosen production adapter.
- The operation remains a strict synthetic `source.text.assign` with fixture
  receipts. Full source validation, permissions, source/effect kernel, all media,
  native publication and UI/undo/onboarding requirements remain T1–T35 work.
