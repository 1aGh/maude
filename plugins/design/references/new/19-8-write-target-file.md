### 8. Write target file

If validation fails, do not write. Re-prompt once with a concrete fix-list. If it fails again, stop.

**TSX canvases** are written from `plugins/design/templates/canvas.tsx.template` — the JSDoc header is generated from `.meta.json` (auto-emitted by `canvas-header.ts` on `/design:edit`); the JSX body is the frontend-design output. The `_canvas-shell.html` harness lives in the plugin distribution and is served at `/_canvas-shell.html`; **no copy lands in `<DESIGN_ROOT>/`** (server is the single source of truth — avoids a stale per-project copy drifting from the plugin).
