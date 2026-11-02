

# /design:new — scaffold a new canvas project

Follow [host conventions](../../HARNESS.md) for Claude Code or Codex.

Creates a **new canvas with several artboards** at `<designRoot>/<newCanvasDir>/<Name>.tsx`. The canvas itself is made by the same create the app uses for ⌘N (step 3), so its name, file and `.meta.json` match what the person would get; the artboards are then drafted into it one at a time, with the `frontend-design` plugin. The generic envelope adapts to `<repo>/.design/config.json` (rootClass, themeDefault, tokensCssRel, …). The canvas envelope (`DesignCanvas` / `DCSection` / `DCArtboard`) is imported from the virtual specifier `@maude/canvas-lib`, which the dev-server resolves to its bundled canvas-lib at `apps/studio/canvas-lib.tsx` (single source, ships with the dev-server install per DDR-025).

**A canvas project = `DesignCanvas` + one or more `DCSection` + one or more `DCArtboard`** (panable / zoomable infinite-canvas pattern). A single-page wrapper is an anti-pattern; a new screen belongs as another `DCArtboard` in an existing canvas (via `/design:edit "<add new artboard for X>"`, not via `/design:new`).

**Sessions no longer exist.** A new surface = a new canvas in `<designRoot>/<newCanvasDir>/`. No `.ai/design-sessions/` directory, no `iterations/NNN.tsx`. Iteration is an in-place edit: the design plugin's hooks keep the bytes before every write, and Version history keeps every change (see [Snapshot protocol](../../skills/design/_guide-07-snapshot-protocol.md)).

Every artboard has a **kind** (Fixed size · Web page · Print · Video) and a size taken from the preset catalogue — App, Web page, Social, Print and Video are the picker's groups. Read [Artboards of a kind](../../skills/design/_guide-28-artboards.md) before you choose them. Text you write into Maude for the person (the result, a comment) follows skill `contract-voice`.
