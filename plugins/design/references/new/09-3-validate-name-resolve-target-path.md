### 3. Validate name + resolve target path

- Default canvas: `<DESIGN_ROOT>/<NEW_CANVAS_DIR>/<Name>.tsx` (TSX canvas served by the dev-server's two-pass pipeline + Bun.build runtime). The canvas mounts via `_canvas-shell.html`; React 19 + ReactDOM ride in shared `/_canvas-runtime/*.js` bundles. Envelope primitives (`DesignCanvas`, `DCSection`, `DCArtboard`, `DCPostIt`) come from `@maude/canvas-lib` — the dev-server resolves that virtual specifier to its bundled canvas-lib at `apps/studio/canvas-lib.tsx` (per DDR-025; ships with the dev-server install).
- `--component`: `<DESIGN_ROOT>/<NEW_COMPONENT_DIR>/<PascalName>.tsx`
- Reject if the target file exists (suggest `<Name> v2`).

**TSX is the only canvas format.** Legacy `.html` canvases have been migrated; the html-to-jsx codemod was removed alongside the migration. New canvases are authored as TSX from `canvas.tsx.template`.
