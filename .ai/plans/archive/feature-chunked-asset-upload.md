# Feature: chunked upload for the canvas media-drop asset route (Option C, issue #126)

Validate docs and codebase patterns before implementing. Pay attention to existing naming, utils, and imports.

> **Revision 2 (2026-10-07, review pass).** The first draft missed the cloud/hub
> layer, the desktop sync lane's own size caps, and where session temp state may
> live. Changes vs. r1 are called out inline as **[r2]**. Three choices are
> still open for the owner — see **Open decisions** before executing.

## Description

Issue #126 — a user can't drop a video onto the canvas once it exceeds 100 MB
(`ASSET_MAX_VIDEO_BYTES`, `apps/studio/api.ts:1121`). The owner chose
**Option C** from `.ai/plans/feature-video-asset-size-cap-decision.md`: raise the
*effective* file size without raising the per-request body ceiling that DDR-088
and DDR-148 set as the untrusted-canvas-origin (DDR-054) memory-amplification
defense. Each wire request carries one small, fixed-size chunk; only the
*reassembled* file ceiling goes up.

**[r2] Not "resumable".** r1's title promised resumable upload. Nothing here
survives a page reload — a failed chunk is retried, a lost session is swept.
True resume (persisted client state, `GET` of received indices) is out of scope.

## User Story

As someone editing video on the canvas, I want to drop a clip larger than
100 MB without it failing, so that I don't have to pre-compress every file or
discover an undocumented environment variable.

## Problem

`saveAssetFromStream` (`api.ts:2476`) streams ONE request body to a temp file,
sniffs the type from the head, enforces `ASSET_MAX_VIDEO_BYTES` and
`ASSET_SESSION_BUDGET`, then renames to `assets/<sha8>.<ext>`.
`MAX_REQUEST_BODY` (`server.ts:268`, `ASSET_MAX_VIDEO_BYTES + 8 MiB`) is Bun's
**global** `maxRequestBodySize` — raising the video cap raises how much any
route accepts pre-handler. That is why the cap can't simply move.

### Every place that must agree on the asset route

r1 listed the three studio client call sites. **[r2]** It missed four more
surfaces that key off the exact path `/_api/asset`:

| # | Surface | File | What it does with `/_api/asset` |
|---|---|---|---|
| 1 | Drag-drop / paste | `use-canvas-media-drop.tsx:172` `uploadAsset()` | POSTs the file |
| 2 | AssetPicker batch insert | `annotations-layer.tsx:1844,1918` | calls #1 |
| 3 | AssetPicker + native "Open file" | `client/app.jsx:1314` `uploadOne()` | its own duplicate POST |
| 4 | Canvas-origin allowlist | `http.ts:6118` `CANVAS_SAFE_API` + `server.ts:543` `routes` | DDR-088 dual list |
| 5 | **Hub role manifest** | `apps/hub/src/studio-manifest.mjs:128` | `'/_api/asset': { safe: 'read', unsafe: 'edit' }` — an unlisted path is **denied** in cloud |
| 6 | **Hub mirror trigger** | `apps/hub/src/studio-proxy.mjs:482` (shell door) + `:725` (canvas door) | fires `onAssetWritten()` only when `pathname === '/_api/asset'` → a chunked upload would never reach object storage and would **vanish on cell restart** |
| 7 | **Read-only gate** | `http.ts` `READ_ONLY_ALLOWED_WRITE_*` | allowlist — new routes are refused for viewers by default (correct; pin it with a test) |

### [r2] Size ceilings already elsewhere in the system

| Lane | Cap | File |
|---|---|---|
| Desktop sync push | 512 MiB (`MAX_PUSH_BYTES`) — larger files **silently skipped** | `sync/asset-push.ts:53` |
| Desktop sync pull | 512 MiB (`MAX_PULL_BYTES`) | `sync/file-pull.ts:66` |
| Hub asset lane / S3 | 2 GiB (`MAX_PROJECT_FILE_BYTES`) | `apps/hub/src/file-limits.mjs:24` |
| Studio session budget | 1 GiB (`ASSET_SESSION_BUDGET`) | `api.ts` |

