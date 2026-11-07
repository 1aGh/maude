# 2.0.7 — small artboards show a still picture while a WebKit zoom runs

Decision by Michal (2026-11-06, `decision:maude/v2-michal-207-overview-still-during-gesture`): on a heavy canvas at
overview zoom, an artboard smaller than about 120 px on screen shows its stored still instead of its live content,
only while a pan or zoom gesture runs; live content is back on the settle. Follows the spike
`207-mascot-webkit-gesture-quiet.md` (WebKit's cost is painting ~8.5–15k mounted SVG/HTML elements at each scale
step; pans were fixed there, zoom p95 stayed 277–564 ms in Safari).

## Decision

1. **Where the still comes from — drawn in the canvas document, from the artboard's own geometry**
   (`artboard-still-raster.ts` `drawStill`). Boxes (background, border, radius), `<img>`/`<canvas>`/`<video>` drawn
   as they are, each inline `<svg>` serialized on its own (with the rules its classes use and the defs it
   references) and drawn as an image, text as lines in its colour — in document order, into one `<canvas>` of
   1.5 × the threshold at the device pixel ratio (≤ 2). Drawn once an artboard has been quiet on screen for
   600 ms, one artboard per 50 ms, and redrawn after its DOM changes (a `MutationObserver`; a picture's `src`
   retry is ignored, its `load` counts). Memory only, like the placeholder picture: never disk, never the canvas
   origin's storage. **An artboard with no still yet stays live** — the own-colour placeholder (blocks) would be a
   visible jump at gesture start; a never-mounted artboard keeps the existing own-colour placeholder, so nothing
   is ever a black square.
