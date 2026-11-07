# 2.0.8 — a drawn still never falls back to blank (#212 §1–§4)

Follows [`207-overview-level.md`](207-overview-level.md) (decision 5, "The cache"). Issue #212: on a ~90-artboard
canvas, artboards that already had a still dropped back to the flat own colour and faded back to the still while
panning. Cause, confirmed in the code: the cache held decoded bitmaps only, in a 96 MB LRU; at dpr 2 a 600 px still
costs 0.8–3.1 MB, so ~88 stills went over the budget, an evicted still was forgotten, and its released artboard fell
back to the placeholder until it was mounted and drawn again. A released artboard also drew a second canvas of its
still (outside the budget).

## Decision

1. **400 px stills** (`artboard-still-raster.ts` `stillWidthPx`): `STILL_MAX_SCREEN_PX` × the device pixel ratio
   (≤ 2), no 1.5 × headroom — 400 at dpr 2, 200 at dpr 1. An artboard under the cut is narrower than the cut on
   screen, so this is its own size. Width, not the long side, is what is capped (as in the issue's byte estimates:
   0.35–1.4 MB decoded, ×0.44); the 1600 px height cap stays. *If Michal meant the long side, it is one line.*
2. **Two tiers** (`artboard-still.ts` `StillCache`):
   - **encoded**: every still as a WebP blob (0.8) made right after it is drawn (one at a time, a macrotask apart),
     kept for every artboard and never touched by the decoded LRU; its own cap `STILL_ENCODED_MAX_BYTES` (64 MB),
     oldest copy first beyond it;
   - **decoded**: the bitmaps, an LRU by bytes (`STILL_CACHE_MAX_BYTES`, 48 MB — stills are ~2.2× smaller), never
     dropping a still that stands in, nor one whose encode is still pending. A still pushed out keeps its entry
     (`el: null`); `peek` still has it, so `hasStill` is true.
   - **No encoder** (a canvas without `toBlob`): a still dropped from the decoded tier is gone, as before.
3. **Back as a still (§4).** `StillController.register` and the reuse path decode the evicted still from the encoded
   copy (`cache.restore`, shared while in flight, counted in the decoded LRU) instead of drawing it; an unchanged
   signature is never redrawn. A failed decode drops the entry and the artboard is drawn again.
4. **One element (§3).** A released artboard's placeholder adopts the cache's own element (`StillHold`) instead of
   drawing a copy; the controller takes it back on a remount. When the decoded tier lets go of a bitmap the
   placeholder shows the encoded copy as an `<img>` (object URL), so a known still is never replaced by the
   skeleton while it waits.
5. The warm-up's room check follows the encoded tier (a decoded eviction no longer loses a still).

## Tests

`test/v2-212-still-cache.test.tsx` — 400 px width; the encoded tier survives a decoded eviction; the encoded cap drops
oldest first; restore shares one decode and counts in the LRU; no encoder → old behaviour; a released, evicted still
comes back as `still` with no redraw (`takes` unchanged); the mounted placeholder holds the cache's own canvas (one
canvas). Red→green: the file failed 6 of 8 before the change; reverting only the "keep the entry on a decoded
eviction" line fails the three cache/controller tests again.

## Measured

Playwright (headless, 1600 × 920, dpr 2), an isolated copy of the mascot canvas (88 artboards, 143 px widest at the
overview zoom, `linkedHub` stripped, no fonts / pictures), base = `0d8572e50` vs this change, each on its own private
server; a serpentine pan over the world plus three fit-all zoom cycles, then the same again (a revisit).

| engine | arm | decoded tier after the run | encoded tier | stills |
| --- | --- | --- | --- | --- |
| WebKit | base | 99.5 MB (budget 96) | — | 84 |
| WebKit | this change | **43.4 MB** | **1.44 MB** (81 blobs, ~18 kB each) | 81 |
| Chromium (`artboard-still=on`) | base | 97.1 MB | — | 78 |
| Chromium (`artboard-still=on`) | this change | **42.9 MB** | **0.31 MB** (78 blobs) | 78 |

- **Memory: the decoded tier is 2.3 × smaller, and every still is kept in under 1.5 MB encoded.** Within budget in both
  engines (the base was at its 96 MB cap — the cause of the evictions).
- **Frame times: inconclusive.** Headless WebKit and Chromium at dpr 2 on this canvas stall for 6–15 s on the zoom
  cycle's remount storm (both arms, both engines; the same cliff 207-overview-level.md names for Chromium's fit-all), so
  p95 is that stall, not the pan. Not a ship gate, not a comparison to the 2.0.7 p95 table.
- **Not measured: real Safari and the Tauri app** (safaridriver is not enabled on this Mac — `safaridriver --enable`
  needs admin — and a debug `.app` build was out of this task's budget). The "no artboard that had a still shows
  blank" acceptance needs those two runs; the per-frame blank counter in the harness read 0 in BOTH arms, so it did not
  reproduce the flicker either (too few frames to catch it). The fail-first test is what pins §4.
