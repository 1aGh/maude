# Shared T8 storage conformance

Run from the Maude checkout with the already installed Node 24 / better-sqlite3
binding and Miniflare 5. No dependency installation or remote mutation occurs.

```sh
MAUDE_NODE=/path/to/node24 \
MAUDE_MINIFLARE_ENTRY=/path/to/miniflare/dist/src/index.js \
bash scripts/dev/sync-e2e/durable-store-spike/conformance/run.sh
```

The runner bundles the Worker with Bun into ignored `dist/`, runs identical
strict ProposalV1 bytes against actual SQLite WAL/FULL and local workerd
SQLite-backed Durable Objects, and writes evidence to a new temporary directory.
`MAUDE_SPIKE_EVIDENCE_DIR` overrides that output. Node 24.13.0,
better-sqlite3 12.11.1, SQLite 3.53.2, Miniflare 5.20260831.0-alpha and
workerd 1.20260831.1 were used in the integrated run (22 passing tests).

Ten shared cases per adapter establish exact whole-proposal hashing, unchanged
retry, altered-byte ID reuse rejection, project/actor scope, authorization before
retained lookup, epoch handoff, retained terminal rejection, atomic rollback,
concurrent base claims, strict wire rejection and restart/replay. An exact retained
result remains readable after an epoch advance without applying the action again.
New stale-epoch proposals are rejected; changed bytes require a fresh ID.

Authorization is **fixture-supplied**, with strict input validation in the trusted
Node harness. The Worker rehashes/reparses the exact bytes but is not a publicly
safe gateway. Manifest/effect receipts are schema-valid fixture values, with one
`source.text.assign` operation and text-file replay. No production source effects,
auth integration, TSX/native rendering or universal operation coverage is claimed.
The database rolls back injected exceptions here; OS SIGKILL is exercised by the
separate parent-directory and `selfhost/` probes, not by this restart case.

Miniflare's module root is explicit: leaving it at the current checkout while
loading a Worker from `/tmp` generated `../` module names and workerd failed at
startup with an internal error. Setting the module root to this harness directory
fixed the same temporary corpus before integration; no storage assertion changed.

Still required: actual DO/R2 and AWS/S3 head+journal probes, payload availability,
snapshot/compaction, two owners on separate disks, bounded replay and a complete
failure/deployment decision. These tests do not select an adapter or complete T8.
