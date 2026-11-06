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

Real Safari (safaridriver), `perf.sh --studio`, mascot canvas, Canvas view at 10 %, 28 on screen, ms. **Incomplete:
the paired matrix was cut off at round 1 when the screen locked after midnight (`occluded`, rc 3) — the numbers
below are single pairs on a machine at load 2.4–5.4 and must be re-run (see Continue).**

| arm | load | p95 | pan p95 | zoom p95 | max | long ≥ 50 | settle max | renders |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base (`fa357058b`) | 2.44 | 210 | 98 | 318 | 353 | 29 | 18 | 88 |
| fix v1 (swap all, release at 2 ×) | 3.11 | 104 | 81 | 120 | 297 | 18 | 346 | 88 |
| base | 4.69 | 334 | 94 | 711 | 774 | 34 | 23 | 88 |
| fix v2 (hold to settle, 4 / frame back) | 5.42 | 513 | 683 | 271 | 873 | 35 | 385 | 88 |

The v2 pair ran at load 5.4 with a throttled-frame retry and a 328 ms spread between passes: its pan p95 (683) is
not credible against every other pan sample (58–239) and is the first thing to re-measure.

Same-session arm comparison (synthetic ctrl+wheel zoom burst, 24 frames, load ~4.5, frame ms p50 / p90):
stills shown 79 / 127; stills shown + `dc-absent-layer` hidden **39 / 95**; bodies hidden, nothing in their place
40 / 111 (the spike's reference arm); live, absent layer hidden 55 / 179. **The still costs nothing over the
bodies-hidden floor**; on this canvas the asset layer adds ~40 ms a frame on top.

Drawing cost (`__maudeStillStats`): 27 stills for 28 on-screen artboards (one is pinned/active), 45 drawings at
open, ~28 ms wall each, longest synchronous collect 20–45 ms, paint 2 ms. Before the `src`-retry filter the
canvas at rest redrew ~2 stills a second (asset retries of missing pictures).

Not measured yet: Chromium (the feature is off there — `resolveStillMode`; base = fix except one no-op call per
frame), the DS canvas and math-learning-spaces (both expected under `STILL_MIN_ON_SCREEN_NODES` — confirm their
`onScreenNodes`), and the 30 % data point.

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
- Pans: unchanged by this (pan p95 is the quiet-frame spike's). Default: leave; revisit only with Michal's
  feedback from the app.
