# T8 bounded warm validator pool experiment

No production service/deployment choice is made. This isolated repository fixture changes no dependencies, native ABI or remote resources. The product does not import it. It uses the **same existing compiled production `sourceError` artifact** as the integrated validation-runtime spike. It does not copy parser semantics or introduce an alternate checker.

## Run

From the Maude checkout, after its existing validation-runtime spike has built `dist/source-validator.mjs` and `dist/corpus.json`:

```sh
MAUDE_NODE=/path/to/node22 bash scripts/dev/sync-e2e/validation-runtime-spike/warm-pool/run.sh
```

`MAUDE_REPO` overrides repository discovery. All source imports inside this block are relative; the repository artifacts resolve through `paths.mjs`. The pool does not rebuild them. Evidence goes to a new temporary directory, or `MAUDE_SPIKE_EVIDENCE_DIR`; tests do not overwrite source fixtures. `source-evidence.json` fingerprints the actual compiled validator, original TS validator, corpus, baseline service and this block's source files.

## Verified behavior

**3/3 tests passed on Node 22.13.1** in the integrated run (`/tmp/maude-warm-validator-integrated.log`).

- Exactly two long-lived parser children by default, fixed admission, **no waiting job queue**. Two admitted 1 MiB jobs use distinct PIDs; a third request returns fail-closed `capacity` immediately. Sequential production corpus requests reuse existing warmed processes.
- `health().ready` is false during startup and becomes true only after every child loads the production parser and actually accepts valid TSX **and** rejects invalid TSX. Ready frames bind process PID, slot generation and compiled-validator hash. Crashing startup has a finite retry ceiling; it stays unhealthy after the configured failures.
- **17/17 production corpus outcomes**, correct source hash, validator hash and no execution-canary side effect.
- Every admitted job gets a coordinator-owned UUID, exact source SHA-256, compiled-validator SHA-256 and fresh worker-generation token. A wrong job ID or wrong source hash cannot resolve an accepted result: it fails the job and replaces that worker.
- Per-job timeout kills only the stuck child; its sibling continues validating during failure and replacement. Crash also fails closed. Test checks the old PID exits, the failed slot gets a new PID, and the healthy slot keeps its PID across timeout/crash/correlation failures.
- Replacement starts only after the old child's `close` event, so it cannot intentionally exceed the fixed live-child limit. Startup retries use bounded backoff and a maximum failure count.
- `drain()` rejects active jobs with `draining`, rejects new admission, cancels scheduled restarts, kills and awaits all child closures, then removes the empty child cwd. Tests verify each PID is gone and cwd is removed.

`fault-worker.mjs` is a **test-only wrapper** for hangs, crashes and forged result frames. The ordinary worker has no source-triggered fault mode. `pool-evidence.json` records warmed PIDs, replacements, correlation errors and successful sibling work.

## Local comparison using the same validator hash

The benchmark checks that the baseline service and warm pool use the same compiled-validator hash. Both measurements start after coordinator input admission/hash validation and end when a child result arrives. They include IPC and parsing; the baseline additionally includes fork/startup. **HTTP ingress and remote network latency are excluded from both.** Warm and cold samples alternate within each corpus size.

| Source | Samples per path | Warm p50 | Cold p50 | Warm max | Cold max |
|---|---:|---:|---:|---:|---:|
| 1 KiB JSX text | 10 | 0.77 ms | 161.93 ms | 4.05 ms | 180.88 ms |
| 1 MiB JSX text | 5 | 16.38 ms | 178.50 ms | 22.59 ms | 205.98 ms |
| 4 MiB JSX text | 5 | 73.24 ms | 229.97 ms | 77.52 ms | 283.20 ms |
| 5,000 JSX elements, 287,813 bytes | 5 | 113.90 ms | 320.04 ms | 119.26 ms | 446.08 ms |

Warming the two workers took **152.01 ms** in this run. Raw samples and parser-only timings are in `benchmark-evidence.json`. This is a small local experiment, not p95/p99 confidence, a cost model or a regional SLA. The structured AST case shows why byte size alone is not a parse-cost bound: 288 KiB with many nodes costs more than a 4 MiB text node.

The first integrated benchmark failed when the cold HTTP service hit its existing
2-second deadline. Its log is retained at `/tmp/maude-warm-validator-integrated.log`;
concurrent host load was observed, but the exact cause is not proven. After adding
failure evidence capture and startup cleanup, a standalone benchmark completed
50 alternating warm/cold samples with unchanged limits; its results are shown
above and retained under `/tmp/maude-warm-validator-benchmark-final/`. It does not
cancel the failed run or prove sustained-load performance. The runner fingerprints
sources before tests; failures preserve attempted samples and still exit nonzero.

## Scope and remaining integration gates

This is a reusable **pool core**, not a deployed HTTP validator service or a replacement for the full T8 decision. The existing baseline HTTP service is used only for comparison; this block does not expose new network routes. Production routing, service auth, request-envelope/body-read bounds, version rollout, remote result lookup, per-tenant fairness, cancellation and load-balancer policy still need integration and tests.

Current prototype limits: default 2 workers (constructor cap 8), source cap 4 MiB, job deadline 2 seconds, startup deadline 3 seconds, up to 3 consecutive startup failures. Child V8 old-space is limited to 96 MiB; this is **not a hard bound on native/RSS allocation**. Hard CPU/RSS isolation, bounded diagnostic event retention, worker recycling by jobs/RSS, long-term parser leaks, adversarial nesting and multi-project sustained load remain unverified.

`health()` is an actual parser-warm status method and includes warmed count/state/validator hash. During a single-slot replacement overall readiness is false while the healthy slot may still accept work; a production gateway must choose and document its partial-capacity policy. The code deployment artifact is required, but workers run from an empty cwd and never load or execute candidate imports or restore a project/render checkout.

No AWS/Cloudflare staging request, storage-adapter decision, production-service selection or T8 completion is claimed here.
