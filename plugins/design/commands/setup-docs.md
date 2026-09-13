---
name: setup-docs
category: setup
description: "Refresh the design root README and canvas index."
argument-hint: "[--full]"
---

# /design:setup-docs — refresh design root docs

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

The plugin runs in the **same repo** where the implementation lives. There's no zip / external bundle — `<designRoot>/` itself IS the always-current handoff target.

This command (re)generates two top-level files in `<designRoot>/`:

- **`README.md`** — Claude-Design-compatible "CODING AGENTS: READ THIS FIRST" guide. Tells any agent / human picking up the repo what's in `<designRoot>/`, where to start, and how to consume the canvases.
- **`INDEX.md`** — canvas catalog. Per-canvas title / brief / sections / artboards / tokens used / iteration count. Auto-built from `<canvas>.meta.json` sidecars + chat transcripts.

Both files are committed (not gitignored) — they're project documentation, not runtime state.

**Auto-runs at the end of `/design:edit` and `/design:new`** (after auto-critic loop completes). Manual trigger via this command when you want to force a refresh outside of those flows.

## Vstup `$ARGUMENTS`

`[--full]`

| Flag | Default | Effect |
|---|---|---|
| `--full` | (incremental) | Force full regeneration of both files. Default: incremental (only updates the canvas entry that changed and re-counts top-line stats). |

## Postup

Vyvolej skill `design` se vstupem: `setup-docs $ARGUMENTS`.

### 1. Resolve config

```bash
CFG=.design/config.json
NAME=$(jq -r .name "$CFG")
DESIGN_ROOT=$(jq -r '.designRoot' "$CFG")
NEW_CANVAS_DIR=$(jq -r '.newCanvasDir' "$CFG")
TOKENS_REL=$(jq -r '.tokensCssRel' "$CFG")
```

### 2. Inventory

For each `*.tsx` in `<DESIGN_ROOT>/<NEW_CANVAS_DIR>/`:
- Read sibling `<Canvas>.meta.json` if exists; otherwise generate stub from filename.
- Note iteration count from `<DESIGN_ROOT>/_history/<slug>/chat.md` (count `## Iteration` headers).
- Note latest screenshot path from `<DESIGN_ROOT>/_history/<slug>/screenshots/*.full.png`.
- Extract `tokens_used[]` from canvas via `grep -oE 'var\(--[a-z0-9-]+\)' <canvas> | sort -u`.

### 3. Generate `<DESIGN_ROOT>/README.md`

Template (adapted with project specifics):

```markdown
# {NAME} — Design

> **CODING AGENTS: READ THIS FIRST.**
>
> This folder is the project's living design source. It's NOT a snapshot — it's continuously maintained as the team iterates on UI in this repo. When in doubt, trust the contents of this folder over any older design-tool snapshot or exported mockup.

## What's here

```
{DESIGN_ROOT}/
├── README.md                 # this file (auto-maintained by /design:setup-docs)
├── INDEX.md                  # canvas catalog (auto-maintained)
├── config.json               # per-repo plugin config
├── system/                   # design system: tokens, assets, ui kits, README
│   ├── {project}/
│   │   ├── README.md
│   │   ├── colors_and_type.css         # ← authoritative tokens
│   │   ├── assets/                     # logos, brand glyphs
│   │   ├── preview/                    # browsable specimens (color/type/components)
│   │   └── ui_kits/                    # reference UI compositions
└── {NEW_CANVAS_DIR}/         # canvas projects (multi-artboard DesignCanvas files)
    ├── <Canvas-1>.tsx                  # ← TSX canvas (React 19 + Bun.build pipeline)
    ├── <Canvas-1>.meta.json            # ← title / brief / sections / tokens used
    ├── <Canvas-1>.css                  # ← optional sibling stylesheet (when css_mode=inline)
    ├── <Canvas-2>.tsx
    ├── ...
    └── components/                     # shared component .tsx files
