# Paged document snapshots — T8 follow-through

The current experimental snapshot is **version 2**, still referenced by the
version-2 conditional head. It replaces inline document strings with up to 256
immutable document-index pages, each holding at most 512 sorted references.
Bodies, pages and root are independently content-addressed and verified on cold
read. This format has only been used in disposable test namespaces; it is not a
production migration and does not read the earlier snapshot-version-1 format.

Each body stores a JSON-encoded string, preserving all code units allowed by the
proposal contract, including escaped lone surrogates. Direct UTF-8 encoding would
silently replace those values. Body byte length is checked in addition to its
hash. References and bodies stay within the existing 1-MiB per-object bound.
The 64-KiB synthetic operation limit remains; this is not large media transfer.

`read({ materialize: false })` loads the head, snapshot directory and bounded
suffix. `documentValue(state, key)` then reads only the referenced document page
and body, or the already replayed suffix value. The read view stays anchored to
its captured head after concurrent new snapshots. `state.documentIndex.page()`
provides bounded metadata enumeration for progressive reconstruction. These are
internal experiment APIs, not public authorized project endpoints.

Append, receipt lookup, epoch advancement, initialization and snapshotting use
metadata reads and do not hydrate unrelated documents. The convenience full
`read()` has an 8-MiB default materialization cap; callers may explicitly choose
up to 64 MiB, or progressively enumerate pages. The immutable LRU remains bounded
separately; neither cap is a claim about whole-process peak memory.

A snapshot uploads changed bodies and pages before publishing its root through
head ETag CAS. Only affected document and receipt shards are rewritten. Equal
bodies share a hash within the project namespace. The count tracks new document
identities across snapshots. No prior accepted entry/body/page is garbage-collected;
the retention/expiry gate remains open. The nominal directory capacity is not a
load-tested project limit, and an overflowing individual shard fails capacity.

The local protocol tests exercise a **160-document, 10-MiB** real text fixture,
ten snapshot generations, complete cold reconstruction with exact string parity,
oldest exact result retry, a subsequent independent edit, pinned older read views,
bounded eager-read refusal, and a 128-KiB immutable cache. Metadata alone takes
two GETs; one cold active document adds two GETs. They also cover missing/corrupt
pages and bodies, 507 before a body write, lost body ACK, exact Unicode/code-unit
roundtrip, and the existing journal/snapshot CAS, epoch and SIGKILL corpus.

This removes the demonstrated 1-MiB whole-project snapshot limitation. It does
not implement production structured operations, file/media blobs, source parsing,
all-writer authorization, DO/R2 parity, GC, automatic compaction, desktop outbox,
history/undo UI, or managed onboarding. Those remain requirements of T1–T35.

## Final local evidence — 2026-09-14

Node 24.13.0: **23 pass / 0 fail / 0 skip**, 12.31 seconds across
`journal.test.mjs`, `snapshot.test.mjs`, and `document-index.test.mjs`.
Log: `/tmp/maude-document-index-final-tests.log`. Progressive reconstruction
evidence: `/var/folders/t_/kf80xz3j79sfmkrq4snj2qk00000gn/T/maude-document-index-oBE1BT/evidence.json`.
The 10-MiB fixture reaches revision 161 after the extra edit; immutable cache
limit is 131,072 bytes. This is a storage reconstruction test, not a native UI run.

The final standalone bundle (168,466 bytes, SHA-256
`e26b2fbef4d05263609698931ad973920679b7057e9a3f4bbe2870049f6d1b61`)
passed its Node 22.13.1 empty-cwd process test with both 1-KiB and 64-KiB values.
Log: `/tmp/maude-document-pages-final-bundle-test.log`. Scoped static checks
cover 11 files, with zero errors and eight style warnings;
`/tmp/maude-document-index-verification.log`.

## Actual S3 final-format evidence

Eight cases passed on 2026-09-14, 13:09:41–13:11:17 UTC, against the verified
StudyFi S3 bucket. This includes the earlier three snapshot SIGKILL boundaries,
concurrent action/snapshot CAS, exact history/results, and sixteen distinct
64-KiB document values with complete cold parity and bounded active access.
Evidence and source copies: `/tmp/maude-real-s3-document-pages-final/`. All 148
created versions were deleted; no versions or markers remain under
`maude-sync-conformance/49dc89bc-f2e8-43f3-a6e4-06c9b84fbce0/`.
These are backend recovery checks, not native multiplayer or media E2E.
