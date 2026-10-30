V2-8.8 WebKit regression — display-free trace (Chromium, 2026-10-26, this Mac, loaded)

Probe: Chromium (Playwright) in the studio shell, 1600x1000 dpr 2, fixture ui/c12 (21 boards), fit-all, then a
40-frame zoom (wheel+ctrl, in then out). "WebKit path" = navigator.vendor spoofed to Apple in every frame, so
canvas-lib takes its WebKit branch (transform: translate scale, will-change) — the invalidation pattern Safari
sees, without a screen. Chromium tracing (devtools.timeline + invalidationTracking) over the zoom window only.
renders = window.__dcPerf.artboardRenders during the zoom window.

Before the fix (feat tip 08a8d68e1 + nothing):
  arm / variant                 renders  Layout evts  dirty layout objs  "Style changed" layout inval.  painted label nodes
  pre-v2 fcc24f4dd, WebKit path      21       13            324                 208                         -
  v2, WebKit path                     0       51           2765                1684                    21 x 39 frames
  v2, WebKit path, labels hidden      0       13            146                   4                         -
  v2, Blink path (CSS zoom)        1554      192          12128               44647                         -
  -> on the WebKit path React does no work in a zoom (the WebKit lane itself counts 147 renders in BOTH arms);
     the only layout inside the world during a zoom is the counter-scaled artboard NAME (v2 gate-a-polish),
     21 boards x every frame. It paints outside the frame (.dc-positioned drops contain: paint), i.e. inside the
     board's own will-change layer, moving that layer's bounds each frame (label world size = screen size / zoom).
  -> Chromium splits the name into its own layer by itself (compositing reason "Overlap": a scaled transform
     node cannot merge into the board's layer); WebKit's RenderLayer compositing has no such reason, so the
     name paints into the board's backing store there.

After bd3f5ff61 (WebKit path: name + video badge will-change: transform):
  compositing reason for the 21 names: WillChangeTransform (explicit, engine-independent); board layers 21
  unchanged; Blink path unchanged (37 layers, names not split, reason list identical).

After d68075b22 (useArtboardBounds keeps the object for sub-pixel noise; DCArtboard minDelta 0.5):
  ResizeObserver on one 1280x800 board during the Blink zoom: 37 callbacks, 17 distinct sizes, all within
  1279.875-1280 x 799.89-799.98 (layout noise). Renders in the 40-frame zoom: 1554 -> 21.

Chromium studio lane (scripts/v2-perf-bench.sh, 7 passes, first discarded):
  webkit-fix-chromium   (v2 base, after bd3f5ff61): p95 v2 17.6 vs 17.5 + 0.3 PASS; renders 1743 vs 966
  webkit-fix-chromium2  (base v2, after d68075b22): p95 v2 17.4 vs 18.0 + 1.1 PASS; renders  168 vs 966
  webkit-fix-lod        (64 boards + 1,500 annotations, vs pre-v2): FAIL as before (V2-8.14's open item);
                        renders 512 vs 2944
  webkit-fix-lod-vs-feat (same lane, this branch vs feat tip 08a8d68e1): p95 116.7 vs 133.3 PASS; renders 512
                        vs 5312 -> no regression; the 64-board LOD cost is not React renders.
