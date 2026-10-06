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
- [x] Released, and one quiet night measured. Before/after recorded in STATE.md and L7c.
- [x] Approach 2 decided with numbers (Task 6).
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
- ✅ Task 4: released in **v1.6.11** (2026-10-03). The cell rolled at 18:27Z. Night of 10-03/04 measured on 10-04:
  - **Instance-hours, 20:00–07:00Z** (`containersUsageAdaptiveGroups`, app `a03fc173-…`, Σ`allocatedMemory` / (4 GiB × 3600)): **3.07 the night before → 1.41**, about −54 %. The comparison is between two nights with different bot traffic, so treat the size of the drop as indicative.
  - **Wakes:** 6 hourly buckets with a running cell before, 4 after (21:28, 22:41, 02:28 and 07:15Z, each ~20 min, except 22:41 at ~49 min).
  - **Refused:** one scanner request on a cold cell (`GET /.env`, 03:44Z): 404, nothing started. That is one ~20-minute wake saved.
  - **Every remaining wake was anonymous `GET /`, and none was a member:**
    - 21:28, 02:28, 07:15 (and 11:39 the next day): Tencent Cloud (ASN 132203, JP/DE), a fake "iPhone iOS 13.2.3" UA with a Chromium-only `Accept` (`signed-exchange`), no cookie, and the waiting room's refresh never followed. A bot, not a person.
    - 22:41: a scanner sweep that opened with `GET /`, which woke the cell, then sent 100+ paths (`/.env*`, `/.git/*`, `/wp-*`, `/actuator/*`, GitLab API). All were proxied to the now-running hub (401), as designed.
  - The only member wake in the measured day was 15:31Z (`Bun` desktop sync with a bearer).
  - **The `n=` in the log line undercounts.** It logs at most once per DO per hour and reports the count accrued since the previous log line, which is lost when the DO is evicted. Count refusals from request logs (404 on the cell for a cold scanner path), not from that line.
- ✅ Task 5: decision `maude/cells-refuse-cold-wake-for-scanner-paths` ingested (`d_0147e0e0ee7973220e7cad79`), linked EXTENDS `maude/telemetry-no-wake-and-render-own-idle-clock`. That parent node was not found by `kg search` in this store, so the edge creates or attaches to it by name.
- ✅ Task 6: **decided: build approach 2 (members-only wake) as a follow-up.** Every remaining overnight wake was an anonymous `GET /`, which the scanner list cannot cover without refusing the project's own front door. Design note below.
- `/done` (2026-10-03), first pass, with the plan left **open** for Tasks 4 and 6:
  - **Gates:**
    - cells 86/86 green, biome clean, wrangler dry-run OK, studio `tsc` + coverage OK, parity and tarball OK.
    - Pre-existing and unrelated: 8 `cli/commands/hub.test.mjs` and 10 studio sync real-hub tests fail on a `better-sqlite3` native-module ABI mismatch in this checkout. None of them touch `apps/cells`.
  - **Security review (defender + attacker): PASS WITH SUGGESTIONS, 0 blockers.**
    - Fixed: `refuse-cold` returns a plain `not found` (not `notFoundPage`, whose "no project here" copy is false for a sleeping project) with `cache-control: no-store`. The log line now carries `n=`.
    - Accepted, documented on `wakePolicy`: a low-severity awake/asleep oracle that does not wake the cell. Revisit with Task 6.
    - Report: `.ai/logs/security-reviews/2026-10-03-feature-cells-no-wake-for-scanners.md`, recorded in kg.

## Task 6 design note: members-only wake (2026-10-04)

**Why.** After v1.6.11, 4 of 4 overnight wakes, plus one daytime wake, were anonymous navigations to `/`. At ~20 min each, that is the ~1.4 instance-hours/night left. One drive-by on `/` also lets a whole scanner sweep through while the cell is up.

**What proves membership (read from the hub, not guessed):**
- `maude_studio`, the browser session cookie (`browser-auth.mjs`, 12 h TTL, every door: sign-in, OIDC, cloud exchange, invite landing);
- `maude_canvas`, the canvas capability cookie (`studio-proxy.mjs`), and a `?t=` capability on canvas-origin URLs;
- `authorization: Bearer …` (desktop sync, the CLI, the operator sweep).