r1 proposed a 1 GiB chunked ceiling. A 600 MB clip would then land locally but
never reach a teammate, with no error anywhere. The default must sit at or below
the sync lane — see Open decision 1.

### [r2] Memory amplification that r1 missed

- **S3 mirror** — `api.ts` (end of `saveAssetFromStream`):
  `assetMirror.push(rel, new Uint8Array(await Bun.file(fileAbs).arrayBuffer()))`
  loads the whole file into RAM. That's fine at 100 MB and not fine at 512 MB+
  on a cell. `assets-s3.ts:245` `push(rel, bytes)` takes a buffer, so it needs
  a streaming or file-based variant.
- **Native picker IPC** — `apps/desktop/src-tauri/src/lib.rs:258`
  `PickedMedia { bytes: Vec<u8> }` is serde-serialized over Tauri IPC as a
  **JSON array of numbers** (~3.5–4 bytes of JSON per byte), then rebuilt with
  `new Uint8Array(p.bytes)` in `app.jsx`. A 500 MB file means roughly 2 GB of
  JSON in the webview. r1 called this out of scope. It isn't: surface #3 is the
  native path, and `report.json` says `surface: "native"`. See Open decision 3.

## Solution

### Protocol — static paths, query params **[r2]**

r1 used dynamic segments (`/chunk/:sessionId/finish`). That forces regex gates
in three places (`isCanvasSafeRoute`, the fetch fall-through, the hub prefix
table) and turns each one into a hole that can't be seen by reading the list
(the `READ_ONLY_ALLOWED_WRITE_PATTERNS` doc comment says exactly this). Static
paths join each exact-match set with one line apiece:

| Route | Body | Purpose |
|---|---|---|
| `POST /_api/asset/chunk-start` | JSON `{ totalSize }` | sweep → validate → reserve budget → `{ session, chunkBytes, chunkCount }` |
| `POST /_api/asset/chunk?session=<id>&index=<n>` | raw bytes | write one chunk |
| `POST /_api/asset/chunk-finish?session=<id>` | — | verify → reassemble → shared core → `201 { path }` (same shape as today) |
| `DELETE /_api/asset/chunk?session=<id>` | — | abort, release reservation |

`session` is validated as `^[0-9a-f]{32}$` before it touches a path.

### Chunk rules (server-enforced) **[r2]**

- **Fixed size.** Every chunk except the last must be exactly `chunkBytes`. The
  last must be `totalSize - (chunkCount-1)·chunkBytes`. Offset arithmetic is
  then trivial, and the file count per session is bounded at
  `ceil(totalSize/chunkBytes)` (r1 allowed arbitrary sizes, so a hostile client
  could send millions of 1-byte `.part` files).
- `index` is an integer in `[0, chunkCount)`. Anything else returns 400. Re-sending
  an index overwrites that chunk, which makes a retry idempotent.
- Per-chunk body is streamed with a flat cap of `chunkBytes` (413 past it). It
  never uses `req.arrayBuffer()`.
- **At most `ASSET_CHUNK_MAX_SESSIONS` (default 4) open sessions** per server
  instance. A fifth `chunk-start` returns 429. This bounds fds and directory
  count on top of the budget.

### Session state lives in `_state/` **[r2]**

r1 put sessions in `assets/.chunk-<id>/`. `assets/` is **versioned and synced**:
it is in the file plane, `fs.watch`-driven reload sees it, and on a cell
`announceWritten` journals it. Use `<designRoot>/_state/asset-chunks/<id>/`
(`meta.json` + `<n>.part`). `_state/` already counts as runtime state in all four
lists (`isMaudeRuntimeState`, `cli/lib/gitignore-block.mjs`, `.gitignore`,
`isRuntimeStateRel` in `sync/file-membership.ts:163` + its hub mirror). No list
changes are needed, and the CLAUDE.md four-list drift rule doesn't fire.

### Budget accounting

- New `assetBytesReserved` next to `assetBytesWritten`.
- `chunk-start`: run the sweep, then 429 if
  `assetBytesReserved + assetBytesWritten + totalSize > ASSET_SESSION_BUDGET`.
  This reserves before any bytes are accepted.
