# T8 source-validation runtime feasibility

This is a bounded local runtime experiment. It selects **no production storage adapter or validator deployment** and does not complete T8. Initial work was isolated outside the repository; reviewed source is now integrated here, with run artifacts written to a temporary directory (override `MAUDE_SPIKE_EVIDENCE_DIR`); no remote deployments, package installs or native dependency rebuilds were performed.

## Reproduce

From the Maude checkout:

```sh
MAUDE_NODE=/Users/iagh/.nvm/versions/node/v22.13.1/bin/node \
MAUDE_WORKERD_NODE=/Users/iagh/.nvm/versions/node/v24.13.0/bin/node \
scripts/dev/sync-e2e/validation-runtime-spike/run.sh
```

`MAUDE_REPO` overrides repository discovery. `MAUDE_MINIFLARE_ENTRY` must point to an existing Miniflare entry; this host uses `/Users/iagh/.nvm/versions/node/v24.13.0/lib/node_modules/wrangler/node_modules/miniflare/dist/src/index.js`. Its exported `convertV4MiniflareOptions` is applied before constructing Miniflare 5. The Node22 process uses the installed Node API parser; workerd is run under the explicit Node24 executable. Bun compiles the production TS validator into a Node-compatible ES module without copying its logic.

## Results and implications

| Candidate | Actual experiment | Outcome |
|---|---|---|
| Installed OXC 0.139.0 + production `sourceError`, Node22 | 16 fixtures extracted from existing `sync-source-safety.test.ts` plus one import/execution canary | **17/17 correct**, oversize rejected, no candidate code/import execution |
| Same production validator on Bun 1.3.3 | Same generated corpus, same installed native OXC | **17/17 correct**, same rejection outcomes |
| Installed OXC browser/WASI entry | Actual Bun Worker-target bundle of production validator using package `src-js/wasm.js` | **Cannot bundle:** optional `@oxc-parser/binding-wasm32-wasi` is not installed; no substitute installed |
| Native addon capability in actual workerd | Worker with Node compatibility calls `process.dlopen` | Function exists but throws **"The process.dlopen method is not implemented"** |
| Existing TypeScript 6.0.3 pure-JS parser | Actual 9,735,366-byte bundle runs in workerd; `createSourceFile(...).parseDiagnostics` on same corpus | Runs, but **6 false accepts / 17 cases**: duplicate functions/imports/default exports/destructuring binding/export names |
| Dedicated Node22 validation process | Real HTTP service forks parser child, empty cwd, removed render checkout, same corpus | **2 service tests pass**, 17 corpus outcomes, size/schema/hash gates, capacity refusal, timeout/SIGKILL and crash rejection |

Evidence: `final-results.txt`, `node-runtime-evidence.json`, `bun-runtime-evidence.json`, `worker-bundle-evidence.json`, `worker-runtime-evidence.json`, `service-evidence.json`, and `build-evidence.json`.

The current installed native OXC cannot be used unchanged in Worker execution. The failed optional-WASI import does **not** prove that a separately evaluated WASI build could never work; it proves that no such runtime is available in the installed dependency set. Adding that runtime would require a new dependency, Worker import/init validation, semantic corpus parity, limits and cost evidence.

TypeScript's parse-only JS path is available without a new dependency and actually executes in Worker. It is **not a replacement with equivalent behavior**: it silently accepts six duplicate-source cases already guarded by production. A richer TypeScript semantic checker or another pure-JS/WASM implementation remains a research option; its no-import-resolution behavior and complete parity must be proven before adoption. This experiment does not claim pure-JS validation is inherently unsuitable.

[Cloudflare's Node compatibility documentation](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) distinguishes implemented APIs from compatibility stubs. The local workerd call above is the specific evidence for `dlopen`, rather than assuming that the presence of a Node-compatible function implies native-addon support.

## Dedicated validator service prototype

`service.mjs` accepts only `POST /validate` with `{file:"canvas.tsx", body, sha256}` and rejects unknown fields. It returns a validation result bound to the exact source hash and compiled-validator hash. It never serves a project checkout or resolves candidate imports. The source string is sent over IPC to `validator-child.mjs`, which imports the **compiled production validator** and installed parser code from deployment artifacts. No candidate file is written.

The service proof removes a disposable render checkout before any request, then validates all cases from a separate empty cwd and confirms it stays empty. The valid canary imports a nonexistent module and contains a global side effect; validation succeeds without executing either. These are code deployment dependencies only, not dependencies on project/render checkout restoration. Packaging those code artifacts for an actual remote validator deployment is still required.

Prototype admission/limits:

- Source body: production **4 MiB UTF-8** cap; request envelope: **8 MiB + 4 KiB**.
- At most **2 admitted requests**, with no unbounded waiting queue. Additional requests return `503 {valid:false, code:"capacity", retryable:true}`.
- Overall body-read + validation deadline: **2 seconds**. Test injects a hung child and uses a 250 ms deadline, producing HTTP 504 and SIGKILL. Capacity remains occupied until child close is observed.
- Child startup/parser crash or malformed/hash-mismatched worker response returns fail-closed HTTP 503. A parser-invalid source returns 422; oversize 413; malformed extension/schema 400.
- Child V8 old-space cap is 96 MiB. This is **not** a hard RSS/native allocation limit; container/OS memory and CPU isolation remain required.
- `/health` exposes HTTP service readiness/admission state, active count, limits and validator hash. It remains responsive while children are hung. This is **not** a warmed-parser health probe or production load-balancer policy.

There is no public networking/auth in this loopback fixture. A Cloudflare caller would need a service-authenticated request/result contract, bounded remote timeout/retry and payload-hash/validator-version binding. Remote I/O must remain outside DO concurrency locks. This prototype does not implement those deployment controls or choose a location/provider.

## Measured local envelope, not an SLA

Each native parser microbenchmark validates ten synthetic files at 1 KiB, 64 KiB, 1 MiB and 4 MiB. These are mostly one large JSX text node and **do not measure worst-case AST complexity or adversarial parsing**. Latest Node22 4 MiB median was **31.38 ms**, max **72.80 ms**; Bun median **17.20 ms**, max **30.40 ms**. Full samples/other sizes are recorded in the runtime evidence.

The one-child-per-request service processed 18 valid/invalid jobs with local median IPC/startup/parse roundtrip **157.90 ms**, max **337.60 ms**. The HTTP test suite took **4.21 s**. Fresh process cost dominates the small-source corpus and can consume much of the multiplayer latency budget. A warmed bounded pool is a candidate for subsequent evaluation, not proven here. No remote network latency, regional capacity, dollar cost, tail-load SLA or large multi-file transaction cost was measured.

## Next integration gates

- Decide between a proven portable parser runtime and a separately deployed validator after semantic/runtime/latency evidence; no adapter-selection DDR is justified by this isolated experiment alone.
- Expand the conformance corpus to full syntax families, actual user canvases, pathological token/AST depth, imports, declaration merging and all existing writer validators.
- Verify auth, per-tenant admission, signed/versioned results or equivalent authenticated service binding, real timeout/cancellation, warm-pool replacement, hard resource isolation and deployment health.
- Prove actual AWS/Cloudflare staging access, regional latency/cost, validator outage behavior, accepted-revision storage boundaries and source blob integrity. No remote staging probe ran here.
- Integrate only after the root agent chooses the full T8 architecture block; no production file or runtime was changed by this task.
