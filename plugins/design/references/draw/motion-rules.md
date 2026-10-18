# `references/draw/motion-rules.md` — the draw MOTION rubric (single source)

> Reference doc, **not** an agent or a slash command (it lives under `references/`). The time-companion
> to [`design-rules.md`](./design-rules.md). Read by `draw-agent`
> (when a brief asks for animation) and `draw-critic` (the `motion` verdict
> block). Distilled from [DDR-094](../../../../.ai/archive/decisions/DDR-094-draw-animation-keyframe-ir-native-authoring-lottie-export.md)
> + the studyfi-v3 fire-mascot session (~3 rounds lost to a dead mechanism) +
> the 2026-06-05 deep-research pass + two POCs. Every check below is **yes/no or
> measurable** — verified from the **IR / serialized SMIL / wall-clock sample**,
> never from a vision model eyeballing a still frame.

---

## ⚠️ Read these first — the mechanism is the design

Animation quality is decided at the **mechanism** layer, before any taste call. A
beautiful keyframe set on the wrong mechanism renders a *still frame* and a
freeze-frame screenshot will falsely "confirm" it (the exact studyfi-v3 trap).
So the first gate is always: **is this property animating on a mechanism that
actually moves at runtime?**

1. **Authoring source = the keyframe IR (`draw/animate.ts`), never hand-CSS.**
   The IR `Timeline` of property `Track`s is the single source; it serializes to
   SMIL (`.svg`) + JSX (canvas preview) via `serialize-animate.ts` and to Lottie
   for production (DDR-094). Hand-authored `@keyframes`/`<animate>` outside the IR
   is the anti-pattern the engine removes — it drifts and bypasses the proof gate.

2. **Production delivery is Lottie-from-code, web AND mobile.** The maude SMIL/JSX
   form is for **authoring/preview**. Ship via `/design:to-lottie` (one `.lottie`,
   1:1 on `lottie-web`/`dotlottie-react` + `lottie-react-native`). The native
   rn-svg/Reanimated renderer (`/design:to-rn`) is a **fallback for light
   animation only** — continuous rich morph hits rn-svg's perf ceiling and
   `feTurbulence` has no native impl.

---

## The mechanism ladder (pick the LOWEST rung that does the job)

| Want | Mechanism | NEVER |
|---|---|---|
| Move / scale / rotate / fade a whole part | CSS `transform`/`opacity` (JSX) **or** `<animateTransform additive="sum">` (SMIL) on a wrapper `<g>` | animating layout props (`x`/`width`/`top`) — not compositor-friendly |
| **Shape morph** (outline changes) | `<animate attributeName="d" calcMode="spline">` (SMIL) / `motion`'s `d` keyframe array (JSX) — fed by `morphVariants()` | **CSS `d: path()`** — it does NOT animate live in any shipping browser; a freeze-frame lies |
| Gradient sweep / stop shift | `<animate>` on the stop `offset`/`stop-color` | baking it into a `d` morph |
| Procedural texture motion (fire grain) | **pre-bake** frames; or accept it's web-only | relying on `feTurbulence`/`feDisplacementMap` to animate natively (no RN impl) |

**Position-vs-animation split (load-bearing gotcha).** A CSS `transform` **overrides**
the SVG `transform=` attribute — they don't compose. So: do *static placement*
with the attribute (or a baked vertex offset), and *animated* transform on a
SEPARATE wrapper / via `additive="sum"`. The engine's `serialize-animate.ts`
already emits `animateTransform additive="sum"` for `translate`/`scale`/`rotate`
so an animated transform never clobbers a static one — keep it that way.

---

## The 8 conversion rules (when emitting Lottie — `/design:to-lottie`)

Each was found the hard way in the POC; the skill MUST encode all 8 (full text in
[`design-to-lottie-skill-spec.md`](../../../../.ai/plans/notes/design-to-lottie-skill-spec.md)):

