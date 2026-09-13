## Pushing it — VFX & motion graphics (all frame-driven)

Remotion + plain React/SVG/CSS goes *far* beyond stitch-and-title. Everything
below is a **pure function of `useCurrentFrame()`** (the iron law) — build it by
hand from `interpolate`/`spring`/`random`; there is **no** effects library to
import. Proven in the Alligators cinematic-cut dogfood (2026-07-10):

- **Cinematic grade** — a CSS `filter` on the `<Video>` (`contrast`
  `saturate` `brightness` `hue-rotate` `sepia`) + a teal/orange gradient wash div.
- **Ken-Burns** — per-clip `transform: scale()/translate()` driven by clip progress.
- **Slow-mo / speed ramp** — `<Video playbackRate={0.5} />` (deterministic).
- **Impact camera shake** — `translate`/`rotate` by `random(\`seed${Math.floor(frame)}\`)`.
- **Impact zoom-punch** — a quick `scale` spike over the first ~10 frames of a hit.
- **Kinetic typography** — split text to `<span>`s, per-letter `spring({frame: frame - i*2})`
  stagger + a **RGB chromatic split** via `text-shadow` (red +Xpx / cyan −Xpx) that
  shrinks as it settles.
- **3D card CTA** — `perspective()` + `rotateY()` + `translateZ()` spring-in, with an
  expanding-ring "shockwave" (`scale()` + fading opacity).
- **Freeze / hit flash** — a full-frame white `<AbsoluteFill>` whose opacity spikes
  for ~3 frames; pair with `<Freeze frame={N}>` for a bullet-time hold.
- **Glitch / RGB-split stab** — two `clipPath`-sliced colour layers offset by a
  seeded random x, flashed for ~5 frames between hard cuts.
- **Radial speed-lines** — an SVG `<mask>` of N random-length lines from centre over a
  radial-gradient rect (anime burst); flash it during a hero run.
- **Light-leak sweep** — an animated radial gradient translated across, `screen` blend.
- **VHS / archival treatment** — `repeating-linear-gradient` scanlines + a `REC ●`
  bug + a frame-derived timecode; makes low-res source footage read as *intentional*.
- **Split-screen** — a flex row of N `<Video>` with a `clipPath` wipe-in.
- **Motion-graphic infographics** (Remotion's home turf):
  - **animated chalkboard play diagram** — an SVG route that draws itself via
    `strokeDasharray`/`strokeDashoffset`, with a ball-carrier dot walking the same
    waypoints (parametric `pointAt(t)`, **no DOM measurement** → deterministic);
  - **animated value bars / counters** — `spring`-filled bar widths + a counting `%`
    (use `overshootClamping: true` and clamp so the number never exceeds its target).

**`motion` (Framer Motion) is bundled but UNUSABLE inside a comp** — its `animate`
runs on wall-clock, which the frame-stepping capture can't seek. Motion here is
*always* Remotion-driven. **Cheap moving film grain:** a static feTurbulence noise
baked into a `data:` URI `background-image`, scrolled by a seeded-random offset each
frame — never a live per-frame `<feTurbulence>` (that re-runs the filter every frame).

### Recipe: translucent ghost / matte, no green screen

Unlike everything above, this is **not** a Remotion-in-comp technique — it's an
offline pre-process that bakes a finished asset, then drops into the comp like
any other clip. CSS `opacity` over the whole clip does **not** work for "the
figure is translucent, the background stays normal" — it dims everything and
reads as a double exposure. Instead:

1. **Per-frame person mask** — macOS Vision's `VNGeneratePersonSegmentationRequest`
   (`.accurate` quality) runs on-device, free, and handles a distant subject too.
2. **Reconstruct the plate behind the person** from neighboring frames where
   that region isn't occluded. With camera motion, align candidate frames
   first (`cv2.phaseCorrelate`), then `nanmedian` across them, then `cv2.inpaint`
   any remaining holes.
3. **Composite**: `out = src*(1-m) + (person*A + plate*(1-A))*m`, with
   `A ≈ 0.45`. Feather the mask (~5 px) — an unfeathered edge reads as cut-out
   paper, not a ghost.
4. Bake the result to a clip and import it as a plain asset — this pipeline
   runs outside the comp, not inside it.

If the source is an iPhone `.mov`, it may carry more than one audio stream —
use `-map 1:a:0` explicitly, or ffmpeg can fail decoding the spatial-audio
track.
