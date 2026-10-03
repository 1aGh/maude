# Feature: A sleeping cell is not woken by crawler/scanner traffic

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports. Read the comments in `apps/cells/cell-do.mjs` in full before touching the wake path. Almost every line there records a named incident.

## Description

The no-wake telemetry probe and the render sleep fix (v1.6.0–v1.6.4, `archive/feature-cloud-cost-and-cold-start-ux.md`) got an idle cell sleeping. On the first quiet night (2026-10-02/03) the Alligators cell still woke every 1–2 h. Each wake ran ~20–40 min. Over 18 idle hours that came to ~7 instance-hours: **≈ $9/month for a project nobody touched**, on a €19 plan.

Workers Logs (`maude-cells`, 00:30–05:30Z) name the cause: **bots**.

- They send requests like `GET /wp-login.php`, `GET /<x>/wp-includes/wlwmanifest.xml` (×15 path variants), `/.git-credentials`, `/.env*` and `xmlrpc.php` to `alligators.cloud.maude.sh`.
- Every such request reaches the cell DO. On a sleeping cell the DO starts the container, which pays a boot and hydrate. The hub answers 404, and the container then idles for `sleepAfter = '20m'` before it sleeps again.
- Two or three probes an hour keep the cell awake most of the night.

What is *not* the cause:

- The hourly sweep's `/health` (2×/h at :00) carries `x-maude-wake: never` and no longer starts anything.
- The `POST /v1/manifest|state|blob` bursts are the container's own outbound calls to `project-store.internal` (user-agent `node`). They are a consequence of a wake, not a cause.

## User Story

As the operator paying for Maude Cloud, I want a project's container to start only for its people (members, their desktops, their invite and canvas links), never for internet background noise, so that an idle project costs ~$0 and the €19 plan keeps its margin.

## Problem

`MaudeCell.fetch` treats every request that is not a no-wake probe as a reason to start (`wakePolicy` → `block-and-start`). The cell has no notion of "this request could never be a member's", so drive-by scanning is billed as usage.

## Solution

**Approach (recommended, ships first): a scanner-path deny list, applied only to WAKING.**

1. A pure `isScannerProbe(url)` in `cell-config.mjs` matches a small, path-anchored set of patterns that no Maude route can ever serve:
   - `*.php` anywhere
   - `/wp-*` and `/<seg>/wp-*` (`wp-admin`, `wp-includes`, `wp-content`, `wp-login`)
   - `xmlrpc`
   - dotfiles at any depth that are credential or VCS stores: `/.env*`, `/.git/…`, `/.git-credentials*`, `/.aws/…`, `/.config/…`, `/.ssh/…`, `/.DS_Store`
   - `/cgi-bin/`, `/phpmyadmin`, `/vendor/phpunit`, `/actuator`, `/server-status`, `/boaform`, `/HNAP1`

   **Hard exemptions:** anything under `/_project-file/`, `/assets/`, `/.design/`, `/_canvas*`, `/_api/`, `/api/`, `/_ws`, `/health`. Tenant content lives there, and a project may legitimately contain any filename. A false positive there is a broken canvas, which is worse than a wake.
2. `wakePolicy` gains a fourth answer, `refuse-cold`. It applies **only when the container is not running**: `running !== true` **and** `isScannerProbe` **and** no explicit owner signal (no `authorization` header, no session cookie). It returns 404 (branded `notFoundPage` for navigations, plain text otherwise) without config fetch, credential mint, activity renewal or start.
3. **A running cell is untouched.** The probe is proxied to the hub exactly as today, and the hub 404s it as today. This keeps the existing invariant: the wake policy can only **suppress a start**, never change what a running project answers.
4. Telemetry: one `console.log('[cell] <tenant> refused cold wake for scanner path')` per refusal, deduplicated per DO per hour, so Workers Logs can count what we saved.

**Evaluated, deferred (approach 2): "only members wake a cell."** A sleeping cell would wake only for requests carrying one of these:
- a session cookie
- the desktop-sync bearer
- an invite token
- a canvas capability (`?t=` or the capability cookie)
- an OIDC callback

An anonymous navigation would get a worker-served sign-in hop. This saves more: it also covers bots that hit `/` or random paths, which is ~15 of the night's requests. But sign-in, OIDC and invite redemption live **in the hub** today (`browser-auth.mjs`, `auth-routes.mjs`, `join-page.mjs`), so the worker would have to either duplicate the cookie grammar or forward anonymous navigations anyway. **Decision: ship approach 1 now, measure, then decide approach 2** with numbers. It is recorded as Task 6 with the open questions written down rather than half-built.

## Metadata

- **Type**: Bug Fix (cost)
- **Complexity**: Low–Medium (one Worker, pure helper + one policy branch, tests, a release)
- **App/Package**: `apps/cells`
- **Affected Systems**: cell DO wake path, `maude-cells` release + fleet roll
- **Dependencies**: none new

---

## Context References

### Must-Read Files

> Read all of these in parallel in one message during `/flow:execute`.