- `chunk-finish` (success, dedupe hit, **or failure**) and `DELETE` release the
  full reservation. Only a genuinely new file adds to `assetBytesWritten`.
- The shared core's own budget check must **not** run on the chunked path,
  because the reservation already covered it. Without this the bytes are
  double-counted and a 512 MB clip against a 1 GiB budget falsely 429s. Pass a
  `budget: 'reserved'` flag into the core.
- Lazy TTL sweep at the top of `chunk-start` deletes sessions older than
  `ASSET_CHUNK_SESSION_TTL_MS` (30 min) and releases them with
  `Math.max(0, …)` clamping (a restart zeroes the counter, but the dirs survive
  on disk). **[r2]** Also sweep once at boot. A restarted server would otherwise
  keep orphaned dirs from the previous process until someone uploads again.

### Reassembly + sniff ordering

`chunk-finish` checks that all indices are present and that sizes sum to
`totalSize`, otherwise it returns 400 "incomplete upload". It then builds an
ordered-concat `ReadableStream` over `<0..n>.part` and feeds the **shared core**
(Task 2). That is the same sniff → category cap → hash → temp → dedupe → rename
path the one-shot route uses. The sniff therefore reads the head of the
reassembled stream, never a single chunk. The core already buffers head chunks
until it has ≥ 12 bytes, so a tiny chunk 0 is harmless. In practice fixed sizing
makes chunk 0 = `chunkBytes` anyway.

Images arriving through the chunk route are rejected with 415 at finish
(images don't need chunking, so the route shouldn't widen their surface).

### Client — one shared module **[r2]**

