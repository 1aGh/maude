---
name: responsive-rules
description: "Check responsive layouts, typography, breakpoints, overflow and density across device sizes."
user-invocable: false
---

# Responsive Rules

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Hard-stop rules for responsive layout. Violations require the AI agent to refuse, rewrite, or block the artifact.

This skill reads `platforms`, `responsive.approach`, `responsive.densityMap`, and `responsive.breakpoints` from `.ai/workflows.config.json`. The density map tells the reviewer which density preset each platform expects — projects with cross-platform UX shouldn't ship the same layout on `web-desktop` (command center) and `web-mobile` (sideline tool). Skip the skill with `skills.responsiveRules.enabled: false`.

## 1. Layout direction matches `approach`

- Default `responsive.approach: mobile-first`.
- ✘ With `mobile-first`, **NEVER** write desktop-first styles that override down to mobile.
- ✔ Base styles target the smallest viewport; use `min-width` to expand.

```css
/* ❌ Desktop-first */
.grid { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }

/* ✅ Mobile-first */
.grid { grid-template-columns: 1fr; }
@media (min-width: 768px) { .grid { grid-template-columns: repeat(4, 1fr); } }
```

## 2. No Fixed-Width Containers

- ✘ **NEVER** set fixed pixel widths on layout containers
- ✔ Use `max-width` with fluid widths (`%`, `vw`, `fr`, `auto`)
- ✔ Exception: `max-width` cap on content containers (e.g. `max-width: 80rem`)

```css
/* ❌ */ .container { width: 1200px; }

/* ✅ */
.container { width: 100%; max-width: 80rem; margin-inline: auto; }
```

## 3. Container Queries for Component Layout

- ✘ **NEVER** use viewport media queries for component-level responsive behavior
- ✔ Prefer container queries for component adaptation
- ✔ Reserve viewport media queries for page-level layout changes

```css
/* ✅ */
.card-wrapper { container-type: inline-size; }
@container (min-width: 400px) { .card { flex-direction: row; } }
```

## 4. No Page-Body Horizontal Overflow

- ✘ **NEVER** allow horizontal scrollbars on the page body at any viewport
- ✔ `overflow-wrap: break-word` for long text
- ✔ Images: `max-width: 100%; height: auto`
- ✔ Tables: `overflow-x: auto` on a wrapper, not the body
- ✔ Intentional horizontal scroll surfaces (timelines, kanban canvases, sheet music) live **inside** a container, never on `<body>`

## 5. Breakpoint Tokens Required

- ✘ **NEVER** scatter raw pixel breakpoint values throughout stylesheets
- ✔ Reference tokens from `responsive.breakpoints` (default `sm: 480, md: 768, lg: 1024, xl: 1280, 2xl: 1536`)
- ✔ Tailwind users: stick to built-in breakpoint utilities unless the config overrides defaults

## 6. Fluid Typography

- ✔ Use `clamp()` for sizes that scale between breakpoints
- ✘ **NEVER** use static pixel font sizes that don't adapt
- ✔ Monospace for numbers / timecodes / IDs — also fluid via `clamp()`

```css
h1 { font-size: clamp(1.5rem, 1rem + 2vw, 3rem); }
```

## 7. Breakpoint Testing Required

- ✘ **NEVER** ship layouts tested at only one viewport size
- ✔ Web minimum testing matrix: 320, 480, 768, 1024, 1280, 1440 px
- ✔ Native viewports per platform in `platforms`:
  - `ios-phone` → 393×852 (iPhone 15 baseline)
  - `ios-tablet` → 820×1180 (iPad Air 11")
  - `android-phone` → Pixel 7 viewport
- ✔ `scenario-runner` subagent walks every platform in `platforms`

## 8. Density-Per-Platform

Density differs intentionally across platforms — that is **not** a parity violation. The `design-system-guard` subagent reads `responsive.densityMap` to decide what density is correct for each platform.

Recommended density presets (custom strings allowed):

| Preset | Tap target | Spacing scale | Use case |
| ------ | ---------- | ------------- | -------- |
| `command-center` | hover-only | tight (4/8) | Linear / Bloomberg-style desktop UI, keyboard-first |
| `cozy` | 44×44 min | medium (8/12/16) | Default web-desktop |
| `palm-friendly` | 48×48 min | generous (12/16/24) | Mobile + use-under-pressure (sideline, gloves, kitchen) |
| `sideline-tool` | 56×56 min | extra-generous (16/24/32) | Tablets in the field, one-handed |
| `compact` | hover-only | very tight (2/4) | Admin dashboards |

Example config:

```json
{
  "platforms": ["web-desktop", "web-mobile", "ios-phone", "ios-tablet"],
  "responsive": {
    "densityMap": {
      "web-desktop": "command-center",
      "web-mobile":  "palm-friendly",
      "ios-phone":   "palm-friendly",
      "ios-tablet":  "sideline-tool"
    }
  }
}
```

## 9. Cross-Platform Idioms (not just breakpoints)

When `platforms` includes both mobile and tablet/desktop variants, treat them as different surfaces:

- **Mobile** — breathing room, palm-friendly, consumption + quick actions, bottom navigation.
- **Tablet** — secondary tool, larger tap targets, denser than mobile.
- **Desktop** — command center, keyboard-first, densest layouts.

The `design-system-guard` flags layouts that simply scale the same components rather than re-shape for the surface.
