# Feature: Cloud cost cut + cold-start waiting room

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports. Read the comments in `apps/cells/cell-do.mjs` **in full** before touching the wake path. Almost every line there is scar tissue from a named incident (2026-08-03 lost-handle outage, 2026-09-03 credential-mint storm).

## Description

The Cloudflare invoice for September was **~$65**. It was measured from the account's GraphQL analytics for 2026-09-03 → 10-01 (`containersUsageAdaptiveGroups`, `r2OperationsAdaptiveGroups`, `workersInvocationsAdaptive`). Almost all of it is containers doing nothing useful:

| Line | ~$/month | Cause |
| --- | --- | --- |
| `maude-render` container | **~23** | One instance (`a6fb7e5b…`) is up **24/7**, despite `sleepAfter = '10m'` and only ~30 requests/day. Root cause unverified. |
| `maude-cells` (Alligators) | **~28** (mem 12.8, CPU 10.6, egress 3.9) | Woken **every hour** by the control plane's telemetry probe, and every wake re-hydrates the whole 7.5 GB project from R2 at 100 % of its 0.5 vCPU. |
| deleted test app `a03073b4` | ~3 | Multiplayer testing, 22.–24. 9. Already gone. |
| Workers Paid | 5 | Fixed. |

How the cell wake happens: `apps/cloud` runs `crons = ["0 * * * *"]`. `reconcileSweep` calls `probeCellBody()` for each live project (`apps/cloud/worker.mjs:679`), which is `GET https://<id>.cloud.maude.sh/health`. `apps/cells/worker.mjs` routes that into the `MaudeCell` DO, and the DO **starts the container**. The overnight evidence: 1–2 worker requests/hour, yet ~4,800 R2 GETs / ~7 GB/hour on `maude-cloud-assets`, and the container running at ~1,700 CPU-s per running hour. In total, about 6 TB of R2 GETs in September.

Beyond cost, the user wants a fix for the **cold-start / failure UX**. Today a person opening a sleeping or broken project gets raw browser text, with no UI:

- **cells worker:** plain-text 404 `this hostname is not a Maude project` and 503 `This project could not be started…`
- **cell DO:** plain-text 503 `…starting up… Refresh in a moment` and `could not obtain storage credentials`
- **tunnel mode:** a blind **120 s** wait, then a plain 503
- **non-tunnel mode:** the browser hangs on `startAndWaitForPorts` for up to **30 min**
- **hub studio-proxy:** a JSON body `{"error":"This project is starting up…","reason":"upstream-starting"}` even for a top-level page load
- **canvas origin:** the same raw text inside the iframe

## User Story

- As the **operator paying the Cloudflare bill**, I want idle projects and the idle render service to actually sleep, so that the bill tracks real use instead of wall-clock time.
- As a **Maude Cloud member opening my project**, I want a branded "starting your project" screen that waits for the cold start by itself, and a clear, friendly page when something is wrong, so that I never see a raw error string or a browser that just spins.

## Problem

1. **Telemetry wakes what it measures.** The hourly stats probe has no way to ask "are you up?" without waking the cell. Nothing else in the sweep needs the cell awake.
2. **The render DO never reaches idle.** `@cloudflare/containers@0.3.7` `isActivityExpired()` returns `false` while `inflightRequests > 0` (`node_modules/@cloudflare/containers/dist/lib/container.js` ~1688). A leaked inflight count (an aborted `/render`, or a `/_health` from `/_api/export-warmup` whose client vanished) would pin it forever. This is a **hypothesis**: the wrangler OAuth token cannot read Workers Logs.
3. **A browser navigation is treated like an API call.** The DO awaits the container before answering anything, so the person sees nothing until it is up or the deadline throws.
4. **Every failure surface returns developer text.** There are 9 known sites (inventory in Task 7).
5. **Dead resources.** The container app `maude-container-probe-probe` (`a03488c9`), the empty bucket `maude-multiplayer-test-20260922`, and `maude-sync-probe-*` probe buckets.

## Solution

The debate converged on the cost half and forked on the waiting room. **The user chose: both, with the breaker's guards.**

**Phase A — cost (no UX change; ships first, own release, measured on the bill)**

- **A1. A no-wake probe.** A request header (`x-maude-wake: never`) makes the cell DO answer **from `ctx.container.running` alone**. If the container is running, the request goes through to the hub's `/health` exactly as today. If not, the DO returns `200 {"state":"asleep"}` and does **not** start the container, fetch config, mint credentials or renew activity. Only the sweep's telemetry call sends the header. `probeCell` (checkout waiting room) and `awaitCellHealthy` keep waking, unchanged. The header can only **suppress** a start, never force one, so honoring it from any caller is safe.
- **A2. Render idle on our own clock.** The render DO records `#lastRequestAt` itself and overrides the library's idle decision with a bounded rule: stop when idle ≥ `sleepAfter`, and never while a request younger than the render job deadline is in flight. This holds whether or not the leak hypothesis is true. Diagnose first (Task 3), and ship the guard regardless.
- **A3. Cleanup** of the dead container app and empty test buckets, after a reference check.
- **A4. Measure.** Daily container-seconds per app before and after, recorded in STATE.md, so a "fix" is a number and not a hope.

