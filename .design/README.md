# maude — Design

<!-- AUTO-MAINTAINED by /design:setup-docs — do not edit by hand. Add notes to system/<project>/README.md or INDEX.md sections that aren't auto-generated. -->

> **CODING AGENTS: READ THIS FIRST.**
>
> This folder is the project's living design source. It's NOT a snapshot — it's continuously maintained as the team iterates on UI in this repo. When in doubt, trust the contents of this folder over any older design-tool snapshot or exported mockup.

## What's here

```
.design/
├── README.md                   ← you are here
├── INDEX.md                    ← per-canvas index (auto-updated by /design:setup-docs)
├── config.json                 ← per-repo plugin config (designSystems[], canvasGroups, handoffTargets, …)
│
├── system/
│   ├── maude/                  ← THE design system for today's client — "Unified Pro Studio"
│       ├── README.md           ← philosophy + voice + hard rules (READ BEFORE EDITING)
│       ├── SKILL.md            ← terse per-DS rules (loaded by every iterator agent)
│       ├── colors_and_type.css ← tokens (authoritative — never invent colors)
│       ├── assets/              ← brand mark + glyph assets
│       ├── preview/             ← ~79 token/component/foundation specimens (colors-*, components-*, type-scale, motion, logo, …)
│       └── ui_kits/              ← platform showcase(s)
│   └── maude-v2/               ← the Maude v2.0.0 redesign DS — "Light glass with a spark" (designer-first, light default,
│                                  floating islands over a full-window canvas; azure acts, spark = AI). Use --ds=maude-v2.
│
└── ui/                          ← 19 product canvases that consume the maude DS (ChatPanel, CreateProject, DiffView, GitHubIdentity, GitPanel, LiveCollab, Onboarding, OnboardingTour, RepoBranchSwitcher, Studio, Studio Docs, Studio Hub, Studio Intro Video, Docs Infographics, Commands Overview, Agency Hero, Horizon Landing, Maude Video Intro, Smoke TSX)
```

`_server.json`, `_active.json`, `_history/`, `_canvas-state/`, `_chat/`, `_comments/`, `_untrusted/`, `_trash/`, `_draw/`, `_sync.json`, `_locator.json`, `_export-history.json` are gitignored dev-server runtime state — they are not part of the versioned design source (see DDR-115 in the parent repo for the full taxonomy).

The plugin runs a local dev server that scans this folder, mounts canvases via `_canvas-shell.html` + React 19 importmap, and tracks the active tab + element selection in `_active.json` (gitignored). Iterations are persisted in `_history/<slug>/` (gitignored): snapshots, critic reports, screenshots, and a chat transcript.

## What you should do — IMPORTANT

1. **Read `INDEX.md` first.** It lists every canvas with its title, brief, platform, sections/artboards, tokens used, and iteration history — the fastest way to orient before touching anything.
2. **Read the iteration chat transcripts** under `_history/<slug>/` (where present) before making changes — they carry the reasoning behind past decisions, not just the diffs.
3. **Read the primary `.tsx` file top to bottom** and follow its imports (shared canvas-lib, sibling `.css`, any `.registry.json` handoff manifest) before editing — don't guess at structure from a screenshot.
4. **Ask if ambiguous.** If a brief or a piece of feedback could mean two different things, ask rather than picking one silently.

## About the design files

Canvases are TSX + CSS prototypes built on the shared `@maude/canvas-lib` (`DesignCanvas`, `DCSection`, `DCArtboard`, plus shared hooks/helpers). A canvas is a multi-artboard composition: `DesignCanvas` is the outer frame, `DCSection` groups related screens, and each `DCArtboard` is one concrete screen/state at a fixed pixel size. This lets one file hold an entire flow (e.g. GitPanel's changes / save / publish / empty / conflict states) as five artboards a viewer can pan between.

## Hard rules (from maude's design system)

- **The accent has exactly one job per surface.** Primary action, current selection, or active tab — never a decorative fill. Accent-everywhere = nothing leads.
- **No decorative gradient backdrops.** Flat crisp panels + the dot-grid only. No mesh / aurora / candy gradients competing with the canvas.
- **Chrome must not out-shout the canvas.** If a panel pulls the eye before the work does, it's wrong. Dense but calm; hairlines do the separating, not heavy fills or shadows.
- **No emoji in chrome.** Thin-stroke (1px) geometric SVG glyphs only — terminal/IDE heritage.
- **Tokens only.** No hardcoded hex / off-ladder type px in specimens. Layout dimensions (frame widths/heights) may be px; everything else is a `var(--*)`.

## How tokens work

The authoritative token file is [`system/maude/colors_and_type.css`](./system/maude/colors_and_type.css) — never invent a color, spacing, radius, or duration value outside it. Surfaces are a cool-neutral elevation ladder (`--bg-0..4`), the accent is a single confident indigo (`--accent`, `oklch(0.60 0.19 268)` dark / `oklch(0.52 0.195 268)` light), status/presence families cover success/warn/error/info and online/away/offline/agent. Type is Inter for display + body, JetBrains/Geist Mono for anything tabular (numbers, coordinates, part-IDs). Motion is crisp and snappy (`--dur-flip 140ms`, `--ease-out`); `prefers-reduced-motion` collapses every duration to 1ms.

## Production handoff targets (in this repo)

| Label | Path | Platform |
|---|---|---|
| shadcn registry | `registry:item` | web |

## Plugin commands quick reference

| Command | What it does |
|---|---|
| `/design:edit "<feedback>"` | Iterate on the active canvas in place (auto-runs the critic panel) |
| `/design:new "<Name>" "<brief>"` | Scaffold a new full canvas under `ui/` |
| `/design:critic` | Run the full critic panel (or a single agent) on the active canvas |
| `/design:rollback` | Undo the last `/design:edit` |
| `/design:screenshot` | Capture a screenshot of the active canvas |
| `/design:setup-docs` | Refresh this README + INDEX (`--full` for a complete regen) |
| `/design:setup-ds` | Bootstrap or re-bootstrap a design system |
| `/design:handoff` | Emit a production-ready registry item for the active canvas |
| `/design:browse` | Open the dev-server tab (file tree + iframe preview) |
| `/design:help` | Grouped command index |

## Last updated

2026-07-31T08:32:00Z