`hasOwnerSignal` already reads the first two and the bearer. Approach 2 reuses it as-is.

**Recommended shape: a click-through, not a worker sign-in.**
- An anonymous **navigation** to a cold cell, with no owner signal and outside the exempt prefixes, gets a worker-rendered page: "This project is asleep. [Open project]". The button is a same-origin form `POST` (or a `GET` with a one-shot `?wake=<nonce>` the DO minted), and that is what starts the cell.
- Bots that follow no forms or scripts never wake it.
- A member whose session cookie expired pays one click, then signs in at the hub exactly as today. **The worker never authenticates anyone** and never parses session contents; it only checks whether a cookie or header is present.
- **Exempt (always wake, as today):**
  - `/join/*` (invite links);
  - `/auth/*` (OIDC start and callback, sign-in);
  - `/invites/*`;
  - every `/_*` route;
  - `/api/*`, `/health`;
  - any request with an owner signal;
  - any non-navigation request. Scripts, sockets and sync keep the blocking path byte-for-byte.
- **A running cell is untouched.** This is the same invariant as `refuse-cold`: the policy can only suppress a start.

**Rejected:**
- A worker-rendered sign-in, which would duplicate the hub's cookie grammar, OIDC and invite logic in the Worker.
- Redirecting to the control plane's login, which knows accounts but not project membership, and adds a cross-origin hop to every cold open.

**Security review it needs (DDR-054 / DDR-193):**
- **Cookie presence is not authentication.** A bot that sends `cookie: maude_studio=x` still wakes the cell. That is acceptable: this is a cost control, and a wake reveals nothing the hub's own 401 does not.
- **Oracle.** The page tells an anonymous caller "a project exists here and is asleep". `refuse-cold` already accepted that low-severity awake/asleep oracle, so re-assess it here.
- **CSRF on the wake button.** A cross-site `POST` can only start a container. That is cost, not data. Use a nonce anyway, so a third-party page cannot keep a project awake.
- **The page's copy and caching.** `no-store`, no project name or tenant data on the page, and the branded `pages.mjs` style.

**Built 2026-10-04** without a separate plan (owner's call), with two additions from review: `?open=`/`?t=` deep links and websocket upgrades wake without the click, and a cross-site POST to `/_cell/wake` starts nothing. See STATE.md.

## Retro

- **The measurement paid for itself on the first night.** The scanner list removed the class it targeted (1 refusal, −54 % instance-hours). The same logs showed that the bigger remaining class, bots on `/`, was invisible from the 10-02/03 night's sample, because there the `.php`/`.env` paths dominated.
- **Log-line counters that reset on eviction are not metrics.** `n=` looked like a count and is not one. For anything we will measure, prefer counting from request logs, or emit one line per event and let Workers Logs aggregate.
- **Two sessions on one plan.** The first session shipped Tasks 1–3 and 5 plus a release. The second started re-implementing Task 1 from a stale untracked copy of the plan before checking `git log origin/main -- <files>`. CLAUDE.md already warns that "a plan's task list can lag reality". `/flow:execute` should run that check before the first edit, not only when resuming.
- **The self-host upgrade was blocked only on a missing local AWS profile.** Once it existed, the recorded SSM script (checkpoint, pull, stop, tarballs, up, health) ran unchanged for v1.6.11, with ~2 min of downtime.

## Close-out (2026-10-05)

- **Approach 2 shipped** in v1.6.12 as members-only wake (`6532c53c`, security fixes in-diff); design.studyfi.com upgraded to v1.6.11, then v1.6.12.
- **Night after v1.6.12: 10.55 instance-hours.** No bot kept the cell up. The owner's idle paired desktop did, by polling and holding sockets all night. That is a different cause with its own plan: `.ai/plans/feature-cells-idle-desktop-lets-cell-sleep.md` (in execution in another session).
- **Still open from this line of work:** the F1–F3 cost bypasses plus the canvas-origin wake seen at 05:39Z (spun off as a separate task), and a browser-tab park (deferred in the new plan).
- **L7c** stays open until a night with a desktop left open measures ~0.
