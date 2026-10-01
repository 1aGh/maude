# Feature: Cell materializer — a cell's disk is a cache, not the project

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports. Read the prior decisions listed below **in full** (`kg search` / the DDR files) before touching serving semantics. This plan deliberately supersedes some of them.

## Description

A cloud cell (Cloudflare container `standard-1`: 4 GiB RAM, **8 GB ephemeral disk**, wiped on every container restart) currently has to hold the **entire** synced `.design/` on local disk. Every boot hydrates every bucket object back onto disk. Every read path (canvas iframe static route, `/assets/<key>`, `/_project-file/`, `/api/files` manifest, `/_asset-probe`) serves from disk only (DDR-226 §6).

A project bigger than the disk can therefore never be served. **Brno Alligators** (2026-10-01) syncs ~7.8 GB: 6.9 GB of mostly unreferenced raw photo libraries under `system/alligators/assets`, plus 0.9 GB of `assets/`. The user explicitly wants that data kept, synced and **not moved**. The restart loop:

1. `rehydrate.mjs` runs, then the hub binds.
2. Fire-and-forget hydrate downloads everything.
3. The desktop pushes on top of that (2 GiB/h quota).
4. The disk fills: ENOSPC.
5. There is no `unhandledRejection` / `uncaughtException` handler in `apps/hub`, so the process exits, then the container exits, then it cold starts.
6. Repeat.

Observed: hub uptime 14 → 4 → 5 min, a sample of 150 live rows going 142 present → 13 present across one restart, desktop `pushed 0`, and hundreds of 409/404s.

The fix ships in two phases:

- **Phase 0 (hotfix v1.5.3)** stops the loop and the v1.5.2 amplifier.
- **Phase 1 (the materializer)** turns the cell's disk into a bounded, disposable cache. Inert media lives in a content-addressed blob cache **outside the watched checkout**. A hub-owned materializer serves every read path from it, filling misses from R2 with sha256 verification against the journal.

## User Story

As a Maude Cloud user with a large design project, I want my cloud workspace to stay up and serve every canvas regardless of how many photos/videos the project holds, so that I don't have to prune or move my source material to fit a container disk.

## Problem

- The cell's disk is the **only** serving store, and boot tries to make it a full copy of a project that may be larger than the disk.
- No free-space awareness exists anywhere (no `statfs`, no ENOSPC handling). A full disk kills the process.
- v1.5.2's `reportLostFiles` marks every live row missing from disk as `disk-lost` **without asking the bucket**, and runs after a hydrate that may have died half-way. Desktops then re-push everything into the full disk. This amplifies the loop: the breaker seat flagged it as dangerous right now. Its log line ("missing from … the bucket") is false.
- Write-behind mirrors from disk, so any file that leaves the disk before `mirrored_at_ms` is stamped is lost (the v1.5.x credentials incident).

## Solution

### Phase 0 — stop the loop (hotfix v1.5.3, ship first, independently)

Consensus of all three seats.

1. **Crash handlers.** In `apps/hub`, add process-level `unhandledRejection` / `uncaughtException` handlers. ENOSPC / EDQUOT are logged loudly and the hub keeps serving (degraded). **EIO deliberately exits** (a wrong answer from the disk, not a full one: the write-behind re-reads disk bytes, so surviving EIO risks making a corrupt copy the durable one in the bucket). Every other error keeps today's behavior (exit) but logs first.
2. **Free-space gate on every write door.** Cover `file-door.mjs` PUT, `upload-sessions.mjs` part PUT + complete, and `/_asset-file` PUT. Below a floor (`statfs` free < max(1 GiB, 12 % of disk), env-overridable), answer **503 + `Retry-After`** with a `disk-pressure` reason.
   - The desktop already treats 503 + Retry-After as backpressure (`apps/studio/sync/file-plane.ts` `refusal()` → `isBackpressure`). Do **not** use 507: that is the hourly-quota word with its own UX.
3. **Budgeted hydrate.**
   - `hydrateFiles` / `hydrateAssets` run code-module + companion-text first, then inert-media.
   - Stop when free space hits the floor or a byte budget runs out.
   - Stream `hydrateAssets` via `getObjectToFile` (today it buffers whole objects in a 4 GiB box).
   - Record `{ restored, skippedForBudget, failed }`.
4. **`reportLostFiles` asks the bucket.**
   - Skip the whole pass if hydrate reported any failure or budget skip.
   - Otherwise only mark a row lost when (a) `mirrored_at_ms` is null **or** (b) `headObject` on its bucket key is 404.
   - Fix the false log line.
   - Add an env kill switch `MAUDE_REPORT_LOST=0`.
5. **`/health`.** Add `workspace.disk { totalBytes, freeBytes, floorBytes, pressure }` and `workspace.hydrate { state: 'running'|'done'|'budget'|'failed', restored, skipped, failed }`. Always present, not only on non-zero counts.

**Phase 0 does not make a 7.8 GB project servable.** It keeps the cell alive and stops data churn: media beyond the budget stays in the bucket and 404s on read, which is honest. Phase 1 makes it servable.

### Phase 1 — the materializer (chosen approach: "builder" seat, with the breaker's invariants)

**The rule:** on a cell, the journal says what exists and R2 holds the bytes. The local disk holds:

- the checkout for **code-module + companion-text** (small; Bun.build needs them on disk), and
- a disposable, budgeted **blob cache** for inert media.

