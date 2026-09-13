---
name: handoff
category: daily
description: "Create a shadcn registry handoff for the active canvas."
argument-hint: "[--canvas <path>] [--force]"
---

# /design:handoff — shadcn registry-item.json sidecar

Follow [host conventions](../HARNESS.md) for Claude Code or Codex.

Converts the active canvas (from `_active.json`) into **`<Slug>.registry.json`** next to the TSX file. The target project consumes it via `bunx shadcn add file://./<Slug>.registry.json` — works for Next.js / Vite / Astro / Remix / Bun, any framework that has the `shadcn` CLI.

What the sidecar contains:

1. **`files[0]`** — the canvas TSX, **without `data-cd-id` attributes** (dev-time scaffolding, production doesn't need them).
2. **`files[1]`** (only for `css_mode: "inline"`) — a subset of `_components.css` trimmed to the rules whose class appears in the canvas (`.btn`, `.tile`, `.sku`, ...). BEM modifiers (`.btn--ghost`) ride along with the base class.
3. **`files[2]`** (only for `css_mode: "inline"`) — a subset of the `colors_and_type.css` tokens that the trimmed CSS references via `var(--*)`.
4. **`cssVars.theme`** — the same tokens in shadcn format, so the CLI grafts them into `app/globals.css`.
5. **`dependencies`** — the npm spec resolved from `Bun.Transpiler.scanImports()` (`react`, `react-dom` + whatever else). React + ReactDOM are the floor (DDR-012).
6. **`registryDependencies`** — `@/components/ui/*` imports map to shadcn primitive names (`button`, `card`, ...).
7. **`meta.kind`** (feature-3-web-artboards T6) — the resolved artboard `kind` (`digital` | `print` | `web` | `video`, or `mixed` when the canvas mixes kinds across artboards), read straight off the source `<DCArtboard kind="…">` attributes — shadcn's generic item-metadata extension point, not a maude-invented schema field.

**Web-kind handoff notes.** A `kind="web"` canvas hands off as ordinary flex/grid React + CSS — there is no web-specific transform in the emitted drop, which is the point: the artboard's own authoring contract (flow-first layout, `@container`/`cqw`/`cqh` for in-artboard responsiveness, no `vw`/`vh`) already IS production-grade responsive code, so it survives the strip-and-bundle pass unchanged. Two things worth knowing before consuming the drop:
- `@container` queries need a `container-type` ancestor in the CONSUMER'S page too — the canvas relies on canvas-lib's `.dc-artboard-body { container-type: inline-size }`, which does not ship with the drop (canvas-lib is dev-time only, DDR-025). Wrap the dropped component in an element with `container-type: inline-size` (or add that rule to whatever wrapper the consumer already uses) so the container queries keep working outside the canvas.
- The artboard's own `width` was a **breakpoint marker** (T2's "≤ Npx" chrome), not a hard constraint — the dropped component has no outer width lock, so it reflows to whatever the consumer's layout gives it. That's usually the desired outcome (production web code should reflow); if multiple breakpoint duplicates (T3) were hand off separately, dedupe them into one responsive component in the consumer project rather than shipping N near-identical drops.

**Input `$ARGUMENTS`:** `[--canvas <path>] [--force]`

- `--canvas <path>` — explicit path to the canvas .tsx (default = `_active.json.active`).
- `--force` — emit the sidecar even with open blockers in the latest critique.

**Example:**
```
/design:handoff
/design:handoff --canvas .design/ui/Docs\ Site.tsx
/design:handoff --force
```

## Pre-requisites

1. **Canvas is `.tsx`** — TSX is the only supported format.
2. **`handoffTargets[0].path === "registry:item"`** in `.design/config.json` (default after the Task 10 update).
3. **Latest critique has `blockers === 0`** — if not, fail with the suggestion `/design:edit "Address: <top blocker>"`. Override with `--force`.

## Procedure

### 1. Resolve canvas + meta

