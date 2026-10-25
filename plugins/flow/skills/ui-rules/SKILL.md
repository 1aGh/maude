---
name: ui-rules
category: shared
description: "UI hard-stop rules and audit method: WCAG 2.1 AA accessibility, responsive layout and motion."
user-invocable: false
---

# UI Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for UI work. A violation means the agent refuses, rewrites or blocks the artifact. Web (Next.js / Vite / vanilla) and React Native (Expo) — RN equivalents in parentheses. Reads `.ai/workflows.config.json`; each section can be switched off with its own flag (`skills.a11yRules.enabled`, `skills.responsiveRules.enabled`, `skills.motionRules.enabled` = `false`).

Readers: `a11y-auditor` → Accessibility + Accessibility audit; `design-system-guard` → Responsive + Motion; `/flow:validate --review` → all.

## Accessibility

Reads `theme` (`dark` | `light` | `agnostic`): `dark`/`light` validate that theme first, `agnostic` checks both.

1. **Contrast** — never below 4.5:1 for normal text, 3:1 for large text (18pt+), icons and UI components; no "decorative/branding" exemption. Validate in every configured theme, against the actual rendered background. Never convey meaning by color alone (1.4.1) — pair with text or icon.
2. **Alt text** — no `<img>` without `alt` (RN `accessibilityLabel`); no generic alt ("image", "photo", "icon"). Describe content or function; decorative = `alt=""` + `aria-hidden="true"` (RN `accessible={false}`). Charts: the key insight; video thumbnails: what is shown.
3. **Keyboard / focus** — no focus traps without escape; modals trap focus AND close on Escape, then return focus to the trigger. Tab/Shift+Tab in logical order; custom widgets fully keyboard-operable. Command palettes / comboboxes: `role="combobox"`, results `role="listbox"`.
4. **Semantics** — no `<div>`/`<span>` for interactive elements (use `<button>`, `<a>`, `<input>`, `<select>`; RN `<Pressable accessibilityRole="button">`), no `<div onClick>`. One `<h1>`, no skipped heading levels. Landmarks (`nav`, `main`, `header`, `footer`, `aside`, `section`, `article`), `ul`/`ol` for lists, `table` with `th` for tabular data.
5. **Forms** — every input has `<label for>` / `aria-label` / `aria-labelledby` (RN `accessibilityLabel`); `placeholder` is never the sole label; errors linked via `aria-describedby` (RN `accessibilityHint`).
6. **Icon-only buttons** — require an `aria-label` naming the action, not the icon (`<Button size="icon" aria-label="Search">`).
7. **Focus indicators** — never `outline-none`/`outline-0` without a visible replacement (e.g. `focus-visible:ring-2`); indicator contrast ≥ 3:1.
8. **Touch targets** — ≥ 44×44 px on mobile viewports (web-mobile + RN), ≥ 8 px between adjacent targets, padding may extend small visuals. If `responsive.densityMap` maps any platform to `palm-friendly` → ≥ 48×48; `sideline-tool` → ≥ 56×56.
9. **Motion** — honor `prefers-reduced-motion` (RN `AccessibilityInfo.isReduceMotionEnabled()`); no auto-playing audio/video with sound; pause/stop controls for animated content; nothing flashing > 3×/second (2.3.1). Details in Motion below.
10. **Skip navigation** — every multi-section page has a skip link: `<a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:text-foreground focus:p-2 focus:rounded">Skip to main content</a>`.
11. **Landmarks** — `header role="banner"`, `nav role="navigation" aria-label="…"`, `main role="main" id="main-content"`, `footer role="contentinfo"`.
12. **Bilingual UI** — when `ux.bilingual` is non-empty (e.g. `["cs","en"]`): every user-visible string translated for every code; keyboard-accessible language switcher; `<html lang>` updates on switch; change announced via `aria-live="polite"`; dates/numbers/currency use the active locale.
13. **Live regions** — live data (presence cursors, typing indicators, notifications) uses `aria-live="polite"`, `assertive` only for critical alerts; don't announce every keystroke (debounce/summarize); never steal focus on remote updates.

## Accessibility audit

How `a11y-auditor` and `/flow:validate --a11y` audit and report. Use before deploy, after `.tsx`/`.jsx` changes, when CI reports a11y failures, or for new components.

Script (project root; needs Node and the package manager): `bash <plugin>/skills/ui-rules/scripts/a11y-audit.sh [--static | --runtime | --file <path>]` (default: static + runtime + checklist). Steps in order:

1. **Static** — `eslint-plugin-jsx-a11y`: missing alt, missing accessible names, invalid ARIA, missing labels, wrong roles. Verify the ESLint config includes the plugin.
2. **Runtime** — `@axe-core/playwright` (+ `@playwright/test`; `<pm> add -D …` if missing, otherwise skip with a warning) against key pages (landing, primary features, form-heavy pages), on a running dev server (the script tries to start one; else `<pm> run dev &`). Group violations by impact: critical, serious, moderate, minor. Prefer a live agent-browser axe scan when available.
3. **Contrast** — scan CSS/token theme definitions for fg/bg pairs under 4.5:1 (3:1 large text / UI).
4. **Manual checklist** (not automatable):
   - Critical: accessible names on all interactive elements; keyboard works (Tab, Enter, Escape, arrows); no unintended focus trap; nothing hidden from screen readers.
   - Serious: contrast; visible focus; errors announced; labels associated.
   - Moderate: ARIA correct and not redundant; heading hierarchy; alt text quality; targets ≥ 44×44.
   - Minor: landmarks; skip link; live regions.

