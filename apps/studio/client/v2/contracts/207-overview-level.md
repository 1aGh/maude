# 2.0.7 — the overview level: under the cut an artboard shows only its still

Michal (2026-11-07, after two local test apps on studyfi-207 `mascot-exploration.tsx`): both builds still stutter;
below some zoom show ONLY stills, even settled; live content only when zoomed in enough; the flicker (black square →
skeleton → still → live) must become one change per artboard; cache the stills and keep them. This replaces the
gesture-only stills of [`207-overview-stills.md`](207-overview-stills.md) (decision
`v2-michal-207-overview-stills-always-no-flicker`). Branch `fix/207-overview-level` (base: the stills branch at
`00032a82f`; measured base: the release tip `d74d94df1`).

## Decision

1. **The rule** (`artboard-still.ts` `inOverviewCut`, `targetView`). An artboard narrower than `STILL_MAX_SCREEN_PX`
   (**200 CSS px**, unchanged — see "The cut") on screen at the settled zoom shows its still. Over the cut it is
   live. Never a still: `pinned` (the active artboard, the one holding the selection — clicking an overview artboard
   selects it and so brings it live; text editing happens in a selected artboard) and `eager` (video artboards).
   WebKit only (`resolveStillMode`, `?artboard-still=on|off` wins); the heavy-canvas gate is gone — the rule is the
   same on every canvas, so a pan into a light region never flips artboards between still and live.
2. **Under the stand-in the body's children leave the render tree**: `display: none` on `.dc-artboard-body > *`, the
   body keeping its box through `--dc-still-h` (its height when it went under). The DOM, ids, React state and the
   mount ring stay as they are — nothing unmounts. Measured floor below.
3. **One visual sequence per artboard** (`StillView`): `cover` (the own-colour stand-in, only while nothing better
   exists and the body has never shown live) → `still` → `paint` (the body shown UNDER the still) → `reveal` (the
   still fades out over `STILL_REVEAL_MS` = 140 ms) → live. `paint` → `reveal` waits two frames, then the body's
   pictures `decode()` and `document.fonts.ready` (bounded at 400 ms). A still is replaced only by a newer still
   (its content changed) or by live; never by the cover. A live artboard zoomed out under the cut swaps to its still
   at once if it has one, else stays live until it is drawn (live → still is then its one change). A zoom back out
   during a hand-over cancels it (back to the still). The hand-over is paced (2 quiet frames, then 1 → 2 → 4 a frame,
   back to 1 after a frame over 20 ms, paused by gesture input).
4. **No black square.** The frame (`.dc-artboard`) paints `var(--dc-own-bg, var(--bg-0))`: the gate sets
   `--dc-own-bg` to the artboard's known colour (measured body background, else its `background` prop, else the
   canvas's) as soon as it is known, so an unpainted body, a content-visibility skip or an unpainted WebKit tile shows
   the artboard's colour, never the dark DS `--bg-0`. The stand-in sits outside the body (`z-index: 1` child of the
   article), so the body's `content-visibility: auto` never blanks it. The gate placeholder's skeleton bar is gone
   (flat own colour), and a released artboard's placeholder shows its kept still (`StillCopy`).
5. **The cache** (`StillCache`): per canvas document (the runtime lives on `window`, so it survives an edit's soft
   reload; `RUNTIME_SHAPE` 3), by artboard id, with a content signature (FNV-1a of the body markup + its size). A
   remount shows the kept still at once and redraws only when the signature changed; a DOM change (`isPaintMutation`)
   or a wake/sleep marks it stale (the stale still keeps standing in until redrawn). Bounded at 96 MB of bitmap, LRU,
   never dropping a still that stands in. Still canvases are `STILL_MAX_SCREEN_PX × 1.5 × dpr` wide (unchanged).
6. **Persistence: not in this change** (see "Persistence" — the safe design goes through the shell).

## Measured