```bash
CFG=.design/config.json
DESIGN_ROOT=$(jq -r '.designRoot' "$CFG")
ACTIVE=$(jq -r '.active' "$DESIGN_ROOT/_active.json")
CANVAS="$DESIGN_ROOT/$ACTIVE"
[ "${CANVAS##*.}" != "tsx" ] && echo "handoff: canvas is not .tsx — migrate first" && exit 1
```

Read `<canvas>.meta.json` (for `title` + `subtitle` → registry `title`/`description`).

### 2. Pre-flight blocker check

Same as `/design:critic` — the last run's `_history/<slug>/<NNN>-critic.md`. `blockers: 0` ⇒ proceed, otherwise fail.

### 3. Run the handoff helper via `maude design handoff`

```bash
maude design handoff "$CANVAS" "$DESIGN_ROOT"
```

The wrapper calls `bun run handoff.ts --emit <canvas> <designRoot>`. The script:

1. Reads the canvas TSX.
2. Strips `data-cd-id` attributes (AST-aware, oxc-parser + magic-string).
3. Classifies imports (npm vs `@/components/ui/*`).
4. For `css_mode: "inline"` canvases:
   - Collects every `className` literal token (`btn`, `btn--ghost`, `sku`, ...).
   - Trims `_components.css` down to only the rules with matching base classes (BEM modifiers + pseudo-classes come along).
   - Extracts `var(--*)` references from the trimmed CSS + trims `colors_and_type.css` down to them.
5. Assembles the `RegistryItem` structure per the [shadcn registry-item schema](https://ui.shadcn.com/schema/registry-item.json).
6. Writes atomically to `<canvas-dir>/<Slug>.registry.json`.

### 4. Report the output

```
✅ Handoff sidecar: .design/ui/Docs Site.registry.json
   files: 3  (component + style + theme)
   deps:  2  (react, react-dom)
   registryDependencies: 0
   
   Consume in the target project:
     bunx shadcn add file://$(pwd)/.design/ui/Docs\ Site.registry.json
```

### 5. Follow-up steps

- If the sidecar emits successfully + the component runs in a scratch project → save the path to `_history/<slug>/handoff/<NNN>-registry.json.md` as a log.
- **Record the handoff in the graph (kgai — when active).** A handoff is the moment a canvas stops being a mock and becomes a production contract — worth remembering, and `_history/**` is gitignored so the log alone won't carry it:

  ```bash
  maude kg record-log --file "<designRoot>/_history/<slug>/handoff/<NNN>-registry.json.md" \
    --kind handoff --about "canvas:<slug>" --link HANDED_OFF
  ```

  Silent no-op when the graph is inactive; run it unconditionally. Skip it when the handoff failed its blocker gate — record what shipped, not what was attempted. Contract: **`flow:kgai-backend`**.
- For a multi-canvas batch handoff: loop over `_active.json.open_tabs` or `find .design/ui -name '*.tsx'`.

## What handoff DOES / DOES NOT do

**DOES:**
- Strips `data-cd-id` (dev scaffolding off).
- Resolves `dependencies` from the imports (`react` + `react-dom` always).
- Bundles the used subset of `_components.css` + tokens (for `css_mode: "inline"`).
- Writes the sidecar atomically.

**DOES NOT:**
- Doesn't commit. The sidecar stays in `.design/ui/` — the user commits whenever they want.
- Doesn't run tests.
- Doesn't push to the shadcn registry namespace (for public hosting use your own pipeline).
- Doesn't change the target framework (the canvas TSX is already React 19, the target project too — no runtime translation).

## Failure modes

- **Canvas isn't `.tsx`** → fail "migrate first".
- **`handoffTargets` in the config lacks `registry:item`** → fail with the suggestion `maude config set handoffTargets ...`.
- **`bun` missing from PATH** → fail with an instruction to install Bun (Phase 3.4).
- **Latest critique has blockers + no `--force`** → fail with the top blocker quote.
- **`_components.css` or `colors_and_type.css` doesn't exist** → emit with an empty CSS bundle (TSX-only registry-item; the consumer gets a self-contained component but won't use the `_components.css` classes — that's essentially a same-stack handoff between maude projects).

After a successful handoff you see shell output with the path to the sidecar and a copy-paste `bunx shadcn add` command.