Report format — every finding carries evidence (file:line, selector, or screenshot) and severity:

```
=== A11y Audit Results ===
Static Analysis: ✅ / ❌ ({N} issues)
Runtime Audit:   ✅ / ❌ ({N} violations) / ⚠️ skipped
Contrast Check:  ✅ / ❌ ({N} potential issues)
Manual Checklist: (items)
Overall: ✅ / ❌
```

Reference: WCAG 2.1 AA quickref (w3.org/WAI/WCAG21/quickref), axe-core rule descriptions, eslint-plugin-jsx-a11y rules.

## Responsive

Reads `platforms`, `responsive.approach` (default `mobile-first`), `responsive.densityMap`, `responsive.breakpoints`.

1. **Direction matches `approach`** — with `mobile-first`, base styles target the smallest viewport and expand with `min-width`; never desktop-first overrides down.
2. **No fixed-width containers** — no fixed pixel widths on layout containers; use `max-width` + fluid widths (`%`, `vw`, `fr`, `auto`), e.g. `width:100%; max-width:80rem; margin-inline:auto`.
3. **Container queries for components** — component-level adaptation uses `container-type: inline-size` + `@container`; viewport media queries only for page-level layout.
4. **No page-body horizontal overflow** at any viewport: `overflow-wrap: break-word`, images `max-width:100%; height:auto`, tables scroll in a wrapper (`overflow-x:auto`); intentional horizontal surfaces (timelines, kanban) live inside a container, never on `<body>`.
5. **Breakpoint tokens** — no scattered raw px breakpoints; use `responsive.breakpoints` (default `sm 480, md 768, lg 1024, xl 1280, 2xl 1536`); Tailwind: built-in utilities unless config overrides.
6. **Fluid typography** — `clamp()` for scaling sizes (`clamp(1.5rem, 1rem + 2vw, 3rem)`); no static pixel font sizes; monospace numbers/IDs also fluid.
7. **Breakpoint testing** — never ship a layout tested at one size. Web matrix: 320, 480, 768, 1024, 1280, 1440 px. Native per `platforms`: `ios-phone` 393×852, `ios-tablet` 820×1180, `android-phone` Pixel 7. `scenario-runner` walks every platform in `platforms`.
8. **Density per platform** — differing density is intentional, not a parity violation; `design-system-guard` checks `responsive.densityMap` (platform → preset):

   | Preset | Tap target | Spacing | Use |
   | ------ | ---------- | ------- | --- |
   | `command-center` | hover-only | tight (4/8) | keyboard-first desktop |
   | `cozy` | 44×44 | medium (8/12/16) | default web-desktop |
   | `palm-friendly` | 48×48 | generous (12/16/24) | mobile, use under pressure |
   | `sideline-tool` | 56×56 | extra (16/24/32) | field tablets, one-handed |
   | `compact` | hover-only | very tight (2/4) | admin dashboards |

   Custom preset strings allowed.
9. **Cross-platform idioms** — mobile: breathing room, bottom navigation, quick actions; tablet: secondary tool, larger targets, denser than mobile; desktop: command center, keyboard-first, densest. Flag layouts that merely scale the same components instead of re-shaping per surface.

## Motion

Reads `motion` from config; ceilings default `micro 300`, `page 500`, `complex 1000` ms.

1. **Reduced-motion fallback** — every animation has a `@media (prefers-reduced-motion: reduce)` fallback (e.g. `transition: none`); RN: `AccessibilityInfo.isReduceMotionEnabled()`.
2. **Compositor-only properties** — animate `transform`, `opacity`, `filter`, `clip-path`; never `width`, `height`, `top`, `left`, `margin`, `padding`.
3. **Duration limits** — micro-interaction (button, hover, tag pulse) `motion.micro`; page transition (route, tab) `motion.page`; complex choreography (multi-step reveal, hero) `motion.complex`. Never exceed without a documented justification (DDR-worthy). Prefer ≤ 200 ms; if `ux.responseTargetMs` is low (e.g. 100), bias tighter.
4. **Purpose** — no decorative animation; each serves feedback, orientation, focus direction, state change, or hierarchy reveal.
5. **No uncontrolled infinite animation** — `animation-iteration-count: infinite` needs pause/stop (stops on scroll-out, unmount, user pause). Spinners are the exception (still need reduced-motion fallback); prefer skeletons.
6. **Motion tokens** — no hardcoded durations/easings; use e.g. `transition: opacity var(--motion-duration-fast) var(--motion-ease-standard)`. Recommended baseline: durations `instant 0`, `fast 100`, `normal 200`, `moderate 300`, `slow 500` ms; easings `standard cubic-bezier(0.4,0,0.2,1)`, `enter (0,0,0.2,1)`, `exit (0.4,0,1,1)`, `spring (0.175,0.885,0.32,1.275)`. Projects may override; the reviewer flags raw values.
7. **No flash content** — nothing flashing > 3×/second (WCAG 2.3.1).
8. **Custom pulses** — ambient loops (live indicators, breathing affordances) are exempt from page/complex ceilings when declared: `{ "motion": { "customPulses": { "liveIndicator": 1500, "skeletonShimmer": 1500 } } }`. Declared pulses still need a reduced-motion fallback (solid placeholder) and a pause/stop trigger.
