---
name: a11y-rules
description: "Apply WCAG 2.1 AA checks for contrast, keyboard access, semantics, forms, focus and reduced motion."
user-invocable: false
---

# Accessibility Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for WCAG 2.1 AA compliance. Violations require the AI agent to refuse, rewrite, or block the artifact. Web (Next.js / Vite / vanilla) and React Native (Expo) — RN equivalents in parentheses.

This skill reads `theme` from `.ai/workflows.config.json` (values: `dark`, `light`, `agnostic`). `dark` / `light` enable theme-first contrast validation; `agnostic` checks both. Skip with `skills.a11yRules.enabled: false`.

## 1. Color Contrast

- ✘ **NEVER** ship foreground/background combinations below 4.5:1 for normal text
- ✘ **NEVER** ship below 3:1 for large text (18pt+), icons, or UI components
- ✘ **NEVER** exempt text from contrast by labeling it "decorative" or "branding"
- ✔ Validate contrast in **every theme listed in config**. If `theme: dark`, dark mode is the primary check and light mode (if shipped) is verified secondarily.
- ✔ Test against the actual rendered background, not the nearest parent
- ✔ Pair color indicators with text or icons (WCAG 1.4.1 — never color alone)

## 2. Image Alt Text

- ✘ **NEVER** output `<img>` without an `alt` attribute (RN: `<Image accessibilityLabel="...">`)
- ✘ **NEVER** use generic alt text: "image", "photo", "icon", "picture"
- ✔ Descriptive alt text conveying content or function
- ✔ `alt=""` + `aria-hidden="true"` for purely decorative images (RN: `accessible={false}`)
- ✔ Charts: alt summarizes the key insight, not just "chart"
- ✔ Video thumbnails: describe what's shown, not just "video"

## 3. Keyboard Navigation / Focus Management

- ✘ **NEVER** create elements that trap keyboard focus without escape
- ✘ **NEVER** open modal/dialog without focus trapping AND Escape dismissal
- ✔ Tab / Shift+Tab cycle through interactive elements in logical order
- ✔ Return focus to the triggering element when modal closes
- ✔ Custom interactive components operable via keyboard alone
- ✔ Command palettes / combobox patterns: full keyboard, `role="combobox"`, results `role="listbox"`

## 4. Semantic HTML / Accessibility Roles

- ✘ **NEVER** use `<div>` or `<span>` for interactive elements — use `<button>`, `<a>`, `<input>`, `<select>` (RN: `<Pressable accessibilityRole="button">`)
- ✘ **NEVER** use `<div onClick>` when `<button>` is appropriate
- ✘ **NEVER** skip heading levels — one `<h1>` per page, no skips
- ✔ Semantic landmarks: `<nav>`, `<main>`, `<header>`, `<footer>`, `<aside>`, `<section>`, `<article>`
- ✔ `<ul>`/`<ol>` for lists, `<table>` with `<th>` for tabular data

## 5. Form Labels

- ✘ **NEVER** render form inputs without `<label>` or `aria-label`/`aria-labelledby` (RN: `accessibilityLabel`)
- ✘ **NEVER** use `placeholder` as the sole label
- ✔ Labels associated via `htmlFor`/`for` matching input `id`
- ✔ Error messages linked via `aria-describedby` (RN: `accessibilityHint`)

## 6. Icon-Only Buttons

- ✘ **NEVER** render an icon-only button without `aria-label` (RN: `accessibilityLabel`)
- ✔ Provide an `aria-label` that describes the action, not the icon

```tsx
// ❌ <Button size="icon"><SearchIcon /></Button>
// ✅ <Button size="icon" aria-label="Search"><SearchIcon /></Button>
```

## 7. Focus Indicators

- ✘ **NEVER** apply `outline-none` / `outline-0` without a visible replacement
- ✔ Use `focus-visible:ring-2 focus-visible:ring-ring` or equivalent
- ✔ Focus indicator contrast ≥ 3:1 against surroundings

## 8. Touch Targets (Mobile)

- ✔ Interactive elements ≥ 44×44 px on mobile viewports (web-mobile + RN)
- ✔ Minimum 8px spacing between adjacent targets
- ✔ Small visual elements may use padding to meet the minimum
- ✔ If config has any platform mapped to a `palm-friendly` or `sideline-tool` density in `responsive.densityMap`, targets ≥ 48×48 px and 56×56 px respectively

## 9. Motion & Animation

- ✔ Honor `prefers-reduced-motion` (RN: `AccessibilityInfo.isReduceMotionEnabled()`)
- ✘ **NEVER** auto-play audio or video with sound
- ✔ Provide pause/stop controls for animated content
- ✘ No content that flashes more than 3 times per second (WCAG 2.3.1)

See `motion-rules` for full duration and easing constraints.

## 10. Skip Navigation

Every multi-section page must include a skip-nav link:

```html
<a href="#main-content"
   class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:bg-background focus:text-foreground focus:p-2 focus:rounded">
  Skip to main content
</a>
```

## 11. ARIA Landmarks / `accessibilityRole`

Every page identifies landmark regions:

- `<header role="banner">` — site header
- `<nav role="navigation" aria-label="...">` — navigation
- `<main role="main" id="main-content">` — primary content
- `<footer role="contentinfo">` — site footer

## 12. Bilingual UI

If `ux.bilingual` is non-empty (e.g. `["cs", "en"]`):

- ✔ All user-visible strings have translations for every listed code
- ✔ Language switcher is keyboard-accessible
- ✔ `<html lang="...">` updates when language switches
- ✔ Screen reader announces language changes (`aria-live="polite"` on the language attribute change region)
- ✔ Date / number / currency formats use the active locale

## 13. Realtime / Live Regions

For features that surface live data (presence cursors, typing indicators, "X is editing", notifications):

- ✔ Use `aria-live="polite"` — never `assertive` unless the update is critical (security alert, fire)
- ✔ Don't announce every keystroke — debounce or summarize
- ✔ Avoid focus-stealing on remote updates