2. **What it replaces, and when** (`artboard-still.ts` `StillController`, wired in `artboard-live-gate.tsx`, fed
   by canvas-lib's `applyViewport` → `noteGestureZoom`). On the **first scale step** of a gesture every
   registered artboard narrower than `STILL_MAX_SCREEN_PX` on screen gets `data-dc-still` on its article: its
   body is `visibility: hidden` (DOM, layout, ids, selection untouched), the still `<canvas>` (a child of the
   article, at the body's offset) shows. It **holds until the settle** however far the zoom goes (a mid-gesture
   hand-back repaints at once — the cost removed; a zoomed-in still is soft, like WebKit's own scaled tiles
   mid-pinch). The settle hands back `STILL_RESTORE_PER_FRAME` (4) per frame, nearest the centre first (all at
   once was a 346 ms settle frame). Never swapped: `pinned` (the active artboard / the one holding the selection —
   a selection that lands mid-zoom brings it back at once) and `eager` (video artboards). A **pure pan never
   swaps** (its settle would otherwise repaint every artboard; pans were fixed by the quiet-frame spike).
3. **No flicker.** The still is drawn from the settled, asleep DOM (overview artboards are asleep: CSS
   animations paused), so it is what was just shown; the swap is one attribute per article; the hand-back only
   removes it (the DOM never left, so no blank frame). A one-notch wheel zoom swaps and hands back at its settle —
   which repaints anyway (the WebKit crisp re-raster). No delay before the swap.
4. **Gating: WebKit only, heavy only** (`resolveStillMode`, `STILL_MIN_ON_SCREEN_NODES` = 3000 mounted elements
   in the on-screen artboards). Chromium's zoom frames on the same canvas are already 17–33 ms (GPU raster), so
   the drawing would be pure cost there. `?artboard-still=on|off` on the frame forces it (tests, A/B).

## Threshold — a deviation Michal must confirm

`STILL_MAX_SCREEN_PX` = **200**, not 120. At Michal's 10 % lane the mascot canvas's artboards are 1318–1600 px
wide, i.e. **132–160 px on screen**: a 120 px cut swaps none of them and changes nothing. 200 covers the 10 %
overview with a margin; at 12.5 % a 1600 px artboard is exactly 200 and stays live. One constant.

## Measured

Real Safari (safaridriver) and Playwright Chromium, `perf.sh --studio` against an isolated copy of studyfi-207 on a
private server, Canvas view, camera reset before each run, base = `fa357058b`, fix = this branch, paired and
interleaved, run under `caffeinate -d`, the display on (`pmset` log) for every row. ms; load = 1-min load average
when the run started. The machine was shared all night (load spikes to 32 from other sessions), so rows above load 8
or refused by the probe are listed but not used.

Mascot canvas, Safari, 10 % (28 artboards on screen, 88 artboard renders every run — one settle per gesture):

| round | arm | load | p95 | pan p95 | zoom p95 | max | long ≥ 50 | settle max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | base | 2.44 | 210 | 98 | 318 | 353 | 29 | 18 |
| A | fix (first version) | 3.11 | 104 | 81 | 120 | 297 | 18 | 346 |
| B | base | 5.94 | 346 | 119 | 514 | 608 | 38 | 25 |
| B | fix | — | refused: studio idle 149 ms, machine starved (load 10), 3 tries | | | | | |
| C | base | 5.93 | 569 | 342 | 692 | 960 | 43 | 40 |
| C | fix | 8.06 | 264 | 155 | 267 | 827 | 29 | 358 |
| D | base | 3.54 | 244 | 175 | 284 | 316 | 35 | 69 |
| D | fix | 5.69 | 133 | 273 | 133 | 411 | 23 | 307 |
| E | base | 4.57 | 278 | 55 | 325 | 328 | 32 | 67 |
| E | fix | 4.62 | 185 | 135 | 190 | 471 | 23 | 288 |
| (unused) | base | 32.5 | 550 | 135 | 958 | 1166 | 30 | 541 |
| (unused) | fix | 6.65 | 131 | 521 | 131 | 1336 | 16 | 286 |
| (unused, earlier) | fix | 5.42 | 513 | 683 | 271 | 873 | 35 | 385 |

- **Zoom p95: 284–692 → 133–267 (≈ 2–2.5 × lower in every valid pair).** Long frames 32–43 → 23–29.
- **Pan p95 regressed: base 55 / 98 / 119 / 175 / 342 vs fix 81 / 135 / 155 / 273 (and 521, 683 at higher load).**
  The harness pans right after the previous pass's zoom (its settle window is 900 ms); the most likely cause is the
  paint of the handed-back live content landing in the next pan. Not fixed — see Open questions.
- **Settle max 25–69 → 288–358 ms**: the first hand-back frame (4 artboards repainted at the new scale).
- **Target (zoom p95 < 50 ms) not met.** Same-session floor on this machine: bodies hidden with nothing painted is
  40 / 111 ms (p50 / p90) per zoom frame; stills shown measure the same (39 / 95) once the missing-picture layer is
  hidden; with it, 79 / 127.

Controls (one pair each):

| canvas · engine · zoom | arm | load | p95 | pan p95 | zoom p95 | long | settle max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DS · Safari · 10 % (6 on screen) | base / fix | 5.83 / 3.90 | 15 / 15 | 15 / 15 | 15 / 15 | 0 / 0 | 16 / 15 |
| math-learning-spaces · Safari · 10 % (21 on screen) | base / fix | 4.01 / 4.76 | 71 / 86 | 37 / 34 | 116 / 100 | 6 / 5 | 15 / 16 |
| mascot · Safari · 30 % (2 on screen) | base / fix | 4.96 / 5.68 | 25 / 16 | 19 / 17 | 50 / 22 | 2 / 1 | 15 / 15 |
| mascot · Chromium · 10 % (32 on screen) | base / fix | 4.39 / 3.85 | 16.8 / 16.7 | 16.8 / 16.8 | 16.8 / 16.8 | 0 / 0 | 50 / 33.4 |

DS, math, 30 % and Chromium: no change beyond noise (the feature is off in Chromium; DS and math stay under the
heavy bar or have nothing small enough — their settle max is unchanged, so no hand-back ran).

Gesture start and end (mascot, Safari, 10 %, one-notch zoom kept alive 1.6 s; screenshots
`/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ov/shots/g0-settled.png`,
`…/g1-gesture-start.png`, `…/g2-after-settle.png`): 27 of 28 artboards swapped (the 28th is the active one), **0
swapped without a still**, no black square in the frame; after the settle **0 bodies left hidden**. Hand-back in
7 steps over 261 ms (27 → 23 → 19 → 15 → 11 → 7 → 3 → 0), the first step 105 ms. Visible difference at gesture
start: text turns into lines and rounded shapes are approximated — the artboards keep their colours, pictures and
figures. The red-hatched "Picture not found" frames in the shots are the canvas's own missing pictures (not this
change).

