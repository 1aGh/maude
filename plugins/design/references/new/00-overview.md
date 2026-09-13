

# /design:new — scaffold a new canvas project

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Creates a **new multi-artboard canvas file** at `<designRoot>/<newCanvasDir>/<Name>.tsx` via the `frontend-design` plugin. The generic envelope adapts to `<repo>/.design/config.json` (rootClass, themeDefault, tokensCssRel, …). The canvas envelope (`DesignCanvas` / `DCSection` / `DCArtboard`) is imported from the virtual specifier `@maude/canvas-lib`, which the dev-server resolves to its bundled canvas-lib at `apps/studio/canvas-lib.tsx` (single source, ships with the dev-server install per DDR-025).

**A canvas project = `DesignCanvas` + one or more `DCSection` + one or more `DCArtboard`** (panable / zoomable infinite-canvas pattern). A single-page wrapper is an anti-pattern; a new screen belongs as another `DCArtboard` in an existing canvas (via `/design:edit "<add new artboard for X>"`, not via `/design:new`).

**Sessions no longer exist.** A new surface = a new file in `<designRoot>/<newCanvasDir>/`. No `.ai/design-sessions/` directory, no `iterations/NNN.tsx`. Iteration is an in-place edit with `_history/` snapshots.
