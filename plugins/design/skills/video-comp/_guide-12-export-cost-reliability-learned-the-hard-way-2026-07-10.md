## Export cost & reliability (learned the hard way — 2026-07-10 dogfood)

The capture spine screenshots every frame in Chromium, so **per-frame compositing
cost is real** and a few limits bite:

- **≤ 2 min at 30 fps by default.** The video exporter's `DEFAULT_MAX_FRAMES`
  is `3600` (`apps/studio/exporters/video.ts`), with a `MAX_FRAMES_CEILING` of
  `18000` reachable via `--option maxFrames=N`. A comp past the active cap's
  **ending is silently truncated** — author within it (or pass `maxFrames`);
  the `footage-director` targets this.
- **`scale` defaults to 2×, not 1×.** A 1280×720 comp renders at 2560×1440
  unless you opt out — this is an **opt-out**, not opt-in, and it costs real
  time (roughly 2.3× slower per frame). Pass `--option scale=1` for native
  resolution; only go to `scale=3` if you deliberately want an oversampled
  render. 1920×1080 at scale 2+ can hit memory pressure and die mid-render
  (`addVideoFrame` on `undefined`) — prefer 1280×720 at native scale for heavy
  comps.
- **Budget full-frame `mix-blend-mode` / `filter` layers.** Many *always-on*
  full-screen blend layers (grain `overlay`, grade `soft-light`, scanline `multiply`,
  …) force a per-frame GPU→CPU readback and **crash the capture renderer**
  ("Execution context was destroyed"). Keep heavy blends **brief and small-area**
  (glitch/leak stabs over a few frames are fine); make **always-on** full-frame
  layers plain `opacity`, not a blend mode. This was the real cause of random
  mid-render crashes on the effect-dense cut.
- **`renderMediaOnWeb` (the mp4/webm whole-comp audio path) can HANG** on a complex
  comp instead of throwing, so its built-in frame-step fallback never fires and the
  export times out. For a **vision-only / no-audio** comp, force the reliable
  frame-step path (drive `_video-playwright.mjs` without `--render-lib`, or export
  `gif`). Fixing the hang→fallback is a tracked DDR-148 follow-up.
- **Set the active canvas before a CLI export.** `/_api/export` scope resolves from
  `_active.json`, which is driven by the **live studio shell selection** — open the
  canvas tab (file-tree click) so the artboard resolves; a hand-written `_active.json`
  is not enough once the shell is running.
- **Headless render server:** set `MAUDE_NO_WATCH=1` so no HMR hard-reload can
  interrupt a long capture (defensive — a peer/runtime-state write to `designRoot`
  otherwise reloads the capture page).
