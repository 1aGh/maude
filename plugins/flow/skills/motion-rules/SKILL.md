---
name: motion-rules
description: "Review animation duration, easing, reduced motion, rendering cost and motion choreography."
user-invocable: false
---

# Motion Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for animation and motion design. Violations require the AI agent to refuse, rewrite, or block the artifact.

This skill reads duration ceilings from `.ai/workflows.config.json` → `motion`. Defaults: `micro: 300`, `page: 500`, `complex: 1000` (ms). Override per-project. Skip the skill entirely with `skills.motionRules.enabled: false`.

## 1. Reduced-Motion Fallback Required

- ✘ **NEVER** ship an animation without a `prefers-reduced-motion` fallback
- ✔ Every animation must degrade gracefully when reduced motion is preferred
- ✔ React Native: check via `AccessibilityInfo.isReduceMotionEnabled()`

```css
/* ❌ Non-compliant */
.card { transition: transform 300ms ease-out; }

/* ✅ Compliant */
.card { transition: transform 300ms ease-out; }
@media (prefers-reduced-motion: reduce) {
  .card { transition: none; }
}
```

## 2. Compositor-Friendly Properties Only

- ✘ **NEVER** animate properties that trigger layout: `width`, `height`, `top`, `left`, `margin`, `padding`
- ✔ Animate only: `transform`, `opacity`, `filter`, `clip-path`

```css
/* ❌ Triggers layout */
.panel { transition: height 300ms; }

/* ✅ Compositor only */
.panel { transition: transform 300ms; }
```

## 3. Duration Limits

| Category             | Config key       | Default | Example                  |
| -------------------- | ---------------- | ------- | ------------------------ |
| Micro-interaction    | `motion.micro`   | 300ms   | Button press, hover, tag pulse |
| Page transition      | `motion.page`    | 500ms   | Route change, tab switch |
| Complex choreography | `motion.complex` | 1000ms  | Multi-step reveal, hero entry |

- ✘ **NEVER** exceed these limits without a documented justification (DDR-worthy)
- ✔ Prefer shorter durations — most interactions should be ≤ 200ms
- ✔ If the project sets `ux.responseTargetMs` low (e.g. 100), bias even tighter

## 4. Animation Must Have Purpose

- ✘ **NEVER** add animation purely for decoration
- ✔ Every animation must serve one of:
  - **Feedback** — confirm user action (button press, RSVP)
  - **Orientation** — show spatial relationship (tab switch direction)
  - **Focus direction** — draw attention to change (live indicator pulse)
  - **State change** — communicate transition between states (offline → preview → live)
  - **Hierarchy reveal** — progressive disclosure (timeline expand)

## 5. No Infinite Animations Without Control

- ✘ **NEVER** use `animation-iteration-count: infinite` without pause/stop control
- ✔ Looping animations must stop when user scrolls past, component unmounts, or user pauses
- ✔ Exception: loading spinners (still require reduced-motion fallback) — prefer skeletons over spinners

## 6. Motion Token Usage Required

- ✘ **NEVER** hardcode duration or easing values in component styles
- ✔ Reference motion tokens for all timing and easing

```css
/* ❌ Raw values */
transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1);

/* ✅ Token references */
transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
```

## 7. Motion Token Scale (recommended baseline)

```css
/* Duration */
--motion-duration-instant: 0ms;
--motion-duration-fast:    100ms;
--motion-duration-normal:  200ms;
--motion-duration-moderate: 300ms;
--motion-duration-slow:    500ms;

/* Easing */
--motion-ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
--motion-ease-enter:    cubic-bezier(0, 0, 0.2, 1);
--motion-ease-exit:     cubic-bezier(0.4, 0, 1, 1);
--motion-ease-spring:   cubic-bezier(0.175, 0.885, 0.32, 1.275);
```

Projects can override; reviewer flags any raw-value usage.

## 8. No Flash Content

- ✘ **NEVER** create content that flashes more than 3 times per second (WCAG 2.3.1)

## 9. Custom long-running pulses

Ambient loops (live indicators, breathing affordances) are exempt from the page/complex ceilings because they aren't transitions. Declare them in config:

```json
{ "motion": { "customPulses": { "liveIndicator": 1500, "skeletonShimmer": 1500 } } }
```

The reviewer treats named pulses as approved, but still requires:
- A `prefers-reduced-motion` fallback (solid placeholder, no animation)
- A pause/stop trigger (unmount, user pause, scroll-out-of-view)