Extract `apps/studio/asset-upload.ts` (no DOM/React deps):
`uploadAsset(file, { onProgress? })`. `use-canvas-media-drop.tsx` re-exports it
(so #2 stays untouched), and `client/app.jsx` imports it, replacing `uploadOne`'s
raw fetch. This works because `client/*.jsx` already imports `../notifications.tsx`,
so the bundler crosses that boundary today.

- **[r2] Threshold is a client constant.** r1 contradicted itself here: it said to
  branch on server `ASSET_CHUNK_BYTES` and also to learn that value from
  `chunk-start`. Fix: `CHUNK_THRESHOLD = 32 MiB` client-side. Video/audio above
  it takes the chunked path. Everything else (all images, small clips) goes
  through today's one-shot POST. The chunk **size** comes from `chunk-start`'s
  response, so a server env override still applies without a client rebuild.
- Chunks go out sequentially with up to 3 retries per chunk. On a final failure
  the client sends a best-effort `DELETE`.
- **[r2] Progress.** A 500 MB upload on localhost takes seconds, but on a cell
  over Wi-Fi it can take minutes, and today's toast says nothing until it's done.
  `onProgress` drives an "Uploading clip… 37%" toast in `uploadAndAnnounceMedia`
  and the AssetPicker's busy label. Should-have, same PR.

### Hub / cloud **[r2]**

- `studio-manifest.mjs`: add the three paths with
  `{ safe: 'read', unsafe: 'edit' }`, the same as `/_api/asset`.
- `studio-proxy.mjs:482` and `:725`: fire `onAssetWritten()` on a 2xx from
  `/_api/asset` **or** `/_api/asset/chunk-finish`. Extract a tiny
  `isAssetWriteCompletion(method, path, status)` helper so the two doors can't
  drift.
- Byte-identical mirror rule: if `studio-manifest.mjs` or `file-membership`
  have a mirrored copy elsewhere, update it in the same commit (check
  `apps/hub/src/file-membership.mjs` parity per CLAUDE.md).

### What does NOT change

- `ASSET_MAX_VIDEO_BYTES` (100 MB, one-shot path) and `MAX_REQUEST_BODY`.
- `ASSET_MAX_BYTES` (images).
- Runtime-state lists (sessions sit under the existing `_state/`).

## Decisions (owner, 2026-10-07) — RESOLVED

- **1 → (a)** `ASSET_MAX_CHUNKED_BYTES` default **512 MiB** (= sync push/pull cap; sync untouched).
- **2 → (a)** `ASSET_SESSION_BUDGET` default raised **1 GiB → 4 GiB** (record in the Task 11 DDR as an explicit revision of DDR-148's number).
- **3 → (a)** Native picker **in scope** — Task 10 is mandatory.

## Open decisions (as originally posed — kept for the record)

1. **Chunked ceiling default.** (a) **512 MiB**, equal to the desktop sync cap, so
   anything that lands also reaches peers (recommended). (b) 1–2 GiB, which also
   means raising `MAX_PUSH_BYTES`/`MAX_PULL_BYTES` to match. That's a bigger
   blast radius for sync and needs its own look at timeouts
   (`GET_TIMEOUT_MS = 120 s` in `file-pull.ts`).
2. **Session budget.** `ASSET_SESSION_BUDGET` is 1 GiB per server instance, so
   at 512 MiB per clip that's two big drops before every upload 429s until
   restart. Options: (a) raise the default to 4 GiB (recommended; this is a
   disk-fill bound, and F3's concern is mitigated by fixed chunks + session
   cap + TTL), or (b) keep 1 GiB and surface the 429 with a clear message.
3. **Native "Open file" picker.** (a) In scope (recommended, because it's the
   surface the reporter was on). Replace the `Vec<u8>` JSON payload: Rust keeps
   picked paths behind an opaque token, JS reads them through
   `read_picked_media(token, offset, len)`, which returns `tauri::ipc::Response`
   (a raw ArrayBuffer, not JSON), and feeds slices to the chunk uploader. The
   path never reaches JS. (b) Descope, cap the native picker at 100 MB with a
   clear message, and send users to drag-drop for big clips.

---

## Metadata

- **Ticket**: Issue #126 — github.com/1aGh/maude/issues/126
- **Type**: Enhancement (security-relevant surface change)
- **Complexity**: High
- **App/Package**: `apps/studio` (server + client), `apps/hub` (manifest + proxy), `apps/desktop` (only if Open decision 3a)
- **Affected Systems**: asset route family, asset write core, S3 mirror, hub role manifest + mirror trigger, media-drop hook, AssetPicker
- **Dependencies**: none new

---

## Context References

### Must-Read Files

- `apps/studio/api.ts` (992–1140 caps; 2420–2600 `saveAssetFromStream`, `announceWritten`, mirror push)
- `apps/studio/assets-s3.ts` (~200–260 `push`)
- `apps/studio/http.ts` (485–502 read-only allowlists; 4624–4658 `/_api/asset`; 6100–6170 `CANVAS_SAFE_API` + `isCanvasSafeRoute`)
- `apps/studio/server.ts` (259–268 `MAX_REQUEST_BODY`; 530–550 canvas `routes`)
- `apps/studio/use-canvas-media-drop.tsx` (172–194 `uploadAsset`; 371–393 `uploadAndAnnounceMedia`)
- `apps/studio/annotations-layer.tsx` (~1844, ~1918)
- `apps/studio/client/app.jsx` (~1300–1400 `uploadOne` / `doUpload` / `doUploadMany` / `openFilePickerNative`)
- `apps/studio/sync/asset-push.ts:53`, `sync/file-pull.ts:60–70`, `sync/file-membership.ts:157–168`
- `apps/hub/src/studio-manifest.mjs` (~128 exact entries, ~319 prefixes), `apps/hub/src/studio-proxy.mjs` (~470–500, ~715–740), `apps/hub/src/file-limits.mjs`
- `apps/desktop/src-tauri/src/lib.rs` (258–365) + `client/github.js:161–167` — only for Open decision 3a
- `apps/studio/test/video-asset.test.ts`, `test/canvas-origin-gate.test.ts`, `test/assets-s3.test.ts`
- DDR-088, DDR-148 (F3), DDR-054, DDR-195 / DDR-217 (cell asset transport)

### Patterns to Follow

- `Number(env) > 0 ? env : default` constant shape (`api.ts`, three existing instances).
- Streamed `reader.read()` loop with in-loop cap (`saveAssetFromStream`), never `arrayBuffer()`.
- `annotations` scratch under `_state/` (`api.ts` ~2405) as the precedent for runtime temp files.
- Dual-allowlist comment wording (`server.ts:543`), copied onto every new route.

---

## Tasks

### Task 1: ADD constants + session registry (`api.ts`)
`ASSET_CHUNK_BYTES` (16 MiB), `ASSET_MAX_CHUNKED_BYTES` (512 MiB), `ASSET_CHUNK_SESSION_TTL_MS` (30 min), `ASSET_CHUNK_MAX_SESSIONS` (4), all env-overridable; raise `ASSET_SESSION_BUDGET` default to 4 GiB (update its DDR-148 comment). Add `assetBytesReserved` and an in-memory `chunkSessions` map mirrored by `_state/asset-chunks/<id>/meta.json`.
**Validate**: `bunx tsc --noEmit`.

### Task 2: REFACTOR the write core
Extract `consumeAssetStream(stream, { videoCap, budget: 'check' | 'reserved', allowImages })` from `saveAssetFromStream`. The one-shot wrapper calls it with `{ videoCap: ASSET_MAX_VIDEO_BYTES, budget: 'check', allowImages: true }`. Zero behavior change.
**Validate**: existing `video-asset.test.ts` + `asset-api.test.ts` green, untouched.

### Task 3: STREAM the S3 mirror push
Add a file-based / streaming `pushFile(rel, absPath)` to `assets-s3.ts` (or use `Bun.file` as the request body) and use it from the core, so no asset is ever read whole into RAM for mirroring.
**Validate**: extend `test/assets-s3.test.ts`.

### Task 4: ADD sweep (lazy + boot)
`sweepStaleChunkSessions()` runs at the top of `chunk-start` and once at server boot. It tolerates missing or corrupt `meta.json` by deleting the dir and skipping the release.
**Validate**: test with `MAUDE_ASSET_CHUNK_SESSION_TTL_MS=1` — a stale session is gone, and its reservation is released.

### Task 5: ADD `chunk-start`, `chunk`, `chunk-finish`, `DELETE chunk` handlers (`http.ts` + `api.ts`)
Implement the rules from Solution: session id regex, fixed sizes, index bounds, session cap, reservation, release on every exit path of finish.
**Validate**: tests below (Task 9).

### Task 6: UPDATE allowlists (studio)
Add the 3 static paths to `CANVAS_SAFE_API` and the canvas `routes` map.
**Validate**: extend `canvas-origin-gate.test.ts` — `GET → 405` from the canvas origin for each path; a viewer (read-only) session gets refused on each.

### Task 7: UPDATE hub manifest + mirror trigger
Add the `studio-manifest.mjs` entries. In `studio-proxy.mjs`, both doors call `isAssetWriteCompletion()`.
**Validate**: hub tests (`apps/hub` node tests) — a viewer is denied on chunk paths, and `onAssetWritten` fires on a 2xx `chunk-finish` through both doors.

### Task 8: EXTRACT client `asset-upload.ts`; wire #1, #3; progress toast
Create `asset-upload.ts`. `use-canvas-media-drop.tsx` re-exports `uploadAsset`. `app.jsx` `uploadOne` → shared helper. `onProgress` drives the toast and the AssetPicker busy label.
**Gotcha**: `doUploadMany` runs uploads concurrently. With `ASSET_CHUNK_MAX_SESSIONS = 4`, a 6-file native pick would 429. Serialize chunked uploads in the helper (a module-level queue), and leave one-shot uploads concurrent.
**Validate**: pure-function tests for the threshold/slicing plan. Manual drop of 20 MB, 150 MB and 450 MB clips.

### Task 9: TESTS (`test/video-asset-chunked.test.ts`, mirroring `video-asset.test.ts`)
- Happy path: an MP4 in 3 chunks (`MAUDE_ASSET_CHUNK_BYTES=1024`) gives 201 and a byte-identical file at `assets/<sha8>.mp4`. The sha8 equals the one-shot upload of the same bytes (dedupe across paths).
- A non-final chunk of the wrong size returns 400. An index out of range returns 400. An unknown or malformed session returns 404/400.
- Finish with a missing index returns 400, the dir is removed and the reservation is released.
- SVG bytes chunked → 415 at finish. An image chunked → 415.
- Budget: a reservation over budget returns 429. A 5th concurrent session returns 429.
- **No double count**: a chunked upload of 60% of the budget succeeds (it would falsely 429 if the core re-checked).
- TTL sweep and `DELETE` both release the reservation.
- Nothing appears under `assets/` except the final file, and no `.part` files are left anywhere after success or failure.
- `ASSET_MAX_VIDEO_BYTES` one-shot behavior is unchanged (existing suite).

### Task 10: native picker without the JSON byte array
Rust: `pick_media_file(s)` returns `{ token, name, size }`, with token → path kept in managed state. `read_picked_media(token, offset, len) -> tauri::ipc::Response`. `release_picked_media(token)`. JS wraps that in a Blob-like slice source for `asset-upload.ts`. Debug-only `MAUDE_E2E_OPEN_PATH(S)` hooks keep working. Update `report-bug.jsx` (also uses `pickMediaFile`) accordingly.
**Validate**: `cargo check`, a desktop e2e scenario picking a >100 MB fixture through `MAUDE_E2E_OPEN_PATH`, and `check-client-boots.mjs` against a built `.app` before release.

### Task 11: RECORD DDR
`/flow:record-ddr`: the chunked protocol's threat model (fixed chunks, session cap, reserve-before-accept, TTL + boot sweep, sniff-after-reassembly, `_state/` placement, hub manifest + mirror parity), extending DDR-088 and DDR-148 and resolving F3. Re-ingest with `maude kg import`.

### Task 12: What's New entry
User-visible: "Drop videos up to N MB". Add a pending entry via the `whats-new-entry` skill at `/flow:done`. If client surfaces change, rebuild `dist/client.bundle.js` release-minified per CLAUDE.md.

---

## Validation

1. `pnpm lint`
2. `cd apps/studio && bunx tsc --noEmit && scripts/check-tsc-coverage.sh` (the new `asset-upload.ts` must be covered)
3. `cd apps/studio && bun test test/video-asset.test.ts test/video-asset-chunked.test.ts test/canvas-origin-gate.test.ts test/assets-s3.test.ts`. Run `git status apps/studio/dist/` before and after (CLAUDE.md: test runs have clobbered `dist/`).
4. Hub tests for the manifest and proxy.
5. `cargo check` (only if Task 10).
6. Manual: 20 / 150 / 450 MB clips via drag-drop, paste and AssetPicker in browser and desktop. A teammate on sync receives the 450 MB clip. Cancel mid-upload → no leftovers under `_state/asset-chunks/`.

## Scenario Coverage

- Web: `agent-browser` drop of a >32 MiB fixture → success toast + snippet round-trip; screenshot of the progress toast.
- Desktop (Task 10): `apps/desktop/e2e/` scenario with `MAUDE_E2E_OPEN_PATH` and a >100 MB fixture.

## Acceptance Criteria

- [x] Open decisions 1–3 answered (512 MiB / 4 GiB / native picker in scope) and reflected in constants and tasks
- [x] Clips up to the chunked ceiling land via surfaces #1–#3. Surface #3's native path is verified by unit tests and `cargo check` only; the desktop e2e run is pending, see the Retro
- [x] `ASSET_MAX_VIDEO_BYTES` and `MAX_REQUEST_BODY` defaults unchanged
- [x] Cloud: a chunked upload passes the hub manifest for editors, is denied for viewers, and is mirrored to object storage (hub tests)
- [x] No session state under `assets/`; nothing added to the four runtime-state lists (`_state/` reused)
- [x] No asset read whole into RAM for mirroring (`pushFile`)
- [x] Chunked ceiling ≤ sync push/pull caps (512 MiB = 512 MiB)
- [x] All Task 9 tests green; existing asset suites untouched and green
- [x] DDR-248 recorded (with the close-time security addendum); What's New entry pending (version null)

---

## Execution Progress (2026-10-07, `/flow:execute`)

- ✅ Task 1: constants + session registry — completed
- ✅ Task 2: `consumeAssetStream` core refactor — completed (existing asset suites green, untouched)
- ✅ Task 3: streaming S3 mirror (`AssetMirror.pushFile`, `signRequest({ bodySha256 })`) — completed
- ✅ Task 4: lazy + boot sweep — completed
- ✅ Task 5: `chunk-start` / `chunk` / `chunk-finish` / `DELETE chunk` — completed
- ✅ Task 6: studio dual allowlist + canvas-origin-gate assertions — completed
- ✅ Task 7: hub manifest + `isAssetWriteCompletion` at both doors — completed
- ✅ Task 8: `asset-upload.ts`; drop hook re-exports it; AssetPicker `uploadOne` uses it; progress % in picker; "Uploading…" toast for chunked canvas drops — completed
- ✅ Task 9: `test/video-asset-chunked.test.ts` (15), `test/asset-upload.test.ts` (7) — completed
- ✅ Task 10: native picker → `{ token, name, size }` + `read_picked_media` / `release_picked_media` (`picked_media.rs`); callers updated (AssetPicker, timeline image overlay, bug-report screenshot) — completed; `cargo check` green. Desktop e2e scenario NOT run (needs the `--debug` app build) → `/flow:done`
- ✅ Task 11: DDR-248 written + ingested (targeted `kg ingest`, not a full `kg import`)
- ✅ Task 12: What's New entry `large-video-drops` (pending version) + changeset `large-video-drops.md`; site mirrors regenerated

**Deviations from the plan**
- Sessions keep no `meta.json`. The in-memory map is authoritative, and orphan dirs from an earlier process are swept by **dir mtime** once idle past the TTL. That removes the restart-clamp problem entirely: orphans were never reserved by this process.
- The TTL counts from **last activity**, not creation. A slow 512 MiB upload over a cell uplink must not be swept mid-flight.
- A chunk is written to a unique temp file and renamed, so a retry racing its first attempt can't tear a part. Chunks arriving after finish/abort starts get 409.
- Canvas drops get a start toast, not live %. The canvas→shell notice bridge has no update channel, and adding one from the untrusted origin was out of proportion (recorded in DDR-248).
- A third native-picker caller (timeline image overlay, `app.jsx` ~17119) and `report-bug.jsx` read `picked.bytes` too. Both now go through `readPickedMediaBlob`.
- `dist/client.bundle.js` rebuilt `--release` per CLAUDE.md. Unrelated drift in `dist/comment-mount.js` from the same build was reverted.

---

## Retro (2026-10-07, `/flow:done`)

- **The review pass earned its keep.** Both reviewers independently found the same high-severity race. `chunk-start` checked the cap and budget, awaited `mkdir`, then registered, which is the "budget reserved before any byte" invariant broken by a single `await`. Rule for next time: any check-then-commit on shared server state must not span an `await`. Put that in the plan's Gotchas, not only in review.
- **Re-checking the plan against the code beat the first draft.** r1 missed the hub manifest and mirror trigger, the 512 MiB sync caps, and the `assets/` vs `_state/` placement. All three would have shipped as silent failures: a 404 in cloud, an asset that never syncs, scratch that git and sync would pick up. When a plan touches a route, grep every exact-path list for it (studio, hub, writer registry, inventories) before writing tasks.
- **Hidden pins showed up only in the full suites.** `sync-writer-registry` (every `/_api` route must be classified) and the multiplayer coverage-catalogue sha pin were not in the plan. Running the full sync lane plus harness at execute time, not just affected tests, would have caught them a phase earlier.
- **The worktree environment cost time.** The root `pnpm-lock.yaml` already lags `package.json` (1.7.1 sidecar packages), `--ignore-scripts` skipped the native `better-sqlite3` build, and the result was red tests unrelated to the change. Diagnose an environment failure before attributing it.
- **Still open:** the desktop e2e run of a >100 MB native pick (needs the `--debug` app build), plus DDR-248 follow-ups F1–F4 (persistent budget across cell restarts, per-caller session cap in cells).