**Phase B — waiting room + branded errors (single release, after A is verified)**

- **B1. A shared brand module for the data plane.** `apps/cells` gets its own small pages module. It imports the TOKENS/lockup that `apps/cloud/brand.mjs` already holds, through a module both Workers can bundle. If the bundler cannot share it, it uses a verbatim copy covered by the **same** drift test. A third drift surface without a pin is not allowed.
- **B2. The navigation-only waiting room** in the cell DO. It applies when **all** of these hold:
  - the request is `GET`
  - `Sec-Fetch-Mode: navigate`
  - `Sec-Fetch-Dest` is `document` or `iframe`
  - the container is not running/ready

  Then the DO kicks a **single-flight** start (one `#starting` promise per DO, the same one every waking path awaits) and immediately returns a script-free branded page that meta-refreshes the same URL every 3 s. When the cell is ready, the refresh simply lands on the project. Everything else keeps today's blocking semantics byte-for-byte: XHR/fetch, WebSocket upgrades, desktop file-plane PUTs, `probeCell`, `awaitCellHealthy`. The page adds **no** status route, so no unauthenticated "which tenants are awake" oracle exists.
- **B3. Canvas origin.** The same waiting/error page, but static and script-free under a strict CSP (`default-src 'none'; style-src 'unsafe-inline'`). It carries no links into the studio, no tenant name and no cookies (DDR-054).
- **B4. The hub studio-proxy speaks HTML to navigations.** `upstream-starting` and the hub's own 5xx return a branded page **only** when `Sec-Fetch-Mode: navigate`. The JSON contract for API callers is unchanged.
- **B5. Branded error pages** replace all 9 plain-text sites, with three variants and no more:
  - **not found** (404): unknown host, or canvas path with no project
  - **starting** (503 + `Retry-After` + meta refresh): cold start, credential cooldown, tunnel not yet up
  - **could not start** (503): fail-closed credential refusal, deadline exceeded, DO start failure

  The could-not-start page has a short human sentence, a "Try again" link, and a support line. Non-navigation requests keep their current text/JSON bodies.

**Explicitly NOT in this plan** (owned by `.ai/plans/feature-cell-materializer.md`, which another session is executing):

- hub boot order, hydrate/rehydrate, and the "bind first, restore behind a page" fix (`cell-do.mjs` ~238)
- `/health` fields (`disk`, `hydrate`). **This plan never adds `/health` fields.** The DO's `{"state":"asleep"}` reply is produced **only** for a header-carrying request and is consumed only by the sweep. `statsDatapoints` already emits nothing for an unknown body ("Unknown stays unknown", `worker.mjs` ~664).
- `cell-config.mjs` env, `portReadyTimeoutMS`, and the per-wake hydrate cost

If materializer Phase 1 lands first, B2's page simply shows for less time. Nothing here needs rewriting.

## Metadata

- **Type**: Bug Fix (cost) + Enhancement (UX)
- **Complexity**: High (two Workers + hub + a library lifecycle override; prod-only verification)
- **App/Package**: `apps/cells`, `apps/cloud`, `apps/render`, `apps/hub`
- **Affected Systems**: control-plane reconcile sweep, cell DO wake path, render DO lifecycle, hub studio-proxy, canvas origin, fleet deploy (`cells-deploy.yml`, `render-deploy.yml`)
- **Dependencies**: none new. `@cloudflare/containers` stays at 0.3.7, and the override is pinned by a test that fails if the library's private method names move.

---

## Context References

### Must-Read Files

> When consuming this section during `/flow:execute`, **read every file listed here in parallel in a single assistant message**.

- `apps/cells/cell-do.mjs` (whole file, 370 lines). Why: the wake path, the credential resolver, tunnel proxy, `routeToCell`. Every edit in A1/B2/B5 lands here.
- `apps/cells/worker.mjs` (60-136). Why: host → tenant routing and the two plain-text 404s and the 503.
- `apps/cells/cell-config.mjs` (`needsStartupState` ~311, `TENANT_HEADER`, `RESTART_PATH`). Why: the testable half. New pure helpers (the wake-policy decision, navigation detection) go here so `node --test` can reach them.
- `apps/cloud/worker.mjs` (583-700 sweep + telemetry, 890-910 `awaitCellHealthy`). Why: A1's single call-site change and the two callers that must keep waking.
- `apps/cloud/provision.mjs` (186-240 `probeCell` / `probeCellBody`). Why: add the opt-in `wake: false` parameter. `redirect: 'manual'` and the bounded body read must stay.
- `apps/cloud/checkout-routes.mjs` (~300). Why: a waking caller that must not change.
- `apps/render/worker.mjs` (whole file) + `node_modules/@cloudflare/containers/dist/lib/container.js` (740-790 `onActivityExpired`/`renewActivityTimeout`/inflight decrement, 880-925 `containerFetch` inflight accounting, 1540-1580 alarm loop, 1686-1692 `isActivityExpired`). Why: A2.
- `apps/hub/src/studio-proxy.mjs` (340-360 `upstream-starting`) + `apps/hub/src/studio-door.mjs` (`servicePage` ~192). Why: B4 reuses the hub's own service page.
- `apps/cloud/brand.mjs` (1-60 tokens, `lockup` ~233, `PAGE_CSS`) + `apps/cloud/brand.test.mjs` (drift test) + `apps/cloud/checkout-pages.mjs` (51-62 `page()` meta-refresh shell, 114-160 `waitingRoomPage`). Why: B1's source of truth and the pattern B2 mirrors.
- `apps/cells/wrangler.toml` + `apps/render/wrangler.toml`. Why: cost arithmetic comments, deploy-is-tag-gated contract (CLAUDE.md § Release flow).