```

The plugin runs a local dev server (`bun ${CLAUDE_PLUGIN_ROOT}/dev-server/server.ts`) that scans this folder, mounts canvases via `_canvas-shell.html` + React 19 importmap, and tracks the active tab + element selection in `_active.json` (gitignored). Iterations are persisted in `_history/<slug>/` (gitignored): snapshots, critic reports, screenshots, and a chat transcript.

## What you should do — IMPORTANT

**Read `INDEX.md` first** — it lists every canvas with title, brief, sections, artboards, and which production routes they map to. Pick the canvas matching the work scope.

**Read its iteration transcript next.** Each canvas with iteration history has a chat at `_history/<slug>/chat.md`. The chat shows the back-and-forth between the user and the design assistant — it tells you **what the user actually wants** and **where they landed**. The canvas file is the output, but the chat is where the intent lives. (If `--include-history` was used in a prior export, transcripts may also be at `chats/<slug>.md`.)

**Find the canvas's primary `.tsx` and read it top to bottom.** Each canvas project is a multi-artboard `DesignCanvas` file importing envelope primitives from `@maude/canvas-lib`. Then **follow its imports**: open every component file under `components/`, the tokens at `system/{project}/colors_and_type.css`, and the canvas's `.meta.json` sidecar.

**If anything is ambiguous, ask the user to confirm before you start implementing.** It's much cheaper to clarify scope up front than to build the wrong thing.

## About the design files

The design medium is **TSX + CSS** (React 19 source) — these are prototypes, not production code. Your job is to **recreate them pixel-perfectly** in whatever technology the production codebase uses (React, Vue, native, whatever fits). Match the visual output; don't copy the prototype's internal structure unless it happens to fit.

Each canvas is a **multi-artboard `DesignCanvas`** with one or more `DCSection` blocks containing `DCArtboard` instances. Each artboard is a separate screen — you implement them as separate routes / components in production.

**Don't render canvases in a browser or take screenshots unless asked to.** Everything you need (dimensions, colors, layout rules, intended behaviors) is in the source TSX (legacy: HTML), the `.meta.json` sidecar, and the chat transcript. Read them directly.

## Hard rules (from {NAME}'s design system)

{Extract bulleted hard-rules from system/{project}/README.md "Hard rules", "CONTENT FUNDAMENTALS", or "VISUAL FOUNDATIONS" sections. If none, omit this section.}

## How tokens work

The authoritative token file is `system/{project}/colors_and_type.css`. Every canvas links to it. Production code should consume the same tokens (compiled to TS/JS or kept as CSS vars). Never invent tokens — extend the source CSS instead.

## Production handoff targets (in this repo)

{If config.handoffTargets is non-empty, list:}

| Label | Path | Platform |
|---|---|---|
| {target.label} | {target.path} | {target.platform} |
| ... |

Use `/design:handoff [--target <label>]` to migrate the active canvas to one of these. The handoff translates the prototype's structure to the framework / conventions of the target codebase.

## Plugin commands quick reference

| Command | Purpose |
|---|---|
| `/design:edit "<feedback>"` | Edit active canvas in place (auto-critic loop runs after) |
| `/design:edit "<…>" --perfect` | Same, with up to 8 polish iterations |
| `/design:new "<Name>" "<brief>"` | Scaffold a new canvas project |
| `/design:critic` | Run review panel (orchestrator-routed; or `--agent <name>` / `--all`) |
| `/design:rollback` | Undo last edit |
| `/design:screenshot` | Capture canvas / selected element |
| `/design:setup-docs` | Refresh this README + INDEX (auto-runs after /design:edit and /design:new) |
| `/design:setup-ds <name>` | Create another design system |
| `/design:handoff` | Migrate active canvas to a handoff target |
| `/design:browse` | Boot the local dev server |
| `/design:help` | Grouped command index |

## Last updated

{ISO timestamp}
```

### 4. Generate `<DESIGN_ROOT>/INDEX.md`