#### Components

- **Blob cache, outside the watched tree.**
  - Location: `<designRoot>/_cache/blobs/<sha256>` (a new `_*` runtime path, registered in all four runtime-state lists + the hub mirror, per DDR-115).
  - Inert media on a cell is **never** materialized at its checkout path. The studio fs-watch never sees a cache file appear or disappear, so eviction cannot reach `recordGone` → tombstone → delete-on-every-desktop. This removes the breaker's top risk **by construction**.
- **Materializer**, hub-owned (`apps/hub/src/materializer.mjs`).
  - **Lookup.** `materialize(rel)` → live journal row (`latestFor`) → `sha256` → cache hit? Then return the path.
  - **Miss.** Single-flight per sha:
    - `getObjectToFile` from `<prefix>/assets/<name>` (content-addressed) or `<prefix>/files/<rel>` into a temp file.
    - Re-hash the temp file. Only if it equals the row's sha256, atomic-rename it into the cache.
    - Mismatch or not found → typed miss (404/503). **Never** stream bucket bytes straight to a client (`files/<rel>` is path-keyed and overwritten, so TOCTOU/substitution is possible; DDR-054).
  - **Deadline.** A fill deadline below the render service's 25 s per-resource timeout (default 15 s). A miss past the deadline → 503 + Retry-After, and the fill continues in the background.
- **Pin-until-mirrored.**
  - Uploads (file door, upload sessions, `/_asset-file`) land **in the cache, pinned**, not at the checkout path (inert media only).
  - Write-behind reads the pinned blob and unpins on `mirrored_at_ms`.
  - LRU evicts **only unpinned blobs whose row is mirrored**. Evicting unmirrored bytes is impossible by construction.
  - When pinned bytes alone exceed the budget, the write doors answer 503 backpressure (Phase 0 gate), never ENOSPC.
- **Eviction policy.**
  - High/low watermark with hysteresis (e.g. evict at 80 % of cache budget down to 60 %).
  - Minimum residency (e.g. 10 min) for freshly filled blobs, so a gallery canvas larger than the cache doesn't thrash.
  - Miss/eviction counters on `/health`.
- **Every read path goes through the materializer** on a cell:
  - The canvas-origin static route and the shell `/.design/…` route. These live in the studio child (`apps/studio/http.ts` static fall-through + the `/assets/` alias). On a disk miss for an inert-media path, the child calls a **loopback-only** hub endpoint `/_materialize?rel=` (hub-secret-authenticated, never in `CANVAS_SAFE_API`, never reachable from outside). It gets back the cache path and serves it with the same headers (nosniff, inert-SVG CSP, immutable only for content-addressed names).
  - `/assets/<key>` (`assets.mjs`): replace the buffered `getObject` bucket branch with materializer + streaming. The STORE DRIFT alarm is re-scoped to fire **only** on sha mismatch.
  - `/_project-file/` (`file-manifest.mjs`): serve from materializer (Range support over the cached file).
  - `/api/files` manifest: for inert-media rows, report the **journal** sha/size, never hash the disk (a partial checkout would otherwise read as regressions to peers).
  - `/_asset-probe`: present = journal-live and (mirrored or pinned).
- **Canvas build.** Code-module + companion-text stay real checkout files, hydrated at boot (bounded, first). For CSS `url()` → inert media, Bun.build's `onResolve` (`canvas-build.ts` ~315) awaits the materializer via the same loopback hop and returns the cache path. Alternatively mark the URL external so the browser fetches it through the read-through route. **Spike both in Task 9** and keep whichever passes `canvas-build` tests + a real Alligators canvas.
- **Journal semantics on a cell.**
  - `walkImport`, `recordGone` and `reportLostFiles` only consider code-module + companion-text checkout paths. For inert media, presence is the journal (+ bucket), not the disk.
  - `reportLostFiles` (Phase 0 version) is restricted further to rows that are live, unmirrored and not pinned.