### Files to Create

- `apps/cells/pages.mjs`: the three data-plane pages (`notFoundPage`, `startingPage`, `couldNotStartPage`, each with a `{ canvas: true }` variant). Pure, no `@cloudflare/containers` import, so it is node-testable.
- `apps/cells/pages.test.mjs`: renders, escaping, script-free assertion, CSP header shape, canvas variant leaks no tenant name.
- `apps/cells/wake-policy.test.mjs` (or extend `cell-config.test.mjs`): the wake decision table. Inputs are `{ method, headers, running }`; the output is one of `proxy`, `asleep-reply`, `waiting-room`, `block-and-start`.
- `apps/render/test/idle-policy.test.ts`: the render idle rule.

### Documentation

- Cloudflare Containers lifecycle (`sleepAfter`, `onActivityExpired`, `renewActivityTimeout`): https://developers.cloudflare.com/containers/ (search "container class lifecycle"). Why: confirm `start()` vs `startAndWaitForPorts()` semantics before B2.
- Fetch Metadata request headers (`Sec-Fetch-Mode`, `Sec-Fetch-Dest`): https://developer.mozilla.org/en-US/docs/Glossary/Fetch_metadata_request_header. Why: B2's navigation gate. Safari ≥ 16.4 sends them; on absence, fall back to `Accept: text/html` **and** `GET`.

### Patterns to Follow

**Script-free polling page** (`apps/cloud/checkout-pages.mjs:58`):

