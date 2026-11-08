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
   - **encoded**: every still as a WebP blob (0.8; PNG on WebKit, which encodes no WebP — §5) made right after it is drawn (one at a time, a macrotask apart),
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
- **Real Safari, 2026-11-07** (safaridriver, 2560×1340, dpr 1, machine load ≤ 6, display unlocked and visible; merged
  tip `35244436f` vs base `0d8572e50`; whole-world serpentine ×3 at 10 % zoom; p95 median over runs):
  mascot copy (88 artboards) **52 ms** tip vs 71 base, p50 14 both — the 2.0.7 table's Safari fix sweep is 48–52, so no
  regression; a 300-artboard fixture 16 vs 24. **No artboard that already had a still showed blank, in either arm, in
  41 runs.** Decoded tier: 8.2 MB / 58 stills (tip) vs 19 MB (base) on the mascot; 30 vs 68 MB on 300 boards. At dpr 1
  neither tier reached its cap, so the eviction-then-no-blank case still needs a Retina (dpr 2) run in the Tauri app.
  700 boards: inconclusive (noisy). Chromium frame times not measurable headless (stills are WebKit-default).
- **§5 on WebKit (found by that run):** `toBlob('image/webp')` returns PNG on WebKit, which the WebP-only check refused,
  so nothing was persisted and a reload redrew every still (open 2 = open 1). Fixed by accepting single-image PNG
  (follow-up to T2.2); the reload measurement is re-run after that fix.

## §5 — the stills persist across sessions (T2.2, decision D2)

The encoded tier (§2) is kept between sessions, so a canvas opened again shows its stills at once instead of drawing
them. The canvas runs on the untrusted origin (DDR-054): it never gets a storage handle or a key of its own. It only
says "artboard X of the canvas you opened has this still" over the typed bridge; the SHELL picks the key, checks the
bytes, stores them, and answers with that canvas's stills only.

**Messages** (`bridge/dgn-protocol.ts`; gate `active` on the shell, `parent` on the canvas):

| message | dir | payload | caps |
| --- | --- | --- | --- |
| `stills-want` | c→s | `{ file }` | sent once per canvas document; the shell answers once per frame window |
| `still-put` | c→s | `{ file, artboard, sig, bytes: ArrayBuffer }` | `bytes` a still WebP or PNG (below); `sig`, `artboard` ≤ 200 |
| `stills` | s→c | `{ file, items: [{ artboard, sig, bytes }] }` | ≤ 2000 items, each checked again by the canvas |

**Scope — what the shell checks before it reads or writes** (`client/v2/shell/still-bridge.js`):

1. the origin, then the `active` gate: `e.source` is the window of the shell's own iframe for `activePath`;
2. `file === activePath` — the frame's word and the shell's own state must agree, so a message a document posted
   just before its frame showed another canvas never lands on the new one (the target comes from the shell, as in
   gate-b-c4b; the frame's word can only narrow it);
3. the shell's own iframe `src` is a plain open: no `sha` (a version), `embed`, `follow`, `hide-chrome` or
   `thumbnail` — a still of another version never stands for today's;
4. the project index has a row for that canvas (`GET /_api/index`, the snapshot the Canvases panel already reads).
   No index (a cell, an older server) = no persistence; nothing is stored blind;
5. for a WRITE (`still-put`) only: the frame is the only frame of the canvas origin mounted in the shell, and no two
   were mounted at once at any point of this session (`createSiblingGuard`, below: Named gap). Reads are not held to
   this — a sibling could read the active frame's DOM anyway.

**Answers.** One `stills` answer per frame window (`contentWindow`): a second `stills-want` from it gets nothing —
also after the frame reloads in place, which then draws its stills as before. The answer's buffers go in the
transfer list (no copy). A read refreshes a record's place in the eviction order only when its last refresh is
older than 10 minutes, all of an answer's refreshes in one write.

**Key — chosen by the shell, never by the frame.** One record per (project, canvas scope, artboard):

- project = the index `pid`;
- canvas scope = a SHA-256 of the frame's per-frame capability `frameCapFor(cfg.frameKey, rel)` (C4: a MAC over the
  canvas path under the opener's per-subject key; `stillScopeOf`), so another person on the same browser profile, or a
  session with other access, never reads these stills, and the store holds neither the capability nor the path;
  without a key (the origin split off) a SHA-256 of the plain `rel`. Records of the first shape (keyed on the plain
  capability) are deleted when the store opens (`STILL_RECORD_V`);
- source = the index row's `srcHash`, `metaHash` and `depsHash` (computed by the server; the canvas cannot name them).
  A record whose source differs from the row's is never returned, and is deleted when its canvas asks;
- `artboard` is the one part the frame names, and only inside the scope above.

**Bytes.** Accepted only as a real still WebP **or a single-image PNG** (`bridge/still-webp.ts` `checkStillImage`, which
names the format from the first bytes). WebKit — Safari and the desktop app, the main target — has no WebP encoder:
`toBlob(cb, 'image/webp')` answers `image/png` there (measured in WebKit: IHDR, sRGB, eXIf, IDAT…, IEND; ~114 kB for a
text-heavy 400 × 900 still), so a WebP-only check stored nothing on Safari. Both are checked by what they are; the
shell never decodes either, the canvas does, in its own origin.

- **WebP** (`checkStillWebp`): `RIFF`…`WEBP` with a RIFF size equal to the buffer's, a first chunk `VP8 ` (key frame,
  start code `9d 01 2a`), `VP8L` (signature `2f`) or `VP8X` (no animation flag), width ≤ 401 and height ≤ 1601 read
  from the bitstream header.