1. **Per-segment easing from the real tokens** — every keyframe gets its own
   `o`/`i` handle; **preserve overshoot (`y>1`)** (the "snap"). Each animation
   uses its OWN token.
2. **Port EVERY animated property** — enumerate from the source, don't eyeball.
3. **Arc commands (`A`) → parse with python-lottie**, never hand-approximate.
4. **`layers[0]` = top** — build back→front then reverse.
5. **Masks** render on lottie-web/RN, NOT cairo → self-verify via lottie-web.
6. **Incommensurate sub-loops** → bake across the comp; hide the seam in an
   invisible phase.
7. **Coordinate offset + baked static transforms** — only ANIMATED transforms
   become keyframes.
8. **Gradient opacity stops** appended after color stops (`count` = color-stop count).

---

## The HARD floor (a motion mark cannot pass with any of these failing)

| # | Hard rule | Verify from |
|---|---|---|
| M1 | **The animated property changes over WALL-CLOCK time.** A freeze-frame pass is NOT proof. | `draw-proof --motion`: sample `getBBox()`/computed value at t0 vs t1 — must differ. **Freeze-frame OK + over-time NO-CHANGE ⇒ HARD FAIL** (dead mechanism). |
| M2 | **No CSS `d:path()` morph.** | grep the source — `d:` inside `@keyframes` / a `style` is an automatic fail. |
| M3 | **Morph endpoints share a fixed vertex count / command template.** | `morphVariants()` guarantees it; a hand morph must pass `parseMorphPath` on every keyframe with equal `vertexCount`. |
| M4 | **Reduced-motion is honored.** | SMIL: a `prefers-reduced-motion` `<style>` gate is emitted (CSS-host best-effort). JSX/RN host: `useReducedMotion()` collapses to the rest pose. Lottie: host-gated (document it). |
| M5 | **Animated transforms compose, never clobber.** | serialized SMIL uses `additive="sum"`; JSX keeps static placement off the animated transform. |

### Reduced-motion — the gotcha

**SMIL ignores the CSS `prefers-reduced-motion` catch-all.** A `@media (prefers-reduced-motion: reduce){ * { animation: none } }` block disables *CSS* animation, not `<animate>`/`<animateTransform>`. So for a pure SMIL `.svg` the RM gate is **best-effort only** (it catches any CSS-driven transitions). The DURABLE reduced-motion story is:

- **JSX / canvas preview** → the host wraps with `useReducedMotion()` and renders the rest pose.
- **Production (Lottie)** → the host pauses/resets the animation (`autoPlay={!reduce}`).

Don't claim a SMIL file is RM-safe on its own — it isn't. Note the host requirement in the handoff.

---

## Live-verify rule (the anti-freeze-frame discipline)

A still screenshot CANNOT prove animation — the studyfi-v3 session burned ~3
rounds because a freeze-frame "confirmed" a dead CSS `d:path()`. So:

1. Render the mark in a real runtime (SMIL in a browser via `draw-proof`, or the
   Lottie via headless `lottie-web` — **cairo can't render masks**).
2. Sample the animated property at **two distinct wall-clock times** and assert it
   changed (`draw-proof --motion`).
3. Only a two-sample over-time delta counts as proof. Encode the result in the
   verdict's `motion` block.

---

## The `motion` verdict block (draw-critic)

When the canvas/mark is animated, the critic's JSON verdict gains:

```json
"motion": {
  "mechanismLadderRespected": true,
  "deadMechanism": false,            // M1/M2 — CSS d:path() or non-moving prop
  "overTimeDeltaProven": true,       // draw-proof --motion two-sample delta
  "morphVertexCountFixed": true,     // M3
  "reducedMotionHonored": true,      // M4 (note the host requirement)
  "additiveTransforms": true,        // M5
  "findings": ["…"]
}
```

A mark with `deadMechanism: true` or `overTimeDeltaProven: false` is a **HARD
fail** regardless of how good the freeze-frame looks.
