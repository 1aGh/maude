# T7 accepted publication / candidate replay spike

This is an executable **test fixture**, not production integration and not a T7 completion claim. It was developed in an isolated directory while native E2E tested an immutable source/build snapshot, then imported as a standalone architecture fixture. It does not enable the proposed protocol in the running product.

Run from the Maude repository (Node 24.13.0 was used):

```sh
MAUDE_NODE24=/Users/iagh/.nvm/versions/node/v24.13.0/bin/node scripts/dev/sync-e2e/accepted-candidate-spike/run.sh
```

The runner checks Node major 24 before executing; no native dependencies are rebuilt. The fixture does not import better-sqlite3 or the SQLite extension. From outside the checkout, set `MAUDE_REPO` to an absolute checkout path. Dependencies resolve explicitly through that checkout's `apps/hub/package.json`; the syntax validator imports the actual `apps/studio/sync/source-validation.ts`. No dependencies were installed. Installed versions: Hocuspocus server/provider 4.3.0, Yjs 13.6.31. `evidence.json` fingerprints the actual installed bundles and validator, not just version labels.

## Verified boundary

`project-transactions.test.mjs`: **4 tests pass** (last measured ~1.4 seconds total; in-repository run: `/tmp/maude-t7-in-repo-test.log`). These are real Node Hocuspocus sockets/providers, not mocked receivers.

1. For authenticated designer, reader, and loopback service tokens, both `Sync` (0) and `SyncReply` (4) with **SyncStep2 (1) and Update (2)** cannot modify accepted content. The test deliberately resets each existing server connection to `readOnly=false` before a packet; `beforeHandleMessage` reinstates the gate, proving existing-socket coverage. The exact accepted Yjs state bytes, observer update count, canonical body, checkout and history remain unchanged. Allowed bounded cursor awareness reaches the peer after each rejected packet. A separate freshly connected session preloaded with malicious candidate content cannot inject that content through its automatic handshake SyncStep2. Unlisted document creation is denied during authentication before document allocation. Reader proposals are denied.
2. A real Yjs candidate starts from accepted BASE. Invalid U1 is parsed by production `sourceError` and rejected; U2 is authored with U1 present and repairs the visible syntax. U2's raw delta demonstrably cannot reconstruct its text atop accepted BASE, so applying that delta is not a rebase. The explicit U2 proposal depends on rejected U1 and is held/rejected. Its complete candidate is also denied through raw SyncStep2. Server reconstruction + provider reconnection + outbox reconstruction preserve the exact U1/U2 request, delta and snapshot bytes. Identical retries return retained rejection results. A new proven-base `source.replace` produces exactly one revision; identical retry does not duplicate history, and same ID/different bytes returns `transaction-id-reused`. Rejected source never enters checkout/history/accepted peer.
3. Revoked membership and changed epoch close already authenticated sockets before they can mutate accepted content. This is an in-memory membership fixture, not production auth integration.
4. A separate coordinator **OS process is SIGKILLed and replaced** after rejected U1/U2, then again after accepted U3. Candidate recovery, rejection retry, accepted source, checkout, result idempotency and one-revision history survive. This exercises actual process replacement over the spike's local fsync+rename adapter; it does not prove AWS/Cloudflare storage guarantees.

Negative control: `negative-control/server.mjs` removes only the per-message readOnly restoration. Running the first test fails immediately with `REJECTED_writer...` in accepted content (`/tmp/maude-multiplayer-t7/negative-control-results.txt`). This proves the gate assertion detects publication leakage. The negative-control tree is evidence only and must not be integrated.

Expected stderr includes forbidden-auth and stale-epoch closure messages: those are intentional negative cases, not uncontrolled test failures.

## Chosen candidate/rebase representation

Accepted Y.Doc is server-written and has no optimistic client content. An author uses a separate optimistic Y.Doc. The outbox retains **immutable exact proposal bytes**, complete candidate Yjs snapshot, and per-action delta, with a transaction ID; storing different bytes under that ID fails. This spike uses separate files, not a browser persistence substitute.

Only explicit operations enter acceptance. For this bounded source experiment the operation is `source.replace` with exact accepted source hash, document ID/generation, revision, and manifest token. The coordinator checks dependencies before running the operation in a private value. It runs production OXC validation without executing imports, then persists canonical head + result + history as a single local JSON envelope, projects accepted content, and finally updates accepted Y.Doc. No `onStoreDocument`/`afterStoreDocument` callback is a publication barrier.

Rejected U1 holds U2; U2 is **not** retried as a raw Yjs update. The repair creates U3 with a fresh transaction ID and an explicit proven-base replacement against current accepted state, retaining the old candidate records. `rebasedFrom` records lineage in the test request and is not a successful dependency. This models explicit resolution of whole-file source; it does not automatically infer safe merges from stale buffers. Instrumented operations need the planned semantic operation registry, read/effect preconditions, and dependency rebase, rather than a blanket whole-file replacement fallback.

## Required integration and missing evidence

- Browser candidate/outbox: IndexedDB transaction must atomically persist exact request bytes, base receipt, dependency graph, candidate snapshot/delta, undo context, actor/project/device partition and pending outcome **before** claiming local saved status. Test quota failure, eviction, renderer crash, restart, logout/project switch and offline rebase in Chromium and actual WKWebView. None is proven here. Native durable storage choice also remains open.
- Production coordinator: real authenticated actor/membership resolution; epoch persistence/fencing; full strict envelope/operation schema; finite caps, replay horizon and idempotency admission semantics; concurrency-safe durable adapter; result lookup; immutable serving snapshot and projector. `Kernel` is deliberately one-process, one-document, one-operation fixture with a local fsync journal, not T8 storage approval. Its projector writes one file and does not solve atomic multi-file serving.
- Socket integration: no existing production accepted route was switched. Every authenticated legacy/loopback/document creation path must be enumerated and fenced when accepted protocol is enabled. `openDirectConnection`/server-side Y.Doc mutation is a trusted process API and must be reachable only by the accepted replayer; this spike exposes neither to clients. Migration of already-live legacy rooms and deployment compatibility remain unproven.
- Awareness: spike allows only bounded numeric cursor tuples and limits count/bytes. It proves the transport can keep ephemeral awareness while rejecting content. Production identity ownership, rate limiting, actor-driven sanitization, session switching and UI presence remain required.
- Production UX/native E2E, multi-backend AWS/Cloudflare parity, concurrent independent semantic operations, peer-safe undo, history grouping, manifest/directory operations, media and large-file/replay limits are not covered. T6–T35 remain intact.

## Repository execution

Use Node 24 explicitly on the local validation host:

```sh
MAUDE_NODE24=/Users/iagh/.nvm/versions/node/v24.13.0/bin/node scripts/dev/sync-e2e/accepted-candidate-spike/run.sh
```

This fixture directly imports the production TypeScript validator using Node 24.
It is kept outside the ordinary hub test glob so it does not silently raise the
hub's supported runtime or change its Node/native-module installation. The
original T7 `apps/hub/test/project-transactions.test.mjs` entry is still pending a
portable validation-runtime integration. T8 must validate the actual production
runtime and both storage families; this local prototype does not prove those.

The runner checks Node's version and prints source/dependency hashes. Candidate
and accepted state remain separate; the fixture Kernel is not a production
adapter and must not be copied into the live hub.