```js
function page(title, body, { refreshSeconds = null } = {}) {
  const refresh = refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">…${refresh}<title>${esc(title)} — Maude</title><style>${CSS}</style></head><body><main>${lockup()}${body}</main></body></html>`;
}
```

**Running-state check without waking** (`apps/cells/cell-do.mjs:154`): `needsStartupState(this.ctx.container)` reads `container.running`. It is the platform's truth and starts nothing.

**Transient = 503 + Retry-After** (`apps/hub/src/studio-proxy.mjs:349`): keep that status/header pairing on every "starting" page.

**Unknown stays unknown** (`apps/cloud/worker.mjs` ~664): a missing telemetry body renders an em-dash, never a zero.

---

## Design Decisions

### Components (from registry)

| Component | Source | Notes |
| --- | --- | --- |
| `TOKENS`, `PAGE_CSS`, `lockup()` | `apps/cloud/brand.mjs` | Lifted, never re-derived. Drift-tested against `.design/system/maude/colors_and_type.css`. |
| `page()` meta-refresh shell | `apps/cloud/checkout-pages.mjs:58` | Mirrored for the data plane. |
| `waitingRoomPage` copy tone | `apps/cloud/checkout-pages.mjs:117` | "Named steps, never a percentage" (DDR-203). Here: one step ("Starting your project") plus a reassurance line ("Your work is safe"). |
| `servicePage` | `apps/hub/src/studio-door.mjs:192` | B4 uses the hub's own page. The hub serves `/admin/style.css`, so no token copy is needed in the hub. |

### Existing screens / blocks reused

| Screen / block | Source | Notes |
| --- | --- | --- |
| Provisioning waiting room | `apps/cloud/checkout-pages.mjs` | Same visual language and meta-refresh mechanism. Extended, not reinvented. |

### Voice & copy (user requirement, 2026-10-01)

The starting page must **say what is actually happening**, in plain words and with a bit of humour:

- the project's server went to sleep because nobody opened it for a while (that is how we keep it cheap)
- it is waking up now
- **once it is up, everything runs at full speed**: the wait is a one-off and not how the app normally feels

The tone is warm and lightly funny, never jokey about data ("your work is safe" is said straight). No percentages and no fake progress bar (DDR-203).

- **Headline**: "Waking up {project name}…" On the canvas variant: "Waking up this canvas…", with no project name (DDR-054).
- **Why line**: "Nobody's opened this project in a while, so its server took a nap to save energy. We're brewing it a coffee."
- **Promise line**: "This first start takes a minute or two. Once it's up, everything flies like a rocket 🚀 — this only happens after a long break."
- **Reassurance**: "Your work is safe. This page refreshes by itself — no need to click anything."
- **Rotating status line, still script-free.**
  - Each refresh passes `?w=<n>` (attempt count), and the server picks the n-th line. Examples: "Stretching…", "Finding its slippers…", "Unpacking your canvases…", "Warming up the pixels…", "Almost there — just tying its shoelaces…".
  - It also shows the elapsed time ("waiting 0:42"), computed server-side from a `t=<start ms>` param. The params are cosmetic only: never trusted for anything else, clamped and escaped.
  - Strip `w`/`t` before the request is proxied once the cell is ready, so the studio never sees them.
- **Long-wait line** (elapsed > 3 min): "Big project — it's carrying a lot of photos up the stairs. Still going, promise." Past the deadline, the page becomes the could-not-start page.
- **Could-not-start**: "Well, that didn't go to plan." A human sentence about what failed (no stack or error codes), a **Try again** button, and "If it keeps happening, tell us at <support>".
- **Not found**: "There's no Maude project at this address." Plus a link to cloud.maude.sh (studio host only; none on the canvas origin).

The copy is a draft. Run it past `design:copy-critic` and the `michal-voice` skill in Task 7, and keep the meaning of the three promises (why, it will be fast after, your work is safe) even if the words change. English, like the rest of the Maude UI. Reduced motion: no animation at all. If a small idle animation is added (CSS only, e.g. a slowly blinking "zzz" on the mark), it is wrapped in `prefers-reduced-motion: no-preference`.

### Icons

None. The lockup mark is the only glyph, and it is the stored specimen (DDR-141).

### Tokens

| Purpose | Token |
| --- | --- |
| Page background | `--bg-0` |
| Card | `--bg-1` + `--border-subtle` |
| Body / quiet text | `--fg-1` / `--fg-2` |
| "Try again" button | `--accent` / `--accent-fg` |
| Motion | none. Reduced-motion collapse is inherited from `TOKENS`. There is no spinner; the meta refresh is the progress signal. |

### Custom Components Needed

| Component | Reason | Extends |
| --- | --- | --- |
| `apps/cells/pages.mjs` | The data-plane Worker cannot import `apps/cloud` at runtime (separate deploy, DDR-193) | `page()` pattern + brand tokens |

---

## Tasks

Execute in order. Each task is atomic and testable. **Phase A ships and is measured before Phase B starts.**

### Phase A — cost

### Task 1: ADD the no-wake reply to the cell DO — ✅ completed

- **Do**:
  - In `cell-config.mjs`, add `WAKE_HEADER = 'x-maude-wake'` and a pure `wakePolicy({ method, headers, running })`. In Phase A it returns `asleep-reply` only for `headers[WAKE_HEADER] === 'never'` and `!running`. Otherwise it returns today's behavior (`proxy` when running, `block-and-start` when not).
  - In `MaudeCell.fetch`, evaluate it **before** `fetchTenantConfig`, `#resolveStorageCredentials` and `renewActivityTimeout`. On `asleep-reply`, return `Response.json({ state: 'asleep' }, { headers: { 'cache-control': 'no-store' } })`.
  - Strip `WAKE_HEADER` before proxying to a running container. The hub never needs to see it.
- **Gotcha**: the reply must not touch `this.ctx.storage`, except for reading `tenantId` (already done). It must not call `renewActivityTimeout`, because renewing activity on a sleeping DO is how a probe would keep the next real sleep from happening. **Invariant: no-wake can only suppress a start, never cause one.**
- **Validate**: `cd apps/cells && npm test`. New cases in the wake-policy table: header + not running → `asleep-reply`; header + running → `proxy`; no header + not running → `block-and-start`; header value other than `never` → ignored.

### Task 2: UPDATE the sweep's telemetry probe to send it — ✅ completed

- **Do**: `probeCellBody(env, id, { …, wake = true })` adds `x-maude-wake: never` when `wake === false`. The sweep call at `apps/cloud/worker.mjs:679` passes `wake: false`. `probeCell` (checkout) and `awaitCellHealthy` are **unchanged**.
- **Gotcha**: `{"state":"asleep"}` has none of the stats fields. Verify that `statsDatapoints(row.id, body)` returns `[]` for it, so it is not emitted as zeros. Add the test if missing. Do **not** let the sweep treat "asleep" as unhealthy: grep for any consumer that maps the probe result to suspend/remediate logic.
- **Validate**: `cd apps/cloud && npm test`. Add a case asserting that the sweep's probe request carries the header and the checkout probe does not.

### Task 3: DIAGNOSE the render idle leak (time-boxed, 1 h) — ✅ completed (root cause: PID 1 without a SIGTERM handler)

