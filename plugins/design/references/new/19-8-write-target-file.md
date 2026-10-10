### 8. Write target file

If validation fails, do not write. Re-prompt once with a concrete fix-list. If it fails again, stop.

**TSX canvases** are written from `plugins/design/templates/canvas.tsx.template` — the JSDoc header is generated from `.meta.json` (auto-emitted by `canvas-header.ts` on `/design:edit`); the JSX body is the frontend-design output. The `_canvas-shell.html` harness lives in the plugin distribution and is served at `/_canvas-shell.html`; **no copy lands in `<DESIGN_ROOT>/`** (server is the single source of truth — avoids a stale per-project copy drifting from the plugin).

#### Meta for the schema (V2-2.15)

- **Always** write `meta.designSystem` (the resolved `--ds` / default system) — a canvas without it is S9-blocked and can't be switched.
- For a **moodboard or comparison** canvas (an explicit intent at creation: the brief compares directions or systems), also write `meta.dsPinned: true`, so no system switch or update ever restyles it. Never infer this from the file name later; existing canvases get it only from the Bring-up review.
- Pins (literal colours, `--x-*`, `ext.*`) are **computed** by ds-check — never write `meta.dsPins`.