- **Desktop / self-hosted hub.** Unchanged. The materializer is enabled only when the hub runs in cell mode with object storage (`MAUDE_CELL_MATERIALIZE=1`, set by `cell-config.mjs`). A self-hosted hub with a persistent disk keeps DDR-226 §6 behavior. The wire contract (journal rows, `/_project-file`, file door) is unchanged, so desktops need no release.
- **Migration.** The deploy is the migration: cell disk is ephemeral, the new image boots with an empty cache, and inert media is no longer hydrated at its checkout path. Existing checkout copies (from `rehydrate.mjs`'s git bundle) are left alone and served first. The materializer is the miss path.

#### Decisions this supersedes / amends (record in the DDR task)

- **Supersedes DDR-226 §6** ("checkout is the only thing that serves; R2 durability only"). On cells, R2 is the durable **serving** store for inert media, and the disk is a cache.
- **Supersedes "The cell refills its own checkout — hydration is a boot step"** (kg `maude/cell-asset-hydration`). Its premise, "boot is the only gap", is disproven by projects larger than the disk. It rejected lazy on-miss fetch; this re-admits it with sha verification.
- **Amends "Asset presence means BOTH stores"**. Presence = journal-live and (mirrored or pinned).
- **Amends DDR-224**. Bucket fallback is now normal operation on cells. The drift alarm fires only on sha mismatch.
- **Keeps DDR-195** (no presigned URLs, CSP `'self'`, content addressing, R2 egress $0) and **DDR-054** (hub semi-trusted, receivers re-hash, untrusted canvas origin) unchanged.

## Metadata

- **Ticket**: none (GitHub tracker; create an issue at PR time if wanted)
- **Type**: Bug Fix (Phase 0) + Enhancement / architecture change (Phase 1)
- **Complexity**: High
- **App/Package**: `apps/hub` (primary), `apps/studio` (static route + canvas build hop), `apps/cells` / `infra/cell` (env, entrypoint), runtime-state lists
- **Affected Systems**: cell boot, file plane serving, write doors, write-behind, journal reconcilers, canvas build on cells, `/health`
- **Dependencies**: none new (`node:fs` `statfs` is in Node ≥ 18.15; the hub runs Node 24)

---

## Context References

### Must-Read Files

> When consuming this section during `/flow:execute`, **read every file listed here in parallel in a single assistant message**.

- `apps/hub/src/asset-lane.mjs` (whole file). Hydrate (`hydrateAssets` ~345, `hydrateFiles` ~474), write-behind (`createWriteBehind` ~112), `writeBehindKey` / `fileRelFromKey` (~88-102), `containedReal` (~261).
- `apps/hub/src/server.mjs` (~3478-3600 boot chain; ~1036 canvas-host branch; ~1629-1670 studio proxy; ~2697-2730 `/health` workspace status; ~537-553 `noteCheckoutWrite`; ~3640 SIGTERM).
- `apps/hub/src/journal.mjs`. `recordGone` ~297, `recordLost` ~321, `recordWrite` ~343, `unmirrored` ~479, studio-report handler ~802, `reportLostFiles` ~1047, `walkImport` ~1070.
- `apps/hub/src/file-door.mjs`. PUT path, quota (~66-150), `currentHashFor` (~706), delete quarantine (~610-669).
- `apps/hub/src/upload-sessions.mjs`. Part + complete writes (~70-153).
- `apps/hub/src/assets.mjs`. `/assets/<key>` (~138-272), STORE DRIFT (~115-122), `/_asset-file` (~418-500), `/_asset-probe` (~553-618).
- `apps/hub/src/file-manifest.mjs`. `/api/files` (~142-275), `resolveCheckoutFileWrite` (~315), `/_project-file/` (~392-520).
- `apps/hub/src/s3.mjs`. `getObjectToFile` (~385), `headObject` (~428), `listObjects` (~452).
- `apps/hub/src/studio-proxy.mjs` (~421-600) and `apps/studio/http.ts`:
  - `/assets/` alias ~5701-5736
  - static fall-through ~5813-5860
  - `isCanvasSafeRoute` ~5935-6010
  - `CANVAS_SAFE_API`
- `apps/studio/canvas-build.ts`. CSS sources ~159-166, `onResolve` ~315-322.
- `apps/studio/sync/file-plane.ts`. `refusal()` ~810-856: how the desktop reads 503 / 507 / 429.
- `apps/studio/sync/decide-file.ts`. `remote-regressed` (~222): why a `disk-lost` row triggers a re-push.
- `infra/cell/entrypoint.sh`, `infra/cell/Dockerfile`, `apps/hub/src/rehydrate.mjs`, `apps/cells/cell-config.mjs` (env passed to the cell), `apps/cells/cell-do.mjs` (`portReadyTimeoutMS` ~241, `sleepAfter`).
- Runtime-state lists (DDR-115), all four plus the mirror:
  - `apps/studio/git/service.ts` `isMaudeRuntimeState`
  - `cli/lib/gitignore-block.mjs`
  - the repo `.gitignore`
  - `apps/studio/sync/file-membership.ts` `isRuntimeStateRel`
  - `apps/hub/src/file-membership.mjs`
  - tripwire `apps/studio/test/sync-file-membership.test.ts`
- `apps/hub/test/journal-write-door-tripwire.test.mjs`. Every new rename in the hub needs a journal hook or an allowlist entry with a reason.

### Prior decisions (read rationale in full: `kg search "<title>"`)

- DDR-226 Sync v2 (§2 journal truth, §6 checkout-only serving, §7 durable = `mirrored_at_ms`, §8 tombstones only / never unlink CAS, §9 DDR-054 unchanged).
- "The cell refills its own checkout from the bucket — hydration is a boot step" (`maude/cell-asset-hydration`).
- "Asset presence means BOTH stores — the bucket alone is not a servable answer".
- DDR-224 (checkout serves assets first; every write door mirrors).
- DDR-195 (cell = server minus routes + content-addressed assets; no presigned URLs).
- DDR-199 (cells on Cloudflare; `/health` reports boot).
- DDR-239 (8.8 GB project → zero files moved, 30 container starts in 10 s).
- DDR-054 (hub semi-trusted; untrusted canvas origin).
- kg `maude/hub-disk-lost-rows-and-per-pass-credentials` (v1.5.2: what `reportLostFiles` does today).

### Files to Create

- `apps/hub/src/disk.mjs`: `diskStatus(path)` via `fs.statfs`, `floorBytes(env, total)`, `isUnderPressure()`. Cached ≤ 2 s.
- `apps/hub/src/materializer.mjs`: blob cache + single-flight fill + verify + pin/unpin + LRU/watermarks + counters.
- `apps/hub/test/disk-gate.test.mjs`, `apps/hub/test/materializer.test.mjs`, `apps/hub/test/cell-boot-budget.test.mjs`.
- `.ai/archive/decisions/DDR-<next>-cell-disk-is-a-cache.md`, then `maude kg import`.

### Patterns to Follow

- Streaming + cap: `getObjectToFile` (`s3.mjs` ~385) already removes partial files on error.
- Never-throw lanes that report: `hydrateFiles` returns `{ restored, present, failed }` and catches per item. Keep that shape and extend it.
- Resolvers instead of boot snapshots: `createWriteBehind({ s3: () => s3Source.config() })` (v1.5.2). The materializer takes the same resolver.
- Typed refusals the desktop understands: 503 + `Retry-After` = backpressure (`file-plane.ts` `isBackpressure`); 507 = quota only.
- Containment: `resolveCheckoutFileWrite`, `containedReal` / `isContainedReal` (`path-contain.mjs`). A bucket key never becomes a path except through these.

---

## Tasks

Execute in order. Each task is atomic and testable. **Phase 0 (Tasks 1-6) is releasable on its own as v1.5.3. Ship it before starting Phase 1.**

### Phase 0 — hotfix

### Task 1: CREATE `apps/hub/src/disk.mjs` + crash handlers — ✅ completed

- **Do**:
  - `diskStatus(dir)` → `{ totalBytes, freeBytes }` via `fs.promises.statfs` (bsize × blocks / bavail), cached ≤ 2 s.
  - `floorBytes(env, total)`: `MAUDE_DISK_FLOOR_BYTES` or max(1 GiB, 12 % of total).
  - `underPressure(dir)`.
  - In `server.mjs` `runAsMain`, install `process.on('unhandledRejection'|'uncaughtException')`:
    - `code` ENOSPC / EDQUOT → `console.error('[hub] DISK …')`, set a `degraded.disk` flag, **do not exit**;
    - EIO → exit like any other error (see Solution §1; agreed with the plan author 2026-10-01);
    - anything else → log the stack, then exit 1 (today's behavior, now with a log).
- **Gotcha**: don't swallow everything. A corrupt-state error must still restart the cell. Handlers are installed only in `runAsMain`, not in `createHub` (tests import it).
- **Validate**: `cd apps/hub && node --test test/disk-gate.test.mjs`. Cover: an injected statfs gives pressure true/false; an ENOSPC rejection does not exit (child-process test).

### Task 2: ADD the free-space gate to every write door — ✅ completed

- **Do**: Before accepting bytes in `file-door.mjs` PUT, `upload-sessions.mjs` part PUT + complete, and the `/_asset-file` PUT forward, check `underPressure(designRoot)`. If true → 503, `Retry-After: 120`, body `{ error: 'disk-pressure', freeBytes, floorBytes }`.
- **Gotcha**: check **before** streaming the body (the pre-CAS position at `file-door.mjs` ~404). A gate after the body is ENOSPC with extra steps. Reads and DELETEs are not gated.
- **Validate**: `node --test test/file-door.test.mjs test/upload-sessions.test.mjs test/disk-gate.test.mjs`. New test: pressure → 503 + Retry-After and nothing written. Also a studio test that `file-plane.ts` `refusal()` classifies it `rateLimited` (not conflict): `cd apps/studio && bun test test/sync-file-plane*.test.ts`.

### Task 3: UPDATE hydrate — order, byte budget, floor, streaming — ✅ completed

- **Do**: In `asset-lane.mjs`:
  - `hydrateFiles` sorts work code-module → companion-text → inert-media (classifier from `file-membership.mjs`).
  - Both hydrators stop when `underPressure` or when `MAUDE_HYDRATE_BUDGET_BYTES` (default 50 % of disk) is spent.
  - `hydrateAssets` switches from buffered `getObject` to `getObjectToFile` with `maxBytes`.
  - Results gain `skippedForBudget`.
- **Pattern**: keep never-throw / never-overwrite / key-never-becomes-path (the existing `asset-hydrate.test.mjs` cases must stay green).
- **Validate**: `node --test test/asset-hydrate.test.mjs`. New cases: the budget stops before inert media; code files restore first; streaming keeps memory flat (assert `getObjectToFile` is used).

### Task 4: FIX `reportLostFiles` — ask the bucket, never after a partial hydrate — ✅ completed

- **Do**:
  - `reportLostFiles({ journal, designRoot, hydrate, s3, log })`. Return `{ lost: 0, skipped: 'hydrate-incomplete' }` when `hydrate.failed + hydrate.skippedForBudget > 0`.
  - Otherwise, per candidate row: lost only if `mirrored_at_ms` is null **or** `headObject(writeBehindKey(rel))` → 404.
  - Honour `MAUDE_REPORT_LOST=0`.
  - Correct the log line.
  - In `server.mjs`, pass the hydrate result + s3 resolver.
- **Gotcha**: `headObject` per row can be thousands of calls. Bound concurrency (8) and stop on the first credential error (skip the pass, don't mark).
- **Validate**: `node --test test/journal.test.mjs test/file-door.test.mjs`. New cases: partial hydrate → nothing marked; mirrored + bucket 200 → not marked; unmirrored → marked; bucket 404 → marked.

### Task 5: ADD `/health` disk + hydrate fields — ✅ completed

- **Do**: `bootReport.hydrate` is set at start (`running`) and at the end (`done|budget|failed` + counts). `workspace.disk` comes from `diskStatus` at request time. Always present on a workspace-mode hub.
- **Validate**: `node --test test/server*.test.mjs` (find the `/health` workspace test). New assertion: fields present with no counts.

### Task 6: RELEASE v1.5.3 + live verification on Alligators — ✅ completed

- **Do**:
  - Release per `.ai/release-guide.md` (changeset patch).
  - After the fleet rolls, watch `https://alligators.cloud.maude.sh/health` for 30 min. The **public** payload carries only `disk.pressure` and `hydrate.state`. Bytes and counts need `Authorization: Bearer <cell secret>`. The cell secret is `HUB_SECRET` in the cell's env, derived by `deriveSecret(CELL_SECRET_MASTER, tenantId)` (`apps/cells/cell-config.mjs`). On a self-hosted hub (design.studyfi.com) it is `HUB_SECRET` in `/opt/maude-hub/.env`. `uptimeMs` must increase monotonically (no restarts), `disk.pressure` must eventually be false, and `hydrate.state` must be `budget` or `done`.
  - Desktop `~/Maude/alligators/.design/_sync.json` should show pushes progressing or `paused` with backpressure, not a growing `conflicts`.
  - Also upgrade design.studyfi.com (SSM procedure, checkpoint `pre-v1.5.3-*`).
- **Validate**: the health samples are recorded in STATE.md.

### Phase 0.5 — desktop conflict storm (separate fix, before Phase 1)

### Task 6b: FIX the desktop file-plane conflict loop — ✅ completed

Reported by the plan author (2026-10-01): on Alligators the desktop `conflicts` count grew 43 → 135 in 10 min (1602 by 15:25Z). Every push came back 409 "the hub changed this file while the upload was in flight". The desktop's file-ledger cursor for the hub was stuck at 294 (epoch `9b976739`, hub head ~4875), and the worker tail showed repeated `GET /api/journal?since=0`.

- **Hypothesis:**
  - The desktop never commits its cursor, so it decides against stale remote state, and the hub's hydrate / `disk-lost` rows bump the current hash in between.
  - The 409 path sets `conflict` even when `body.current` equals the local hash. That case should **adopt**, not conflict.
- **Where:** `apps/studio/sync/file-plane.ts` (409 handling), `apps/studio/sync/file-ledger.ts` (cursor commit).
- **Also check:** budget-skipped media (404 on pull until Phase 1) must back off, never feed the conflict path.
- **Before anything empties `_trash`:** some conflict copies went to `_trash` as "older copy". Verify whether they are the user's originals.
- Run `/flow:bug-rca` first. Phase 1 does not fix this.

### Phase 1 — materializer

### Task 7: REGISTER the `_cache/` runtime path (DDR-115, all four lists + mirror) — ✅ completed

- **Do**: Add `_cache` to:
  - `isMaudeRuntimeState` (`apps/studio/git/service.ts`)
  - `cli/lib/gitignore-block.mjs`
  - the repo `.gitignore`
  - `isRuntimeStateRel` in `apps/studio/sync/file-membership.ts` **and** the byte-identical `apps/hub/src/file-membership.mjs`

  Extend the fixture in `apps/studio/test/sync-file-membership.test.ts`.
- **Gotcha**: a runtime path that leaks into the file plane would **sync to peers**. The tripwire test must cover `_cache/blobs/<sha>`.
- **Validate**: `cd apps/studio && bun test test/sync-file-membership.test.ts` and `cd apps/hub && node --test test/file-membership*.test.mjs`.

### Task 8: CREATE `apps/hub/src/materializer.mjs` — ✅ completed

- **Budget (Phase 0 lesson):** do not take a fixed 50 %. Compute it from `disk.mjs`, the same way as the hydrate headroom: `cacheBudget = min(MAUDE_CACHE_BUDGET_BYTES, total − 2×floor − checkoutBytes)`, and run the eviction watermarks against that. Otherwise a full cache closes the write doors exactly as an unbounded hydrate would have.
- **Do**: `createMaterializer({ designRoot, journal, s3 /*resolver*/, budgetBytes, deadlineMs, log })` with:
  - `materialize(rel) → { path, sha, size } | { miss: 'absent'|'unmirrored'|'mismatch'|'timeout' }`
  - `pin(sha, file)` (adopt an upload) and `unpin(sha)`
  - `evict()` (watermarks, min residency, only unpinned + row mirrored)
  - `stats()` (`hits`, `misses`, `fills`, `evictions`, `bytes`, `pinnedBytes`)
- **Fill**:
  - Use `getObjectToFile` into `_cache/tmp/<rand>`, then `sha256File`.
  - Equal to the row's sha → `rename` into `_cache/blobs/<sha>`. Unequal → delete + `mismatch` + loud log.
  - Single-flight map keyed by sha. Deadline via `AbortSignal.timeout`, and the fill continues past the deadline for the next caller.
  - Index persisted in `/data/materializer.json` (sha → `{ size, lastAccess, pinned }`), rebuilt from a dir scan when missing.
- **Gotcha**:
  - The cache `rename` must be allowlisted in `journal-write-door-tripwire.test.mjs` with the reason "content-addressed cache, outside the file plane, never journaled".
  - Never derive a cache path from a bucket key, only from a verified sha (hex-validated).
- **Validate**: `node --test test/materializer.test.mjs`. Cases:
  - hit
  - miss → fill → verify
  - sha mismatch → no file + `mismatch`
  - concurrent misses → one GET
  - timeout → fill completes for the next caller
  - eviction skips pinned and unmirrored blobs
  - hysteresis + min residency
  - hostile sha / rel never escape `_cache/`

### Task 9: SPIKE — canvas build with CSS `url()` → inert media on a miss — ✅ completed

- **Do**: Prototype both options against a fixture where a canvas CSS references `system/x/assets/photo.jpg` that is **not** on disk:
  - (a) `onResolve` in `canvas-build.ts` awaits `GET /_materialize?rel=` on the loopback hub and returns the cache path;
  - (b) mark the URL external so the browser requests `/.design/system/x/assets/photo.jpg` through the read-through route.

  Pick the one that keeps `test/canvas-build*.test.ts` green and renders a real Alligators canvas. Write the choice into the DDR.
- **Validate**: `cd apps/studio && bun test test/canvas-build.test.ts test/canvas-lib-graph.test.ts`.

### Task 10: ADD loopback `/_materialize` + route the studio static reads through it — ✅ completed

- **Do**:
  - **Hub side.** Add `GET /_materialize?rel=`, accepted only from the studio child: loopback + the pairing secret header. It is **not** in `CANVAS_SAFE_API`, not in `startCanvasServer` routes, and not reachable via studio-proxy. It returns `{ path }`, or 404 / 503 + Retry-After.
  - **Studio side.** In the static fall-through (`http.ts` ~5813-5860) and the `/assets/` alias (~5701-5736), when `MAUDE_CELL_MATERIALIZE=1` and the file is absent and the path classifies inert-media, call the hop and serve the returned cache path with the **same** headers as today (nosniff, inert-SVG CSP, immutable only for content-addressed names). Range is supported via `serveMediaFile`.
- **Gotcha**:
  - The studio must re-check that the returned path is contained under `<designRoot>/_cache/blobs/` (`isContainedReal`). The hub is semi-trusted (DDR-054).
  - Add a `GET → 405` / not-routable assertion for `/_materialize` from the canvas origin in `test/canvas-origin-gate.test.ts`.
- **Validate**: `bun test test/canvas-origin-gate.test.ts test/canvas-route.test.ts` plus a new `test/cell-materialize-route.test.ts`.

### Task 11: UPDATE the hub read paths — `/assets/<key>`, `/_project-file/`, `/api/files`, `/_asset-probe` — ✅ completed

- **Do** (cell mode only):
  - `/assets/<key>`: checkout first, then materializer, streamed. Remove the buffered `getObject` branch. Re-scope the STORE DRIFT alarm to sha mismatch only.
  - `/_project-file/`: on a disk miss for inert media, serve the materialized path (keep Range).
  - `/api/files`: inert-media rows report journal sha/size, without a disk hash.
  - `/_asset-probe`: present = journal-live and (mirrored or pinned).
- **Gotcha**: update the pinned tests deliberately. Each change of expectation gets a one-line comment naming the DDR.
  - `assets.test.mjs` :263-330
  - `asset-probe.test.mjs` :94-153 (`bucket-only asset is ABSENT` becomes `present when mirrored` **on cells**; keep the old assertion for non-cell mode)
- **Validate**: `node --test test/assets.test.mjs test/asset-probe.test.mjs test/file-manifest*.test.mjs`.

### Task 12: UPDATE the write doors — inert-media uploads land pinned in the cache — ✅ completed

- **Do** (cell mode):
  - `file-door.mjs` PUT, `upload-sessions` complete and `/_asset-file` PUT, for inert-media classes: after the streamed hash verifies, rename into `_cache/blobs/<sha>` (pinned) instead of the checkout path. Then `journal.recordWrite` with the **verified** sha. This needs a `recordWrite` variant that takes a verified `{ sha256, size }` from the door, because the disk path is absent; it is still never caller-supplied over HTTP.
  - Write-behind reads the pinned blob and calls `unpin(sha)` after stamping `mirrored_at_ms`.
  - Code-module / companion-text keep landing in the checkout as today. **Add a per-class size cap for these at the write door** (e.g. 5 MB, env-tunable). They stay on the checkout, so pin/evict never bounds them. This closes the Phase 0 residual where one token spends the hydrate budget on large companion-text files.
- **Gotcha**:
  - This is the delicate one: the CAS (`currentHashFor`) is unchanged, but `recordWrite`'s "the hub reads its own disk" invariant gets a sibling. Document it in the DDR and add the tripwire hook.
  - Delete of an evicted / cache-only row: quarantine has nothing to move. Write a bucket quarantine copy (`<prefix>/trash/<ts>/<rel>`) **before** the tombstone, so §8 "never unlink CAS / recoverable" still holds.
- **Validate**: `node --test test/file-door.test.mjs test/upload-sessions.test.mjs test/workspace-agent.test.mjs test/large-media.test.mjs test/journal-write-door-tripwire.test.mjs`.

### Task 13: UPDATE boot + reconcilers for cell mode — ✅ completed

- **Do**: When `MAUDE_CELL_MATERIALIZE=1`:
  - Boot hydrate restores code-module + companion-text, then **`assets/` as a second tier while it fits under the budget**. These are the content-addressed media that canvases actually reference, so restoring them avoids a burst of misses on first open. `files/` inert media goes only to the materializer. Task 3's budget and headroom still apply.
  - `walkImport` / `recordGone` / `reportLostFiles` ignore inert-media checkout paths. Presence comes from the journal.
  - The studio-report path (`journal.mjs` ~802) never tombstones an inert-media row because the disk lacks it.
  - `cell-config.mjs` sets `MAUDE_CELL_MATERIALIZE=1` + `MAUDE_CACHE_BUDGET_BYTES` (default 50 % of disk).
- **Gotcha**: this is the guard against the breaker's top risk. Add a test that unlinking an inert-media checkout path and sending a studio report produces **no** `deleted=1` row in cell mode.
- **Validate**: `node --test test/journal.test.mjs test/cell-boot-budget.test.mjs` plus `cd apps/cells && node --test cell-config.test.mjs`.

### Task 14: RECORD the DDR + kg import — ✅ completed

- **Do**: Write `.ai/archive/decisions/DDR-<next>-cell-disk-is-a-cache.md`:
  - the incident and its numbers;
  - the rule;
  - supersedes / amends (as listed in Solution);
  - the rejected alternatives with reasons:
    - bigger instance type: fleet-wide cost, still bounded;
    - per-project "durable, not hydrated" glob: admission fix, user wants data servable, still bounded by referenced media;
    - read-through only on `/assets`: doesn't cover `/.design/...` paths canvases use;
    - eviction at the checkout path: the tombstone hazard;
  - the Task 9 choice.

  Then run `maude kg import --dry-run` followed by `maude kg import`.
- **Validate**: `kg search "cell disk is a cache"` returns it.

### Task 15: E2E — two-direction sync against an over-disk fixture — ✅ completed

- **Do**:
  - Run a local cell harness (memory: hub needs Node 24; boot with `NO_OPEN=1`) with an artificially small disk (`MAUDE_DISK_FLOOR_BYTES` / budget set so a ~2 GB fixture exceeds it) and a MinIO / file target for R2.
  - Push from a desktop studio and pull to a second one, in **both directions** (memory: sync asymmetry).
  - Restart the hub mid-push.
  - Assert:
    - no restart loop;
    - every canvas builds, including CSS `url()` media;
    - no tombstones;
    - zero 409 storms;
    - cache stays under budget;
    - evicted media re-materializes.
- **Validate**: script under `apps/hub/test/e2e/` or `scripts/dev/`, plus a captured report in `.ai/logs/`.

### Task 16: RELEASE + live verification on Alligators

- **Do**:
  - Release (minor: architecture change).
  - Verify `alligators.cloud.maude.sh`:
    - `/health` cache stats;
    - stable uptime > 2 h;
    - `PPF-vystroj-U19` and `alligators-moodboard-v3` render with photos/fonts (ask the user to confirm in the browser);
    - the desktop sync converges (`_sync.json` remaining → 0 except the one 466 MB over-limit file).
  - design.studyfi.com upgrade.

---

## Validation

1. **Lint**: `pnpm lint` (biome)
2. **Types**: `cd apps/studio && bunx tsc --noEmit && cd ../.. && scripts/check-tsc-coverage.sh`
3. **Tests**:
   - `cd apps/hub && pnpm test` (whole suite)
   - `cd apps/studio && bun test test/sync-*.test.ts test/canvas-*.test.ts` run **alone** (memory: parallel runs contaminate)
   - `git status apps/studio/dist/` before and after each studio test run
4. **Build**: `cd apps/studio && MAUDE_SKIP_RUNTIME_BUILD=1 bun run build.ts --release` (release minified, never a dev boot from this tree)
5. **Regression tests must fail first** (memory): for each new guard (disk gate, `reportLostFiles` bucket check, no-tombstone-on-eviction, sha mismatch refusal), revert the fix and watch the test go red.
6. **Live**: Task 6 + Task 16 health watches; the render export of an Alligators canvas through `maude-render` (memory: the render version string ≠ the running image; a real export proves it).

## Scenario Coverage

Not a UI feature. Coverage is the hub/studio test suites + the Task 15 e2e harness + the live Alligators verification. No `.ai/scenarios/` entry required.

## Acceptance Criteria

- [ ] Phase 0 released as v1.5.3. Alligators hub uptime is monotonic for ≥ 30 min after the rollout and `/health` shows `disk` + `hydrate`.
- [ ] `reportLostFiles` never marks a row whose bytes are in the bucket, and never runs after a partial hydrate.
- [ ] A full disk produces 503 + Retry-After on writes, never a process exit.
- [ ] Phase 1: on a cell, the checkout holds no inert media written after boot. The cache stays ≤ budget. Eviction produces no journal rows.
- [ ] Every read path (canvas static, `/assets`, `/_project-file`, `/api/files`, `/_asset-probe`, canvas build CSS `url()`) works with media absent from disk.
- [ ] Bucket bytes reach a client only after sha256 verification against the journal row.
- [ ] Self-hosted hub / desktop behavior is unchanged (cell mode is off).
- [ ] DDR recorded and kg imported. Superseded decisions are linked.
- [ ] `/flow:validate` passes. Security review covers `/_materialize` (loopback + secret only) and cache-path containment.

## Execution Log

**2026-10-01: Phase 0, Tasks 1–5 done** (uncommitted; Task 6, the release, waits for an explicit go).

- Verify: hub `npm test` 1082/1082; studio `sync-file-plane*.test.ts` 100/100 (`dist/` untouched); biome is clean on the touched files.
- Fail-first was checked by reverting each fix. Without the gates, the disk-gate tests fail (file door + upload session). Without the `reportLostFiles` change, 5 of 7 new cases fail. The other two (404 → lost, never-mirrored → lost) are behavior the old code already had.
- **Deviation: floor formula.** The plan said max(1 GiB, 12 %). The first real-disk run refused every file-door write on a 460 GB laptop with 40 GB free (12 % = 55 GB). The shipped formula is max(1 GiB, min(12 %, 4 GiB)). A cell is unchanged: on 8 GB, 1 GiB wins. Self-hosted hubs and laptops no longer trip the gate.
- `/_asset-file` PUT is gated by being delegated to the file door (`server.mjs` ~1098), so no separate hook was needed.
- `hydrateFiles` now runs **before** `hydrateAssets`, sharing one budget, so code and companion text are restored ahead of any media. `hydrateFiles` gained a `classes` filter for Task 13.
- `reportLostFiles` is now async. Its two test call sites were updated.
- The desktop needs no change. A new studio test pins that a `503 disk-pressure` PUT reads as `rateLimited`, never as a conflict.


**2026-10-01: `/flow:done` security pass on Phase 0.** Defender: PASS WITH SUGGESTIONS. Attacker: NEEDS FIXES. All fixes landed before commit; full table in `.ai/logs/security-reviews/cell-materializer-phase0.md` (local).

- **Hydrate stops above the floor.** The budget is `min(configured, free − 2×floor)`, and `admit` reads the disk fresh before each download. Stopping *at* the floor would have ended every floor-stopped boot with the write doors shut.
- **Boot order changed.** It is now `files/` code + companion text, then `assets/`, then `files/` inert media. The first cut put Alligators' 6.9 GB of unreferenced photos ahead of the 0.9 GB `assets/` that canvases show.
- **Deviation: EIO is no longer survived.** The crash handlers survive only ENOSPC/EDQUOT; EIO exits, so a faulty disk can't feed the write-behind.
- **Deviation: public `/health` shows state only.** It carries `disk.pressure` and `hydrate.state`. Bytes and counts need the cell secret. **For Task 6:** watch with `Authorization: Bearer <cell secret>` to see `freeBytes`.
- Permanent hydrate failures no longer count as a partial hydrate.
- The lost-file HEADs have a 15 s timeout.
- The temp file is unlinked before the hydrate writes it (symlink hole that predates Phase 0).
- **Residual for Phase 1:** one write token can still spend the hydrate budget with large companion-text uploads. Per-project eviction / pin is the real brake.

**2026-10-01: Task 6 done.** v1.5.3 was released, the fleet rolled, and design.studyfi.com was upgraded (checkpoint `/opt/maude-hub/pre-v1.5.3-20261001T152128Z`). Alligators ran 98 minutes on 1.5.3 with no restart; `disk.pressure` stayed false, and `hydrate` went from `running` to `budget`.

**2026-10-01: Phase 0.5 + Phase 1 done** (Tasks 6b–15; Task 16 is the joint release). Commits are `a7d72945`, `968ed092`, `6ee25698`, `3b71ab7b`, `690079ac`, `5e40bc17`, `f31c6823`, `e4322f2e`, `e299472b`, `a8b722bb`, `9e675253` and `001d3689`. Ownership: the plan author was taken off the work at the user's request, and Phase 0.5 was done here.

- **6b.** The desktop's conflicts came from three file-plane defects:
  - one journal page per pass;
  - `pruneRemotes` running after a truncated full read;
  - a 409 whose `current` equalled the local hash being treated as a conflict.

  The desktop's `_trash` held nothing from the storm. The 249 conflict rows were ledger bookkeeping only.
- **Task 9 picked option (b).** CSS `url()` is rewritten at load time onto the served design root. This also fixed a bug that predates Phase 1: large stylesheet images and fonts were never served.
- **Deviations from the plan, all recorded in DDR-243:**
  - The cache lives in `<DATA_DIR>/cache`, not `.design/_cache`. This came from the security review (H1).
  - Minimum residency is soft. The Task 15 E2E caught it answering 503 for every request while every blob was "fresh".
  - Pins are released by the journal.
  - Pinned bytes are capped at 50 % of the budget.
  - The cache budget is derived from the disk, with the same headroom as the hydrate.
  - `CELL_MATERIALIZE` is a per-tenant allowlist. The pilot is alligators.
- **Security pair:** defender and attacker both said NEEDS FIXES. Every finding was fixed in `001d3689`, each with a test that fails without its fix. One item was accepted: 409-adopt is not gated on the hub's mirror state.
- **E2E** (`scripts/dev/cell-materialize-e2e.ts`): 11 of 11 oracles passed, including a genuinely mid-push SIGKILL. Reports are in `.ai/logs/e2e/` (local only).
- **Gates:** lint, typecheck, parity, tarball, tokens, build and site-content are green. Hub tests: 1151/1151. Studio sync + canvas tests: 1296/1296. Cells: 74/74.
- **Residual risk:** media written inside a cell without going through a door or the studio's report path goes unjournaled, because walk-import ignores inert media on a cell.

