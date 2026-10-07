# DDR-248 — Chunked asset upload raises the effective file size, not the request ceiling

- **Status:** Accepted — 2026-10-07
- **Extends:** DDR-088 (canvas media vocabulary + asset write surface), DDR-148 (video comps; resolves its follow-up F3)
- **Related:** DDR-054 (canvas origin split), DDR-115 (runtime-state taxonomy), DDR-195 / DDR-217 (cell asset transport), DDR-247 (canvas write capability)
- **Ticket:** issue #126 — "I can't drop media that's more than 100mb"

## Context

`POST /_api/asset` streams one request body to disk with a per-category cap
(`ASSET_MAX_VIDEO_BYTES`, 100 MB) and a per-server-instance byte budget
(`ASSET_SESSION_BUDGET`, 1 GB). Video users routinely have bigger clips. The
route is reachable from the untrusted canvas origin (DDR-054), and Bun's
`maxRequestBodySize` is **global per server** (`MAX_REQUEST_BODY` =
`ASSET_MAX_VIDEO_BYTES + 8 MiB`). Raising the cap would therefore raise what
every route accepts before its handler runs. DDR-148 F3 had already flagged the
budgets as an open disk-fill question.

Options weighed (`.ai/plans/feature-video-asset-size-cap-decision.md`): A —
raise the default; B — expose the env override as a setting; C — chunked
upload; D — better error text only. **The owner chose C.**

## Decision

1. **Chunked sessions for video/audio, one-shot for everything else.**
   `POST /_api/asset/chunk-start {totalSize}` → `POST /_api/asset/chunk?session=&index=`
   (raw bytes) × N → `POST /_api/asset/chunk-finish?session=` → `201 {path}`
   (the one-shot response shape); `DELETE /_api/asset/chunk?session=` aborts.
   `ASSET_MAX_VIDEO_BYTES` and `MAX_REQUEST_BODY` are **unchanged**. Each chunk
   is `ASSET_CHUNK_BYTES` (16 MiB) and only the reassembled file may reach
   `ASSET_MAX_CHUNKED_BYTES`.
2. **The chunked ceiling defaults to 512 MiB, equal to the desktop sync lane's
   push/pull cap** (`sync/asset-push.ts`, `sync/file-pull.ts`). A larger clip
   would land locally and silently never reach a peer. Raising one without the
   other is a bug.
3. **`ASSET_SESSION_BUDGET` default raised 1 GB → 4 GB.** At 512 MiB per clip,
   1 GB is two drops before every upload 429s until restart. The budget stays an
   aggregate disk-fill bound, and the controls in 4 cover the F3 concern.
4. **Untrusted-origin controls on the chunked path:**
   - **Fixed chunk sizes.** Every non-final chunk is exactly `chunkBytes` and the
     last is the exact remainder. `index ∈ [0, ceil(total/chunkBytes))`. This
     bounds the file count per session; arbitrary sizes would allow millions of
     1-byte parts.
   - **Open sessions capped** (`ASSET_CHUNK_MAX_SESSIONS`, 4).
   - **Budget reserved at chunk-start, before any byte is accepted.** The
     reservation is released on finish (success, dedupe or failure) and on abort
     or sweep. The write core does not charge it twice. One-shot writes count
     open reservations too.
   - **Sniff on the reassembled stream.** `finish` concatenates parts in index
     order and feeds the same core the one-shot route uses (`consumeAssetStream`:
     sniff → category cap → hash → dedupe → rename). A per-chunk sniff, or a
     valid head in chunk 1, can't make an unknown chunk 0 pass. Images are refused
     on this path.
   - **Idle sessions are swept** (`ASSET_CHUNK_SESSION_TTL_MS`, 30 min of
     inactivity) at chunk-start and at boot. Orphan dirs from an earlier process
     go once idle past the TTL, so a second server on the project is never
     undercut.
   - **Session ids** are 128-bit random hex, regex-validated before they touch
     a path. Containment is asserted.
   - **No CSRF guard**, the same posture as `/_api/asset` (DDR-105 deliberately
     exempts the canvas-origin upload). A foreign page can open its own session
     under the same caps, but can't address someone else's.
5. **Session scratch lives in `<designRoot>/_state/asset-chunks/`**, never
   `assets/`. `assets/` is versioned and in the sync file plane. `_state/` is
   already runtime state in all four DDR-115 lists, so no list changes.
6. **Static paths, not dynamic segments.** Each route is one exact entry in
   `CANVAS_SAFE_API` + the canvas `routes` map (DDR-088 dual list) and in the hub
   role manifest (`edit`). A regex gate is a hole you can't see by reading the
   list.
7. **The hub mirrors on chunk-finish at both doors.** `isAssetWriteCompletion()`
   in `studio-proxy.mjs` is the single rule. Before it, only an exact
   `/_api/asset` triggered the object-storage mirror, so a chunked upload in a
   cell would vanish on restart.
