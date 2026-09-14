# T7 actual-browser accepted/candidate proof

Status: actual Chromium protocol test passed after the root agent confirmed its native timing run was terminal. Initial passing run: Node 22.13.1, Chromium 149.0.7827.55, 1/1 cohesive test, 1.89 seconds test body / 2.24 seconds runner, 0 page errors. In-repository verification passed on Node 22; runner evidence goes to the printed temporary directory (override `MAUDE_SPIKE_EVIDENCE_DIR`). See the captured runner output for exact timings, `browser-evidence.json` for observed values, `build-evidence.json` for source/dependency hashes and `browser-proof.png` / `browser-unsaved-*.png` for rendered proof. This is an isolated protocol fixture, not production UX or T13 outbox completion.

## Run

From the Maude checkout:

```sh
MAUDE_NODE=/Users/iagh/.nvm/versions/node/v22.13.1/bin/node scripts/dev/sync-e2e/accepted-candidate-browser/run.sh
```

The runner uses installed Bun to build the browser Hocuspocus SDK client, the existing integrated T7 server fixture, and the **unchanged production source validator**. It then uses the chosen Node executable for a real Playwright Chromium test. Set `MAUDE_REPO` when running outside the checkout. No package installs or native ABI rebuilds occur. The test does not import better-sqlite3.

Node 22.13.1 has already successfully imported the compiled server fixture and executed the production validator against valid and invalid TSX. Node 20 is a portability target, not yet verified on this host. The build removes the Node24-only TypeScript import constraint without copying parser logic: Bun compiles `apps/studio/sync/source-validation.ts` and resolves the actual installed OXC parser through a tiny `createRequire(apps/studio/package.json)` adapter.

## Test design

The test hosts a minimal real browser page with accepted source, private candidate, source editor, transaction/dependency fields and save/retry/restore controls. Two independent Chromium contexts connect with designer and reader credentials through the actual browser HocuspocusProvider SDK to the existing T7 Hocuspocus server fixture.

- Browser-origin raw Update/SyncStep2 over both Sync/SyncReply opcodes must leave accepted Yjs bytes, both accepted DOM views, checkout and canonical history unchanged. Awareness cursor arrival establishes a receiver processing barrier after each rejected packet.
- A fresh browser provider session initially containing poisoned content attempts automatic handshake SyncStep2; the accepted observers remain unchanged.
- DOM controls create invalid U1 and dependent repaired U2. The author sees each private optimistic candidate immediately; the peer continues to see accepted BASE. Requests are retained in a **real IndexedDB transaction** before fetch submission. The UI reports locally saved only from transaction completion.
- Browser reload restores the full U2 candidate and exact retained U1/U2 request, snapshot and delta strings. Retries send the original request bytes and retain rejections. A new proven-base U3 replacement accepts once; peer DOM updates and retry after another reload returns the same result.
- `QuotaExceededError` and `AbortError` are deliberately injected by aborting a real IndexedDB transaction after its put is scheduled. The status becomes **Unsaved**, no request is sent, no candidate record is committed, and the working candidate remains visible in memory. Reload restores the prior committed candidate. **This is error-path injection, not proof of genuine browser disk-quota exhaustion.**

## Remaining scope

This does not implement or certify T13. It has one document/source.replace operation, a test actor/project partition, full snapshots, no complete operation registry, no actual native durable storage choice, no cross-tab transaction coordinator, no logout fencing, no request-size admission policy, no eviction/persistent-storage guarantee, no genuine quota exhaustion, no full local undo stack and no unknown-outcome network recovery. Browser reload is proven in Chromium; Chromium process crash and actual WKWebView persistence remain further evidence. Existing fixture storage is local single-process fsync+rename, not AWS/Cloudflare durability proof.

The server fixture is built from the integrated repository files, not forked runtime code. Generated `dist/` embeds local resolved paths and must be rebuilt after relocation. Source files are portable under `scripts/dev/sync-e2e/accepted-candidate-spike/browser/` or a sibling browser-spike directory; `paths.mjs` finds the repo above its own location or cwd.

The browser stores request/candidate records, not result receipts; after reload the minimal fixture shows a pending result until retry returns the retained outcome. This is an explicit production integration gap, not a fully truthful shared-saved UX implementation. Storage fault evidence uses injected transaction aborts, not actual exhausted disk space.