Drawing cost (`__maudeStillStats`): 27 stills at open, ~9–37 ms each (231 ms total), longest synchronous collect
16–45 ms, paint 2 ms.

## Measured — paced hand-back (`ba5bcc447`, base = release tip `3cfe14153`)

Same harness, Safari, mascot 10 %, base and fix both with the missing-picture-frames fix. `pz` = the default pass
(pan then zoom; the kept passes pan ~0.9 s after the previous pass's zoom — pan after zoom). `zo` = zoom only
(`--pan 2`: its "pan p95" is the first two frames of the gesture).

| run | load (base / fix) | zoom p95 | pan p95 | settle max | long ≥ 50 |
| --- | --- | --- | --- | --- | --- |
| pz r1 | 5.92 / 4.23 | 332 / 187 | 64 / 85 | 76 / 202 | 34 / 23 |
| pz r2 | 4.16 / 5.68 | 441 / 99 | 59 / 92 | 180 / 92 | 34 / 16 |
| pz r3 | 5.57 / 4.73 | 299 / 142 | 79 / 99 | 39 / 120 | 29 / 20 |
| pz r4 (take delay 2 s, not committed) | 5.64 / 4.98 | 377 / 165 | 46 / 93 | 160 / 130 | 31 / 22 |
| zo r1 | 4.85 / 3.82 | 428 / 132 | 65 / 97 | 383 / 184 | 31 / 17 |
| zo r2 | 5.41 / 3.16 | 591 / 152 | 67 / 108 | 43 / 105 | 33 / 17 |
| zo r3 | 3.29 / — | 408 / refused (load 11) | 55 / — | 30 / — | 30 / — |
| DS 10 % | 5.87 / 5.65 | 15 / 15 | 15 / 15 | 15 / 15 | 1 / 0 |
| math 10 % | 5.63 / 4.64 | 47 / 45 | 19 / 21 | 16 / 15 | 1 / 1 |
| Chromium mascot 10 % | 3.98 / 3.39 | 33.4 / 50 | 33.4 / 16.8 | 66.7 / 66.6 | 1 / 3 |

- **Zoom keeps its gain: 299–591 → 99–187 (2.3–4 ×).** Long frames 29–34 → 16–23.
- **Settle max: the 288–358 ms frame is gone** (92–202, mean 147 vs base mean 155 across the six paired rows) — but
  not under 50, and two of five pairs are worse than base by more than a frame.
- **Pan after zoom is NOT at base: 46–79 → 85–108 (≈ 1.5 ×), and the zoom-only runs show it is the first frames of
  the next gesture** (2-frame "pan" 55–67 → 97–108). Drawing stills later (2 s) did not change it (r4), so it is not
  the redraw: the most likely cost is the hand-back still painting (one artboard's first paint at the new zoom lands
  in the next frame) when the next gesture starts ~0.9 s after the last one. Pausing on gesture input stops the
  queue but not the paint already in flight.
- Chromium differences are within its 16.7 ms frame quantum (the feature is off there); DS and math unchanged.

**Ship gate (coordinator): not met** — pan after zoom is above base and settle max is above 50 ms.

## Rejected alternatives

- **Server thumbnails (V2-2.17 `thumbs/`)**: per-artboard pictures exist as a job kind, but the routes are
  main-origin only by design (the canvas and capture origins answer 403 at their door; `CORP: same-origin`), they
  are rendered in headless Chromium (a different engine from the one showing them), keyed on the source hash (stale
  after every edit) and a heavy canvas is seconds per render. Relaying them through the shell into the untrusted
  frame would add a cross-origin channel for a 2.0.7 perf fix.
- **SVG `<foreignObject>` snapshot of the body** (the cheap-looking client path): in Safari a real artboard's
  image drew **blank** into a canvas (a 2-element test drew fine), it rendered blank as an `<img>` too once the
  document's CSS was inlined, and that CSS was **495 KB per artboard** (20–120 ms decode each). Fonts and
  `/_api/asset` pictures cannot load inside an SVG image either.
- **The own-colour placeholder as the gesture still** (blocks): available at once, but a mascot rig or a phone
  mock turned into a few rectangles is a visible jump at gesture start.
- **Release a still mid-zoom past 2 × the threshold**: measured — the perf zoom goes ~5 × in, so every still was
  handed back mid-gesture and painted live at a large size (zoom p95 120 ms vs the hold arm).
- **Swap on pans too**: a pan keeps WebKit's painted tiles; a swap would add a full repaint at every pan settle.
- **`content-visibility: hidden` on the body instead of `visibility`**: applies size containment, so a body whose
  real height differs from `contain-intrinsic-size` would jump; `visibility` is the spike's measured reference arm.

## Interface (builders)

- `artboard-still.ts`: `STILL_MAX_SCREEN_PX`, `STILL_RESTORE_PER_FRAME`, `STILL_MIN_ON_SCREEN_NODES`,
  `STILL_ATTR` (`data-dc-still`), `STILL_CLASS` (`dc-artboard-still`), `STILL_PARAM` (`artboard-still`),
  `stillEligible`, `resolveStillMode`, `isPaintMutation`, `StillController` (`register`, `update`, `markDirty`,
  `setZoom`, `noteZoom`, `settle`, `stats`).
- `artboard-live-gate.tsx`: `noteGestureZoom(zoom)` (called by canvas-lib `applyViewport`); the runtime's
  `stills`; `window.__maudeStillStats()` (registered / withStill / showing / takes / raster timings).
- `artboard-live.ts`: `LiveRegistry.slotInfo(id)` — on screen + mounted weight.
- A capture never runs it (`liveMode: 'off'`). Anything that reads an artboard's painted pixels mid-gesture sees
  the still; nothing does today.

## Tests

`test/v2-207-overview-stills.test.tsx` — the threshold and exemptions (`stillEligible`), WebKit-only / never in a
capture (`resolveStillMode`), a src retry is not a paint change, a zoom swaps only small artboards with a still and
the settle restores them, a pure pan never swaps, pinned / video never swap and a selection mid-zoom restores at
once, a light canvas never swaps, an artboard with no still stays live, the staggered hand-back, a new gesture
mid-restore keeps the rest, and the mounted wiring (the gate registers, a zoom with no still swaps nothing).

## Open questions (recommended default)

- **The threshold** (above): default 200; Michal confirms or names another value.
- **`dc-absent-layer` costs ~40 ms a frame on this canvas** (measured: synthetic zoom p50 79 → 39 ms with the
  layer hidden). The mascot canvas names ~59 pictures that do not exist (`pose_cheer_front.png`, …); the asset
  layer follows each frame's element rect every animation frame. Not this change's file — a follow-up (below).
- **Pan after a zoom is slower (above).** Default next step: measure a pan burst 0–1.5 s after a zoom settle in one
  session with and without the hand-back; if it is the hand-back paint, either keep the stills through a pan that
  starts before the hand-back finished (already true for the rest of the queue) and extend that to the whole
  hand-back window, or spread the hand-back over idle frames only. Do not ship to Michal as "smooth" before this.
