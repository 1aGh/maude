# 2.0.7 spike — the mascot canvas stutters in WebKit, not in Chrome

Question (Michal, 2026-11-06): `ui/studyfi/ideas/mascot-exploration.tsx` (88 artboards, ~11k lines of SVG rigs)
can hardly be moved in the desktop app (WKWebView) and is fine in Chrome. Primary lane per Michal: **Canvas view
at 10 % zoom** (28 artboards on screen in Safari at 1600×948, 32 in Chromium at 1600×1000).

## How it was measured

- `perf.sh --studio` against an isolated copy of the project on a private server: `--engine safari` is real
  Safari through safaridriver (the system WebKit, the engine the desktop app uses), `--engine chromium` is
  Playwright Chromium. Retina off: this Mac's display is 5120×1440 @1x, so is the app. 3 passes, 2 kept.
- Camera reset before every run (`_canvas-state/<slug>.view.json`: zoom 0.1, centred, `canvasView: canvas`).
- Bisect arms: `--inject-css` into the canvas document, one class switched off at a time.
- The machine was shared with other sessions all evening: load 3–8 (one window 15–27, those runs were refused or
  discarded). Frame times swing ±50 % between identical runs; **`artboardRenders` per gesture does not** (it is a
  count) and is the load-independent evidence below.
- Playwright WebKit headless is not usable for this canvas (4 s frames: no GPU compositing), so it is not a lane.

## Root cause

Two things, one amplifying the other.

1. **Painting is the cost, not effects.** At 10 % every on-screen artboard is mounted (32 artboards, 15.2k
   elements, 214 `feGaussianBlur`, 42 `feTurbulence`, 60 masks) and *asleep* (overview: 1,140 of 1,141 CSS
   animations already paused by `data-dc-asleep`). Switching off animations, SVG filters, CSS filters, masks,
   backdrop-filter, background-image + box-shadow all together changed nothing measurable; hiding the artboard
   bodies (`visibility: hidden`, layout kept) took the gesture p95 from ~290 to 57 ms. WebKit repaints the
   world's tiles as a pan exposes them and as the scale changes, and painting that much SVG is slow on WebKit
   (Chromium rasterizes on the GPU).
2. **Every slow frame ended the gesture.** `markInteracting`'s 220 ms quiet timer came due during a 200–450 ms
   frame, before the wheel queued behind it was handled. Each such "settle" published the viewport (every
   artboard re-renders), wrote the WebKit crisp transform (the world drops its layer; the next wheel builds it
   and repaints everything again), and let the ring release and the crowded-layer toggle run mid-gesture. Safari
   counted **352–1,584 artboard renders per pan+zoom (4–18 settles)**; Chromium, whose frames stay under 17 ms,
   **88 (one)**.

## Decision — fix in Maude (`canvas-lib.tsx`, commit on `fix/207-mascot-webkit`)

The quiet timer no longer ends the gesture on its own: when it fires it waits for a frame and a task
(`afterQuietFrame`), and ends the gesture only if no input came in between. A wheel that waited behind a long
frame is handled first and keeps the gesture. A hidden document ends after one task; a frame that never comes is
bounded at 1 s. No change for a canvas whose frames are fast (Chromium, the DS canvas, math-learning-spaces).

Interface for builders: none new. `useViewportController`'s `isInteracting` keeps its meaning; a settle may come
up to one frame later than 220 ms after the last input.

Test: `test/v2-207-gesture-quiet-after-frame.test.tsx` (wheels arriving just after the 220 ms timer; red on
`39218fe03` with 3 renders mid-gesture, green with the fix, red again with canvas-lib reverted).

## Numbers (Safari = real WebKit, 10 %, 28 on screen; 5 paired rounds, load 3.3–7; ms)

| arm | gesture p95 | pan p95 | zoom p95 | long frames (≥ 50 ms) | settle max | artboard renders |
| --- | --- | --- | --- | --- | --- | --- |
| base | 610 / 617 / 553 / 433 / 456 | 635 / 569 / 463 / 346 / 432 | 617 / 881 / 561 / 465 / 586 | 27 / 32 / 32 / 21 / 17 | 430 / 213 / 347 / 337 / 359 | 968 / 1,056 / 1,496 / 1,320 / 968 |
| fix | 447 / 258 / 374 / 529 / 240 | 96 / 58 / 144 / 239 / 81 | 472 / 323 / 422 / 564 / 277 | 37 / 34 / 38 / 41 / 30 | 37 / 106 / 27 / 169 / 30 | 88 × 5 |

Pan p95 is 3–6× lower, the tail after the gesture ~10× lower, and the gesture settles once. More frames cross
50 ms with the fix (30–41 vs 17–32): without the mid-gesture settles the frames are many moderate ones instead of
fewer huge ones. The zoom is still slow (277–564 ms frames): the paint cost of 1., which no settle logic removes.
Chromium, same lane: mascot base 50 / fix 33 ms p95 (long 5 → 0), DS 33 / 33, math 16.8 / 16.8 — no regression.
Safari controls: DS 15 / 22, math 38 / 59 then 33 / 30 (noise; 65 / 81 renders in both arms, no slow frames, so the
fix never engages there).

## Rejected alternatives

- **Pause animations / filters / masks off screen or mid-gesture** (the leading hypothesis): measured no effect at
  10 % — the overview already sleeps every artboard; the cost is the paint of the static SVG.
- **Hold the scale on a wrapper and apply the residual zoom to it** (Blink's 2.0.5 trick for WebKit): prototype was
  no better in Safari and a synthetic page showed WebKit's zoom re-raster is not the world's own-scale change.
- **Drop `will-change` from the world in WebKit**: 300–480 ms every frame (full repaint each frame).
- **Keep per-artboard layers past 24 on screen** (undo `v2-207-webkit-crowded-no-layers`): fewer long frames
  (13–23 vs 34–38) but 1.2–1.9 s spikes when the layers are built and no stable p95 win; left as it is.
- **A lower on-screen element ceiling in the overview** (more still pictures): would cut the paint cost but shows
  stills where Michal wants the real artboards; a product call, not taken here.

## Open questions (recommended default)

- Zoom at 10 % on WebKit is still 300–470 ms a frame on this canvas. Default: next step is a measured trial of an
  overview-only paint diet — e.g. `content-visibility: hidden` + the existing still picture for artboards under
  ~120 screen px wide *during a gesture only*, real content back on the settle — behind a flag, measured in
  Safari and in the app.
- The canvas content: gate `useExprCycle` on `useArtboardActive()` (applied to the test copy, see hand-back).
