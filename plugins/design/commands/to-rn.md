---
name: to-rn
category: daily
description: "Create a React Native SVG animation fallback for light motion."
argument-hint: "\"<animated mark | IR handle | canvas>\" [--out <Component.tsx>]"
---

# /design:to-rn — native rn-svg/Reanimated renderer (FALLBACK)

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

The **fallback** motion handoff for **light / occasional** animation where you want
a native `react-native-svg` + Reanimated component instead of a Lottie runtime
([DDR-094](../../../.ai/archive/decisions/DDR-094-draw-animation-keyframe-ir-native-authoring-lottie-export.md)).

> **Prefer `/design:to-lottie` for anything rich.** The POC proved native fidelity
> is *possible* but hit three real walls (DDR-094 Update): **(1)** `feTurbulence`/
> `feDisplacementMap` have **no native impl** in react-native-svg 15.x (procedural
> texture can't render natively — pre-bake it); **(2)** continuous multi-layer
> `d`-morph **froze the app** (rn-svg re-parses `d` + re-renders the whole `<Svg>`
> every frame; with `<Filter>`s it ran an offscreen pass per frame); **(3)** two
> hand-matched implementations drift. So this is for a blink, a gentle pulse, a
> single transform — NOT a continuous rich morph. Reference implementation:
> [`Mascot.fallback.tsx`](../../../.ai/plans/notes/to-lottie-poc/Mascot.fallback.tsx)
> + the generator [`to-rn.mjs`](../../../.ai/plans/notes/to-lottie-poc/to-rn.mjs).

## Flags

| Flag | Default | What it does |
|---|---|---|
| `"<source>"` | — | **Required.** The animated mark: IR handle / `.tsx` canvas / SMIL+CSS source. |
| `--out <path>` | `<repo>/src/components/<Slug>.tsx` (or per project) | Target RN component. |

## When to use which

| | `/design:to-lottie` (primary) | `/design:to-rn` (this — fallback) |
|---|---|---|
| Rich / continuous morph | ✅ | ❌ perf ceiling |
| `feTurbulence` / procedural texture | ✅ (baked in the comp) | ❌ no native impl (pre-bake) |
| Light blink / pulse / single transform | ✅ | ✅ |
| Web + mobile from ONE artifact | ✅ 1:1 | ❌ RN only |
| Theme-aware colors at runtime | host color override | ✅ colors as props (native) |

If the brief is a continuous rich animation, **stop and use `/design:to-lottie`** —
don't ship a frozen app.

## Flow

### 1. Resolve the source → IR tracks

Read the keyframe `Timeline`: vertex-array `d` morphs (fixed vertex count — the
interpolability constraint), transform/opacity tracks, the per-track easing handles.
**Confirm it's light** (a small number of animated nodes, no continuous multi-layer
morph, no procedural texture). If not → `/design:to-lottie`.

### 2. Generate the component (from the IR, through the engine discipline)

Emit a `react-native-svg` + Reanimated component (reference `Mascot.fallback.tsx`):

- **Morph** → a worklet `useDerivedValue` that vertex-lerps between the IR's vertex
  arrays (NOT a string `d` reparse per frame) and rebuilds the `d` on the UI thread.
  Same fixed vertex count across keyframes (engine `morphVariants` guarantees it).
- **Body motion** (translate/scale/rotate) → a `View` transform / `Animated` style —
  NOT an SVG `<Filter>` (the offscreen-pass-per-frame trap). Position-vs-animation
  split applies: static placement off the animated transform.
- **Gradients** → `<LinearGradient>`/`<RadialGradient>` with **colors passed as props**
  → theme-aware (the one place native beats Lottie's baked colors).
- **Reduced motion** → `useReducedMotion()` collapses to the rest pose (the RM gate
  the format can't carry — `_draw-motion-rules.md` M4).
- **No `feTurbulence`** — if the mark needs procedural texture, pre-bake it to an
  `<Image>` or accept it's web-only.

### 3. Usage

```tsx
import { Mascot } from './<Slug>';
<Mascot size={120} tint={theme.accent} />   // colors as props → theme-aware
```

## Output report

```
📱 /design:to-rn — <slug>  (FALLBACK — light animation)
Output:     <Component.tsx>
Scope:      light animation only (rich morph → /design:to-lottie)
RM:         useReducedMotion() → rest pose
```

## Notes

- This is the **fallback** path. The primary production delivery (web + mobile, 1:1)
  is `/design:to-lottie`. Reach for `to-rn` only when a native rn-svg component is
  specifically wanted AND the animation is light.
- Authoring stays native in maude (the keyframe IR) — this emits; you don't author here.