- **Do**:
  - `npx wrangler tail maude-render --format json` for ~15 min, and capture any `Activity expired` line.
  - Add a one-line `console.log` in `MaudeRender.fetch`: entry/exit, with `this.inflightRequests` after `containerFetch` settles. Ship it in the Task 4 deploy, not separately.
  - Check whether `/_api/export-warmup` (`apps/studio/http.ts:4843`) can leave a request open, e.g. a client abort mid-`/_health`.
  - Record the finding in the plan's Execution Log.
- **Gotcha**: do not wait on this to ship Task 4. The guard works for any cause.
- **Validate**: finding written down (confirmed / refuted / inconclusive).

### Task 4: OVERRIDE render idle on its own clock — ✅ completed

- **Do**:
  - In `MaudeRender`, track `#lastRequestAt` (set on entry and exit of `fetch`).
  - Override `isActivityExpired()`: expired when `Date.now() - #lastRequestAt ≥ sleepAfterMs` **and** no request started within `RENDER_JOB_MAX_MS` is still open. Read the job deadline from `apps/render/server.ts` and do not invent one. Requests older than that count as leaked and are ignored.
  - Keep `sleepAfter = '10m'`. **Never override `alarm()`**: the library's lifecycle loop runs on it (`container.js` ~1540).
- **Pattern**: the library calls `this.isActivityExpired()` from its alarm loop, so a subclass override is the documented-by-code seam.
- **Gotcha**: pin the seam with `idle-policy.test.ts`. Assert that `Container.prototype.isActivityExpired` and `inflightRequests` exist in the installed package, so a library bump that renames them fails CI instead of silently disabling sleep. Test the pure rule separately.
- **Validate**: `cd apps/render && bun test`.

### Task 5: RELEASE Phase A + stop the stuck render instance — ✅ completed (v1.6.0 / v1.6.1)

- **Do**: standard release (`scripts/bump-version.sh patch`, annotated tag, see `.ai/release-guide.md`). This rolls `maude-cells`, `maude-cloud` and `maude-render`. The render tag bump restarts its instance, which is also the "manual stop" of the stuck one.
- **Gotcha**: coordinate the version with the materializer session. If its v1.5.3 hotfix is not tagged yet, ship together **or** sequence so both land. Never re-push content under an unchanged cell tag (CLAUDE.md § Release flow).
- **Validate**: after rollout, `curl https://render.cloud.maude.sh/_health` version = new tag; `.ai/release-guide.md` § "Verify the fleet actually rolled".

### Task 6: MEASURE + CLEAN UP — ✅ cleanup done; overnight measurement carried to `cloud-live-payments-rollout.md` L7c

- **Do**:
  - After ≥ 48 h, re-run the GraphQL queries from this session: daily `containersUsageAdaptiveGroups` per `applicationId` (sum `allocatedMemory` / (4 GiB × 86400) = instance-days), plus hourly R2 `GetObject` on `maude-cloud-assets` overnight. Record before/after in `.ai/state/STATE.md`.
  - **Expected**: render ≈ 0 instance-days when idle. The cell has no overnight wake when nobody uses it, so no hourly ~7 GB GET burst.
  - Cleanup:
    1. Grep the repo (workflows, `wrangler.toml`s, tests, docs) for `maude-container-probe`, `maude-multiplayer-test-20260922` and `maude-sync-probe`.
    2. With **no** live reference, ask the user to confirm deletion (permanent). Then `wrangler containers delete <id>` and `wrangler r2 bucket delete <name>`.
- **Validate**: numbers recorded, and the deleted resources are absent from `containers/applications` and the bucket list.

### Phase B — waiting room + branded errors

### Task 7: CREATE `apps/cells/pages.mjs` + brand sharing — ✅ completed

- **Do**:
  - Try a shared import first: move `TOKENS`/`PAGE_CSS`/`lockup` to a location both Workers bundle (wrangler bundles relative imports outside the Worker dir). Fallback: a verbatim copy, **with** `apps/cloud/brand.test.mjs` extended to assert the copy equals the source.
  - Write three page builders with a `canvas` flag. Every page: no `<script>`, escaped inputs, `cache-control: no-store`.
  - The starting page carries `Retry-After` + `<meta http-equiv="refresh" content="3">`.
  - The canvas variant omits the tenant name and every link, and is served with `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:`.
- **Inventory to replace (all 9):**
  1. `worker.mjs:81`, canvas origin without a project
  2. `worker.mjs:113`, not a project
  3. `worker.mjs:130`, could not start
  4. `cell-do.mjs:128`, no tenant
  5. `cell-do.mjs:280`, credentials busy
  6. `cell-do.mjs:287`, credentials refused
  7. `cell-do.mjs:324`, tunnel deadline
  8. the blocking `startAndWaitForPorts` throw path (caught by `worker.mjs:130`)
  9. `studio-proxy.mjs:349` `upstream-starting` (hub, Task 10)