- `apps/cells/cell-config.mjs`: `WAKE_HEADER`, `wakePolicy`, `isNavigation`, `canvasOriginTenant`, `isValidTenantId`. The new helper and policy branch live here, because this module is node-testable and `cell-do.mjs` is not.
- `apps/cells/cell-do.mjs`: `fetch()` (no-wake branch, navigation waiting room, `#ensureStarted`, `#readyForNavigation`, `#unknownTenant`). The new `refuse-cold` answer must be decided **before** any start-path work, next to `asleep-reply`.
- `apps/cells/pages.mjs`: `notFoundPage`, `htmlResponse` (canvas variant for the canvas origin).
- `apps/cells/wake-policy.test.mjs`, `apps/cells/pages.test.mjs`: the test style to extend.
- `apps/hub/src/server.mjs`, `studio-proxy.mjs`, `assets.mjs`, `file-manifest.mjs`: grep the real route prefixes before finalising the exemption list. **Any hub route that a pattern could match is a bug in the pattern.**
- `.ai/plans/cloud-live-payments-rollout.md` L7c: the unit-economics gate this feeds.

### Files to Create

- `apps/cells/scanner-probe.test.mjs`: pattern table. Each scanner path from the 2026-10-03 logs must be refused. Each legitimate path must stay allowed, including tenant files whose *names* look suspicious (e.g. `/_project-file/system/x/assets/index.php.svg`, `/.design/notes/.env-example.md`, `/assets/wp-logo.png`).

### Patterns to Follow

The no-wake probe (`cell-do.mjs`, top of `fetch`):

```js
const running = this.ctx.container?.running;
const policy = wakePolicy({ headers: request.headers, running, authorized: … });
if (policy === 'asleep-reply') {
  return Response.json({ state: 'asleep' }, { headers: { 'cache-control': 'no-store' } });
}
```

`refuse-cold` sits beside it, with the same placement and the same "decided before config/credentials/start" rule.

---

## Tasks

### Task 1: ADD `isScannerProbe(url)` to `cell-config.mjs`

- **Do**: Write it as a pure function over `URL` pathname, case-insensitive and percent-decoded once. Check the hard exemptions first, then the pattern list above, and keep the patterns as one readable regex table, each with a comment.
- **Gotcha**: Do not match on bare file *extensions* outside `.php`. Image and video names are tenant content.
- **Validate**: `cd apps/cells && npm test` (new `scanner-probe.test.mjs`).

### Task 2: ADD `refuse-cold` to `wakePolicy`

- **Do**: Add the new answer `wakePolicy({ headers, running, authorized, url })` → `'refuse-cold'` when `running !== true && isScannerProbe(url) && !hasOwnerSignal(headers)`. `hasOwnerSignal` returns true for an `authorization` header or a `cookie` header that names the hub's session or capability cookie (read the names from `apps/hub/src/browser-auth.mjs` / `studio-proxy.mjs`; do not guess). Running → `proxy`, unchanged.
- **Validate**: extend `wake-policy.test.mjs`:
  - a scanner path on a cold cell gets `refuse-cold`;
  - the same path on a running cell gets `proxy`;
  - a scanner path that carries an owner signal gets `block-and-start`;
  - a legitimate path on a cold cell gets `block-and-start`;
  - the no-wake probe is unchanged.

  Make it fail-first: revert the branch and watch the new cases go red.

### Task 3: WIRE it into `MaudeCell.fetch`

- **Do**: On `refuse-cold`, return `htmlResponse(notFoundPage({ canvas }), 404)` for navigations, otherwise `new Response('not found\n', { status: 404 })`. Add the deduplicated log line. Nothing else runs: no `fetchTenantConfig`, no credential resolve, no `renewActivityTimeout`, no `#ensureStarted`.
- **Validate**: run the `wrangler dev` + Docker rig from the prior plan (scratch `wrangler.toml` with a busybox container) to show:
  - a cold `GET /wp-login.php` gives 404 with **0 containers**;
  - a cold `GET /` starts the cell;
  - a scanner path on a running cell is proxied (the echo container sees it).

### Task 4: RELEASE + MEASURE

- **Do**: Coordinate with any other session before tagging (announce, stage only own files), then run the standard release (`.ai/release-guide.md`). After the first quiet night, re-run the GraphQL query (`containersUsageAdaptiveGroups` per hour for app `a03fc173-…`) plus the Workers Logs count of `refused cold wake`.
- **Target**: overnight cell instance-hours drop from ~0.4/h toward the residue of non-scanner wakes. Record before/after in `.ai/state/STATE.md` and in `cloud-live-payments-rollout.md` L7c.

### Task 5: RECORD the decision

- **Do**: `kg ingest` a decision that extends `maude/telemetry-no-wake-and-render-own-idle-clock`. The wake policy may refuse a cold start for scanner paths, never touches a running cell, and is exempt for tenant-content prefixes.

### Task 6: DECIDE approach 2 (members-only wake) from the Task 4 numbers

