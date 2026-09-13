---
name: ui-kit
description: "Use project UI prototypes, shared components and artboard conventions for desktop, mobile, tablet and print."
---

# UI kit — pointer skill

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

This skill is a **thin pointer**. The actual UI-kit content lives under the project's design root, defined in `<repo>/.design/config.json`:

```
<designRoot>/ui/
  ├── project/
  │   ├── <ProjectName> Studio.tsx       # multi-artboard desktop canvas (composer)
  │   ├── <ProjectName> Mobile.tsx       # multi-artboard mobile canvas (composer)
  │   ├── <Other Canvas>.tsx             # additional canvas projects
  │   ├── components/*.tsx               # shared desktop components
  │   └── components/mobile/*.tsx        # shared mobile components
  ├── chats/                             # iteration transcripts per surface (if migrated from Claude Design)
  └── README.md                          # canvas catalog
```

Per-canvas TSX files import frame primitives (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`) from `@maude/canvas-lib` — a virtual specifier the dev-server resolves to its bundled canvas-lib at `apps/studio/canvas-lib.tsx` (single source, ships with the dev-server install per DDR-025). `/design:handoff` AST-inlines the used exports on emit so the registry-item drop is self-contained (no `@maude/canvas-lib` reference survives in the consumer drop).

This skill is non-user-invocable. Auto-loads when Claude is doing UI work. The user-facing entry point is the `design` orchestrator skill.

## Canon: canvas-first, multi-artboard

Every project canvas under `<designRoot>/ui/project/` follows the same shape:

1. **`DesignCanvas`** wrapper — panable / zoomable infinite-canvas pattern.
2. **`DCSection`** blocks — labeled groups of related screens.
3. **`DCArtboard`** instances — individual screens, each wrapped in the project's app shell where applicable.

Standalone single-page HTML wrappers (one screen, no canvas) are an anti-pattern and should be migrated when found. New screens always go into an existing canvas as a new `DCArtboard`, or a new canvas project file via `/design:new`.

## Artboard kinds (feature-1-artboard-kinds-foundation)

Every `DCArtboard` declares what it IS via an optional `kind` prop: `digital` (the implicit default — screens, apps, dashboards) | `print` | `web` | `video`. Absent `kind` resolves to `digital`, or to `video` when the artboard's subtree contains a `<VideoComp>` (the pre-existing structural detection, kept as a fallback for canvases authored before this prop existed).

**Which kind to generate:**

- **`digital`** (default, omit the prop) — app screens, dashboards, mobile UI, anything meant to render in a browser/app chrome at a fixed or hug-driven box size. This is almost every canvas; don't add `kind="digital"` explicitly, it's a no-op that just adds noise.
- **`print`** — a page meant to be physically printed or exported as a print-ready PDF (business cards, posters, brochures, packaging). Paper presets, bleed/trim/margin guides, and DPI-aware export are `feature-2-print-artboards`'s scope, not this skill's — if the user is doing serious print work, check whether that plan has landed before improvising bleed marks by hand.
- **`web`** — a responsive web flow authored **flow-first**: flex/grid (or plain block flow) layout, height hugs content (`fixed` omitted), and in-artboard responsiveness rides `@container`/`cqw`/`cqh` (the artboard body is already a `container-type: inline-size` root) — never `vw`/`vh`/`@media` width queries (the existing artboard-isolation ban still applies). Absolute positioning is reserved for a deliberate, commented overlay (badge, floating CTA), not the default layout mechanism. Test reflow by dragging the artboard's width handle across breakpoints; duplicate at another breakpoint via the artboard-chrome/Inspector **"Duplicate at width…"** action (a structural copy, not a linked variant) rather than hand-copying JSX. Full generation contract: `/design:new`'s Web brief cue; full edit contract: `/design:edit`'s Web-artboard-awareness step (both feature-3-web-artboards).
- **`video`** — an artboard hosting a `<VideoComp>` composition (see the `video-comp` skill). Usually inferred automatically from the `<VideoComp>` child; only set `kind="video"` explicitly if you want the badge/Timeline affordance before any video content exists yet.

**Kind switching ≠ layout conversion.** Changing `kind` (via the artboard-chrome context menu, the Inspector's Kind picker, or a direct JSX edit) only changes chrome, editing rules, and available guide/preset content — it never touches the artboard's existing content or layout. Converting a `digital` artboard's actual layout (e.g. flow → absolute positioning) is a *different* operation, owned by `feature-4-canvas-editing-figma-parity`'s convert action or a normal agent edit. Don't conflate the two when a user asks to "make this a print artboard" — switch the prop, then separately ask whether they also want the content restructured.

**Generic layout guides.** Any artboard, regardless of kind, can carry a `guides` prop (`guides={{ columns: {count, gutter, margin}, rows: {...}, grid: {size} }}`, Figma vocabulary) — columns/rows render as violet bands, grid as red hairlines. Visibility is per-user (View menu → Layout guides), never part of the versioned canvas — don't expect a `guides` prop change alone to show anything until the viewer has guides toggled on.

## How the orchestrator uses this skill

When `design` is asked to start work on a known surface:

1. Lists canvas files in `<designRoot>/ui/project/` and matches by name.
2. Resolves component file (e.g. `<designRoot>/ui/project/components/<Surface>.jsx`) if the canvas references one.
3. Reads any matching iteration transcript in `<designRoot>/ui/chats/` — that's the source of truth for what the user actually wanted.
4. Loads tokens from `<designRoot>/<tokensCssRel>`.
5. Hands the union as the aesthetic + layout brief to `frontend-design` (for new canvases) or applies inline edits (for `/design:edit "<feedback>"`).

For unknown surfaces, the orchestrator skips component-mapping but still loads tokens + finds one similar reference canvas to learn the project's idioms.

## What you must never do

- **Never bypass the canvas pattern.** New screens go inside `DesignCanvas` artboards, not as new top-level HTML pages.
- **Never edit the migrated `chats/` transcripts** — they're historical record.
- **Never assume desktop and mobile share components** — each platform has its own subdir under `components/`.

## Cross-links

- Canvas catalog: `<designRoot>/ui/README.md` (if present)
- Per-repo config: `.design/config.json`
- Sibling skill: `design-system` (tokens, type, color)
- Sibling skill: `design` (orchestrator)