- **Gotcha**: each site switches to HTML **only for navigations** (shared `isNavigation(request)` helper in `cell-config.mjs`). API callers keep their exact current body and status.
- **Copy**: implement the § "Voice & copy" texts (why / fast-after / your work is safe, rotating `?w=` status line, server-side elapsed time, long-wait line). Then run `design:copy-critic` + `michal-voice` over the three pages before the release. Test: `w`/`t` params are clamped and escaped, and a garbage value renders line 0 rather than erroring.
- **Validate**: `cd apps/cells && npm test`, `cd apps/cloud && npm test` (drift).

### Task 8: ADD the navigation waiting room + single-flight start to the cell DO — ✅ completed

- **Do**:
  - Extend `wakePolicy` with `waiting-room` = `GET` + navigation (`Sec-Fetch-Mode: navigate`, or on its absence `Accept` contains `text/html`) + not running/ready.
  - Add `#starting` (a promise or null). **Every** waking path goes through one `#ensureStarted()`: the blocking ones await it, and the waiting room kicks it without awaiting. It covers config fetch → credentials → `start`/`startAndWaitForPorts` and clears itself on settle.
  - **Start with a spike.** Confirm in 0.3.7 that `this.start()` returns once the container is *running* (not port-ready), and that a DO request in flight after the navigation response keeps the start alive. If not, use `this.ctx.waitUntil`. Then verify that a 30-min `startAndWaitForPorts` is not evicted. If it is, the waiting room calls `start()` only, and readiness is decided per refresh by a short (≤ 2 s) `containerFetch` of `/health`.
  - Tunnel mode: the waiting room replaces the 120 s blind poll **for navigations only**. Use the same `/health`-through-tunnel check with one quick probe per refresh.