Harness (`/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov2/`): **a
new in-frame full-sweep recorder (`sweep.js`), not `perf.sh`** — `perf.sh` has no full sweep, and the same script runs
in Safari (safaridriver, `wk.mjs`), Playwright Chromium and Playwright WebKit (`pw.mjs`). Lanes (Michal's primary
lanes): `sweep` — a serpentine pan over the whole world bounds (the articles' own geometry) at 1200 px/s, every
artboard passes through the 1600 × 920 viewport; `zoomcycle` — 30 ctrl-wheel notches in (~2.3 ×) and 30 out at the
max-on-screen zoom (fit: mascot 2.65 %, 88 on screen); `zoomsweep` — that cycle at 10 %, then the sweep 300 ms after.
Per frame: dt, artboards on screen, mounted, each on-screen artboard's visual state. Isolated APFS copy of
studyfi-207 (linkedHub / `_sync.json` / `_state` stripped), private server, `caffeinate -d`, display on; base = the
release tip `d74d94df1` (its runtime files swapped in, `arm.sh`), fix = `354d12fc5`; paired and interleaved per lane;
every row's 1-min load ≤ 5.9 (`waitload 6`). ms; "worst 1 s" = fewest frames in any 1 s window of the lane.

**Mascot, Safari** (three rounds, base / fix):

| lane | on screen max/avg · mounted avg | p95 | p99 | long ≥ 50 | worst 1 s (frames) | settle max |
| --- | --- | --- | --- | --- | --- | --- |
| sweep 10 % | 51/31 · 13 | 317 · 197 · 204 / **53 · 37 · 37** | 386 · 291 · 259 / 94 · 59 · 90 | 34/136 · 29/154 · 28/157 / 13/249 · 7/283 · 9/263 | 4 · 7 · 6 / **23 · 53 · 37** | 502 · 340 · 273 / 98 · 80 · 125 |
| zoomcycle fit 2.65 % | 88/69 · 60 | 1299 · 907 · 982 / **88 · 70 · 92** | 1478 · 1643 · 1678 / 114 · 141 · 152 | 31 · 25 · 25 / 5 · 4 · 4 (of 60) | 1 · 1 · 1 / **39 · 41 · 31** | 260 · 35 · 19 / 29 · **107 · 124** |
| zoomsweep 10 % | 51/27 · 13 | 169 · 172 · 154 / **53 · 52 · 54** | 330 · 258 · 300 / 88 · 135 · 137 | 58 · 61 · 56 / 21 · 18 · 22 | 6 · 9 · 8 / **18 · 17 · 17** | 329 · 192 · 340 / 112 · 82 · 247 |

**Mascot, Chromium** (stills are off there; rounds 1–3): sweep p95 8.1 · 8.2 · 8.2 / 8.0 · 8.6 · 14.5 (r3 load 5.9),
zoomsweep 8.3 · 8.7 / 8.6 · 8.5 — the same. The fit-all zoomcycle is Chromium's own cliff in BOTH arms: p95 234–266 /
158–184 and one 5.9–17 s frame per run (mounting ~60 artboards at once) — not this change; a finding.

**DS and math-learning-spaces** (one round; Safari unless noted): DS sweep 10 % p95 16 / 16 (its artboards are
over the cut at 10 %, so nothing is a still), DS zoomcycle 44 / 42, DS settle max ~400 in both arms (DS's own);
DS zoomsweep p95 16 · 16 / 16 · 16 (rounds 2–3; round 1's fix row, p50 29 over 1201 frames, did not repeat). Math sweep p95 19 / 24, p99 49 / 40; math zoomcycle (81 on screen) 80 / **51**; math
zoomsweep 28 / 24. Chromium DS and math: the same in both arms (8 ms p95 sweeps).

**The cut** (Safari, mascot, children out of the render tree vs live, one session per zoom): at 10 % (28 on screen,
132–160 px) zoom p95 44–60 vs live 526–890 (pre-fix session, load 3.5–11); at 20 % (5 on screen, 320 px) 15 vs 16;
at 30 % (2 on screen, 480 px) 17 vs 17. Sweeps at 20 / 30 % are base = fix (Safari p95 57 / 52, 17 / 17). So the
cost is paid where many artboards are small, and gone by 320 px: the cut belongs between 160 and 320. **200 stays**
(it engages Michal's 10 % lane with margin; 120 would change nothing there — still his call).

**Cold open and sizes** (Safari, fix, mascot 10 %, dpr 1): 1.9 s after the frame started 5 of 28 on-screen
artboards were stills and 22 covers; 27 of 28 by 16.9 s (the 28th is the active artboard, live by rule). A still is
300 × 653 px: 438 KB of bitmap (27 = 11.8 MB; after a fit-all 65 = 20.2 MB; WebKit at dpr 2: 1.5 MB each). As
blobs: **WebP-80 30.8 KB, JPEG-80 18.3 KB each** (27 = 833 / 494 KB), encoding all 27 both ways 85 ms. Re-open with
stills at once: not measured — no persistence yet (below).

**Flicker** — the visual states each artboard went through while in view during the mascot 10 % sweep (88
artboards; Safari, the three rounds agree within ±2):

| sequence | base | fix | visible changes |
| --- | --- | --- | --- |
| placeholder only (never mounted while passing) | 44 (skeleton bar) | 42 (flat own colour) | 0 |
| live from the start | 28 | 1 (the active one) | 0 |
| still from the start | — | 26–27 | 0 |
| placeholder → live | 16–18 | — | 1 |
| placeholder → cover (same flat colour) | — | 15–17 | 0 (cover = placeholder colour) |
| placeholder → cover → still | — | 1–2 (5 on math) | 1 |
| still → released (kept still copy) → still | — | 1–6 | 0 |
| active artboard: cover → paint → reveal → live | — | 1 | 1 |

No artboard ever showed the bare frame: in every recorded state of every run an on-screen artboard had either its
body, its still, its cover or its placeholder, and the frame paints the own colour underneath. The frame strips
(below) show no black square. The automatic pixel classifier of the strips (`strip.mjs`) is NOT validated (it found
no flat region even for the flat placeholders — a coordinate mismatch), so "0 black frames" rests on the DOM states
plus looking at the strips. **What the fix does show on a first pass through a never-seen region: flat own-colour
blocks** where base mounted live content for 16–18 artboards (strip `webkit-fix/f010.png`) — a still is drawn only
after 600 ms of quiet, so a continuous sweep never gets one. A revisit shows the kept stills.

Frame strips (contact sheets, one frame every ~120 ms; Playwright, zoomsweep at 10 %):
`/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov2/strips/webkit-base/strip.png`,
`/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov2/strips/webkit-fix/strip.png`,
`/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov2/strips/chromium-base/strip.png`,
`/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov2/strips/chromium-fix/strip.png`
(frames `f000.png`… beside each).

**Ship gates (coordinator):** sweep-after-zoom at or below base — **met** (Safari 154–172 → 52–54 p95); zoom gain
kept — **met** (fit-all zoomcycle 907–1299 → 70–92); 0 black / empty frames — **met by DOM state** (pixel check not
validated); settle max within one frame of base — **met on sweep and zoomsweep, NOT on the fit-all zoomcycle**
(base 19–260, fix 29–124: two of three rounds 70–105 ms over) — most likely the still drawings that resume 600 ms
after the settle (draws of up to 114–138 ms wall time, `takes.max`) inside the 1.2 s settle window.

## Round 2 and 3 (2.0.7 follow-ups): sliced stills, the settle hold for pans, the warm-up

Round 2 (`615a2c7c3`, "prev" below): stills are drawn in slices (`artboard-still-raster.ts` `startStill`) within a
per-frame budget (`STILL_PAN_BUDGET_MS` 4 / `STILL_IDLE_BUDGET_MS` 8), also mid-pan, and nothing is drawn for
`STILL_SETTLE_HOLD_MS` (1.2 s) after a zoom settles — that fixed the fit-all settle max (gate above). Round 3:

1. **The hold applies to pans too** (`a10b5dd8e`): a pan inside the 1.2 s after a zoom no longer draws. Kept — it is
   cheap and never worse — but it does **not** bring sweep-after-zoom to ≤ 55: the zoomsweep's sweep runs mostly
   past the hold, and what costs is drawing during a pan at all (control "nopan" below: no drawing mid-pan).
2. **The warm-up** (`127f6794c`, `artboard-still-warmup.ts`): after the open, while nothing moves, it mounts each
   never-mounted artboard far away, asleep, within the DOM budget (`LiveRegistry.setWarm`), lets the controller
   draw its still, and releases it at once — its placeholder then shows the kept still. One at a time; only after
   `WARM_QUIET_MS` (1.5 s) without input or camera move, with the controller quiet (no gesture, past the hold, no
   hand-back, nothing being drawn) and the ring's mounts done (`WARM_RING_QUIET_MS` 300); any input pauses it at
   once (a mount not made yet is withdrawn; a made one is released only once quiet); never past the DOM budget or
   the still cache's bytes (a dropped still would be warmed again forever); never pinned / eager (video) / near /
   on-screen / over-the-cut artboards; each once per document. **It ships OFF** (`WARM_ENABLED = false`,
   `71a7b2784`) — the numbers below.

Harness `/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov3/`
(`batch2.sh`–`batch5.sh`, `lane.sh`, `sweep.js`, `warmrun.sh` + `warmprobe.js`, `stripsafari.sh`, `agg2.py`): real
Safari (safaridriver), mascot, window 1600 × 1000, dpr 1, `caffeinate -d`, every row's 1-min load 2.9–5.9 (bar 6).
Arms, each its own server and APFS project clone: **base** `d74d94df1` · **prev** `615a2c7c3` · **nowarm** this tip
with the warm-up off (= the shipped state) · **fix** the warm-up on · **nopan** nowarm with no drawing mid-gesture
(control) · **warmon** = fix on nowarm's tree lineage (A/A). Lanes opened 8 s after the artboards appear unless "@45 s".

| lane (p95 ms, rounds) | base | prev | nowarm (shipped) | fix (warm-up on) | nopan (control) |
| --- | --- | --- | --- | --- | --- |
| sweep 10 % | 213 · 213 · 197 | 56 · 51 · 50 | **49 · 45 · 49** | 59 · 47 · 47 | 42 · 47 · 40 (vs nowarm 49 · 64 · 52) |
| zoomsweep 10 % | 164 · 153 · 167 | 68 · 58 · 61 | **66 · 66 · 63** | 50 · 58 · 58 | 87 · 52 · 53 (vs nowarm 67 · 62 · 56) |
| zoomcycle fit 2.65 % | 1326 · 970 · 1049 | — | **78 · 69 · 89** | 76 · 63 · 75 | — |
| settle max: sweep / zoomsweep / zoomcycle | 270–278 / 189–300 / 25–33 | 208–219 / 116–121 / — | 120–158 / 144–195 / **30–37** | 166–192 / 165–182 / 20–30 | — |

**@45 s (the warm-up finished on fix):** sweep fix 41 · 48 · 61 vs nowarm 44 · 54; zoomsweep fix 60 · 56 · 57 · 60 ·
84 (one 258 outlier) vs nowarm 67 · 75 · 61; **zoomcycle settle max fix 40–53 (6 rows), warmon 39–48 (3) vs nowarm
24–42 (6)** — over base 25–33 by 1–1.5 frames, though that cycle warmed 0 artboards (all 88 on screen at fit);
p95 fix 71–115, warmon 92–116, nowarm 63–98. Cause not found (the warm-up is idle there: it waits 1.5 s of quiet,
the settle window is 1.2 s).

**The warm-up at idle** (Safari, two runs): 57 artboards warmed in **26.8 s** (both runs), 0 failed, cache 30 → 84
stills (12 → 24 MB; of the 4 without one, one is the active artboard, the other 3 not identified), mounted 28–29 / 8.5k elements
throughout (budget 12k). The canvas's WebContent process: CPU mean 34–43 % over the 30 s (peaks 122–154 % in the
first 2 s — the open itself), RSS 0.75–0.9 GB → 1.35–1.44 GB at the end (nowarm 0.77–1.0 GB after the open).
Playwright WebKit (dpr 2): at 1600 × 1000 the on-screen artboards already weigh 17–19k elements, so the warm-up
mounts nothing (`full: budget`); at 1100 × 700 it warmed 67, and every placeholder copy has content (37 % of its
pixels off its dominant colour, median; 0 flat). **At dpr 2 the cache (96 MB) holds ~64 stills**, so the warm-up
stops at `full: cache` before 88.

**Flicker / first pass** (mascot sweep at 10 %, on-screen states per artboard, Safari):

| | nowarm (shipped) | fix @ 8 s (warm-up running) | fix @ 45 s (warm-up done) |
| --- | --- | --- | --- |
| covers on screen (mounted, no still yet) | 18 | 10 | **0** |
| placeholder never mounted, flat own colour | 42 | 32 | **3** |
| placeholder showing its kept still (DOM) | 0 | 9 | **39** |

**But the Safari frame strips show the warmed placeholders as blank as the flat ones** — same white blocks in both
arms (`out/strip-nowarm/strip.png`, `out/strip-fix/strip.png`, frames `f00–f11.png`, crops `f04-crop.png`, under the
harness dir). Playwright WebKit draws the same copies with their pictures, so most likely Safari draws a far
artboard's still before its pictures load or decode (the walk is `content-visibility`-skipped there) — **not
verified** (no Safari time left in the slot): `stillcheck.sh` / `stillcheck.js` measures it in one run.

**Verdict.** The pan hold ships (sweep 10 % 45–49 ≤ 50 ✓; sweep-after-zoom 63–66, unchanged from prev 58–68 — the
≤ 55 bar is **not met**). The warm-up is a bad trade as it stands: it does empty the first pass in DOM terms (0
covers, 3 flat) and helps sweep-after-zoom (fix 50–58 / 56–60 vs 63–75), but it pushes the fit-all settle max over
base, holds ~0.4 GB more, and in Safari its placeholders look no different. **Chromium** (stills and warm-up off
there, base / fix, Playwright, load 3.5–5.9): sweep p95 8.4 · 8.5 / 9.8 · 8.5, zoomsweep 8.3 · 9.3 · 10.8 /
8.6 · 17.3 · 12.3, zoomcycle 183 · 212 / 212 · 210 (its own fit-all cliff in both) — no regression.

Fail-first (`ff2.sh` + `ff2.py`, each rule reverted on a copy, the current tests): overview-level 24 — parent red 1,
`pan-exempt` red 1 (the pan-hold test), real 24/0; warm-up 11 — parent red (no module), `warm-no-quiet` 3 red,
`warm-no-withdraw` 1, `warm-no-budget` 1, `warm-no-cache` 1, `warm-no-once` 2, `warm-release-busy` 1,
`warm-release-grace` 1, `warm-quiet-drawing` 1, real 0 red. The `eager` exclusion in `warmCandidates` has no
red variant: an eager artboard is always mounted in `sleep`, so `admitted` already excludes it (kept, defensive).

## Round 4 (2.0.7): the gesture freeze — an artboard does no work of its own while the camera moves

Michal: "while you pan or zoom, artboards must not redraw … the user notices nothing." Above the cut (or the
active artboard) an awake artboard kept running its own rAF loops, motion, Remotion, WebGL and video mid-gesture.

1. **The frame gate** (`plugins/design/templates/_shell.html`, script `maude-frame-freeze`; `frame-clock.ts`).
   The canvas frame's shell replaces `window.requestAnimationFrame` / `cancelAnimationFrame` BEFORE any module
   loads, so the canvas runtime gets the gated one too (motion's frameloop captures the function when
   `motion_react.js` evaluates; Remotion's Player, pixi and canvas code look it up per call). While frozen, a
   callback asked for or coming due is held; the thaw runs the held ones on the next frame, in request order, with
   that frame's timestamp; a cancel still reaches a held one; a callback that throws does not stop the others; a
   gesture that starts again mid-flush keeps the rest held; a freeze not renewed for 2 s thaws itself (watchdog).
   The runtime bundles are untouched (`dist/runtime/*` not regenerated). `__maudeFrameFreeze` (non-writable)
   carries the exempt `raf`, `caf`, `set`, `frozen`, `on`, `stats`.
2. **Maude's own frame code is exempt**: every rAF call in the frame's import graph (canvas-lib's + the comment
   layer's, 54 files, 172 calls) goes through `frameRaf` / `frameCaf` / `frameRafOn(win, …)`, the inspector's
   injected pins and `maude design perf`'s samplers/pacers take `__maudeFrameFreeze.raf`. So the camera's
   animation, the gesture's own quiet frame (`afterQuietFrame` — gated, the gesture would end only on its 1 s
   fallback), the ring's queue, the stills' slices and every chrome loop that follows the camera (halos, comment
   pins, caret, toolbars) never wait. `test/v2-207-gesture-freeze.test.ts` fails on a bare call.
3. **canvas-lib** renews the freeze on every camera input (`markInteracting`) and thaws it at the gesture's end
   (`endInteracting`) and on an unmount mid-gesture. A programmatic camera move (fit, jump) is a gesture too.
4. **What runs without a frame callback** (`artboard-freeze.ts`, on the freeze's transitions, in the awake
   artboards that show their body — an asleep one is paused already, one under its still renders no body): CSS
   animations (`data-dc-frozen`, the `data-dc-asleep` rule), scripted Web Animations (paused / played; a CSS
   animation or transition is left to the attribute — `pause()` on one would detach it from
   `animation-play-state` for good and break the sleep rule), silent `<video>` not owned by a VideoComp. A video
   WITH sound plays on (a pan must not cut the sound). The thaw resumes exactly what the freeze paused, if still
   paused and connected. Remotion's Player is frozen through its rAF loop (its audio plays on).
5. **The ring changes nothing mid-gesture** (`artboard-live.ts`): no sleep, no media release, no unmount, no
   eviction (a mid-gesture on-screen mount goes past the budget up to the ceiling; the settle frees the excess from
   the off-screen ones, farthest first). On screen, only what would otherwise show a block mounts: an artboard
   under the cut waits (`setMayWait`, the gate's `inOverviewCut` at the live zoom); the active and video ones
   never wait. `churnStats()` (in `__maudeWebglStats().churn`) counts mounts, releases and mid-gesture changes.
6. **Timers are not held** (documented): canvas-lib's own gesture end, settle and publish run on `setTimeout`,
   React's scheduler and every library share them; deferring them would delay the gesture's end and Maude's own
   React work. A canvas opts in with `useArtboardGesture()` (re-renders only its caller) to skip a tick.

Rejected: deferring every global rAF without routing Maude's own code (every chrome loop that tracks the camera
by `getBoundingClientRect` — halos, comment pins, the caret — would freeze in screen space while the world moves);
a build-time shadow of `requestAnimationFrame` in Maude's modules (touches the C4 build/judge pipeline; canvas
code and canvas-lib share one bundle scope, so a banner would exempt the canvas too); telling Maude's callers
from the canvas's by stack (both live in the same bundled module URL); `MotionGlobalConfig` (no pause, only
`skipAnimations` / manual timing that still runs every frame); `getAnimations().pause()` on CSS animations
(detaches them from `animation-play-state`, the sleep rule stops working); wrapping timers (above).

Tests: `test/v2-207-gesture-freeze.test.ts` (10: the gate on a fake window, extracted from the real shell; the
routing ratchet; the perf and pin clocks), `test/v2-207-gesture-freeze-canvas.test.tsx` (a wheel pan on a mounted
canvas in `sleep`: an artboard's own rAF loop does not tick, its article carries `data-dc-frozen`, the silent
video pauses and the one with sound does not, the gesture ends on its own quiet frame < 600 ms after the last
wheel, all of it resumes), `test/v2-207-gesture-ring.test.ts` (3). Fail-first (`scratchpad/ff/ff.sh`, each rule
reverted on an APFS clone): parent 14 red; no-shell-gate 8, camera-not-exempt 2, no-hold-when-due 6,
cancel-misses-held 1, flush-ignores-refreeze 1, no-watchdog 1, quiet-frame-gated 2, canvas-no-freeze 1,
canvas-no-thaw 1, artboards-not-frozen 1, pauses-loud-video 1, no-media-resume 1, no-css-resume 1,
ratchet-bare-call 1, ring-downs-mid-gesture 1, ring-evicts-mid-gesture 1, ring-no-wait-under-cut 1,
ring-pinned-waits 1, ring-no-settle-trim 1, perf-gated-clock 1; the fix 14/0.

Measured: see "Round 4 — Safari" below (filled after the Safari slot).

## Persistence — the safe design, and why it is not in this change

- **Frame-side storage (IndexedDB / Cache API on the canvas origin): rejected.** Every canvas frame shares that one
  origin (C4's named gap), so a canvas could read every other canvas's stills — a layout leak in a canvas-only
  session (`framesIsolated`). It would not even persist: the canvas origin listens on port 0, a new origin every
  spawn.
- **The safe design: the trusted shell keeps them.** The frame posts each finished still to the shell (a bridge
  message carrying `{ artboard, sig, w, h, blob }` — WebP); the shell keys it by the canvas of the SENDING frame
  (`event.source` → its frame → its canvas path, never a path the frame names), so a frame can only write its own
  canvas's stills and is only ever seeded with them. Main-origin memory survives a frame reload and a close/re-open
  within the app run; a main-origin IndexedDB copy (keyed by project root + canvas + artboard + sig; the main origin
  runs only trusted shell code — repo documents there are opaque-origin sandboxed) survives a restart only when the
  project lands on the same ladder port (46399–46408), so the shell must also key by project root. The same cache
  lets the shell's opening skeleton (`client/v2/shell/opening-skeleton.js`, `.sh-opening-skel`) draw each artboard as
  its still instead of a chrome-coloured box — today's open sequence is canvas backdrop → chrome skeleton → frame
  placeholder / cover → still, and that first box is a colour change Michal sees as "a skeleton flashes".
- **Not done here:** it touches the dgn bridge and the shell (shared files, dist rebuild) — a follow-up with an owner.
  A server route under `_cache/` (already in all four runtime-state lists and the hub mirror) was considered for a
  cross-restart copy; it needs a main-origin route with the per-canvas access gate, more surface than a 2.0.7 patch.

## Rejected alternatives

- **Gesture-only stills** (the previous branch): pan right after a zoom 1.5 × base, settle up to 202 ms — every
  settle handed every artboard back and painted it at the new zoom. Superseded by the user's decision.
- **`visibility: hidden` on the body** (the previous mechanism) and **`content-visibility: hidden`**: same session,
  Safari, mascot 10 %: zoom p95 89 and 150 ms against 44 with the children out of the render tree (live 526).
  `visibility` keeps style, layout and the layer tree; `content-visibility: hidden` measured worse than expected
  (likely the size-containment re-layout per scale step) — neither kept.
- **`display: none` on the body itself**: same cost as the children, but the artboard's frame collapsed (summed
  article height 107 701 → 176 px) — its geometry is the body's.
- **Unmounting the children under the cut**: the same render cost as `display: none` with the DOM kept, plus a React
  unmount/mount at every crossing and no way to verify a still's signature or redraw it after an edit.
- **The overview level in Chromium**: its sweep frames are 8 ms p95 on mascot at 10 % with or without stills (GPU
  raster) — drawing them would be pure cost. WebKit only (measured, not assumed).
- **The own-colour cover mid-gesture for an artboard that has no still**: a jump to a flat block while zooming;
  such an artboard stays live until its still is drawn.

## Interface (builders)

- `artboard-still.ts`: `STILL_MAX_SCREEN_PX` (the cut), `STILL_REVEAL_MS`, `STILL_CACHE_MAX_BYTES`, `STILL_ATTR`
  (`data-dc-still` = `cover | still | paint | reveal`), `STILL_CLASS` (the stand-in `<div>`, the still `<canvas>` its
  child), `StillView`, `inOverviewCut`, `targetView`, `contentSignature`, `StillCache`, `StillController`
  (`register(id, target, { pinned, eager })`, `update`, `markDirty`, `setZoom`, `noteZoom`, `settle`, `viewOf`,
  `history`, `stats`), `ARTBOARD_STILL_CSS`. `stillEligible` / `stillWanted` / `isPaintMutation` /
  `resolveStillMode` kept.
- `artboard-live-gate.tsx`: registers in a LAYOUT effect (hidden before the first paint); `--dc-own-bg` on the
  article; `StillCopy` in the released placeholder; `window.__maudeStillStats()` (views, takes incl. `reused`,
  cache n/bytes) and `window.__maudeStillHistory(id?)` (the views each artboard went through — the flicker count).
- `artboard-placeholder.ts`: `knownBackground(id, background)`.
- `canvas-lib.tsx`: `.dc-artboard { background: var(--dc-own-bg, var(--bg-0, #ffffff)) }`.
- Anything that reads an overview artboard's DOM geometry still can (the DOM never leaves); its painted pixels are the
  still's. A capture never runs it (`liveMode: 'off'`).
- Rounds 2–3: `artboard-still.ts` `STILL_PAN_BUDGET_MS`, `STILL_IDLE_BUDGET_MS`, `STILL_SETTLE_HOLD_MS` (pans too),
  `STILL_MAX_DECODING`, `STILL_WALK_ATTR`; `StillController.quiet(drawing?)`, `lastActivity()`, `zoomNow()`,
  `hasStill(id)`, `onStill(fn)`; `StillCache.max`; `__maudeStillJobs()`. `artboard-still-warmup.ts`:
  `WARM_ENABLED` (false), `WARM_QUIET_MS`, `WARM_GAP_MS`, `WARM_POLL_MS`, `WARM_STEP_MAX_MS`, `StillWarmup`
  (`kick`, `input`, `wake`, `stillDone`, `stop`, `stats`) over a `WarmHost` adapter. `artboard-live.ts`
  `LiveRegistry.setWarm`, `isMounted`, `warmCandidates`, `lastMountAt`. Gate: `startWarmup` (only when
  `WARM_ENABLED`), `window.__maudeStillWarm()`, `RUNTIME_SHAPE` 4.

## Tests

`test/v2-207-overview-level.test.tsx` (17) — the cut; under the cut a settled artboard stays its still (no
hand-back); pinned / video never; a selection under the cut brings it live through paint → reveal → live; a pure pan
changes nothing; a fresh mount is cover → still, never cover again after a still; zoom-in: the still holds
mid-gesture, the settle paints under it, then it fades; a zoom back out cancels the hand-over; a live artboard zoomed
out swaps to its still at once or stays live until drawn; `targetView` per view; the cache: a remount shows the kept
still with no cover and an equal signature is not redrawn, a changed one is; a remount over the cut hands over from
the kept still; the LRU byte budget never drops what stands in; the signature; a hidden body is shown for the walk
only; the CSS; mounted: the frame takes its own colour, no skeleton bar, the gate registers. 
`test/v2-207-overview-stills.test.tsx` keeps the shared predicates (3). Rounds 2–3 brought
`v2-207-overview-level` to 24 (pan drawing, the settle hold incl. a pan in it, the frame budget, a change while
drawn, the decode pipeline, the walk CSS, the sliced job mounted) and added `test/v2-207-still-warmup.test.ts` (11:
the switch is off; one at a time nearest first after the quiet, released once drawn; input withdraws an unmade
mount; a made one is released only when quiet; camera moves count as input; DOM budget, cache bytes, has-a-still,
over-the-cut and tried-once skips; the step timeout; the settle wakes it; the registry's warm mount — far, asleep,
within budget, released at once, never mid-gesture; light mode and captures offer nothing; the controller's
`quiet()` / `onStill`). Their fail-first table is in round 3 above.

Fail-first (`ff2.sh`, each rule reverted on a copy of `artboard-still.ts`): real 17/0 · base (`00032a82f`) red (the
module lacks the API) · no overview rule 9 red · no exemption 2 red · no hand-over 4 red · no cover 6 red · no cache 2
red · no unhide-for-the-walk 1 red · real again 17/0.

## Open questions (recommended default)

- **The cut, 200 px** (Michal said ~120): default 200 — measured above; 120 leaves his 10 % lane untouched.
- **First pass shows flat blocks** — round 2 draws covers mid-pan (sliced); ~42 never-mounted artboards stay flat
  placeholders. The warm-up empties that in DOM terms but ships off (round 3). Default next step: (1) one Safari run
  of `stillcheck.sh` with `WARM_ENABLED` on — if the warmed copies are blank there, wait for the far body's pictures
  (`img.decode()` + `complete`, bounded) before its walk; (2) find the fit-all settle cost with the warm-up idle (A/A
  above); (3) the shell-side persistence below, which removes the cold first pass without any warm-up mounting.
- **Sweep-after-zoom ≤ 55** (not met: 63–66 shipped, base 153–167): the cost is drawing during a pan at all (nopan
  52–53). Default: keep drawing mid-pan (it is what turns covers into stills on a first pass); revisit with a smaller
  `STILL_PAN_BUDGET_MS` (2) measured on zoomsweep + sweep together.
- **Settle max on the fit-all zoomcycle**: round 2 fixed it (shipped 30–37 vs base 25–33 in round 3; fix-with-warm-up
  20–30 @ 8 s). Re-check with the warm-up only if it is turned on (40–53 @ 45 s).
- **Chromium fit-all cliff** (a 5.9–17 s frame in both arms): not this change; a separate finding.
- **The Tauri app lane** (Michal: "the window feels slower than Safari"): not run in this spike — see the hand-back.
