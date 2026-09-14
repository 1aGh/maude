# T8 durable storage experiments

These are isolated storage probes, not production routes, chosen adapters or a
complete transaction protocol. The existing product does not import them.

## Local Workers runtime

`cloud-worker.mjs` runs a SQLite Durable Object under real local `workerd` through
an already installed Miniflare 5. It uses synchronous SQL transactions for
head/action/result writes, consumes SQL cursors before awaits, and awaits storage
sync before the acceptance response. The lost-ACK hook deliberately pauses after
that boundary so the harness can kill the private process group containing
workerd. No remote I/O is held inside the transaction.

```sh
MAUDE_MINIFLARE_ENTRY=/path/to/installed/miniflare/dist/src/index.js \
  /path/to/node24 --test scripts/dev/sync-e2e/durable-store-spike/cloud-store.test.mjs
```

Use Miniflare **5.20260831.0-alpha** / workerd **1.20260831.1**, the versions
available on the validation host. The harness uses the exported
`convertV4MiniflareOptions` adapter; the alpha constructor no longer accepts the
older options directly. No dependencies are downloaded by this command.
`MAUDE_SPIKE_EVIDENCE_DIR` selects evidence output; default is a fresh temporary
directory. The test records source hashes, actual runtime versions and killed
wrapper/workerd PIDs. All fixture HTTP listeners bind to loopback.

Three cohesive tests cover rollback after each partial SQL write, exact retained
retry and changed-ID bytes rejection, project isolation, concurrent base claims,
epoch fencing, and SIGKILL after commit/before ACK followed by restart and fresh
checkout reconstruction. Another restart after the recovered ACK preserves the
same state. SQL exceptions simulate transaction interruption; only the explicitly
named SIGKILL case claims OS process death. Epoch fencing here compares requests
through one canonical DO, not two independent cloud deployments.

The tiny payload is a string, authentication is fixture-supplied, and results
hash the exact HTTP envelope. There is no source validation, R2, production auth,
complete rejected/pending result retention, snapshot, compaction, upload, history
UI or publication implementation. Empty checkout reconstruction writes a fixture
file; it does not prove live multi-file serving atomicity. A local workerd disk is
not deployed Cloudflare durability or a real R2 bucket. The [shared conformance corpus](conformance/README.md) now runs strict whole
ProposalV1 bytes through both local adapters (22 passing tests). Full remote
action/blob/snapshot/crash conformance remains required before T8 can pass.

The implementation follows the retrieved [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
especially `transactionSync` and `sync`. Remote staging must establish the actual
storage and ACK guarantees; documentation alone is insufficient acceptance evidence.

## Self-host SQLite

```sh
/path/to/node24 --test scripts/dev/sync-e2e/durable-store-spike/selfhost/probe.test.mjs
```

This resolves the existing `better-sqlite3` through the repository hub package.
See [the self-host report](selfhost/REPORT.md) for 13 tests including real lock and
database-page quota failures, five SIGKILL boundaries, actor-scoped deduplication,
live stale-process fencing and independent checkout reconstruction. The initial
test host has Node 24.13.0 / better-sqlite3 12.11.1 / SQLite 3.53.2. No native
binding rebuild is performed. Local SQLite success does not select AWS volume,
S3 conditional head or backup/restore policy. Those remain mandatory T8 evidence.

## Object journal follow-through

The [object-journal candidate](object-journal/README.md) now has 11 local
HTTP/process tests and three actual AWS S3 cases, including stale-owner CAS and
SIGKILL before ACK. Its synthetic S3 prefix was fully cleaned. It does not choose
a production adapter: indexed snapshot/replay, actual DO/R2 blobs, local cache,
limits and latency, IAM/retention and native publication still require evidence.