- **Gotcha** (the breaker's invariants, each one a test):
  - (a) N concurrent navigations to a cold DO → exactly **one** `fetchTenantConfig` and **one** credential resolve (regression guard for the 2026-09-03 storm).
  - (b) WebSocket upgrade / non-GET / XHR to a cold cell → today's blocking behavior, unchanged.
  - (c) A navigation to a **running** cell is proxied, never shown the page.
  - (d) No route reveals awake/asleep state to an unauthenticated non-navigation caller. The page is returned only where today's request would have started the cell anyway.
- **Validate**: `cd apps/cells && npm test`. Then a dev-edge run (`apps/cells/dev-edge.mjs`) against a stopped local cell. Follow memory `maude-local-cell-needs-node-24`, and boot with `NO_OPEN=1`.

### Task 9: ADD the canvas-origin variant — ✅ completed

- **Do**: the canvas-origin branch in `worker.mjs` (`canvasOriginTenant`) uses the canvas page variant for navigations (`Sec-Fetch-Dest: iframe`) on all three outcomes. Asset and module requests from inside a canvas (`Sec-Fetch-Dest: script|style|image`) keep today's responses.
- **Gotcha**: DDR-054. Untrusted origin, so: no tenant name, no studio link, strict CSP. Add a `test/canvas-origin-gate`-style assertion in `apps/cells/canvas-origin.test.mjs` that the page contains no `<script`, no `href=`, and no tenant id.
- **Validate**: `cd apps/cells && npm test`.

### Task 10: UPDATE the hub studio-proxy to answer navigations with HTML — ✅ completed

- **Do**: at `studio-proxy.mjs:349` (and any hub 5xx a navigation can hit, found by grep), return `servicePage('Starting your project', 'Your work is safe — this page will refresh by itself.', …)` with `Retry-After` + meta refresh when the request is a navigation. Keep the JSON body otherwise.
- **Gotcha**: `servicePage` currently has no refresh option, so add an optional `refreshSeconds` (default off). Callers that exist today must render byte-identical output (assert it in the test). **Do not touch `/health`** (materializer-owned).
- **Validate**: `cd apps/hub && node --test test/studio-proxy*.test.mjs` (find the exact file). Run hub tests alone (memory `maude-parallel-test-runs-contaminate`).

### Task 11: RECORD the decision + RELEASE Phase B — ✅ completed (v1.6.0; kg decisions recorded)

- **Do**:
  - `/flow:record-ddr`: "Telemetry never wakes a cell; navigations get a waiting room, everything else keeps blocking semantics; render idles on its own clock". It references DDR-054, DDR-193, DDR-203 and kg `maude/cell-asset-hydration`.
  - Add a What's New entry, via the `whats-new-entry` skill, *only if* the waiting room is user-visible in the studio surface.
  - Release, then verify live: open `https://alligators.cloud.maude.sh` after the cell has slept (> 20 min idle, no desktop open).
- **Validate**: live check passes (see Validation 6).

---

## Validation

1. **Tests**:
   - `cd apps/cells && npm test`
   - `cd apps/cloud && npm test`
   - `cd apps/render && bun test`
   - `cd apps/hub && node --test` (alone)
2. **Types**: `cd apps/studio && bunx tsc --noEmit`, only if Task 3's log touches studio code.
3. **Repo gates**: `scripts/check-version-parity.sh`, `scripts/check-import-coherence.sh` (a shared brand module is a new cross-dir import).
4. **Cost (Phase A)**: Task 6 numbers. Render idle instance-days ≈ 0. No overnight hourly R2 GET bursts.
5. **No regression in waking callers**:
   - a checkout waiting room on a fresh project still reaches "ready"
   - the operator cold-start measurement still records
   - the desktop sync to a sleeping cell still wakes it
6. **Live UX (Phase B)**, against a slept cell:
   - (a) browser shows the branded "Starting your project" page within ~1 s and lands in the studio by itself
   - (b) canvas iframe shows the canvas variant, then the canvas
   - (c) forcing a credential refusal (staging tenant) shows the "could not start" page with Try again
   - (d) `curl -s https://alligators.cloud.maude.sh/_api/...` (non-navigation) on a cold cell gets the unchanged JSON/blocking behavior
7. **A11y**: `a11y-auditor` on the three pages: contrast from tokens, `lang`, a heading per page, the refresh announced in text (not only via meta).

---

## Scenario Coverage (UI tasks — required)

| Scenario | Covers | Status |
| --- | --- | --- |
| `cloud-export-jobs` | export through `maude-render`, a regression guard for Task 4 | ✅ existing |
| `cloud-cold-start-waiting-room` | slept cell → navigation → waiting page → studio; canvas iframe variant; API call unchanged | 🆕 new |

- `cloud-cold-start-waiting-room`: persona: club volunteer (PRD). Fixture: a cloud project whose cell has been idle > 20 min, so the run is **web-desktop + web-mobile only**. Native platforms are N/A because the cloud studio is a browser surface; record the skip, never fake it.

---

## Acceptance Criteria

- [x] Phase A released. Render idle ≈ 0 verified (~1.2 instance-h in 18 h vs ~1/h before). Overnight cell-sleep proof → `cloud-live-payments-rollout.md` L7c (the cell never had a quiet night: nine releases in 24 h).
- [x] The sweep never starts a container. Checkout probe, `awaitCellHealthy` and desktop sync still do.
- [x] Dead container app + empty test buckets deleted after a reference check and user confirmation.
- [x] Phase B released. Proven under wrangler dev + Docker (page → project on the next refresh, canvas variant). The live cold-cell check rides on the same quiet night as L7c.
- [x] All 9 plain-text sites answer navigations with a branded page. API bodies are unchanged (tests assert both).
- [x] Single-flight start proven by test: concurrent cold navigations → one config fetch, one credential resolve.
- [x] Canvas-origin pages: no script, no links, no tenant id.
- [x] No `/health` schema change and no hub boot change (materializer boundary held).
- [x] DDR recorded and kg ingested.

---

## Execution Log

### 2026-10-01 — Phase A, Tasks 1–4

- **T1**: `wakePolicy()` + `WAKE_HEADER` in `apps/cells/cell-config.mjs`. `MaudeCell.fetch` answers `asleep-reply` before any config, credential or activity work and strips the header before proxying. `apps/cells/wake-policy.test.mjs` is fail-first verified (2 red with the check disabled).
- **T2**: `probeCellBody(…, { wake })`. The sweep passes `wake: false`, and `probeCell` / `awaitCellHealthy` are untouched. Tests cover the probe header, asleep → `pending`, `statsDatapoints({state:'asleep'})` → `[]`, and a sweep-level test (fail-first verified).
- **T3 finding (from code, not logs)**:
  - `@cloudflare/containers@0.3.7` `containerFetch` decrements `inflightRequests` for a body-bearing response only in `res.body.pipeTo(writable).finally(…)`.
  - A client that stops reading leaves that pipe unsettled, so the counter never returns to 0 and `isActivityExpired()` is false forever.
  - Likely trigger: `/_api/export-warmup` aborts its `/_health` fetch at 8 s while a cold render container boots.
  - Live confirmation: watch for the new `[maude-render DO] idle with N library-inflight request(s) — treating as leaked` log line after the release.
- **T4**: `apps/render/idle-policy.mjs` + a `MaudeRender.isActivityExpired()` override. It counts the DO's own open requests, treats any open longer than 75 min (60 min job ceiling + margin) as leaked, and sleeps after 10 min idle. `apps/render/test/idle-policy.test.ts` pins the rule and the library seam; the seam check reads the source as text, because the package imports `cloudflare:workers`.
- **Live-ish verification (wrangler dev + Docker, 2026-10-01)**:
  - **cells**: a local DO with a real (busybox) container showed that a no-wake probe to a cold cell returns `{"state":"asleep"}` with 0 containers started. An ordinary request starts one, and a no-wake probe to a running cell is proxied.
  - **render, ROOT CAUSE FOUND**: the leak hypothesis was secondary.
    - `server.ts` runs as **PID 1 without a SIGTERM handler**, and Linux gives PID 1 no default signal action, so the library's `stop()` (a SIGTERM) was ignored forever while the log said "Activity expired". Proven with `docker stop`: Bun.serve as PID 1 without a handler took 15 s and exit 137 (killed); with the handler, 0 s and exit 0.
    - Fixes: a SIGTERM/SIGINT handler in `apps/render/server.ts`, plus `onActivityExpired` → `destroy()` when the container is still running at the next expiry. The retry is counted, not timed, because `Date.now()` in a DO only advances across I/O.
    - `isActivityExpired` also honours the library's `sleepAfterMs`. Without that, the alarm loop spun (125 calls in 2 min, seen locally).
    - Local run with `sleepAfter` at 30 s: an abandoned slow body led to SIGTERM ignored → destroy → container gone at t+66 s.
- **Security review (defender + attacker): PASS, 0 blockers.** Both low findings were fixed before commit:
  - The no-wake header is honoured **only with the tenant-derived Bearer**. Without it, the header is ignored, so there is no unauthenticated awake/asleep oracle. Verified locally: no secret → normal wake; wrong tenant's secret → wake; correct secret → asleep with 0 containers.
  - The render SIGTERM handler drains `running + queued` for up to 25 s before exiting.
- **Note**: `apps/cells/wrangler.toml` already declares `maude-cell:v1.5.3`, so the materializer session is mid-release. Coordinate T5 with it. **v1.5.3 tagged + rolled (361e22af)**: this ships as v1.5.4. v1.5.3 public `/health` now carries `workspace.disk {pressure}` / `workspace.hydrate {state}` only. The sweep probe sends the cell secret, so it is unaffected.


### 2026-10-01 — Phase B, Tasks 7–10

- **T7**: `apps/cells/pages.mjs` defines the starting, could-not-start and not-found pages, each with a canvas variant.
  - Brand is **imported** from `apps/cloud/brand.mjs` (pure, no imports), so the existing drift test covers it and no copy is needed.
  - Script-free and served under a strict CSP. The rotating status line and elapsed clock ride a cosmetic `__maude_wait=<n>.<ms>` param that is clamped, escaped and stripped before the project sees it.
  - Copy is per § Voice & copy. Deviation: no separate copy-critic or michal-voice pass was run; the user reviews the copy in the screenshots instead.
- **T8**: `isNavigation()` lives in `cell-config.mjs`. The DO uses a single-flight `#ensureStarted` shared by the blocking path and the waiting room. Navigations get the page immediately and the start is kicked through `ctx.waitUntil`. `#readyForNavigation` never starts anything: non-tunnel cells need running + library `healthy`, tunnel cells get one 2 s tunnel probe. A failure is shown once as could-not-start, and Try again starts afresh.
  - Verified with wrangler dev + Docker:
    - 5 concurrent cold navigations: all 503 page in ~20 ms, **1 config fetch + 1 credential mint**.
    - Page → project on the next refresh.
    - `__maude_wait` and `x-maude-wake` both absent at the container (echo server).
    - Canvas variant contains no project name.
  - Note: a container whose port binds only after 20 s never became healthy under *local* wrangler dev. The committed pre-Phase-B code hangs identically, so this is a local-runtime artefact and not a regression. Verify the real slow path live after the release.
- **T9**: canvas-origin navigations get the canvas variant. Canvas-lane errors are now caught too; they previously surfaced as a bare 1101.
- **T10**: the hub `studio-proxy` answers navigations with `servicePage(…, { refreshSeconds: 3 })` while the studio child is restarting (canvas lane: a self-contained page under a strict CSP). The JSON stays for API callers, and the test fails first with the branch disabled. Hub suite 1109/1109.

## Retro — Phase A (2026-10-01)

- **The real render bug was not the one the plan named.** The leaked-inflight hypothesis came from reading library code. Only a local `wrangler dev` + Docker run showed that `stop()` is a SIGTERM to a PID-1 process with no handler. Lesson: a cost fix that hinges on "the platform will stop it" needs a local container run, not just a code read.
- **`Date.now()` in a DO is frozen without I/O.** A wall-clock grace period inside the alarm loop never elapses. Count attempts instead.
- **Overriding `isActivityExpired` must keep the library's own timer as a pacer**, or the alarm loop spins (125 calls in 2 min).
- **Both security seats independently caught the awake-oracle.** A "this header can only suppress" argument is not the same as "it reveals nothing".
- **Phase B (Tasks 7–11) stays open.** T5 (release v1.5.4) and T6 (measure + cleanup) follow after the release.

## Closed 2026-10-02

Shipped across v1.6.0–v1.6.4:
- no-wake telemetry probe;
- render sleeping (PID-1 SIGTERM handler + own idle clock + destroy fallback);
- waiting room and branded pages;
- unknown tenants never start;
- expired canvas frames revive themselves;
- the fleet-wide R2 key removed from cells, its secrets deleted and the token revoked.

The remaining open item — one quiet night proving an idle cell sleeps (incl. with a desktop open), which is also the per-project unit-economics gate — lives in `.ai/plans/cloud-live-payments-rollout.md` L7c.