- **PNG** (`checkStillPng`, a structural walk, CRC-free): the 8-byte signature; `IHDR` first, 13 bytes, width ≤ 401
  and height ≤ 1601 (neither 0), a bit depth valid for its colour type, compression 0, filter 0, interlace 0 or 1;
  every chunk's length within the bytes left after it (compared against the remainder, never summed); only the chunks
  a canvas encoder writes (`PLTE IDAT IEND` + `sRGB gAMA cHRM iCCP pHYs sBIT bKGD tRNS eXIf`) — a second `IHDR`, text
  or any other chunk refuses it; the `IDAT`s one run; no APNG chunk (`acTL fcTL fdAT` → animated); a palette image has
  its `PLTE`; `IEND` empty and the last bytes of the buffer (nothing trails the image).

≤ 256 kB per still for either (measured: ~18 kB WebP, ~114 kB PNG). The format is not a field on the wire or in the
store: it is read from the checked bytes each time (`stillMime`), so the frame cannot name a MIME the bytes do not
have, and the canvas seeds its cache with a blob of that MIME.

**Caps and eviction** (`client/v2/shell/still-store.js`): 256 kB per still; per canvas 2000 stills and 8 MB (its
share of the project); 32 MB per project; 96 MB per store; per canvas 300 writes and 2 MB a minute (a planted canvas
cannot churn the disk). Over a cap a canvas pays for its own write first: its own records go, used longest ago
first. Another canvas's records go only when the project (or store) cap still holds after that, oldest first — so
one canvas's burst never flushes another canvas, and what it loses tells it nothing about another canvas's use.

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

**Named gap — and the rule that keeps it out of the store.** Every canvas frame mounted at once shares the one canvas
origin (CLAUDE.md, C4 named gap): a sibling frame can run code in the active frame's realm and post `still-put` as it.
In memory that changes only the stills of the canvas on screen, to pictures it could already draw into that canvas's
DOM, and ends with the frame. Persisted, it would outlive the sibling: a forged still shown for the other canvas in
later sessions, seen by no headless check. So the shell stores a still only while its frame is the one frame of the
canvas origin mounted, and nothing for the rest of the session once two were mounted at once — kept-alive tabs, the
System gallery, a version view or a compare pane all count (`createSiblingGuard`, a `MutationObserver` over the
shell's own iframes, started when the shell loads, latched per origin). A sibling that left may have changed the
active frame's realm or its origin's own state before it went, so a frame mounted alone afterwards is not trusted
either. A release build also keeps the still runtime's `__maudeStill*` globals off the window (`stillDiagnosticsOn`;
the canvas build gets the server's `__MAUDE_RELEASE_BUILD__` through `canvasDefines`) — hygiene, not the fix: a
same-origin sibling reaches every object in the realm anyway.

**Cost and residual risk.** With two or more canvas frames ever mounted in a session (the common case: kept-alive
tabs), that session writes no stills; it still reads and shows the ones written in single-frame sessions. Not
covered: a sibling that plants something in the canvas origin's own storage while it is the only frame — that
storage lasts one server run (the canvas origin listens on a new port each run), and nothing on the still path reads
it; and a frame the shell does not mount (a popup a canvas opens) is outside the count. Records are not flagged after
the fact: what a single-frame session stored stays; the shell cannot tell a forged still from a real one, so the rule
is about when to store, not what. Closing the gap for good needs a distinct origin per canvas.
`framesIsolated` (canvas-only sessions) mounts only the active frame.

**Why not on disk next to the thumbnails** (`~/.maude/index/v1/projects/<pid>/`): the same scope and checks would need a
new main-origin route (the route table, the writer registry, the hub manifest — all lead-owned) for no gain in trust:
the shell that checks the bytes is already the trusted side. One cost: IndexedDB is per origin, so a project whose
port changes starts with an empty store (the old one stays capped at 32 MB).

**Tests** — `test/v2-212-still-persist.test.ts`: a frame cannot read or write another canvas's stills; an oversized,
non-WebP/PNG, animated or too-large-in-pixels payload is refused (bridge and store); a record of another source is not
returned and is deleted; a reload shows the persisted still before any drawing (restored from the seed, no take), and
a seed whose signature differs is not shown. `test/v2-212-still-persist-guard.test.ts`: no still is stored beside a
sibling canvas frame or after one came and went; release builds expose no still globals; one answer per frame window,
buffers transferred, refreshes batched; 2 MB a minute and 8 MB per canvas; a canvas's writes evict its own records
first; the key is a SHA-256 of the capability and records of the first shape are deleted. `test/v2-212-still-png.test.ts`:
a real PNG (WebKit's chunk layout) passes, a bad or misplaced IHDR, oversize dimensions, APNG, a chunk length past
the buffer, trailing bytes, a missing IDAT/IEND or an unknown chunk is refused (bridge and store); on a canvas whose
`toBlob` answers PNG to a WebP request the still is offered, kept and, after a reload, restored as `image/png` with
no drawing.
