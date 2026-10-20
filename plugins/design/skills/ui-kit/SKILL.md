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

Standalone single-page HTML wrappers (one screen, no canvas) are an anti-pattern and should be migrated when found. New screens always go into an existing canvas as a new `DCArtboard`, or a new canvas via `/design:new` (made by the app's own create, so it matches the one ⌘N makes: "Untitled canvas", the default design system, or the one its folder uses).

## Artboard kinds (feature-1-artboard-kinds-foundation · S7.20)

Every `DCArtboard` declares what it IS via a `kind` prop: `digital` (the designer word is **Fixed size**: screens, apps, social pictures at exact pixels) | `web` (**Web page**) | `print` (**Print**) | `video` (**Video**). The size picker (F over empty canvas) groups them by what you are making: **App · Web page · Social · Print · Video**; App and Social both make a Fixed size artboard. Read [Artboards of a kind](../design/_guide-28-artboards.md) for the presets, the exact `<DCArtboard>` each one writes, and the order to add them in; never guess a size or write `paper: "custom"`. An artboard with no `kind` still resolves to `digital`, or to `video` when its subtree contains a `<VideoComp>` (the structural fallback for canvases written before the prop existed), but anything you add now carries its kind.

**Which kind to generate:**

- **Fixed size** (`kind="digital" fixed`, written by the App and Social presets) — app screens, dashboards, mobile UI, and fixed-size social pictures (a post, a story, a cover). A picked preset always writes the kind, so write it too; App screens are flow-first, Social compositions are absolute-first.
- **Print** (`kind="print" print={{ paper, orientation }}`) — a page meant to be physically printed or exported as a print-ready PDF (business cards, posters, brochures). The px size is trim + 2 × bleed, so it comes from the paper (the table in the guide), with bleed, trim and safe-margin guides and DPI-aware export on top.
- **Web page** (`kind="web"`) — a responsive web flow authored **flow-first**: flex/grid (or plain block flow) layout, height hugs content (`fixed` omitted), and in-artboard responsiveness rides `@container`/`cqw`/`cqh` (the artboard body is already a `container-type: inline-size` root) — never `vw`/`vh`/`@media` width queries (the existing artboard-isolation ban still applies). Absolute positioning is reserved for a deliberate, commented overlay (badge, floating CTA), not the default layout mechanism. One artboard per breakpoint (Desktop 1440 · Laptop 1280 · Tablet 834 · Mobile 390); the artboard menu's "Duplicate at another width" makes a structural copy, not a linked variant. Full generation contract: `/design:new`'s Web brief cue; full edit contract: `/design:edit`'s Web-artboard-awareness step (both feature-3-web-artboards).
- **Video** (`kind="video"`) — an artboard hosting a `<VideoComp>` composition (see the `video-comp` skill), written by the Video presets (Reels 9:16 · Landscape 16:9 · Square 1:1).

**Changing the kind of a finished artboard is not a prop edit.** The person's "Change kind" makes a scaled copy beside the original and says what moved; it never quietly rewrites the artboard. To get another size or kind, add a new artboard of that preset and fill it. Switching a Fixed size artboard to a Web page, or the reverse, changes chrome and editing rules only; it never converts the content's layout (flow to absolute is a different, deliberate operation).

**Generic layout guides.** Any artboard, regardless of kind, can carry a `guides` prop (`guides={{ columns: {count, gutter, margin}, rows: {...}, grid: {size} }}`, Figma vocabulary) — columns/rows render as violet bands, grid as red hairlines. Visibility is per viewer, never part of the versioned canvas (print guides are under Menu › View › Advanced ▸ Print guides) — don't expect a `guides` prop change alone to show anything until the viewer has guides toggled on.

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
