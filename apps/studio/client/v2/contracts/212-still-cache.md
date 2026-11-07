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

## §5 — the stills persist across sessions (T2.2, decision D2)

The encoded tier (§2) is kept between sessions, so a canvas opened again shows its stills at once instead of drawing
them. The canvas runs on the untrusted origin (DDR-054): it never gets a storage handle or a key of its own. It only
says "artboard X of the canvas you opened has this still" over the typed bridge; the SHELL picks the key, checks the
bytes, stores them, and answers with that canvas's stills only.

**Messages** (`bridge/dgn-protocol.ts`; gate `active` on the shell, `parent` on the canvas):

| message | dir | payload | caps |
| --- | --- | --- | --- |
| `stills-want` | c→s | `{ file }` | once per canvas document |
| `still-put` | c→s | `{ file, artboard, sig, bytes: ArrayBuffer }` | `bytes` a still WebP (below); `sig`, `artboard` ≤ 200 |
| `stills` | s→c | `{ file, items: [{ artboard, sig, bytes }] }` | ≤ 2000 items, each checked again by the canvas |

**Scope — what the shell checks before it reads or writes** (`client/v2/shell/still-bridge.js`):

1. the origin, then the `active` gate: `e.source` is the window of the shell's own iframe for `activePath`;
2. `file === activePath` — the frame's word and the shell's own state must agree, so a message a document posted
   just before its frame showed another canvas never lands on the new one (the target comes from the shell, as in
   gate-b-c4b; the frame's word can only narrow it);
3. the shell's own iframe `src` is a plain open: no `sha` (a version), `embed`, `follow`, `hide-chrome` or
   `thumbnail` — a still of another version never stands for today's;
4. the project index has a row for that canvas (`GET /_api/index`, the snapshot the Canvases panel already reads).
   No index (a cell, an older server) = no persistence; nothing is stored blind.

**Key — chosen by the shell, never by the frame.** One record per (project, canvas scope, artboard):

- project = the index `pid`;
- canvas scope = the frame's per-frame capability `frameCapFor(cfg.frameKey, rel)` (C4: a MAC over the canvas path
  under the opener's per-subject key), so another person on the same browser profile, or a session with other access,
  never reads these stills; without a key (the origin split off) the plain `rel`;
- source = the index row's `srcHash`, `metaHash` and `depsHash` (computed by the server; the canvas cannot name them).
  A record whose source differs from the row's is never returned, and is deleted when its canvas asks;
- `artboard` is the one part the frame names, and only inside the scope above.

**Bytes.** Accepted only as a real still WebP (`bridge/still-webp.ts` `checkStillWebp`): `RIFF`…`WEBP` with a RIFF
size equal to the buffer's, a first chunk `VP8 ` (key frame, start code `9d 01 2a`), `VP8L` (signature `2f`) or `VP8X`
(no animation flag), width ≤ 401 and height ≤ 1601 read from the bitstream header. ≤ 256 kB per still (measured:
~18 kB). The shell never decodes it; the canvas does, in its own origin.

**Caps and eviction** (`client/v2/shell/still-store.js`): 256 kB per still; 32 MB per project; 96 MB per store; 2000
stills per canvas; 300 writes a minute per canvas (a planted canvas cannot churn the disk). Over a cap, the record
used longest ago goes first (a read refreshes it).

**Where it lives.** The shell's own IndexedDB (`maude-stills`) on the main origin — in the desktop app the project
webview's app-owned data store, in a browser the profile's. Never inside the design root: not synced, not committed,
no DDR-115 list entry. No storage (a private window, a blocked store) = no persistence; nothing else changes.

**Never a stale still.** Two checks:

- the shell's source key above (the TSX, its meta or its imports changed → the record is gone);
- the canvas checks what the key cannot see. `sig` = the body's content signature (`contentSignature`) + `~` + a
  style signature of the document's linked stylesheets (`documentStyleSignature`: a DS tokens or components change).
  A persisted still waits in `StillCache` as a SEED (`seed`, outside the cache's map — no placeholder, `hasStill` or
  warm-up sees it). It stands in only once its artboard has mounted and the body's signature equals the seed's
  (`adopt`, from `StillController.register`, or `adoptSeeds` when the answer comes later). A seed that does not match
  is dropped, and the artboard is drawn as before.

**Reload.** The canvas asks once (`stills-want`) when its overview runtime starts; the shell answers from IndexedDB
(waiting ≤ 4 s for the index). Artboards that mount under the cut adopt their seed and are restored from it —
decoded, not drawn (`takes` unchanged). The canvas writes back only stills it drew itself (`onEncoded`), never a seed.

**Named gap.** Every canvas frame mounted at once shares the one canvas origin (CLAUDE.md, C4 named gap): a sibling
frame can run code in the active frame's realm and post `still-put` as it. It can then change only the stills of the
canvas on screen, to pictures it could already draw into that canvas's DOM. `framesIsolated` (canvas-only sessions)
mounts only the active frame.

**Why not on disk next to the thumbnails** (`~/.maude/index/v1/projects/<pid>/`): the same scope and checks would need a
new main-origin route (the route table, the writer registry, the hub manifest — all lead-owned) for no gain in trust:
the shell that checks the bytes is already the trusted side. One cost: IndexedDB is per origin, so a project whose
port changes starts with an empty store (the old one stays capped at 32 MB).

**Tests** — `test/v2-212-still-persist.test.ts`: a frame cannot read or write another canvas's stills; an oversized,
non-WebP, animated or too-large-in-pixels payload is refused (bridge and store); a record of another source is not
returned and is deleted; a reload shows the persisted still before any drawing (restored from the seed, no take), and
a seed whose signature differs is not shown.