8. **The S3 mirror streams from disk** (`AssetMirror.pushFile`, SigV4 over the
   precomputed SHA-256). It used to read the whole file into RAM.
9. **One client, three surfaces.** `apps/studio/asset-upload.ts` serves the canvas
   drop/paste hook, the AssetPicker, and the native "Open file" picker. The
   AssetPicker previously had its own duplicate POST. It chunks video/audio over
   32 MiB (a client constant; the chunk *size* comes from the server), retries
   5xx/409/429 per chunk, aborts on failure, and runs chunked uploads one at a
   time (session cap).
10. **The native picker returns a token, not bytes.** `pick_media_file(s)` used to
    send `Vec<u8>` over Tauri IPC, which serde turns into a JSON number array
    (~4× the size, all in the webview). It now registers the path behind an
    unguessable token (`picked_media.rs`, at most 64 kept). The page reads
    ≤ 64 MiB slices with `read_picked_media` as raw `ipc::Response` bytes and
    calls `release_picked_media` when done. The path never reaches the page, and
    a file whose size changed since the pick is refused.

## Addendum — security review at close (2026-10-07)

The defender and attacker review at `/flow:done` found a race that broke Decision 4. It was fixed before commit, together with the medium-severity findings:

- **Reserve atomically.** `chunk-start` used to check the session cap and budget, `await mkdir`, and only then register and reserve. N parallel starts all passed against the same empty state: ~6 sessions locally, ~100 over the cell's HTTP/2, with up to 50 GiB reserved against 4 GB. Now validation and the sweep run first, then check + register + reserve happen in one synchronous block, and a failed `mkdir` rolls back. Pinned by a test that fires 12 starts in parallel.
- **One write in flight per session.** A parallel write to the same session (any index) gets 409, and so does `finish` while a write is streaming. Before this, concurrent writes each held an uncounted 16 MiB temp file and fd outside the budget.
- **Sessions can't be held forever.** On top of the 30-min idle TTL, a session that never received a chunk is swept after 60 s (`ASSET_CHUNK_EMPTY_SESSION_TTL_MS`), and any session after 2 h (`ASSET_CHUNK_SESSION_MAX_AGE_MS`). Re-sending chunk 0 no longer keeps a slot alive.
- **Cross-site requests are refused.** All three routes return 403 on `Sec-Fetch-Site: cross-site`. The canvas iframe and the shell are always same-origin or same-site, so a blind `text/plain` POST from a foreign page can no longer take the session slots. Browsers that send no Fetch Metadata are still let through, with the cap, the empty TTL and the budget as the backstop.
- **Teardown is robust.** Session removal swallows a racing `ENOTEMPTY`, so a successful finish can't turn into a 500. The orphan sweep collects anything left behind.
- **Env knobs are clamped.** `ASSET_CHUNK_BYTES` is floored and capped at `ASSET_MAX_VIDEO_BYTES`, so a chunk always fits the global request ceiling. The ceiling and session count are floored.
- **Native picker.** A token expires after 30 min unused. A slice read compares size **and** mtime against the pick and refuses on change. At most 2 slice reads run at once.

**Open follow-ups (tracked, not fixed here):**
- **F1 — the budget resets on restart.** It is per server process, so a cell that parks and restarts gets a fresh 4 GB each boot, and this is mirrored to S3 and peers. This predates the change (DDR-148 F3). The fix belongs at the hub/S3 layer: persistent per-project metering.
- **F2 — no per-caller session cap in cells.** Every collaborator shares the 4 sessions.
- **F3 — finish briefly needs about 2× the clip on disk.** The parts and the reassembled temp file coexist until teardown.
- **F4 — the picker's file check is by path.** It compares size and mtime but doesn't hold the original file handle.

## Consequences

- A 512 MiB clip uploads on desktop, in the browser and in a cell, while the
  per-request ceiling stays where DDR-088/DDR-148 put it.
- Disk exposure from a hostile canvas is bounded by the 4 GB budget, ≤ 4 open
  sessions, the TTL sweep and the fixed part count. That is a bigger budget than
  before, so the per-route controls above are now load-bearing.
- Not resumable across reloads. A failed chunk is retried, and a lost session is
  swept. True resume (persisted client state, querying received indices) is out
  of scope.
- Canvas drops show an "Uploading … (N MB)…" toast for chunked uploads. Live
  percentage is only in the AssetPicker. The canvas→shell notice bridge
  (`acceptCanvasNotice`) has no update channel, and adding one from the untrusted
  origin was not worth it for this change.

## Evidence

- Plans: `.ai/plans/feature-video-asset-size-cap-decision.md`, `.ai/plans/feature-chunked-asset-upload.md`
- Tests: `apps/studio/test/video-asset-chunked.test.ts`, `apps/studio/test/asset-upload.test.ts`, `apps/studio/test/assets-s3.test.ts` (pushFile), `apps/studio/test/canvas-origin-gate.test.ts`, `apps/hub/test/studio-proxy.test.mjs` (mirror + viewer refusal)