```markdown
# Canvas index — {NAME}

_Auto-maintained by `/design:setup-docs`. Last updated {ISO}._

## All canvases

| File | Title | Platform | Sections | Artboards | Iter | Last modified |
|---|---|---|---|---|---|---|
| {Canvas}.tsx | {meta.title} | {meta.platform} | {meta.sections.length} | {sum of artboards} | {meta.iteration_count} | {meta.last_modified} |
| ... |

## Per-canvas detail

### {Canvas}.tsx

**Title:** {meta.title}{"  ·  " + meta.subtitle if subtitle}

**Brief:** {meta.brief}

**Platform:** {meta.platform}

**Sections:**

- `{section.id}` — {section.label} ({section.subtitle})
  - `{artboard.id}` — {artboard.label} ({artboard.platform}, {artboard.width}×{artboard.height}{", → " + artboard.screen_route if route})
  - ...

**Tokens used:** {tokens_used joined with comma}

**Iteration history:** {iteration_count} cycles · last edit {last_modified} · transcript at `_history/{slug}/chat.md`

**Latest screenshot:** `_history/{slug}/screenshots/{NNN}.full.png` _(if exists)_

---

(Repeat per canvas, sorted by last_modified descending.)

## Statistics

- Canvases: {N}
- Total artboards: {K}
- Total iterations across all canvases: {sum}
- Tokens defined: {count from tokens CSS}
- Tokens used by canvases: {distinct count from union of tokens_used}
- Components: {N from components/}
- Last canvas modified: {most recent timestamp}
```

### 5. Write files

Atomic write (write to `.tmp` then rename):

```bash
write README.md.tmp ; mv README.md.tmp README.md
write INDEX.md.tmp ; mv INDEX.md.tmp INDEX.md
```

### 6. Verify both files have the auto-marker

The orchestrator embeds a marker in each generated file so subsequent `/design:setup-docs` runs know it's safe to overwrite (vs. user-written README that we shouldn't clobber):

```html
<!-- AUTO-MAINTAINED by /design:setup-docs — do not edit by hand. Add notes to system/<project>/README.md or INDEX.md sections that aren't auto-generated. -->
```

If `<designRoot>/README.md` exists WITHOUT this marker → fail with "User-written README.md found. Move it or rename it before running /design:setup-docs."

### 7. Print

```
✓ Refreshed: <designRoot>/README.md  ({size} kB)
✓ Refreshed: <designRoot>/INDEX.md   ({size} kB)
  Canvases: {N} · Total artboards: {K} · Total iterations: {sum}
  {if any canvas missing meta.json: list them as warnings}
```

## Auto-trigger from /design and /design:new

After auto-critic loop in `/design` or `/design:new` exits at any non-fatal terminal state (`solid`, `stable-but-bland`, `max-reached`, `divergent`, `validation-failed`, or `--no-critic` skip), the orchestrator calls **incremental** docs refresh. The only path that skips it is server / snapshot infrastructure failure, where canvas state is unknown:

```
update meta.json for the canvas (last_modified, iteration_count, tokens_used)
update INDEX.md row for that canvas (sed-style line replace)
update README.md "Last updated" line
```

Full regeneration only when `--full` passed or when meta.json schema changes.

## Failure modes

| Symptom | Action |
|---|---|
| `<designRoot>/config.json` missing | Use plugin defaults; emit warning. |
| `<designRoot>/README.md` exists without auto-marker | Refuse — user-written README; ask user to move/rename. |
| Tokens CSS unreadable | Skip "Hard rules" section in README; warn in print. |
| Canvas missing `.meta.json` | Stub it inline (title from filename, no sections). Print warning. |
| Chat transcript missing | INDEX entry shows "no iteration history". |
| `_history/<slug>/screenshots/` empty | INDEX entry omits "Latest screenshot" line. |

## What `/design:setup-docs` does NOT do

- **No commits.** Files land in `<designRoot>/`; user commits when ready.
- **No `.zip`** — docs live next to canvases, in same repo, in same commit.
- **No external transport** — never pushed to remote / shared / posted to Slack.
- **Not a substitute for `/design:handoff`** — this command produces *documentation*; handoff produces *production code in target paths*.
