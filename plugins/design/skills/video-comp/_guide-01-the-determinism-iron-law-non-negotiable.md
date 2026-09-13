## The determinism iron law (non-negotiable)

Export is frame-perfect ONLY because every animated value is a **pure function
of the frame index**. Adapted from Remotion's official LLM guidance:

- **Drive everything from `useCurrentFrame()`** via `interpolate()` / `spring()`.
- **NEVER use CSS animations or transitions inside a comp** — no `@keyframes`,
  no `transition:`, no `animation:`. They run on a wall-clock the capture can't
  seek, so the export freezes or tears. (Ordinary non-comp artboards MAY use
  CSS/WAAPI — but a `<VideoComp>` body must not.)
- **No `Date.now()` / `Math.random()` / bare `requestAnimationFrame`** in render
  output. For randomness use Remotion's seeded `random(seed)`.
- Timing is in **frames**, not milliseconds: `interpolate(frame, [0, 30], …)` is
  "over the first second at 30fps".
