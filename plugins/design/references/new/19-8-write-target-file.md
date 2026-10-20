### 8. Write the draft into the canvas

If validation fails, do not leave the draft half-done. Re-draft once with a concrete fix-list. If it fails again, stop and report what is wrong; the canvas stays a valid one (the hooks put back any write that broke it).

**The canvas already exists (step 3), so there is no file to write here:** the draft went in as Edits in step 6, and each Edit was checked and snapshotted by the design plugin's hooks. The `_canvas-shell.html` harness lives in the plugin distribution and is served at `/_canvas-shell.html`; **no copy lands in `<DESIGN_ROOT>/`** (the server is the single source of truth — avoids a stale per-project copy drifting from the plugin). The JSDoc header of the canvas is generated from its `.meta.json` (auto-emitted by `canvas-header.ts`), so do not edit it by hand.

#### Meta for the schema (V2-2.15)

The create wrote the canvas's `.meta.json` with its `designSystem` (the resolved `--ds` / default system). What this step adds is **one Edit** of that existing file, never a new one:

- Confirm `meta.designSystem` is the resolved system — a canvas without it is S9-blocked and can't be switched.
- For a **moodboard or comparison** canvas (an explicit intent at creation: the brief compares directions or systems), also add `meta.dsPinned: true`, so no system switch or update ever restyles it. Never infer this from the file name later; existing canvases get it only from the Bring-up review.
- Pins (literal colours, `--x-*`, `ext.*`) are **computed** by ds-check — never write `meta.dsPins`.
- The rest of what `/design:new` adds is in step 11 (title, subtitle, brief, scope, brief hash).