- **Do**: If the remaining overnight wakes are still mostly anonymous (`GET /`, random paths), write a short design note covering:
  - which hub cookies and bearers prove membership;
  - how an anonymous navigation reaches sign-in without waking (a worker-rendered sign-in hop vs the control plane's login);
  - how invite links and OIDC callbacks are exempt;
  - the security review it needs. A worker reading session cookies is a new trust surface (DDR-054 / DDR-193).

  Otherwise close it as not worth it.
- **Validate**: decision recorded either way.

---

## Validation

1. **Tests**: `cd apps/cells && npm test` (all green, new cases fail-first).
2. **Lint**: `npx biome check apps/cells`.
3. **Bundle**: `cd apps/cells && npx wrangler deploy --dry-run --outdir "$TMPDIR/cells"`.
4. **Live-ish**: the wrangler dev + Docker rig (Task 3).
5. **Live**: the overnight measurement (Task 4) after the release.

## Scenario Coverage

No UI change beyond reusing the existing `notFoundPage`. No new cross-platform scenario is needed; record that explicitly in the `/done` report.

## Risks

- **False positive on tenant content**, which would break a canvas. Mitigated by the prefix exemptions and by applying only to a cold cell: once a member has woken the cell, every path is proxied as before.
- **An owner who bookmarks a `.php`-looking URL** gets 404 on a cold cell, which they would get from the hub anyway.
- **A list that ages.** It is a cost optimisation, not a security control. A miss costs one wake, never correctness.

## Acceptance Criteria

- [x] A cold cell answers known scanner paths with 404 and starts nothing (rig-verified, 0 containers).
- [x] A running cell’s answers are byte-identical to today for every path (test plus rig).
- [x] Tenant-content prefixes are never refused (pattern-table test).
- [ ] Released, and one quiet night measured. Before/after recorded in STATE.md and L7c.
- [ ] Approach 2 decided with numbers (Task 6).
- [x] Decision recorded in kg.

---

## Execution Progress (2026-10-03)

- ✅ Task 1: `isScannerProbe` + `hasOwnerSignal` + `OWNER_COOKIES` in `cell-config.mjs`, with a pattern-table test (`scanner-probe.test.mjs`). **Deviation:** the exemption is `/_*` (every hub/studio internal route) instead of the listed `/_project-file/`, `/_canvas*`, `/_api/`, `/_ws`. It is a strict superset, so there is less false-positive risk, and no scanner in the logs used a `/_` path. The owner-cookie names are mirrored, not imported, because the Worker bundle cannot reach `apps/hub`. A test reads the hub source to pin them.
- ✅ Task 2: `wakePolicy(... url)` → `refuse-cold`. Fail-first was confirmed: with the branch removed, the cold-scanner case goes red. 86/86 green.
- ✅ Task 3: wired into `MaudeCell.fetch` next to `asleep-reply`, with a log line deduplicated per DO per hour that carries the count. Rig (`wrangler dev` + Docker, scratch `FROM scratch` Go echo hub plus a stub control plane, `CELL_ZONE=localhost`):
  - cold scanner paths gave 404 with **0 containers and 0 control-plane calls**, and the navigation got the branded "Nothing here" page;
  - cold `GET /` gave 200 and started 1 container (config and credentials fetched);
  - on a running cell, `/wp-login.php` and `/.env.prod` were proxied, and the echo hub logged both.
  - Rig gotcha: on this Mac, Docker Desktop's `docker-credential-desktop get` hangs (keychain prompt), which also hangs `wrangler dev`'s build. Workaround: a temporary `DOCKER_CONFIG` with `{}` plus a symlinked `cli-plugins`, so pulls go anonymous.
- ⏳ Task 4: release + overnight measure. Waiting on a release (coordinate the tag with other sessions).
- ✅ Task 5: decision `maude/cells-refuse-cold-wake-for-scanner-paths` ingested (`d_0147e0e0ee7973220e7cad79`), linked EXTENDS `maude/telemetry-no-wake-and-render-own-idle-clock`. That parent node was not found by `kg search` in this store, so the edge creates or attaches to it by name.
- ⏳ Task 6: blocked on the Task 4 numbers.
- `/done` (2026-10-03), first pass, with the plan left **open** for Tasks 4 and 6:
  - **Gates:**
    - cells 86/86 green, biome clean, wrangler dry-run OK, studio `tsc` + coverage OK, parity and tarball OK.
    - Pre-existing and unrelated: 8 `cli/commands/hub.test.mjs` and 10 studio sync real-hub tests fail on a `better-sqlite3` native-module ABI mismatch in this checkout. None of them touch `apps/cells`.
  - **Security review (defender + attacker): PASS WITH SUGGESTIONS, 0 blockers.**
    - Fixed: `refuse-cold` returns a plain `not found` (not `notFoundPage`, whose "no project here" copy is false for a sleeping project) with `cache-control: no-store`. The log line now carries `n=`.
    - Accepted, documented on `wakePolicy`: a low-severity awake/asleep oracle that does not wake the cell. Revisit with Task 6.
    - Report: `.ai/logs/security-reviews/2026-10-03-feature-cells-no-wake-for-scanners.md`, recorded in kg.
